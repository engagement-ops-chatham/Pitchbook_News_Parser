var MAILBOX_INGEST_SOURCE = "pitchbook";
var LOOKBACK_HOURS = 24;

function requireSecret(api, name) {
  var value = api.getSecret(name);
  if (!value) {
    throw new Error(name + " secret not configured");
  }

  return value;
}

function postJson(url, token, payload, dependencies) {
  var fetchImpl = dependencies && dependencies.fetch ? dependencies.fetch : fetch;
  var response = fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    var details = "";
    if (typeof response.text === "function") {
      details = response.text() || "";
    }

    throw new Error(
      "Mailbox adapter failed: " +
        String(response.status || "") +
        " " +
        String(response.statusText || "Request Failed") +
        (details ? " - " + details : "")
    );
  }

  return typeof response.json === "function" ? response.json() : {};
}

function normalizeMessageItems(message) {
  if (!message || !Array.isArray(message.items)) {
    return [];
  }

  return message.items;
}

function buildMailboxItemKey(message, item) {
  return [
    message && message.source_subject ? message.source_subject : "",
    message && message.source_sender ? message.source_sender : "",
    message && message.source_date ? message.source_date : "",
    item && item.item_type ? item.item_type : "news",
    item && item.source_name ? item.source_name : "",
    item && item.published_at ? item.published_at : "",
    item && item.headline ? item.headline : "",
    item && item.raw_excerpt ? item.raw_excerpt : ""
  ]
    .map(function(part) {
      return String(part || "")
        .trim()
        .toLowerCase();
    })
    .join("::");
}

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
    var page = normalizeRecords(
      api.query(filters || {}, { limit: pageSize, offset: offset, order: "created_at desc" })
    );

    if (!page.length) {
      break;
    }

    allRecords = allRecords.concat(page);

    if (page.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return allRecords;
}

function listExistingMailboxKeys(api) {
  var keys = {};

  listRecords(api, { record_type: "alert_item", status: "ingested-mailbox" }).forEach(function(record) {
    var data = recordData(record);
    if (data.mailbox_item_key) {
      keys[data.mailbox_item_key] = true;
    }
  });

  return keys;
}

function buildAlertRecord(message, item) {
  return {
    record_type: "alert_item",
    status: "ingested-mailbox",
    mailbox_item_key: buildMailboxItemKey(message, item),
    source_subject: message && message.source_subject ? message.source_subject : "",
    source_sender: message && message.source_sender ? message.source_sender : "",
    received_at: message && message.source_date ? message.source_date : "",
    source_name: item && item.source_name ? item.source_name : "",
    published_at: item && item.published_at ? item.published_at : "",
    headline: item && item.headline ? item.headline : "",
    raw_excerpt: item && item.raw_excerpt ? item.raw_excerpt : "",
    item_type: item && item.item_type ? item.item_type : "news",
    processing_status: "queued",
    relevance_status: "unreviewed",
    match_bucket: "unprocessed",
    evidence_status: "pending",
    pending_note_body: "",
    owner_name: "",
    selected_company_id: ""
  };
}

function createIngestPitchbookEmails(api, dependencies) {
  function run() {
    var mailboxUrl = requireSecret(api, "MAILBOX_SYNC_API_URL");
    var mailboxToken = requireSecret(api, "MAILBOX_SYNC_API_TOKEN");
    var payload = postJson(
      mailboxUrl,
      mailboxToken,
      {
        source: MAILBOX_INGEST_SOURCE,
        lookback_hours: LOOKBACK_HOURS
      },
      dependencies || {}
    );

    var messages = payload && Array.isArray(payload.items) ? payload.items : [];
    var importedItemCount = 0;
    var existingMailboxKeys = listExistingMailboxKeys(api);

    messages.forEach(function(message) {
      var items = normalizeMessageItems(message);
      if (!items.length) {
        return;
      }

      var recordsToCreate = items
        .map(function(item) {
          return buildAlertRecord(message, item);
        })
        .filter(function(record) {
          if (existingMailboxKeys[record.mailbox_item_key]) {
            return false;
          }

          existingMailboxKeys[record.mailbox_item_key] = true;
          return true;
        });

      if (!recordsToCreate.length) {
        return;
      }

      importedItemCount += recordsToCreate.length;
      api.create(recordsToCreate);
    });

    return {
      imported_message_count: messages.length,
      imported_item_count: importedItemCount
    };
  }

  return {
    run: run
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    LOOKBACK_HOURS: LOOKBACK_HOURS,
    MAILBOX_INGEST_SOURCE: MAILBOX_INGEST_SOURCE,
    buildAlertRecord: buildAlertRecord,
    buildMailboxItemKey: buildMailboxItemKey,
    createIngestPitchbookEmails: createIngestPitchbookEmails,
    listExistingMailboxKeys: listExistingMailboxKeys,
    normalizeMessageItems: normalizeMessageItems,
    normalizeRecords: normalizeRecords,
    postJson: postJson,
    recordData: recordData,
    requireSecret: requireSecret
  };
}

var __ingestPitchbookEmailsResult = null;

if (typeof VibeAppAPI !== "undefined") {
  __ingestPitchbookEmailsResult = createIngestPitchbookEmails(VibeAppAPI).run();
}

__ingestPitchbookEmailsResult;
