"""
Gemini cooldown: two consecutive real errors put Gemini on a 30-60 minute
cooldown during which every answer comes from Claude; the first request after
the cooldown is the probe, and a failed probe starts another full cooldown.

Covers backend/health_check.py (the circuit policy) and the way
backend/claude.py feeds it (which errors count, which are neutral).
"""

from __future__ import annotations

import json
import time
from datetime import timedelta

import pytest
from freezegun import freeze_time

import backend.claude as claude
import backend.health_check as health_check
from backend.health_check import (
    GEMINI_COOLDOWN_DEFAULT_SECONDS,
    GEMINI_COOLDOWN_MAX_SECONDS,
    GEMINI_COOLDOWN_MIN_SECONDS,
    GEMINI_FAIL_THRESHOLD,
    APIHealth,
    gemini_cooldown_seconds,
)

START = "2026-10-16 12:00:00"
MINUTE = timedelta(minutes=1)


@pytest.fixture
def breaker():
    return APIHealth()


@pytest.fixture(autouse=True)
def _no_cooldown_env(monkeypatch):
    monkeypatch.delenv("GEMINI_COOLDOWN_SECONDS", raising=False)


def _open(breaker):
    for _ in range(GEMINI_FAIL_THRESHOLD):
        breaker.record_failure("gemini")


class TestCooldownLength:
    def test_defaults_to_forty_five_minutes(self):
        assert gemini_cooldown_seconds() == GEMINI_COOLDOWN_DEFAULT_SECONDS == 45 * 60

    @pytest.mark.parametrize("raw, expected", [
        ("60", GEMINI_COOLDOWN_MIN_SECONDS),
        ("3000", 3000),
        ("999999", GEMINI_COOLDOWN_MAX_SECONDS),
        ("soon", GEMINI_COOLDOWN_DEFAULT_SECONDS),
        ("", GEMINI_COOLDOWN_DEFAULT_SECONDS),
    ])
    def test_env_value_is_clamped_to_half_an_hour_to_an_hour(self, monkeypatch, raw, expected):
        monkeypatch.setenv("GEMINI_COOLDOWN_SECONDS", raw)
        assert gemini_cooldown_seconds() == expected


class TestOpeningTheCircuit:
    def test_two_consecutive_errors_open_it(self, breaker):
        breaker.record_failure("gemini")
        assert breaker.is_healthy("gemini") is True
        breaker.record_failure("gemini")
        assert breaker.is_healthy("gemini") is False
        assert breaker.status_summary()["gemini"] == "down"

    def test_a_success_between_two_errors_resets_the_count(self, breaker):
        breaker.record_failure("gemini")
        breaker.record_success("gemini")
        breaker.record_failure("gemini")
        assert breaker.is_healthy("gemini") is True

    def test_a_neutral_outcome_neither_counts_nor_resets(self, breaker):
        breaker.record_failure("gemini")
        breaker.release_probe("gemini")
        assert breaker._circuits["gemini"].failures == 1
        breaker.record_failure("gemini")
        assert breaker.is_healthy("gemini") is False

    def test_other_services_keep_their_own_threshold(self, breaker):
        for _ in range(health_check.FAIL_THRESHOLD - 1):
            breaker.record_failure("sefaria")
        assert breaker.is_healthy("sefaria") is True
        breaker.record_failure("sefaria")
        assert breaker.status_summary()["sefaria"] == "down"

    def test_checking_gemini_never_touches_the_network(self, breaker, monkeypatch):
        def _boom(*args, **kwargs):
            raise AssertionError("is_healthy('gemini') made a network call")

        monkeypatch.setattr(health_check.requests, "get", _boom)
        with freeze_time(START) as clock:
            _open(breaker)
            clock.tick(timedelta(hours=2))
            assert breaker.is_healthy("gemini") is True  # the probe slot, no models-list request


class TestCooldownAndProbe:
    def test_refused_for_the_whole_window_then_one_caller_probes(self, breaker):
        with freeze_time(START) as clock:
            _open(breaker)
            clock.tick(44 * MINUTE)
            assert breaker.is_healthy("gemini") is False
            assert 0 < breaker.cooldown_remaining("gemini") <= 60
            clock.tick(2 * MINUTE)
            assert breaker.is_healthy("gemini") is True      # the probe
            assert breaker.status_summary()["gemini"] == "half-open"
            assert breaker.is_healthy("gemini") is False     # everyone else waits

    def test_a_failed_probe_starts_another_full_cooldown(self, breaker):
        with freeze_time(START) as clock:
            _open(breaker)
            clock.tick(46 * MINUTE)
            assert breaker.is_healthy("gemini") is True
            breaker.record_failure("gemini")                  # the probe failed
            assert breaker.status_summary()["gemini"] == "down"
            clock.tick(44 * MINUTE)
            assert breaker.is_healthy("gemini") is False
            clock.tick(2 * MINUTE)
            assert breaker.is_healthy("gemini") is True      # next probe, 45 minutes on

    def test_a_good_probe_closes_the_circuit(self, breaker):
        with freeze_time(START) as clock:
            _open(breaker)
            clock.tick(46 * MINUTE)
            assert breaker.is_healthy("gemini") is True
            breaker.record_success("gemini")
            assert breaker.status_summary()["gemini"] == "up"
            assert breaker._circuits["gemini"].failures == 0
            assert breaker.is_healthy("gemini") is True
            assert breaker.is_healthy("gemini") is True

    def test_a_good_probe_means_one_error_does_not_reopen_it(self, breaker):
        with freeze_time(START) as clock:
            _open(breaker)
            clock.tick(46 * MINUTE)
            breaker.is_healthy("gemini")
            breaker.record_success("gemini")
            breaker.record_failure("gemini")
            assert breaker.is_healthy("gemini") is True

    def test_a_probe_with_a_neutral_outcome_hands_the_slot_on(self, breaker):
        with freeze_time(START) as clock:
            _open(breaker)
            clock.tick(46 * MINUTE)
            assert breaker.is_healthy("gemini") is True
            breaker.release_probe("gemini")                   # e.g. an empty answer
            assert breaker.is_healthy("gemini") is True

    def test_a_probe_that_never_reports_back_times_out(self, breaker):
        with freeze_time(START) as clock:
            _open(breaker)
            clock.tick(46 * MINUTE)
            assert breaker.is_healthy("gemini") is True
            clock.tick(timedelta(seconds=60))
            assert breaker.is_healthy("gemini") is False
            clock.tick(timedelta(seconds=40))
            assert breaker.is_healthy("gemini") is True

    def test_a_late_error_from_an_in_flight_call_does_not_stretch_the_cooldown(self, breaker):
        with freeze_time(START) as clock:
            _open(breaker)
            clock.tick(20 * MINUTE)
            breaker.record_failure("gemini")
            clock.tick(26 * MINUTE)
            assert breaker.is_healthy("gemini") is True

    def test_reset_clears_the_cooldown(self, breaker):
        _open(breaker)
        breaker.reset()
        assert breaker.is_healthy("gemini") is True
        assert breaker.cooldown_remaining("gemini") == 0.0


class TestSharedCooldown:
    @pytest.fixture
    def redis(self, monkeypatch):
        import backend.cache as cache

        store: dict = {}
        reads: list = []

        def _set(key, value, ttl_seconds):
            store[key] = (value, ttl_seconds)

        def _get(key):
            reads.append(key)
            return store[key][0] if key in store else None

        monkeypatch.setattr(cache, "redis_cache_set", _set)
        monkeypatch.setattr(cache, "redis_cache_get", _get)
        return store, reads

    def test_opening_publishes_the_cooldown(self, breaker, redis):
        store, _ = redis
        with freeze_time(START):
            _open(breaker)
            value, ttl = store["health:cooldown:gemini"]
            assert value == pytest.approx(breaker._circuits["gemini"].open_until)
            assert ttl == pytest.approx(45 * 60, abs=1)

    def test_another_instance_adopts_it(self, redis):
        first, second = APIHealth(), APIHealth()
        with freeze_time(START) as clock:
            assert second.is_healthy("gemini") is True        # nothing shared yet
            clock.tick(25 * 1)                                 # past the re-check interval
            _open(first)
            assert second.is_healthy("gemini") is False
            assert second.status_summary()["gemini"] == "down"
            clock.tick(46 * MINUTE)
            assert second.is_healthy("gemini") is True        # and probes on its own

    def test_the_shared_tier_is_asked_at_most_every_twenty_seconds(self, breaker, redis):
        _, reads = redis
        with freeze_time(START) as clock:
            for _ in range(10):
                breaker.is_healthy("gemini")
            assert len(reads) == 1
            clock.tick(timedelta(seconds=21))
            breaker.is_healthy("gemini")
            assert len(reads) == 2

    def test_an_expired_shared_cooldown_is_ignored(self, breaker, redis):
        store, _ = redis
        with freeze_time(START):
            store["health:cooldown:gemini"] = (time.time() - 5, 1)
            assert breaker.is_healthy("gemini") is True

    def test_an_unreachable_shared_tier_changes_nothing(self, breaker, monkeypatch):
        import backend.cache as cache

        def _down(*args, **kwargs):
            raise RuntimeError("redis is down")

        monkeypatch.setattr(cache, "redis_cache_get", _down)
        monkeypatch.setattr(cache, "redis_cache_set", _down)
        assert breaker.is_healthy("gemini") is True      # the read fails: carry on as up
        _open(breaker)                                    # the write fails: still open locally
        assert breaker.is_healthy("gemini") is False


# ─── Which Gemini errors count ───────────────────────────────────────────────

class _ApiError(Exception):
    """Shaped like google.genai.errors.APIError: a status `code` and a message."""

    def __init__(self, code, message="boom"):
        super().__init__(f"{code}: {message}")
        self.code = code


class TestWhichErrorsCount:
    @pytest.mark.parametrize("exc", [
        _ApiError(429, "RESOURCE_EXHAUSTED"),
        _ApiError(500, "INTERNAL"),
        _ApiError(503, "UNAVAILABLE"),
        _ApiError(504, "DEADLINE_EXCEEDED"),
        _ApiError(401, "UNAUTHENTICATED"),
        _ApiError(403, "PERMISSION_DENIED"),
        _ApiError(404, "model not found"),
        _ApiError(400, "API key not valid. Please pass a valid API key."),
        _ApiError(400, "API_KEY_INVALID"),
        _ApiError(400, "API key expired. Please renew the API key."),
        RuntimeError("quota exceeded"),
        ConnectionError("connection reset"),
        TimeoutError("timed out"),
    ])
    def test_service_errors_count(self, exc):
        assert claude._is_gemini_service_failure(exc) is True

    @pytest.mark.parametrize("exc", [
        _ApiError(400, "Request contains an invalid argument."),
        _ApiError(413, "payload too large"),
        _ApiError(422, "unprocessable"),
        TimeoutError("ai_budget_exhausted"),
    ])
    def test_request_specific_errors_do_not(self, exc):
        assert claude._is_gemini_service_failure(exc) is False


# ─── End to end through the model calls ──────────────────────────────────────

class _Ok:
    text = json.dumps({"ruling": "ok"})
    candidates = []
    usage_metadata = None


@pytest.fixture
def gemini(monkeypatch):
    """Script `_generate_gemini_content_with_retry`: each call pops the next
    outcome (an exception is raised, anything else returned) and is counted."""
    state = {"calls": 0, "script": []}

    def _generate(*args, **kwargs):
        state["calls"] += 1
        outcome = state["script"].pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    monkeypatch.setattr(claude, "_configure_gemini_client", lambda: None)
    monkeypatch.setattr(claude, "_cached_gemini_client", object())
    monkeypatch.setattr(claude, "_generate_gemini_content_with_retry", _generate)
    return state


@pytest.fixture
def claude_leg(monkeypatch):
    """Replace the Claude fallback and the cost meter; record each Claude call."""
    seen: list = []

    async def _claude(prompt, dynamic_system_context="", gemini_error="", **kwargs):
        seen.append(gemini_error)
        return {"answer": "from claude", "confidence": 0.7, "is_fallback": True,
                "model": "claude-haiku-5-5"}

    async def _no_meter(**kwargs):
        return None

    monkeypatch.setattr(claude, "_call_claude_model", _claude)
    monkeypatch.setattr(claude, "record_llm_call", _no_meter)
    return seen


async def _ask():
    claude._model_deadline.set(None)
    return await claude._call_primary_model("a question")


class TestFailoverEndToEnd:
    async def test_two_errors_then_claude_only_then_a_probe(self, gemini, claude_leg):
        with freeze_time(START) as clock:
            gemini["script"] = [RuntimeError("503 overloaded")] * 2
            for _ in range(2):
                assert (await _ask())["answer"] == "from claude"
            assert gemini["calls"] == 2

            # The cooldown: Gemini is not called at all, Claude answers.
            for _ in range(3):
                assert (await _ask())["answer"] == "from claude"
            assert gemini["calls"] == 2
            assert claude_leg[-1] == "gemini_circuit_open"
            assert len(claude_leg) == 5

            # Half an hour in is still inside the window.
            clock.tick(30 * MINUTE)
            await _ask()
            assert gemini["calls"] == 2

            # The first request after it probes Gemini; it fails again, so a
            # new full cooldown starts.
            clock.tick(16 * MINUTE)
            gemini["script"] = [RuntimeError("still down")]
            assert (await _ask())["answer"] == "from claude"
            assert gemini["calls"] == 3
            await _ask()
            assert gemini["calls"] == 3

            # The next probe succeeds: Gemini answers and stays in use.
            clock.tick(46 * MINUTE)
            gemini["script"] = [_Ok(), _Ok()]
            before = len(claude_leg)
            first = await _ask()
            second = await _ask()
            assert gemini["calls"] == 5
            assert first["model"] == second["model"] == claude._DEFAULT_GEMINI_MODEL
            assert len(claude_leg) == before

    async def test_request_specific_rejections_never_open_it(self, gemini, claude_leg):
        gemini["script"] = [_ApiError(400, "Request contains an invalid argument.")] * 4
        for _ in range(4):
            await _ask()
        assert gemini["calls"] == 4
        assert claude_leg == [claude_leg[0]] * 4

    async def test_an_exhausted_budget_is_not_a_gemini_error(self, gemini, claude_leg):
        gemini["script"] = [TimeoutError("ai_budget_exhausted")] * 3
        for _ in range(3):
            await _ask()
        assert gemini["calls"] == 3

    async def test_empty_answers_never_open_it(self, gemini, claude_leg):
        class _Empty:
            text = ""
            candidates = []
            usage_metadata = None

        gemini["script"] = [_Empty()] * 4
        for _ in range(4):
            await _ask()
        assert gemini["calls"] == 4

    async def test_a_bad_key_counts_like_any_outage(self, gemini, claude_leg):
        gemini["script"] = [_ApiError(400, "API key not valid. Please pass a valid API key.")] * 2
        for _ in range(3):
            await _ask()
        assert gemini["calls"] == 2

    async def test_a_probe_that_cannot_run_does_not_burn_the_slot(self, gemini, claude_leg, monkeypatch):
        from backend.health_check import health

        with freeze_time(START) as clock:
            health.record_failure("gemini")
            health.record_failure("gemini")
            clock.tick(46 * MINUTE)
            monkeypatch.setattr(claude, "_configure_gemini_client", lambda: "gemini_api_key_missing")
            await _ask()
            assert gemini["calls"] == 0
            monkeypatch.setattr(claude, "_configure_gemini_client", lambda: None)
            gemini["script"] = [_Ok()]
            await _ask()
            assert gemini["calls"] == 1


class _AioModels:
    def __init__(self, script):
        self.script = script
        self.calls = 0

    async def generate_content(self, **kwargs):
        self.calls += 1
        outcome = self.script.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


class _AsyncClient:
    def __init__(self, models):
        self.aio = type("Aio", (), {"models": models})()


class TestAsyncPathSharesTheCooldown:
    async def test_two_errors_open_it_and_the_third_call_is_skipped(self, monkeypatch):
        claude._ensure_genai_loaded()
        models = _AioModels([RuntimeError("503"), RuntimeError("503")])
        monkeypatch.setattr(claude, "_configure_gemini_client", lambda: None)
        monkeypatch.setattr(claude, "_cached_gemini_client", _AsyncClient(models))

        first = await claude._call_gemini_httpx_model("q")
        second = await claude._call_gemini_httpx_model("q")
        third = await claude._call_gemini_httpx_model("q")

        assert first["error"].startswith("gemini_sdk_error")
        assert second["error"].startswith("gemini_sdk_error")
        assert third["error"] == "gemini_circuit_open"
        assert models.calls == 2

    async def test_publishing_the_cooldown_stays_off_the_event_loop(self, monkeypatch):
        import threading

        import backend.cache as cache

        published_on: list[int] = []
        monkeypatch.setattr(
            cache, "redis_cache_set",
            lambda key, value, ttl_seconds: published_on.append(threading.get_ident()))
        claude._ensure_genai_loaded()
        models = _AioModels([RuntimeError("503"), RuntimeError("503")])
        monkeypatch.setattr(claude, "_configure_gemini_client", lambda: None)
        monkeypatch.setattr(claude, "_cached_gemini_client", _AsyncClient(models))

        await claude._call_gemini_httpx_model("q")
        await claude._call_gemini_httpx_model("q")

        assert len(published_on) == 1
        assert published_on[0] != threading.get_ident()

    async def test_request_specific_rejection_is_not_counted(self, monkeypatch):
        claude._ensure_genai_loaded()
        models = _AioModels([_ApiError(400, "invalid argument")] * 3)
        monkeypatch.setattr(claude, "_configure_gemini_client", lambda: None)
        monkeypatch.setattr(claude, "_cached_gemini_client", _AsyncClient(models))

        for _ in range(3):
            await claude._call_gemini_httpx_model("q")

        assert models.calls == 3


class _SyncModels:
    def __init__(self, script):
        self.script = script
        self.calls = 0

    def generate_content(self, **kwargs):
        self.calls += 1
        outcome = self.script.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


class TestBookmarkSummaryHonoursTheCooldown:
    def _client(self, monkeypatch, script):
        models = _SyncModels(script)
        monkeypatch.setattr(claude, "_configure_gemini_client", lambda: None)
        monkeypatch.setattr(claude, "_cached_gemini_client", type("C", (), {"models": models})())
        return models

    def test_real_errors_count_and_the_cooldown_skips_the_call(self, monkeypatch):
        models = self._client(monkeypatch, [RuntimeError("503"), RuntimeError("503")])

        first = claude.summarize_with_gemini("Segment text", "notes")
        second = claude.summarize_with_gemini("Segment text", "notes")
        third = claude.summarize_with_gemini("Segment text", "notes")

        assert first["error"] == second["error"] == "503"
        assert third["error"] == "gemini_circuit_open"
        assert third["summary"]
        assert models.calls == 2

    def test_a_good_summary_closes_the_circuit_it_probed(self, monkeypatch):
        class _Summary:
            text = "A short note."
            candidates = []
            usage_metadata = None

        from backend.health_check import health

        models = self._client(monkeypatch, [_Summary()])
        with freeze_time(START) as clock:
            health.record_failure("gemini")
            health.record_failure("gemini")
            clock.tick(46 * MINUTE)
            result = claude.summarize_with_gemini("Segment text", "notes")
        assert result == {"summary": "A short note.", "error": ""}
        assert models.calls == 1
        assert health.status_summary()["gemini"] == "up"
