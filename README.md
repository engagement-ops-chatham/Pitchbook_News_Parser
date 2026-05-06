# PitchBook HubSpot Triage

## Local Commands

- `python -m pytest pitchbook-hubspot-triage/tests -q`
- `python pitchbook-hubspot-triage/local/extract_pitchbook_fixture.py "C:\Users\kcosgrave\Downloads\PitchBook Alert - _PE_M&A Deals - Last 30 Days_ 1 (2).msg" "pitchbook-hubspot-triage\tests\fixtures\pitchbook_pe_ma_alert.json"`
- `python pitchbook-hubspot-triage/local/extract_pitchbook_fixture.py "C:\Users\kcosgrave\Downloads\PitchBook Alert - _Watch List - Companies_ 1 (2).msg" "pitchbook-hubspot-triage\tests\fixtures\pitchbook_watchlist_companies.json"`
- `powershell -File pitchbook-hubspot-triage/scripts/create_app.ps1`
- `powershell -File pitchbook-hubspot-triage/scripts/create_or_update_jobs.ps1`
- `powershell -File pitchbook-hubspot-triage/scripts/deploy_app.ps1`

## Runtime Notes

- Internal records are the source of truth for downstream review and pending actions.
- Manual fixture extraction is the reliable local bootstrap path before mailbox and `.msg` parsing APIs exist.
- Live mailbox ingest depends on `MAILBOX_SYNC_API_URL` and `MAILBOX_SYNC_API_TOKEN`.
- In-app `.msg` parsing depends on `MSG_PARSE_API_URL` and `MSG_PARSE_API_TOKEN`.
- Trigger classification depends on `TRIGGER_AI_API_URL` and `TRIGGER_AI_API_TOKEN`.
- Corroborating source lookup depends on `NEWS_RESEARCH_API_URL` and `NEWS_RESEARCH_API_TOKEN`.
