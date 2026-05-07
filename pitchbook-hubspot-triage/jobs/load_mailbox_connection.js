function getSingleton(type) {
  var response = VibeAppAPI.query({ type: type }, {
    limit: 1,
    order: "updated_at desc"
  });
  var records = response && response.records ? response.records : [];
  return records.length ? records[0] : null;
}

function sanitizeAuthConnection(data) {
  if (!data) {
    return {
      status: "not_connected",
      connected: false,
      grantedScopes: [],
      proofMessages: []
    };
  }

  return {
    status: data.status || "not_connected",
    connected: !!data.connected,
    grantedScopes: Array.isArray(data.grantedScopes) ? data.grantedScopes : [],
    user: data.user || null,
    accessTokenExpiresAt: data.accessTokenExpiresAt || "",
    lastAuthAt: data.lastAuthAt || "",
    lastRefreshError: data.lastRefreshError || "",
    proofMessages: Array.isArray(data.proofMessages) ? data.proofMessages : []
  };
}

var authConnectionRecord = getSingleton("auth_connection");
var mailboxIngestStateRecord = getSingleton("mailbox_ingest_state");

return {
  authConnection: sanitizeAuthConnection(authConnectionRecord ? authConnectionRecord.data : null),
  mailboxIngestState: mailboxIngestStateRecord ? mailboxIngestStateRecord.data : null
};
