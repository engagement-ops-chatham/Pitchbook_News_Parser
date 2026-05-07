from pathlib import Path
import subprocess


def test_upsert_auth_exchange_request_node_runner() -> None:
    workspace_root = Path(__file__).resolve().parents[2]
    script_path = workspace_root / "pitchbook-hubspot-triage" / "tests" / "test_upsert_auth_exchange_request.js"

    completed = subprocess.run(
        ["node", str(script_path)],
        cwd=workspace_root,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "test_upsert_auth_exchange_request.js: ok" in completed.stdout
