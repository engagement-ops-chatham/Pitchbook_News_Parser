from pathlib import Path
import subprocess


def test_seed_fixture_ingest_node_runner() -> None:
    workspace_root = Path(__file__).resolve().parents[2]
    script_path = workspace_root / "pitchbook-hubspot-triage" / "tests" / "test_seed_fixture_ingest.js"

    completed = subprocess.run(
        ["node", str(script_path)],
        cwd=workspace_root,
        capture_output=True,
        text=True,
        check=True,
    )

    assert "test_seed_fixture_ingest.js: ok" in completed.stdout
