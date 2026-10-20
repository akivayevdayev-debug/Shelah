"""The orbiting gold-and-blue halo that shows while an AI question loads.

Two decorative layers carry it (the search bar's underlay and the panel
composer's), both driven by one keyframe in tokens.css and switched on by
`body.search-loading` / `.conv-panel[data-sending="true"]`. These pin the markup
the CSS hangs off and the reduced-motion fallback, which nothing else would
notice losing: a halo that vanished would just look like an idle bar.

A question's loading cues belong to the surface it was asked from: the bar's
halo and its live status line (`#searchLiveStatus`) for a question typed in the
search bar, the panel's own for one asked in the panel. conversation-ui.js is
the only script that switches the bar's cues on, so a stray `search-loading` in
another script would light the bar for a question asked elsewhere.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "static" / "css"


def _form(html, form_id):
    match = re.search(rf'<form id="{form_id}".*?</form>', html, re.DOTALL)
    assert match, f"#{form_id} is not on the page"
    return match.group(0)


def test_both_bars_carry_a_decorative_halo_layer(test_client):
    html = test_client.get("/").get_data(as_text=True)

    search = _form(html, "searchForm")
    composer = _form(html, "convComposer")

    assert '<div class="search-liftoff-underlay" aria-hidden="true"></div>' in search
    assert '<div class="conv-halo" aria-hidden="true"></div>' in composer


def test_the_orbit_is_defined_once_and_both_halos_use_it():
    tokens = (CSS / "tokens.css").read_text(encoding="utf-8")
    assert tokens.count("@keyframes shelah-halo-orbit") == 1
    assert "--motion-dur-orbit:" in tokens
    for sheet in ("ai.css", "conversation.css"):
        text = (CSS / sheet).read_text(encoding="utf-8")
        assert "animation: shelah-halo-orbit var(--motion-dur-orbit) linear infinite paused;" in text


def test_the_halo_runs_only_while_loading_and_stands_still_under_reduced_motion():
    ai = (CSS / "ai.css").read_text(encoding="utf-8")
    conversation = (CSS / "conversation.css").read_text(encoding="utf-8")

    assert "body.search-loading .search-liftoff-underlay::before {\n    animation-play-state: running;" in ai
    assert '.conv-panel[data-sending="true"] .conv-halo::before { animation-play-state: running; }' in conversation

    # Reduced motion: no turning, a 120ms fade (the other halos' fade is not zeroed by the global fallback).
    assert ".search-liftoff-underlay::before { animation: none !important; }" in ai
    assert ".search-liftoff-underlay { transition: opacity 120ms linear !important; }" in ai
    assert ".conv-halo::before,\n    .conv-jump {\n        animation: none !important;" in conversation
    assert ".conv-panel .conv-halo { transition: opacity 120ms linear !important; }" in conversation


def test_the_bar_carries_a_live_status_line_for_the_question_asked_from_it(test_client):
    html = test_client.get("/").get_data(as_text=True)
    search = _form(html, "searchForm")

    # A polite live region inside the form, hidden until a bar question loads.
    assert 'id="searchLiveStatus" class="search-live" data-active="false"' in search
    assert 'role="status" aria-live="polite"' in search


def test_the_bar_status_line_is_hidden_until_active_and_only_fades_under_reduced_motion():
    ai = (CSS / "ai.css").read_text(encoding="utf-8")

    assert '.search-live[data-active="true"] {\n    opacity: 1;\n    visibility: visible;' in ai
    assert "pointer-events: none;" in ai.split(".search-live {", 1)[1].split("}", 1)[0]
    assert (
        "    .search-live {\n"
        "        transform: none !important;\n"
        "        transition: opacity 120ms linear, visibility 0s linear 120ms !important;\n"
        "    }"
    ) in ai


def test_only_the_conversation_module_switches_the_bar_cues_on():
    scripts = sorted((ROOT / "static" / "js").glob("*.js"))
    setters = [
        script.name
        for script in scripts
        if re.search(r"classList\.(add|toggle)\(\s*[\"']search-loading[\"']", script.read_text(encoding="utf-8"))
    ]
    assert setters == ["conversation-ui.js"]
