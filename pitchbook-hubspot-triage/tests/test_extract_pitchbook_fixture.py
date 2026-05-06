import importlib.util
import json
from pathlib import Path

import pytest


TESTS_DIR = Path(__file__).resolve().parent
PROJECT_DIR = TESTS_DIR.parent
MODULE_PATH = PROJECT_DIR / "local" / "extract_pitchbook_fixture.py"
FIXTURES_DIR = TESTS_DIR / "fixtures"
SAMPLE_MSG_PATHS = {
    "pe_ma": Path.home() / "Downloads" / "PitchBook Alert - _PE_M&A Deals - Last 30 Days_ 1 (2).msg",
    "watchlist_companies": Path.home() / "Downloads" / "PitchBook Alert - _Watch List - Companies_ 1 (2).msg",
}


def _load_module():
    spec = importlib.util.spec_from_file_location("extract_pitchbook_fixture", MODULE_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _assert_fixture_shape(fixture: dict) -> None:
    assert {"source_subject", "source_sender", "items"} <= set(fixture)
    assert fixture["source_subject"]
    assert fixture["source_sender"]
    assert fixture["items"]

    first_item = fixture["items"][0]
    assert {
        "item_type",
        "headline",
        "source_name",
        "published_at",
        "raw_excerpt",
    } <= set(first_item)


@pytest.mark.parametrize(
    "fixture_name",
    [
        "pitchbook_pe_ma_alert.json",
        "pitchbook_watchlist_companies.json",
    ],
)
def test_committed_fixture_json_has_expected_shape(fixture_name: str):
    fixture = json.loads((FIXTURES_DIR / fixture_name).read_text(encoding="utf-8"))
    _assert_fixture_shape(fixture)


def test_extract_fixture_returns_expected_shape_for_sample_msg():
    sample_path = SAMPLE_MSG_PATHS["pe_ma"]
    if not sample_path.exists():
        pytest.skip(f"Sample .msg file not available: {sample_path}")

    module = _load_module()
    fixture = module.extract_fixture(sample_path)

    assert fixture["source_subject"].startswith('PitchBook Alert - "PE/M&A Deals')
    assert fixture["source_sender"] == "PitchBook Alerts <alerts-noreply@alerts.pitchbook.com>"
    _assert_fixture_shape(fixture)


def test_extract_fixture_raises_when_no_items_are_found():
    module = _load_module()

    class FakeMessage:
        subject = "PitchBook Alert - Test"
        sender = "PitchBook Alerts <alerts-noreply@alerts.pitchbook.com>"
        date = "2026-03-19 07:21:19-04:00"
        body = "No parsable items here."

        def __init__(self, *_args, **_kwargs):
            pass

    module.Message = FakeMessage

    with pytest.raises(ValueError, match="No PitchBook items found"):
        module.extract_fixture(Path("unused.msg"))
