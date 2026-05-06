# PitchBook HubSpot Triage

## Local Commands

- `python -m pytest pitchbook-hubspot-triage/tests -q`
- `python -m pytest pitchbook-hubspot-triage/tests/test_extract_pitchbook_fixture.py -q`
- `python pitchbook-hubspot-triage/local/extract_pitchbook_fixture.py /path/to/sample.msg pitchbook-hubspot-triage/tests/fixtures/output.json`
- `powershell -File pitchbook-hubspot-triage/scripts/create_app.ps1`
- `powershell -File pitchbook-hubspot-triage/scripts/create_or_update_jobs.ps1`
- `powershell -File pitchbook-hubspot-triage/scripts/deploy_app.ps1`

## Runtime Notes

- Internal records are the source of truth for downstream review and pending actions.
- Manual fixture extraction is the reliable local bootstrap path before mailbox and `.msg` parsing APIs exist.
- The committed JSON fixtures under `pitchbook-hubspot-triage/tests/fixtures/` are the portable test corpus for a fresh checkout.
- The sample `.msg` extraction test skips cleanly when the external sample files are not available on the local machine.
- `extract_fixture()` raises an error if a message parses successfully but yields no news items, so bad inputs do not look like valid empty fixtures.
- Live mailbox ingest depends on `MAILBOX_SYNC_API_URL` and `MAILBOX_SYNC_API_TOKEN`.
- In-app `.msg` parsing depends on `MSG_PARSE_API_URL` and `MSG_PARSE_API_TOKEN`.
- Trigger classification depends on `TRIGGER_AI_API_URL` and `TRIGGER_AI_API_TOKEN`.
- Corroborating source lookup depends on `NEWS_RESEARCH_API_URL` and `NEWS_RESEARCH_API_TOKEN`.
