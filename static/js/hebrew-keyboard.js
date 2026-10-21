/**
 * The on-screen keyboard under the search bar: Hebrew letters for a reader
 * without a Hebrew keyboard (or English letters for one without Latin keys).
 *
 * The button beside the search icon (#hebrewKeyboardBtn) opens a panel
 * (#hebrewKeyboard) the width of the search bar, right under it. Its keys
 * type into the search field at the caret and fire `input`, so the type-ahead
 * runs as if the letters were typed; the field keeps focus (pressing a key
 * is cancelled at pointerdown/mousedown, the key acts on click, which a
 * keyboard user's Enter or Space also gives).
 *
 * Layouts, the standard ones:
 *  - Wide bar (tablet and up): the full physical keyboard. Hebrew is the
 *    Israeli standard (SI-1452) with each key's Latin letter shown small, as
 *    on a printed keyboard; English is US QWERTY. Both have the number row,
 *    Backspace, Caps Lock, Enter and both Shifts. Shift gives the shifted
 *    symbol of the physical key; on the Hebrew layout Shift or Caps Lock on a
 *    letter gives the Latin capital, as a real Israeli keyboard does.
 *  - Narrow bar (phones): the standard phone layouts (three letter rows, a
 *    "?123" layer for digits and symbols), since 14 keys a row cannot fit.
 * Hebrew adds geresh ׳ and gershayim ״ beside the space bar. The "EN"/"עב"
 * key switches script; it opens in the other script from the site's
 * language (Hebrew letters on the English site, English on the Hebrew one).
 * Shift is one-shot; tapping it twice quickly locks it (as Caps Lock).
 * Enter runs the search.
 *
 * Closes on Escape, a click outside the search form, or the button again;
 * Escape and the button put focus back on the button. While it is open the
 * suggestions sit below it (--hebrew-kbd-h), never under it. On a touch
 * screen the field gets inputmode="none" while the panel is open, so the
 * phone's own keyboard does not come up over it.
 *
 * Motion: the panel enters and leaves on motion.js's popover preset
 * (transform/opacity only, and none at all with reduced motion).
 */

// Below this bar width the phone layouts are used.
const COMPACT_BELOW_PX = 600;
const DOUBLE_TAP_MS = 350;

// The full keyboard, by physical key (the US character on it).
const FULL_ROWS = [
    { cells: "`1234567890-=", end: ["backspace"] },
    { cells: "qwertyuiop[]\\" },
    { start: ["caps"], cells: "asdfghjkl;'", end: ["enter"] },
    { start: ["shift"], cells: "zxcvbnm,./", end: ["shift"] },
];
const US_SHIFT = {
    "`": "~", 1: "!", 2: "@", 3: "#", 4: "$", 5: "%", 6: "^", 7: "&", 8: "*", 9: "(", 0: ")",
    "-": "_", "=": "+", "[": "{", "]": "}", "\\": "|", ";": ":", "'": "\"", ",": "<", ".": ">", "/": "?",
};
// Israeli standard (SI-1452): what each physical key types in Hebrew.
const HEBREW_MAP = {
    "`": ";", q: "/", w: "'", e: "ק", r: "ר", t: "א", y: "ט", u: "ו", i: "ן", o: "ם", p: "פ",
    "[": "]", "]": "[", a: "ש", s: "ד", d: "ג", f: "כ", g: "ע", h: "י", j: "ח", k: "ל", l: "ך",
    ";": "ף", "'": ",", z: "ז", x: "ס", c: "ב", v: "ה", b: "נ", n: "מ", m: "צ", ",": "ת", ".": "ץ", "/": ".",
};

// The phone layouts, by the character each key types.
const COMPACT_ROWS = {
    he: [
        { cells: [..."קראטוןםפ"], end: ["backspace"] },
        { cells: [..."שדגכעיחלךף"] },
        { cells: [..."זסבהנמצתץ"] },
    ],
    en: [
        { cells: [..."qwertyuiop"] },
        { cells: [..."asdfghjkl"] },
        { start: ["shift"], cells: [..."zxcvbnm"], end: ["backspace"] },
    ],
    sym: [
        { cells: [..."1234567890"] },
        { cells: ["@", "#", "₪", "_", "&", "-", "+", "(", ")", "/"] },
        { cells: ["*", "\"", "'", ":", ";", "!", "?"], end: ["backspace"] },
    ],
};

const HEBREW_MARKS = [
    { text: "׳", en: "Geresh", he: "גרש" },
    { text: "״", en: "Gershayim", he: "גרשיים" },
];

const pageLanguage = (doc) => (doc.documentElement.getAttribute("lang") === "he" ? "he" : "en");
const isLatinLetter = (ch) => /^[a-z]$/i.test(ch);
const isHebrewChar = (ch) => /[֐-׿]/.test(ch);

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** One character back from `index` (a whole surrogate pair, never half). */
function previousCharStart(value, index) {
    if (index <= 0) return 0;
    const code = value.charCodeAt(index - 1);
    const low = code >= 0xdc00 && code <= 0xdfff;
    return low && index >= 2 ? index - 2 : index - 1;
}

/**
 * What a physical key types on the full keyboard. `shift` is Shift alone;
 * `caps` is Caps Lock (letters only, and it cancels against Shift).
 */
export function fullKeyChar(physical, layout, { shift = false, caps = false } = {}) {
    if (isLatinLetter(physical)) {
        const upper = shift !== caps;
        if (layout === "he") return upper ? physical.toUpperCase() : HEBREW_MAP[physical];
        return upper ? physical.toUpperCase() : physical;
    }
    if (shift) return US_SHIFT[physical] ?? physical;
    return layout === "he" ? (HEBREW_MAP[physical] ?? physical) : physical;
}

/**
 * Wires the keyboard to the search field. Returns {open, close, toggle,
 * isOpen, layout, mode} for tests and other callers, or null when the page
 * has no keyboard markup.
 */
export function installHebrewKeyboard({
    doc = document,
    win = window,
    input = doc.getElementById("searchInput"),
    button = doc.getElementById("hebrewKeyboardBtn"),
    panel = doc.getElementById("hebrewKeyboard"),
    form = doc.getElementById("searchForm"),
} = {}) {
    if (!input || !button || !panel) return null;

    let layout = null; // 'he' | 'en'; chosen on first open, then kept for the page's life
    let mode = "full"; // 'full' | 'compact', from the bar's width
    let symbols = false; // the phone layouts' "?123" layer
    let shift = false;
    let caps = false;
    let lastShiftAt = 0;
    let open = false;
    let resizeObserver = null;
    const t = (en, he) => (pageLanguage(doc) === "he" ? he : en);
    const coarsePointer = () => Boolean(win.matchMedia?.("(pointer: coarse)").matches);

    function currentMode() {
        const width = (form ?? panel).getBoundingClientRect?.().width || 0;
        return width > 0 && width < COMPACT_BELOW_PX ? "compact" : "full";
    }

    function charKey(text, sub = "") {
        const lang = isHebrewChar(text) ? ' lang="he"' : "";
        const subHtml = sub ? `<span class="kbd-sub" aria-hidden="true">${escapeHtml(sub)}</span>` : "";
        return `<button type="button" class="kbd-key" data-key="char" data-text="${escapeHtml(text)}"${lang}>`
            + `<span class="kbd-main">${escapeHtml(text)}</span>${subHtml}</button>`;
    }

    function specialKey(kind) {
        const wide = "kbd-key kbd-key-wide";
        switch (kind) {
            case "backspace":
                return `<button type="button" class="${wide} kbd-backspace" data-key="backspace" aria-label="${escapeHtml(t("Delete", "מחיקה"))}"><span aria-hidden="true">⌫</span></button>`;
            case "enter":
                return `<button type="button" class="${wide} kbd-enter" data-key="enter" aria-label="${escapeHtml(t("Search", "חיפוש"))}"><span aria-hidden="true">⏎</span></button>`;
            case "shift":
                return `<button type="button" class="${wide} kbd-shift" data-key="shift" aria-label="Shift" aria-pressed="${shift || caps ? "true" : "false"}"><span aria-hidden="true">⇧</span></button>`;
            case "caps":
                return `<button type="button" class="${wide} kbd-caps" data-key="caps" aria-pressed="${caps ? "true" : "false"}">Caps</button>`;
            case "toggle": {
                const label = layout === "he"
                    ? t("Switch to English letters", "מעבר לאותיות באנגלית")
                    : t("Switch to Hebrew letters", "מעבר לאותיות בעברית");
                return `<button type="button" class="${wide} kbd-toggle" data-key="toggle" aria-label="${escapeHtml(label)}"${layout === "he" ? "" : ' lang="he"'}>${layout === "he" ? "EN" : "עב"}</button>`;
            }
            case "layer": {
                const label = symbols ? t("Letters", "אותיות") : t("Numbers and symbols", "מספרים וסימנים");
                const text = symbols ? (layout === "he" ? "אבג" : "ABC") : "?123";
                return `<button type="button" class="${wide} kbd-layer" data-key="layer" aria-label="${escapeHtml(label)}"${symbols && layout === "he" ? ' lang="he"' : ""}>${text}</button>`;
            }
            case "space":
                return `<button type="button" class="kbd-key kbd-key-space" data-key="space" data-text=" " aria-label="${escapeHtml(t("Space", "רווח"))}"><span aria-hidden="true">${escapeHtml(t("space", "רווח"))}</span></button>`;
            default:
                return "";
        }
    }

    function markKey(mark) {
        return `<button type="button" class="kbd-key kbd-key-mark" data-key="char" data-text="${escapeHtml(mark.text)}" aria-label="${escapeHtml(t(mark.en, mark.he))}">${escapeHtml(mark.text)}</button>`;
    }

    function rowHtml(row, keyHtml) {
        const cells = typeof row.cells === "string" ? [...row.cells] : row.cells;
        return `<div class="kbd-row">${[
            ...(row.start ?? []).map(specialKey),
            ...cells.map(keyHtml),
            ...(row.end ?? []).map(specialKey),
        ].join("")}</div>`;
    }

    function bottomRow() {
        let keys;
        if (mode === "full") {
            keys = layout === "he"
                ? [specialKey("toggle"), markKey(HEBREW_MARKS[0]), specialKey("space"), markKey(HEBREW_MARKS[1])]
                : [specialKey("toggle"), specialKey("space")];
        } else {
            const [left, right] = layout === "he" && !symbols
                ? HEBREW_MARKS.map(markKey)
                : [charKey(","), charKey(".")];
            keys = [specialKey("layer"), specialKey("toggle"), left, specialKey("space"), right, specialKey("enter")];
        }
        return `<div class="kbd-row kbd-row-bottom">${keys.join("")}</div>`;
    }

    function render() {
        // Keep a keyboard user's focus on the same key across a re-render.
        const keysBefore = [...panel.querySelectorAll(".kbd-key")];
        const focusedIndex = keysBefore.indexOf(doc.activeElement);
        let rows;
        if (mode === "full") {
            rows = FULL_ROWS.map((row) => rowHtml(row, (physical) => {
                const text = fullKeyChar(physical, layout, { shift, caps });
                const sub = layout === "he" && isHebrewChar(text) ? physical.toUpperCase() : "";
                return charKey(text, sub);
            })).join("");
        } else {
            const upper = shift || caps;
            rows = COMPACT_ROWS[symbols ? "sym" : layout]
                .map((row) => rowHtml(row, (ch) => charKey(upper && isLatinLetter(ch) ? ch.toUpperCase() : ch)))
                .join("");
        }
        panel.innerHTML = rows + bottomRow();
        panel.setAttribute("aria-label", layout === "he"
            ? t("Hebrew keyboard", "מקלדת עברית")
            : t("English keyboard", "מקלדת אנגלית"));
        panel.dataset.layout = layout;
        panel.dataset.mode = mode;
        if (focusedIndex >= 0) panel.querySelectorAll(".kbd-key")[focusedIndex]?.focus();
    }

    function syncButton() {
        button.setAttribute("aria-expanded", open ? "true" : "false");
        button.setAttribute("aria-label", t("Hebrew keyboard", "מקלדת עברית"));
        button.title = t("On-screen keyboard", "מקלדת על המסך");
    }

    function fireInput() {
        input.dispatchEvent(new win.Event("input", { bubbles: true }));
    }

    function insert(text) {
        const value = input.value;
        const start = input.selectionStart ?? value.length;
        const end = input.selectionEnd ?? start;
        input.setRangeText(text, start, end, "end");
        fireInput();
        // Shift is one-shot: it lets go after one character.
        if (shift) {
            shift = false;
            render();
        }
    }

    function backspace() {
        const value = input.value;
        const start = input.selectionStart ?? value.length;
        const end = input.selectionEnd ?? start;
        if (start !== end) {
            input.setRangeText("", start, end, "end");
        } else if (start > 0) {
            input.setRangeText("", previousCharStart(value, start), start, "end");
        } else {
            return;
        }
        fireInput();
    }

    function pressShift() {
        const now = Date.now();
        if (caps) {
            caps = false;
            shift = false;
        } else if (shift && now - lastShiftAt < DOUBLE_TAP_MS) {
            // A quick second tap locks it.
            shift = false;
            caps = true;
        } else {
            shift = !shift;
        }
        lastShiftAt = now;
        render();
    }

    function submitSearch() {
        if (!input.value.trim()) return;
        closeKeyboard();
        if (typeof form?.requestSubmit === "function") form.requestSubmit();
        else form?.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    }

    // The suggestions sit under the panel while it is open: the form carries
    // the panel's height for static/style.css to offset them by. The same
    // observer swaps the full and phone layouts when the bar's width
    // crosses COMPACT_BELOW_PX.
    function trackSize() {
        const apply = () => {
            const next = currentMode();
            if (open && next !== mode) {
                mode = next;
                symbols = false;
                render();
            }
            form?.style.setProperty("--hebrew-kbd-h", `${panel.offsetHeight}px`);
        };
        apply();
        if (typeof win.ResizeObserver === "function" && !resizeObserver) {
            resizeObserver = new win.ResizeObserver(apply);
            resizeObserver.observe(panel);
            if (form) resizeObserver.observe(form);
        }
    }

    function openKeyboard() {
        if (open) return;
        if (!layout) layout = pageLanguage(doc) === "he" ? "en" : "he";
        open = true;
        mode = currentMode();
        symbols = false;
        shift = false;
        caps = false;
        render();
        syncButton();
        form?.classList.add("kbd-open");
        // A phone's own keyboard stays down while this one is up (and goes
        // down if it was already up: the blur below drops it, the refocus
        // after it no longer raises it).
        if (coarsePointer()) {
            input.setAttribute("inputmode", "none");
            input.blur();
        }
        win.ShelahMotion?.present
            ? win.ShelahMotion.present(panel, { preset: "popover", origin: button })
            : panel.classList.remove("hidden");
        trackSize();
        input.focus({ preventScroll: true });
    }

    function closeKeyboard({ restoreFocus = false } = {}) {
        if (!open) return;
        open = false;
        syncButton();
        form?.classList.remove("kbd-open");
        input.removeAttribute("inputmode");
        resizeObserver?.disconnect();
        resizeObserver = null;
        form?.style.removeProperty("--hebrew-kbd-h");
        win.ShelahMotion?.dismiss
            ? win.ShelahMotion.dismiss(panel, { preset: "popover" })
            : panel.classList.add("hidden");
        if (restoreFocus) button.focus({ preventScroll: true });
    }

    button.addEventListener("click", () => {
        if (open) closeKeyboard({ restoreFocus: true });
        else openKeyboard();
    });

    // A press on a key must not move focus out of the field.
    const keepFocus = (event) => {
        if (event.target.closest?.(".kbd-key")) event.preventDefault();
    };
    panel.addEventListener("pointerdown", keepFocus);
    panel.addEventListener("mousedown", keepFocus);

    panel.addEventListener("click", (event) => {
        // Clicks in the panel stop here: several keys re-render the panel, so
        // by the time a click reached the document its target would be
        // detached, and outside-click checks there (this one below, the phone
        // search tray's in shell.js) would read it as a click outside.
        event.stopPropagation();
        const key = event.target.closest?.(".kbd-key");
        if (!key) return;
        switch (key.dataset.key) {
            case "toggle":
                layout = layout === "he" ? "en" : "he";
                symbols = false;
                shift = false;
                caps = false;
                render();
                break;
            case "layer":
                symbols = !symbols;
                shift = false;
                render();
                break;
            case "shift":
                pressShift();
                break;
            case "caps":
                caps = !caps;
                shift = false;
                render();
                break;
            case "backspace":
                backspace();
                break;
            case "enter":
                submitSearch();
                break;
            default:
                insert(key.dataset.text || "");
        }
    });

    // Escape while the field or the panel has focus. When the suggestions
    // are showing, the field's own Escape closes them first (this listens in
    // the capture phase, before that handler hides them).
    doc.addEventListener("keydown", (event) => {
        if (!open || event.key !== "Escape") return;
        const inside = panel.contains(doc.activeElement) || doc.activeElement === input || doc.activeElement === button;
        if (!inside) return;
        const suggestions = doc.getElementById("searchSuggestions");
        if (doc.activeElement === input && suggestions && !suggestions.classList.contains("hidden")) return;
        // Only the keyboard closes: the phone search tray stays open.
        event.stopPropagation();
        closeKeyboard({ restoreFocus: true });
    }, true);

    doc.addEventListener("click", (event) => {
        if (!open) return;
        const target = event.target;
        if (form?.contains(target) || button.contains(target) || panel.contains(target)) return;
        closeKeyboard();
    });

    // The labels follow the site's language.
    if (typeof win.MutationObserver === "function") {
        new win.MutationObserver(() => {
            syncButton();
            if (open) render();
        }).observe(doc.documentElement, { attributes: true, attributeFilter: ["lang"] });
    }
    syncButton();

    return {
        open: openKeyboard,
        close: closeKeyboard,
        toggle: () => (open ? closeKeyboard() : openKeyboard()),
        isOpen: () => open,
        layout: () => layout,
        mode: () => mode,
    };
}
