const assert = require("node:assert/strict");

const { createExchangeAuthCode } = require("../jobs/exchange_auth_code.js");

function createFakeApi(secrets, records) {
  const store = (records || []).map((record, index) => ({
    id: "existing-" + index,
    data: { ...record }
  }));

  return {
    currentUser: {
      email: "tester@example.com"
    },
    secrets: { ...(secrets || {}) },
    records: store,
    updates: [],
    getSecret(name) {
      return this.secrets[name] || "";
    },
    query(filters, options) {
      const filtered = this.records.filter((record) => {
        const data = record.data || {};
        if (filters && filters.type && data.type !== filters.type) {
          return false;
        }
        if (filters && filters.requestedByEmail && data.requestedByEmail !== filters.requestedByEmail) {
          return false;
        }
        return true;
      });
      const limit = options && typeof options.limit === "number" ? options.limit : filtered.length;
      return {
        records: filtered.slice(0, limit)
      };
    },
    create(newRecords) {
      const wrapped = newRecords.map((record, index) => {
        const created = {
          id: "created-" + (this.records.length + index + 1),
          data: { ...record }
        };
        this.records.push(created);
        return created;
      });
      return wrapped;
    },
    update(updates) {
      this.updates.push(...updates);
      updates.forEach((update) => {
        const existing = this.records.find((record) => record.id === update.id);
        if (existing) {
          existing.data = { ...update.data };
        }
      });
    }
  };
}

function createFetchStub(seenCalls) {
  return function fetchStub(url, options) {
    seenCalls.push({ url, options });

    if (/oauth2\/v2\.0\/token/i.test(url)) {
      return {
        ok: true,
        status: 200,
        text() {
          return JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
            scope: "openid profile Mail.Read User.Read offline_access"
          });
        }
      };
    }

    if (/graph\.microsoft\.com\/v1\.0\/me\?/i.test(url)) {
      return {
        ok: true,
        status: 200,
        text() {
          return JSON.stringify({
            id: "user-1",
            displayName: "Test User",
            mail: "tester@example.com"
          });
        }
      };
    }

    if (/graph\.microsoft\.com\/v1\.0\/me\/messages/i.test(url)) {
      return {
        ok: true,
        status: 200,
        text() {
          return JSON.stringify({
            value: [
              {
                id: "message-1",
                subject: "Proof message",
                receivedDateTime: "2026-05-07T10:00:00Z",
                from: {
                  emailAddress: {
                    name: "PitchBook Alerts",
                    address: "alerts-noreply@alerts.pitchbook.com"
                  }
                }
              }
            ]
          });
        }
      };
    }

    throw new Error("Unexpected fetch URL: " + url);
  };
}

function baseSecrets() {
  return {
    ENTRA_TENANT_ID: "tenant-id",
    ENTRA_CLIENT_ID: "client-id",
    ENTRA_CLIENT_SECRET: "client-secret",
    ENTRA_REDIRECT_URI: "https://example.test/vibe_apps/364"
  };
}

function testFallsBackToStoredAuthExchangeRequest() {
  const seenCalls = [];
  const api = createFakeApi(baseSecrets(), [
    {
      type: "auth_exchange_request",
      requestedByEmail: "tester@example.com",
      code: "stored-auth-code",
      codeVerifier: "stored-verifier",
      redirectUri: "https://example.test/vibe_apps/364",
      state: "state-1",
      expectedState: "state-1"
    }
  ]);

  const job = createExchangeAuthCode(api, {
    fetch: createFetchStub(seenCalls),
    payload: {
      requestedByEmail: "tester@example.com"
    }
  });

  const result = job.run();

  assert.equal(result.connected, true);
  assert.equal(seenCalls.length >= 3, true);
  assert.match(seenCalls[0].options.body, /code=stored-auth-code/);
}

function run() {
  assert.equal(typeof createExchangeAuthCode, "function");
  testFallsBackToStoredAuthExchangeRequest();
  console.log("test_exchange_auth_code.js: ok");
}

run();
