from pathlib import Path


def test_enable_hubspot_connector_script_targets_expected_connector() -> None:
    script = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "enable_hubspot_connector.ps1"
    ).read_text(encoding="utf-8")

    assert "data_connector_enablements" in script
    assert "customer_relationship_management_hubspot" in script
    assert "admin_enablement_required" in script
