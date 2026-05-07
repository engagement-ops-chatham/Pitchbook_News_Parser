# PitchBook HubSpot Triage

Vibe app and job pipeline for turning daily PitchBook alert emails into triaged, owner-assigned review items with HubSpot matching, relevance classification, and pending downstream actions.

## What Exists

- Hosted Vibe app shell with review queues and secure job-backed actions.
- Live Microsoft 365 mailbox integration through Microsoft Entra delegated auth.
- Manual pasted-email ingest for testing plain-text PitchBook emails.
- Manual `.msg` upload seam in the UI.
- HubSpot company matching with hosted PAT fallback.
- Morning scheduled ingest job at `8:00 AM` weekdays.

## Current Architecture

- Browser access is `read` only for internal Vibe records.
- Any create or update path must go through trusted jobs.
- Review queues read internal records.
- Matching, enrichment, and ingest writes happen server-side.

## Current Limitations

- In-app `.msg` parsing still requires `MSG_PARSE_API_URL` and `MSG_PARSE_API_TOKEN`.
- Trigger classification still requires `TRIGGER_AI_API_URL` and `TRIGGER_AI_API_TOKEN`.
- Corroborating-source lookup still requires `NEWS_RESEARCH_API_URL` and `NEWS_RESEARCH_API_TOKEN`.
- The Entra sign-in flow currently depends on a trusted write path for `auth_exchange_request` records. If browser sign-in reports direct-write blocking, that flow still needs to be routed through a dedicated sync job.

## Hosted Secrets In Use

- `VIBE_API_KEY`
- `VIBE_APP_ID`
- `ENTRA_CLIENT_ID`
- `ENTRA_CLIENT_SECRET`
- `ENTRA_TENANT_ID`
- `ENTRA_REDIRECT_URI`
- `HUBSPOT_PRIVATE_APP_TOKEN`

## Local Commands

- `python -m pip install -r requirements.txt`
- `python -m pytest -q`
- `node pitchbook-hubspot-triage/tests/test_exchange_auth_code.js`
- `node pitchbook-hubspot-triage/tests/test_seed_fixture_ingest.js`
- `powershell -File pitchbook-hubspot-triage/scripts/create_app.ps1`
- `powershell -File pitchbook-hubspot-triage/scripts/create_or_update_jobs.ps1`
- `powershell -File pitchbook-hubspot-triage/scripts/deploy_app.ps1`

## Key Files

- App shell: [pitchbook-hubspot-triage/app.jsx](C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\app.jsx)
- Job registration: [pitchbook-hubspot-triage/scripts/create_or_update_jobs.ps1](C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\scripts\create_or_update_jobs.ps1)
- App deploy script: [pitchbook-hubspot-triage/scripts/deploy_app.ps1](C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\scripts\deploy_app.ps1)
- Mailbox ingest: [pitchbook-hubspot-triage/jobs/ingest_pitchbook_emails.js](C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\jobs\ingest_pitchbook_emails.js)
- Auth code exchange: [pitchbook-hubspot-triage/jobs/exchange_auth_code.js](C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\jobs\exchange_auth_code.js)

## Test Corpus

- Portable fixtures live under [pitchbook-hubspot-triage/tests/fixtures](C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\tests\fixtures)
- The local `.msg` extractor path is still useful for converting samples into stable JSON fixtures when the raw sample files are available
