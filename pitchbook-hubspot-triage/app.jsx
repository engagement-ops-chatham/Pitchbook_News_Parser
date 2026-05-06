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

function useJob(jobName, params) {
  const [state, setState] = useState({
    loading: true,
    error: "",
    data: null
  });
  const serializedParams = JSON.stringify(params || {});

  useEffect(() => {
    let active = true;

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

        setState({
          loading: false,
          error: error && error.message ? error.message : "Job failed",
          data: null
        });
      });

    return () => {
      active = false;
    };
  }, [jobName, serializedParams]);

  return state;
}

function getActivePath() {
  if (typeof window === "undefined" || !window.location || !window.location.pathname) {
    return "/";
  }

  return window.location.pathname;
}

function QueueCard({ item }) {
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
          <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Sender</dt>
          <dd className="mt-1 truncate">{data.source_sender || "Unknown sender"}</dd>
        </div>
        <div className="rounded-2xl bg-slate-50 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Received</dt>
          <dd className="mt-1">{data.received_at || "Pending"}</dd>
        </div>
        <div className="rounded-2xl bg-slate-50 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Evidence</dt>
          <dd className="mt-1">{data.evidence_status || "pending"}</dd>
        </div>
      </dl>
    </article>
  );
}

function QueuePage({ queue }) {
  const { loading, error, data } = useJob("seed_fixture_ingest", {
    action: "list_queue",
    status: queue.status
  });

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
            Queue reads stay behind secure-mode jobs until the record pipeline is added.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-6 py-6">
      {items.map((item) => (
        <QueueCard key={item.id} item={item} />
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

function HomePage() {
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
                Review queues are route-based, job-backed, and intentionally limited to secure-mode shell behavior until the
                internal record pipeline and actions are deployed.
              </p>
            </div>
            <ShellNav />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl py-6">
        <Routes>
          {QUEUES.map((queue) => (
            <Route
              key={queue.path}
              path={queue.path}
              component={() => <QueuePage queue={queue} />}
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
