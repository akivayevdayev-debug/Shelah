"""
Tests for backend/ai_notes.py: the server's own one-line note on an answer.

The note is composed from fixed wording and numbers (never the question, the
answer or a source title), stored under no user id with source "ai", and must
never break an answer.
"""

import hashlib

import pytest

from backend import ai_notes


class _Recorder:
    """Stand-in Supabase client: records inserts, can fail the first N."""

    def __init__(self, fail_with=None, fail_times=1):
        self.inserted = []
        self._fail_with, self._fail_times = fail_with, fail_times

    def table(self, name):
        self.table_name = name
        return self

    def insert(self, record):
        self.pending = record
        return self

    def execute(self):
        if self._fail_with is not None and self._fail_times > 0:
            self._fail_times -= 1
            raise self._fail_with
        self.inserted.append(self.pending)


class _PostgrestError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


@pytest.fixture
def app_module(monkeypatch):
    import app as app_module

    return app_module


class TestComposeNote:
    def test_an_answer_from_sources_names_the_count_mode_and_lens(self):
        note = ai_notes.compose_note(source_count=3, mode="strict", community="Ashkenaz")
        assert note == "Answered from 3 retrieved sources in strict mode, Ashkenaz lens."

    def test_one_source_is_singular_and_the_default_lens_is_not_named(self):
        assert ai_notes.compose_note(source_count=1, mode="balanced", community="All") == (
            "Answered from 1 retrieved source in balanced mode.")

    def test_no_sources(self):
        assert "without any retrieved source text" in ai_notes.compose_note(source_count=0)

    def test_a_fallback_says_the_ai_did_not_respond(self):
        note = ai_notes.compose_note(fallback=True, source_count=2)
        assert note.startswith("The AI did not respond")
        assert "2 discovered sources" in note

    def test_a_declined_question(self):
        assert ai_notes.compose_note(out_of_scope=True).startswith("Declined")

    def test_a_web_lookup_is_reported_with_its_page_count(self):
        used = ai_notes.compose_note(source_count=1, web_used=True, web_pages=3)
        assert "Looked the web up as a last resort (3 pages)." in used
        empty = ai_notes.compose_note(source_count=1, web_used=True, web_pages=0)
        assert "nothing usable came back" in empty

    def test_a_safety_route_is_reported_and_the_note_is_capped(self):
        assert "Safety route: sensitive_intimate." in ai_notes.compose_note(
            source_count=1, safety_class="sensitive_intimate")
        assert len(ai_notes.compose_note(source_count=1, community="x" * 2000)) <= 500


class TestWebLookupSummary:
    @pytest.mark.parametrize("result, expected", [
        (None, {"used": False, "pages": 0}),
        ({}, {"used": False, "pages": 0}),
        ({"web_lookup": {"used": False, "queried": True}}, {"used": False, "pages": 0}),
        ({"web_lookup": {"used": True, "sources": [{}, {}]}}, {"used": True, "pages": 2}),
        ({"web_lookup": {"used": True}}, {"used": True, "pages": 0}),
    ])
    def test_reads_what_the_result_reports(self, result, expected):
        assert ai_notes.web_lookup_summary(result) == expected


class TestRecordAiNote:
    def test_stores_a_note_with_no_user_the_ai_source_and_a_hashed_question(self, monkeypatch, app_module):
        client = _Recorder()
        monkeypatch.setattr(app_module, "_get_supabase_client", lambda: client)

        stored = ai_notes.record_ai_note(
            "  Is this gum kosher?  ", history_id="11111111-2222-3333-4444-555555555555",
            result={"web_lookup": {"used": True, "sources": [{"title": "ou.org"}]}},
            structured={"safety_class": "ok"}, mode="balanced", language="en",
            community="All", source_count=2,
        )

        assert stored is True
        [record] = client.inserted
        assert record["user_id"] is None
        assert record["verdict"] == "ai_note"
        assert record["source"] == "ai"
        assert record["question_hash"] == hashlib.sha256(b"Is this gum kosher?").hexdigest()
        assert record["history_id"] == "11111111-2222-3333-4444-555555555555"
        assert record["shared_view"] is False
        # Fixed wording only: nothing of the question or a page title.
        assert "gum" not in record["comment"]
        assert "ou.org" not in record["comment"]
        assert "Looked the web up as a last resort (1 page)." in record["comment"]

    def test_without_a_history_id_there_is_no_link(self, monkeypatch, app_module):
        client = _Recorder()
        monkeypatch.setattr(app_module, "_get_supabase_client", lambda: client)

        assert ai_notes.record_ai_note("Q?", source_count=1) is True
        assert "history_id" not in client.inserted[0]

    def test_a_missing_link_column_keeps_the_note_and_drops_the_link(self, monkeypatch, app_module):
        client = _Recorder(fail_with=_PostgrestError("42703"))
        monkeypatch.setattr(app_module, "_get_supabase_client", lambda: client)

        assert ai_notes.record_ai_note("Q?", history_id="11111111-2222-3333-4444-555555555555") is True
        [record] = client.inserted
        assert "history_id" not in record
        assert record["source"] == "ai"

    @pytest.mark.parametrize("code", ["42703", "PGRST204", "23514"])
    def test_before_the_migration_runs_the_note_is_skipped_quietly(self, monkeypatch, app_module, code):
        client = _Recorder(fail_with=_PostgrestError(code), fail_times=5)
        captured = []
        monkeypatch.setattr(app_module, "_get_supabase_client", lambda: client)
        monkeypatch.setattr(app_module, "_capture_backend_error", lambda *a: captured.append(a))

        assert ai_notes.record_ai_note("Q?") is False
        assert captured == []

    def test_any_other_failure_is_reported_and_never_raised(self, monkeypatch, app_module):
        client = _Recorder(fail_with=RuntimeError("db down"), fail_times=5)
        captured = []
        monkeypatch.setattr(app_module, "_get_supabase_client", lambda: client)
        monkeypatch.setattr(app_module, "_capture_backend_error", lambda *a: captured.append(a))

        assert ai_notes.record_ai_note("Q?") is False
        assert captured[0][0] == "ai_note_persist_failed"

    def test_off_when_switched_off_or_unconfigured_or_blank(self, monkeypatch, app_module):
        client = _Recorder()
        monkeypatch.setattr(app_module, "_get_supabase_client", lambda: client)
        assert ai_notes.record_ai_note("   ") is False

        monkeypatch.setenv("AI_FEEDBACK_NOTES", "0")
        assert ai_notes.record_ai_note("Q?") is False
        assert client.inserted == []

        monkeypatch.delenv("AI_FEEDBACK_NOTES")
        monkeypatch.setattr(app_module, "_get_supabase_client", lambda: None)
        assert ai_notes.record_ai_note("Q?") is False
