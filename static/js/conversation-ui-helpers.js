// Pure helpers for static/js/conversation-ui.js -- no DOM, no globals, so
// tests_js/conversation_ui_helpers.test.js can exercise them directly.

import { ERROR_CODES } from "./conversation-api.js";

export const SIZES = Object.freeze(["mini", "overlay", "full"]);
export const DEFAULT_SIZE = "overlay";
export const CORNERS = Object.freeze(["br", "bl", "tr", "tl"]);

// Interface text by key (locales/<code>/conversation.json) in `lang`, through
// static/js/i18n.js; a language without its own text reads its fallback, then
// English. { count } picks the plural form.
function text(lang, key, values) {
    return window.ShelahI18n.translate(lang, key, values);
}

export function normalizeSize(size) {
    return SIZES.includes(size) ? size : DEFAULT_SIZE;
}

// The header's single "expand" control grows the panel one step:
// mini -> overlay -> full (full stays full).
export function expandedSize(size) {
    const current = normalizeSize(size);
    if (current === "mini") return "overlay";
    return "full";
}

// Which sizes block the page underneath (scrim / focus trap / scroll lock).
// The mini widget and the phone's minimised bar leave the page usable.
export function isModalSize(size) {
    return normalizeSize(size) !== "mini";
}

// Compact "time ago" for list rows: now / 5m / 3h / Yesterday / date.
export function relativeTime(iso, { now = Date.now(), lang = "en" } = {}) {
    const then = Date.parse(iso || "");
    if (!Number.isFinite(then)) return "";
    const seconds = Math.max(0, Math.round((now - then) / 1000));
    if (seconds < 60) return text(lang, "conversation.now");
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return text(lang, "conversation.minutes_ago", { minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 24) return text(lang, "conversation.hours_ago", { hours });
    const days = Math.floor(hours / 24);
    if (days === 1) return text(lang, "conversation.yesterday");
    const date = new Date(then);
    try {
        return date.toLocaleDateString(lang || "en", {
            month: "short",
            day: "numeric",
            ...(days > 300 ? { year: "numeric" } : {}),
        });
    } catch {
        return date.toISOString().slice(0, 10);
    }
}

// The heading a saved conversation sits under in the list: pinned ones first,
// then by the calendar day it last moved ("Today", "Yesterday", the 6 days
// before that, then everything older).
export function conversationGroup(item, { now = Date.now() } = {}) {
    if (item?.pinnedAt) return "pinned";
    const then = Date.parse(item?.updatedAt || item?.createdAt || "");
    if (!Number.isFinite(then)) return "earlier";
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const behind = startOfToday.getTime() - then;
    const day = 24 * 60 * 60 * 1000;
    if (behind <= 0) return "today";
    if (behind <= day) return "yesterday";
    if (behind <= 6 * day) return "week";
    return "earlier";
}

export function conversationGroupLabel(group, lang = "en") {
    const keys = {
        pinned: "conversation.group_pinned",
        today: "conversation.group_today",
        yesterday: "conversation.group_yesterday",
        week: "conversation.group_week",
        earlier: "conversation.group_earlier",
    };
    return text(lang, keys[group] || keys.earlier);
}

// Localized community name; the stored value is the English option value.
export function communityName(minhag, lang = "en", options = []) {
    const value = String(minhag || "").trim();
    if (!value || value.toLowerCase() === "all") return text(lang, "conversation.all_communities");
    const match = options.find((o) => o.value === value);
    return (lang === "he" && match?.he) || value;
}

// "Answers in this conversation follow Sefardic practice."
export function lockLine(minhag, lang = "en", options = []) {
    const value = String(minhag || "").trim();
    if (!value || value.toLowerCase() === "all") {
        return text(lang, "conversation.answers_in_this_conversation_draw_on");
    }
    const name = communityName(value, lang, options);
    return text(lang, "conversation.answers_in_this_conversation_follow_practice", { name });
}

function minutesText(seconds, lang) {
    const minutes = Math.max(1, Math.ceil(Number(seconds) / 60));
    return text(lang, "conversation.minutes_short", { minutes });
}

// The inline notice for store.lastError. `action` names what the notice's
// button does: "sign-in" | "retry-open" | "new" | null.
export function noticeFor(error, lang = "en") {
    if (!error) return null;
    const retryAfter = Number(error.retryAfter);
    const hasWait = Number.isFinite(retryAfter) && retryAfter > 0;
    switch (error.code) {
        case ERROR_CODES.BUDGET_EXHAUSTED:
            return {
                tone: "warn",
                text: text(lang, "conversation.youve_reached_todays_ai_limit_it"),
                action: null,
            };
        case ERROR_CODES.AI_PAUSED:
            return {
                tone: "warn",
                text: hasWait
                    ? text(lang, "conversation.ai_paused_wait", { wait: minutesText(retryAfter, lang) })
                    : text(lang, "conversation.ai_paused_moment"),
                action: null,
            };
        case ERROR_CODES.RATE_LIMITED:
            return {
                tone: "warn",
                text: hasWait
                    ? text(lang, "conversation.too_many_questions_wait", { retryAfter: Math.ceil(retryAfter) })
                    : text(lang, "conversation.too_many_questions_shortly"),
                action: null,
            };
        case ERROR_CODES.UNAUTHORIZED:
            return {
                tone: "warn",
                text: text(lang, "conversation.your_session_ended_sign_in_again"),
                action: "sign-in",
            };
        case ERROR_CODES.NOT_FOUND:
            return {
                tone: "warn",
                text: text(lang, "conversation.this_conversation_no_longer_exists"),
                action: "new",
            };
        case ERROR_CODES.NETWORK:
            return {
                tone: "warn",
                text: text(lang, "conversation.couldnt_reach_shelah_check_your_connection"),
                action: null,
            };
        case ERROR_CODES.ANSWER_INCOMPLETE:
            // Rendered on the turn itself ("Check again"), not as a banner.
            return null;
        // Search-bar answers (/ask, conversation-store.js askSearch).
        case "turnstile_required":
            return {
                tone: "warn",
                text: text(lang, "conversation.please_complete_the_quick_verification_check"),
                action: null,
            };
        case "timeout":
            return {
                tone: "warn",
                text: text(lang, "conversation.the_answer_took_too_long_please"),
                action: null,
            };
        case "guest_cap_reached":
            // The sign-in modal says the rest (guestCapCopy); this is what is
            // left on the page once it is dismissed.
            return {
                tone: "info",
                text: guestCapCopy(error.reason, error.usage, lang).title,
                action: "sign-in",
            };
        default:
            return {
                tone: "warn",
                text: text(lang, "conversation.something_went_wrong_please_try_again"),
                action: null,
            };
    }
}

// ── signed-out limits (backend/guest_cap.py) ──────────────────────────────

// How many questions a guest has left, below which the composer warns.
export const GUEST_WARN_AT = 2;

// The sign-in modal's words when a guest question is refused. `reason` is the
// server's: "thread_questions" | "thread_tokens" | "daily"; `usage` its counters.
export function guestCapCopy(reason, usage, lang = "en") {
    const limit = Number(usage?.questions_limit) > 0 ? Number(usage.questions_limit) : 8;
    if (reason === "daily") {
        return {
            title: text(lang, "conversation.guest_limit_daily_title"),
            body: text(lang, "conversation.sign_in_or_create_a_free"),
        };
    }
    const title = text(lang, "conversation.guest_limit_thread_title");
    const waiting = text(lang, "conversation.this_conversation_its_sources_and_the");
    const allowance = reason === "thread_tokens"
        ? text(lang, "conversation.this_conversation_has_used_its_guest")
        : text(lang, "conversation.guests_can_ask_up_to_questions", { limit });
    return { title, body: `${allowance} ${waiting}` };
}

// The line above the composer as a guest's allowance runs low, or null while
// there is plenty (or no count at all, e.g. a stored answer or a signed-in
// thread). `usage` is the `guest` object an answer carries.
export function guestBannerText(usage, lang = "en") {
    if (!usage || !Number.isFinite(Number(usage.remaining))) return null;
    const left = Number(usage.remaining);
    if (left > GUEST_WARN_AT) return null;
    const today = usage.binding === "daily";
    if (left <= 0) {
        return today
            ? text(lang, "conversation.guest_limit_daily_sign_in")
            : text(lang, "conversation.guest_limit_thread_sign_in");
    }
    if (today) {
        return text(lang, "conversation.guest_left_today", { count: left });
    }
    return text(lang, "conversation.guest_left_thread", { count: left });
}

// Nearest corner for a dragged mini widget, from its centre point.
export function snapCorner({ x, y }, { width, height }) {
    const right = x >= width / 2;
    const bottom = y >= height / 2;
    return `${bottom ? "b" : "t"}${right ? "r" : "l"}`;
}

// Mirror a physical corner for RTL (data-corner uses logical inline sides).
export function logicalCorner(corner, rtl) {
    if (!CORNERS.includes(corner)) return "br";
    if (!rtl) return corner;
    return corner[0] + (corner[1] === "r" ? "l" : "r");
}

// ── mini widget size ───────────────────────────────────────────────────
// The floating widget can be resized within these bounds (CSS px). `w` is the
// width of the chat itself; the history column that opens beside it adds
// MINI_HISTORY_RATIO of that on top (conversation.css --conv-hist-w uses the
// same ratio), so a wider widget gets a proportionally wider list.
export const MINI_BOUNDS = Object.freeze({ minW: 300, maxW: 520, minH: 320, maxH: 720 });
export const MINI_HISTORY_RATIO = 0.6;
export const MINI_STEP_PX = 24;
// What the viewport keeps free around the widget: the CSS gutter on both
// sides (--sp-4 each) and, vertically, the top bar plus the --sp-8 margins.
const MINI_GUTTER_X = 32;
const MINI_GUTTER_Y = 120;

function clampTo(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
}

// A size inside the bounds and inside the window. `h` may be null (the widget
// sizes itself to its content, up to a ceiling).
export function clampMiniSize({ w, h = null }, viewport, { historyOpen = false } = {}) {
    const span = historyOpen ? 1 + MINI_HISTORY_RATIO : 1;
    const maxW = Math.min(MINI_BOUNDS.maxW, (viewport.width - MINI_GUTTER_X) / span);
    const maxH = Math.min(MINI_BOUNDS.maxH, viewport.height - MINI_GUTTER_Y);
    return {
        w: Math.round(clampTo(w, MINI_BOUNDS.minW, maxW)),
        h: h == null ? null : Math.round(clampTo(h, MINI_BOUNDS.minH, maxH)),
    };
}

// The saved size from storage (or null when it is missing or not a size).
export function parseMiniSize(raw) {
    let data;
    try {
        data = JSON.parse(raw);
    } catch {
        return null;
    }
    const finite = (n) => typeof n === "number" && Number.isFinite(n);
    if (!data || !finite(data.w)) return null;
    return {
        w: Math.round(clampTo(data.w, MINI_BOUNDS.minW, MINI_BOUNDS.maxW)),
        h: finite(data.h) ? Math.round(clampTo(data.h, MINI_BOUNDS.minH, MINI_BOUNDS.maxH)) : null,
    };
}

// The size after dragging a free edge or corner by (dx, dy). The widget stays
// pinned to its corner, so pulling away from it grows it: with the corner on
// the right a leftward drag widens it, with the corner at the bottom an upward
// drag makes it taller. `anchor` is where the widget sits ({ right, bottom }),
// `axes` which edges the handle moves ("x", "y" or "xy").
export function dragMiniSize({ start, dx, dy, anchor, axes = "xy", historyOpen = false }, viewport) {
    const span = historyOpen ? 1 + MINI_HISTORY_RATIO : 1;
    const growX = anchor.right ? -dx : dx;
    const growY = anchor.bottom ? -dy : dy;
    const next = {
        w: axes.includes("x") ? start.w + growX / span : start.w,
        h: axes.includes("y") ? (start.h ?? 0) + growY : start.h,
    };
    return clampMiniSize(next, viewport, { historyOpen });
}

// Arrow keys as a drag of one step, in screen directions (the same maths as
// the pointer, so the corner the widget sits in decides which way grows).
export function miniKeyDelta(key) {
    const step = MINI_STEP_PX;
    switch (key) {
        case "ArrowLeft": return { dx: -step, dy: 0 };
        case "ArrowRight": return { dx: step, dy: 0 };
        case "ArrowUp": return { dx: 0, dy: -step };
        case "ArrowDown": return { dx: 0, dy: step };
        default: return null;
    }
}

// Excerpt in the reader's language, falling back to the other one.
export function citationExcerpt(citation, lang = "en") {
    if (!citation) return "";
    return lang === "he"
        ? citation.excerptHe || citation.excerptEn || ""
        : citation.excerptEn || citation.excerptHe || "";
}

// Whether most of the letters in `text` are Hebrew. Cardo's Hebrew bold face
// covers only a few letters (a bold heading came out half regular, half
// bold), so a Hebrew answer's headings take a stroke instead (conversation.css).
export function mostlyHebrew(text) {
    const s = String(text || "");
    const hebrew = (s.match(/[\u05D0-\u05EA]/g) || []).length;
    const latin = (s.match(/[A-Za-z]/g) || []).length;
    return hebrew > 0 && hebrew >= latin;
}

// Change-detection key for a rendered transcript turn.
export function turnSignature(message) {
    if (!message) return "";
    const cites = (message.citations || []).map((c) => c.ref).join("|");
    return `${message.role}:${message.status}:${message.content.length}:${message.content.slice(-24)}:${cites}`;
}
