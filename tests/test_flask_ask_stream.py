"""Flask POST /ask streams its steps to a client that asks for them
(backend/flask_progress_stream.py). Production serves the Flask app, so this
is the stream a signed-out visitor sees; before it, they saw nothing until the
whole answer arrived."""

import json
import queue
import threading

import pytest

import app
from backend import ask_progress, flask_progress_stream

NDJSON = {"Accept": "application/x-ndjson, application/json;q=0.5"}
QUESTION = "Is it permitted to test the progress stream?"
ANSWER = {"answer": "Yes.", "sources": []}


def _lines(text):
    return [json.loads(line) for line in text.splitlines() if line.strip()]


@pytest.fixture
def pipeline(monkeypatch):
    """An /ask whose context step reports progress and whose synthesis answers."""
    monkeypatch.setattr(app, "ASK_RESPONSE_CACHE", {})
    monkeypatch.setattr(app, "get_engine", lambda: object())
    monkeypatch.setattr(app, "_ask_question_prayer_payload", lambda *a, **k: None)
    monkeypatch.setattr(app.claude, "off_topic_block_result", lambda *a, **k: None)
    monkeypatch.setattr(app, "_ask_question_strict_payload", lambda *a, **k: None)
    monkeypatch.setattr(app, "_apply_ask_question_cost_gates", lambda *a, **k: None)

    def collect(*args, **kwargs):
        ask_progress.begin("sources")
        ask_progress.end("sources")
        return {}

    monkeypatch.setattr(app, "_collect_ask_question_context", collect)
    monkeypatch.setattr(app, "_run_ask_question_ai_synthesis", lambda *a, **k: dict(ANSWER))
    return monkeypatch


def _ask(client, headers=NDJSON):
    return client.post("/ask", json={"question": QUESTION}, headers=headers)


def test_a_streaming_client_gets_ndjson(test_client, pipeline):
    assert _ask(test_client).mimetype == ask_progress.NDJSON_MIMETYPE


def test_the_stream_reports_the_steps_before_the_answer(test_client, pipeline):
    assert _lines(_ask(test_client).get_data(as_text=True))[0]["type"] == "stage"


def test_the_stream_ends_with_the_answer_as_payload(test_client, pipeline):
    last = _lines(_ask(test_client).get_data(as_text=True))[-1]
    assert last == {"type": "result", "payload": ANSWER}


def test_a_client_that_does_not_ask_gets_plain_json(test_client, pipeline):
    assert _ask(test_client, headers={}).get_json() == ANSWER


def test_a_refusal_before_any_step_keeps_its_status(test_client, pipeline):
    response = test_client.post("/ask", json={"question": ""}, headers=NDJSON)
    assert response.status_code == 400


def test_a_refusal_before_any_step_is_plain_json(test_client, pipeline):
    response = test_client.post("/ask", json={"question": ""}, headers=NDJSON)
    assert response.mimetype == "application/json"


def test_a_cost_gate_after_a_step_ends_the_stream_with_its_status(test_client, pipeline):
    pipeline.setattr(app, "_apply_ask_question_cost_gates",
                     lambda *a, **k: (app.jsonify({"error": "Daily limit", "code": "budget"}), 402))
    last = _lines(_ask(test_client).get_data(as_text=True))[-1]
    assert last == {"type": "error", "status": 402, "detail": {"error": "Daily limit", "code": "budget"}}


def test_a_signed_out_streamed_answer_still_gets_the_device_cookie(test_client, pipeline):
    response = _ask(test_client)
    response.get_data()
    assert any("shelah_device" in value for value in response.headers.getlist("Set-Cookie"))


def test_an_exception_the_ask_raises_still_ends_the_stream(test_client, pipeline):
    def boom():
        ask_progress.begin("sources")
        raise RuntimeError("down")

    pipeline.setattr(app, "_answer_ask_question", boom)
    pipeline.setattr(app, "_capture_backend_error", lambda *a, **k: None)
    assert _lines(_ask(test_client).get_data(as_text=True))[-1]["status"] == 500


def test_a_keepalive_is_sent_while_the_worker_is_quiet(monkeypatch):
    monkeypatch.setattr(flask_progress_stream, "KEEPALIVE_SECONDS", 0.01)
    events = queue.Queue()
    threading.Timer(0.06, lambda: events.put({
        "type": flask_progress_stream.WORKER_DONE, "terminal": {"type": "result", "payload": {}},
    })).start()
    lines = [json.loads(chunk) for chunk in flask_progress_stream.stream_body(
        {"type": "stage", "stage": "sources", "state": "start"}, events)]
    assert any(line["type"] == "ping" for line in lines)
