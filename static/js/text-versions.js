// The reader's text-version picker (#readerVersionPicker in the reader
// settings menu). The server decides which versions exist and are allowed
// (backend/text_trust.py): /api/text sends `versions` = {he, en, available},
// and this only shows those and remembers the reader's pick per book.
//
// A pick is stored under the book's indexTitle and sent as ?vhe= / ?ven= on
// every /api/text request for a ref in that book, together with ?minhag=,
// which picks the default when there is no pick. The server ignores a pick
// it doesn't allow, so a stale or edited pick can never show a hidden version.

const STORAGE_KEY = "shelah:textVersions";
const MAX_BOOKS = 200;
const LANGS = ["he", "en"];

function readPicks(storage) {
    try {
        const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || "{}");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function writePicks(storage, picks) {
    try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(picks));
    } catch {
        // Private mode or a full store: the pick lasts until the page closes.
    }
}

// The stored pick for the book `ref` belongs to: the longest stored book
// title that `ref` starts with ("Shulchan Arukh, Orach Chayim 1" finds
// "Shulchan Arukh, Orach Chayim"), so a request can carry it before the
// server has said which book the ref is in.
export function pickForRef(ref, picks) {
    const wanted = String(ref || "").trim().toLowerCase();
    let best = null;
    let bestLength = 0;
    for (const [title, pick] of Object.entries(picks || {})) {
        const key = title.toLowerCase();
        const fits = wanted === key || wanted.startsWith(`${key} `) || wanted.startsWith(`${key},`)
            || wanted.startsWith(`${key}.`);
        if (fits && key.length > bestLength && pick && typeof pick === "object") {
            best = pick;
            bestLength = key.length;
        }
    }
    return best;
}

// The query string (no leading "&") /api/text gets for `ref`.
// The default community is left out, so its requests share one cached URL
// with the server-rendered page and the reader's first load.
export function textQuery(ref, { minhag, picks, defaultMinhag = "sephardi" } = {}) {
    const params = new URLSearchParams();
    if (minhag && minhag !== defaultMinhag) params.set("minhag", minhag);
    const pick = pickForRef(ref, picks);
    for (const lang of LANGS) {
        const title = pick?.[lang];
        if (typeof title === "string" && title) params.set(lang === "he" ? "vhe" : "ven", title);
    }
    return params.toString();
}

// `picks` with `book`'s pick for `lang` set (or cleared when `title` is "").
export function withPick(picks, book, lang, title) {
    const next = { ...picks };
    const entry = { ...(next[book] || {}) };
    if (title) entry[lang] = title;
    else delete entry[lang];
    delete next[book];
    if (Object.keys(entry).length) next[book] = entry;
    const books = Object.keys(next);
    for (const old of books.slice(0, Math.max(0, books.length - MAX_BOOKS))) delete next[old];
    return next;
}

function fillSelect(doc, select, rows, chosen, defaultLabel) {
    select.replaceChildren();
    const first = doc.createElement("option");
    first.value = "";
    first.textContent = defaultLabel;
    select.append(first);
    for (const row of rows) {
        const option = doc.createElement("option");
        option.value = row.title;
        option.textContent = row.label;
        option.title = row.title;
        select.append(option);
    }
    select.value = chosen || "";
}

export function installTextVersionPicker({
    doc = document,
    storage = globalThis.localStorage,
    getMinhag = () => null,
    t = (en) => en,
    onPick = () => { },
} = {}) {
    const root = doc.getElementById("readerVersionPicker");
    const selects = { he: doc.getElementById("readerVersionHe"), en: doc.getElementById("readerVersionEn") };
    const rows = { he: doc.getElementById("readerVersionHeRow"), en: doc.getElementById("readerVersionEnRow") };
    let book = "";
    let picks = readPicks(storage);

    // Draw the picker for a loaded /api/text payload; hidden when the text
    // has no choice to make.
    function render(payload) {
        if (!root || !selects.he || !selects.en) return;
        const versions = payload?.versions;
        const available = Array.isArray(versions?.available) ? versions.available : [];
        book = String(payload?.indexTitle || "").trim();
        let shown = 0;
        for (const lang of LANGS) {
            const options = available.filter((row) => row?.lang === lang && row.title && row.label);
            const stored = picks[book]?.[lang] || "";
            const chosen = options.some((row) => row.title === stored) ? stored : "";
            // Without a pick the version shown is the community default, so
            // the first option can name it.
            const defaultLabel = t("Default for my community", "ברירת המחדל של הקהילה שלי");
            const shownLabel = !chosen && versions?.[lang]?.label;
            fillSelect(doc, selects[lang], options, chosen,
                shownLabel ? `${defaultLabel} (${shownLabel})` : defaultLabel);
            const hasChoice = options.length > 1;
            rows[lang]?.classList.toggle("hidden", !hasChoice);
            if (hasChoice) shown += 1;
        }
        root.classList.toggle("hidden", !book || shown === 0);
    }

    for (const lang of LANGS) {
        selects[lang]?.addEventListener("change", () => {
            if (!book) return;
            picks = withPick(readPicks(storage), book, lang, selects[lang].value);
            writePicks(storage, picks);
            onPick({ book, lang, title: selects[lang].value });
        });
    }

    return {
        render,
        query: (ref) => textQuery(ref, { minhag: getMinhag(), picks }),
    };
}
