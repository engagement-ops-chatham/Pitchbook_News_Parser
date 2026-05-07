import React, { useEffect, useState } from "react";
import { Link, Route, Routes } from "vibe-router";
import { AlertTriangle, CheckCircle2, Inbox, Search, Shield } from "lucide-react";

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
    label: "No Match",
    emptyLabel: "No unmatched items are waiting for review.",
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

  return window.location.pathname;
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
            Seed one of the development fixtures to populate this queue through the secure sync job.
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
      const payload = result && result.result ? result.result : result;
      const createdCount = payload && typeof payload.created_count === "number" ? payload.created_count : 0;
      const skippedCount = payload && typeof payload.skipped_count === "number" ? payload.skipped_count : 0;

      setMessage("Seeded " + fixtureName + " (" + createdCount + " created, " + skippedCount + " skipped).");
      if (onSeeded) {
        onSeeded();
      }
    } catch (error) {
      const message =
        error && error.status === 409
          ? "Another queue operation is already running. Retry in a moment."
          : error && error.message
            ? error.message
            : "Failed to seed fixture.";
      setMessage(message);
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

function MsgUploadPanel() {
  const [message, setMessage] = useState("");

  function handleUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    setMessage(".msg upload received. Parsing adapter required.");
  }

  return (
    <section className="mx-6 mt-6 rounded-3xl border border-dashed border-slate-300 bg-white/75 p-5 shadow-sm shadow-slate-200/30">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Adapter Seams</div>
          <h2 className="mt-2 text-lg font-semibold text-slate-900">Manual `.msg` upload</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            The UI path is wired now. Actual binary `.msg` parsing activates when `MSG_PARSE_API_URL` and
            `MSG_PARSE_API_TOKEN` are configured.
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Live Outlook ingest is scheduled through the server-side mailbox job. This panel is only the manual testing seam.
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
                Review queues are route-based and job-backed. Development seeds now flow through the same secure sync job
                that the queue routes use for reads.
              </p>
            </div>
            <ShellNav />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl py-6">
        <SeedButtons onSeeded={() => setRefreshToken((current) => current + 1)} />
        <MsgUploadPanel />
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

export default function App() {
  return <HomePage />;
}
