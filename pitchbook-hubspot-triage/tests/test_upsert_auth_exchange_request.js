const assert = require("node:assert/strict");

const {
  createUpsertAuthExchangeRequest
} = require("../jobs/upsert_auth_exchange_request.js");

function createFakeApi(records, currentUser) {
  return {
    currentUser: currentUser || null,
    records: (records || []).map((record, index) => ({
      id: record.id || "record-" + index,
      data: { ...(record.data || record) }
    })),
    updates: [],
    creates: [],
    query(filters) {
      const next = this.records.filter((record) => {
        const data = record.data || {};
        if (filters && filters.type && data.type !== filters.type) {
          return false;
        }
        if (filters && filters.requestedByEmail && data.requestedByEmail !== filters.requestedByEmail) {
          return false;
        }
        return true;
      });

      return { records: next.slice(0, 1) };
    },
    create(recordsToCreate) {
      this.creates = this.creates.concat(recordsToCreate);
      const wrapped = recordsToCreate.map((record, index) => {
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
      this.updates = this.updates.concat(updates);
      updates.forEach((update) => {
        const existing = this.records.find((record) => record.id === update.id);
        if (existing) {
          existing.data = { ...(update.data || {}) };
        }
      });
      return updates;
    }
  };
}

function testSignedInUserIsRequired() {
  const api = createFakeApi([], null);
  const job = createUpsertAuthExchangeRequest(api);

  assert.throws(
    () => job.run({ status: "pending" }),
    /signed-in user is required/i
  );
}

function testCreatesAuthExchangeRequestForCurrentUser() {
  const api = createFakeApi([], { email: "tester@example.com" });
  const job = createUpsertAuthExchangeRequest(api);

  const result = job.run({
    status: "pending",
    state: "state-1"
  });

  assert.equal(result.success, true);
  assert.equal(result.operation, "created");
  assert.equal(api.creates.length, 1);
  assert.equal(api.records[0].data.type, "auth_exchange_request");
  assert.equal(api.records[0].data.requestedByEmail, "tester@example.com");
  assert.equal(api.records[0].data.status, "pending");
  assert.equal(api.records[0].data.state, "state-1");
}

function testUpdatesExistingAuthExchangeRequestForCurrentUser() {
  const api = createFakeApi(
    [
      {
        id: "existing-1",
        data: {
          type: "auth_exchange_request",
          requestedByEmail: "tester@example.com",
          status: "pending",
          state: "state-1"
        }
      }
    ],
    { email: "tester@example.com" }
  );
  const job = createUpsertAuthExchangeRequest(api);

  const result = job.run({
    status: "received",
    code: "auth-code"
  });

  assert.equal(result.success, true);
  assert.equal(result.operation, "updated");
  assert.equal(api.updates.length, 1);
  assert.equal(api.records[0].data.requestedByEmail, "tester@example.com");
  assert.equal(api.records[0].data.status, "received");
  assert.equal(api.records[0].data.code, "auth-code");
  assert.equal(api.records[0].data.state, "state-1");
}

function run() {
  testSignedInUserIsRequired();
  testCreatesAuthExchangeRequestForCurrentUser();
  testUpdatesExistingAuthExchangeRequestForCurrentUser();
  console.log("test_upsert_auth_exchange_request.js: ok");
}

run();
