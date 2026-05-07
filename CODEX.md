# Codex Notes

## Repo Purpose

This repo builds and deploys the `PitchBook HubSpot Triage` Vibe app. The app ingests PitchBook alert emails, classifies relevance, matches companies to HubSpot, and creates reviewable queue items for the business team.

## Working Norms

- Treat internal Vibe records as server-owned.
- Keep browser record access at `read` unless there is a strong reason to loosen it.
- Route writes through trusted jobs instead of client-side `VibeAppAPI.create()` or `VibeAppAPI.update()`.
- Prefer updating hosted jobs and app code together so GitHub and the live app do not drift.

## Current Hosted Shape

- Hosted app id: `364`
- Environment: `development`
- Browser record access: `read`
- Mailbox auth: Microsoft Entra delegated popup flow
- HubSpot matching: hosted PAT fallback is available

## Important Known Issue

The Entra auth flow currently persists `auth_exchange_request` state from the frontend helper in [pitchbook-hubspot-triage/app.jsx](C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\app.jsx). With browser access reduced to `read`, that write path must be moved into a trusted sync job before sign-in can work cleanly.

Recommended fix:

1. Add a client-invokable sync job such as `upsert_auth_exchange_request`.
2. Move the `auth_exchange_request` create/update logic out of the frontend and into that job.
3. Keep `client_record_access` at `read`.

## Key Commands

- Run tests: `python -m pytest -q`
- Deploy app shell: `powershell -File pitchbook-hubspot-triage/scripts/deploy_app.ps1`
- Register jobs: `powershell -File pitchbook-hubspot-triage/scripts/create_or_update_jobs.ps1`

## Files To Check First

- [pitchbook-hubspot-triage/app.jsx](C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\app.jsx)
- [pitchbook-hubspot-triage/scripts/deploy_app.ps1](C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\scripts\deploy_app.ps1)
- [pitchbook-hubspot-triage/scripts/create_or_update_jobs.ps1](C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\scripts\create_or_update_jobs.ps1)
- [pitchbook-hubspot-triage/jobs/exchange_auth_code.js](C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\jobs\exchange_auth_code.js)
- [pitchbook-hubspot-triage/jobs/ingest_pitchbook_emails.js](C:\Users\kcosgrave\Downloads\JudyPEProject\pitchbook-hubspot-triage\jobs\ingest_pitchbook_emails.js)
