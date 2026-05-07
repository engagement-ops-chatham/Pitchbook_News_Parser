from pathlib import Path


def test_process_alert_items_job_is_server_only() -> None:
    script = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "create_or_update_jobs.ps1"
    ).read_text(encoding="utf-8")

    assert 'name = "process_alert_items"' in script
    assert "job_type = \"async\"" in script
    assert "invokable_from_client = $false" in script


def test_resolve_match_override_job_is_client_invokable() -> None:
    script = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "create_or_update_jobs.ps1"
    ).read_text(encoding="utf-8")

    assert 'name = "resolve_match_override"' in script
    assert "job_type = \"sync\"" in script
    assert "description = \"Applies reviewer-selected HubSpot match overrides\"" in script
    assert "invokable_from_client = $true" in script


def test_ingest_pitchbook_emails_job_is_scheduled_server_only() -> None:
    script = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "create_or_update_jobs.ps1"
    ).read_text(encoding="utf-8")

    assert 'name = "ingest_pitchbook_emails"' in script
    assert "job_type = \"async\"" in script
    assert "description = \"Scheduled mailbox ingest for PitchBook alerts\"" in script
    assert "invokable_from_client = $true" in script
    assert "cron_schedule = \"0 8 * * 1-5\"" in script


def test_entra_auth_jobs_are_registered_for_client_use() -> None:
    script = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "create_or_update_jobs.ps1"
    ).read_text(encoding="utf-8")

    assert 'name = "bootstrap_auth_config"' in script
    assert 'name = "exchange_auth_code"' in script
    assert 'name = "load_mailbox_connection"' in script
    assert "description = \"Loads the Microsoft Entra auth configuration for mailbox connection\"" in script
    assert "description = \"Exchanges Microsoft Entra auth codes for delegated Graph tokens\"" in script
    assert "description = \"Returns mailbox auth state and last ingest summary\"" in script
