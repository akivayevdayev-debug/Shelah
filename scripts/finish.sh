#!/usr/bin/env bash
# The routine steps after a change, in the right order, with one pass/fail
# at the end. Run it before every commit (npm run finish).
#
#   scripts/finish.sh            rebuild what the change needs, then lint + test
#   scripts/finish.sh --no-tests rebuild only (assets, critical CSS, fixture, graphify)
#
# What it does, each step only when the change needs it:
#   1. npm run build:assets      static/js or static/css changed
#   2. npm run build:critical    static/css changed
#   3. page fixture              templates/ or static/js changed; rebuilt from a
#                                clean `git archive HEAD` plus the changed files,
#                                never from the dirty checkout
#   4. graphify update + cluster-only (graphify-out is not tracked)
#   5. ruff check, pytest (no -n, no coverage), npm test
#   6. what is staged, with warnings for files that must never be committed
#
# Plain bash 3 (macOS /bin/bash): no mapfile, no associative arrays.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

RUN_TESTS=1
[ "${1:-}" = "--no-tests" ] && RUN_TESTS=0

PY="$ROOT/.venv/bin/python"
FAILED=""
fail() { FAILED="$FAILED\n  - $1"; }
step() { printf '\n== %s\n' "$1"; }

# Files changed against HEAD (staged, unstaged, untracked). iCloud conflict
# copies ("name 2.ext") are left out everywhere.
changed() {
    { git diff --name-only HEAD; git ls-files --others --exclude-standard; } \
        | grep -v ' [0-9]\.[A-Za-z0-9]*$' | sort -u
}
CHANGED="$(changed)"
has() { printf '%s\n' "$CHANGED" | grep -Eq "$1"; }

if [ -z "$CHANGED" ]; then
    echo "Nothing changed against HEAD."
fi

# 1-2. Assets
if has '^static/(js|css)/'; then
    step "build:assets"
    npm run -s build:assets >/tmp/finish_assets.$$ 2>&1 || { tail -20 /tmp/finish_assets.$$; fail "build:assets"; }
    tail -1 /tmp/finish_assets.$$; rm -f /tmp/finish_assets.$$
fi
if has '^static/css/'; then
    step "build:critical"
    npm run -s build:critical >/dev/null 2>&1 || fail "build:critical"
fi
CHANGED="$(changed)"

# 3. Page fixture, from a clean archive so other sessions' edits stay out.
if has '^(templates/|static/js/)'; then
    step "page fixture"
    TMP="$(mktemp -d /tmp/finish_fixture.XXXXXX)"
    git archive HEAD | tar -x -C "$TMP"
    printf '%s\n' "$CHANGED" | while IFS= read -r f; do
        [ -f "$f" ] || continue
        mkdir -p "$TMP/$(dirname "$f")" && cp "$f" "$TMP/$f"
    done
    rm -rf "$TMP/static/min" && cp -R static/min "$TMP/static/min"
    if (cd "$TMP" && "$PY" scripts/build_shell_dom_fixture.py >/dev/null 2>&1); then
        if cmp -s "$TMP/tests_js/fixtures/index_page.txt" tests_js/fixtures/index_page.txt; then
            echo "unchanged"
        else
            cp "$TMP/tests_js/fixtures/index_page.txt" tests_js/fixtures/index_page.txt
            echo "updated tests_js/fixtures/index_page.txt"
        fi
    else
        fail "fixture build (scripts/build_shell_dom_fixture.py)"
    fi
    rm -rf "$TMP"
fi

# 4. graphify (cluster-only rewrites graph.html, which update deletes).
if command -v graphify >/dev/null 2>&1 && [ -d graphify-out ]; then
    step "graphify"
    graphify update . >/dev/null 2>&1 \
        && GRAPHIFY_VIZ_NODE_LIMIT=20000 graphify cluster-only . >/dev/null 2>&1 \
        && echo "graph updated" || echo "graphify failed (not a blocker)"
fi

# 5. Lint and tests
if [ "$RUN_TESTS" = 1 ]; then
    step "ruff"
    "$ROOT/.venv/bin/ruff" check . -q || fail "ruff"

    step "pytest"
    # The fixture test compares against a server render that differs on
    # this machine only; CI runs it.
    "$PY" -m pytest -q -p no:cacheprovider --no-cov \
        --deselect tests/test_shell_dom_fixture.py::test_fixture_is_the_page_the_server_renders \
        2>&1 | tail -3
    [ "${PIPESTATUS[0]}" = 0 ] || fail "pytest"

    step "npm test"
    npm test --silent 2>&1 | grep -E '^ℹ (pass|fail)|^✖ ' | grep -v 'failing tests' | head -12
    [ "${PIPESTATUS[0]}" = 0 ] || fail "npm test"
fi

# 6. Staged files
step "staged"
STAGED="$(git diff --cached --name-only)"
if [ -n "$STAGED" ]; then
    git diff --cached --stat | tail -15
    printf '%s\n' "$STAGED" | grep -E ' [0-9]\.[A-Za-z0-9]*$' | sed 's/^/  WARNING iCloud conflict copy staged: /'
    printf '%s\n' "$STAGED" | grep -x 'DECISIONS.md' | sed 's/^/  WARNING never commit: /'
else
    echo "nothing staged"
fi

if [ -n "$FAILED" ]; then
    printf '\nFAILED:%b\n' "$FAILED"
    exit 1
fi
printf '\nAll good.\n'
