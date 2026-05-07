from pathlib import Path


def test_vibe_scripts_use_read_only_client_record_access() -> None:
    project_root = Path(__file__).resolve().parents[1]

    deploy_script = (project_root / "scripts" / "deploy_app.ps1").read_text(encoding="utf-8")
    create_script = (project_root / "scripts" / "create_app.ps1").read_text(encoding="utf-8")

    assert 'client_record_access = "read"' in deploy_script
    assert 'client_record_access = "read"' in create_script
