function isObject(value) {
  return !!value && typeof value === "object";
}

function getPayload() {
  var candidates = [];
  if (typeof input !== "undefined" && isObject(input)) candidates.push(input);
  if (typeof params !== "undefined" && isObject(params)) candidates.push(params);
  if (typeof event !== "undefined" && isObject(event)) candidates.push(event);
  if (typeof jobInput !== "undefined" && isObject(jobInput)) candidates.push(jobInput);

  var merged = {};
  for (var i = 0; i < candidates.length; i += 1) {
    var source = candidates[i];
    var keys = Object.keys(source || {});
    for (var j = 0; j < keys.length; j += 1) {
      merged[keys[j]] = source[keys[j]];
    }
  }

  return merged;
}

function getSecretValue(name) {
  var value = VibeAppAPI.getSecret(name);
  return value ? String(value) : "";
}

function safeParseJson(text) {
  try {
    return JSON.parse(text || "{}");
  } catch (_err) {
    return {};
  }
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

function getSingleton(type) {
  var response = VibeAppAPI.query({ type: type }, {
    limit: 1,
    order: "updated_at desc"
  });
  var records = response && response.records ? response.records : [];
  return records.length ? records[0] : null;
}

function upsertSingleton(type, data) {
  var existing = getSingleton(type);
  if (existing) {
    VibeAppAPI.update([{ id: existing.id, data: data }]);
    return existing.id;
  }
  var created = VibeAppAPI.create([data]);
  return created && created.length ? created[0].id : null;
}

function isoAfterSeconds(seconds) {
  return new Date(Date.now() + (Number(seconds || 0) * 1000)).toISOString();
}

function sanitizeAuthConnection(data) {
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

var payload = getPayload();
var code = String(payload.code || "").trim();
var redirectUri = String(payload.redirectUri || getSecretValue("ENTRA_REDIRECT_URI") || "").trim();
var tenantId = getSecretValue("ENTRA_TENANT_ID");
var clientId = getSecretValue("ENTRA_CLIENT_ID");
var clientSecret = getSecretValue("ENTRA_CLIENT_SECRET");

if (!code) {
  throw new Error("Authorization code is required.");
}
if (!redirectUri) throw new Error("Redirect URI is required.");
if (!tenantId || !clientId || !clientSecret) {
  throw new Error("ENTRA_TENANT_ID, ENTRA_CLIENT_ID, and ENTRA_CLIENT_SECRET must be configured.");
}
if (payload.expectedState && payload.state && payload.expectedState !== payload.state) {
  throw new Error("State mismatch. Please try Microsoft sign-in again.");
}

var tokenResponse = fetch("https://login.microsoftonline.com/" + tenantId + "/oauth2/v2.0/token", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded"
  },
  body: formEncode({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code: code,
    redirect_uri: redirectUri,
    code_verifier: payload.codeVerifier || ""
  })
});

var tokenText = tokenResponse.text();
if (!tokenResponse.ok) {
  throw new Error("Token exchange failed (" + tokenResponse.status + "): " + tokenText);
}

var tokenData = safeParseJson(tokenText);
var accessToken = String(tokenData.access_token || "");
if (!accessToken) throw new Error("Microsoft did not return an access token.");

var graphHeaders = {
  Authorization: "Bearer " + accessToken
};
var meResponse = fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName,mail", {
  headers: graphHeaders
});
var meText = meResponse.text();
if (!meResponse.ok) {
  throw new Error("Failed to load Microsoft 365 profile (" + meResponse.status + "): " + meText);
}

var me = safeParseJson(meText);
var mailboxEmail = String(me.mail || me.userPrincipalName || "").trim();
var proofResponse = fetch("https://graph.microsoft.com/v1.0/me/messages?$top=5&$orderby=receivedDateTime%20desc&$select=id,subject,receivedDateTime,from", {
  headers: graphHeaders
});
var proofText = proofResponse.text();
var proofPayload = proofResponse.ok ? safeParseJson(proofText) : {};
var proofMessages = Array.isArray(proofPayload.value) ? proofPayload.value.map(function (message) {
  return {
    id: message.id,
    subject: message.subject || "",
    receivedDateTime: message.receivedDateTime || "",
    from: {
      name: message.from && message.from.emailAddress ? message.from.emailAddress.name || "" : "",
      email: message.from && message.from.emailAddress ? message.from.emailAddress.address || "" : ""
    }
  };
}) : [];

var grantedScopes = String(tokenData.scope || "").split(/\s+/).filter(function (item) { return !!item; });
var authConnectionData = {
  type: "auth_connection",
  status: "connected",
  connected: true,
  tenantId: tenantId,
  clientId: clientId,
  accessToken: accessToken,
  refreshToken: String(tokenData.refresh_token || ""),
  accessTokenExpiresAt: isoAfterSeconds(tokenData.expires_in || 0),
  lastAuthAt: new Date().toISOString(),
  lastRefreshAt: new Date().toISOString(),
  lastRefreshError: "",
  grantedScopes: grantedScopes,
  user: {
    id: me.id || "",
    displayName: me.displayName || mailboxEmail || "Connected account",
    email: mailboxEmail
  },
  proofMessages: proofMessages
};

upsertSingleton("auth_connection", authConnectionData);

return sanitizeAuthConnection(authConnectionData);
