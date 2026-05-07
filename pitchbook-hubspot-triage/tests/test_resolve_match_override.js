const assert = require("node:assert/strict");

const {
  createResolveMatchOverride
} = require("../jobs/resolve_match_override.js");

function createFakeApi(records, currentUser) {
  return {
    currentUser: currentUser || null,
    records: (records || []).map((record, index) => ({
      id: record.id || "record-" + index,
      data: { ...(record.data || record) }
    })),
    jobParams: {},
    updates: [],
    query() {
      const filters = arguments[0] || {};
      if (filters.id) {
        return {
          records: this.records.filter((record) => String(record.id) === String(filters.id)).slice(0, 1)
        };
      }

      return {
        records: this.records
      };
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

function createRecordWithCandidates() {
  return {
    id: "record-1",
    data: {
      record_type: "alert_item",
      headline: "Acquisition financing",
      processing_status: "matched",
      match_bucket: "possible",
      owner_name: "",
      selected_company_id: "",
      pending_note_body: "Trigger: Acquisition financing\nWhy it matters: Existing note",
      match_candidates: [
        {
          id: "hs-100",
          name: "Acquisition Financing Holdings",
          ultimate_parent: "ParentCo",
          owner_name: "Jamie Rivera",
          client_status: "client"
        },
        {
          id: "hs-200",
          name: "Acquisition Finance Group",
          ultimate_parent: "Alt Parent",
          owner_name: "Dana Cole",
          client_status: "prospect"
        }
      ]
    }
  };
}

function testSignedInUserIsRequired() {
  const api = createFakeApi([createRecordWithCandidates()], null);
  const job = createResolveMatchOverride(api);

  assert.throws(() => job.run({ recordId: "record-1", companyId: "hs-100" }), /signed-in user is required/i);
}

function testOverrideUpdatesSelectedCandidate() {
  const api = createFakeApi([createRecordWithCandidates()], {
    email: "reviewer@example.com"
  });
  const job = createResolveMatchOverride(api);

  const result = job.run({
    recordId: "record-1",
    companyId: "hs-200"
  });
  const updated = api.records[0].data;

  assert.equal(result.success, true);
  assert.equal(result.selected_company_id, "hs-200");
  assert.equal(updated.match_bucket, "high-confidence");
  assert.equal(updated.selected_company_id, "hs-200");
  assert.equal(updated.owner_name, "Dana Cole");
  assert.equal(updated.reviewer_override_state, "applied");
  assert.match(updated.pending_note_body, /Existing note/);
  assert.match(updated.pending_note_body, /reviewer@example.com/);
}

function testOverrideRejectsUnknownCandidate() {
  const api = createFakeApi([createRecordWithCandidates()], {
    email: "reviewer@example.com"
  });
  const job = createResolveMatchOverride(api);

  assert.throws(
    () => job.run({ recordId: "record-1", companyId: "hs-999" }),
    /Selected candidate was not present on the record/
  );
}

function testOverrideRejectsAlreadyResolvedHighConfidenceRecords() {
  const record = createRecordWithCandidates();
  record.data.match_bucket = "high-confidence";
  const api = createFakeApi([record], {
    email: "reviewer@example.com"
  });
  const job = createResolveMatchOverride(api);

  assert.throws(
    () => job.run({ recordId: "record-1", companyId: "hs-100" }),
    /only available for possible or no-match records/
  );
}

function run() {
  testSignedInUserIsRequired();
  testOverrideUpdatesSelectedCandidate();
  testOverrideRejectsUnknownCandidate();
  testOverrideRejectsAlreadyResolvedHighConfidenceRecords();
  console.log("test_resolve_match_override.js: ok");
}

run();
