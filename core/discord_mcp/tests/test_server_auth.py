"""Tests for the discord_mcp auth middleware."""

from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from core.discord_mcp.server import AlwaysDenyMiddleware, TokenAuthMiddleware


def _ok(_request):
    return JSONResponse({"ok": True})


def _client_with_token_auth(token: str) -> TestClient:
    app = Starlette(routes=[Route("/mcp", _ok, methods=["GET", "POST"])])
    app.add_middleware(TokenAuthMiddleware, token=token)
    return TestClient(app)


def test_token_auth_rejects_missing_credential():
    client = _client_with_token_auth("secret")
    assert client.get("/mcp").status_code == 401


def test_token_auth_rejects_wrong_header():
    client = _client_with_token_auth("secret")
    assert (
        client.get("/mcp", headers={"Authorization": "Bearer wrong"}).status_code == 401
    )


def test_token_auth_accepts_correct_bearer_header():
    client = _client_with_token_auth("secret")
    r = client.get("/mcp", headers={"Authorization": "Bearer secret"})
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_token_auth_accepts_correct_query_param():
    client = _client_with_token_auth("secret")
    r = client.get("/mcp?token=secret")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_token_auth_rejects_wrong_query_param():
    client = _client_with_token_auth("secret")
    assert client.get("/mcp?token=wrong").status_code == 401


def test_token_auth_rejects_empty_query_param():
    # Guards against empty-string token matching an empty configured token.
    client = _client_with_token_auth("secret")
    assert client.get("/mcp?token=").status_code == 401


def test_always_deny_returns_503():
    app = Starlette(routes=[Route("/mcp", _ok, methods=["GET", "POST"])])
    app.add_middleware(AlwaysDenyMiddleware)
    client = TestClient(app)
    r = client.get("/mcp")
    assert r.status_code == 503
    assert "DISCORD_MCP_AUTH_TOKEN" in r.json()["error"]
