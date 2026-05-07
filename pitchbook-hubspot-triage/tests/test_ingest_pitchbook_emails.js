const assert = require("node:assert/strict");

const {
  LOOKBACK_HOURS,
  MAILBOX_INGEST_SOURCE,
  PITCHBOOK_SENDER,
  createIngestPitchbookEmails,
  extractPitchBookItemsFromBody
} = require("../jobs/ingest_pitchbook_emails.js");

function createFakeApi(secrets, initialRecords) {
  const records = (initialRecords || []).map((record, index) => ({
    id: "existing-" + index,
    data: { ...record }
  }));

  return {
    secrets: { ...(secrets || {}) },
    records,
    createCalls: [],
    updateCalls: [],
    getSecret(name) {
      return this.secrets[name] || "";
    },
    query(filters, options) {
      const filtered = this.records.filter((record) => {
        const data = record.data || {};

        if (filters && filters.record_type && data.record_type !== filters.record_type) {
          return false;
        }

        if (filters && filters.status && data.status !== filters.status) {
          return false;
        }

        if (filters && filters.type && data.type !== filters.type) {
          return false;
        }

        return true;
      });

      const offset = options && typeof options.offset === "number" ? options.offset : 0;
      const limit = options && typeof options.limit === "number" ? options.limit : filtered.length;
      return {
        records: filtered.slice(offset, offset + limit)
      };
    },
    create(recordsToCreate) {
      this.createCalls.push(recordsToCreate);
      const wrapped = recordsToCreate.map((record, index) => {
        const created = {
          id: "created-" + (this.records.length + index + 1),
          data: { ...record }
        };
        this.records.push(created);
        return created;
      });
      return {
        records: wrapped
      };
    },
    update(recordsToUpdate) {
      this.updateCalls.push(recordsToUpdate);
      recordsToUpdate.forEach((record) => {
        const existing = this.records.find((candidate) => candidate.id === record.id);
        if (existing) {
          existing.data = { ...record.data };
        }
      });
      return {
        records: recordsToUpdate
      };
    }
  };
}

function createResponse(response) {
  return {
    ok: response.ok !== false,
    status: response.status || 200,
    statusText: response.statusText || "OK",
    text() {
      return response.text || "";
    },
    json() {
      return response.json || {};
    }
  };
}

function baseAdapterSecrets() {
  return {
    MAILBOX_SYNC_API_URL: "https://mailbox.example.test",
    MAILBOX_SYNC_API_TOKEN: "mailbox-token"
  };
}

function baseGraphSecrets() {
  return {
    ENTRA_TENANT_ID: "tenant-id",
    ENTRA_CLIENT_ID: "client-id",
    ENTRA_CLIENT_SECRET: "client-secret"
  };
}

function testExtractPitchBookItemsFromBodySplitsAlertEntries() {
  const body = [
    "PitchBook 19-Mar-2026 Alerts from your list",
    "DealStreetAsia | 1:49 am | 18-Mar-2026",
    "",
    "GIC-backed Sunway Healthcare jumps 17% in mega Malaysia listing <https://example.test>",
    "Entity mentions: Sunway Healthcare Holdings",
    "",
    "The Business Times Singapore | 4:21 am | 18-Mar-2026",
    "",
    "Sunway Healthcare jumps 17% on Bursa debut in Malaysia's biggest IPO in nine years",
    "Topic mentions: Financing, Revenue"
  ].join("\n");

  const items = extractPitchBookItemsFromBody(body, 'PitchBook Alert - "PE/M&A Deals - Last 30 Days"');

  assert.equal(items.length, 2);
  assert.equal(items[0].source_name, "DealStreetAsia");
  assert.match(items[0].headline, /Sunway Healthcare/);
  assert.equal(items[0].published_at, "18-Mar-2026 1:49 am");
  assert.match(items[1].headline, /Bursa debut/);
}

function testMissingAdapterSecretsFailImmediatelyWhenGraphIsUnavailable() {
  const api = createFakeApi({
    MAILBOX_SYNC_API_URL: "https://mailbox.example.test"
  });
  const job = createIngestPitchbookEmails(api, {
    fetch: () => {
      throw new Error("fetch should not run without both mailbox secrets");
    }
  });

  assert.throws(() => job.run(), /MAILBOX_SYNC_API_TOKEN secret not configured/);
}

function testMailboxAdapterPayloadCreatesQueuedAlertRecords() {
  const api = createFakeApi(baseAdapterSecrets());
  const seenCalls = [];
  const job = createIngestPitchbookEmails(api, {
    fetch(url, options) {
      seenCalls.push({ url, options });
      return createResponse({
        json: {
          items: [
            {
              source_subject: 'PitchBook Alert - "PE/M&A Deals - Last 30 Days"',
              source_sender: "PitchBook Alerts <alerts-noreply@alerts.pitchbook.com>",
              source_date: "2026-05-07T07:58:00-04:00",
              items: [
                {
                  item_type: "news",
                  source_name: "DealStreetAsia",
                  published_at: "07-May-2026 7:10 am",
                  headline: "Refinancing package expands for GrowthCo",
                  raw_excerpt: "GrowthCo refinancing package expands"
                },
                {
                  item_type: "news",
                  source_name: "The Information",
                  published_at: "07-May-2026 7:22 am",
                  headline: "IPO filing planned by Example Holdings",
                  raw_excerpt: "Example Holdings prepares IPO filing"
                }
              ]
            }
          ]
        }
      });
    }
  });

  const result = job.run();

  assert.equal(result.imported_message_count, 1);
  assert.equal(result.imported_item_count, 2);
  assert.equal(api.createCalls[0].length, 2);
  assert.equal(seenCalls[0].url, baseAdapterSecrets().MAILBOX_SYNC_API_URL);
  assert.equal(seenCalls[0].options.headers.Authorization, "Bearer " + baseAdapterSecrets().MAILBOX_SYNC_API_TOKEN);
  const payload = JSON.parse(seenCalls[0].options.body);
  assert.equal(payload.source, MAILBOX_INGEST_SOURCE);
  assert.equal(payload.lookback_hours, LOOKBACK_HOURS);
}

function testGraphMailboxSyncRefreshesTokenAndImportsParsedItems() {
  const api = createFakeApi(baseGraphSecrets(), [
    {
      type: "auth_connection",
      status: "connected",
      connected: true,
      refreshToken: "refresh-token",
      user: {
        email: "analyst@example.com"
      }
    }
  ]);
  const seenCalls = [];
  const job = createIngestPitchbookEmails(api, {
    fetch(url, options) {
      seenCalls.push({ url, options });
      if (/oauth2\/v2\.0\/token/i.test(url)) {
        return createResponse({
          text: JSON.stringify({
            access_token: "graph-access-token",
            refresh_token: "refreshed-token",
            expires_in: 3600,
            scope: "openid profile Mail.Read User.Read offline_access"
          })
        });
      }

      if (/graph\.microsoft\.com\/v1\.0\/me\/messages/i.test(url)) {
        return createResponse({
          text: JSON.stringify({
            value: [
              {
                id: "graph-message-1",
                subject: 'PitchBook Alert - "PE/M&A Deals - Last 30 Days"',
                receivedDateTime: "2026-05-07T07:58:00-04:00",
                from: {
                  emailAddress: {
                    name: "PitchBook Alerts",
                    address: PITCHBOOK_SENDER
                  }
                },
                body: {
                  contentType: "text",
                  content: [
                    "DealStreetAsia | 1:49 am | 18-Mar-2026",
                    "",
                    "GIC-backed Sunway Healthcare jumps 17% in mega Malaysia listing",
                    "Entity mentions: Sunway Healthcare Holdings"
                  ].join("\n")
                }
              }
            ]
          })
        });
      }

      throw new Error("Unexpected fetch URL: " + url);
    }
  });

  const result = job.run();

  assert.equal(result.imported_message_count, 1);
  assert.equal(result.imported_item_count, 1);
  assert.equal(api.createCalls[0][0].headline, "GIC-backed Sunway Healthcare jumps 17% in mega Malaysia listing");
  assert.equal(api.updateCalls.length, 1);
  assert.match(seenCalls[0].url, /oauth2\/v2\.0\/token/);
  assert.match(seenCalls[1].url, /graph\.microsoft\.com\/v1\.0\/me\/messages/);
  assert.match(seenCalls[1].url, /alerts-noreply%40alerts\.pitchbook\.com/);
  assert.equal(seenCalls[1].options.headers.Authorization, "Bearer graph-access-token");
}

function testGraphMailboxSyncRequiresStoredConnection() {
  const api = createFakeApi(baseGraphSecrets());
  const job = createIngestPitchbookEmails(api, {
    fetch: () => {
      throw new Error("fetch should not run without auth connection");
    }
  });

  assert.throws(() => job.run(), /No Microsoft 365 connection is stored/);
}

function testMailboxPayloadSkipsPreviouslyIngestedDuplicates() {
  const api = createFakeApi(baseAdapterSecrets());
  const response = {
    json: {
      items: [
        {
          source_subject: 'PitchBook Alert - "PE/M&A Deals - Last 30 Days"',
          source_sender: "PitchBook Alerts <alerts-noreply@alerts.pitchbook.com>",
          source_date: "2026-05-07T07:58:00-04:00",
          items: [
            {
              item_type: "news",
              source_name: "DealStreetAsia",
              published_at: "07-May-2026 7:10 am",
              headline: "Refinancing package expands for GrowthCo",
              raw_excerpt: "GrowthCo refinancing package expands"
            }
          ]
        }
      ]
    }
  };
  const job = createIngestPitchbookEmails(api, {
    fetch() {
      return createResponse(response);
    }
  });

  const first = job.run();
  const second = job.run();

  assert.equal(first.imported_item_count, 1);
  assert.equal(second.imported_item_count, 0);
  assert.equal(api.createCalls.length, 2);
  assert.equal(api.createCalls[1].length, 1); // mailbox_ingest_state singleton create
}

function run() {
  testExtractPitchBookItemsFromBodySplitsAlertEntries();
  testMissingAdapterSecretsFailImmediatelyWhenGraphIsUnavailable();
  testMailboxAdapterPayloadCreatesQueuedAlertRecords();
  testGraphMailboxSyncRefreshesTokenAndImportsParsedItems();
  testGraphMailboxSyncRequiresStoredConnection();
  testMailboxPayloadSkipsPreviouslyIngestedDuplicates();
  console.log("test_ingest_pitchbook_emails.js: ok");
}

run();
