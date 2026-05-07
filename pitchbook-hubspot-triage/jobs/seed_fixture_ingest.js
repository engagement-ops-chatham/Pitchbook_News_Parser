var DEMO_FIXTURES = {
  pe_ma: {
    source_subject: 'PitchBook Alert - "PE/M&A Deals - Last 30 Days"',
    source_sender: "PitchBook Alerts <alerts-noreply@alerts.pitchbook.com>",
    source_date: "2026-03-19 07:21:19-04:00",
    items: [
      {
        item_type: "news",
        headline: "GIC-backed Sunway Healthcare jumps 17% in mega Malaysia listing",
        source_name: "DealStreetAsia",
        published_at: "18-Mar-2026 1:49 am",
        raw_excerpt:
          "GIC-backed Sunway Healthcare jumps 17% in mega Malaysia listing\nEntity mentions: Sunway Healthcare Holdings\nTopic mentions: EBITDA, Revenue, Use of Funds"
      },
      {
        item_type: "news",
        headline: "Sunway Healthcare jumps 17% on Bursa debut in Malaysia's biggest IPO in nine years",
        source_name: "The Business Times Singapore",
        published_at: "18-Mar-2026 4:21 am",
        raw_excerpt:
          "Sunway Healthcare jumps 17% on Bursa debut in Malaysia's biggest IPO in nine years\nEntity mentions: Bursa Malaysia, Sunway Healthcare Holdings\nTopic mentions: Financing, LP Commitment, Net Income, Revenue"
      },
      {
        item_type: "news",
        headline: "SG data center firm DayOne seeks to increase loan to $7b",
        source_name: "Tech in Asia",
        published_at: "18-Mar-2026 3:34 am",
        raw_excerpt:
          "SG data center firm DayOne seeks to increase loan to $7b\nEntity mentions: Day One Biopharmaceuticals"
      },
      {
        item_type: "news",
        headline: "City AM Awards 2026: Meet the Finalists",
        source_name: "City A.M.",
        published_at: "18-Mar-2026 10:37 am",
        raw_excerpt:
          "City AM Awards 2026: Meet the Finalists\nEntity mentions: Rvvup, OpenGamma, Runware, Ineffable Intelligence, Inigo (Insurance), Beazley\nTopic mentions: About, Employee Count, Financing, Layoff Staffing, Location, Merger Acquisition, Revenue"
      }
    ]
  },
  watchlist_companies: {
    source_subject: 'PitchBook Alert - "Watch List - Companies"',
    source_sender: "PitchBook Alerts <alerts-noreply@alerts.pitchbook.com>",
    source_date: "2026-03-19 07:21:41-04:00",
    items: [
      {
        item_type: "news",
        headline: "Jack's Family Restaurants to Open First Florida Location",
        source_name: "Company Press Release",
        published_at: "18-Mar-2026 3:05 pm",
        raw_excerpt:
          "Jack's Family Restaurants to Open First Florida Location\nEntity mentions: Jack's Family Restaurants\nTopic mentions: About, Founding Date"
      },
      {
        item_type: "news",
        headline: "Clearsight Advises Stratis Group in its Acquisition by Nexus Health, part of The Lockwood Group",
        source_name: "Company Press Release",
        published_at: "18-Mar-2026 5:30 pm",
        raw_excerpt:
          "Clearsight Advises Stratis Group in its Acquisition by Nexus Health, part of The Lockwood Group\nEntity mentions: The Lockwood Group, Clearsight Advisors, Stratis Group"
      },
      {
        item_type: "news",
        headline: "Federal Court Denies Skullcandy's Motion to Dismiss Privacy Class Action Over Website Tracking Technologies",
        source_name: "Company Press Release",
        published_at: "18-Mar-2026 8:41 pm",
        raw_excerpt:
          "Federal Court Denies Skullcandy's Motion to Dismiss Privacy Class Action Over Website Tracking Technologies\nEntity mentions: Skullcandy"
      },
      {
        item_type: "news",
        headline: "Venezuela Defeats Team USA to Win World Baseball Classic",
        source_name: "Company Press Release",
        published_at: "18-Mar-2026 1:00 pm",
        raw_excerpt:
          "Venezuela Defeats Team USA to Win World Baseball Classic\nEntity mentions: University of St. Augustine for Health Sciences"
      }
    ]
  }
};

var DEMO_QUEUE_STATES = [
  {
    processing_status: "matched",
    relevance_status: "relevant",
    match_bucket: "high-confidence",
    evidence_status: "corroborated",
    owner_name: "Morgan Chen",
    selected_company_id: "hs-demo-1001"
  },
  {
    processing_status: "matched",
    relevance_status: "relevant",
    match_bucket: "possible",
    evidence_status: "corroborated",
    owner_name: ""
  },
  {
    processing_status: "matched",
    relevance_status: "relevant",
    match_bucket: "no-match",
    evidence_status: "not-found",
    owner_name: ""
  },
  {
    processing_status: "analyzed",
    relevance_status: "not-relevant",
    match_bucket: "unprocessed",
    evidence_status: "skipped",
    owner_name: ""
  }
];
var SEEDED_STATUSES = ["seeded", "seeded-demo"];
var ALLOWED_QUEUE_STATUSES = ["high-confidence", "possible", "no-match", "not-relevant"];

function normalizeRecords(result) {
  if (!result) {
    return [];
  }

  if (Array.isArray(result)) {
    return result;
  }

  if (Array.isArray(result.records)) {
    return result.records;
  }

  return [];
}

function recordData(record) {
  return record && record.data ? record.data : record || {};
}

function listRecords(api, filters) {
  var offset = 0;
  var pageSize = 100;
  var allRecords = [];

  while (true) {
    var result = normalizeRecords(
      api.query(filters || {}, { limit: pageSize, offset: offset, order: "created_at desc" })
    );

    if (!result.length) {
      break;
    }

    allRecords = allRecords.concat(result);

    if (result.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return allRecords;
}

function listSeededAlertItemRecords(api) {
  var merged = [];
  var seenIds = {};

  SEEDED_STATUSES.forEach(function(status) {
    listRecords(api, { record_type: "alert_item", status: status }).forEach(function(record) {
      var recordId = record && record.id ? String(record.id) : "";
      if (recordId && seenIds[recordId]) {
        return;
      }

      if (recordId) {
        seenIds[recordId] = true;
      }

      merged.push(record);
    });
  });

  return merged;
}

function buildSeedKey(fixtureName, fixture, item, index) {
  var parts = [
    fixtureName || "custom",
    fixture && fixture.source_subject ? fixture.source_subject : "",
    fixture && fixture.source_date ? fixture.source_date : "",
    item && item.item_type ? item.item_type : "news",
    item && item.headline ? item.headline : "",
    item && item.source_name ? item.source_name : "",
    item && item.published_at ? item.published_at : "",
    item && item.raw_excerpt ? item.raw_excerpt : ""
  ];

  return parts
    .map(function(part) {
      return String(part || "")
        .trim()
        .toLowerCase();
    })
    .join("::");
}

function buildPendingNote(item, ownerName) {
  return [
    "Trigger: " + (item.headline || "Untitled alert"),
    "Why it matters: Seeded development fixture for queue review.",
    "Owner: " + (ownerName || "Unassigned")
  ].join("\n");
}

function buildSeedRecord(fixtureName, fixture, item, index, demoMode) {
  var state = demoMode ? DEMO_QUEUE_STATES[index % DEMO_QUEUE_STATES.length] : null;
  var ownerName = state && state.owner_name ? state.owner_name : "";

  return {
    record_type: "alert_item",
    status: demoMode ? "seeded-demo" : "seeded",
    seed_key: buildSeedKey(fixtureName, fixture, item, index),
    seed_fixture_name: fixtureName || "",
    source_subject: fixture.source_subject || "",
    source_sender: fixture.source_sender || "",
    received_at: fixture.source_date || "",
    source_name: item.source_name || "",
    published_at: item.published_at || "",
    headline: item.headline || "",
    raw_excerpt: item.raw_excerpt || "",
    item_type: item.item_type || "news",
    processing_status: state ? state.processing_status : "queued",
    relevance_status: state ? state.relevance_status : "unreviewed",
    match_bucket: state ? state.match_bucket : "unprocessed",
    evidence_status: state ? state.evidence_status : "pending",
    selected_company_id: state ? state.selected_company_id || "" : "",
    owner_name: ownerName,
    pending_note_body:
      state && state.match_bucket === "high-confidence"
        ? buildPendingNote(item, ownerName)
        : ""
  };
}

function buildSeedRecords(fixtureName, fixture, demoMode) {
  if (!fixture || !Array.isArray(fixture.items) || !fixture.items.length) {
    throw new Error("fixture.items is required");
  }

  return fixture.items.map(function(item, index) {
    return buildSeedRecord(fixtureName, fixture, item, index, demoMode);
  });
}

function createMissingRecords(api, records) {
  var existing = listSeededAlertItemRecords(api);
  var existingBySeedKey = {};

  existing.forEach(function(record) {
    var data = recordData(record);
    if (data.seed_key) {
      existingBySeedKey[data.seed_key] = record;
    }
  });

  var toCreate = [];
  records.forEach(function(record) {
    if (!existingBySeedKey[record.seed_key]) {
      toCreate.push(record);
    }
  });

  if (!toCreate.length) {
    console.log("seed_fixture_ingest: no new records to create");
    return { createdRecords: [], skippedCount: records.length };
  }

  console.log(
    "seed_fixture_ingest: creating " +
      toCreate.length +
      " of " +
      records.length +
      " candidate records"
  );

  return {
    createdRecords: normalizeRecords(api.create(toCreate)),
    skippedCount: records.length - toCreate.length
  };
}

function filterQueue(records, status) {
  return records.filter(function(record) {
    var data = recordData(record);
    if (data.record_type && data.record_type !== "alert_item") {
      return false;
    }

    if (status === "high-confidence") {
      return data.match_bucket === "high-confidence";
    }

    if (status === "possible") {
      return data.match_bucket === "possible";
    }

    if (status === "no-match") {
      return data.match_bucket === "no-match";
    }

    if (status === "not-relevant") {
      return data.relevance_status === "not-relevant";
    }

    return true;
  });
}

function createSeedFixtureIngest(api) {
  function requireAction(jobParams) {
    if (!jobParams || !jobParams.action) {
      throw new Error("action is required");
    }

    return jobParams.action;
  }

  function seedFixture(jobParams, fixtureName, fixture, demoMode) {
    var records = buildSeedRecords(fixtureName, fixture, demoMode);
    console.log(
      "seed_fixture_ingest: action=" +
        jobParams.action +
        ", fixture=" +
        fixtureName +
        ", demoMode=" +
        String(demoMode) +
        ", itemCount=" +
        records.length
    );
    var persisted = createMissingRecords(api, records);

      return {
        fixture_name: fixtureName || "",
        created_count: persisted.createdRecords.length,
      skipped_count: persisted.skippedCount,
      total_fixture_items: records.length
    };
  }

  function assertServerOnlySeedFixture(jobParams) {
    if (jobParams.action === "seed_fixture" && api.currentUser) {
      throw new Error("seed_fixture is reserved for trusted server-side ingestion");
    }
  }

  function requireAllowedQueueStatus(status) {
    if (ALLOWED_QUEUE_STATUSES.indexOf(status) === -1) {
      throw new Error("Unsupported queue status: " + status);
    }

    return status;
  }

  function run(jobParams) {
    var action = requireAction(jobParams || {});
    console.log("seed_fixture_ingest: received action=" + action);
    assertServerOnlySeedFixture(jobParams || {});

    if (action === "seed_fixture") {
      return seedFixture(jobParams, jobParams.fixture_name || "custom", jobParams.fixture, false);
    }

    if (action === "seed_demo_fixture") {
      var fixtureName = jobParams.fixture_name || "pe_ma";
      var fixture = DEMO_FIXTURES[fixtureName];
      if (!fixture) {
        throw new Error("Unknown demo fixture: " + fixtureName);
      }

      return seedFixture(jobParams, fixtureName, fixture, true);
    }

    if (action === "list_queue") {
      var queueStatus = requireAllowedQueueStatus(jobParams.status || "high-confidence");
      var allRecords = listSeededAlertItemRecords(api);
      var filtered = filterQueue(allRecords, queueStatus).slice(0, 50);
      console.log(
        "seed_fixture_ingest: listing queue status=" +
          queueStatus +
          ", totalRecords=" +
          allRecords.length +
          ", returned=" +
          filtered.length
      );
      return {
        status: queueStatus,
        total_count: allRecords.length,
        items: filtered
      };
    }

    throw new Error("Unsupported action: " + action);
  }

  return {
    run: run,
    buildSeedRecords: buildSeedRecords,
    filterQueue: filterQueue
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    DEMO_FIXTURES: DEMO_FIXTURES,
    DEMO_QUEUE_STATES: DEMO_QUEUE_STATES,
    ALLOWED_QUEUE_STATUSES: ALLOWED_QUEUE_STATUSES,
    SEEDED_STATUSES: SEEDED_STATUSES,
    buildSeedKey: buildSeedKey,
    buildSeedRecords: buildSeedRecords,
    createSeedFixtureIngest: createSeedFixtureIngest,
    filterQueue: filterQueue
  };
}

var __seedFixtureIngestResult = null;

if (typeof VibeAppAPI !== "undefined") {
  __seedFixtureIngestResult = createSeedFixtureIngest(VibeAppAPI).run(VibeAppAPI.jobParams || {});
}

__seedFixtureIngestResult;
