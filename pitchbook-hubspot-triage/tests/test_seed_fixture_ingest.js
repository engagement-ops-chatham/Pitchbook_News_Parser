const assert = require("node:assert/strict");

const {
  DEMO_FIXTURES,
  buildSeedRecords,
  createSeedFixtureIngest
} = require("../jobs/seed_fixture_ingest.js");

function createFakeApi(initialRecords) {
  const records = (initialRecords || []).map((record, index) => ({
    id: "existing-" + index,
    data: record
  }));
  let createdCount = 0;

  return {
    records,
    query(filters, options) {
      const filtered = this.records.filter((record) => {
        const data = record.data || {};

        if (filters && filters.record_type && data.record_type !== filters.record_type) {
          return false;
        }

        if (filters && filters.status && data.status !== filters.status) {
          return false;
        }

        return true;
      });

      const limit = options && typeof options.limit === "number" ? options.limit : filtered.length;
      const offset = options && typeof options.offset === "number" ? options.offset : 0;
      return {
        records: filtered.slice(offset, offset + limit)
      };
    },
    create(newRecords) {
      const created = newRecords.map((record) => {
        createdCount += 1;
        const wrapped = {
          id: "created-" + createdCount,
          data: record
        };
        this.records.push(wrapped);
        return wrapped;
      });

      return {
        records: created
      };
    }
  };
}

function testSeedRecordsIncludeExpectedBuckets() {
  const seeded = buildSeedRecords("pe_ma", DEMO_FIXTURES.pe_ma, true);

  assert.equal(seeded.length, DEMO_FIXTURES.pe_ma.items.length);
  assert.equal(seeded[0].match_bucket, "high-confidence");
  assert.equal(seeded[1].match_bucket, "possible");
  assert.equal(seeded[2].match_bucket, "no-match");
  assert.equal(seeded[3].relevance_status, "not-relevant");
  assert.match(seeded[0].pending_note_body, /Trigger:/);
}

function testSeedFixtureSkipsDuplicates() {
  const api = createFakeApi();
  const job = createSeedFixtureIngest(api);

  const first = job.run({
    action: "seed_demo_fixture",
    fixture_name: "pe_ma"
  });
  const second = job.run({
    action: "seed_demo_fixture",
    fixture_name: "pe_ma"
  });

  assert.equal(first.created_count, DEMO_FIXTURES.pe_ma.items.length);
  assert.equal(first.skipped_count, 0);
  assert.equal(second.created_count, 0);
  assert.equal(second.skipped_count, DEMO_FIXTURES.pe_ma.items.length);
}

function testSeedFixtureSkipsDuplicatesWhenItemOrderChanges() {
  const api = createFakeApi();
  const job = createSeedFixtureIngest(api);
  const reversedFixture = {
    ...DEMO_FIXTURES.pe_ma,
    items: [...DEMO_FIXTURES.pe_ma.items].reverse()
  };

  const first = job.run({
    action: "seed_fixture",
    fixture_name: "reordered",
    fixture: DEMO_FIXTURES.pe_ma
  });
  const second = job.run({
    action: "seed_fixture",
    fixture_name: "reordered",
    fixture: reversedFixture
  });

  assert.equal(first.created_count, DEMO_FIXTURES.pe_ma.items.length);
  assert.equal(second.created_count, 0);
  assert.equal(second.skipped_count, DEMO_FIXTURES.pe_ma.items.length);
}

function testSeedFixtureRejectsClientTriggeredCustomPayloads() {
  const api = createFakeApi();
  api.currentUser = {
    email: "tester@example.com"
  };
  const job = createSeedFixtureIngest(api);

  assert.throws(
    () =>
      job.run({
        action: "seed_fixture",
        fixture_name: "custom",
        fixture: DEMO_FIXTURES.pe_ma
      }),
    /trusted server-side ingestion/
  );
}

function testListQueueFiltersByBucketAndStatus() {
  const api = createFakeApi();
  const job = createSeedFixtureIngest(api);
  const unseededRecord = {
    id: "live-1",
    data: {
      record_type: "alert_item",
      status: "processed",
      match_bucket: "high-confidence",
      relevance_status: "relevant",
      headline: "Real production record"
    }
  };

  api.records.push(unseededRecord);

  job.run({
    action: "seed_demo_fixture",
    fixture_name: "pe_ma"
  });

  const possible = job.run({
    action: "list_queue",
    status: "possible"
  });
  const notRelevant = job.run({
    action: "list_queue",
    status: "not-relevant"
  });

  assert.equal(possible.items.length, 1);
  assert.equal(possible.items[0].data.match_bucket, "possible");
  assert.equal(notRelevant.items.length, 1);
  assert.equal(notRelevant.items[0].data.relevance_status, "not-relevant");
  assert.equal(possible.total_count, DEMO_FIXTURES.pe_ma.items.length);
}

function testListQueueRejectsUnknownStatuses() {
  const api = createFakeApi();
  const job = createSeedFixtureIngest(api);

  assert.throws(
    () =>
      job.run({
        action: "list_queue",
        status: "everything"
      }),
    /Unsupported queue status/
  );
}

function run() {
  testSeedRecordsIncludeExpectedBuckets();
  testSeedFixtureSkipsDuplicates();
  testSeedFixtureSkipsDuplicatesWhenItemOrderChanges();
  testSeedFixtureRejectsClientTriggeredCustomPayloads();
  testListQueueFiltersByBucketAndStatus();
  testListQueueRejectsUnknownStatuses();
  console.log("test_seed_fixture_ingest.js: ok");
}

run();
