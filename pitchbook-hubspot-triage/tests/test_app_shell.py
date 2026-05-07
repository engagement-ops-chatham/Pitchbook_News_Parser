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
    assert "Or paste a PitchBook email" in app_source
    assert "Paste the raw email body here" in app_source
    assert "Use pasted email" in app_source
    assert "Sign in with Entra ID" in app_source
    assert "Run Mailbox Sync" in app_source
    assert "Mail.Read" in app_source
    assert "popupAuthPayloadRef" in app_source
    assert "Microsoft 365 Popup" in app_source
    assert "Sign-In Complete" in app_source
    assert "pitchbook-mailbox-auth" in app_source
    assert "isAuthPopupWindow" in app_source
