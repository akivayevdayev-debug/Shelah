"""
External API health-check and circuit-breaker for Sh'elah.

Maintains lightweight in-process state about the health of each external
service (Sefaria, Hebcal, Gemini, Claude).  A circuit opens after
FAIL_THRESHOLD consecutive failures; it half-opens after RECOVERY_INTERVAL
seconds to allow re-probing.

Gemini is the exception (see _COOLDOWN_POLICIES): it is the primary model and
Claude is its fallback, so two consecutive real errors switch the app to
Claude only for 30-60 minutes, and the first request after that window is the
probe -- a failed probe starts another full window, a good one closes it.

Usage (in data_service.py / app.py):
    from backend.health_check import health

    if not health.is_healthy('sefaria'):
        return {'error': 'Sefaria is temporarily unavailable.'}

    result = sefaria_client.get_text(reference)

The module is intentionally stateless across process restarts — it starts
with all services assumed healthy and builds evidence at runtime.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, Optional

import requests

logger = logging.getLogger(__name__)

# ─── Configuration ────────────────────────────────────────────────────────────

FAIL_THRESHOLD = 3           # Consecutive failures before circuit opens
RECOVERY_INTERVAL = 120      # Seconds before half-opening the circuit
REQUEST_TIMEOUT = 5          # Seconds for each health probe
_HEALTH_CHECK_USER_AGENT = "Shelah-HealthCheck/1.0"

# Gemini cooldown: after GEMINI_FAIL_THRESHOLD consecutive real errors the app
# serves Claude only for GEMINI_COOLDOWN_SECONDS (default 45 minutes, clamped
# to 30-60), then lets one request try Gemini again.
GEMINI_FAIL_THRESHOLD = 2
GEMINI_COOLDOWN_DEFAULT_SECONDS = 45 * 60
GEMINI_COOLDOWN_MIN_SECONDS = 30 * 60
GEMINI_COOLDOWN_MAX_SECONDS = 60 * 60
# A caller that was admitted as the half-open probe but never reported back
# (it crashed, was cancelled or hit a neutral outcome) gives up the slot after
# this long so the next request can probe instead.
_PROBE_LEASE_SECONDS = 90
# How often an instance that thinks the service is up asks the shared Redis
# tier whether another instance already opened a cooldown.
_SHARED_CHECK_INTERVAL_SECONDS = 20


def gemini_cooldown_seconds() -> float:
    """GEMINI_COOLDOWN_SECONDS, defaulting to 45 minutes and clamped to the
    30-60 minute window the cooldown is specified for."""
    try:
        value = float(os.environ.get("GEMINI_COOLDOWN_SECONDS", ""))
    except ValueError:
        value = GEMINI_COOLDOWN_DEFAULT_SECONDS
    return min(GEMINI_COOLDOWN_MAX_SECONDS, max(GEMINI_COOLDOWN_MIN_SECONDS, value))


@dataclass(frozen=True)
class _CooldownPolicy:
    """A service whose circuit stays open for a fixed cooldown and is then
    re-tried by a real request (no models-list probe: a provider can list its
    models while every generate call is failing)."""
    threshold: int
    cooldown: Callable[[], float]


@dataclass
class _CircuitState:
    """Per-service circuit-breaker state."""
    status: str = "up"          # "up" | "down" | "half-open"
    failures: int = 0
    last_failure_ts: float = 0.0
    last_success_ts: float = field(default_factory=time.time)
    # Cooldown-policy services only (see _CooldownPolicy):
    open_until: float = 0.0          # no request is admitted before this time
    probe_started_ts: float = 0.0    # when the half-open probe was admitted
    shared_checked_ts: float = 0.0   # last look at the shared Redis cooldown

    def record_success(self) -> None:
        self.failures = 0
        self.status = "up"
        self.last_success_ts = time.time()
        self.open_until = 0.0
        self.probe_started_ts = 0.0

    def record_failure(self) -> None:
        self.failures += 1
        self.last_failure_ts = time.time()
        if self.failures >= FAIL_THRESHOLD:
            self.status = "down"

    def should_probe(self) -> bool:
        """True when circuit is open but recovery interval has elapsed."""
        if self.status == "down":
            return (time.time() - self.last_failure_ts) >= RECOVERY_INTERVAL
        return self.status != "down"


# ─── Health probe functions ────────────────────────────────────────────────────

def _probe_sefaria() -> bool:
    """Lightweight read of a small Sefaria text endpoint."""
    r = requests.get(
        "https://www.sefaria.org/api/texts/Berakhot.2a?pad=0&commentary=0",
        timeout=REQUEST_TIMEOUT,
        headers={"User-Agent": _HEALTH_CHECK_USER_AGENT},
    )
    return r.status_code == 200


def _probe_hebcal() -> bool:
    """Ping Hebcal's JSON API."""
    r = requests.get(
        "https://www.hebcal.com/api/holidays?v=1&year=2026&cfg=json",
        timeout=REQUEST_TIMEOUT,
        headers={"User-Agent": _HEALTH_CHECK_USER_AGENT},
    )
    return r.status_code == 200


def _probe_gemini() -> bool:
    """Gemini availability — just check that the models list endpoint responds."""
    import os
    api_key = os.environ.get(
        "GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return True  # Can't probe without key; assume up
    # Key in the x-goog-api-key header, never in a ?key= query string: a
    # connection error's message embeds the full URL, and _probe() logs it.
    r = requests.get(
        "https://generativelanguage.googleapis.com/v1beta/models",
        timeout=REQUEST_TIMEOUT,
        headers={
            "x-goog-api-key": api_key,
            "User-Agent": _HEALTH_CHECK_USER_AGENT,
        },
    )
    return r.status_code == 200


def _probe_claude() -> bool:
    """Anthropic availability — just check that the models list endpoint responds."""
    import os
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return True  # Can't probe without key; assume up
    r = requests.get(
        "https://api.anthropic.com/v1/models",
        timeout=REQUEST_TIMEOUT,
        headers={
            "anthropic-version": "2023-06-01",
            "x-api-key": api_key,
            "User-Agent": _HEALTH_CHECK_USER_AGENT,
        },
    )
    return r.status_code in {200, 403}  # 403 = authed endpoint, API is up


# ─── APIHealth class ───────────────────────────────────────────────────────────

class APIHealth:
    """Thread-safe, in-process circuit breaker for external APIs."""

    _PROBES: Dict[str, object] = {
        "sefaria": _probe_sefaria,
        "hebcal": _probe_hebcal,
        "gemini": _probe_gemini,
        "claude": _probe_claude,
    }

    # Services that have no active health-probe function: their circuit state
    # is driven passively by callers reporting record_success()/record_failure()
    # around each real network call (used by backend/utils/search_provider.py
    # for translation providers and general web/global-source search).
    # community_knowledge covers backend/rag.py::_retrieve_community_knowledge.
    _PASSIVE_SERVICES = ("translate_google", "translate_mymemory", "web", "nominatim", "photon", "community_knowledge")

    _COOLDOWN_POLICIES: Dict[str, _CooldownPolicy] = {
        "gemini": _CooldownPolicy(GEMINI_FAIL_THRESHOLD, gemini_cooldown_seconds),
    }

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._circuits: Dict[str, _CircuitState] = {
            name: _CircuitState() for name in (*self._PROBES, *self._PASSIVE_SERVICES)
        }

    # ── Public API ────────────────────────────────────────────────────────────

    def is_healthy(self, service: str) -> bool:
        """Return True if the service is considered available.

        If the circuit is half-open (recovery interval elapsed), a probed
        service is re-checked inline; a passive service (no probe function) is
        optimistically let through so the next real caller can re-establish
        state via record_success()/record_failure().
        """
        with self._lock:
            circuit = self._circuits.get(service)
        if circuit is None:
            return True  # Unknown service — optimistically assume up

        policy = self._COOLDOWN_POLICIES.get(service)
        if policy is not None:
            return self._admit(service, circuit)

        if circuit.status == "up":
            return True
        if circuit.status == "down" and circuit.should_probe():
            if service in self._PROBES:
                return self._probe(service)
            return True
        return circuit.status != "down"

    def is_up(self, service: str) -> bool:
        """True while the service's circuit is closed. Unlike is_healthy, this
        never takes the half-open probe slot, so an optional extra call
        (backend/question_plan.py) leaves the probe to the call that needs it."""
        with self._lock:
            circuit = self._circuits.get(service)
            return circuit is None or circuit.status == "up"

    def check(self, service: str) -> bool:
        """Explicitly probe a service and update circuit state. Returns bool."""
        return self._probe(service)

    def record_success(self, service: str) -> None:
        """Record a successful passive network call for `service`."""
        with self._lock:
            circuit = self._circuits.setdefault(service, _CircuitState())
            was_open = circuit.status != "up" and service in self._COOLDOWN_POLICIES
            circuit.record_success()
        if was_open:
            logger.info("health_check[%s] request succeeded — circuit closed", service)

    def record_failure(self, service: str) -> None:
        """Record a failed passive network call for `service`."""
        opened_until: Optional[float] = None
        with self._lock:
            circuit = self._circuits.setdefault(service, _CircuitState())
            policy = self._COOLDOWN_POLICIES.get(service)
            if policy is None:
                circuit.record_failure()
            else:
                opened_until = self._record_cooldown_failure(circuit, policy)
            status, failures = circuit.status, circuit.failures
        logger.warning(
            "health_check[%s] failure recorded (consecutive=%d, status=%s)",
            service, failures, status,
        )
        if opened_until is not None:
            logger.warning(
                "health_check[%s] circuit open: not calling it until %s (%d min)",
                service, time.strftime("%H:%M:%S", time.localtime(opened_until)),
                round((opened_until - time.time()) / 60),
            )
            self._publish_cooldown(service, opened_until)

    def release_probe(self, service: str) -> None:
        """The call finished without telling us whether the service works (a
        request-specific rejection, an empty answer, a skipped call). Counters
        stay as they are; a half-open probe slot is handed to the next caller."""
        with self._lock:
            circuit = self._circuits.get(service)
            if circuit is not None and circuit.status == "half-open":
                circuit.probe_started_ts = 0.0

    def cooldown_remaining(self, service: str) -> float:
        """Seconds until a cooldown-policy service admits a request again
        (0 when it is up or already due a probe)."""
        with self._lock:
            circuit = self._circuits.get(service)
            if circuit is None or circuit.status != "down":
                return 0.0
            return max(0.0, circuit.open_until - time.time())

    def status_summary(self) -> Dict[str, str]:
        """Return a dict of {service: status} for the health dashboard."""
        with self._lock:
            return {name: c.status for name, c in self._circuits.items()}

    def reset(self) -> None:
        """Reset all circuits to a fresh 'up' state (used by tests)."""
        with self._lock:
            for circuit in self._circuits.values():
                circuit.status = "up"
                circuit.failures = 0
                circuit.last_failure_ts = 0.0
                circuit.last_success_ts = time.time()
                circuit.open_until = 0.0
                circuit.probe_started_ts = 0.0
                circuit.shared_checked_ts = 0.0

    # ── Internal ──────────────────────────────────────────────────────────────

    @staticmethod
    def _record_cooldown_failure(circuit: _CircuitState, policy: _CooldownPolicy) -> Optional[float]:
        """Count one failure for a cooldown-policy service (caller holds the
        lock). Returns the reopening time when this failure opened the circuit:
        the `threshold`-th consecutive one, or any failure of the half-open
        probe. A failure that arrives while the circuit is already open (a call
        that was in flight when it opened) does not stretch the cooldown."""
        now = time.time()
        circuit.failures += 1
        circuit.last_failure_ts = now
        probe_failed = circuit.status == "half-open"
        circuit.probe_started_ts = 0.0
        if circuit.status == "down" or not (probe_failed or circuit.failures >= policy.threshold):
            return None
        circuit.status = "down"
        circuit.open_until = now + policy.cooldown()
        return circuit.open_until

    def _admit(self, service: str, circuit: _CircuitState) -> bool:
        """Admission for a cooldown-policy service. Up: yes. Down: no until the
        cooldown ends, then exactly one caller is admitted as the probe (the
        circuit turns half-open) while the rest keep being refused until that
        probe reports back or its slot times out."""
        now = time.time()
        with self._lock:
            ask_shared = circuit.status == "up" and (
                now - circuit.shared_checked_ts >= _SHARED_CHECK_INTERVAL_SECONDS)
            if ask_shared:
                circuit.shared_checked_ts = now
        if ask_shared:
            shared_until = self._read_shared_cooldown(service)
            if shared_until is not None and shared_until > now:
                with self._lock:
                    if circuit.status == "up":
                        circuit.status = "down"
                        circuit.failures = self._COOLDOWN_POLICIES[service].threshold
                        circuit.open_until = shared_until
                        circuit.last_failure_ts = now
                logger.warning(
                    "health_check[%s] cooldown adopted from another instance (%d min left)",
                    service, round((shared_until - now) / 60))

        with self._lock:
            if circuit.status == "up":
                return True
            if circuit.status == "down":
                if now < circuit.open_until:
                    return False
                circuit.status = "half-open"
            elif now - circuit.probe_started_ts < _PROBE_LEASE_SECONDS:
                return False
            circuit.probe_started_ts = now
        logger.info("health_check[%s] cooldown over — the next request probes it", service)
        return True

    @staticmethod
    def _shared_key(service: str) -> str:
        return f"health:cooldown:{service}"

    def _publish_cooldown(self, service: str, until: float) -> None:
        """Tell the other instances (best effort, shared Redis tier) that
        `service` is cooling down; a serverless deploy runs many instances and
        each would otherwise have to fail twice on its own."""
        try:
            from backend.cache import redis_cache_set
            redis_cache_set(self._shared_key(service), until, until - time.time())
        except Exception as exc:  # never let bookkeeping break a request
            logger.debug("health_check[%s] cooldown not shared: %s", service, exc)

    def _read_shared_cooldown(self, service: str) -> Optional[float]:
        try:
            from backend.cache import redis_cache_get
            value = redis_cache_get(self._shared_key(service))
        except Exception as exc:
            logger.debug("health_check[%s] shared cooldown unreadable: %s", service, exc)
            return None
        return float(value) if isinstance(value, (int, float)) else None

    def _probe(self, service: str) -> bool:
        probe_fn = self._PROBES.get(service)
        if probe_fn is None:
            return True
        try:
            ok = probe_fn()  # type: ignore[call-arg]
        except Exception as exc:
            logger.warning("health_check[%s] probe error: %s", service, exc)
            ok = False

        with self._lock:
            circuit = self._circuits.get(service)
            if circuit is None:
                return ok
            if ok:
                circuit.record_success()
                logger.info(
                    "health_check[%s] probe OK — circuit closed", service)
            else:
                circuit.record_failure()
                logger.warning(
                    "health_check[%s] probe FAILED (consecutive=%d, status=%s)",
                    service, circuit.failures, circuit.status,
                )
        return ok


# ─── Module-level singleton ───────────────────────────────────────────────────

health = APIHealth()
"""
Shared singleton.  Import this in any module that needs to gate on service health:

    from backend.health_check import health

    if not health.is_healthy('sefaria'):
        raise ServiceUnavailableError("Sefaria is temporarily unavailable")
"""
