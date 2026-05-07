from pathlib import Path
import subprocess


def test_ingest_pitchbook_emails_node_contract() -> None:
    workspace_root = Path(__file__).resolve().parents[2]
    script_path = Path(__file__).resolve().with_name("test_ingest_pitchbook_emails.js")

    completed = subprocess.run(
        ["node", str(script_path)],
        cwd=workspace_root,
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "test_ingest_pitchbook_emails.js: ok" in completed.stdout
