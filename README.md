# PitchBook HubSpot Triage

## Local Commands

- `python -m pytest pitchbook-hubspot-triage/tests -q`
- `python -m pytest pitchbook-hubspot-triage/tests/test_extract_pitchbook_fixture.py -q`
- `python pitchbook-hubspot-triage/local/extract_pitchbook_fixture.py /path/to/sample.msg pitchbook-hubspot-triage/tests/fixtures/output.json`

## Runtime Notes

- Manual fixture extraction is the reliable local bootstrap path before mailbox and `.msg` parsing APIs exist.
- The committed JSON fixtures under `pitchbook-hubspot-triage/tests/fixtures/` are the portable test corpus for a fresh checkout.
- The sample `.msg` extraction test skips cleanly when the external sample files are not available on the local machine.
- `extract_fixture()` raises an error if a message parses successfully but yields no news items, so bad inputs do not look like valid empty fixtures.
