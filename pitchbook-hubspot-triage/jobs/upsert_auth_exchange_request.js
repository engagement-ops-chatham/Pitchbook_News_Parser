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

function getCurrentUserEmail(api) {
  if (!api.currentUser || !api.currentUser.email) {
    return "";
  }

  return String(api.currentUser.email).trim().toLowerCase();
}

function createUpsertAuthExchangeRequest(api) {
  function run(jobParams) {
    if (!api.currentUser) {
      throw new Error("A signed-in user is required");
    }

    var requestedByEmail = getCurrentUserEmail(api);
    if (!requestedByEmail) {
      throw new Error("The signed-in user is missing an email address");
    }

    var params = jobParams || api.jobParams || {};
    var records = normalizeRecords(
      api.query(
        {
          type: "auth_exchange_request",
          requestedByEmail: requestedByEmail
        },
        {
          limit: 1,
          order: "updated_at desc"
        }
      )
    );
    var existing = records.length ? records[0] : null;
    var nextData = Object.assign(
      {
        type: "auth_exchange_request",
        requestedByEmail: requestedByEmail
      },
      existing && existing.data ? existing.data : {},
      params
    );

    if (existing) {
      api.update([
        {
          id: existing.id,
          data: nextData
        }
      ]);

      return {
        success: true,
        operation: "updated",
        record_id: existing.id
      };
    }

    var created = api.create([nextData]);
    var createdRecord = Array.isArray(created) && created.length ? created[0] : null;

    return {
      success: true,
      operation: "created",
      record_id: createdRecord ? createdRecord.id : null
    };
  }

  return {
    run: run
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    createUpsertAuthExchangeRequest: createUpsertAuthExchangeRequest,
    getCurrentUserEmail: getCurrentUserEmail,
    normalizeRecords: normalizeRecords
  };
}

var __upsertAuthExchangeRequestResult = null;

if (typeof VibeAppAPI !== "undefined") {
  __upsertAuthExchangeRequestResult = createUpsertAuthExchangeRequest(VibeAppAPI).run(VibeAppAPI.jobParams || {});
}

__upsertAuthExchangeRequestResult;
