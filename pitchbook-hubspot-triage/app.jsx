import React, { useEffect, useRef, useState } from "react";
import { Link, Route, Routes } from "vibe-router";
import { AlertTriangle, CheckCircle2, Inbox, Loader2, Mail, RefreshCcw, Search, Shield } from "lucide-react";

const QUEUES = [
  {
    path: "/",
    status: "high-confidence",
    label: "High Confidence",
    emptyLabel: "No high-confidence matches are waiting for review.",
    icon: CheckCircle2
  },
  {
    path: "/possible",
    status: "possible",
    label: "Possible Match",
    emptyLabel: "No possible-match items are waiting for review.",
    icon: Search
  },
  {
    path: "/unmatched",
    status: "no-match",
    label: "No unmatched items are waiting for review.",
    icon: Inbox
  },
  {
    path: "/not-relevant",
    status: "not-relevant",
    label: "Not Relevant",
    emptyLabel: "No items have been marked not relevant.",
    icon: AlertTriangle
  }
];
const QUEUE_JOB_NAME = "seed_fixture_ingest";
const OVERRIDE_JOB_NAME = "resolve_match_override";
const MAILBOX_JOB_NAME = "ingest_pitchbook_emails";
const BOOTSTRAP_AUTH_JOB_NAME = "bootstrap_auth_config";
const EXCHANGE_AUTH_JOB_NAME = "exchange_auth_code";
const LOAD_MAILBOX_CONNECTION_JOB_NAME = "load_mailbox_connection";
const ENTRA_AUTH_CHANNEL = "pitchbook-hubspot-triage-entra-auth";
const ENTRA_AUTH_STORAGE_KEY = "pitchbook-hubspot-triage-entra-auth-result";

function coerceCount(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function extractJobPayload(result) {
  if (!result || typeof result !== "object") {
    return result;
  }

  if (result.result && typeof result.result === "object") {
    return result.result;
  }

  if (result.data && typeof result.data === "object") {
    return result.data;
  }

  return result;
}

function useJob(jobName, params, options) {
  const [state, setState] = useState({
    loading: true,
    error: "",
    data: null
  });
  const serializedParams = JSON.stringify(params || {});
  const enabled = !(options && options.enabled === false);

  useEffect(() => {
    let active = true;

    if (!enabled) {
      setState({
        loading: false,
        error: "",
        data: { items: [] }
      });
      return () => {
        active = false;
      };
    }

    setState({
      loading: true,
      error: "",
      data: null
    });

    VibeAppAPI.triggerJob(jobName, params || {})
      .then((result) => {
        if (!active) {
          return;
        }

        setState({
          loading: false,
          error: "",
          data: result && result.result ? result.result : result
        });
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        const message =
          error && error.status === 409
            ? "Another queue operation is already running. Retry in a moment."
            : error && error.message
              ? error.message
              : "Job failed";

        setState({
          loading: false,
          error: message,
          data: null
        });
      });

    return () => {
      active = false;
    };
  }, [enabled, jobName, serializedParams]);

  return state;
}

function getActivePath() {
  if (typeof window === "undefined" || !window.location || !window.location.pathname) {
    return "/";
  }

  var pathname = window.location.pathname || "/";
  var vibeMatch = pathname.match(/\/vibe_apps\/\d+(\/.*)?$/i);
  if (vibeMatch && vibeMatch[1]) {
    return vibeMatch[1] || "/";
  }

  return pathname;
}

function getAppRedirectUri() {
  if (typeof window === "undefined" || !window.location) {
    return "";
  }

  var origin = window.location.origin || "";
  var pathname = window.location.pathname || "";
  var match = pathname.match(/^(\/vibe_apps\/\d+)/i);
  if (match) {
    return origin + match[1];
  }

  return (origin + pathname).replace(/\/$/, "");
}

function isAuthPopupWindow() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.name === "pitchbook-mailbox-auth";
}

function readEntraAuthResultFromLocation() {
  if (typeof window === "undefined" || !window.location || !window.location.search) {
    return null;
  }

  var searchParams = new URLSearchParams(window.location.search);
  if (!searchParams.has("code") && !searchParams.has("error")) {
    return null;
  }

  return {
    type: "entra-auth-result",
    code: searchParams.get("code") || "",
    state: searchParams.get("state") || "",
    error: searchParams.get("error") || "",
    errorDescription: searchParams.get("error_description") || ""
  };
}

function publishEntraAuthResult(message) {
  var published = false;

  try {
    if (typeof window !== "undefined" && window.opener && typeof window.opener.postMessage === "function") {
      window.opener.postMessage(message, window.location.origin);
      published = true;
    }
  } catch (_error) {
    // Ignore opener errors and fall through to other channels.
  }

  try {
    if (typeof window !== "undefined" && typeof window.BroadcastChannel === "function") {
      var channel = new window.BroadcastChannel(ENTRA_AUTH_CHANNEL);
      channel.postMessage(message);
      channel.close();
      published = true;
    }
  } catch (_error) {
    // Ignore BroadcastChannel failures and try storage fallback.
  }

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(ENTRA_AUTH_STORAGE_KEY, JSON.stringify(Object.assign({}, message, { publishedAt: Date.now() })));
      published = true;
    }
  } catch (_error) {
    // Ignore storage failures.
  }

  return published;
}

function getSameOriginLocationCandidates() {
  if (typeof window === "undefined") {
    return [];
  }

  return [
    {
      location: window.location,
      history: window.history,
      document: window.document
    }
  ];
}

function readPublishedEntraAuthResult() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    var raw = window.localStorage.getItem(ENTRA_AUTH_STORAGE_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    return parsed && parsed.type === "entra-auth-result" ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function clearPublishedEntraAuthResult() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(ENTRA_AUTH_STORAGE_KEY);
    }
  } catch (_error) {
    // Ignore storage cleanup failures.
  }
}

function createRandomString(length) {
  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  var randomValues = new Uint8Array(length);
  window.crypto.getRandomValues(randomValues);
  var result = "";
  for (var i = 0; i < randomValues.length; i += 1) {
    result += alphabet[randomValues[i] % alphabet.length];
  }
  return result;
}

function base64UrlEncode(bytes) {
  var binary = "";
  for (var i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function createCodeChallenge(codeVerifier) {
  var digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return base64UrlEncode(new Uint8Array(digest));
}

function MatchOverride({ item, onUpdated }) {
  const data = item.data || {};
  const candidates = Array.isArray(data.match_candidates) ? data.match_candidates : [];
  const [companyId, setCompanyId] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(false);

  const filteredCandidates = candidates.filter((candidate) => {
    const haystack = [
      candidate.name || "",
      candidate.ultimate_parent || "",
      candidate.owner_name || "",
      candidate.client_status || ""
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(search.trim().toLowerCase());
  });

  async function applyOverride() {
    if (!companyId) {
      return;
    }

    setPending(true);
    setMessage("Applying override...");

    try {
      await VibeAppAPI.triggerJob(OVERRIDE_JOB_NAME, {
        recordId: item.id,
        companyId
      });
      setMessage("Override applied.");
      if (onUpdated) {
        onUpdated();
      }
    } catch (error) {
      setMessage(error && error.message ? error.message : "Override failed.");
    } finally {
      setPending(false);
    }
  }

  if (!candidates.length) {
    return null;
  }

  if (data.match_bucket !== "possible" && data.match_bucket !== "no-match") {
    return null;
  }

  return (
    <div className="mt-4 rounded-2xl bg-slate-50 p-4">
      <label className="block text-[11px] uppercase tracking-[0.2em] text-slate-500">Override company match</label>
      <input
        type="text"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search company, parent, owner, or status"
        className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-0"
      />
      <select
        value={companyId}
        onChange={(event) => setCompanyId(event.target.value)}
        className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
      >
        <option value="">Select company</option>
        {filteredCandidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name} | {candidate.ultimate_parent || "No parent"} | {candidate.owner_name || "No owner"} |{" "}
            {candidate.client_status || "Unknown"}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!companyId || pending}
        onClick={applyOverride}
        className="mt-3 rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Applying..." : "Apply override"}
      </button>
      <div className="mt-2 text-sm text-slate-500">{message}</div>
    </div>
  );
}

function QueueCard({ item, onUpdated }) {
  const data = item.data || {};

  return (
    <article className="rounded-3xl border border-slate-200/70 bg-white/90 p-5 shadow-sm shadow-slate-200/50">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
            {data.match_bucket || data.relevance_status || "unprocessed"}
          </div>
          <h2 className="mt-2 text-lg font-semibold leading-tight text-slate-950">
            {data.headline || "Untitled alert"}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {data.raw_excerpt || "No excerpt available yet."}
          </p>
        </div>
        <div className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
          {data.owner_name || "Unassigned"}
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
        <div className="rounded-2xl bg-slate-50 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Source</dt>
          <dd className="mt-1 truncate">{data.source_name || data.source_sender || "Unknown source"}</dd>
        </div>
        <div className="rounded-2xl bg-slate-50 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Published</dt>
          <dd className="mt-1">{data.published_at || data.received_at || "Pending"}</dd>
        </div>
        <div className="rounded-2xl bg-slate-50 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Evidence</dt>
          <dd className="mt-1">{data.evidence_status || "pending"}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-600">
        <div className="rounded-full bg-slate-100 px-3 py-1">
          Candidates: {Array.isArray(data.match_candidates) ? data.match_candidates.length : 0}
        </div>
        {data.selected_company_id ? (
          <div className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
            Selected: {data.selected_company_id}
          </div>
        ) : null}
      </div>

      {data.pending_note_body ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-700">Pending Note</div>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-6 text-emerald-950">
            {data.pending_note_body}
          </pre>
        </div>
      ) : null}

      <MatchOverride item={item} onUpdated={onUpdated} />
    </article>
  );
}

function QueuePage({ queue, refreshToken, onUpdated }) {
  const { loading, error, data } = useJob(
    QUEUE_JOB_NAME,
    {
      action: "list_queue",
      status: queue.status,
      refresh_token: refreshToken
    }
  );

  if (loading) {
    return (
      <div className="px-6 py-10">
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white/60 p-8 text-sm text-slate-500">
          Loading the {queue.label.toLowerCase()} queue...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-10">
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-8 text-sm text-rose-700">
          Unable to load the {queue.label.toLowerCase()} queue: {error}
        </div>
      </div>
    );
  }

  const items = data && data.items ? data.items : [];
  if (!items.length) {
    return (
      <div className="px-6 py-10">
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 p-10 text-center">
          <div className="text-sm uppercase tracking-[0.22em] text-slate-400">{queue.label}</div>
          <div className="mt-3 text-lg font-medium text-slate-800">{queue.emptyLabel}</div>
          <p className="mt-2 text-sm text-slate-500">
            Seed one of the development fixtures or run the mailbox sync after connecting Outlook.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-6 py-6">
      {items.map((item) => (
        <QueueCard key={item.id} item={item} onUpdated={onUpdated} />
      ))}
    </div>
  );
}

function ShellNav() {
  const activePath = getActivePath();

  return (
    <nav className="flex flex-wrap gap-3 text-sm">
      {QUEUES.map((queue) => {
        const isActive = activePath === queue.path;
        const Icon = queue.icon;

        return (
          <Link
            key={queue.path}
            to={queue.path}
            className={
              isActive
                ? "inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-white"
                : "inline-flex items-center gap-2 rounded-full bg-white/85 px-4 py-2 text-slate-700 ring-1 ring-slate-200"
            }
          >
            <Icon size={16} />
            <span>{queue.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function SeedButtons({ onSeeded }) {
  const [message, setMessage] = useState("");
  const [pendingFixture, setPendingFixture] = useState("");

  async function seedFixture(fixtureName) {
    setPendingFixture(fixtureName);
    setMessage("Seeding fixture...");

    try {
      const result = await VibeAppAPI.triggerJob(QUEUE_JOB_NAME, {
        action: "seed_demo_fixture",
        fixture_name: fixtureName
      });
      const payload = extractJobPayload(result);
      const createdCount = coerceCount(payload && payload.created_count) ?? 0;
      const skippedCount = coerceCount(payload && payload.skipped_count) ?? 0;

      setMessage("Seeded " + fixtureName + " (" + createdCount + " created, " + skippedCount + " skipped).");
      if (onSeeded) {
        onSeeded();
      }
    } catch (error) {
      const nextMessage =
        error && error.status === 409
          ? "Another queue operation is already running. Retry in a moment."
          : error && error.message
            ? error.message
            : "Failed to seed fixture.";
      setMessage(nextMessage);
    } finally {
      setPendingFixture("");
    }
  }

  return (
    <section className="mx-6 rounded-3xl border border-slate-200/80 bg-white/80 p-5 shadow-sm shadow-slate-200/40">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Development Seed Controls</div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            These buttons call the trusted sync job and create internal alert records for each queue state without enabling
            client-side record access.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={pendingFixture === "pe_ma"}
            onClick={() => seedFixture("pe_ma")}
            className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pendingFixture === "pe_ma" ? "Seeding..." : "Seed PE/M&A Fixture"}
          </button>
          <button
            type="button"
            disabled={pendingFixture === "watchlist_companies"}
            onClick={() => seedFixture("watchlist_companies")}
            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 disabled:opacity-60"
          >
            {pendingFixture === "watchlist_companies" ? "Seeding..." : "Seed Watchlist Fixture"}
          </button>
        </div>
      </div>
      <div className="mt-3 min-h-6 text-sm text-slate-500">{message}</div>
    </section>
  );
}

function MailboxConnectionPanel({ onSynced }) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [authBusy, setAuthBusy] = useState(false);
  const [manualSyncing, setManualSyncing] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const pendingAuthRef = useRef(null);

  const authConfigState = useJob(
    BOOTSTRAP_AUTH_JOB_NAME,
    {
      redirectUri: getAppRedirectUri(),
      refresh_token: refreshToken
    }
  );
  const connectionState = useJob(
    LOAD_MAILBOX_CONNECTION_JOB_NAME,
    {
      refresh_token: refreshToken
    }
  );

  const authConfig = authConfigState.data || {
    configured: false,
    missingSecrets: [],
    tenantId: "",
    clientId: "",
    requestedScopes: [],
    redirectUri: getAppRedirectUri()
  };
  const mailboxData = connectionState.data || {};
  const authConnection = mailboxData.authConnection || {
    status: "not_connected",
    connected: false,
    grantedScopes: [],
    proofMessages: []
  };
  const mailboxIngestState = mailboxData.mailboxIngestState || null;

  useEffect(() => {
    async function processPayload(payload) {
      if (!payload || payload.type !== "entra-auth-result") {
        return;
      }

      clearPublishedEntraAuthResult();

      if (payload.error) {
        setAuthNotice(payload.errorDescription || "Microsoft sign-in did not complete.");
        setAuthBusy(false);
        pendingAuthRef.current = null;
        return;
      }

      if (!pendingAuthRef.current) {
        setAuthNotice("The sign-in response arrived without a pending request. Start Microsoft sign-in again.");
        setAuthBusy(false);
        return;
      }

      setAuthBusy(true);
      setAuthNotice("Completing Microsoft sign-in...");

      try {
        await VibeAppAPI.triggerJob(EXCHANGE_AUTH_JOB_NAME, {
          code: payload.code,
          state: payload.state,
          expectedState: pendingAuthRef.current.state,
          codeVerifier: pendingAuthRef.current.codeVerifier,
          redirectUri: pendingAuthRef.current.redirectUri
        });
        setAuthNotice("Microsoft 365 mailbox connected.");
        pendingAuthRef.current = null;
        setRefreshToken((current) => current + 1);
      } catch (error) {
        setAuthNotice(error && error.message ? error.message : "Microsoft sign-in could not be completed.");
      } finally {
        setAuthBusy(false);
      }
    }

    function handleWindowMessage(event) {
      if (event.origin !== window.location.origin || !event.data || event.data.type !== "entra-auth-result") {
        return;
      }
      processPayload(event.data);
    }

    function handleStorage(event) {
      if (event.key !== ENTRA_AUTH_STORAGE_KEY || !event.newValue) {
        return;
      }
      try {
        processPayload(JSON.parse(event.newValue));
      } catch (_error) {
        // Ignore malformed storage payloads.
      }
    }

    function handleBroadcastMessage(event) {
      if (event && event.data) {
        processPayload(event.data);
      }
    }

    window.addEventListener("message", handleWindowMessage);
    window.addEventListener("storage", handleStorage);

    let channel = null;
    if (typeof window.BroadcastChannel === "function") {
      channel = new window.BroadcastChannel(ENTRA_AUTH_CHANNEL);
      channel.addEventListener("message", handleBroadcastMessage);
    }

    var publishedPayload = readPublishedEntraAuthResult();
    if (publishedPayload) {
      processPayload(publishedPayload);
    }

    return () => {
      window.removeEventListener("message", handleWindowMessage);
      window.removeEventListener("storage", handleStorage);
      if (channel) {
        channel.removeEventListener("message", handleBroadcastMessage);
        channel.close();
      }
    };
  }, []);

  async function handleStartAuth() {
    if (!authConfig.configured) {
      setAuthNotice("Hosted Entra secrets are still missing: " + (authConfig.missingSecrets || []).join(", "));
      return;
    }

    try {
      setAuthBusy(true);
      setAuthNotice("Opening Microsoft sign-in...");

      const redirectUri = authConfig.redirectUri || getAppRedirectUri();
      const state = createRandomString(24);
      const codeVerifier = createRandomString(64);
      const codeChallenge = await createCodeChallenge(codeVerifier);
      pendingAuthRef.current = {
        state,
        codeVerifier,
        redirectUri
      };

      const authUrl = new URL("https://login.microsoftonline.com/" + authConfig.tenantId + "/oauth2/v2.0/authorize");
      authUrl.searchParams.set("client_id", authConfig.clientId);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_mode", "query");
      authUrl.searchParams.set("scope", (authConfig.requestedScopes || []).join(" "));
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set("code_challenge_method", "S256");

      const popup = window.open(authUrl.toString(), "pitchbook-mailbox-auth", "width=560,height=720");
      if (!popup) {
        throw new Error("Popup blocked. Allow popups for this site and retry.");
      }

      setAuthNotice("Finish Microsoft sign-in in the popup.");
    } catch (error) {
      setAuthNotice(error && error.message ? error.message : "Microsoft sign-in could not be started.");
      setAuthBusy(false);
      pendingAuthRef.current = null;
    }
  }

  async function handleManualSync() {
    setManualSyncing(true);
    setAuthNotice("Running mailbox sync...");

    try {
      const result = await VibeAppAPI.triggerJob(MAILBOX_JOB_NAME, {});
      const payload = extractJobPayload(result);
      const importedMessageCount =
        coerceCount(payload && payload.imported_message_count) ?? 0;
      const importedItemCount = coerceCount(payload && payload.imported_item_count) ?? 0;
      setAuthNotice(
        "Mailbox sync complete (" + importedMessageCount + " messages scanned, " + importedItemCount + " alert items imported)."
      );
      setRefreshToken((current) => current + 1);
      if (onSynced) {
        onSynced();
      }
    } catch (error) {
      setAuthNotice(error && error.message ? error.message : "Mailbox sync failed.");
    } finally {
      setManualSyncing(false);
    }
  }

  const missingSecrets = Array.isArray(authConfig.missingSecrets) ? authConfig.missingSecrets : [];
  const proofMessages = Array.isArray(authConnection.proofMessages) ? authConnection.proofMessages : [];
  const lastSummary = mailboxIngestState && mailboxIngestState.lastSummary ? mailboxIngestState.lastSummary : null;
  const lastError = mailboxIngestState && mailboxIngestState.lastError ? mailboxIngestState.lastError : "";
  const lastSuccessAt = mailboxIngestState && mailboxIngestState.lastSuccessAt ? mailboxIngestState.lastSuccessAt : "";

  return (
    <section className="mx-6 mt-6 rounded-3xl border border-slate-200/80 bg-white/80 p-5 shadow-sm shadow-slate-200/40">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Mailbox Connection</div>
          <h2 className="mt-2 text-lg font-semibold text-slate-900">Live Outlook ingest</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Use popup-based Microsoft Entra sign-in with PKCE to authorize delegated Graph <code>Mail.Read</code> access
            for the daily PitchBook sync.
          </p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <div className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
              Status: {authConnection.connected ? "Connected" : authConnection.status || "Not connected"}
            </div>
            {authConnection.user && authConnection.user.email ? (
              <div className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">{authConnection.user.email}</div>
            ) : null}
            {lastSuccessAt ? (
              <div className="rounded-full bg-sky-100 px-3 py-1 text-sky-800">Last sync: {lastSuccessAt}</div>
            ) : null}
          </div>
        </div>
        <div className="flex w-full max-w-md flex-col gap-3">
          <button
            type="button"
            onClick={handleStartAuth}
            disabled={authBusy || authConfigState.loading}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
          >
            {authBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Sign in with Entra ID
          </button>
          <button
            type="button"
            onClick={handleManualSync}
            disabled={manualSyncing || authBusy || !authConnection.connected}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-3 text-sm font-medium text-slate-700 ring-1 ring-slate-200 disabled:opacity-60"
          >
            {manualSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Run Mailbox Sync
          </button>
        </div>
      </div>

      {missingSecrets.length ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Hosted Entra setup is incomplete: {missingSecrets.join(", ")}
        </div>
      ) : null}

      {lastError ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Last mailbox sync error: {lastError}
        </div>
      ) : null}

      {authNotice ? <div className="mt-4 text-sm text-slate-600">{authNotice}</div> : null}

      {lastSummary ? (
        <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl bg-slate-50 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Messages scanned</div>
            <div className="mt-1 font-medium text-slate-900">{lastSummary.imported_message_count || 0}</div>
          </div>
          <div className="rounded-2xl bg-slate-50 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Items imported</div>
            <div className="mt-1 font-medium text-slate-900">{lastSummary.imported_item_count || 0}</div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-slate-900">Proof of recent mail</div>
          <div className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-slate-100">
            {proofMessages.length} item{proofMessages.length === 1 ? "" : "s"}
          </div>
        </div>
        {!proofMessages.length ? (
          <div className="mt-3 text-sm text-slate-500">No recent mail proof is stored yet.</div>
        ) : (
          <div className="mt-3 space-y-3">
            {proofMessages.map((message) => (
              <div key={message.id || message.subject} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-sm font-medium text-slate-900">{message.subject || "Untitled message"}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {(message.from && (message.from.name || message.from.email)) || "Unknown sender"} |{" "}
                  {message.receivedDateTime || "Unknown time"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function MsgUploadPanel({ onIngested }) {
  const [message, setMessage] = useState("");
  const [pastedEmail, setPastedEmail] = useState("");
  const [pastePending, setPastePending] = useState(false);

  function handleUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    setMessage(".msg upload received. Parsing adapter required.");
  }

  async function handlePasteSubmit() {
    if (!pastedEmail.trim()) {
      setMessage("Paste an email body before submitting.");
      return;
    }

    setPastePending(true);
    setMessage("Parsing pasted email...");

    try {
      const result = await VibeAppAPI.triggerJob(QUEUE_JOB_NAME, {
        action: "ingest_pasted_email",
        pasted_email: pastedEmail
      });
      const payload = extractJobPayload(result);
      const createdCount = coerceCount(payload && payload.created_count);
      const skippedCount = coerceCount(payload && payload.skipped_count);

      if (createdCount === null && skippedCount === null) {
        setMessage("Pasted email was submitted. Refresh the queues to confirm whether new items were created.");
      } else {
        setMessage(
          "Pasted email ingested (" + String(createdCount ?? 0) + " created, " + String(skippedCount ?? 0) + " skipped)."
        );
      }
      if (onIngested) {
        onIngested();
      }
    } catch (error) {
      setMessage(error && error.message ? error.message : "Failed to ingest pasted email.");
    } finally {
      setPastePending(false);
    }
  }

  return (
    <section className="mx-6 mt-6 rounded-3xl border border-dashed border-slate-300 bg-white/75 p-5 shadow-sm shadow-slate-200/30">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Adapter Seams</div>
          <h2 className="mt-2 text-lg font-semibold text-slate-900">Manual `.msg` upload</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            The UI path is wired now. Actual binary `.msg` parsing activates when <code>MSG_PARSE_API_URL</code> and{" "}
            <code>MSG_PARSE_API_TOKEN</code> are configured.
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Live Outlook ingest now runs through the Microsoft 365 mailbox connection. This panel remains the manual testing seam.
          </p>
        </div>
        <div className="w-full max-w-md">
          <label className="block text-sm font-medium text-slate-900" htmlFor="msg-upload-input">
            Upload a PitchBook `.msg` sample
          </label>
          <input
            id="msg-upload-input"
            type="file"
            accept=".msg"
            onChange={handleUpload}
            className="mt-3 block w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600"
          />
          <label className="mt-5 block text-sm font-medium text-slate-900" htmlFor="email-paste-input">
            Or paste a PitchBook email
          </label>
          <textarea
            id="email-paste-input"
            value={pastedEmail}
            onChange={(event) => setPastedEmail(event.target.value)}
            placeholder="Paste the raw email body here"
            className="mt-3 block min-h-40 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600"
          />
          <button
            type="button"
            onClick={handlePasteSubmit}
            disabled={pastePending}
            className="mt-3 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 disabled:opacity-60"
          >
            {pastePending ? "Ingesting..." : "Use pasted email"}
          </button>
          <div className="mt-3 min-h-6 text-sm text-slate-500">{message}</div>
        </div>
      </div>
    </section>
  );
}

function HomePage() {
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#f8fafc,_#dbeafe_38%,_#e2e8f0_72%,_#cbd5e1)]">
      <header className="border-b border-white/50 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-slate-100">
                <Shield size={14} />
                Secure Mode
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">
                PitchBook HubSpot Triage
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
                Review queues are route-based and job-backed. Live mailbox ingest now runs through Microsoft 365 delegated
                auth, while seeded fixtures still populate the same secure review flow for testing.
              </p>
            </div>
            <ShellNav />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl py-6">
        <SeedButtons onSeeded={() => setRefreshToken((current) => current + 1)} />
        <MailboxConnectionPanel onSynced={() => setRefreshToken((current) => current + 1)} />
        <MsgUploadPanel onIngested={() => setRefreshToken((current) => current + 1)} />
        <Routes>
          {QUEUES.map((queue) => (
            <Route
              key={queue.path}
              path={queue.path}
              component={() => (
                <QueuePage
                  queue={queue}
                  refreshToken={refreshToken}
                  onUpdated={() => setRefreshToken((current) => current + 1)}
                />
              )}
            />
          ))}
        </Routes>
      </main>
    </div>
  );
}

function PopupCallbackPage({ state }) {
  const status = state && state.status ? state.status : "success";
  const detail =
    state && state.detail
      ? state.detail
      : "The authentication result was sent back to the main app window. You can close this popup.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6">
      <div className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm shadow-slate-200/60">
        <div
          className={
            status === "success"
              ? "inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700"
              : "inline-flex rounded-full bg-rose-100 px-3 py-1 text-xs font-medium text-rose-700"
          }
        >
          {status === "success" ? "Sign-In Complete" : "Sign-In Error"}
        </div>
        <h1 className="mt-3 text-2xl font-semibold text-slate-950">Microsoft 365 Popup</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{detail}</p>
      </div>
    </div>
  );
}

export default function App() {
  const popupAuthPayloadRef = useRef(readEntraAuthResultFromLocation());
  const [popupCallbackState, setPopupCallbackState] = useState(null);
  const popupAuthWindow = isAuthPopupWindow();

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const message = popupAuthPayloadRef.current || readEntraAuthResultFromLocation();
    if (!message) {
      return undefined;
    }

    const candidates = getSameOriginLocationCandidates();
    candidates.forEach((candidate) => {
      try {
        const params = new URLSearchParams(candidate.location.search || "");
        if (!params.get("code") && !params.get("error")) {
          return;
        }

        candidate.history.replaceState(
          {},
          candidate.document && candidate.document.title ? candidate.document.title : document.title,
          candidate.location.pathname || "/"
        );
      } catch (_error) {
        // Ignore history cleanup failures and continue publishing.
      }
    });

    const published = publishEntraAuthResult(message);
    const hasOauthError = !!message.error;
    setPopupCallbackState({
      status: published ? (hasOauthError ? "error" : "success") : "error",
      detail: published
        ? hasOauthError
          ? message.errorDescription || "Microsoft sign-in did not complete."
          : "Microsoft sign-in completed. This window can close automatically."
        : "The popup could not communicate the sign-in result back to the main app."
    });

    const closeTimer = window.setTimeout(() => {
      try {
        window.close();
      } catch (_error) {
        // Ignore close failures; the callback page remains visible.
      }
    }, 450);

    return () => window.clearTimeout(closeTimer);
  }, []);

  if (popupCallbackState || popupAuthPayloadRef.current || popupAuthWindow) {
    return <PopupCallbackPage state={popupCallbackState} />;
  }

  return <HomePage />;
}
