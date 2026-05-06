import importlib.util
from pathlib import Path


WORKSPACE_ROOT = Path(r"C:\Users\kcosgrave\Downloads\JudyPEProject")
MODULE_PATH = WORKSPACE_ROOT / "pitchbook-hubspot-triage" / "local" / "extract_pitchbook_fixture.py"
MSG_PATH = Path(r"C:\Users\kcosgrave\Downloads\PitchBook Alert - _PE_M&A Deals - Last 30 Days_ 1 (2).msg")


def _load_module():
    spec = importlib.util.spec_from_file_location("extract_pitchbook_fixture", MODULE_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_extract_fixture_returns_expected_shape():
    module = _load_module()

    fixture = module.extract_fixture(MSG_PATH)

    assert fixture["source_subject"].startswith('PitchBook Alert - "PE/M&A Deals')
    assert fixture["source_sender"] == "PitchBook Alerts <alerts-noreply@alerts.pitchbook.com>"
    assert fixture["items"]

    first_item = fixture["items"][0]
    assert {
        "item_type",
        "headline",
        "source_name",
        "published_at",
        "raw_excerpt",
    } <= set(first_item)
