var MAILBOX_INGEST_SOURCE = "pitchbook";
var LOOKBACK_HOURS = 24;
var PITCHBOOK_SENDER = "alerts-noreply@alerts.pitchbook.com";
var ITEM_SPLIT_RE = /\n\s*([^\n|]+)\s*\|\s*([^\n|]+)\s*\|\s*(\d{1,2}-[A-Za-z]{3}-\d{4})\s*\n/g;
var TRANSPORT_BLOB_RE = /\s*<https?:\/\/[^>]+>/g;

function requireSecret(api, name) {
  var value = api.getSecret(name);
  if (!value) {
    throw new Error(name + " secret not configured");
  }

  return value;
}

function getOptionalSecret(api, name) {
  if (!api || !api.getSecret) {
    return "";
  }

  return api.getSecret(name) || "";
}

function safeParseJson(text) {
  try {
    return JSON.parse(text || "{}");
  } catch (_error) {
    return {};
  }
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\u200a/g, "")
    .replace(/\u200d/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMultilineText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\u200a/g, "")
    .replace(/\u200d/g, "")
    .trim();
}

function stripTransportBlobs(text) {
  return normalizeMultilineText(String(text || "").replace(TRANSPORT_BLOB_RE, ""));
}

function formEncode(data) {
  var pairs = [];
  var keys = Object.keys(data || {});
  for (var i = 0; i < keys.length; i += 1) {
    var key = keys[i];
    var value = data[key];
    if (value === null || typeof value === "undefined" || value === "") continue;
    pairs.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
  }
  return pairs.join("&");
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

function getSingleton(api, type) {
  var records = normalizeRecords(
    api.query({ type: type }, { limit: 1, offset: 0, order: "updated_at desc" })
  );
  return records.length ? records[0] : null;
}

function upsertSingleton(api, type, data) {
  var existing = getSingleton(api, type);
  if (existing && existing.id && api.update) {
    api.update([{ id: existing.id, data: data }]);
    return existing.id;
  }

  if (api.create) {
    var created = normalizeRecords(api.create([data]));
    return created.length && created[0].id ? created[0].id : null;
  }

  return null;
}

function buildMailboxState(summary, errorMessage, missingSecrets, authStatus) {
  return {
    type: "mailbox_ingest_state",
    lastSuccessAt: errorMessage ? "" : new Date().toISOString(),
    lastSummary: summary || null,
    lastError: errorMessage || "",
    missingSecrets: missingSecrets || [],
    authStatus: authStatus || "not_connected"
  };
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

function normalizeItemLines(chunk) {
  var lines = [];
  String(chunk || "").split("\n").forEach(function(rawLine) {
    var line = stripTransportBlobs(rawLine);
    if (line) {
      lines.push(line);
    }
  });
  return lines;
}

function extractPitchBookItemsFromBody(bodyText, subject) {
  var body = normalizeMultilineText(bodyText);
  var segments = ("\n" + body + "\n").split(ITEM_SPLIT_RE);
  var items = [];

  if (segments.length >= 5) {
    for (var index = 1; index < segments.length; index += 4) {
      if (index + 3 >= segments.length) {
        break;
      }

      var sourceName = normalizeText(segments[index]);
      var publishedTime = normalizeText(segments[index + 1]);
      var publishedDate = normalizeText(segments[index + 2]);
      var chunk = normalizeMultilineText(segments[index + 3]);
      var lines = normalizeItemLines(chunk);
      var headline = lines.length ? normalizeText(lines[0]) : "";

      if (!headline) {
        continue;
      }

      items.push({
        item_type: "news",
        headline: headline,
        source_name: sourceName,
        published_at: normalizeText((publishedDate + " " + publishedTime).trim()),
        raw_excerpt: lines.slice(0, 6).join("\n")
      });
    }
  }

  if (items.length) {
    return items;
  }

  var fallbackLines = normalizeItemLines(body).filter(function(line) {
    return !/^pitchbook\b/i.test(line) && !/^view all\b/i.test(line) && !/^alerts from your\b/i.test(line);
  });
  var fallbackHeadline = fallbackLines.length ? fallbackLines[0] : normalizeText(subject || "PitchBook Alert");
  var fallbackExcerpt = fallbackLines.slice(0, 6).join("\n") || normalizeText(subject || "");

  if (!fallbackHeadline) {
    return [];
  }

  return [
    {
      item_type: "news",
      headline: fallbackHeadline,
      source_name: "PitchBook Alert",
      published_at: "",
      raw_excerpt: fallbackExcerpt
    }
  ];
}

function normalizeMessageItems(message) {
  if (!message || !Array.isArray(message.items)) {
    return [];
  }

  return message.items;
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

function refreshAccessToken(authData, tenantId, clientId, clientSecret, dependencies) {
  if (!authData || !authData.refreshToken) {
    throw new Error("No stored Microsoft refresh token. Connect Microsoft 365 first.");
  }

  var fetchImpl = dependencies && dependencies.fetch ? dependencies.fetch : fetch;
  var response = fetchImpl("https://login.microsoftonline.com/" + tenantId + "/oauth2/v2.0/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: formEncode({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: authData.refreshToken
    })
  });

  var responseText = typeof response.text === "function" ? response.text() : "";
  if (!response.ok) {
    throw new Error("Token refresh failed (" + response.status + "): " + responseText);
  }

  return safeParseJson(responseText);
}

function fetchGraphJson(url, accessToken, dependencies, extraHeaders) {
  var fetchImpl = dependencies && dependencies.fetch ? dependencies.fetch : fetch;
  var headers = {
    Authorization: "Bearer " + accessToken
  };
  var extra = extraHeaders || {};
  var keys = Object.keys(extra);
  for (var i = 0; i < keys.length; i += 1) {
    headers[keys[i]] = extra[keys[i]];
  }

  var response = fetchImpl(url, {
    headers: headers
  });
  var responseText = typeof response.text === "function" ? response.text() : "";

  if (!response.ok) {
    throw new Error("Graph mailbox fetch failed (" + response.status + "): " + responseText);
  }

  return safeParseJson(responseText);
}

function fetchPitchBookMessages(accessToken, lookbackHours, dependencies) {
  var receivedAfter = new Date(Date.now() - (Number(lookbackHours || LOOKBACK_HOURS) * 3600000)).toISOString();
  var filter =
    "receivedDateTime ge " +
    receivedAfter +
    " and from/emailAddress/address eq '" +
    PITCHBOOK_SENDER +
    "'";
  var url =
    "https://graph.microsoft.com/v1.0/me/messages" +
    "?$top=25" +
    "&$orderby=receivedDateTime%20desc" +
    "&$select=id,subject,receivedDateTime,from,body" +
    "&$filter=" +
    encodeURIComponent(filter);

  var payload = fetchGraphJson(url, accessToken, dependencies, {
    Prefer: 'outlook.body-content-type="text"'
  });

  return Array.isArray(payload.value) ? payload.value : [];
}

function normalizeGraphMessages(messages) {
  return (messages || []).map(function(message) {
    var subject = String(message.subject || "");
    var sender =
      message && message.from && message.from.emailAddress
        ? message.from.emailAddress.name || message.from.emailAddress.address || ""
        : "";
    var bodyText = message && message.body ? String(message.body.content || "") : "";
    var items = extractPitchBookItemsFromBody(bodyText, subject);

    return {
      source_subject: subject,
      source_sender: sender,
      source_date: String(message.receivedDateTime || ""),
      items: items
    };
  });
}

function importMessages(api, messages) {
  var importedItemCount = 0;
  var existingMailboxKeys = listExistingMailboxKeys(api);

  (messages || []).forEach(function(message) {
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
    imported_message_count: Array.isArray(messages) ? messages.length : 0,
    imported_item_count: importedItemCount
  };
}

function sanitizeAuthConnection(data) {
  return {
    status: data && data.status ? data.status : "not_connected",
    connected: !!(data && data.connected),
    grantedScopes: data && Array.isArray(data.grantedScopes) ? data.grantedScopes : [],
    user: data && data.user ? data.user : null,
    accessTokenExpiresAt: data && data.accessTokenExpiresAt ? data.accessTokenExpiresAt : "",
    lastAuthAt: data && data.lastAuthAt ? data.lastAuthAt : "",
    lastRefreshError: data && data.lastRefreshError ? data.lastRefreshError : "",
    proofMessages: data && Array.isArray(data.proofMessages) ? data.proofMessages : []
  };
}

function runGraphMailboxIngest(api, dependencies) {
  var tenantId = requireSecret(api, "ENTRA_TENANT_ID");
  var clientId = requireSecret(api, "ENTRA_CLIENT_ID");
  var clientSecret = requireSecret(api, "ENTRA_CLIENT_SECRET");
  var authRecord = getSingleton(api, "auth_connection");
  var authData = authRecord ? recordData(authRecord) : null;

  if (!authData || !authData.refreshToken) {
    throw new Error("No Microsoft 365 connection is stored.");
  }

  var refreshedToken = refreshAccessToken(authData, tenantId, clientId, clientSecret, dependencies);
  var accessToken = String(refreshedToken.access_token || "");
  if (!accessToken) {
    throw new Error("Token refresh did not return an access token.");
  }

  var updatedAuth = Object.assign({}, authData, {
    type: "auth_connection",
    status: "connected",
    connected: true,
    accessToken: accessToken,
    refreshToken: String(refreshedToken.refresh_token || authData.refreshToken || ""),
    accessTokenExpiresAt: new Date(Date.now() + (Number(refreshedToken.expires_in || 0) * 1000)).toISOString(),
    grantedScopes: String(refreshedToken.scope || "").split(/\s+/).filter(function(item) {
      return !!item;
    }),
    lastRefreshAt: new Date().toISOString(),
    lastRefreshError: ""
  });
  upsertSingleton(api, "auth_connection", updatedAuth);

  var graphMessages = fetchPitchBookMessages(accessToken, LOOKBACK_HOURS, dependencies);
  var normalizedMessages = normalizeGraphMessages(graphMessages);
  return importMessages(api, normalizedMessages);
}

function runAdapterMailboxIngest(api, dependencies) {
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
  return importMessages(api, messages);
}

function hasGraphMailboxConfiguration(api) {
  return Boolean(
    getOptionalSecret(api, "ENTRA_TENANT_ID") &&
      getOptionalSecret(api, "ENTRA_CLIENT_ID") &&
      getOptionalSecret(api, "ENTRA_CLIENT_SECRET")
  );
}

function createIngestPitchbookEmails(api, dependencies) {
  function run() {
    var result;

    try {
      result = hasGraphMailboxConfiguration(api)
        ? runGraphMailboxIngest(api, dependencies)
        : runAdapterMailboxIngest(api, dependencies);

      upsertSingleton(
        api,
        "mailbox_ingest_state",
        buildMailboxState(result, "", [], hasGraphMailboxConfiguration(api) ? "connected" : "adapter")
      );
      return result;
    } catch (error) {
      var errorMessage = error && error.message ? error.message : String(error);
      var authRecord = getSingleton(api, "auth_connection");
      var authData = authRecord ? recordData(authRecord) : null;

      if (/invalid_grant|interaction_required|consent_required|refresh token/i.test(errorMessage) && authData) {
        upsertSingleton(
          api,
          "auth_connection",
          Object.assign({}, authData, {
            type: "auth_connection",
            status: "reauth_required",
            connected: false,
            lastRefreshError: errorMessage
          })
        );
      }

      upsertSingleton(
        api,
        "mailbox_ingest_state",
        buildMailboxState(null, errorMessage, [], authData ? sanitizeAuthConnection(authData).status : "not_connected")
      );
      throw error;
    }
  }

  return {
    run: run
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    LOOKBACK_HOURS: LOOKBACK_HOURS,
    MAILBOX_INGEST_SOURCE: MAILBOX_INGEST_SOURCE,
    PITCHBOOK_SENDER: PITCHBOOK_SENDER,
    buildAlertRecord: buildAlertRecord,
    buildMailboxItemKey: buildMailboxItemKey,
    createIngestPitchbookEmails: createIngestPitchbookEmails,
    extractPitchBookItemsFromBody: extractPitchBookItemsFromBody,
    hasGraphMailboxConfiguration: hasGraphMailboxConfiguration,
    importMessages: importMessages,
    listExistingMailboxKeys: listExistingMailboxKeys,
    normalizeGraphMessages: normalizeGraphMessages,
    normalizeMessageItems: normalizeMessageItems,
    normalizeRecords: normalizeRecords,
    postJson: postJson,
    recordData: recordData,
    refreshAccessToken: refreshAccessToken,
    requireSecret: requireSecret,
    runAdapterMailboxIngest: runAdapterMailboxIngest,
    runGraphMailboxIngest: runGraphMailboxIngest,
    safeParseJson: safeParseJson,
    sanitizeAuthConnection: sanitizeAuthConnection
  };
}

var __ingestPitchbookEmailsResult = null;

if (typeof VibeAppAPI !== "undefined") {
  __ingestPitchbookEmailsResult = createIngestPitchbookEmails(VibeAppAPI).run();
}

__ingestPitchbookEmailsResult;
