// Answers to common questions, shown the moment a reader sends one.
//
// backend/common_answers.py keeps the answers other readers already got and
// lists the fingerprints (SHA-256 of the folded question) of the ones at
// least three readers asked. This module loads that list the first time the
// AI panel opens, and nothing before. While the reader types, the answer for
// a listed question is fetched in the background; when they send it, the
// store shows it straight away as the answer's draft. The real request still
// runs and its answer replaces the draft.
//
// Folding must match question_key() in the Python module character for
// character; tests_js/common_answers.test.js checks the shared cases.

export const TYPE_DELAY_MS = 200;
export const MAX_ANSWERS = 24;

const HEBREW_MARKS_RE = /[֑-ֽֿ-ׇ]/g;
const QUOTES_RE = /['‘’`"“”׳״]/g;
const MARK_RE = /\p{M}/gu;
const NOT_WORD_RE = /[^\p{L}\p{N}]/gu;

// The answer's [1]-style source markers: the draft shows text only, like the
// server's own drafts (backend/ask_progress.py _DRAFT_MARKER_RE).
const MARKER_RE = /\s?\[\d{1,2}(?:\s*[,\-\u2013]\s*\d{1,2})*\]/g;

const EMPTY_RULES = Object.freeze({ variants: {}, leading: [], trailing: [] });

function phrases(list) {
    return (Array.isArray(list) ? list : [])
        .map((phrase) => String(phrase || "").split(" ").filter(Boolean))
        .filter((words) => words.length);
}

function strip(tokens, list, atStart) {
    let words = tokens;
    let changed = true;
    while (changed && words.length) {
        changed = false;
        for (const phrase of list) {
            const n = phrase.length;
            if (n >= words.length) continue; // filler never takes the whole question
            const part = atStart ? words.slice(0, n) : words.slice(-n);
            if (part.every((word, i) => word === phrase[i])) {
                words = atStart ? words.slice(n) : words.slice(0, -n);
                changed = true;
                break;
            }
        }
    }
    return words;
}

// The question folded for matching, given the server's rules.
export function questionKey(question, rules = EMPTY_RULES) {
    const variants = rules?.variants || {};
    const text = String(question ?? "")
        .replace(/־/g, " ")
        .normalize("NFD")
        .replace(MARK_RE, "")
        .replace(HEBREW_MARKS_RE, "")
        .toLowerCase()
        .replace(QUOTES_RE, "")
        .replace(NOT_WORD_RE, " ");
    let tokens = text.split(/\s+/).filter(Boolean)
        .map((token) => (Object.hasOwn(variants, token) ? variants[token] : token));
    tokens = strip(tokens, phrases(rules?.leading), true);
    tokens = strip(tokens, phrases(rules?.trailing), false);
    return tokens.join(" ");
}

export async function fingerprint(key, subtle = globalThis.crypto?.subtle) {
    if (!subtle?.digest) return "";
    const bytes = await subtle.digest("SHA-256", new TextEncoder().encode(key));
    return Array.from(new Uint8Array(bytes).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

// The setting an answer belongs to, as the endpoint's query string.
export function settingQuery({ language = "en", mode = "balanced", lens = "All", web = true, kind = "ask" } = {}) {
    const params = new URLSearchParams({
        lang: language || "en",
        mode: mode || "balanced",
        lens: lens || "All",
        kind: kind === "thread" ? "thread" : "ask",
    });
    if (web === false) params.set("web", "0");
    return params.toString();
}

async function defaultFetchJson(url) {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) return null;
    return response.json();
}

export function createCommonAnswers({ fetchJson = defaultFetchJson, subtle = globalThis.crypto?.subtle } = {}) {
    const lists = new Map(); // setting query -> Promise<{ rules, keys:Set }>
    const rulesBySetting = new Map(); // setting query -> rules, once its list arrived
    const answers = new Map(); // setting query + "#" + folded question -> text

    function list(query) {
        if (!lists.has(query)) {
            const loaded = Promise.resolve()
                .then(() => fetchJson(`/api/ai/common-answers?${query}`))
                .then((body) => ({
                    rules: {
                        variants: body?.variants || {},
                        leading: body?.leading || [],
                        trailing: body?.trailing || [],
                    },
                    keys: new Set(Array.isArray(body?.keys) ? body.keys : []),
                }))
                .catch(() => ({ rules: EMPTY_RULES, keys: new Set() }))
                .then((found) => {
                    rulesBySetting.set(query, found.rules);
                    return found;
                });
            lists.set(query, loaded);
        }
        return lists.get(query);
    }

    function remember(id, text) {
        answers.delete(id);
        answers.set(id, text);
        while (answers.size > MAX_ANSWERS) answers.delete(answers.keys().next().value);
    }

    // Loads the setting's list. Call when the panel opens; nothing loads before.
    function load(setting) {
        return list(settingQuery(setting)).then(() => undefined);
    }

    // Fetches the answer for `question` when it is a listed one, once the
    // panel has loaded the setting's list. Resolves the text or null; never throws.
    async function prefetch(question, setting) {
        const query = settingQuery(setting);
        if (!lists.has(query)) return null;
        try {
            const { rules, keys } = await list(query);
            const key = questionKey(question, rules);
            if (!keys.size || !key) return null;
            const id = `${query}#${key}`;
            if (answers.has(id)) return answers.get(id);
            const print = await fingerprint(key, subtle);
            if (!print || !keys.has(print)) return null;
            const body = await fetchJson(`/api/ai/common-answers/${print}?${query}`);
            const text = typeof body?.answer === "string" ? body.answer.replace(MARKER_RE, "") : "";
            if (text) remember(id, text);
            return text || null;
        } catch {
            return null;
        }
    }

    // The already-fetched answer for `question`, synchronously, or null.
    function instant(question, setting) {
        const query = settingQuery(setting);
        const rules = rulesBySetting.get(query);
        if (!rules || !answers.size) return null;
        const key = questionKey(question, rules);
        return (key && answers.get(`${query}#${key}`)) || null;
    }

    // A debounced prefetch, for a composer's input events.
    function watch(getQuestion, getSetting, delay = TYPE_DELAY_MS) {
        let timer = 0;
        return () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const question = String(getQuestion() || "").trim();
                if (question) prefetch(question, getSetting());
            }, delay);
        };
    }

    return { load, prefetch, instant, watch };
}
