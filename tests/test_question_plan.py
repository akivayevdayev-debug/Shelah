"""backend/question_plan.py: the small model's search plan is checked and cleaned
before anything is searched for, and any failure means no plan."""

import json

from backend import question_plan


def _reply(**fields):
    return json.dumps({"refs": [], "hebrew": [], "english": [], **fields})


def test_a_reply_that_is_not_json_is_no_plan():
    assert question_plan.parse("Numbers 13:32") is None


def test_a_json_list_is_no_plan():
    assert question_plan.parse("[]") is None


def test_a_sefaria_ref_is_kept():
    assert question_plan.parse(_reply(refs=["Numbers 13:32"]))["refs"] == ["Numbers 13:32"]


def test_a_talmud_ref_loses_its_collection_name():
    assert question_plan.parse(_reply(refs=["Talmud Bavli, Bava Batra 14b"]))["refs"] == ["Bava Batra 14b"]


def test_a_ref_with_no_chapter_is_dropped():
    assert question_plan.parse(_reply(refs=["the book of Numbers"]))["refs"] == []


def test_refs_are_capped():
    refs = [f"Genesis {n}:1" for n in range(1, 10)]
    assert len(question_plan.parse(_reply(refs=refs))["refs"]) == question_plan.MAX_REFS


def test_hebrew_phrases_lose_their_vowel_points():
    assert question_plan.parse(_reply(hebrew=["אֶרֶץ אֹכֶלֶת"]))["hebrew"] == ["ארץ אכלת"]


def test_a_hebrew_phrase_with_no_hebrew_is_dropped():
    assert question_plan.parse(_reply(hebrew=["eretz ochelet"]))["hebrew"] == []


def test_an_english_phrase_in_hebrew_letters_is_dropped():
    assert question_plan.parse(_reply(english=["ארץ"]))["english"] == []


def test_repeated_phrases_are_kept_once():
    assert question_plan.parse(_reply(english=["great man", "great man"]))["english"] == ["great man"]


def test_no_plan_while_claude_is_down(monkeypatch):
    monkeypatch.setattr(question_plan.health, "is_up", lambda service: False)
    monkeypatch.setattr(question_plan, "_ask_model", lambda q: {"refs": ["Numbers 13:32"]})
    assert question_plan.plan("where does it say the land ate the people") is None


def test_no_plan_for_an_empty_question(monkeypatch):
    monkeypatch.setattr(question_plan, "_ask_model", lambda q: {"refs": ["Numbers 13:32"]})
    assert question_plan.plan("  ") is None


def test_a_failed_call_is_no_plan(monkeypatch):
    def broken(question):
        raise RuntimeError("anthropic down")

    monkeypatch.setattr(question_plan.health, "is_up", lambda service: True)
    monkeypatch.setattr(question_plan, "_ask_model", broken)
    assert question_plan.plan("where does it say the land ate the people") is None


def test_the_model_plan_is_returned(monkeypatch):
    plan = {"refs": ["Numbers 13:32"], "hebrew": [], "english": []}
    monkeypatch.setattr(question_plan.health, "is_up", lambda service: True)
    monkeypatch.setattr(question_plan, "_ask_model", lambda q: plan)
    assert question_plan.plan("where does it say the land ate the people") == plan


def test_the_call_cost_is_recorded(monkeypatch):
    from types import SimpleNamespace

    from backend import claude, cost_meter

    rows = []

    async def record(**row):
        rows.append(row)

    reply = SimpleNamespace(content=[SimpleNamespace(text=_reply(refs=["Numbers 13:32"]))],
                            usage=SimpleNamespace(input_tokens=40, output_tokens=12))
    client = SimpleNamespace(messages=SimpleNamespace(create=lambda **kwargs: reply))
    monkeypatch.undo()  # the conftest stub of _ask_model: this test runs the real one, on a fake client
    monkeypatch.setattr(claude, "_get_client", lambda: client)
    monkeypatch.setattr(cost_meter, "record_llm_call", record)
    question_plan._ask_model("where does it say the land ate the people")
    assert rows[0]["output_tokens"] == 12
