function getPayload() {
  var candidates = [];
  if (typeof input !== "undefined" && input && typeof input === "object") candidates.push(input);
  if (typeof params !== "undefined" && params && typeof params === "object") candidates.push(params);
  if (typeof event !== "undefined" && event && typeof event === "object") candidates.push(event);
  if (typeof jobInput !== "undefined" && jobInput && typeof jobInput === "object") candidates.push(jobInput);

  for (var i = 0; i < candidates.length; i += 1) {
    var candidate = candidates[i];
    if (candidate.redirectUri || candidate.clientId || candidate.tenantId) {
      return candidate;
    }
  }

  var merged = {};
  for (var j = 0; j < candidates.length; j += 1) {
    var source = candidates[j];
    var keys = Object.keys(source || {});
    for (var k = 0; k < keys.length; k += 1) {
      merged[keys[k]] = source[keys[k]];
    }
  }

  return merged;
}

function getSecretValue(name) {
  var value = VibeAppAPI.getSecret(name);
  return value ? String(value) : "";
}

var payload = getPayload();
var tenantId = getSecretValue("ENTRA_TENANT_ID");
var clientId = getSecretValue("ENTRA_CLIENT_ID");
var clientSecret = getSecretValue("ENTRA_CLIENT_SECRET");
var redirectUri = String(payload.redirectUri || getSecretValue("ENTRA_REDIRECT_URI") || "");
var requestedScopes = ["openid", "profile", "offline_access", "User.Read", "Mail.Read"];
var missingSecrets = [];

if (!tenantId) missingSecrets.push("ENTRA_TENANT_ID");
if (!clientId) missingSecrets.push("ENTRA_CLIENT_ID");
if (!clientSecret) missingSecrets.push("ENTRA_CLIENT_SECRET");
if (!redirectUri) missingSecrets.push("ENTRA_REDIRECT_URI");

return {
  configured: missingSecrets.length === 0,
  missingSecrets: missingSecrets,
  tenantId: tenantId,
  clientId: clientId,
  requestedScopes: requestedScopes,
  redirectUri: redirectUri
};
