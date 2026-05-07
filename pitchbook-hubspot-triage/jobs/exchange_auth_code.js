function isObject(value) {
  return !!value && typeof value === "object";
}

function hasAuthPayloadShape(value) {
  return !!(value && (value.code || value.codeVerifier || value.expectedState || value.redirectUri));
}

function findNestedPayload(value, seen, depth) {
  if (!isObject(value) || depth > 4) return null;
  if (seen.indexOf(value) >= 0) return null;
  seen.push(value);

  if (hasAuthPayloadShape(value)) return value;

  var keys = Object.keys(value);
  for (var i = 0; i < keys.length; i += 1) {
    var nested = findNestedPayload(value[keys[i]], seen, depth + 1);
    if (nested) return nested;
  }

  return null;
}

function summarizeKeys(value) {
  if (!isObject(value)) return "(non-object)";
  var keys = Object.keys(value);
  return keys.length ? keys.sort().join(", ") : "(no keys)";
}

function getPayload(runtime) {
  var candidates = [];
  if (runtime && isObject(runtime.input)) candidates.push(runtime.input);
  if (runtime && isObject(runtime.params)) candidates.push(runtime.params);
  if (runtime && isObject(runtime.event)) candidates.push(runtime.event);
  if (runtime && isObject(runtime.jobInput)) candidates.push(runtime.jobInput);
  if (runtime && isObject(runtime.payload)) candidates.push(runtime.payload);

  for (var i = 0; i < candidates.length; i += 1) {
    var nested = findNestedPayload(candidates[i], [], 0);
    if (nested) return nested;
  }

  var merged = {};
  for (var j = 0; j < candidates.length; j += 1) {
    var source = candidates[j];
    var keys = Object.keys(source || {});
    for (var k = 0; k < keys.length; k += 1) {
      merged[keys[k]] = source[keys[k]];
    }
  }

  merged.__payloadDebug = candidates.map(function(candidate, index) {
    return "candidate" + (index + 1) + ": " + summarizeKeys(candidate);
  }).join(" | ");

  return merged;
}

function getSecretValue(api, name) {
  var value = api.getSecret(name);
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

function getSingleton(api, type) {
  var response = api.query({ type: type }, {
    limit: 1,
    order: "updated_at desc"
  });
  var records = response && response.records ? response.records : [];
  return records.length ? records[0] : null;
}

function getLatestAuthExchangeRequest(api, requestedByEmail) {
  var filters = { type: "auth_exchange_request" };
  if (requestedByEmail) filters.requestedByEmail = requestedByEmail;
  var response = api.query(filters, {
    limit: 1,
    order: "updated_at desc"
  });
  var records = response && response.records ? response.records : [];
  return records.length ? records[0] : null;
}

function upsertSingleton(api, type, data) {
  var existing = getSingleton(api, type);
  if (existing) {
    api.update([{ id: existing.id, data: data }]);
    return existing.id;
  }
  var created = api.create([data]);
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

function createExchangeAuthCode(api, dependencies) {
  function run() {
    var runtime = dependencies || {};
    var payload = getPayload(runtime);
    var currentUserEmail = api.currentUser && api.currentUser.email ? String(api.currentUser.email).trim().toLowerCase() : "";
    var fallbackExchangeRecord = null;

    if (!payload.code) {
      fallbackExchangeRecord = getLatestAuthExchangeRequest(
        api,
        String(payload.requestedByEmail || currentUserEmail || "").trim().toLowerCase()
      );
      if (fallbackExchangeRecord && fallbackExchangeRecord.data) {
        var fallbackData = fallbackExchangeRecord.data;
        payload = {
          code: payload.code || fallbackData.code || "",
          codeVerifier: payload.codeVerifier || fallbackData.codeVerifier || "",
          redirectUri: payload.redirectUri || fallbackData.redirectUri || "",
          state: payload.state || fallbackData.state || "",
          expectedState: payload.expectedState || fallbackData.expectedState || "",
          requestedByEmail: payload.requestedByEmail || fallbackData.requestedByEmail || currentUserEmail || ""
        };
      }
    }

    var code = String(payload.code || "").trim();
    var redirectUri = String(payload.redirectUri || getSecretValue(api, "ENTRA_REDIRECT_URI") || "").trim();
    var tenantId = getSecretValue(api, "ENTRA_TENANT_ID");
    var clientId = getSecretValue(api, "ENTRA_CLIENT_ID");
    var clientSecret = getSecretValue(api, "ENTRA_CLIENT_SECRET");
    var fetchImpl = runtime.fetch || fetch;

    if (!code) {
      throw new Error(
        "Authorization code is required. Received payload keys: " +
          summarizeKeys(payload) +
          (payload.__payloadDebug ? " | " + payload.__payloadDebug : "")
      );
    }
    if (!redirectUri) throw new Error("Redirect URI is required.");
    if (!tenantId || !clientId || !clientSecret) {
      throw new Error("ENTRA_TENANT_ID, ENTRA_CLIENT_ID, and ENTRA_CLIENT_SECRET must be configured.");
    }
    if (payload.expectedState && payload.state && payload.expectedState !== payload.state) {
      throw new Error("State mismatch. Please try Microsoft sign-in again.");
    }

    var tokenResponse = fetchImpl("https://login.microsoftonline.com/" + tenantId + "/oauth2/v2.0/token", {
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
    var meResponse = fetchImpl("https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName,mail", {
      headers: graphHeaders
    });
    var meText = meResponse.text();
    if (!meResponse.ok) {
      throw new Error("Failed to load Microsoft 365 profile (" + meResponse.status + "): " + meText);
    }

    var me = safeParseJson(meText);
    var mailboxEmail = String(me.mail || me.userPrincipalName || "").trim();
    var proofResponse = fetchImpl("https://graph.microsoft.com/v1.0/me/messages?$top=5&$orderby=receivedDateTime%20desc&$select=id,subject,receivedDateTime,from", {
      headers: graphHeaders
    });
    var proofText = proofResponse.text();
    var proofPayload = proofResponse.ok ? safeParseJson(proofText) : {};
    var proofMessages = Array.isArray(proofPayload.value) ? proofPayload.value.map(function(message) {
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

    var existingAuthRecord = getSingleton(api, "auth_connection");
    var existingAuthData = existingAuthRecord ? existingAuthRecord.data : {};
    var grantedScopes = String(tokenData.scope || "").split(/\s+/).filter(function(item) { return !!item; });
    var authConnectionData = {
      type: "auth_connection",
      status: "connected",
      connected: true,
      tenantId: tenantId,
      clientId: clientId,
      accessToken: accessToken,
      refreshToken: String(tokenData.refresh_token || existingAuthData.refreshToken || ""),
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

    upsertSingleton(api, "auth_connection", authConnectionData);

    if (fallbackExchangeRecord && fallbackExchangeRecord.data) {
      api.update([
        {
          id: fallbackExchangeRecord.id,
          data: {
            type: "auth_exchange_request",
            requestedByEmail: fallbackExchangeRecord.data.requestedByEmail || currentUserEmail || "",
            status: "completed",
            state: fallbackExchangeRecord.data.state || payload.state || "",
            expectedState: fallbackExchangeRecord.data.expectedState || payload.expectedState || "",
            redirectUri: fallbackExchangeRecord.data.redirectUri || redirectUri,
            codeVerifier: "",
            code: "",
            oauthError: "",
            errorDescription: "",
            requestedAt: fallbackExchangeRecord.data.requestedAt || "",
            receivedAt: fallbackExchangeRecord.data.receivedAt || "",
            completedAt: new Date().toISOString(),
            failedAt: "",
            lastError: ""
          }
        }
      ]);
    }

    return sanitizeAuthConnection(authConnectionData);
  }

  return { run: run };
}

if (typeof module !== "undefined") {
  module.exports = {
    createExchangeAuthCode: createExchangeAuthCode,
    findNestedPayload: findNestedPayload,
    getLatestAuthExchangeRequest: getLatestAuthExchangeRequest,
    getPayload: getPayload,
    sanitizeAuthConnection: sanitizeAuthConnection,
    summarizeKeys: summarizeKeys
  };
}

var __exchangeAuthCodeResult = null;

if (typeof VibeAppAPI !== "undefined") {
  __exchangeAuthCodeResult = createExchangeAuthCode(VibeAppAPI, {
    input: typeof input !== "undefined" ? input : undefined,
    params: typeof params !== "undefined" ? params : undefined,
    event: typeof event !== "undefined" ? event : undefined,
    jobInput: typeof jobInput !== "undefined" ? jobInput : undefined
  }).run();
}

__exchangeAuthCodeResult;
