const listeners = new Set();

function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(target, patch) {
    if (!isPlainObject(patch)) {
        return target;
    }

    for (const [key, value] of Object.entries(patch)) {
        if (isPlainObject(value)) {
            if (!isPlainObject(target[key])) {
                target[key] = {};
            }
            deepMerge(target[key], value);
        } else {
            target[key] = value;
        }
    }
    return target;
}

const state = isPlainObject(window.appState) ? window.appState : {
    prefs: {
        mode: "balanced",
        community: "All",
    },
    ai: {
        pending: false,
        lastResponse: null,
        lastError: null,
    },
    dailyStudy: {
        refs: [],
        prewarmedAt: null,
    },
    semanticBookmarks: {
        items: [],
        lastUpdatedAt: null,
    },
};

window.appState = state;

function emitChange() {
    const snapshot = getState();
    for (const listener of listeners) {
        try {
            listener(snapshot);
        } catch {
            // Keep state updates resilient to consumer exceptions.
        }
    }
}

export function getState() {
    return state;
}

export function setState(patch) {
    deepMerge(state, patch || {});
    window.appState = state;
    emitChange();
    return state;
}

export function subscribe(listener) {
    if (typeof listener !== "function") {
        return () => { };
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
}

// The reader's community (minhag). Read it only through getMinhag(); a change
// fires MINHAG_CHANGE_EVENT on window so the calendar, siddur, library and AI
// update without a reload. Keep the values in step with backend/minhag.py
// (tests/test_minhag.py compares them).
export const MINHAGIM = Object.freeze(["sephardi", "mizrahi", "ashkenazi"]);
export const DEFAULT_MINHAG = "sephardi";
export const MINHAG_CHANGE_EVENT = "shelah:minhagchange";

// The AI's community lens for each minhag when the reader hasn't picked a
// specific community in the chat settings ("Mizrahi" has long been an alias
// of the Iraqi lens, backend/helpers.py COMMUNITY_ALIASES).
const MINHAG_AI_LENS = Object.freeze({ sephardi: "Sefardic", mizrahi: "Iraqi", ashkenazi: "Ashkenaz" });

export function normalizeMinhag(value) {
    const key = String(value ?? "").trim().toLowerCase();
    return MINHAGIM.includes(key) ? key : null;
}

export function getMinhag() {
    return normalizeMinhag(state.prefs?.minhag) || DEFAULT_MINHAG;
}

let announcedMinhag = null;

// Fires MINHAG_CHANGE_EVENT when the effective minhag differs from the last
// one announced (shell.js calls this after loading saved or server prefs).
export function announceMinhag() {
    const minhag = getMinhag();
    if (minhag === announcedMinhag) return false;
    const previous = announcedMinhag;
    announcedMinhag = minhag;
    const EventCtor = window.CustomEvent || CustomEvent;
    window.dispatchEvent(new EventCtor(MINHAG_CHANGE_EVENT, { detail: { minhag, previous } }));
    emitChange();
    return true;
}

export function setMinhag(value) {
    const minhag = normalizeMinhag(value);
    if (!minhag) return false;
    if (!isPlainObject(state.prefs)) state.prefs = {};
    if (state.prefs.minhag !== minhag) {
        state.prefs.minhag = minhag;
        window.ShelahPrefs?.save?.();
    }
    announceMinhag();
    return true;
}

export function onMinhagChange(listener) {
    if (typeof listener !== "function") return () => { };
    const handler = (event) => listener(event.detail.minhag, event.detail.previous);
    window.addEventListener(MINHAG_CHANGE_EVENT, handler);
    return () => window.removeEventListener(MINHAG_CHANGE_EVENT, handler);
}

// The community lens /ask gets: the chat's own pick when it names one, else
// the minhag's.
export function aiCommunityLens(community, minhag = getMinhag()) {
    const picked = String(community ?? "").trim();
    if (picked && picked.toLowerCase() !== "all") return picked;
    return MINHAG_AI_LENS[normalizeMinhag(minhag) || DEFAULT_MINHAG];
}

// The haftarah from one Hebcal `leyning` object: Hebcal only sends
// haftarah_sephardic in weeks where it differs, and Sephardi and Mizrahi
// readers read it.
export function haftarahFor(leyning, minhag = getMinhag()) {
    if (!isPlainObject(leyning)) return null;
    const pick = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
    if ((normalizeMinhag(minhag) || DEFAULT_MINHAG) !== "ashkenazi") {
        const sephardic = pick(leyning.haftarah_sephardic);
        if (sephardic) return sephardic;
    }
    return pick(leyning.haftarah);
}

window.ShelahState = {
    getState,
    setState,
    subscribe,
    getMinhag,
    setMinhag,
    announceMinhag,
    onMinhagChange,
    normalizeMinhag,
    aiCommunityLens,
    haftarahFor,
    MINHAGIM,
    MINHAG_CHANGE_EVENT,
    // NOTE: raw `state` is intentionally omitted — use getState() to read state.
};

export { state };
