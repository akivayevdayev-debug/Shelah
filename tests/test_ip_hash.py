"""backend.ip_hash: caller keys never carry the raw address or account id."""

import hashlib

import pytest

from backend import cost_gates, ip_hash, rate_limit, turnstile


@pytest.fixture(autouse=True)
def _fresh_key(monkeypatch):
    monkeypatch.delenv("IP_HASH_SECRET", raising=False)
    monkeypatch.delenv("FLASK_SECRET_KEY", raising=False)
    ip_hash._key.cache_clear()
    yield
    ip_hash._key.cache_clear()


def test_keyed_hash_is_stable():
    assert ip_hash.keyed_hash("203.0.113.9") == ip_hash.keyed_hash("203.0.113.9")


def test_keyed_hash_is_not_a_plain_sha256():
    plain = hashlib.sha256(b"203.0.113.9").hexdigest()[:32]
    assert ip_hash.keyed_hash("203.0.113.9") != plain


def test_keyed_hash_changes_with_the_secret(monkeypatch):
    before = ip_hash.keyed_hash("203.0.113.9")
    monkeypatch.setenv("FLASK_SECRET_KEY", "another-secret")
    ip_hash._key.cache_clear()
    assert ip_hash.keyed_hash("203.0.113.9") != before


def test_dedicated_secret_wins_over_flask_secret(monkeypatch):
    monkeypatch.setenv("FLASK_SECRET_KEY", "flask")
    ip_hash._key.cache_clear()
    flask_keyed = ip_hash.keyed_hash("203.0.113.9")
    monkeypatch.setenv("IP_HASH_SECRET", "dedicated")
    ip_hash._key.cache_clear()
    assert ip_hash.keyed_hash("203.0.113.9") != flask_keyed


def test_rate_limit_ip_key_hides_the_address():
    assert "203.0.113.9" not in rate_limit._build_key("cheap", "203.0.113.9", None)


def test_rate_limit_user_key_hides_the_account():
    assert "user_abc" not in rate_limit._build_key("llm", "203.0.113.9", "user_abc")


def test_turnstile_hash_ip_is_keyed():
    assert turnstile.hash_ip("203.0.113.9") != hashlib.sha256(b"203.0.113.9").hexdigest()[:16]


def test_cost_gate_client_key_hides_the_address():
    assert "203.0.113.9" not in cost_gates.client_key_for(None, "203.0.113.9")
