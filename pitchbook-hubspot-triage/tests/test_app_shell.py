from pathlib import Path


def test_app_includes_manual_msg_upload_shell() -> None:
    app_source = (
        Path(__file__).resolve().parents[1]
        / "app.jsx"
    ).read_text(encoding="utf-8")

    assert "Manual `.msg` upload" in app_source
    assert "MSG_PARSE_API_URL" in app_source
    assert "MSG_PARSE_API_TOKEN" in app_source
    assert "Parsing adapter required." in app_source
    assert "Sign in with Entra ID" in app_source
    assert "Run Mailbox Sync" in app_source
    assert "Mail.Read" in app_source
