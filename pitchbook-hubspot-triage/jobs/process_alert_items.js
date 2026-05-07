/*
Expected behavior for process_alert_items:
- read queued alert_item records
- call TRIGGER_AI_API_URL for relevance classification
- call NEWS_RESEARCH_API_URL for one corroborating source when relevance is relevant or uncertain
- update each record with relevance_status, relevance_rationale, evidence_status, and processing_status
*/

var DEFAULT_TRIGGER_TERMS = [
  "ipo",
  "listing",
  "refinancing",
  "refinance",
  "debt financing",
  "m&a",
  "acquisition"
];
var QUEUE_BATCH_SIZE = 25;

function requireSecret(api, name) {
  var value = api.getSecret(name);
  if (!value) {
    throw new Error(name + " secret not configured");
  }

  return value;
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

function postJson(fetchImpl, url, token, payload) {
  var response = fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response || !response.ok) {
    var message = response && typeof response.text === "function" ? response.text() : "";
    throw new Error(
      "Request failed (" +
        url +
        "): " +
        String(response && response.status ? response.status : "unknown") +
        " " +
        String(response && response.statusText ? response.statusText : "") +
        (message ? " - " + message : "")
    );
  }

  if (typeof response.json === "function") {
    return response.json() || {};
  }

  return {};
}

function normalizeRelevanceStatus(value) {
  if (value === "relevant" || value === "uncertain" || value === "not-relevant") {
    return value;
  }

  return "uncertain";
}

function normalizeMatchedTerms(value) {
  if (Array.isArray(value)) {
    return value.filter(function(term) {
      return Boolean(term);
    });
  }

  if (typeof value === "string" && value) {
    return [value];
  }

  return [];
}

function buildClassificationPayload(data) {
  return {
    headline: data.headline || "",
    excerpt: data.raw_excerpt || "",
    trigger_terms: DEFAULT_TRIGGER_TERMS
  };
}

function buildEvidencePayload(data, classification) {
  return {
    headline: data.headline || "",
    excerpt: data.raw_excerpt || "",
    relevance_status: classification.relevance_status || "",
    relevance_rationale:
      classification.relevance_rationale || classification.rationale || "",
    matched_trigger_terms: normalizeMatchedTerms(
      classification.matched_trigger_terms || classification.trigger_terms
    )
  };
}

function extractCorroboratingSource(responseData) {
  if (!responseData) {
    return null;
  }

  if (Array.isArray(responseData.sources) && responseData.sources.length) {
    return responseData.sources[0];
  }

  if (responseData.source && typeof responseData.source === "object") {
    return responseData.source;
  }

  if (responseData.url || responseData.source_url) {
    return responseData;
  }

  return null;
}

function buildAnalysisUpdate(data, classification, evidenceStatus, source) {
  var relevanceStatus = normalizeRelevanceStatus(classification.relevance_status);
  var rationale = classification.relevance_rationale || classification.rationale || "";
  var matchedTerms = normalizeMatchedTerms(
    classification.matched_trigger_terms || classification.trigger_terms
  );

  return {
    ...data,
    relevance_status: relevanceStatus,
    relevance_rationale: rationale,
    evidence_status: evidenceStatus,
    processing_status: "analyzed",
    matched_trigger_terms: matchedTerms,
    corroborating_source: source
      ? {
          url: source.url || source.source_url || "",
          title: source.title || source.source_title || "",
          excerpt: source.snippet || source.summary || source.excerpt || ""
        }
      : null
  };
}

function buildFailureUpdate(data, error) {
  return {
    ...data,
    processing_status: "analysis-failed",
    evidence_status: "skipped",
    relevance_rationale: "Analysis failed: " + error.message
  };
}

function incrementCount(summary, key) {
  summary[key] = (summary[key] || 0) + 1;
}

function createProcessAlertItems(api, runtime) {
  var fetchImpl = runtime && runtime.fetch ? runtime.fetch : fetch;

  function listQueuedRecords() {
    return normalizeRecords(
      api.query(
        { record_type: "alert_item", processing_status: "queued" },
        { limit: QUEUE_BATCH_SIZE, order: "created_at asc" }
      )
    );
  }

  function run() {
    var triggerApiUrl = requireSecret(api, "TRIGGER_AI_API_URL");
    var triggerApiToken = requireSecret(api, "TRIGGER_AI_API_TOKEN");
    var researchApiUrl = requireSecret(api, "NEWS_RESEARCH_API_URL");
    var researchApiToken = requireSecret(api, "NEWS_RESEARCH_API_TOKEN");
    var summary = {
      processed_count: 0,
      failed_count: 0,
      relevant_count: 0,
      uncertain_count: 0,
      not_relevant_count: 0,
      corroborated_count: 0,
      not_found_count: 0,
      skipped_count: 0,
      research_failed_count: 0
    };
    var queue = listQueuedRecords();

    while (queue.length) {
      var updates = [];
      console.log("process_alert_items: queued records in batch=" + queue.length);

      queue.forEach(function(record) {
        var data = recordData(record);

        try {
          console.log(
            "process_alert_items: classifying record " +
              String(record.id || "") +
              " headline=" +
              (data.headline || "")
          );
          var classification = postJson(
            fetchImpl,
            triggerApiUrl,
            triggerApiToken,
            buildClassificationPayload(data)
          );
          var relevanceStatus = normalizeRelevanceStatus(classification.relevance_status);
          var evidenceStatus = "skipped";
          var source = null;

          if (relevanceStatus === "relevant" || relevanceStatus === "uncertain") {
            try {
              console.log(
                "process_alert_items: researching corroboration for record " +
                  String(record.id || "")
              );
              var evidence = postJson(
                fetchImpl,
                researchApiUrl,
                researchApiToken,
                buildEvidencePayload(data, classification)
              );
              source = extractCorroboratingSource(evidence);
              evidenceStatus = source ? "corroborated" : "not-found";
            } catch (evidenceError) {
              console.error(
                "process_alert_items: research failed for record " +
                  String(record.id || "") +
                  " error=" +
                  evidenceError.message
              );
              evidenceStatus = "research-failed";
            }
          }

          var updatedData = buildAnalysisUpdate(data, classification, evidenceStatus, source);
          updates.push({
            id: record.id,
            data: updatedData
          });
          incrementCount(summary, "processed_count");

          if (updatedData.relevance_status === "relevant") {
            incrementCount(summary, "relevant_count");
          } else if (updatedData.relevance_status === "uncertain") {
            incrementCount(summary, "uncertain_count");
          } else {
            incrementCount(summary, "not_relevant_count");
          }

          if (updatedData.evidence_status === "corroborated") {
            incrementCount(summary, "corroborated_count");
          } else if (updatedData.evidence_status === "not-found") {
            incrementCount(summary, "not_found_count");
          } else if (updatedData.evidence_status === "research-failed") {
            incrementCount(summary, "research_failed_count");
          } else {
            incrementCount(summary, "skipped_count");
          }
        } catch (error) {
          console.error(
            "process_alert_items: failed record " +
              String(record.id || "") +
              " error=" +
              error.message
          );
          updates.push({
            id: record.id,
            data: buildFailureUpdate(data, error)
          });
          incrementCount(summary, "processed_count");
          incrementCount(summary, "failed_count");
        }
      });

      if (updates.length) {
        api.update(updates);
      }

      queue = listQueuedRecords();
    }

    console.log("process_alert_items: summary=" + JSON.stringify(summary));
    return summary;
  }

  return {
    run: run
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    DEFAULT_TRIGGER_TERMS: DEFAULT_TRIGGER_TERMS,
    QUEUE_BATCH_SIZE: QUEUE_BATCH_SIZE,
    buildAnalysisUpdate: buildAnalysisUpdate,
    buildClassificationPayload: buildClassificationPayload,
    buildEvidencePayload: buildEvidencePayload,
    createProcessAlertItems: createProcessAlertItems,
    extractCorroboratingSource: extractCorroboratingSource,
    normalizeMatchedTerms: normalizeMatchedTerms,
    normalizeRelevanceStatus: normalizeRelevanceStatus,
    postJson: postJson,
    requireSecret: requireSecret
  };
}

var __processAlertItemsResult = null;

if (typeof VibeAppAPI !== "undefined") {
  __processAlertItemsResult = createProcessAlertItems(VibeAppAPI, { fetch: fetch }).run();
}

__processAlertItemsResult;
