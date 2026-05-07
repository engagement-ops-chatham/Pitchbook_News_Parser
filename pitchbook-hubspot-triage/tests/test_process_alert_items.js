const assert = require("node:assert/strict");

const {
  DEFAULT_TRIGGER_TERMS,
  QUEUE_BATCH_SIZE,
  createProcessAlertItems
} = require("../jobs/process_alert_items.js");

function createFakeApi(records, secrets) {
  return {
    secrets: { ...(secrets || {}) },
    records: (records || []).map((record, index) => ({
      id: record.id || "record-" + index,
      data: { ...(record.data || record) }
    })),
    updates: [],
    getSecret(name) {
      return this.secrets[name] || "";
    },
    query(filters, options) {
      const filtered = this.records.filter((record) => {
        const data = record.data || {};

        if (filters && filters.record_type && data.record_type !== filters.record_type) {
          return false;
        }

        if (filters && filters.processing_status && data.processing_status !== filters.processing_status) {
          return false;
        }

        return true;
      });

      const limit = options && typeof options.limit === "number" ? options.limit : filtered.length;
      return {
        records: filtered.slice(0, limit)
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

function createFakeFetch(responses, seenCalls) {
  return function fetchStub(url, options) {
    seenCalls.push({
      url,
      options
    });

    if (!responses.length) {
      throw new Error("Unexpected fetch call");
    }

    const next = responses.shift();
    return {
      ok: next.ok !== false,
      status: next.status || 200,
      statusText: next.statusText || "OK",
      json() {
        return next.json || {};
      },
      text() {
        return next.text || "";
      }
    };
  };
}

function baseSecrets() {
  return {
    TRIGGER_AI_API_URL: "https://trigger.example.test",
    TRIGGER_AI_API_TOKEN: "trigger-token",
    NEWS_RESEARCH_API_URL: "https://research.example.test",
    NEWS_RESEARCH_API_TOKEN: "research-token"
  };
}

function createQueuedRecord(id, headline) {
  return {
    id,
    data: {
      record_type: "alert_item",
      status: "seeded",
      headline,
      raw_excerpt: headline + " excerpt",
      processing_status: "queued",
      relevance_status: "unreviewed",
      evidence_status: "pending",
      match_bucket: "unprocessed"
    }
  };
}

function testMissingSecretsFailImmediately() {
  const api = createFakeApi([createQueuedRecord("one", "Example headline")], {
    TRIGGER_AI_API_URL: "https://trigger.example.test"
  });
  const job = createProcessAlertItems(api, {
    fetch: () => {
      throw new Error("fetch should not run without secrets");
    }
  });

  assert.throws(() => job.run(), /TRIGGER_AI_API_TOKEN secret not configured/);
}

function testQueuedRecordsAreClassifiedAndResearched() {
  const records = [
    createQueuedRecord("one", "IPO filing"),
    createQueuedRecord("two", "Routine baseball story"),
    createQueuedRecord("three", "Refinancing news")
  ];
  const api = createFakeApi(records, baseSecrets());
  const seenCalls = [];
  const responses = [
    {
      json: {
        relevance_status: "relevant",
        relevance_rationale: "IPO language detected",
        matched_trigger_terms: ["ipo"]
      }
    },
    {
      json: {
        sources: [
          {
            url: "https://news.example.test/ipo",
            title: "Corroborating IPO story",
            snippet: "Matches the PitchBook item"
          }
        ]
      }
    },
    {
      json: {
        relevance_status: "not-relevant",
        relevance_rationale: "No service trigger found",
        matched_trigger_terms: []
      }
    },
    {
      json: {
        relevance_status: "uncertain",
        relevance_rationale: "Refinancing context needs review",
        matched_trigger_terms: ["refinancing"]
      }
    },
    {
      json: {
        sources: []
      }
    }
  ];
  const job = createProcessAlertItems(api, {
    fetch: createFakeFetch(responses, seenCalls)
  });

  const result = job.run();

  assert.equal(result.processed_count, 3);
  assert.equal(result.relevant_count, 1);
  assert.equal(result.not_relevant_count, 1);
  assert.equal(result.uncertain_count, 1);
  assert.equal(result.corroborated_count, 1);
  assert.equal(result.not_found_count, 1);
  assert.equal(result.skipped_count, 1);
  assert.equal(api.updates.length, 3);
  assert.equal(seenCalls.length, 5);

  const first = api.records.find((record) => record.id === "one").data;
  const second = api.records.find((record) => record.id === "two").data;
  const third = api.records.find((record) => record.id === "three").data;

  assert.equal(first.processing_status, "analyzed");
  assert.equal(first.relevance_status, "relevant");
  assert.equal(first.evidence_status, "corroborated");
  assert.equal(first.corroborating_source.url, "https://news.example.test/ipo");
  assert.equal(first.corroborating_source.title, "Corroborating IPO story");
  assert.deepEqual(first.matched_trigger_terms, ["ipo"]);

  assert.equal(second.processing_status, "analyzed");
  assert.equal(second.relevance_status, "not-relevant");
  assert.equal(second.evidence_status, "skipped");

  assert.equal(third.processing_status, "analyzed");
  assert.equal(third.relevance_status, "uncertain");
  assert.equal(third.evidence_status, "not-found");
  assert.equal(third.corroborating_source, null);
  assert.deepEqual(third.matched_trigger_terms, ["refinancing"]);

  const firstCall = seenCalls[0];
  assert.equal(firstCall.url, baseSecrets().TRIGGER_AI_API_URL);
  assert.equal(firstCall.options.headers.Authorization, "Bearer " + baseSecrets().TRIGGER_AI_API_TOKEN);
  const payload = JSON.parse(firstCall.options.body);
  assert.deepEqual(payload.trigger_terms, DEFAULT_TRIGGER_TERMS);
}

function testRecordLevelFailuresAreCapturedWithoutTouchingNonQueuedRecords() {
  const records = [
    createQueuedRecord("one", "Acquisition news"),
    {
      id: "done",
      data: {
        record_type: "alert_item",
        status: "seeded",
        headline: "Already processed",
        raw_excerpt: "Already processed excerpt",
        processing_status: "analyzed",
        relevance_status: "relevant",
        evidence_status: "corroborated",
        match_bucket: "unprocessed"
      }
    }
  ];
  const api = createFakeApi(records, baseSecrets());
  const job = createProcessAlertItems(api, {
    fetch: createFakeFetch(
      [
        {
          ok: false,
          status: 502,
          statusText: "Bad Gateway",
          text: "upstream unavailable"
        }
      ],
      []
    )
  });

  const result = job.run();
  const updated = api.records.find((record) => record.id === "one").data;
  const untouched = api.records.find((record) => record.id === "done").data;

  assert.equal(result.processed_count, 1);
  assert.equal(result.failed_count, 1);
  assert.equal(updated.processing_status, "analysis-failed");
  assert.match(updated.relevance_rationale, /Analysis failed:/);
  assert.equal(updated.evidence_status, "skipped");
  assert.equal(untouched.processing_status, "analyzed");
}

function testResearchFailuresDoNotEraseClassification() {
  const api = createFakeApi([createQueuedRecord("one", "Debt refinancing")], baseSecrets());
  const job = createProcessAlertItems(api, {
    fetch: createFakeFetch(
      [
        {
          json: {
            relevance_status: "relevant",
            relevance_rationale: "Debt financing trigger detected",
            matched_trigger_terms: ["debt financing"]
          }
        },
        {
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
          text: "research offline"
        }
      ],
      []
    )
  });

  const result = job.run();
  const updated = api.records.find((record) => record.id === "one").data;

  assert.equal(result.processed_count, 1);
  assert.equal(result.failed_count, 0);
  assert.equal(result.relevant_count, 1);
  assert.equal(result.research_failed_count, 1);
  assert.equal(updated.processing_status, "analyzed");
  assert.equal(updated.relevance_status, "relevant");
  assert.equal(updated.evidence_status, "research-failed");
}

function testQueuedBacklogDrainsAcrossMultipleBatches() {
  const records = [];
  const responses = [];
  for (let index = 0; index < QUEUE_BATCH_SIZE + 2; index += 1) {
    records.push(createQueuedRecord("bulk-" + index, "Headline " + index));
    responses.push({
      json: {
        relevance_status: "not-relevant",
        relevance_rationale: "No trigger in headline",
        matched_trigger_terms: []
      }
    });
  }

  const api = createFakeApi(records, baseSecrets());
  const job = createProcessAlertItems(api, {
    fetch: createFakeFetch(responses, [])
  });

  const result = job.run();

  assert.equal(result.processed_count, QUEUE_BATCH_SIZE + 2);
  assert.equal(result.not_relevant_count, QUEUE_BATCH_SIZE + 2);
  assert.equal(api.records.filter((record) => record.data.processing_status === "analyzed").length, QUEUE_BATCH_SIZE + 2);
}

function run() {
  testMissingSecretsFailImmediately();
  testQueuedRecordsAreClassifiedAndResearched();
  testRecordLevelFailuresAreCapturedWithoutTouchingNonQueuedRecords();
  testResearchFailuresDoNotEraseClassification();
  testQueuedBacklogDrainsAcrossMultipleBatches();
  console.log("test_process_alert_items.js: ok");
}

run();
