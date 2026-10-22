// Live status for an AI answer while it is being prepared. Owns no DOM.
//
// The server (backend/ask_progress.py) reports each pipeline step as it starts
// and ends -- one NDJSON line per event, then a terminal `result` or `error`
// line -- when the client asks for `application/x-ndjson`. This module turns
// those lines into a small state object and a view (which step is running,
// which are finished), and reads the stream for the two ask clients
// (ai-service.js and conversation-api.js).
//
// Wire events:
//   { type: "stage", stage, state: "start" | "done" }
//   { type: "detail", stage, detail: { kind, ...params } | null }
//        what a running step is doing right now; null when that work ends.
//        Kinds are a closed set (refs, community, times, tool, step); this module
//        owns the English and Hebrew wording, the server only names the work.
//   { type: "ping" }                                   (keep-alive, ignored)
//   { type: "result", payload | body, status? }        (terminal)
//   { type: "error",  status, detail | body }          (terminal)

export const NDJSON_TYPE = "application/x-ndjson";

// Asking for the stream never costs a fallback: a server (or proxy) that
// ignores it answers with plain JSON, which both clients still handle.
export const ACCEPT_PROGRESS = `${NDJSON_TYPE}, application/json;q=0.5`;

// [English, Hebrew] per step. `active` reads as what is happening now; `done`
// is the short noun shown once that step has finished. "thinking" has no
// `done`: it ends with the answer itself.
const STAGES = Object.freeze({
    sources: { active: ["Searching the sources", "מחפשים במקורות"], done: ["Sources", "מקורות"] },
    commentary: {
        active: ["Checking Halachipedia and other references", "בודקים בהלכיפדיה ובמקורות נוספים"],
        done: ["References", "מקורות נוספים"],
    },
    customs: { active: ["Checking community customs", "בודקים מנהגי קהילות"], done: ["Customs", "מנהגים"] },
    times: {
        active: ["Looking up today's zmanim and dates", "בודקים זמנים ותאריכים להיום"],
        done: ["Zmanim and dates", "זמנים ותאריכים"],
    },
    thinking: { active: ["Thinking it through", "חושבים על התשובה"], done: null },
});

// Before the first event arrives (the request is still being accepted).
export const WAITING_LABEL = Object.freeze(["Getting started", "מתחילים"]);

// Which running step names the status line when several run at once: the
// ones that usually take longest first, so the line changes only when that
// work genuinely finishes.
const ACTIVE_PRIORITY = Object.freeze(["thinking", "sources", "commentary", "customs", "times"]);

export const STAGE_IDS = Object.freeze(Object.keys(STAGES));

export function createProgress() {
    return { order: [], status: {}, details: {} };
}

const STEP_STATE = new Map([["start", "active"], ["done", "done"]]);

const DETAIL_KINDS = Object.freeze(["refs", "community", "times", "tool", "step"]);

function withoutDetail(details, stage) {
    if (!Object.hasOwn(details, stage)) return details;
    const rest = { ...details };
    delete rest[stage];
    return rest;
}

function applyDetail(state, event) {
    if (!Object.hasOwn(STAGES, event.stage)) return state;
    const detail = event.detail;
    if (detail == null) {
        const details = withoutDetail(state.details, event.stage);
        return details === state.details ? state : { ...state, details };
    }
    if (typeof detail !== "object" || !DETAIL_KINDS.includes(detail.kind)) return state;
    if (JSON.stringify(state.details[event.stage]) === JSON.stringify(detail)) return state;
    return { ...state, details: { ...state.details, [event.stage]: detail } };
}

// Pure: returns a new state, or the same object when the event changes nothing.
export function applyProgressEvent(state, event) {
    if (event?.type === "detail") return applyDetail(state, event);
    if (event?.type !== "stage" || !Object.hasOwn(STAGES, event.stage)) return state;
    const next = STEP_STATE.get(event.state);
    if (!next || state.status[event.stage] === next) return state;
    return {
        order: state.order.includes(event.stage) ? state.order : [...state.order, event.stage],
        status: { ...state.status, [event.stage]: next },
        // A step that has finished is no longer doing the thing it described.
        details: next === "done" ? withoutDetail(state.details, event.stage) : state.details,
    };
}

// What the status line should show: `active` is the step to name (null before
// anything has started), `detail` what that step is doing right now (or null),
// `done` the finished steps in the order they began.
export function progressView(state) {
    const done = state.order.filter((id) => state.status[id] === "done" && STAGES[id].done);
    const running = ACTIVE_PRIORITY.filter((id) => state.status[id] === "active");
    // The model call outranks everything. Among the lookups, one that can say
    // exactly what it is doing beats one that can only say its name.
    const shown = running[0] === "thinking"
        ? "thinking"
        : (running.find((id) => state.details[id]) || running[0] || null);
    if (shown) return { active: shown, detail: state.details[shown] || null, done };
    // Everything reported has finished but no answer yet (between the last
    // lookup and the model call): the model is the only thing left to wait on.
    return { active: state.order.length ? "thinking" : null, detail: state.details.thinking || null, done };
}

// Identity of what the line says, so a caller redraws only when it changes.
export function viewKey(view) {
    return `${view.active || ""}|${view.detail ? JSON.stringify(view.detail) : ""}`;
}

const isHebrew = (lang) => String(lang || "").toLowerCase().startsWith("he");

function pick(pair, lang) {
    return isHebrew(lang) ? pair[1] : pair[0];
}

// What each kind of time question is looking up. Shabbat names the two moments
// the lookup really returns (sunset and nightfall), not a halachic start/end.
const TIMES_TOPICS = Object.freeze({
    shabbat: ["Checking sunset and nightfall for Shabbat times", "בודקים שקיעה וצאת הכוכבים לזמני שבת"],
    zmanim: ["Checking today's zmanim", "בודקים את זמני היום"],
    omer: ["Checking today's Omer count", "בודקים את ספירת העומר להיום"],
    parasha: ["Checking this week's Torah portion", "בודקים את פרשת השבוע"],
    holiday: ["Checking the Hebrew date and coming holidays", "בודקים את התאריך העברי והחגים הקרובים"],
});

// [English, Hebrew] per AI tool; get_text_by_ref names the reference it opens.
const TOOL_LABELS = Object.freeze({
    search_judaic_texts: ["Searching Sefaria for sources", "מחפשים מקורות בספריא"],
    search_responsa_external: ["Searching Halachipedia and HebrewBooks", "מחפשים בהלכיפדיה ובהיברובוקס"],
    get_zmanim: TIMES_TOPICS.zmanim,
    get_daily_zmanim_summary: TIMES_TOPICS.zmanim,
    get_hebrew_date: ["Checking the Hebrew date", "בודקים את התאריך העברי"],
    calculate_hebrew_date_math: ["Calculating a Hebrew date", "מחשבים תאריך עברי"],
    get_parasha: TIMES_TOPICS.parasha,
    get_omer: TIMES_TOPICS.omer,
    get_holidays: ["Checking the coming holidays", "בודקים את החגים הקרובים"],
    get_daily_study: ["Checking the daily study schedule", "בודקים את לוח הלימוד היומי"],
    web_search: ["Searching trusted sites", "מחפשים באתרים מהימנים"],
    lookup_word_meaning: ["Looking up a word", "בודקים משמעות של מילה"],
    translate_text: ["Translating a passage", "מתרגמים קטע"],
    get_commentaries: ["Looking up commentaries", "מחפשים פרשנים"],
    search_community_customs: ["Checking community customs", "בודקים מנהגי קהילות"],
    get_community_profile: ["Checking a community's profile", "בודקים פרטי קהילה"],
    browse_library: ["Browsing the library", "מעיינים בספרייה"],
    search_library: ["Browsing the library", "מעיינים בספרייה"],
    get_prayer_text: ["Opening the prayer text", "פותחים את נוסח התפילה"],
    convert_measurements: ["Converting measurements", "ממירים מידות"],
    format_source_citation: ["Preparing the citation", "מכינים את הציטוט"],
});

// What the model call itself is doing when it is not just thinking: why an
// answer takes longer than the usual few seconds.
const STEP_LABELS = Object.freeze({
    long: ["Writing a long, detailed answer", "כותבים תשובה ארוכה ומפורטת"],
    retry: ["The first model is busy, trying again", "המודל הראשון עמוס, מנסים שוב"],
    second_model: ["Asking a second model", "פונים למודל נוסף"],
    second_look: ["Taking a second look", "בודקים שוב"],
});

function refsLabel(detail, lang, names) {
    const shown = (Array.isArray(detail.refs) ? detail.refs : []).filter((r) => typeof r === "string" && r.trim());
    if (!shown.length) return "";
    const refs = shown.map((r) => (names.ref ? names.ref(r) : r));
    const more = Math.max(0, (Number(detail.count) || shown.length) - shown.length);
    if (isHebrew(lang)) {
        const extraHe = more ? ` ועוד ${more}` : "";
        return `קוראים ${refs.join(", ")}${extraHe}`;
    }
    const list = refs.length > 1 && !more ? `${refs.slice(0, -1).join(", ")} and ${refs.at(-1)}` : refs.join(", ");
    const extraEn = more ? ` and ${more} more` : "";
    return `Reading ${list}${extraEn}`;
}

function toolLabel(detail, lang, names) {
    const ref = typeof detail.ref === "string" ? detail.ref.trim() : "";
    if (detail.tool === "get_text_by_ref") {
        if (!ref) return isHebrew(lang) ? "קוראים מקור" : "Reading a source";
        const shown = names.ref ? names.ref(ref) : ref;
        return isHebrew(lang) ? `קוראים ${shown}` : `Reading ${shown}`;
    }
    const pair = Object.hasOwn(TOOL_LABELS, detail.tool) ? TOOL_LABELS[detail.tool] : null;
    return pair ? pick(pair, lang) : "";
}

function communityLabel(detail, lang, names) {
    const raw = typeof detail.community === "string" ? detail.community.trim() : "";
    if (!raw) return "";
    const name = names.community ? names.community(raw) : raw;
    return isHebrew(lang) ? `בודקים מנהגי ${name}` : `Checking ${name} customs`;
}

// The line for a detail, or "" when this module has no words for it (the
// caller then falls back to the step's own label). `names` lets the UI render
// references and communities the way the rest of the page does.
export function detailLabel(detail, lang, names = {}) {
    if (!detail || typeof detail !== "object") return "";
    switch (detail.kind) {
        case "times": return Object.hasOwn(TIMES_TOPICS, detail.topic) ? pick(TIMES_TOPICS[detail.topic], lang) : "";
        case "refs": return refsLabel(detail, lang, names);
        case "community": return communityLabel(detail, lang, names);
        case "tool": return toolLabel(detail, lang, names);
        case "step": return Object.hasOwn(STEP_LABELS, detail.step) ? pick(STEP_LABELS[detail.step], lang) : "";
        default: return "";
    }
}

export function activeLabel(stageId, lang, detail = null, names = {}) {
    return detailLabel(detail, lang, names)
        || pick(stageId && STAGES[stageId] ? STAGES[stageId].active : WAITING_LABEL, lang);
}

export function doneLabel(stageId, lang) {
    const pair = STAGES[stageId]?.done;
    return pair ? pick(pair, lang) : "";
}

// Reads an NDJSON ask response to its terminal event, reporting every
// non-terminal event to `onEvent`. Resolves with the terminal event
// ({type: "result"} or {type: "error"}); rejects when the stream ends
// without one (connection cut, or the deadline passed) so the caller can treat
// it like any other interrupted request.
export async function readProgressStream(response, onEvent, { timeoutMs = 60000 } = {}) {
    const reader = response.body?.getReader?.();
    let terminal = null;
    let timedOut = false;

    const handleLine = (line) => {
        const text = line.trim();
        if (!text || terminal) return;
        let event;
        try { event = JSON.parse(text); } catch { return; }
        if (!event || typeof event !== "object") return;
        if (event.type === "result" || event.type === "error") {
            terminal = event;
            return;
        }
        if (typeof onEvent === "function") {
            try { onEvent(event); } catch { /* progress UI never aborts the answer */ }
        }
    };

    if (reader) {
        const decoder = new TextDecoder();
        const timer = setTimeout(() => {
            timedOut = true;
            reader.cancel().catch(() => {});
        }, timeoutMs);
        let buffer = "";
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop();
                lines.forEach(handleLine);
                if (terminal) break;
            }
            buffer += decoder.decode();
            handleLine(buffer);
        } finally {
            clearTimeout(timer);
            if (terminal) reader.cancel().catch(() => {});
        }
    } else {
        // No streaming body (older engines, test doubles): the whole response
        // is still NDJSON, so read it in one go.
        String(await response.text()).split("\n").forEach(handleLine);
    }

    if (terminal) return terminal;
    const error = new Error(timedOut ? "The answer took too long." : "The answer was interrupted.");
    error.interrupted = true;
    throw error;
}

export function isProgressResponse(response) {
    return String(response?.headers?.get?.("content-type") || "").toLowerCase().includes(NDJSON_TYPE);
}
