"""Loaded first by pytest (`-p tests._alias_httpx` in pytest.ini).

The Anthropic SDK moved from httpx to httpx2, an API-compatible fork. respx
patches whatever `httpx` is, so without this alias it stops seeing the SDK's
requests and a test can reach the real API. `alias_httpx()` makes
`import httpx` (and `httpcore`) resolve to httpx2 for the whole test process;
it must run before anything imports httpx.
"""

import httpx2

httpx2.alias_httpx()
