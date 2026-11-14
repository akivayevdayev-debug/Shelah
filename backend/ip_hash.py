"""Keyed hashing for caller identifiers (IP addresses, account ids).

Rate-limit buckets, the Turnstile counter, the anonymous AI budget and
the common-answer asker count all need a stable per-caller key, but none
of them needs the address itself. A plain sha256 of an IPv4 address can
be reversed by trying all 4 billion of them, so the hash is an HMAC keyed
by a server secret: IP_HASH_SECRET if set, else FLASK_SECRET_KEY (set in
production). Without either (local dev, tests) a fixed development key is
used, which keeps keys stable but offers no protection.
"""

from __future__ import annotations

import hashlib
import hmac
import os
from functools import lru_cache

_DEV_KEY = "shelah-dev-only-ip-hash-key"


@lru_cache(maxsize=1)
def _key() -> bytes:
    for name in ("IP_HASH_SECRET", "FLASK_SECRET_KEY"):
        value = (os.environ.get(name) or "").strip()
        if value:
            return value.encode("utf-8")
    return _DEV_KEY.encode("utf-8")


def keyed_hash(value: str | None, length: int = 32) -> str:
    """Hex HMAC-SHA256 of *value*, truncated to *length* characters."""
    digest = hmac.new(_key(), (value or "").encode("utf-8"), hashlib.sha256)
    return digest.hexdigest()[:length]
