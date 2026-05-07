const assert = require("node:assert/strict");

const {
  LOOKBACK_HOURS,
  MAILBOX_INGEST_SOURCE,
  createIngestPitchbookEmails
} = require("../jobs/ingest_pitchbook_emails.js");

function createFakeApi(secrets) {
  return {
    secrets: { ...(secrets || {}) },
    records: [],
    createCalls: [],
    getSecret(name) {
      return this.secrets[name] || "";
    },
    create(records) {
      this.createCalls.push(records);
      records.forEach((record, index) => {
        this.records.push({
          id: "created-" + (this.records.length + index + 1),
          data: { ...record }
        });
      });
      return records;
    }
  };
}

function createFetchStub(response, seenCalls) {
  return function fetchStub(url, options) {
    seenCalls.push({
      url,
      options
    });

    return {
      ok: response.ok !== false,
      status: response.status || 200,
      statusText: response.statusText || "OK",
      json() {
        return response.json || {};
      },
      text() {
        return response.text || "";
      }
    };
  };
}

function baseSecrets() {
  return {
    MAILBOX_SYNC_API_URL: "https://mailbox.example.test",
    MAILBOX_SYNC_API_TOKEN: "mailbox-token"
  };
}

function testMissingSecretsFailImmediately() {
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

function testMailboxPayloadCreatesQueuedAlertRecords() {
  const api = createFakeApi(baseSecrets());
  const seenCalls = [];
  const job = createIngestPitchbookEmails(api, {
    fetch: createFetchStub(
      {
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
      },
      seenCalls
    )
  });

  const result = job.run();

  assert.equal(result.imported_message_count, 1);
  assert.equal(result.imported_item_count, 2);
  assert.equal(api.createCalls.length, 1);
  assert.equal(api.createCalls[0].length, 2);

  const created = api.createCalls[0][0];
  assert.equal(created.record_type, "alert_item");
  assert.equal(created.status, "ingested-mailbox");
  assert.equal(created.source_subject, 'PitchBook Alert - "PE/M&A Deals - Last 30 Days"');
  assert.equal(created.source_sender, "PitchBook Alerts <alerts-noreply@alerts.pitchbook.com>");
  assert.equal(created.processing_status, "queued");
  assert.equal(created.relevance_status, "unreviewed");
  assert.equal(created.match_bucket, "unprocessed");
  assert.equal(created.evidence_status, "pending");

  assert.equal(seenCalls.length, 1);
  assert.equal(seenCalls[0].url, baseSecrets().MAILBOX_SYNC_API_URL);
  assert.equal(seenCalls[0].options.headers.Authorization, "Bearer " + baseSecrets().MAILBOX_SYNC_API_TOKEN);
  const payload = JSON.parse(seenCalls[0].options.body);
  assert.equal(payload.source, MAILBOX_INGEST_SOURCE);
  assert.equal(payload.lookback_hours, LOOKBACK_HOURS);
}

function testMailboxAdapterFailuresBubbleWithStatus() {
  const api = createFakeApi(baseSecrets());
  const job = createIngestPitchbookEmails(api, {
    fetch: createFetchStub(
      {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: "adapter offline"
      },
      []
    )
  });

  assert.throws(() => job.run(), /Mailbox adapter failed: 503 Service Unavailable - adapter offline/);
}

function run() {
  testMissingSecretsFailImmediately();
  testMailboxPayloadCreatesQueuedAlertRecords();
  testMailboxAdapterFailuresBubbleWithStatus();
  console.log("test_ingest_pitchbook_emails.js: ok");
}

run();
