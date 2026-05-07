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

function findRecordById(api, recordId) {
  var results = normalizeRecords(api.query({ id: recordId }, { limit: 1 }));
  return results.length ? results[0] : null;
}

function buildOverrideNote(data, currentUser) {
  var existing = data.pending_note_body ? String(data.pending_note_body).trim() : "";
  var addition = "Owner override by: " + (currentUser && currentUser.email ? currentUser.email : "unknown reviewer");

  if (!existing) {
    return ["Trigger: " + (data.headline || "Untitled alert"), addition].join("\n");
  }

  if (existing.indexOf(addition) >= 0) {
    return existing;
  }

  return existing + "\n" + addition;
}

function createResolveMatchOverride(api) {
  function run(jobParams) {
    if (!api.currentUser) {
      throw new Error("A signed-in user is required");
    }

    var params = jobParams || api.jobParams || {};
    if (!params.recordId || !params.companyId) {
      throw new Error("recordId and companyId are required");
    }

    var record = findRecordById(api, params.recordId);
    if (!record) {
      throw new Error("Record not found");
    }

    var data = recordData(record);
    if (data.match_bucket !== "possible" && data.match_bucket !== "no-match") {
      throw new Error("Override is only available for possible or no-match records");
    }

    var chosen = (data.match_candidates || []).find(function(candidate) {
      return String(candidate.id) === String(params.companyId);
    });

    if (!chosen) {
      throw new Error("Selected candidate was not present on the record");
    }

    var updatedData = {
      ...data,
      match_bucket: "high-confidence",
      selected_company_id: chosen.id,
      owner_name: chosen.owner_name || "",
      pending_note_body: buildOverrideNote(data, api.currentUser),
      reviewer_override_state: "applied",
      processing_status: "matched"
    };

    api.update([
      {
        id: record.id,
        data: updatedData
      }
    ]);

    return {
      success: true,
      selected_company_id: chosen.id
    };
  }

  return {
    run: run
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    buildOverrideNote: buildOverrideNote,
    createResolveMatchOverride: createResolveMatchOverride,
    findRecordById: findRecordById
  };
}

var __resolveMatchOverrideResult = null;

if (typeof VibeAppAPI !== "undefined") {
  __resolveMatchOverrideResult = createResolveMatchOverride(VibeAppAPI).run(VibeAppAPI.jobParams || {});
}

__resolveMatchOverrideResult;
