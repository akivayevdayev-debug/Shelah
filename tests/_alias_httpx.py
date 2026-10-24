"""Imported first by tests/conftest.py; importing it is what does the work.

The Anthropic SDK uses httpx2, an API-compatible fork of httpx. respx patches
whatever `httpx` is, so without this alias a test could reach the real API.
`alias_httpx()` makes `import httpx` (and `httpcore`) resolve to httpx2 for
the whole run. It must run before anything imports httpx, which is why
pytest.ini turns off respx's auto-loaded pytest plugin.
"""

import httpx2

httpx2.alias_httpx()
