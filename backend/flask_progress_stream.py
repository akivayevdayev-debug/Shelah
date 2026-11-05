"""Flask's side of the ask progress stream (docs/API.md, "Progress stream").

A client that sends ``Accept: application/x-ndjson`` gets one NDJSON line per
pipeline step while the answer is worked out ("Searching the sources",
"Thinking it through", ...), then one last line with the answer. Production
serves the Flask app, so without this a signed-out visitor (Flask /ask) saw
nothing until the whole answer arrived; asgi.py streams the same way for
local runs.

The ask runs on a worker thread. Committing to a stream waits for the first
step, so every refusal before a step is reported (validation, auth, a cached
answer, the prayer shortcut) still comes back as its ordinary JSON response
with its real status and headers. A stream that started always ends with one
terminal line, built by the caller from the response the plain path would
have returned.
"""

from __future__ import annotations

import queue
import threading
from contextvars import copy_context
from typing import Any, Callable

from flask import Response, copy_current_request_context, current_app, g

from backend import ask_progress
from backend.cost_gates import clear_cost_attribution

# Seconds of silence on a progress stream before a keep-alive line is sent.
KEEPALIVE_SECONDS = 10.0
WORKER_DONE = "_worker_done"
_HEADERS = {"Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no"}


def ask_terminal_event(response) -> dict[str, Any]:
    """/ask's last line (the shape asgi.py sends): the answer as ``payload``,
    or the error body as ``detail`` with the status it would have had."""
    body = response.get_json(silent=True)
    if 200 <= response.status_code < 300:
        return {"type": "result", "payload": body}
    return {"type": "error", "status": response.status_code, "detail": body}


def stream_body(first_event: dict[str, Any], events: queue.Queue):
    """NDJSON body: every progress line, then the worker's terminal line. A
    quiet queue yields keep-alive lines so an idle-timeout proxy does not cut
    a long model call."""
    event = first_event
    while True:
        if event["type"] == WORKER_DONE:
            yield ask_progress.encode_event(event["terminal"])
            return
        yield ask_progress.encode_event(event)
        while True:
            try:
                event = events.get(timeout=KEEPALIVE_SECONDS)
                break
            except queue.Empty:
                yield ask_progress.encode_event({"type": "ping"})


def stream_ask(
    run: Callable[[], Any],
    terminal: Callable[[Any], dict[str, Any]],
    on_failure: Callable[[Exception], Any],
):
    """Run ``run()`` (the ask, returning what a Flask view returns) on a
    worker thread and stream its progress as NDJSON. ``terminal`` turns the
    finished response into the last line; ``on_failure`` turns an exception
    ``run`` raised into the response to report instead."""
    events: queue.Queue = queue.Queue()
    # Flask's `g` belongs to the request's own app context, which a copied
    # request context replaces with a fresh one.
    g_state = dict(vars(g._get_current_object()))

    def work():
        vars(g._get_current_object()).update(g_state)
        token = ask_progress.bind(events.put)
        try:
            try:
                response = current_app.make_response(run())
            except Exception as exc:  # noqa: BLE001 -- the reader must always get a last line
                response = current_app.make_response(on_failure(exc))
            events.put({"type": WORKER_DONE, "response": response, "terminal": terminal(response)})
        finally:
            ask_progress.unbind(token)
            clear_cost_attribution()

    # contextvars (request id, log bindings, the device) do not cross into a
    # new thread by themselves; the request context is copied so `request`
    # keeps working after the view has returned.
    threading.Thread(
        target=copy_context().run,
        args=(copy_current_request_context(work),),
        daemon=True,
    ).start()

    first = events.get()
    if first["type"] == WORKER_DONE:
        return first["response"]
    return Response(stream_body(first, events), mimetype=ask_progress.NDJSON_MIMETYPE, headers=_HEADERS)
