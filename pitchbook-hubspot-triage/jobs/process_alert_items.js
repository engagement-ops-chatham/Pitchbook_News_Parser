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
var HUBSPOT_COMPANY_CONNECTOR = "customer_relationship_management_hubspot";
var HUBSPOT_COMPANY_SEARCH_URL = "https://api.hubapi.com/crm/v3/objects/companies/search";
var HUBSPOT_COMPANY_PROPERTIES = ["name", "ultimate_parent_name", "hubspot_owner_id", "client_status"];

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

function normalizeHubSpotCandidate(rawCandidate) {
  var candidate = rawCandidate || {};
  var properties = candidate.properties || {};

  return {
    id: String(candidate.id || properties.id || ""),
    name: properties.name || candidate.name || "",
    ultimate_parent:
      properties.ultimate_parent_name ||
      properties.ultimate_parent ||
      candidate.ultimate_parent ||
      "",
    owner_name:
      properties.hubspot_owner_name ||
      properties.owner_name ||
      candidate.owner_name ||
      properties.hubspot_owner_id ||
      "",
    client_status: properties.client_status || candidate.client_status || ""
  };
}

function normalizeHubSpotCandidates(result) {
  var source = result || {};
  var data = source.data || source;
  var rows = Array.isArray(data.results) ? data.results : Array.isArray(data.companies) ? data.companies : [];

  return rows
    .map(normalizeHubSpotCandidate)
    .filter(function(candidate) {
      return candidate.id && candidate.name;
    });
}

function queryHubSpotCompaniesViaConnector(api, name) {
  if (!api.queryConnector) {
    throw new Error("HubSpot connector access is not available");
  }

  var result = api.queryConnector({
    connector: HUBSPOT_COMPANY_CONNECTOR,
    endpoint: "/crm/v3/objects/companies/search",
    method: "POST",
    body: {
      query: name,
      limit: 5,
      properties: HUBSPOT_COMPANY_PROPERTIES
    }
  });

  if (result && typeof result.status === "number" && result.status >= 400) {
    throw new Error("HubSpot company query failed with status " + result.status);
  }

  return normalizeHubSpotCandidates(result);
}

function queryHubSpotCompaniesDirect(api, fetchImpl, name) {
  var token = getOptionalSecret(api, "HUBSPOT_PRIVATE_APP_TOKEN");
  if (!token) {
    throw new Error("HubSpot direct API token is not configured");
  }

  var result = postJson(fetchImpl, HUBSPOT_COMPANY_SEARCH_URL, token, {
    query: name,
    limit: 5,
    properties: HUBSPOT_COMPANY_PROPERTIES
  });

  return normalizeHubSpotCandidates(result);
}

function queryHubSpotCompanies(api, fetchImpl, name) {
  var connectorError = null;

  try {
    return queryHubSpotCompaniesViaConnector(api, name);
  } catch (error) {
    connectorError = error;
  }

  if (getOptionalSecret(api, "HUBSPOT_PRIVATE_APP_TOKEN")) {
    return queryHubSpotCompaniesDirect(api, fetchImpl, name);
  }

  throw connectorError || new Error("HubSpot company lookup is not available");
}

function buildMatchValidationPayload(data, classification, candidates) {
  return {
    mode: "match_validation",
    headline: data.headline || "",
    excerpt: data.raw_excerpt || "",
    company_name: classification.company_name || data.company_name || data.headline || "",
    relevance_status: classification.relevance_status || "",
    relevance_rationale: classification.relevance_rationale || classification.rationale || "",
    matched_trigger_terms: normalizeMatchedTerms(
      classification.matched_trigger_terms || classification.trigger_terms
    ),
    candidates: candidates
  };
}

function normalizeReviewCandidates(reviewCandidates, fallbackCandidates) {
  if (!Array.isArray(reviewCandidates) || !reviewCandidates.length) {
    return fallbackCandidates;
  }

  var fallbackById = {};
  fallbackCandidates.forEach(function(candidate) {
    fallbackById[String(candidate.id)] = candidate;
  });

  return reviewCandidates
    .map(function(candidate) {
      var normalized = normalizeHubSpotCandidate(candidate);
      var existing = fallbackById[String(normalized.id)];
      return {
        id: normalized.id || (existing ? existing.id : ""),
        name: normalized.name || (existing ? existing.name : ""),
        ultimate_parent: normalized.ultimate_parent || (existing ? existing.ultimate_parent : ""),
        owner_name: normalized.owner_name || (existing ? existing.owner_name : ""),
        client_status: normalized.client_status || (existing ? existing.client_status : "")
      };
    })
    .filter(function(candidate) {
      return candidate.id && candidate.name;
    });
}

function resolveSelectedCandidate(review, candidates) {
  if (!review) {
    return null;
  }

  var selected = review.selected_candidate || null;
  var selectedId =
    selected && typeof selected === "object"
      ? String(selected.id || "")
      : review.selected_candidate_id
        ? String(review.selected_candidate_id)
        : selected
          ? String(selected)
          : "";

  if (!selectedId) {
    return null;
  }

  return (
    candidates.find(function(candidate) {
      return String(candidate.id) === selectedId;
    }) || null
  );
}

function assignMatchBucket(review, candidates) {
  if (review && review.match_bucket === "high-confidence" && resolveSelectedCandidate(review, candidates)) {
    return "high-confidence";
  }

  if (review && review.match_bucket === "possible") {
    return "possible";
  }

  if (!candidates.length) {
    return "no-match";
  }

  return "possible";
}

function buildPendingNote(data, classification, evidenceStatus, source, selectedCandidate, reviewerEmail) {
  var lines = [
    "Trigger: " + (data.headline || "Untitled alert"),
    "Why it matters: " + (classification.relevance_rationale || classification.rationale || "Relevant service trigger"),
    "Evidence: " + evidenceStatus
  ];

  if (source && source.title) {
    lines.push("Source: " + source.title + (source.url ? " (" + source.url + ")" : ""));
  }

  if (selectedCandidate && selectedCandidate.owner_name) {
    lines.push("Owner: " + selectedCandidate.owner_name);
  }

  if (reviewerEmail) {
    lines.push("Override applied by: " + reviewerEmail);
  }

  return lines.join("\n");
}

function buildMatchedUpdate(data, classification, evidenceStatus, source, candidates, review) {
  var reviewedCandidates = normalizeReviewCandidates(review && review.candidates, candidates);
  var selectedCandidate = resolveSelectedCandidate(review, reviewedCandidates);
  var matchBucket = assignMatchBucket(review, reviewedCandidates);
  var pendingNote =
    matchBucket === "high-confidence" && selectedCandidate
      ? buildPendingNote(data, classification, evidenceStatus, source, selectedCandidate, "")
      : "";

  return {
    ...buildAnalysisUpdate(data, classification, evidenceStatus, source),
    processing_status: "matched",
    match_bucket: matchBucket,
    match_candidates: reviewedCandidates,
    selected_company_id: selectedCandidate ? selectedCandidate.id : "",
    owner_name: selectedCandidate ? selectedCandidate.owner_name || "" : "",
    pending_note_body: pendingNote
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

function buildMatchFailureUpdate(data, classification, evidenceStatus, source, error) {
  return {
    ...buildAnalysisUpdate(data, classification, evidenceStatus, source),
    processing_status: "match-failed",
    match_bucket: "unprocessed",
    match_rationale: "HubSpot matching failed: " + error.message,
    match_candidates: data.match_candidates || [],
    selected_company_id: data.selected_company_id || "",
    owner_name: data.owner_name || "",
    pending_note_body: data.pending_note_body || ""
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
      research_failed_count: 0,
      high_confidence_count: 0,
      possible_count: 0,
      no_match_count: 0,
      match_failed_count: 0
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

          if (relevanceStatus === "relevant") {
            try {
              var companyName = classification.company_name || data.company_name || data.headline || "";
              var candidates = queryHubSpotCompanies(api, fetchImpl, companyName);
              var review = null;

              if (candidates.length) {
                review = postJson(
                  fetchImpl,
                  triggerApiUrl,
                  triggerApiToken,
                  buildMatchValidationPayload(data, classification, candidates)
                );
              }

              updatedData = buildMatchedUpdate(data, classification, evidenceStatus, source, candidates, review);
            } catch (matchError) {
              console.error(
                "process_alert_items: match failed for record " +
                  String(record.id || "") +
                  " error=" +
                  matchError.message
              );
              updatedData = buildMatchFailureUpdate(data, classification, evidenceStatus, source, matchError);
              incrementCount(summary, "match_failed_count");
            }
          }

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

          if (updatedData.processing_status === "matched") {
            if (updatedData.match_bucket === "high-confidence") {
              incrementCount(summary, "high_confidence_count");
            } else if (updatedData.match_bucket === "possible") {
              incrementCount(summary, "possible_count");
            } else if (updatedData.match_bucket === "no-match") {
              incrementCount(summary, "no_match_count");
            }
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
    HUBSPOT_COMPANY_CONNECTOR: HUBSPOT_COMPANY_CONNECTOR,
    HUBSPOT_COMPANY_PROPERTIES: HUBSPOT_COMPANY_PROPERTIES,
    HUBSPOT_COMPANY_SEARCH_URL: HUBSPOT_COMPANY_SEARCH_URL,
    QUEUE_BATCH_SIZE: QUEUE_BATCH_SIZE,
    assignMatchBucket: assignMatchBucket,
    buildAnalysisUpdate: buildAnalysisUpdate,
    buildClassificationPayload: buildClassificationPayload,
    buildEvidencePayload: buildEvidencePayload,
    buildFailureUpdate: buildFailureUpdate,
    buildMatchedUpdate: buildMatchedUpdate,
    buildMatchFailureUpdate: buildMatchFailureUpdate,
    buildMatchValidationPayload: buildMatchValidationPayload,
    buildPendingNote: buildPendingNote,
    createProcessAlertItems: createProcessAlertItems,
    extractCorroboratingSource: extractCorroboratingSource,
    getOptionalSecret: getOptionalSecret,
    normalizeHubSpotCandidate: normalizeHubSpotCandidate,
    normalizeHubSpotCandidates: normalizeHubSpotCandidates,
    normalizeMatchedTerms: normalizeMatchedTerms,
    normalizeRelevanceStatus: normalizeRelevanceStatus,
    normalizeReviewCandidates: normalizeReviewCandidates,
    postJson: postJson,
    queryHubSpotCompaniesDirect: queryHubSpotCompaniesDirect,
    queryHubSpotCompaniesViaConnector: queryHubSpotCompaniesViaConnector,
    queryHubSpotCompanies: queryHubSpotCompanies,
    recordData: recordData,
    requireSecret: requireSecret,
    resolveSelectedCandidate: resolveSelectedCandidate
  };
}

var __processAlertItemsResult = null;

if (typeof VibeAppAPI !== "undefined") {
  __processAlertItemsResult = createProcessAlertItems(VibeAppAPI, { fetch: fetch }).run();
}

__processAlertItemsResult;
