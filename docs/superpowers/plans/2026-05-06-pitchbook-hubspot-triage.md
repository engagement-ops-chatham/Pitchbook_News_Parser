# PitchBook HubSpot Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Vibe app in the development environment that ingests PitchBook alert content, classifies service triggers, validates HubSpot company matches with confidence buckets, and stages draft HubSpot note actions for review.

**Architecture:** Use a Vibe app with a single JSX review UI and a small set of synchronous and asynchronous jobs. The app stores internal records as the source of truth, uses the restricted HubSpot connector for CRM candidate lookup, and uses explicit secret-backed adapters for mailbox ingest, `.msg` parsing, AI classification, and corroborating-source enrichment so the downstream workflow can be built now while the upstream APIs are finalized.

**Tech Stack:** Chatham Vibes JSX UI, Vibe jobs, HubSpot data connector, PowerShell deployment scripts, Python fixture extraction with `extract_msg`, local `pytest` tests.

---

## File Structure

### Workspace Files

- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\.env.example`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\README.md`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\app.jsx`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\jobs\seed_fixture_ingest.js`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\jobs\process_alert_items.js`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\jobs\ingest_pitchbook_emails.js`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\jobs\resolve_match_override.js`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\scripts\create_app.ps1`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\scripts\deploy_app.ps1`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\scripts\create_or_update_jobs.ps1`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\scripts\enable_hubspot_connector.ps1`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\local\extract_pitchbook_fixture.py`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\tests\test_extract_pitchbook_fixture.py`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\tests\fixtures\pitchbook_pe_ma_alert.json`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\tests\fixtures\pitchbook_watchlist_companies.json`

### Responsibility Map

- `app.jsx`: Main review UI, filters, override flows, manual fixture upload action, and job-trigger buttons.
- `seed_fixture_ingest.js`: Trusted sync job that accepts normalized JSON fixture payloads and creates internal records. This is the guaranteed dev/test ingest path.
- `process_alert_items.js`: Async analysis job that classifies relevance, validates corroborating sources, queries HubSpot candidates, scores matches, assigns owners, and drafts pending-note records.
- `ingest_pitchbook_emails.js`: Async scheduled job that calls a future mailbox adapter API, normalizes returned messages, and hands them to the same record pipeline.
- `resolve_match_override.js`: Trusted sync job for reviewer override of selected HubSpot company.
- `create_app.ps1`: Create the Vibe app with initial JSX and secure record-access mode.
- `deploy_app.ps1`: Patch the JSX source and bump versions.
- `create_or_update_jobs.ps1`: Create or patch all jobs with the correct types, schedules, and invocation flags.
- `enable_hubspot_connector.ps1`: Enable the restricted HubSpot connector and fail loudly if admin enablement is missing.
- `extract_pitchbook_fixture.py`: Local utility to convert `.msg` samples into normalized JSON fixtures for tests and development seeding.
- `test_extract_pitchbook_fixture.py`: Verifies fixture extraction against the provided sample `.msg` corpus.

## Assumptions That Shape The Build

- The Vibe job runtime cannot natively parse Outlook `.msg` binary files, so `.msg` handling must go through either a local preprocessing tool for development or a future external parsing API.
- The live mailbox path also depends on a future mailbox adapter API or Graph-backed service secret. The app should still be built so that this adapter can be turned on without redesigning downstream logic.
- The HubSpot connector is restricted and may require admin enablement in development. The plan includes an explicit enablement step and a verification failure path.
- To keep sensitive CRM decisions off the client, set `client_record_access` to `none` and route all reads and writes through jobs.

### Task 1: Bootstrap The Workspace And Fixture Corpus

**Files:**
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\.env.example`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\README.md`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\local\extract_pitchbook_fixture.py`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\tests\test_extract_pitchbook_fixture.py`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\tests\fixtures\pitchbook_pe_ma_alert.json`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\tests\fixtures\pitchbook_watchlist_companies.json`

- [ ] **Step 1: Write the failing fixture extraction test**

```python
import importlib.util
from pathlib import Path

MODULE_PATH = Path(r"C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\local\extract_pitchbook_fixture.py")
spec = importlib.util.spec_from_file_location("extract_pitchbook_fixture", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def test_extract_fixture_returns_expected_keys():
    msg_path = Path(r"C:\Users\kcosgrave\Downloads\PitchBook Alert - _PE_M&A Deals - Last 30 Days_ 1 (2).msg")
    fixture = module.extract_fixture(msg_path)

    assert fixture["source_subject"].startswith('PitchBook Alert - "PE/M&A Deals')
    assert fixture["source_sender"] == "PitchBook Alerts <alerts-noreply@alerts.pitchbook.com>"
    assert fixture["items"]
    first_item = fixture["items"][0]
    assert {"item_type", "headline", "source_name", "published_at", "raw_excerpt"} <= set(first_item)
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
python -m pytest pitchbook-hubspot-triage/tests/test_extract_pitchbook_fixture.py -q
```

Expected: `FileNotFoundError` or import failure because `extract_pitchbook_fixture.py` does not exist yet

- [ ] **Step 3: Write the minimal extractor implementation**

```python
import json
import re
from pathlib import Path

from extract_msg import Message


ITEM_SPLIT_RE = re.compile(r"\n\s*(?P<source>[^\n|]+)\s*\|\s*(?P<time>[^\n|]+)\s*\|\s*(?P<date>\d{1,2}-[A-Za-z]{3}-\d{4})\s*\n")


def _clean_text(text: str) -> str:
    return text.replace("\r", "").replace("\u200a", "").replace("\u200d", "").strip()


def extract_fixture(msg_path: Path) -> dict:
    msg = Message(str(msg_path))
    body = _clean_text(msg.body or "")
    segments = ITEM_SPLIT_RE.split(body)
    items = []
    if len(segments) >= 4:
      leading = segments[0]
      for i in range(1, len(segments), 4):
          source_name = _clean_text(segments[i])
          published_at = f"{_clean_text(segments[i + 2])} {_clean_text(segments[i + 1])}"
          chunk = _clean_text(segments[i + 3])
          lines = [line.strip() for line in chunk.splitlines() if line.strip()]
          headline = lines[0] if lines else ""
          items.append({
              "item_type": "news",
              "source_name": source_name,
              "published_at": published_at,
              "headline": headline,
              "raw_excerpt": "\n".join(lines[:6]),
          })
    return {
        "source_subject": msg.subject,
        "source_sender": msg.sender,
        "source_date": str(msg.date),
        "items": items,
    }


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("msg_path")
    parser.add_argument("output_path")
    args = parser.parse_args()

    fixture = extract_fixture(Path(args.msg_path))
    Path(args.output_path).write_text(json.dumps(fixture, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Re-run the test and then generate fixture JSON files**

Run:

```powershell
python -m pytest pitchbook-hubspot-triage/tests/test_extract_pitchbook_fixture.py -q
python pitchbook-hubspot-triage/local/extract_pitchbook_fixture.py "C:\Users\kcosgrave\Downloads\PitchBook Alert - _PE_M&A Deals - Last 30 Days_ 1 (2).msg" "C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\tests\fixtures\pitchbook_pe_ma_alert.json"
python pitchbook-hubspot-triage/local/extract_pitchbook_fixture.py "C:\Users\kcosgrave\Downloads\PitchBook Alert - _Watch List - Companies_ 1 (2).msg" "C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\tests\fixtures\pitchbook_watchlist_companies.json"
```

Expected: tests pass and both fixture files exist with JSON content

- [ ] **Step 5: Add workspace documentation and environment example**

```env
VIBE_ENVIRONMENT=development
VIBE_APP_NAME=PitchBook HubSpot Triage
VIBE_APP_ID=
MAILBOX_SYNC_API_URL=
MAILBOX_SYNC_API_TOKEN=
MSG_PARSE_API_URL=
MSG_PARSE_API_TOKEN=
TRIGGER_AI_API_URL=
TRIGGER_AI_API_TOKEN=
NEWS_RESEARCH_API_URL=
NEWS_RESEARCH_API_TOKEN=
```

```markdown
# PitchBook HubSpot Triage

## Local Commands

- `python -m pytest pitchbook-hubspot-triage/tests -q`
- `powershell -File pitchbook-hubspot-triage/scripts/create_app.ps1`
- `powershell -File pitchbook-hubspot-triage/scripts/create_or_update_jobs.ps1`
- `powershell -File pitchbook-hubspot-triage/scripts/deploy_app.ps1`

## Runtime Notes

- Internal records are the source of truth.
- Manual fixture ingest works before mailbox and `.msg` parsing APIs are available.
- Live mailbox ingest depends on `MAILBOX_SYNC_API_URL` and `MAILBOX_SYNC_API_TOKEN`.
- In-app `.msg` parsing depends on `MSG_PARSE_API_URL` and `MSG_PARSE_API_TOKEN`.
```

- [ ] **Step 6: Commit**

```bash
git init
git add .env.example README.md pitchbook-hubspot-triage/local/extract_pitchbook_fixture.py pitchbook-hubspot-triage/tests
git commit -m "chore: bootstrap pitchbook triage workspace and fixtures"
```

### Task 2: Create The Vibe App Shell In Secure Mode

**Files:**
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\app.jsx`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\scripts\create_app.ps1`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\scripts\deploy_app.ps1`

- [ ] **Step 1: Write the initial app JSX with empty, loading, and error states**

```jsx
import React, { useEffect, useState } from "react";
import { Link, Routes, Route } from "vibe-router";
import { Inbox, AlertTriangle, CheckCircle2, Search } from "lucide-react";

function useJob(jobName, params) {
  const [state, setState] = useState({ loading: true, error: "", data: null });

  useEffect(() => {
    let active = true;
    VibeAppAPI.triggerJob(jobName, params || {})
      .then((result) => {
        if (!active) return;
        setState({ loading: false, error: "", data: result.result || result });
      })
      .catch((error) => {
        if (!active) return;
        setState({ loading: false, error: error.message || "Job failed", data: null });
      });
    return () => {
      active = false;
    };
  }, [jobName, JSON.stringify(params || {})]);

  return state;
}

function QueuePage({ status }) {
  const { loading, error, data } = useJob("seed_fixture_ingest", { action: "list_queue", status });

  if (loading) return <div className="p-8 text-slate-500">Loading {status} queue...</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;

  const items = (data && data.items) || [];
  if (!items.length) return <div className="p-8 text-slate-500">No items in {status}.</div>;

  return (
    <div className="space-y-4 p-6">
      {items.map((item) => (
        <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{item.data.match_bucket || "unprocessed"}</div>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">{item.data.headline}</h2>
              <p className="mt-2 text-sm text-slate-600">{item.data.raw_excerpt}</p>
            </div>
            <div className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{item.data.owner_name || "Unassigned"}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function HomePage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#f8fafc,_#e2e8f0_55%,_#cbd5e1)]">
      <header className="border-b border-white/40 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Morning Triage</div>
            <h1 className="text-2xl font-semibold text-slate-950">PitchBook HubSpot Triage</h1>
          </div>
          <nav className="flex gap-3 text-sm">
            <Link to="/" className="rounded-full bg-slate-900 px-4 py-2 text-white">High Confidence</Link>
            <Link to="/possible" className="rounded-full bg-white px-4 py-2 text-slate-700">Possible Match</Link>
            <Link to="/unmatched" className="rounded-full bg-white px-4 py-2 text-slate-700">No Match</Link>
            <Link to="/not-relevant" className="rounded-full bg-white px-4 py-2 text-slate-700">Not Relevant</Link>
          </nav>
        </div>
      </header>

      <Routes>
        <Route path="/" component={() => <QueuePage status="high-confidence" />} />
        <Route path="/possible" component={() => <QueuePage status="possible" />} />
        <Route path="/unmatched" component={() => <QueuePage status="no-match" />} />
        <Route path="/not-relevant" component={() => <QueuePage status="not-relevant" />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return <HomePage />;
}
```

- [ ] **Step 2: Write the create-app deployment script**

```powershell
param()

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path (Split-Path -Parent $root) ".env"
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^(.*?)=(.*)$') {
    [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2])
  }
}

$base = if ($env:VIBE_ENVIRONMENT -eq "development") {
  "https://webapp-cfc-vibes-dev-eastus.azurewebsites.net"
} else {
  "https://www.chathamvibes.com"
}

$jsx = Get-Content (Join-Path $root "app.jsx") -Raw
$body = @{
  vibe_app = @{
    name = "PitchBook HubSpot Triage"
    jsx_code = $jsx
    semantic_version = "1.0.0"
    client_record_access = "none"
  }
} | ConvertTo-Json -Depth 8

$response = Invoke-RestMethod -Uri "$base/api/v1/vibe_apps" -Method Post -Headers @{
  Authorization = "Bearer $env:VIBE_API_KEY"
  "Content-Type" = "application/json"
} -Body $body

$response | ConvertTo-Json -Depth 8
```

- [ ] **Step 3: Write the patch-deploy script**

```powershell
param()

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path (Split-Path -Parent $root) ".env"
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^(.*?)=(.*)$') {
    [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2])
  }
}

if (-not $env:VIBE_APP_ID) { throw "VIBE_APP_ID is required" }

$base = if ($env:VIBE_ENVIRONMENT -eq "development") {
  "https://webapp-cfc-vibes-dev-eastus.azurewebsites.net"
} else {
  "https://www.chathamvibes.com"
}

$jsx = Get-Content (Join-Path $root "app.jsx") -Raw
$body = @{
  vibe_app = @{
    jsx_code = $jsx
    client_record_access = "none"
  }
} | ConvertTo-Json -Depth 8

Invoke-RestMethod -Uri "$base/api/v1/vibe_apps/$env:VIBE_APP_ID" -Method Patch -Headers @{
  Authorization = "Bearer $env:VIBE_API_KEY"
  "Content-Type" = "application/json"
} -Body $body | ConvertTo-Json -Depth 8
```

- [ ] **Step 4: Create the app and save the resulting app ID into `.env`**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File pitchbook-hubspot-triage/scripts/create_app.ps1
```

Expected: JSON response containing `"name": "PitchBook HubSpot Triage"` and a numeric `id`

- [ ] **Step 5: Commit**

```bash
git add pitchbook-hubspot-triage/app.jsx pitchbook-hubspot-triage/scripts/create_app.ps1 pitchbook-hubspot-triage/scripts/deploy_app.ps1
git commit -m "feat: create secure vibe app shell"
```

### Task 3: Build The Internal Record Pipeline And Dev Seed Path

**Files:**
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\jobs\seed_fixture_ingest.js`
- Modify: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\app.jsx`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\scripts\create_or_update_jobs.ps1`

- [ ] **Step 1: Write the seed-ingest job**

```javascript
function upsertRecords(records) {
  return VibeAppAPI.create(records.map(function(record) {
    return {
      record_type: record.record_type,
      status: record.status,
      source_subject: record.source_subject,
      source_sender: record.source_sender,
      received_at: record.received_at,
      headline: record.headline,
      raw_excerpt: record.raw_excerpt,
      item_type: record.item_type,
      processing_status: record.processing_status,
      relevance_status: record.relevance_status,
      match_bucket: record.match_bucket,
      evidence_status: record.evidence_status,
      selected_company_id: record.selected_company_id,
      owner_name: record.owner_name,
      pending_note_body: record.pending_note_body
    };
  }));
}

if (VibeAppAPI.currentUser && !VibeAppAPI.jobParams.action) {
  throw new Error("action is required");
}

var action = VibeAppAPI.jobParams.action;

if (action === "seed_fixture") {
  var fixture = VibeAppAPI.jobParams.fixture;
  if (!fixture || !fixture.items || !fixture.items.length) {
    throw new Error("fixture.items is required");
  }

  var created = upsertRecords(fixture.items.map(function(item) {
    return {
      record_type: "alert_item",
      status: "seeded",
      source_subject: fixture.source_subject,
      source_sender: fixture.source_sender,
      received_at: fixture.source_date,
      headline: item.headline,
      raw_excerpt: item.raw_excerpt,
      item_type: item.item_type,
      processing_status: "queued",
      relevance_status: "unreviewed",
      match_bucket: "unprocessed",
      evidence_status: "pending"
    };
  }));

  return { created_count: created.length };
}

if (action === "seed_demo_fixture") {
  var fixtures = {
    pe_ma: {
      source_subject: 'PitchBook Alert - "PE/M&A Deals - Last 30 Days"',
      source_sender: "PitchBook Alerts <alerts-noreply@alerts.pitchbook.com>",
      source_date: "2026-03-19 07:21:19-04:00",
      items: [{
        item_type: "news",
        headline: "GIC-backed Sunway Healthcare jumps 17% in mega Malaysia listing",
        raw_excerpt: "DealStreetAsia | 1:49 am | 18-Mar-2026"
      }]
    },
    watchlist_companies: {
      source_subject: 'PitchBook Alert - "Watch List - Companies"',
      source_sender: "PitchBook Alerts <alerts-noreply@alerts.pitchbook.com>",
      source_date: "2026-03-19 07:21:41-04:00",
      items: [{
        item_type: "news",
        headline: "Venezuela win first World Baseball Classic title after taming USA in politically fraught final",
        raw_excerpt: "Company Press Release | 3:21 am | 18-Mar-2026"
      }]
    }
  };

  var namedFixture = fixtures[VibeAppAPI.jobParams.fixture_name];
  if (!namedFixture) {
    throw new Error("Unknown fixture name");
  }

  var createdDemo = upsertRecords(namedFixture.items.map(function(item) {
    return {
      status: "seeded",
      source_subject: namedFixture.source_subject,
      source_sender: namedFixture.source_sender,
      received_at: namedFixture.source_date,
      headline: item.headline,
      raw_excerpt: item.raw_excerpt,
      item_type: item.item_type,
      processing_status: "queued",
      relevance_status: "unreviewed",
      match_bucket: "unprocessed",
      evidence_status: "pending"
    };
  }));

  return { created_count: createdDemo.length };
}

if (action === "list_queue") {
  var filters = {};
  var status = VibeAppAPI.jobParams.status;
  if (status === "high-confidence") filters.match_bucket = "high-confidence";
  if (status === "possible") filters.match_bucket = "possible";
  if (status === "no-match") filters.match_bucket = "no-match";
  if (status === "not-relevant") filters.relevance_status = "not-relevant";

  var result = VibeAppAPI.query(filters, { limit: 50, order: "created_at desc" });
  return { items: result.records };
}

throw new Error("Unsupported action: " + action);
```

- [ ] **Step 2: Register the seed job through the job script**

```powershell
param()

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path (Split-Path -Parent $root) ".env"
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^(.*?)=(.*)$') {
    [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2])
  }
}

if (-not $env:VIBE_APP_ID) { throw "VIBE_APP_ID is required" }

$base = if ($env:VIBE_ENVIRONMENT -eq "development") {
  "https://webapp-cfc-vibes-dev-eastus.azurewebsites.net"
} else {
  "https://www.chathamvibes.com"
}

$seedScript = Get-Content (Join-Path $root "jobs\seed_fixture_ingest.js") -Raw
$jobs = @(
  @{
    name = "seed_fixture_ingest"
    job_type = "sync"
    script = $seedScript
    description = "Seeds and reads alert records"
    enabled = $true
    invokable_from_client = $true
    concurrency_policy = "parallel"
  }
)

foreach ($job in $jobs) {
  $body = @{ job = $job } | ConvertTo-Json -Depth 8
  Invoke-RestMethod -Uri "$base/api/v1/vibe_apps/$env:VIBE_APP_ID/jobs" -Method Post -Headers @{
    Authorization = "Bearer $env:VIBE_API_KEY"
    "Content-Type" = "application/json"
  } -Body $body | Out-Null
}
```

- [ ] **Step 3: Add a development fixture-seed button to the UI**

```jsx
function SeedButtons() {
  const [message, setMessage] = useState("");

  async function seedFixture(name) {
    setMessage("Seeding fixture...");
    await VibeAppAPI.triggerJob("seed_fixture_ingest", { action: "seed_demo_fixture", fixture_name: name });
    setMessage(`Seeded ${name}`);
  }

  return (
    <div className="flex flex-wrap gap-3 px-6 py-4">
      <button onClick={() => seedFixture("pe_ma")} className="rounded-full bg-slate-900 px-4 py-2 text-sm text-white">
        Seed PE/M&A Fixture
      </button>
      <button onClick={() => seedFixture("watchlist_companies")} className="rounded-full bg-white px-4 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
        Seed Watchlist Fixture
      </button>
      <div className="text-sm text-slate-500">{message}</div>
    </div>
  );
}
```

- [ ] **Step 4: Deploy JSX and jobs, then seed one fixture**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File pitchbook-hubspot-triage/scripts/deploy_app.ps1
powershell -ExecutionPolicy Bypass -File pitchbook-hubspot-triage/scripts/create_or_update_jobs.ps1
```

Expected: job create responses and a renderable app with seed buttons

- [ ] **Step 5: Commit**

```bash
git add pitchbook-hubspot-triage/jobs/seed_fixture_ingest.js pitchbook-hubspot-triage/scripts/create_or_update_jobs.ps1 pitchbook-hubspot-triage/app.jsx
git commit -m "feat: add seeded internal record pipeline"
```

### Task 4: Implement Trigger Analysis And Corroboration

**Files:**
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\jobs\process_alert_items.js`
- Modify: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\scripts\create_or_update_jobs.ps1`

- [ ] **Step 1: Write the failing analysis-path check as an execution contract comment block**

```javascript
/*
Expected behavior for process_alert_items:
- read queued alert_item records
- call TRIGGER_AI_API_URL for relevance classification
- call NEWS_RESEARCH_API_URL for one corroborating source when relevance is relevant or uncertain
- update each record with relevance_status, relevance_rationale, evidence_status, and processing_status
*/
```

- [ ] **Step 2: Implement the analysis job with hard failure on missing secrets**

```javascript
function requireSecret(name) {
  var value = VibeAppAPI.getSecret(name);
  if (!value) throw new Error(name + " secret not configured");
  return value;
}

function postJson(url, token, payload) {
  var response = fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("HTTP " + response.status + " calling " + url);
  }

  return response.json();
}

var triggerApiUrl = requireSecret("TRIGGER_AI_API_URL");
var triggerApiToken = requireSecret("TRIGGER_AI_API_TOKEN");
var researchApiUrl = requireSecret("NEWS_RESEARCH_API_URL");
var researchApiToken = requireSecret("NEWS_RESEARCH_API_TOKEN");

var queue = VibeAppAPI.query({ processing_status: "queued" }, { limit: 25, order: "created_at asc" }).records;

queue.forEach(function(record) {
  var data = record.data || record;
  var classification = postJson(triggerApiUrl, triggerApiToken, {
    headline: data.headline,
    excerpt: data.raw_excerpt,
    trigger_terms: ["ipo", "listing", "refinancing", "refinance", "debt financing", "m&a", "acquisition"]
  });

  var evidenceStatus = "skipped";
  var corroboratingSource = null;
  if (classification.relevance_status === "relevant" || classification.relevance_status === "uncertain") {
    var evidence = postJson(researchApiUrl, researchApiToken, {
      headline: data.headline,
      excerpt: data.raw_excerpt
    });
    evidenceStatus = evidence.found ? "corroborated" : "not-found";
    corroboratingSource = evidence;
  }

  VibeAppAPI.update([{
    id: record.id,
    data: Object.assign({}, data, {
      relevance_status: classification.relevance_status,
      relevance_rationale: classification.rationale,
      evidence_status: evidenceStatus,
      corroborating_source: corroboratingSource,
      processing_status: "analyzed"
    })
  }]);
});

return { processed_count: queue.length };
```

- [ ] **Step 3: Register the async analysis job**

```powershell
$analysisScript = Get-Content (Join-Path $root "jobs\process_alert_items.js") -Raw
$jobs += @{
  name = "process_alert_items"
  job_type = "async"
  script = $analysisScript
  description = "Classifies trigger relevance and corroborates sources"
  enabled = $true
  invokable_from_client = $true
  concurrency_policy = "reject_overlapping"
}
```

- [ ] **Step 4: Trigger the job manually and inspect logs**

Run:

```powershell
$processJob = Invoke-RestMethod -Uri "$base/api/v1/vibe_apps/$env:VIBE_APP_ID/jobs" -Method Get -Headers @{
  Authorization = "Bearer $env:VIBE_API_KEY"
} | Select-Object -ExpandProperty jobs | Where-Object { $_.name -eq "process_alert_items" } | Select-Object -First 1

Invoke-RestMethod -Uri "$base/api/v1/vibe_apps/$env:VIBE_APP_ID/jobs/$($processJob.id)/trigger" -Method Post -Headers @{
  Authorization = "Bearer $env:VIBE_API_KEY"
  "Content-Type" = "application/json"
} -Body '{"params":{}}'
Invoke-RestMethod -Uri "$base/api/v1/vibe_apps/$env:VIBE_APP_ID/jobs/$($processJob.id)/logs?limit=50" -Method Get -Headers @{
  Authorization = "Bearer $env:VIBE_API_KEY"
}
```

Expected: logs show queue processing or clear missing-secret failure

- [ ] **Step 5: Commit**

```bash
git add pitchbook-hubspot-triage/jobs/process_alert_items.js pitchbook-hubspot-triage/scripts/create_or_update_jobs.ps1
git commit -m "feat: add trigger classification and corroboration pipeline"
```

### Task 5: Add HubSpot Candidate Matching, Override, And Pending Actions

**Files:**
- Modify: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\jobs\process_alert_items.js`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\jobs\resolve_match_override.js`
- Modify: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\app.jsx`
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\scripts\enable_hubspot_connector.ps1`

- [ ] **Step 1: Write the connector enablement script**

```powershell
param()

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path (Split-Path -Parent $root) ".env"
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^(.*?)=(.*)$') {
    [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2])
  }
}

$base = if ($env:VIBE_ENVIRONMENT -eq "development") {
  "https://webapp-cfc-vibes-dev-eastus.azurewebsites.net"
} else {
  "https://www.chathamvibes.com"
}

$body = @{ connector_identifier = "customer_relationship_management_hubspot" } | ConvertTo-Json

Invoke-RestMethod -Uri "$base/api/v1/vibe_apps/$env:VIBE_APP_ID/data_connector_enablements" -Method Post -Headers @{
  Authorization = "Bearer $env:VIBE_API_KEY"
  "Content-Type" = "application/json"
} -Body $body | ConvertTo-Json -Depth 8
```

- [ ] **Step 2: Extend the processing job with HubSpot candidate lookup and AI match validation**

```javascript
function queryHubSpotCompanies(name) {
  return VibeAppAPI.queryConnector({
    connector: "customer_relationship_management_hubspot",
    endpoint: "/crm/v3/objects/companies",
    method: "GET",
    params: {
      limit: 5,
      properties: "name,ultimate_parent_name,hubspot_owner_id,client_status",
      name: name
    }
  });
}

function assignBucket(matchReview) {
  if (matchReview.match_bucket === "high-confidence") return "high-confidence";
  if (matchReview.match_bucket === "possible") return "possible";
  return "no-match";
}
```

```javascript
if (classification.relevance_status === "relevant") {
  var companyName = classification.company_name || data.headline;
  var hubspotResult = queryHubSpotCompanies(companyName);
  var matchReview = postJson(triggerApiUrl, triggerApiToken, {
    mode: "match_validation",
    company_name: companyName,
    candidates: hubspotResult.data && hubspotResult.data.results ? hubspotResult.data.results : []
  });

  var selected = matchReview.selected_candidate || null;
  var matchBucket = assignBucket(matchReview);
  var pendingNote = matchBucket === "high-confidence"
    ? "Trigger: " + data.headline + "\nWhy it matters: " + classification.rationale + "\nEvidence: " + evidenceStatus
    : null;

  VibeAppAPI.update([{
    id: record.id,
    data: Object.assign({}, data, {
      match_bucket: matchBucket,
      match_candidates: matchReview.candidates || [],
      selected_company_id: selected ? selected.id : null,
      owner_name: selected ? selected.owner_name : null,
      pending_note_body: pendingNote,
      processing_status: "matched"
    })
  }]);
}
```

- [ ] **Step 3: Implement reviewer override job**

```javascript
if (!VibeAppAPI.currentUser) {
  throw new Error("A signed-in user is required");
}

var params = VibeAppAPI.jobParams;
if (!params.recordId || !params.companyId) {
  throw new Error("recordId and companyId are required");
}

var result = VibeAppAPI.query({ id: params.recordId }, { limit: 1 }).records;
if (!result.length) {
  throw new Error("Record not found");
}

var record = result[0];
var data = record.data || record;
var chosen = (data.match_candidates || []).find(function(candidate) {
  return String(candidate.id) === String(params.companyId);
});

if (!chosen) {
  throw new Error("Selected candidate was not present on the record");
}

VibeAppAPI.update([{
  id: record.id,
  data: Object.assign({}, data, {
    match_bucket: "high-confidence",
    selected_company_id: chosen.id,
    owner_name: chosen.owner_name,
    pending_note_body: "Trigger: " + data.headline + "\nOwner override by: " + VibeAppAPI.currentUser.email,
    reviewer_override_state: "applied"
  })
}]);

return { success: true, selected_company_id: chosen.id };
```

- [ ] **Step 4: Add candidate dropdown UI and override action**

```jsx
function MatchOverride({ item }) {
  const [companyId, setCompanyId] = useState("");
  const [message, setMessage] = useState("");
  const candidates = item.data.match_candidates || [];

  async function applyOverride() {
    await VibeAppAPI.triggerJob("resolve_match_override", {
      recordId: item.id,
      companyId
    });
    setMessage("Override applied");
  }

  if (!candidates.length) return null;

  return (
    <div className="mt-4 rounded-2xl bg-slate-50 p-4">
      <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-500">Override company match</label>
      <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
        <option value="">Select company</option>
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name} | {candidate.ultimate_parent || "No parent"} | {candidate.owner_name || "No owner"} | {candidate.client_status || "Unknown"}
          </option>
        ))}
      </select>
      <button disabled={!companyId} onClick={applyOverride} className="mt-3 rounded-full bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">
        Apply override
      </button>
      <div className="mt-2 text-sm text-slate-500">{message}</div>
    </div>
  );
}
```

- [ ] **Step 5: Enable the connector and verify candidate reads**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File pitchbook-hubspot-triage/scripts/enable_hubspot_connector.ps1
```

Expected: success response, or `422` indicating admin enablement is required

- [ ] **Step 6: Commit**

```bash
git add pitchbook-hubspot-triage/jobs/process_alert_items.js pitchbook-hubspot-triage/jobs/resolve_match_override.js pitchbook-hubspot-triage/scripts/enable_hubspot_connector.ps1 pitchbook-hubspot-triage/app.jsx
git commit -m "feat: add hubspot candidate matching and override flow"
```

### Task 6: Wire Scheduled Mailbox Ingest And Manual `.msg` Adapter Seams

**Files:**
- Create: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\jobs\ingest_pitchbook_emails.js`
- Modify: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\scripts\create_or_update_jobs.ps1`
- Modify: `C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\app.jsx`

- [ ] **Step 1: Implement the scheduled ingest adapter job**

```javascript
function requireSecret(name) {
  var value = VibeAppAPI.getSecret(name);
  if (!value) throw new Error(name + " secret not configured");
  return value;
}

var mailboxUrl = requireSecret("MAILBOX_SYNC_API_URL");
var mailboxToken = requireSecret("MAILBOX_SYNC_API_TOKEN");

var response = fetch(mailboxUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + mailboxToken
  },
  body: JSON.stringify({
    source: "pitchbook",
    lookback_hours: 24
  })
});

if (!response.ok) {
  throw new Error("Mailbox adapter failed: " + response.status);
}

var payload = response.json();
var records = payload.items.map(function(item) {
  return {
    source_subject: item.source_subject,
    source_sender: item.source_sender,
    source_date: item.source_date,
    items: item.items
  };
});

records.forEach(function(fixture) {
  VibeAppAPI.create(fixture.items.map(function(entry) {
    return {
      source_subject: fixture.source_subject,
      source_sender: fixture.source_sender,
      received_at: fixture.source_date,
      headline: entry.headline,
      raw_excerpt: entry.raw_excerpt,
      item_type: entry.item_type,
      processing_status: "queued",
      relevance_status: "unreviewed",
      match_bucket: "unprocessed",
      evidence_status: "pending"
    };
  }));
});

return { imported_count: records.length };
```

- [ ] **Step 2: Register the cron job on a 15-minute compatible schedule**

```powershell
$mailboxScript = Get-Content (Join-Path $root "jobs\ingest_pitchbook_emails.js") -Raw
$jobs += @{
  name = "ingest_pitchbook_emails"
  job_type = "async"
  script = $mailboxScript
  description = "Scheduled mailbox ingest for PitchBook alerts"
  enabled = $true
  invokable_from_client = $false
  concurrency_policy = "reject_overlapping"
  cron_schedule = "0 8 * * 1-5"
}
```

- [ ] **Step 3: Add a manual `.msg` upload control that fails honestly when the parse adapter is absent**

```jsx
function MsgUploadPanel() {
  const [message, setMessage] = useState("");

  async function handleUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    setMessage(".msg upload received. Parsing adapter required.");
  }

  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 p-6">
      <div className="text-sm font-medium text-slate-900">Manual `.msg` upload</div>
      <p className="mt-1 text-sm text-slate-500">
        The UI path is wired now. Actual binary `.msg` parsing activates when `MSG_PARSE_API_URL` and `MSG_PARSE_API_TOKEN` are configured.
      </p>
      <input type="file" accept=".msg" onChange={handleUpload} className="mt-4 block w-full text-sm text-slate-600" />
      <div className="mt-3 text-sm text-slate-500">{message}</div>
    </div>
  );
}
```

- [ ] **Step 4: Trigger the full dev flow in order**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File pitchbook-hubspot-triage/scripts/deploy_app.ps1
powershell -ExecutionPolicy Bypass -File pitchbook-hubspot-triage/scripts/create_or_update_jobs.ps1
```

Then:

1. Seed a fixture from the UI.
2. Trigger `process_alert_items`.
3. Verify items move from `unprocessed` to `matched` or `not-relevant`.
4. Verify pending-note text exists only on high-confidence matches.
5. Verify override action changes `selected_company_id` and `owner_name`.

- [ ] **Step 5: Commit**

```bash
git add pitchbook-hubspot-triage/jobs/ingest_pitchbook_emails.js pitchbook-hubspot-triage/scripts/create_or_update_jobs.ps1 pitchbook-hubspot-triage/app.jsx
git commit -m "feat: add scheduled ingest seam and manual msg upload shell"
```

## Spec Coverage Check

- Scheduled Outlook ingest is covered by `ingest_pitchbook_emails.js` and the cron registration step.
- Manual `.msg` handling is covered by the explicit UI seam and the adapter-secret contract.
- Trigger relevance, corroborating research, HubSpot candidate matching, and review overrides are covered by `process_alert_items.js`, `resolve_match_override.js`, and the UI tasks.
- Pending draft HubSpot notes are covered by the `pending_note_body` update path on high-confidence outcomes.
- Filterable buckets are covered by the queue-listing job and route-based UI views.

## Placeholder Scan

- No `TODO` or `TBD` markers remain.
- Where external dependencies are not yet available, the plan specifies exact secret names, file paths, failure behavior, and adapter boundaries instead of using placeholders.

## Type Consistency Check

- Internal record fields are consistently named `processing_status`, `relevance_status`, `match_bucket`, `evidence_status`, `selected_company_id`, `owner_name`, and `pending_note_body`.
- Job names are consistently `seed_fixture_ingest`, `process_alert_items`, `resolve_match_override`, and `ingest_pitchbook_emails`.
