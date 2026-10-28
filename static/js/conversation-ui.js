// Multi-turn "Ask Sh'elah" conversation UI (design artifact "Conversation UI
// Placement Options"). Renders conversation-store.js into the markup in
// templates/index.html and wires every entry point to it:
//   - #convPanel      one panel, data-size = overlay | full | mini, and
//                     data-layout = desktop | mobile (on phones overlay is a
//                     bottom sheet and mini is the #convPip bar)
//   - #convHistoryPop recent conversations, shared by every history button:
//                     in the phone search tray and in the panel's header
//   - #topbarAskBtn   "Ask AI" beside the desktop search bar; opens the
//                     conversation as the mini corner widget, cross-fading in
//                     where it lives (a second press closes it again)
//   - #mobileTopbarAskBtn  the same mark in the phone top bar; opens the
//                     full-screen overlay
//   - #mobileSearchTray  rises above the tab bar while phone search is open:
//                     "Ask Sh'elah" (opens the conversation) + history
//   - #aiDiscoveryTip  one-time "there's an AI here" tip, anchored to the Ask
//                     button (desktop) or the phone Ask button; gone for
//                     good once the AI has been used or the tip dismissed
//
// Sources: every citation (the list under an answer, and the cards in the
// "Consulted N sources" drawer) opens the exact text in the reader and folds
// the conversation to mini so the text is what's on screen. The cards are
// .ai-source-box markup from source-cards.js. The answer itself never lists
// its sources: the model tags each claim with a number ([1], [2]...), shown
// as a small chip (citation-markers.js) whose card (citation-popover.js)
// names the source and leads to it, and the list under the answer is the one
// place the sources are written out.
//
// Routing (router.js): /chat/<id|new>[/<community>/<mode>][/mini|/full]. Opening pushes a
// history entry, resizing replaces it, and once the first question creates
// the row, `new` is replaced by the real id so the URL is shareable. The
// classic script's hydrateRoute() hands every route to hydrate() below.
//
// Search-bar answers: the classic script's handleAiSearch asks through the
// one-shot /ask (saved to ask_history, works signed out) and shows the answer
// here as the first turn (store.askSearch); stored and shared answers
// (/answer/<id>, /a/<token>, history, shelf) open the same way
// (store.showAnswer). The first follow-up turns a signed-in answer into a
// conversation seeded from its ask_history row. Decision A1: conversations
// are saved per Clerk user, so signed out the composer asks a new one-shot
// question instead, and an answer on screen offers "Sign in to follow up".
//
// Sharing: an answer's own Share control (answer-link.js) and, for a saved
// conversation, the header's Share button (conversation-share.js) both copy
// a public /a/<token> link. A conversation link opens read-only through
// showPublicConversation.

import { createConversationStore, MESSAGE_STATUS } from "./conversation-store.js";
import { aiCommunityLens, onMinhagChange } from "./state.js";
import { isSignedIn } from "./conversation-entry.js";
import { closeOverlay, pushRoute, readRoute, routeUrl } from "./router.js";
import { icon as phosphorIcon } from "./icons.js";
import { activeLabel, createProgress, doneLabel, progressView, viewKey } from "./ask-progress.js";
import { sourceBadgeHtml, externalLinksHtml, previewHtml, hebrewRefName, readerRef, isWebRef, webSourceHeadHtml } from "./source-cards.js";
import { citeIdPrefix, injectMarkers, placeMarkers, stripSourcesBlock } from "./citation-markers.js";
import { createCitationPopover } from "./citation-popover.js";
import { createConversationShare } from "./conversation-share.js";
import { createVoiceInput } from "./conversation-voice.js";
import { createMiniWidget } from "./conversation-mini.js";
import {
    normalizeSize,
    expandedSize,
    isModalSize,
    relativeTime,
    communityName,
    lockLine,
    noticeFor,
    guestBannerText,
    guestCapCopy,
    snapCorner,
    logicalCorner,
    citationExcerpt,
    conversationGroup,
    conversationGroupLabel,
    turnSignature,
    mostlyHebrew,
} from "./conversation-ui-helpers.js";

const MOBILE_QUERY = "(max-width: 1023px)";
const CORNER_KEY = "shelah.conv.corner";
const AUTH_TIMEOUT_MS = 10000;
const LIST_STALE_MS = 30000;
// A toast with nothing to press leaves quickly; one carrying an action (Undo,
// Stop sharing) stays long enough to be reached.
const TOAST_MS = 5000;
const TOAST_ACTION_MS = 8000;
const VOICE_NOTICE_KEY = "shelah.conv.voiceNotice";
const NEAR_BOTTOM_PX = 96;
const SWIPE_CLOSE_PX = 120;
// A step's name stays up at least this long before the next replaces it, so a
// lookup that finishes in a blink is never read as a flicker.
const STATUS_MIN_DWELL_MS = 700;
const AI_USED_KEY = "shelah.ai.used";
const TIP_DISMISSED_KEY = "shelah.ai.tipDismissed";
const TIP_DELAY_MS = 1600;
const TIP_GAP_PX = 12;
// Menus that drop from the same top bars the tip points at. The tip never
// shows over one: it waits for it to close, and steps aside if one opens
// while the tip is up.
const TIP_BLOCKING_MENU_IDS = ["readerSettingsPanel", "settingsPanel", "userProfileMenu"];

const ui = {
    installed: false,
    open: false,
    size: "overlay",
    layout: "desktop",
    mode: null,
    // A link's community (router.js AI keys) while it's in the URL.
    routeMinhag: null,
    signedIn: false,
    authResolved: false,
    awaitingOpenId: null,     // deep-linked id waiting for sign-in
    returnFocus: null,
    popTrigger: null,
    menuOpen: false,
    sharePopOpen: false,
    toast: null,              // { text, action, tone } -- e.g. delete + Undo
    toastTimer: null,
    listLoadedAt: 0,
    renderQueued: false,
    turns: new Map(),         // message id -> { li, sig }
    threadKey: null,          // which thread the turn cache belongs to
    animateInserts: false,
    forceScroll: false,
    lastListRef: null,
    lastListItems: null,
    lastRouteSync: null,
    tipAnchor: null,
    tipTimer: null,
    tipDeferred: false,
    tipObserver: null,
    previews: new Map(),      // ref -> Promise<text payload | null>: the sources drawer and Hebrew ref names
    publicState: null,        // "loading" | "gone" | "error" while a shared link resolves;
                              // "saved" | "saved-signin" | "saved-gone" | "saved-error" for an /answer/<id> one
    sharing: false,           // a Share press is in flight
    shareLoadedFor: null,     // the conversation whose share state was last fetched
};

let store = null;
let shareControl = null;
let voice = null;
let mini = null;
let els = null;
// The card a numbered source chip opens (citation-popover.js); made in bindEvents.
let citePop = null;
let resolveAuth = null;
const authReady = new Promise((resolve) => { resolveAuth = resolve; });

// ── small utilities ────────────────────────────────────────────────────

function lang() {
    try {
        if (typeof window.getCurrentLanguage === "function") return window.getCurrentLanguage();
    } catch { /* fall through */ }
    return document.documentElement.lang === "he" ? "he" : "en";
}

function tr(en, he) {
    return lang() === "he" ? he : en;
}

function motion() {
    return window.ShelahMotion || null;
}

function reducedMotion() {
    return Boolean(motion()?.isMotionReduced?.()) || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function escapeText(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

let iconPaths = {};
function icon(name, cls = "") {
    const d = iconPaths[name];
    if (!d) return "";
    const classAttr = cls ? ` class="${cls}"` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"${classAttr}><path d="${d}"/></svg>`;
}

function clerkConfigured() {
    return Boolean(window.APP_CLERK?.publishableKey);
}

// The community list lives in index.html's <template id="communityOptions">.
function communityOptions() {
    const list = document.getElementById("communityOptions");
    if (!list) return [];
    return [...list.content.querySelectorAll("option")].map((o) => ({ value: o.value, en: o.dataset.en || o.value, he: o.dataset.he || o.value }));
}

// The "Web search" switch in the chat menu; on unless the reader turned it off.
function webSearchOn() {
    return window.appState?.prefs?.webSearch !== false;
}

function currentMode() {
    if (!ui.mode) ui.mode = window.appState?.prefs?.mode || "balanced";
    return ui.mode;
}

// The community a new thread starts with: a link's community, else the
// visitor's own preference (which the link never overwrites). "All" (shown
// as "All communities") lets the AI draw on every community.
function defaultMinhag() {
    return ui.routeMinhag || aiCommunityLens(window.appState?.prefs?.community);
}

function effectiveLayout() {
    return window.matchMedia(MOBILE_QUERY).matches ? "mobile" : "desktop";
}

function readCorner() {
    try {
        const value = window.localStorage.getItem(CORNER_KEY);
        return ["br", "bl", "tr", "tl"].includes(value) ? value : "br";
    } catch {
        return "br";
    }
}

function readFlag(key) {
    try {
        return window.localStorage.getItem(key) === "1";
    } catch {
        return false;
    }
}

function writeFlag(key) {
    try {
        window.localStorage.setItem(key, "1");
    } catch {
        // Blocked storage: the tip may show again next visit, which is harmless.
    }
}

function clearFlag(key) {
    try {
        window.localStorage.removeItem(key);
    } catch {
        // Blocked storage: nothing was stored to clear.
    }
}

function saveCorner(corner) {
    try {
        window.localStorage.setItem(CORNER_KEY, corner);
    } catch {
        // Private mode / blocked storage: the corner just isn't remembered.
    }
}

// ── elements ───────────────────────────────────────────────────────────

function collectElements() {
    const $ = (id) => document.getElementById(id);
    const panel = $("convPanel");
    if (!panel) return null;
    return {
        panel,
        scrim: $("convScrim"),
        header: panel.querySelector(".conv-header"),
        grabber: panel.querySelector(".conv-grabber"),
        title: $("convTitle"),
        subtitle: $("convSubtitle"),
        historyBtn: $("convHistoryBtn"),
        sidebar: $("convSidebar"),
        main: panel.querySelector(".conv-main"),
        resizeCorner: $("convResizeBtn"),
        resizeEdges: [...panel.querySelectorAll(".conv-resize[data-resize-axis]")],
        chipLabel: $("convMinhagChipLabel"),
        menuBtn: $("convMenuBtn"),
        menu: $("convMenu"),
        menuLocked: $("convMenuMinhagLocked"),
        menuDraft: $("convMenuMinhagDraft"),
        minhagSelect: $("convMinhagSelect"),
        pinLabel: $("convPinLabel"),
        webSearchSwitch: $("convWebSearchSwitch"),
        webSearchState: $("convWebSearchState"),
        shareBtn: $("convShareBtn"),
        sharePop: $("convSharePop"),
        themeBtn: $("convThemeBtn"),
        expandBtn: $("convExpandBtn"),
        lockLine: $("convLockLine"),
        scroller: $("convScroller"),
        empty: $("convEmpty"),
        signedOutHint: $("convSignedOutHint"),
        loading: $("convLoading"),
        messages: $("convMessages"),
        jump: $("convJumpBtn"),
        notice: $("convNotice"),
        noticeText: $("convNoticeText"),
        noticeAction: $("convNoticeAction"),
        toast: $("convToast"),
        toastText: $("convToastText"),
        toastAction: $("convToastAction"),
        toastClose: $("convToastClose"),
        composer: $("convComposer"),
        input: $("convInput"),
        micBtn: $("convMicBtn"),
        send: $("convSendBtn"),
        pip: $("convPip"),
        pipOpen: $("convPipOpen"),
        pipTitle: $("convPipTitle"),
        pipStatus: $("convPipStatus"),
        barStatus: $("searchLiveStatus"),
        pop: $("convHistoryPop"),
        popSignedOut: document.querySelector("#convHistoryPop .conv-pop__signed-out"),
        tray: $("mobileSearchTray"),
        trayAsk: $("mobileTrayAskBtn"),
        trayHistory: $("mobileTrayHistoryBtn"),
        topAsk: $("topbarAskBtn"),
        phoneAsk: $("mobileTopbarAskBtn"),
        tip: $("aiDiscoveryTip"),
        tipTry: $("aiDiscoveryTipTry"),
        tipDismiss: $("aiDiscoveryTipDismiss"),
        guestBanner: $("convGuestBanner"),
        guestBannerText: $("convGuestBannerText"),
        guestCap: $("convGuestCap"),
        guestCapTitle: $("convGuestCapTitle"),
        guestCapBody: $("convGuestCapBody"),
        answerLink: $("convAnswerLink"),
        answerLinkPark: $("convAnswerLinkPark"),
        lists: [...document.querySelectorAll("[data-conv-list]")],
    };
}

// ── rendering ──────────────────────────────────────────────────────────

function scheduleRender() {
    if (ui.renderQueued) return;
    ui.renderQueued = true;
    queueMicrotask(() => {
        ui.renderQueued = false;
        render();
    });
}

// What the panel says about a public (/answer/<id>) link that did not open,
// by `ui.publicState`.
const PUBLIC_STATE_NOTICES = {
    "saved-signin": () => ({ tone: "info", text: tr(
        "Sign in to see this saved answer, or open the link on the device that saved it.",
        "התחבר כדי לראות את התשובה השמורה, או פתח את הקישור במכשיר שבו נשמרה."), action: "sign-in" }),
    "saved-gone": () => ({ tone: "info", text: tr(
        "This saved answer isn't available. It may have been deleted, or saved under another account or device.",
        "התשובה השמורה אינה זמינה. ייתכן שנמחקה, או שנשמרה בחשבון או במכשיר אחר.") }),
    "saved-error": () => ({ tone: "warn", text: tr(
        "Couldn't load this saved answer. Check your connection and reload the page to try again.",
        "לא ניתן היה לטעון את התשובה השמורה. בדוק/י את החיבור וטען/י מחדש את הדף.") }),
    gone: () => ({ tone: "info", text: tr(
        "This shared answer isn't available. The link may have been turned off, or the answer was deleted. You can still ask your own question.",
        "התשובה המשותפת אינה זמינה. ייתכן שהקישור בוטל או שהתשובה נמחקה. עדיין אפשר לשאול שאלה משלך.") }),
    error: () => ({ tone: "warn", text: tr(
        "Couldn't load this shared answer. Check your connection and reload the page to try again.",
        "לא ניתן היה לטעון את התשובה המשותפת. בדוק/י את החיבור וטען/י מחדש את הדף.") }),
};

// Notice: load error > send error > awaiting sign-in > a public link that
// did not open. A passing confirmation is not one of these: it is the toast,
// drawn apart.
function currentNotice(state, l) {
    if (state.loadStatus === "error") {
        const notice = noticeFor(state.loadError, l);
        if (notice && !notice.action) notice.action = "retry-open";
        return notice;
    }
    if (state.lastError) return noticeFor(state.lastError, l);
    if (ui.awaitingOpenId && ui.authResolved && !ui.signedIn && clerkConfigured()) {
        return { tone: "info", text: tr("Sign in to open this conversation.", "התחבר כדי לפתוח את השיחה הזו."), action: "sign-in" };
    }
    return Object.hasOwn(PUBLIC_STATE_NOTICES, ui.publicState) ? PUBLIC_STATE_NOTICES[ui.publicState]() : null;
}

// The panel's title: the conversation's, else the question of the answer on
// screen, else what a public link is, else a fresh-conversation prompt.
function panelTitle(state, answerView, hasMessages) {
    const question = answerView ? (state.answerView.title || state.messages.find((m) => m.role === "user")?.content) : "";
    let publicTitle = "";
    if (ui.publicState) {
        // An /answer/<id> link: loading until it is fetched -- with the
        // account's token, or the device cookie when signed out -- then, if
        // neither holds the answer, a prompt to sign in in its place (audit L-5).
        const savedLink = String(ui.publicState).startsWith("saved");
        publicTitle = savedLink ? tr("Saved answer", "תשובה שמורה") : tr("Shared answer", "תשובה משותפת");
    }
    return state.conversation?.title
        || question
        || publicTitle
        || (hasMessages ? tr("New conversation", "שיחה חדשה") : tr("Ask Sh'elah", "שאל את ש׳אלה"));
}

function renderHeader(state, { l, name, title, options }) {
    const conversation = state.conversation;
    if (!els.title.querySelector("input")) {
        els.title.textContent = title;
        els.title.dataset.script = mostlyHebrew(title) ? "he" : "";
    }
    // "All communities" is already a phrase; a single community reads "<name> practice".
    const minhag = String((state.minhagLocked ? conversation?.minhag : state.draftMinhag) || "").trim();
    const isAll = !minhag || minhag.toLowerCase() === "all";
    const subtitle = isAll ? name : tr(`${name} practice`, `מנהג ${name}`);
    els.subtitle.textContent = ui.layout === "mobile" ? subtitle : "";
    els.chipLabel.textContent = name;
    els.menuBtn.dataset.locked = state.minhagLocked ? "true" : "false";
    const settingsLabel = state.minhagLocked
        ? tr(`Conversation settings. Community: ${name}, locked for this conversation`, `הגדרות שיחה. קהילה: ${name}, נעולה לשיחה זו`)
        : tr(`Conversation settings. Community: ${name}`, `הגדרות שיחה. קהילה: ${name}`);
    els.menuBtn.setAttribute("aria-label", settingsLabel);
    els.menuBtn.title = settingsLabel;

    els.lockLine.textContent = state.minhagLocked
        ? lockLine(conversation?.minhag, l, options)
        : "";
}

function renderMenu(state, { l, name, options }) {
    const conversation = state.conversation;
    els.menuLocked.textContent = state.minhagLocked
        ? tr(`${name} — locked for this conversation. Start a new conversation to change it.`,
            `${name} — נעולה לשיחה זו. התחל שיחה חדשה כדי לשנות.`)
        : "";
    els.menuDraft.classList.toggle("hidden", state.minhagLocked);
    if (!state.minhagLocked) syncMinhagSelect(options, state.draftMinhag, l);
    els.menu.querySelectorAll("[data-conv-mode] input").forEach((radio) => {
        radio.checked = radio.value === currentMode();
    });
    const webOn = webSearchOn();
    els.webSearchSwitch?.setAttribute("aria-checked", webOn ? "true" : "false");
    if (els.webSearchState) els.webSearchState.textContent = webOn ? tr("On", "פועל") : tr("Off", "כבוי");
    els.pinLabel.textContent = conversation?.pinnedAt ? tr("Unpin", "בטל הצמדה") : tr("Pin", "הצמד");
    syncShare(conversation);
}

// Body: loading / empty / transcript. Returns the live progress, if any.
function renderBody(state, l, hasMessages) {
    const loading = state.loadStatus === "loading" || (ui.awaitingOpenId && !ui.authResolved) || ui.publicState === "loading"
        || ui.publicState === "saved";
    els.loading.classList.toggle("hidden", !loading);
    els.empty.classList.toggle("hidden", loading || hasMessages || state.loadStatus === "error");
    els.signedOutHint.classList.toggle("hidden", !clerkConfigured() || ui.signedIn || !ui.authResolved);
    els.scroller.setAttribute("aria-busy", loading ? "true" : "false");
    renderTurns(state, l);
    return state.sending ? renderStatus(state, l) : null;
}

function composerPlaceholder(hasMessages, continues) {
    if (!hasMessages) return tr("Ask a question…", "שאל שאלה…");
    return continues ? tr("Ask a follow-up…", "שאל שאלת המשך…") : tr("Ask a new question…", "שאל שאלה חדשה…");
}

function renderComposer(state, l, { answerView, hasMessages }) {
    // A signed-out visitor follows up on the answers on screen too, up to the
    // guest limits (backend/guest_cap.py); a shared answer or one that was
    // never saved starts a new question.
    const continues = !answerView
        || (ui.signedIn && Boolean(state.answerView?.historyId))
        || (!ui.signedIn && store.canContinueAsGuest());
    els.input.placeholder = composerPlaceholder(hasMessages, continues);
    // As the guest allowance runs low it says so, above the box.
    const guestNote = !ui.signedIn && !state.conversation ? guestBannerText(state.guestUsage, l) : null;
    els.guestBanner?.classList.toggle("hidden", !guestNote);
    if (guestNote && els.guestBannerText) els.guestBannerText.textContent = guestNote;
    syncSendDisabled();
}

function render() {
    if (!els || !store) return;
    const state = store.getState();
    const l = lang();
    const options = communityOptions();
    const conversation = state.conversation;
    const minhag = state.minhagLocked ? conversation?.minhag : state.draftMinhag;
    const name = communityName(minhag, l, options);
    const hasMessages = state.messages.length > 0;
    if (hasMessages) ui.publicState = null;
    const answerView = Boolean(state.answerView) && !conversation;
    els.panel.dataset.hasThread = conversation ? "true" : "false";
    els.panel.dataset.answerView = answerView || ui.publicState ? "true" : "false";
    // A question asked from the search bar loads there (halo and status line)
    // and nowhere else; the panel's composer halo is for questions asked in it.
    const barLoading = state.sending && state.surface === "bar";
    const panelLoading = state.sending && !barLoading;
    els.panel.dataset.sending = panelLoading ? "true" : "false";
    els.pip.dataset.sending = panelLoading ? "true" : "false";
    renderBarStatus(barLoading, state, l);

    const title = panelTitle(state, answerView, hasMessages);
    renderHeader(state, { l, name, title, options });
    renderMenu(state, { l, name, options });
    const progress = renderBody(state, l, hasMessages);
    renderNotice(currentNotice(state, l));
    renderToast();
    syncThemeBtn();
    renderComposer(state, l, { answerView, hasMessages });

    // Minimised bar.
    els.pipTitle.textContent = title;
    els.pipStatus.textContent = progress ? statusLine(progress, l) : "";
    els.pipOpen.setAttribute("aria-label", tr(`Open conversation: ${title}`, `פתח שיחה: ${title}`));

    syncAskExpanded();

    renderLists(state, l);
    syncRoute(state);
    syncAiRoute(minhag);
}

function syncMinhagSelect(options, value, l) {
    const select = els.minhagSelect;
    const key = `${l}:${options.length}`;
    if (select.dataset.key !== key) {
        select.innerHTML = options
            .map((o) => `<option value="${escapeText(o.value)}">${escapeText(l === "he" ? o.he : o.en)}</option>`)
            .join("");
        select.dataset.key = key;
    }
    select.value = options.some((o) => o.value === value) ? value : "All";
}

function syncSendDisabled() {
    const state = store.getState();
    els.send.disabled = !els.input.value.trim() || state.sending || state.loadStatus === "loading";
}

function noticeActionLabel(action) {
    const labels = {
        "sign-in": tr("Sign in", "התחברות"),
        "retry-open": tr("Try again", "נסה שוב"),
        new: tr("Start a new one", "התחל שיחה חדשה"),
        undo: tr("Undo", "בטל"),
        "stop-share": tr("Stop sharing", "הפסקת שיתוף"),
    };
    return labels[action] || "";
}

function renderNotice(notice) {
    els.notice.classList.toggle("hidden", !notice);
    if (!notice) return;
    els.notice.dataset.tone = notice.tone || "warn";
    els.noticeText.textContent = notice.text;
    const label = noticeActionLabel(notice.action);
    els.noticeAction.classList.toggle("hidden", !label);
    els.noticeAction.dataset.action = notice.action || "";
    if (label) els.noticeAction.textContent = label;
}

// The toast floats over the page, so it comes and goes without moving
// anything. It enters and leaves with the menus' own motion.
function renderToast() {
    const toast = ui.toast;
    const showing = !els.toast.classList.contains("hidden") && !els.toast.classList.contains("is-hiding");
    if (!toast) {
        if (showing) void hide(els.toast, "popover");
        return;
    }
    els.toast.dataset.tone = toast.tone || "success";
    els.toastText.textContent = toast.text;
    const label = noticeActionLabel(toast.action);
    els.toastAction.classList.toggle("hidden", !label);
    els.toastAction.dataset.action = toast.action || "";
    if (label) els.toastAction.textContent = label;
    if (!showing) void show(els.toast, "popover");
}

// The theme button names where it goes (the icon swap is CSS, off the page's
// data-theme); its label has to follow the theme and the language.
function syncThemeBtn() {
    if (!els.themeBtn) return;
    const dark = document.documentElement.dataset.theme === "dark";
    const label = dark ? tr("Switch to light theme", "עבור למצב בהיר") : tr("Switch to dark theme", "עבור למצב כהה");
    els.themeBtn.setAttribute("aria-label", label);
    els.themeBtn.title = label;
}

// One /api/text payload per cited ref, shared by the preview drawer (its
// lines), the source cards' chips (their excerpt) and the Hebrew interface
// (its heRef). Resolves to `{ notFound: true }` when the library has no such
// passage (so the source is shown as text rather than as a link that opens
// nothing), and to null when the answer could not be had at all -- that one
// is not cached, so asking again retries.
function fetchSourceText(ref) {
    if (!ui.previews.has(ref)) {
        const request = fetch(`/api/text/${encodeURIComponent(ref)}?autotranslate=0`)
            .then((resp) => (resp.ok ? resp.json() : null))
            .then((payload) => {
                if (payload && !payload.error) return payload;
                return payload?.error_type === "not_found" ? { notFound: true } : null;
            })
            .catch(() => null);
        // A failed fetch is not cached, so reopening the preview retries it.
        void request.then((payload) => { if (!payload) ui.previews.delete(ref); });
        ui.previews.set(ref, request);
    }
    return ui.previews.get(ref);
}

// What each source in the list can do, once its passage is looked up: a ref
// the library has opens in the reader (and in the Hebrew interface reads in
// Hebrew -- the English ref renders first, since it is what the reader link
// and the preview are keyed on and the fallback when Sefaria has no Hebrew
// spelling); a ref it doesn't have (a responsum, a spelling Sefaria does not
// know) is written out as plain text instead of a link that leads nowhere.
function hydrateCitations(root) {
    for (const item of root.querySelectorAll(".conv-cite[data-ref]")) {
        const ref = item.dataset.ref;
        if (!ref) continue;
        void fetchSourceText(ref).then((payload) => {
            if (!payload || !item.isConnected) return;
            if (payload.notFound) {
                markUnreadable(item);
                return;
            }
            item.dataset.readable = "true";
            if (lang() !== "he") return;
            const name = hebrewRefName(payload);
            const link = item.querySelector(".conv-cite__ref[data-cite-ref]");
            if (!name || !link) return;
            link.textContent = name;
            link.lang = "he";
        });
    }
}

function markUnreadable(item) {
    item.dataset.readable = "false";
    const link = item.querySelector(".conv-cite__ref[data-cite-ref]");
    if (link) {
        const plain = document.createElement("span");
        plain.className = "conv-cite__ref conv-cite__ref--plain";
        plain.setAttribute("dir", "auto");
        plain.textContent = link.textContent;
        link.replaceWith(plain);
        const why = document.createElement("span");
        why.className = "conv-cite__why";
        why.textContent = tr("Can't be opened here", "לא ניתן לפתוח כאן");
        plain.after(why);
    }
    item.querySelector(".conv-cite__preview")?.remove();
}

async function loadPreview(details) {
    const body = details.querySelector(".conv-cite__preview-body");
    if (!body || !details.open || body.dataset.state === "done" || body.dataset.state === "loading") return;
    body.dataset.state = "loading";
    body.setAttribute("aria-busy", "true");
    body.innerHTML = '<div class="ai-src-box-body ai-cited-fetch-skeleton" aria-hidden="true"><div class="ai-src-skeleton-line ai-src-skeleton-line--wide"></div><div class="ai-src-skeleton-line ai-src-skeleton-line--medium"></div></div>';
    const payload = await fetchSourceText(details.dataset.previewRef);
    const html = payload ? previewHtml(payload.lines, { lang: lang() }) : "";
    if (!body.isConnected) return;
    body.innerHTML = html || `<div class="ai-src-box-note">${escapeText(tr(
        "Preview unavailable for this source — use the links above to open it.",
        "תצוגה מקדימה אינה זמינה למקור זה — השתמש בקישורים למעלה כדי לפתוח אותו.",
    ))}</div>`;
    body.dataset.state = html ? "done" : "";
    body.setAttribute("aria-busy", "false");
    const M = motion();
    if (M?.springAnimate && !reducedMotion()) {
        M.springAnimate(body, { opacity: [0, 1], transform: ["translateY(6px)", "translateY(0px)"] }, M.APPLE_SPRING?.smooth);
    }
}

// One cited source, inline under the answer that cites it: type, reference
// (opens the reader), the model's one-line note, where else to read it, and
// the text itself on demand (loaded when the disclosure opens -- loadPreview).
function webCiteHtml(citation, index, l, idPrefix) {
    const excerpt = citationExcerpt(citation, l);
    const note = excerpt ? `<p class="conv-cite__excerpt" dir="auto">${escapeText(excerpt)}</p>` : "";
    const notice = tr(
        "From the web, not from a Jewish text. Check it with the certifying agency or your rabbi.",
        "מהרשת, לא מטקסט יהודי. כדאי לוודא מול הגוף המכשיר או הרב שלך.",
    );
    return `<li class="conv-cite conv-cite--web" id="${escapeText(idPrefix)}-${index + 1}" data-ref="" data-readable="false" tabindex="-1">`
        + `<span class="conv-cite__num" aria-hidden="true">${index + 1}</span><span class="conv-cite__head">${webSourceHeadHtml(citation, l)}</span>${note}`
        + `<p class="conv-cite__web-notice">${escapeText(notice)}</p></li>`;
}

function citeHtml(citation, index, l, idPrefix) {
    if (isWebRef(citation.ref)) return webCiteHtml(citation, index, l, idPrefix);
    const ref = readerRef(citation.ref);
    const excerpt = citationExcerpt(citation, l);
    const head = ref
        ? `${sourceBadgeHtml(ref, l)}<a href="${escapeText(routeUrl({ text: ref }))}" class="conv-cite__ref" data-cite-ref="${escapeText(ref)}" dir="auto">${escapeText(ref)}</a>`
        : "";
    const note = excerpt ? `<p class="conv-cite__excerpt" dir="auto">${escapeText(excerpt)}</p>` : "";
    const links = ref ? `<span class="conv-cite__links">${externalLinksHtml(ref, l)}</span>` : "";
    const preview = ref
        ? `<details class="conv-cite__preview" data-preview-ref="${escapeText(ref)}">`
            + `<summary>${icon("caret-down", "conv-cite__caret")}<span>${escapeText(tr("Preview the text", "הצג את הטקסט"))}</span></summary>`
            + '<div class="conv-cite__preview-body"></div></details>'
        : "";
    return `<li class="conv-cite" id="${escapeText(idPrefix)}-${index + 1}" data-ref="${escapeText(ref)}" data-readable="unknown" tabindex="-1">`
        + `<span class="conv-cite__num" aria-hidden="true">${index + 1}</span><span class="conv-cite__head">${head}</span>${note}${links}${preview}</li>`;
}

// The sources written out under an answer: a heading and the numbered list
// the chips in the answer lead to (each row's id is `${idPrefix}-<n>`).
function citesHtml(citations, idPrefix, l) {
    if (!citations.length) return "";
    return `<h3 class="conv-cites__title" id="${escapeText(idPrefix)}-title">${escapeText(tr("Sources", "מקורות"))}</h3>`
        + `<ol class="conv-cites" aria-labelledby="${escapeText(idPrefix)}-title">${citations.map((c, i) => citeHtml(c, i, l, idPrefix)).join("")}</ol>`;
}

// The answer's text with its claims tied to the sources list: the server's
// own trailing "Sources" list is dropped (the list under the answer says it
// once), each marker sits right after the excerpt that rests on its source
// (once for a run of sentences on one source), and each [n] marker the model
// wrote becomes a chip.
function answerBodyHtml(message, idPrefix) {
    const citations = message.citations || [];
    const content = citations.length
        ? placeMarkers(stripSourcesBlock(message.content))
        : message.content;
    return injectMarkers(answerHtml(content), {
        citations,
        idPrefix,
        label: (n, c) => tr(`Source ${n}: ${c.ref}`, `מקור ${n}: ${c.ref}`),
    });
}

function answerBox(message, body) {
    const script = mostlyHebrew(message.content) ? ' data-script="he"' : "";
    return `<div class="conv-answer" dir="auto"${script}>${body}</div>`;
}

function answerHtml(content) {
    if (typeof window.renderAnswerMarkdown === "function") {
        try {
            return window.renderAnswerMarkdown(content);
        } catch { /* fall back to plain text */ }
    }
    return escapeText(content).replaceAll("\n", "<br>");
}

function statusRow({ tone = "", text, action = null, actionLabel = "", messageId = "" }) {
    const button = action
        ? `<button type="button" class="conv-turn__retry" data-turn-action="${action}" data-message-id="${escapeText(messageId)}">${escapeText(actionLabel)}</button>`
        : "";
    const toneClass = tone ? ` conv-turn__status--${tone}` : "";
    return `<p class="conv-turn__status${toneClass}">${tone === "error" ? icon("warning") : ""}<span>${escapeText(text)}</span>${button}</p>`;
}

// What Sh'elah is doing while a turn is pending: one line naming the step
// that is running (it blinks slowly, conversation.css .conv-status__now) and,
// under it, the steps already finished. The two rows are always laid out so
// steps arriving never move the skeleton below. renderStatus() fills them in
// place, so a state change never rebuilds the turn (and restarts the blink).
function statusHtml() {
    return '<div class="conv-status" data-conv-status role="status">'
        + '<span class="conv-status__now" data-status-now dir="auto"></span>'
        + '<span class="conv-status__done" data-status-done dir="auto" data-empty="true"></span>'
        + '</div>';
}

// The line naming what is happening now. References stay in the form the
// server sent them; communities are named the way the rest of the page does.
function statusLine(view, l) {
    const names = { community: (community) => communityDisplayName(community, l) };
    return `${activeLabel(view.active, l, view.detail, names)}…`;
}

function applyStatus(host, view, l) {
    clearTimeout(host._statusTimer);
    const wanted = viewKey(view);
    const shown = host.dataset.stage;
    const heldFor = performance.now() - (host._stageShownAt || 0);
    if (shown !== undefined && shown !== wanted && heldFor < STATUS_MIN_DWELL_MS) {
        host._statusTimer = setTimeout(() => {
            if (host.isConnected) applyStatus(host, progressView(store?.getState().progress || createProgress()), lang());
        }, STATUS_MIN_DWELL_MS - heldFor);
    } else if (shown !== wanted || host.dataset.lang !== l) {
        const nowEl = host.querySelector("[data-status-now]");
        nowEl.textContent = statusLine(view, l);
        // The line changing under the reader's eyes settles in; the first line
        // (nothing shown yet) is part of the turn's own entrance.
        if (shown !== undefined) motion()?.settleIn?.(nowEl);
        host.dataset.stage = wanted;
        host.dataset.lang = l;
        host._stageShownAt = performance.now();
    }
    const doneEl = host.querySelector("[data-status-done]");
    const doneText = view.done.map((id) => doneLabel(id, l)).join(" · ");
    const doneKey = `${l}:${doneText}`;
    if (doneEl.dataset.key !== doneKey) {
        doneEl.dataset.key = doneKey;
        doneEl.dataset.empty = doneText ? "false" : "true";
        doneEl.innerHTML = doneText ? `${phosphorIcon("check", { size: 14, weight: "bold" })}<span>${escapeText(doneText)}</span>` : "";
    }
}

function renderStatus(state, l) {
    const view = progressView(state.progress || createProgress());
    const host = els.messages.querySelector("[data-conv-status]");
    if (host) applyStatus(host, view, l);
    return view;
}

// The same two rows under the search bar for a question asked from it (the
// panel stays shut until the answer lands). The rows are built when a question
// starts and left in place while the line fades out, so it never empties first.
function renderBarStatus(active, state, l) {
    const host = els.barStatus;
    document.body.classList.toggle("search-loading", active);
    if (!host) return;
    const shown = host.dataset.active === "true";
    if (!active) {
        if (shown) host.dataset.active = "false";
        return;
    }
    if (!shown) {
        clearTimeout(host._statusTimer);
        host.innerHTML = '<span class="conv-status__now" data-status-now dir="auto"></span>'
            + '<span class="conv-status__done" data-status-done dir="auto" data-empty="true"></span>';
        delete host.dataset.stage;
        delete host.dataset.lang;
        host._stageShownAt = 0;
        host.dataset.active = "true";
    }
    applyStatus(host, progressView(state.progress || createProgress()), l);
}

function turnInnerHtml(message, index, messages, l) {
    if (message.role === "user") {
        let html = `<div class="conv-bubble" dir="auto">${escapeText(message.content)}</div>`;
        if (message.status === MESSAGE_STATUS.FAILED) {
            html += statusRow({ tone: "error", text: tr("Not sent.", "לא נשלח."), action: "retry", actionLabel: tr("Retry", "נסה שוב"), messageId: message.id });
        }
        return html;
    }
    switch (message.status) {
        case MESSAGE_STATUS.PENDING:
            return statusHtml()
                + '<div class="conv-turn__skel"></div><div class="conv-turn__skel"></div><div class="conv-turn__skel"></div>';
        case MESSAGE_STATUS.ERROR: {
            const isLast = index === messages.length - 1;
            return statusRow({
                tone: "error",
                text: tr("Sh'elah couldn't answer this one.", "ש׳אלה לא הצליחה לענות על זה."),
                action: isLast ? "retry" : null,
                actionLabel: tr("Retry", "נסה שוב"),
                messageId: message.id,
            });
        }
        case MESSAGE_STATUS.INCOMPLETE:
            return statusRow({
                text: tr("The answer is taking longer than usual.", "התשובה מתעכבת מהרגיל."),
                action: "check",
                actionLabel: tr("Check again", "בדוק שוב"),
                messageId: message.id,
            });
        default: {
            const idPrefix = citeIdPrefix(message.id);
            const cites = citesHtml(message.citations, idPrefix, l);
            const body = answerBodyHtml(message, idPrefix);
            // A search-bar answer (message.answer = its /ask payload) also
            // carries its safety banner, community customs, feedback and
            // Copy link; decorateAnswerTurn fills the hosts.
            const data = message.answer;
            if (!data) return `${answerBox(message, body)}${cites}${threadReplyActionsHtml(message)}`;
            // Paused answers: the banner says it, in the reader's language;
            // the server's English sentence under it would only repeat it.
            const paused = data.meta?.breaker_tripped && typeof window.renderDisclaimerBanner === "function";
            const answer = paused ? "" : answerBox(message, body);
            return '<div class="conv-turn__banner" data-answer-banner></div>'
                + answer
                + customsHtml(data, l)
                + cites
                + '<div class="conv-turn__actions" data-answer-actions><div class="conv-turn__feedback"></div></div>';
        }
    }
}

// A reply in the viewer's own thread (a follow-up, or a thread reopened from
// history) arrives as a stored message, not an /ask payload, so it has no
// banner, customs or Copy link -- but it can still be rated. A shared thread
// is read-only (no conversation row), and an empty reply has nothing to rate.
function threadReplyActionsHtml(message) {
    if (!store?.getState().conversation || !message.content.trim()) return "";
    return '<div class="conv-turn__actions" data-answer-actions><div class="conv-turn__feedback"></div></div>';
}

// A community the way the rest of the page names it.
function communityDisplayName(community, l) {
    try {
        if (typeof window.getCommunityDisplayName === "function") return window.getCommunityDisplayName(community);
    } catch { /* fall through */ }
    return communityName(community, l, communityOptions());
}

// The answer's per-community customs, as a compact list under it.
function customsHtml(data, l) {
    const customs = (Array.isArray(data?.customs) ? data.customs : [])
        .map((c) => ({ community: c?.community, text: String(c?.ruling || c?.notes || "").trim() }))
        .filter((c) => c.text);
    if (!customs.length) return "";
    const name = (community) => communityDisplayName(community, l);
    return `<section class="conv-customs" aria-label="${escapeText(tr("Community customs", "מנהגי קהילות"))}">`
        + `<h3 class="conv-customs__title">${escapeText(tr("Community customs", "מנהגי קהילות"))}</h3><ul>`
        + customs.map((c) => `<li class="conv-custom"><span class="conv-custom__name">${escapeText(name(c.community))}</span>`
            + `<p class="conv-custom__text" dir="auto">${escapeText(c.text)}</p></li>`).join("")
        + "</ul></section>";
}

// Fills an answer turn's hosts. The safety banner shows only when it says
// something the panel's standing disclaimer doesn't (a referral, or the
// cost breaker); the one Copy link control moves into the turn showing it.
function decorateAnswerTurn(li, message, question) {
    const data = message.answer;
    const banner = li.querySelector("[data-answer-banner]");
    if (banner && typeof window.renderDisclaimerBanner === "function") {
        banner.className = "ai-disclaimer-banner conv-turn__banner";
        window.renderDisclaimerBanner(banner, data.meta?.safety_class, data.meta?.breaker_tripped);
        if (!banner.matches(".ai-disclaimer-banner--referral, .ai-disclaimer-banner--breaker-paused")) banner.remove();
    } else {
        banner?.remove();
    }
    const actions = li.querySelector("[data-answer-actions]");
    if (!actions) return;
    window.renderFeedbackWidget?.(actions.querySelector(".conv-turn__feedback"), data, question || data.question || "");
    if (els.answerLink) {
        actions.appendChild(els.answerLink);
        window.ShelahAnswerLink?.panel?.show(data);
    }
}

// The rating row of a thread reply. There is no payload to read the mode or the
// safety class from (and no ask_history row to link), so the rating carries the
// question and the language the reader is using.
function decorateThreadReply(li, question, l) {
    const host = li.querySelector("[data-answer-actions] .conv-turn__feedback");
    if (host) window.renderFeedbackWidget?.(host, { meta: { language: l } }, question || "");
}

// Back to its hidden home before the turn holding it is re-rendered or removed.
function parkAnswerLink() {
    if (els.answerLink && els.answerLinkPark && els.answerLink.parentElement !== els.answerLinkPark) {
        els.answerLinkPark.appendChild(els.answerLink);
    }
}

// A saved turn replacing its optimistic placeholder (local id -> server id)
// takes over the placeholder's row, so it doesn't animate in twice.
function takePlaceholderEntry(key, previous, nextKeys) {
    const inPlace = previous ? previous.nextSibling : els.messages.firstChild;
    const placeholderKey = inPlace?.dataset?.turnKey;
    if (!placeholderKey || nextKeys.has(placeholderKey) || !ui.turns.has(placeholderKey)) return null;
    const entry = ui.turns.get(placeholderKey);
    ui.turns.delete(placeholderKey);
    ui.turns.set(key, entry);
    entry.li.dataset.turnKey = key;
    return entry;
}

function createTurnEntry(key) {
    const li = document.createElement("li");
    li.dataset.turnKey = key;
    const entry = { li, sig: null };
    ui.turns.set(key, entry);
    if (ui.animateInserts) {
        li.classList.add("conv-turn--enter");
        li.addEventListener("animationend", () => li.classList.remove("conv-turn--enter"), { once: true });
    }
    return entry;
}

// An answer arriving in place of its skeleton reveals block by block
// (conversation.css .conv-turn--reveal); a timer, not animationend, since
// the staggered children each fire one.
function revealArrivedAnswer(entry, message) {
    if (entry.status !== MESSAGE_STATUS.PENDING || message.status !== MESSAGE_STATUS.COMPLETE
        || message.role !== "assistant") return;
    entry.li.classList.add("conv-turn--reveal");
    clearTimeout(entry.revealTimer);
    entry.revealTimer = setTimeout(() => entry.li.classList.remove("conv-turn--reveal"), 900);
}

// The pending turn an answer replaces (status line and skeleton) fades out as a
// copy laid over the top of the turn while the answer fades in, so the thread
// never goes blank between the two. Null for any other redraw.
function skeletonGhost(entry, message, li) {
    if (entry.status !== MESSAGE_STATUS.PENDING || message.status !== MESSAGE_STATUS.COMPLETE
        || message.role !== "assistant" || !li.querySelector(".conv-turn__skel")) return null;
    const ghost = document.createElement("div");
    ghost.className = "conv-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.innerHTML = li.innerHTML;
    // A copy must not answer the status updates meant for the live line.
    ghost.querySelectorAll("[data-conv-status]").forEach((node) => {
        delete node.dataset.convStatus;
        node.removeAttribute("role");
    });
    return ghost;
}

function mountSkeletonGhost(li, ghost) {
    li.classList.add("conv-turn--ghosting");
    li.append(ghost);
    const done = () => {
        ghost.remove();
        li.classList.remove("conv-turn--ghosting");
    };
    ghost.addEventListener("animationend", done, { once: true });
    setTimeout(done, 400); // a backgrounded tab never fires animationend
}

function redrawTurn(entry, message, index, messages, l) {
    const li = entry.li;
    const ghost = skeletonGhost(entry, message, li);
    li.className = `conv-turn conv-turn--${message.role}${message.status === MESSAGE_STATUS.FAILED ? " conv-turn--failed" : ""}${li.classList.contains("conv-turn--enter") ? " conv-turn--enter" : ""}`;
    li.setAttribute("aria-busy", message.status === MESSAGE_STATUS.PENDING ? "true" : "false");
    if (els.answerLink && li.contains(els.answerLink)) parkAnswerLink();
    li.innerHTML = turnInnerHtml(message, index, messages, l);
    if (message.status === MESSAGE_STATUS.COMPLETE) {
        const question = messages[index - 1]?.content;
        if (message.answer) decorateAnswerTurn(li, message, question);
        else decorateThreadReply(li, question, l);
    }
    if (message.citations?.length) hydrateCitations(li);
    if (citePop?.anchor() && !citePop.anchor().isConnected) citePop.close();
    revealArrivedAnswer(entry, message);
    if (ghost) mountSkeletonGhost(li, ghost);
    entry.status = message.status;
}

// Drops the turns that are no longer in the thread; true when any went.
function removeGoneTurns(seen) {
    let removed = false;
    for (const [key, entry] of ui.turns) {
        if (seen.has(key)) continue;
        removed = true;
        if (els.answerLink && entry.li.contains(els.answerLink)) parkAnswerLink();
        entry.li.remove();
        ui.turns.delete(key);
    }
    return removed;
}

function renderTurns(state, l) {
    const threadKey = `${state.conversation?.id || "draft"}:${l}`;
    const scroller = els.scroller;
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM_PX;
    if (threadKey !== ui.threadKey) {
        // New thread (or language): rebuild, and scroll to the latest turn.
        // A thread that got its id from the first question keeps its turns.
        const draftToSaved = ui.turns.size > 0 && ui.threadKey?.startsWith("draft:") && ui.threadKey.endsWith(`:${l}`);
        if (!draftToSaved) {
            parkAnswerLink();
            ui.turns.clear();
            els.messages.innerHTML = "";
            ui.animateInserts = false;
            ui.forceScroll = true;
        }
        ui.threadKey = threadKey;
    }

    const seen = new Set();
    const nextKeys = new Set(state.messages.map((message) => String(message.id)));
    // Whether this pass added, changed or removed a turn. Only that may move
    // the scroll: a render for any other reason (a menu opening, a link
    // copied, the list refreshing) must leave the reader where they are.
    let turnsChanged = false;
    let previous = null;
    state.messages.forEach((message, index) => {
        const key = String(message.id);
        seen.add(key);
        // Last-ness only changes an error turn (its Retry); keeping it out
        // of other turns' signatures keeps a rated answer rated.
        const sig = `${turnSignature(message)}:${message.answer ? "a" : ""}:${message.status === MESSAGE_STATUS.ERROR && index === state.messages.length - 1}`;
        let entry = ui.turns.get(key) || takePlaceholderEntry(key, previous, nextKeys);
        if (!entry) {
            turnsChanged = true;
            entry = createTurnEntry(key);
        }
        if (entry.sig !== sig) {
            turnsChanged = true;
            redrawTurn(entry, message, index, state.messages, l);
            entry.sig = sig;
        }
        const expectedPosition = previous ? previous.nextSibling : els.messages.firstChild;
        if (entry.li !== expectedPosition) els.messages.insertBefore(entry.li, expectedPosition);
        previous = entry.li;
    });
    if (removeGoneTurns(seen)) turnsChanged = true;
    if (els.answerLink?.parentElement === els.answerLinkPark) window.ShelahAnswerLink?.panel?.hide();
    // Only turns that arrive after a thread is on screen animate in; a
    // thread being (re)loaded renders all at once.
    ui.animateInserts = state.loadStatus !== "loading";

    // Following the newest turn is for a reader who is already at the bottom:
    // jumping them back up to the latest question on every unrelated render
    // is what sent the page up when Settings or Share was pressed.
    if (ui.forceScroll || (nearBottom && turnsChanged)) {
        ui.forceScroll = false;
        requestAnimationFrame(() => scrollToLatest(false));
    }
    updateJumpButton();
}

// Where "latest" is: the newest question at the top, so a long answer is
// read from its start rather than landed on at its last line.
function latestTop() {
    const scroller = els.scroller;
    const bottom = scroller.scrollHeight - scroller.clientHeight;
    const questions = els.messages.querySelectorAll(".conv-turn--user");
    const last = questions[questions.length - 1];
    // Nothing asked yet: the empty state (heading, hint, suggestions) is read
    // from its top, not landed on at its last line on a short screen.
    if (!els.messages.children.length) return 0;
    if (!last) return bottom;
    const offset = last.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
    return Math.max(0, Math.min(bottom, offset));
}

function scrollToLatest(smooth = true) {
    els.scroller.scrollTo({ top: latestTop(), behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
}

function updateJumpButton() {
    const scroller = els.scroller;
    const away = latestTop() - scroller.scrollTop > NEAR_BOTTOM_PX * 2;
    els.jump.classList.toggle("hidden", !(away && store.getState().messages.length > 0));
}

function renderLists(state, l) {
    const list = state.list;
    const listRef = `${l}:${list.status}:${state.conversation?.id || ""}:${ui.signedIn}:${ui.authResolved}`;
    if (ui.lastListRef === listRef && ui.lastListItems === list.items) return;
    ui.lastListRef = listRef;
    ui.lastListItems = list.items;

    let html;
    if (!ui.signedIn) {
        // Signed out there is no list to show; say why, so the heading above is
        // not followed by blank space.
        html = clerkConfigured() && ui.authResolved
            ? `<li class="conv-list__empty">${escapeText(tr("Sign in to keep a list of your conversations.", "התחברו כדי לשמור רשימת שיחות."))}</li>`
            : "";
    } else if (list.status !== "ready" && list.status !== "error" && list.items.length === 0) {
        // Not loaded yet (idle or loading): skeletons, never a premature
        // "No conversations yet".
        html = '<li aria-hidden="true"><div class="conv-list__skel"></div></li>'.repeat(3);
    } else if (list.status === "error" && list.items.length === 0) {
        html = `<li class="conv-list__error">${escapeText(tr("Couldn't load conversations.", "לא ניתן לטעון שיחות."))} <button type="button" class="conv-link-btn" data-conv-action="reload-list">${escapeText(tr("Try again", "נסה שוב"))}</button></li>`;
    } else if (list.items.length === 0) {
        // Only a successful load that came back empty.
        html = `<li class="conv-list__empty">${escapeText(tr("No conversations yet.", "אין עדיין שיחות."))}</li>`;
    } else {
        const options = communityOptions();
        const currentId = state.conversation?.id;
        const now = Date.now();
        let group = null;
        html = list.items.map((item) => {
            const meta = [communityName(item.minhag, l, options), relativeTime(item.updatedAt || item.createdAt, { lang: l })]
                .filter(Boolean).join(" · ");
            // A heading each time the day-bucket changes (the list arrives
            // newest first, pinned ones ahead).
            const bucket = conversationGroup(item, { now });
            const heading = bucket === group ? ""
                : `<li class="conv-list__group" aria-hidden="true">${escapeText(conversationGroupLabel(bucket, l))}</li>`;
            group = bucket;
            const pinned = item.pinnedAt
                ? `${icon("pin", "conv-list__pin")}<span class="sr-only">${escapeText(tr("Pinned", "מוצמד"))}</span>`
                : "";
            return `${heading}<li><button type="button" class="conv-list__item" data-conv-open="${escapeText(item.id)}" aria-current="${item.id === currentId ? "true" : "false"}">`
                + `<span class="conv-list__text"><span class="conv-list__title" dir="auto">${escapeText(item.title || tr("Untitled conversation", "שיחה ללא שם"))}</span>`
                + `<span class="conv-list__meta">${escapeText(meta)}</span></span>`
                + `${pinned}</button></li>`;
        }).join("");
    }
    els.lists.forEach((ul) => { ul.innerHTML = html; });
    els.popSignedOut?.classList.toggle("hidden", ui.signedIn || !clerkConfigured());
    const popList = els.pop.querySelector(".conv-list");
    popList?.classList.toggle("hidden", !ui.signedIn);
}

// Keep the route's conversation (`/chat/<id>`) in step with the store: `new` becomes the real id once
// the first question creates the row, and a deleted open thread falls back
// to `new`. Only while signed in -- a deep link waiting for sign-in must
// keep its id. A search-bar answer is routed by the classic script
// (/answer/<id>); following it up swaps that URL for the new thread's in an
// entry of its own, so Back returns to the answer.
function syncRoute(state) {
    if (!ui.open || !ui.signedIn || ui.awaitingOpenId) return;
    if ((state.answerView && !state.conversation) || ui.publicState) return;
    let desired = null;
    if (state.conversation) desired = state.conversation.id;
    else if (state.loadStatus === "ready") desired = "new";
    if (!desired) return;
    const route = readRoute();
    if (route.conversation === desired) return;
    const fromAnswer = Boolean(route.chat || route.a);
    pushRoute({ conversation: desired, cv: ui.size, chat: null, a: null }, fromAnswer ? { overlay: "conversation" } : { replace: true });
}

// The URL names the community and AI mode the open panel answers with
// (router.js AI keys: `/chat/<id>/sefardic/strict`), kept in step as the
// user changes them. Only alongside a conversation or answer in the route.
function syncAiRoute(minhag) {
    if (!ui.open || ui.publicState || ui.awaitingOpenId) return;
    const route = readRoute();
    if (!route.conversation && !route.chat && !route.a) return;
    const patch = aiRoute(minhag);
    if (route.minhag === patch.minhag && route.mode === patch.mode) return;
    pushRoute(patch, { replace: true });
}

function aiRoute(minhag) {
    if (minhag === undefined) {
        const state = store.getState();
        minhag = state.minhagLocked ? state.conversation?.minhag : state.draftMinhag;
    }
    return { minhag: minhag || "All", mode: currentMode() };
}

// A link's community and mode (`/chat/<id>/sefardic/strict`): the panel answers that way. The router has
// already dropped malformed values; a community this page doesn't offer is
// ignored too.
function applyAiRoute(route) {
    if (route.mode) ui.mode = route.mode;
    const known = Boolean(route.minhag) && communityOptions().some((o) => o.value === route.minhag);
    ui.routeMinhag = known ? route.minhag : null;
    if (known) store.setDraftMinhag(route.minhag);
}

// ── open / close / size ────────────────────────────────────────────────

function lockBody() {
    const modal = ui.open && isModalSize(ui.size) && !(ui.layout === "mobile" && ui.size === "mini");
    document.body.classList.toggle("conv-modal-open", modal);
}

// Desktop mini/overlay: motion.js's "window" cross-fade, the same as every
// other dialog window. It appears where it lives rather than growing out of
// the Ask mark, which read as the button flying across the screen.
function panelPreset() {
    if (ui.layout === "mobile") return ui.size === "full" ? "fade" : "drawer";
    return ui.size === "full" ? "fade" : "window";
}

function applyAttributes() {
    els.panel.dataset.size = ui.size;
    els.panel.dataset.layout = ui.layout;
    const rtl = document.documentElement.dir === "rtl";
    els.panel.dataset.corner = logicalCorner(readCorner(), rtl);
    const modal = isModalSize(ui.size);
    els.panel.setAttribute("aria-modal", modal ? "true" : "false");
    els.panel.setAttribute("role", modal ? "dialog" : "region");
    if (els.expandBtn) {
        const toFull = expandedSize(ui.size) === "full";
        const label = toFull ? tr("Open full page", "פתח בעמוד מלא") : tr("Expand", "הרחב");
        els.expandBtn.setAttribute("aria-label", label);
        els.expandBtn.title = label;
    }
    mini?.sync();
}

function show(el, preset, origin = null) {
    const M = motion();
    if (M?.present) return M.present(el, { preset, origin });
    el.classList.remove("hidden");
    return Promise.resolve();
}

function hide(el, preset) {
    const M = motion();
    if (M?.dismiss) return M.dismiss(el, { preset });
    el.classList.add("hidden");
    return Promise.resolve();
}

// FLIP between two sizes: measure, switch, and spring from the old box
// (audit M-5). The panel scales, and its content takes the inverse scale so
// no glyph is ever squashed (Framer Motion's layout "scale correction");
// one spring drives both, so the two stay exact inverses every frame. A
// resize during a resize stops the running one first: the panel is then
// measured where it visibly is, and the next spring starts from there.
let flipControls = null;

function flipContent(el) {
    return [...el.children].filter((child) => !child.hidden);
}

function clearFlip(el) {
    for (const node of [el, ...flipContent(el)]) {
        node.style.removeProperty("transform");
        node.style.removeProperty("transform-origin");
    }
}

// Detached before stop(), so a stop that completes can't clear the transform.
function haltFlip() {
    const running = flipControls;
    flipControls = null;
    running?.stop?.();
}

function stopFlip(el) {
    haltFlip();
    clearFlip(el);
}

function flipResize(mutate) {
    const el = els.panel;
    haltFlip();
    const first = el.getBoundingClientRect();
    clearFlip(el);
    mutate();
    const last = el.getBoundingClientRect();
    const M = motion();
    if (!M?.springValue || reducedMotion() || !first.width || !last.width || el.classList.contains("hidden")) return;
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const sx0 = first.width / last.width;
    const sy0 = first.height / last.height;
    const content = flipContent(el);
    for (const node of [el, ...content]) node.style.transformOrigin = "top left";
    const frame = (t) => {
        const sx = sx0 + (1 - sx0) * t;
        const sy = sy0 + (1 - sy0) * t;
        el.style.transform = `translate(${dx * (1 - t)}px, ${dy * (1 - t)}px) scale(${sx}, ${sy})`;
        const inverse = `scale(${1 / sx}, ${1 / sy})`;
        for (const node of content) node.style.transform = inverse;
    };
    frame(0);
    let controls = null;
    controls = M.springValue(0, 1, M.APPLE_SPRING?.snappy || { stiffness: 158, damping: 21, mass: 1 }, {
        onUpdate: frame,
        onComplete: () => {
            if (!controls || flipControls !== controls) return;
            flipControls = null;
            clearFlip(el);
        },
    });
    // null: nothing animated (its onComplete ran before `controls` was set).
    if (controls) flipControls = controls;
    else clearFlip(el);
}

function applyPanelVisibility(wantPanel, { previousSize, origin, opening }) {
    if (!wantPanel) {
        hide(els.panel, ui.layout === "mobile" ? "drawer" : panelPreset());
        return;
    }
    const panelHidden = els.panel.classList.contains("hidden") || els.panel.classList.contains("is-hiding");
    if (opening || panelHidden) {
        applyAttributes();
        show(els.panel, panelPreset(), origin);
    } else if (previousSize && previousSize !== ui.size) {
        flipResize(applyAttributes);
    } else {
        applyAttributes();
    }
}

function applyVisibility({ previousSize = null, origin = null, opening = false } = {}) {
    const mobileMini = ui.layout === "mobile" && ui.size === "mini";
    const wantScrim = ui.open && ui.size === "overlay";
    const wantPanel = ui.open && !mobileMini;
    const wantPip = ui.open && mobileMini;

    if (wantScrim) show(els.scrim, "fade");
    else hide(els.scrim, "fade");

    applyPanelVisibility(wantPanel, { previousSize, origin, opening });

    if (wantPip) show(els.pip, "drawer");
    else hide(els.pip, ui.open ? "fade" : "drawer");
    lockBody();
}

function focusInside() {
    if (ui.layout === "mobile" && ui.size === "mini") {
        els.pipOpen.focus({ preventScroll: true });
        return;
    }
    // Phones: focusing the textarea would pop the keyboard over the sheet
    // before the user has read anything, so focus the panel itself.
    if (ui.layout === "mobile") els.panel.focus({ preventScroll: true });
    else els.input.focus({ preventScroll: true });
}

function openPanel({ size = null, origin = null, fromRoute = false, routeId = null } = {}) {
    const nextSize = normalizeSize(size || (ui.open ? ui.size : "overlay"));
    const wasOpen = ui.open;
    const previousSize = ui.size;
    ui.layout = effectiveLayout();
    ui.size = nextSize;
    markAiUsed();
    // Opening the panel while the search bar waits for an answer hands the
    // wait to the panel: its status line and halo take over from the bar's.
    store?.setSurface("panel");
    if (!wasOpen) {
        ui.open = true;
        ui.returnFocus = origin || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
        closeHistoryPop();
        applyVisibility({ origin, opening: true });
        requestAnimationFrame(focusInside);
    } else {
        applyVisibility({ previousSize });
    }
    if (!fromRoute) {
        const state = store.getState();
        const id = routeId || state.conversation?.id || "new";
        // Opening is an entry of its own, marked so closing steps Back off
        // it (router.js closeOverlay); resizing an open panel replaces.
        pushRoute({ conversation: id, cv: ui.size }, wasOpen ? { replace: true } : { overlay: "conversation" });
    }
    scheduleRender();
}

// The Ask buttons' aria-expanded; also set on close, which doesn't render.
function syncAskExpanded() {
    const value = ui.open ? "true" : "false";
    els.topAsk?.setAttribute("aria-expanded", value);
    els.phoneAsk?.setAttribute("aria-expanded", value);
}

function closePanel({ fromRoute = false } = {}) {
    if (!ui.open) return;
    ui.open = false;
    ui.publicState = null;
    syncAskExpanded();
    closeMenu();
    closeSharePop();
    closeHistoryPop();
    mini?.closeHistory({ immediate: true });
    voice?.abort();
    citePop?.close();
    hide(els.panel, panelPreset());
    hide(els.scrim, "fade");
    hide(els.pip, "drawer");
    lockBody();
    const target = ui.returnFocus;
    ui.returnFocus = null;
    if (target && document.contains(target) && target.offsetParent !== null) target.focus({ preventScroll: true });
    // Back off the entry opening it pushed, so Back doesn't re-open it; a
    // cold-loaded /chat/<id> link is removed in place instead. An answer
    // (/answer/<id>, /a/<token>) closes the same way.
    if (!fromRoute) {
        const route = readRoute();
        if (route.chat || route.a) closeOverlay("answer", { chat: null, a: null, conversation: null, cv: null });
        else closeOverlay("conversation", { conversation: null, cv: null });
    }
    // Asking made the answer the current view (Recent, the bookmark
    // button); the page underneath gets it back.
    window.restoreShownView?.();
}

function setSize(size, { fromRoute = false } = {}) {
    const next = normalizeSize(size);
    if (!ui.open) {
        openPanel({ size: next, fromRoute });
        return;
    }
    if (next === ui.size) return;
    const previousSize = ui.size;
    ui.size = next;
    closeMenu();
    closeHistoryPop(); // its anchor moved: the sidebar, popover or column takes over
    citePop?.close();
    applyVisibility({ previousSize });
    if (!fromRoute) pushRoute({ cv: next }, { replace: true });
    // Crossing between the sheet and the phone's bar moves focus with it.
    if (ui.layout === "mobile" && (previousSize === "mini" || next === "mini")) requestAnimationFrame(focusInside);
    scheduleRender();
}

// ── public entry points ────────────────────────────────────────────────

async function waitForAuth() {
    if (ui.authResolved) return;
    await Promise.race([authReady, new Promise((r) => setTimeout(r, AUTH_TIMEOUT_MS))]);
}

// ── search-bar answers ─────────────────────────────────────────────────

// Opens the panel on the answer being shown: the overlay from the search
// bar (or the full page, if that's where it already is).
function presentAnswer() {
    ui.awaitingOpenId = null;
    ui.forceScroll = true;
    markAiUsed();
    openPanel({ size: ui.open && ui.size === "full" ? "full" : "overlay", fromRoute: true });
}

// Where a question's loading cues belong: "bar" for a fresh question typed in
// the search bar while the panel is shut (the panel stays shut until the answer
// lands, so the bar carries every cue), "panel" for everything else -- a
// question asked in the panel's own composer, a follow-up, a re-ask from the
// shelf, or a bar question while the panel is already open on screen.
function askSurface({ origin = "bar", followUp = false } = {}) {
    return origin === "bar" && !followUp && !ui.open && Boolean(els?.barStatus) ? "bar" : "panel";
}

// handleAiSearch: ask through /ask and show it here. Resolves the payload,
// or null when another question or answer replaced it meanwhile; rejects
// (after showing the failure on the turn) for the caller's side effects.
// `surface` is askSurface()'s answer: "bar" holds the panel back until the
// answer (or its failure) is ready to show.
function askFromSearch(question, request = {}, { followUp = false, surface = "panel" } = {}) {
    ui.publicState = null;
    // Follow-ups (and the URL) use the settings this answer was asked with:
    // the search bar asks with the visitor's own community.
    if (request.mode) ui.mode = request.mode;
    ui.routeMinhag = null;
    const fromBar = surface === "bar" && !followUp;
    const asked = followUp
        ? store.askGuestFollowUp(question, request)
        : store.askSearch(question, request, { surface: fromBar ? "bar" : "panel" });
    let pending = asked;
    if (fromBar) {
        // Unless the reader opened the panel meanwhile (which took the cues
        // over), it opens now on the answer or on the failure with its Retry.
        pending = asked.then(
            (data) => {
                if (data && !ui.open) presentAnswer();
                return data;
            },
            (error) => {
                if (!ui.open) presentAnswer();
                throw error;
            },
        );
    } else {
        presentAnswer();
    }
    pending.catch((error) => {
        if (error?.code === "guest_cap_reached") onGuestCapRefused(error, question, followUp);
    });
    return pending;
}

// ── guest limits ───────────────────────────────────────────────────────

// The server refused a guest question (backend/guest_cap.py). A refused
// follow-up leaves no turn behind, so the words go back in the box -- they are
// waiting for the visitor after sign-in; a refused new question stays on screen
// as a failed turn with its Retry.
function onGuestCapRefused(error, question, followUp) {
    if (followUp && !els.input.value.trim()) {
        els.input.value = question;
        autosize();
        syncSendDisabled();
    }
    openGuestCap(error.reason, error.usage);
}

function openGuestCap(reason, usage) {
    const dialog = els.guestCap;
    if (!dialog || typeof dialog.showModal !== "function") return;
    const copy = guestCapCopy(reason, usage, lang());
    els.guestCapTitle.textContent = copy.title;
    els.guestCapBody.textContent = copy.body;
    if (!dialog.open) dialog.showModal();
}

function closeGuestCap() {
    if (els.guestCap?.open) els.guestCap.close();
}

// Sign-in is open over the panel: the dialog is done either way.
function signInFromGuestCap({ create = false } = {}) {
    closeGuestCap();
    if (create && typeof window.handleSignUp === "function") void window.handleSignUp();
    else if (typeof window.handleSignIn === "function") void window.handleSignIn();
}

// A stored answer: history, shelf, /answer/<id>, /a/<token>.
function showStoredAnswer(item) {
    if (!item) return;
    ui.publicState = null;
    store.showAnswer(item, { question: item.question });
    presentAnswer();
}

function showPublicLoading() {
    store.startNew({ minhag: defaultMinhag() });
    ui.publicState = "loading";
    presentAnswer();
}

function showPublicUnavailable(gone) {
    ui.publicState = gone ? "gone" : "error";
    scheduleRender();
}

// A shared conversation (/a/<token> whose payload is a conversation): its
// turns, read-only.
function showPublicConversation(item) {
    if (!item) return;
    ui.publicState = null;
    store.showSharedConversation(item);
    presentAnswer();
}

// An /answer/<id> link (the classic script's hydrateChatId): the answer's
// loading state while Clerk and the fetch resolve. The fetch carries the
// account's token when signed in and the device cookie either way, so a
// signed-out visitor on the device that asked it gets the answer too.
function showSavedLoading() {
    store.startNew({ minhag: defaultMinhag() });
    ui.publicState = "saved";
    presentAnswer();
}

// `signIn`: neither the account nor the device holds the answer, and the
// visitor is signed out, so the URL stays and signing in opens it.
function showSavedUnavailable(gone, { signIn = false } = {}) {
    ui.publicState = gone ? "saved-gone" : "saved-error";
    if (signIn) ui.publicState = "saved-signin";
    scheduleRender();
}

// Signed out, a question is a one-shot /ask (Decision A1); `followUp` names the
// answers on screen as the conversation it continues (guest limits apply).
function askOneShot(question, { followUp = false } = {}) {
    if (typeof window.handleAiSearch === "function") void window.handleAiSearch(question, { followUp, origin: "panel" });
}

// Open (or resume) the conversation UI. `fresh` starts a new thread first;
// `question` is sent straight away.
async function openConversation({ id = null, fresh = false, question = "", trigger = null, size = null } = {}) {
    if (!store) return;
    const text = String(question || "").trim();
    if (text) {
        await waitForAuth();
        if (!ui.signedIn) {
            askOneShot(text);
            return;
        }
    }
    ui.publicState = null;
    const state = store.getState();
    if (id) {
        ui.awaitingOpenId = null;
        if (state.conversation?.id !== id) void store.open(id);
        openPanel({ size, origin: trigger, routeId: id });
        return;
    }
    if (fresh || (text && (state.conversation || state.messages.length))) {
        if (state.conversation || state.messages.length || state.loadStatus !== "ready") {
            store.startNew({ minhag: defaultMinhag() });
        }
        ui.awaitingOpenId = null;
    }
    openPanel({ size, origin: trigger });
    if (text) {
        ui.forceScroll = true;
        void store.send(text, { mode: currentMode(), language: lang() });
    }
}

// Router: `route` is readRoute()'s shape. Called from the classic script's
// hydrateRoute() for the initial URL and on every back/forward.
function hydrate(route = {}, { isInitial = false } = {}) {
    if (!store) return;
    applyAiRoute(route);
    const id = route.conversation;
    if (!id) {
        ui.awaitingOpenId = null;
        // An answer's URL: the classic script (hydrateChatId /
        // hydratePublicAnswer) shows it here.
        if (route.chat || route.a) return;
        closePanel({ fromRoute: true });
        return;
    }
    const size = normalizeSize(route.cv);
    if (id === "new") {
        const state = store.getState();
        if (state.conversation) store.startNew({ minhag: defaultMinhag() });
        ui.awaitingOpenId = null;
    } else if (store.getState().conversation?.id !== id) {
        if (ui.authResolved && ui.signedIn) {
            ui.awaitingOpenId = null;
            void store.open(id);
        } else {
            ui.awaitingOpenId = id;
        }
    }
    if (ui.open) setSize(size, { fromRoute: true });
    else openPanel({ size, fromRoute: true });
    if (isInitial) scheduleRender();
}

// ── history popover ────────────────────────────────────────────────────

function positionPop(trigger) {
    const pop = els.pop;
    const margin = 8;
    const rect = trigger.getBoundingClientRect();
    const width = pop.offsetWidth || 320;
    const height = pop.offsetHeight || 320;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rtl = document.documentElement.dir === "rtl";
    let left = rtl ? rect.left : rect.right - width;
    left = Math.min(Math.max(margin, left), vw - width - margin);
    let top = rect.bottom + margin;
    if (top + height > vh - margin) top = Math.max(margin, rect.top - height - margin);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
}

function setTriggerExpanded(trigger, expanded) {
    document.querySelectorAll(".conv-history-trigger").forEach((btn) => {
        btn.setAttribute("aria-expanded", expanded && btn === trigger ? "true" : "false");
    });
}

// The mini widget's history: a column that grows out of its free side
// (conversation-mini.js). Pressing the button again folds it away; picking a
// conversation leaves it open, so a few can be looked through in a row.
function toggleHistoryColumn() {
    if (mini.isHistoryOpen()) {
        mini.closeHistory();
        return;
    }
    closeMenu();
    closeSharePop();
    maybeLoadList();
    render();
    mini.openHistory();
    requestAnimationFrame(() => {
        const first = els.sidebar.querySelector("[aria-current='true'], .conv-list__item, .conv-new-btn");
        first?.focus({ preventScroll: true });
    });
}

function openHistoryPop(trigger) {
    if (!trigger) return;
    if (mini && isDesktopMini() && trigger === els.historyBtn) {
        toggleHistoryColumn();
        return;
    }
    if (!els.pop.classList.contains("hidden") && ui.popTrigger === trigger) {
        closeHistoryPop();
        return;
    }
    closeMenu();
    closeSharePop();
    ui.popTrigger = trigger;
    maybeLoadList();
    render();
    els.pop.classList.remove("hidden");
    positionPop(trigger);
    els.pop.classList.add("hidden");
    show(els.pop, "popover", trigger);
    setTriggerExpanded(trigger, true);
    requestAnimationFrame(() => {
        const first = els.pop.querySelector("[aria-current='true'], .conv-list__item, .conv-pop__new");
        first?.focus({ preventScroll: true });
    });
}

function closeHistoryPop({ restoreFocus = false } = {}) {
    if (!els || els.pop.classList.contains("hidden")) return;
    const trigger = ui.popTrigger;
    ui.popTrigger = null;
    hide(els.pop, "popover");
    setTriggerExpanded(null, false);
    if (restoreFocus) trigger?.focus({ preventScroll: true });
}

function maybeLoadList(force = false) {
    if (!ui.signedIn) return;
    if (!force && Date.now() - ui.listLoadedAt < LIST_STALE_MS && store.getState().list.status === "ready") return;
    ui.listLoadedAt = Date.now();
    void store.loadList({ limit: 30 });
}

// ── settings menu ──────────────────────────────────────────────────────

// The chat menu is the one place to pick the AI mode and community, so a
// choice there is also the saved default (index.html's ShelahPrefs).
function savePref(key, value) {
    if (value) window.ShelahPrefs?.set(key, value);
}

// Quick Settings' "AI settings": open the panel, then its menu. The menu
// opens a task later so the click that got here can't close it again
// (onDocumentClick closes the menu on clicks outside it).
async function openSettings(trigger = null) {
    const size = ui.open && ui.size !== "mini" ? null : "overlay";
    await openConversation({ trigger, size });
    setTimeout(() => {
        if (ui.open && !ui.menuOpen) openMenu(els.menuBtn);
    }, 0);
}

function openMenu(trigger) {
    if (ui.menuOpen) {
        closeMenu();
        return;
    }
    closeHistoryPop();
    closeSharePop();
    ui.menuOpen = true;
    render();
    show(els.menu, "popover", trigger);
    els.menuBtn.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => {
        const first = els.menu.querySelector("select:not([disabled]), input:checked, button");
        first?.focus({ preventScroll: true });
    });
}

function closeMenu({ restoreFocus = false } = {}) {
    if (!els || !ui.menuOpen) return;
    ui.menuOpen = false;
    hide(els.menu, "popover");
    els.menuBtn.setAttribute("aria-expanded", "false");
    if (restoreFocus) els.menuBtn.focus({ preventScroll: true });
}

// ── thread actions ─────────────────────────────────────────────────────

function armToastTimer() {
    clearTimeout(ui.toastTimer);
    if (!ui.toast) return;
    ui.toastTimer = setTimeout(() => {
        ui.toast = null;
        scheduleRender();
    }, ui.toast.action ? TOAST_ACTION_MS : TOAST_MS);
}

// tone: "success" (a check), "warn" (a triangle) or "info" (no mark).
function showToast(text, action, tone = "success") {
    ui.toast = { text, action, tone };
    armToastTimer();
    scheduleRender();
}

function clearToast() {
    clearTimeout(ui.toastTimer);
    ui.toast = null;
}

// The toast waits while it is being read: pointer over it, or focus inside.
function pauseToast() {
    clearTimeout(ui.toastTimer);
}

function onToastAction() {
    const action = els.toastAction.dataset.action;
    clearToast();
    if (action === "undo") void store.undoRemove();
    else if (action === "stop-share") void stopSharing();
    scheduleRender();
}

// ── sharing ────────────────────────────────────────────────────────────

// The header's Share button shows once the conversation is saved; "Stop
// sharing" joins the menu while its public link is live. The state is
// fetched once per conversation, then kept by the share store.
function isShared(conversation) {
    return Boolean(conversation && shareControl?.peek(conversation.id)?.shared);
}

function syncShare(conversation) {
    const shared = isShared(conversation);
    els.panel.dataset.shared = shared ? "true" : "false";
    if (els.shareBtn) {
        const label = shared
            ? tr("Shared publicly. Copy the link or stop sharing", "משותף לציבור. העתק את הקישור או הפסק את השיתוף")
            : tr("Share this conversation publicly", "שתף את השיחה בציבור");
        els.shareBtn.dataset.shared = shared ? "true" : "false";
        els.shareBtn.setAttribute("aria-label", label);
        els.shareBtn.title = label;
    }
    if (!shared && ui.sharePopOpen) closeSharePop();
    if (!conversation) {
        ui.shareLoadedFor = null;
    } else if (ui.shareLoadedFor !== conversation.id) {
        ui.shareLoadedFor = conversation.id;
        void shareControl?.load(conversation.id);
    }
}

async function shareConversation() {
    const conversation = store.getState().conversation;
    if (!conversation || ui.sharing || !shareControl) return;
    ui.sharing = true;
    els.shareBtn?.setAttribute("aria-busy", "true");
    try {
        const result = await shareControl.publish(conversation.id);
        // Another thread came on screen while the link was made: the notice
        // would be about the wrong conversation.
        if (store.getState().conversation?.id !== conversation.id) return;
        if (result.status === "copied") {
            showToast(tr(
                "Public link copied. Anyone with it can read this chat as it is now.",
                "הקישור הציבורי הועתק. כל מי שיש לו אותו יכול לקרוא את השיחה כפי שהיא עכשיו."), "stop-share");
        } else if (result.status === "manual") {
            showToast(`${tr("Couldn't copy automatically. Copy this link:", "לא ניתן היה להעתיק אוטומטית. העתק/י את הקישור:")} ${result.url}`, "stop-share", "info");
        } else if (result.status === "empty") {
            showToast(tr("There's nothing to share yet. Ask a question first.", "אין עדיין מה לשתף. שאל/י שאלה קודם."), undefined, "info");
        } else {
            showToast(tr("Couldn't create a link. Try again.", "לא ניתן היה ליצור קישור. נסה/י שוב."), undefined, "warn");
        }
    } finally {
        ui.sharing = false;
        els.shareBtn?.removeAttribute("aria-busy");
    }
}

async function stopSharing() {
    const conversation = store.getState().conversation;
    if (!conversation || !shareControl) return;
    const stopped = await shareControl.stop(conversation.id);
    if (store.getState().conversation?.id !== conversation.id) return;
    if (stopped) showToast(tr("Sharing stopped. The old link no longer works.", "השיתוף הופסק. הקישור הישן כבר לא עובד."));
    else showToast(tr("Couldn't stop sharing. Try again.", "לא ניתן היה להפסיק את השיתוף. נסה/י שוב."), undefined, "warn");
}

// The header's Share button when the conversation is already public: it asks
// before doing anything, under the button (a small card, not a modal). Copy
// link re-copies; Stop sharing revokes. Anywhere else (phones, where Share is
// a row of the menu) the row's own wording says what it does.
function openSharePop() {
    if (!els.sharePop || ui.sharePopOpen) return;
    closeMenu();
    closeHistoryPop();
    ui.sharePopOpen = true;
    els.shareBtn.setAttribute("aria-expanded", "true");
    void show(els.sharePop, "popover", els.shareBtn);
    requestAnimationFrame(() => {
        els.sharePop.querySelector("button")?.focus({ preventScroll: true });
    });
}

function closeSharePop({ restoreFocus = false } = {}) {
    if (!els?.sharePop || !ui.sharePopOpen) return;
    ui.sharePopOpen = false;
    els.shareBtn.setAttribute("aria-expanded", "false");
    void hide(els.sharePop, "popover");
    if (restoreFocus) els.shareBtn.focus({ preventScroll: true });
}

function beginRename() {
    const conversation = store.getState().conversation;
    if (!conversation || els.title.querySelector("input")) return;
    closeMenu();
    const input = document.createElement("input");
    input.type = "text";
    input.className = "conv-title-input";
    input.maxLength = 120;
    input.dir = "auto";
    input.value = conversation.title || "";
    input.setAttribute("aria-label", tr("Conversation name", "שם השיחה"));
    els.title.textContent = "";
    els.title.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit) => {
        if (done) return;
        done = true;
        const value = input.value.trim();
        input.remove();
        els.title.textContent = conversation.title;
        if (commit && value && value !== conversation.title) void store.rename(conversation.id, value);
        scheduleRender();
        els.menuBtn.focus({ preventScroll: true });
    };
    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            finish(false);
        }
    });
    input.addEventListener("blur", () => finish(true));
}

async function deleteCurrent() {
    const conversation = store.getState().conversation;
    if (!conversation) return;
    closeMenu();
    if (await store.remove(conversation.id)) {
        showToast(tr("Conversation deleted.", "השיחה נמחקה."), "undo");
    }
}

function openCitation(ref) {
    if (!ref) return;
    // Keep the conversation on screen but out of the way of the text: the
    // corner widget on desktop, the bar above the tabs on phones.
    if (ui.size !== "mini") setSize("mini");
    // skipNavigationGrid: a cited ref is already specific ("Berakhot 2a"),
    // so go straight to the text rather than a chapter picker.
    if (typeof window.readText === "function") {
        void window.readText(ref, { skipNavigationGrid: true }).then(() => highlightCitedSegment(ref));
    }
}

// M-7: the reader opens at the ref without marking which line it is; a
// one-shot highlight (ai.css .segment-row.cite-highlight) says "here",
// same as the anchor Back/Forward restores to. Only the specific verse a
// citation names ("Genesis 1:3") gets one; a whole-page ref ("Berakhot
// 2a") has no single row to mark. Fetching one verse renders it as the
// chunk's sole row (its data-segment is always "1", not the verse
// number), so the target is "the row in the chunk this ref opened",
// matched by the same tracking key the reader anchors with, not a
// verse-number lookup.
function highlightCitedSegment(ref) {
    if (!/:\d+\s*$/.test(String(ref || "").trim()) || window.ShelahMotion?.isMotionReduced?.()) return;
    const key = window.getRefTrackingKey?.(ref);
    const chunk = key
        ? document.querySelector(`#readerSources .reader-source-clean[data-text-chunk-ref="${CSS.escape(key)}"]`)
        : document.querySelector("#readerSources .reader-source-clean[data-text-chunk-ref]");
    const row = chunk?.querySelector(".segment-row");
    if (!row) return;
    row.classList.remove("cite-highlight");
    row.getBoundingClientRect(); // restart the animation if the same verse is cited twice in a row
    row.classList.add("cite-highlight");
    window.setTimeout(() => row.classList.remove("cite-highlight"), 1200);
}

// ── topbar Ask button + discovery tip ─────────────────────────────────

function onTopAsk() {
    if (!ui.open) {
        void openConversation({ size: "mini", trigger: els.topAsk });
    } else if (ui.size !== "mini") {
        setSize("mini");
    } else {
        closePanel();
    }
}

// Phone top bar: opens the full-screen overlay; a second tap restores a
// minimised bar, or closes the conversation.
function onPhoneAsk() {
    if (!ui.open) {
        void openConversation({ trigger: els.phoneAsk });
    } else if (ui.size === "mini") {
        setSize("overlay");
    } else {
        closePanel();
    }
}

function markAiUsed() {
    writeFlag(AI_USED_KEY);
    window.clearTimeout(ui.tipTimer);
    ui.tipDeferred = false;
    hideTip();
}

function tipAnchor() {
    if (effectiveLayout() === "desktop") return els.topAsk;
    return els.phoneAsk || document.querySelector('#mobileBottomTabs [data-mobile-tab="search"]');
}

function positionTip() {
    const anchor = ui.tipAnchor;
    if (!anchor || !els.tip) return;
    const a = anchor.getBoundingClientRect();
    const tip = els.tip;
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const margin = 16;
    // Below a top-bar anchor, above a bottom-tab one.
    const below = a.top < window.innerHeight / 2;
    const center = a.left + a.width / 2;
    const left = Math.min(Math.max(margin, center - width / 2), window.innerWidth - width - margin);
    const top = below ? a.bottom + TIP_GAP_PX : a.top - height - TIP_GAP_PX;
    tip.dataset.placement = below ? "below" : "above";
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(Math.max(margin, top))}px`;
    tip.style.setProperty("--ai-tip-arrow-x", `${Math.round(center - left)}px`);
}

function maybeShowTip() {
    if (!els.tip || readFlag(AI_USED_KEY) || readFlag(TIP_DISMISSED_KEY)) return;
    window.clearTimeout(ui.tipTimer);
    ui.tipTimer = window.setTimeout(() => {
        // Only on a calm screen: never over an open panel, modal, search or reader.
        const menuOpen = openTipBlockingMenu();
        const busy = ui.open
            || menuOpen
            || document.body.classList.contains("mobile-search-open")
            || document.body.classList.contains("conv-modal-open");
        const anchor = tipAnchor();
        if (busy || !anchor || anchor.offsetParent === null || readFlag(AI_USED_KEY) || readFlag(TIP_DISMISSED_KEY)) {
            // A menu in the way only postpones the tip: the menu watcher
            // brings it back once every menu is closed.
            ui.tipDeferred = menuOpen;
            return;
        }
        ui.tipAnchor = anchor;
        anchor.classList.add("ai-attention");
        els.tip.classList.remove("hidden");
        positionTip();
        els.tip.classList.add("hidden");
        void show(els.tip, "popover", anchor);
        followTipAnchor(anchor);
    }, TIP_DELAY_MS);
}

function openTipBlockingMenu() {
    return TIP_BLOCKING_MENU_IDS.some((id) => {
        const menu = document.getElementById(id);
        // Leaving (is-hiding) counts as closed, as index.html's isMenuClosed.
        return Boolean(menu) && !menu.classList.contains("hidden") && !menu.classList.contains("is-hiding");
    });
}

// A menu opening hides the tip for now (not for good: it comes back once
// every menu is closed again, unless the tip was dismissed meanwhile).
function watchTipBlockingMenus() {
    const menus = TIP_BLOCKING_MENU_IDS.map((id) => document.getElementById(id)).filter(Boolean);
    if (!menus.length) return;
    const observer = new MutationObserver(() => {
        if (openTipBlockingMenu()) {
            if (ui.tipAnchor) {
                ui.tipDeferred = true;
                hideTip();
            }
        } else if (ui.tipDeferred) {
            ui.tipDeferred = false;
            maybeShowTip();
        }
    });
    menus.forEach((menu) => observer.observe(menu, { attributes: true, attributeFilter: ["class"] }));
}

// The bars keep filling in after load (the Hebrew date, the account button),
// which slides the anchor sideways: re-seat the tip whenever anything in the
// anchor's bar changes size, for as long as the tip is up.
function followTipAnchor(anchor) {
    if (typeof ResizeObserver !== "function") return;
    const bar = anchor.closest("header, nav, #mobileBottomTabs") || anchor.parentElement;
    ui.tipObserver = new ResizeObserver(() => positionTip());
    [bar, ...bar.querySelectorAll("*")].forEach((el) => ui.tipObserver.observe(el));
}

function hideTip() {
    ui.tipObserver?.disconnect();
    ui.tipObserver = null;
    ui.tipAnchor?.classList.remove("ai-attention");
    ui.tipAnchor = null;
    if (els.tip && !els.tip.classList.contains("hidden")) void hide(els.tip, "popover");
}

function dismissTip() {
    writeFlag(TIP_DISMISSED_KEY);
    ui.tipDeferred = false;
    const anchor = ui.tipAnchor;
    hideTip();
    if (anchor && els.tip.contains(document.activeElement)) anchor.focus({ preventScroll: true });
}

function tryFromTip() {
    const anchor = ui.tipAnchor;
    markAiUsed();
    if (effectiveLayout() === "desktop") void openConversation({ size: "mini", trigger: anchor || els.topAsk });
    else void openConversation({ trigger: anchor });
}

async function submitComposer() {
    const text = els.input.value.trim();
    if (!text) return;
    // Sending ends dictation, and a word still in flight must not land in the
    // emptied box.
    voice?.abort();
    const state = store.getState();
    if (state.sending || state.loadStatus === "loading") return;
    await waitForAuth();
    if (!ui.signedIn) {
        const followUp = store.canContinueAsGuest();
        // This conversation's guest allowance is spent: say so before sending
        // anything. The question stays in the box for after sign-in.
        if (followUp && store.guestCapReached()) {
            openGuestCap("thread_questions", store.getState().guestUsage);
            return;
        }
        els.input.value = "";
        autosize();
        askOneShot(text, { followUp });
        return;
    }
    els.input.value = "";
    autosize();
    clearToast();
    ui.forceScroll = true;
    // A refused question stays in the transcript as FAILED with a Retry.
    await store.send(text, { mode: currentMode(), language: lang() });
}

// Dictation (conversation-voice.js): the button exists only where the browser
// has speech recognition. Chrome and others hand the audio to their vendor's
// service, so the first use says so, once per device.
function voiceErrorText(kind) {
    switch (kind) {
        case "denied":
            return tr("Microphone is blocked. To dictate, open the site settings by the address bar (the lock icon), allow the microphone, then try again.",
                "המיקרופון חסום. כדי להכתיב, פתחו את הגדרות האתר ליד שורת הכתובת (סמל המנעול), אפשרו את המיקרופון ונסו שוב.");
        case "no-mic":
            return tr("No microphone was found.", "לא נמצא מיקרופון.");
        case "network":
            return tr("Dictation needs an internet connection.", "הכתבה דורשת חיבור לאינטרנט.");
        default:
            return tr("Your browser can't dictate in this language.", "הדפדפן לא תומך בהכתבה בשפה זו.");
    }
}

function installVoice() {
    if (!els.micBtn) return;
    voice = createVoiceInput({
        input: els.input,
        button: els.micBtn,
        getLang: lang,
        onState: (listening) => {
            const label = listening ? tr("Stop dictation", "עצור הכתבה") : tr("Dictate your question", "הכתבת השאלה");
            els.micBtn.setAttribute("aria-label", label);
            els.micBtn.title = label;
            if (!listening || readFlag(VOICE_NOTICE_KEY)) return;
            writeFlag(VOICE_NOTICE_KEY);
            showToast(tr(
                "Dictation uses your browser's speech recognition. Some browsers send the audio to their provider to transcribe it.",
                "ההכתבה משתמשת בזיהוי הדיבור של הדפדפן. בדפדפנים מסוימים האודיו נשלח לספק שלהם לצורך תמלול."), undefined, "info");
        },
        onError: (kind) => {
            // No audio went anywhere: the first-use note is still owed.
            clearFlag(VOICE_NOTICE_KEY);
            showToast(voiceErrorText(kind), undefined, "warn");
        },
    });
    els.micBtn.classList.toggle("hidden", !voice);
}

// The box grows a line at a time up to COMPOSER_MAX_PX, then scrolls. It can
// only be measured while it is laid out: filled while the panel is hidden it
// would read a scrollHeight of 0, so it is left to its CSS height and measured
// again when the panel opens (openConversation) or its width changes
// (installComposerResize). The thread's scroll position is held across the
// brief "auto" reset, so typing never nudges the answers above.
const COMPOSER_MAX_PX = 160;

function autosize() {
    const input = els.input;
    syncSendDisabled();
    if (!input.getClientRects().length) {
        input.style.removeProperty("height");
        return;
    }
    const scroller = els.scroller;
    const top = scroller?.scrollTop;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, COMPOSER_MAX_PX)}px`;
    if (scroller && scroller.scrollTop !== top) scroller.scrollTop = top;
}

// A wider or narrower box wraps differently: re-measure when the composer's
// width changes (a resize of the widget, a size switch), never on height, which
// autosize itself changes.
function installComposerResize() {
    if (typeof ResizeObserver !== "function") return;
    let width = null;
    new ResizeObserver((entries) => {
        const next = Math.round(entries[0]?.contentRect?.width ?? 0);
        if (next === width) return;
        width = next;
        if (next > 0) autosize();
    }).observe(els.input);
}

// ── gestures ───────────────────────────────────────────────────────────

// Desktop mini widget: drag by its header, snap to the nearest corner.
function installMiniDrag() {
    let drag = null;
    els.header.addEventListener("pointerdown", (event) => {
        if (ui.layout !== "desktop" || ui.size !== "mini" || event.button !== 0) return;
        if (event.target.closest("button, input, select, a")) return;
        stopFlip(els.panel); // a snap still springing: the drag owns the transform now
        const rect = els.panel.getBoundingClientRect();
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, rect };
        els.header.setPointerCapture(event.pointerId);
        els.panel.classList.add("is-dragging");
    });
    els.header.addEventListener("pointermove", (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        els.panel.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    const end = (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        const center = { x: drag.rect.left + drag.rect.width / 2 + dx, y: drag.rect.top + drag.rect.height / 2 + dy };
        drag = null;
        els.panel.classList.remove("is-dragging");
        const physical = snapCorner(center, { width: window.innerWidth, height: window.innerHeight });
        const rtl = document.documentElement.dir === "rtl";
        // Stored in logical terms so the widget stays on the "end" side after a language switch.
        saveCorner(logicalCorner(physical, rtl));
        flipResize(() => {
            els.panel.style.removeProperty("transform");
            els.panel.dataset.corner = logicalCorner(readCorner(), rtl);
        });
        if (Math.hypot(dx, dy) < 4) els.panel.style.removeProperty("transform");
    };
    els.header.addEventListener("pointerup", end);
    els.header.addEventListener("pointercancel", end);
}

// Soft ceiling for a drag past the boundary (WWDC18 "Designing Fluid
// Interfaces" rubberbanding) -- mirrors calendar-detail.js's identical helper.
function rubberband(overshoot, dimension, c = 0.55) {
    return (overshoot * dimension * c) / (dimension + c * overshoot);
}

// Phone sheet: swipe down on the grabber/header to minimise to the bar.
function installSheetSwipe() {
    let swipe = null;
    const start = (event) => {
        if (ui.layout !== "mobile" || ui.size !== "overlay") return;
        if (event.target.closest("button, input, select, a")) return;
        swipe = { id: event.pointerId, y: event.clientY, t: performance.now(), dy: 0 };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const move = (event) => {
        if (!swipe || event.pointerId !== swipe.id) return;
        const raw = event.clientY - swipe.y;
        // Downward drag (toward minimise) tracks 1:1; an upward drag past the
        // top boundary is resisted, not hard-clamped, so it still moves a
        // little instead of feeling frozen.
        swipe.dy = raw >= 0 ? raw : -rubberband(-raw, 300);
        els.panel.style.transform = `translateY(${swipe.dy}px)`;
    };
    const end = (event) => {
        if (!swipe || event.pointerId !== swipe.id) return;
        const { dy, t } = swipe;
        swipe = null;
        const velocity = dy / Math.max(1, performance.now() - t); // px/ms
        if (dy > SWIPE_CLOSE_PX || velocity > 0.8) {
            els.panel.style.removeProperty("transform");
            setSize("mini");
            return;
        }
        const M = motion();
        const controls = M?.springAnimate?.(els.panel, { transform: [`translateY(${dy}px)`, "translateY(0px)"] }, M.APPLE_SPRING?.snappy);
        if (controls) void Promise.resolve(controls).finally(() => els.panel.style.removeProperty("transform"));
        else els.panel.style.removeProperty("transform");
    };
    [els.grabber, els.header].forEach((el) => {
        el.addEventListener("pointerdown", start);
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", end);
        el.addEventListener("pointercancel", end);
    });
}

// ── events ─────────────────────────────────────────────────────────────

function focusables(root) {
    return [...root.querySelectorAll("a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex='-1'])")]
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
}

function isMobileMini() {
    return ui.layout === "mobile" && ui.size === "mini";
}

// The floating corner widget on a desktop-sized window: the one place the
// history opens as a column beside the chat rather than as a popover.
function isDesktopMini() {
    return ui.layout === "desktop" && ui.size === "mini";
}

// What Escape closes, innermost first, before it closes the panel itself.
const ESCAPE_LAYERS = [
    [() => citePop?.isOpen(), () => citePop.close({ restoreFocus: true })],
    [() => !els.pop.classList.contains("hidden"), () => closeHistoryPop({ restoreFocus: true })],
    [() => ui.menuOpen, () => closeMenu({ restoreFocus: true })],
    [() => ui.sharePopOpen, () => closeSharePop({ restoreFocus: true })],
    // The mini widget's history column, while focus is in the widget.
    [() => mini?.isHistoryOpen() && els.panel.contains(document.activeElement), () => {
        mini.closeHistory();
        els.historyBtn.focus({ preventScroll: true });
    }],
];

function onEscape(event) {
    const layer = ESCAPE_LAYERS.find(([isOpen]) => isOpen());
    if (layer) {
        event.preventDefault();
        layer[1]();
    } else if (ui.open && isModalSize(ui.size) && !isMobileMini()) {
        event.preventDefault();
        closePanel();
    }
}

// Tab stays inside a modal panel.
function trapTab(event) {
    if (!ui.open || !isModalSize(ui.size) || isMobileMini()) return;
    if (!els.pop.classList.contains("hidden")) return; // popover owns focus
    const items = focusables(els.panel);
    if (!items.length) return;
    const first = items[0];
    const last = items.at(-1);
    if (!els.panel.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    }
}

function onKeydown(event) {
    if (!els) return;
    // The sign-in dialog is a native modal: it closes itself on Escape and
    // keeps focus inside, so the panel behind it stays out of both.
    if (els.guestCap?.open) return;
    if (event.key === "Escape") onEscape(event);
    else if (event.key === "Tab") trapTab(event);
}

// Outside clicks close the popover / menu.
function closePopoversOutside(target) {
    if (!els.pop.classList.contains("hidden") && !els.pop.contains(target) && !target.closest(".conv-history-trigger")) {
        closeHistoryPop();
    }
    if (ui.menuOpen && !els.menu.contains(target) && !target.closest("#convMenuBtn")) {
        closeMenu();
    }
    if (ui.sharePopOpen && !els.sharePop.contains(target) && !target.closest("#convShareBtn")) {
        closeSharePop();
    }
}

// The click handlers below each return true when the click was theirs.

// A suggested question fills the box and leaves the sending to the visitor.
function clickSuggestion(target) {
    const suggest = target.closest("[data-conv-suggest]");
    if (!suggest || !els.panel.contains(suggest)) return false;
    els.input.value = suggest.textContent.trim();
    els.input.focus();
    autosize();
    return true;
}

function clickHistoryTrigger(target, event) {
    const trigger = target.closest(".conv-history-trigger");
    if (!trigger) return false;
    event.preventDefault();
    openHistoryPop(trigger);
    return true;
}

function clickOpenConversation(target) {
    const openBtn = target.closest("[data-conv-open]");
    if (!openBtn) return false;
    const id = openBtn.dataset.convOpen;
    const fromPop = els.pop.contains(openBtn);
    closeHistoryPop();
    if (fromPop && document.body.classList.contains("mobile-search-open")) window.setMobileSearchExpanded?.(false);
    void openConversation({ id, trigger: fromPop ? ui.popTrigger : openBtn });
    return true;
}

function clickSize(target) {
    const sizeBtn = target.closest("[data-conv-size]");
    if (!sizeBtn || !(els.panel.contains(sizeBtn) || els.pip.contains(sizeBtn))) return false;
    const wanted = sizeBtn.dataset.convSize;
    setSize(wanted === "expand" ? expandedSize(ui.size) : wanted);
    return true;
}

function clickAction(target) {
    const actionBtn = target.closest("[data-conv-action]");
    if (!actionBtn) return false;
    handleAction(actionBtn.dataset.convAction, actionBtn);
    return true;
}

function clickMode(target) {
    const modeBtn = target.closest("[data-conv-mode]");
    if (!modeBtn || !els.menu.contains(modeBtn)) return false;
    ui.mode = modeBtn.dataset.convMode;
    savePref("mode", ui.mode);
    render();
    return true;
}

function clickWebSearch(target) {
    const toggle = target.closest("[data-conv-websearch]");
    if (!toggle || !els.menu.contains(toggle)) return false;
    window.ShelahPrefs?.set("webSearch", !webSearchOn());
    render();
    return true;
}

function clickTurnAction(target) {
    const turnBtn = target.closest("[data-turn-action]");
    if (!turnBtn || !els.messages.contains(turnBtn)) return false;
    if (turnBtn.dataset.turnAction === "check") void store.refresh();
    else void store.retry(turnBtn.dataset.messageId, { mode: currentMode(), language: lang() });
    return true;
}

function clickCitation(target, event) {
    const cite = target.closest("[data-cite-ref]");
    if (!cite || !els.messages.contains(cite)) return false;
    // Modified clicks keep the browser's own behaviour (new tab on /text/<ref>).
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return true;
    event.preventDefault();
    openCitation(cite.dataset.citeRef);
    return true;
}

const CLICK_HANDLERS = [
    clickSuggestion, clickHistoryTrigger, clickOpenConversation, clickSize,
    clickAction, clickMode, clickWebSearch, clickTurnAction, clickCitation,
];

function onDocumentClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    // A numbered source chip in an answer opens (or closes) its card; a click
    // anywhere else closes an open card.
    const mark = target.closest("[data-mark]");
    if (mark && els.messages.contains(mark)) {
        event.preventDefault();
        citePop.toggle(mark);
        return;
    }
    if (citePop.isOpen() && !citePop.contains(target)) citePop.close();

    closePopoversOutside(target);
    CLICK_HANDLERS.some((handle) => handle(target, event));
}

function handleAction(action, button) {
    switch (action) {
        case "new":
            closeHistoryPop();
            closeMenu();
            if (document.body.classList.contains("mobile-search-open")) window.setMobileSearchExpanded?.(false);
            void openConversation({ fresh: true, trigger: button });
            break;
        case "close":
            closePanel();
            break;
        case "home":
            // The sidebar's lockup: the panel closes, then the page goes home
            // (the page's own goHome would leave this panel covering it).
            closePanel();
            window.goHome?.();
            break;
        case "sign-in":
            closeHistoryPop();
            if (typeof window.handleSignIn === "function") void window.handleSignIn();
            break;
        case "guest-sign-in":
            signInFromGuestCap();
            break;
        case "guest-sign-up":
            signInFromGuestCap({ create: true });
            break;
        case "guest-cap-close":
            closeGuestCap();
            break;
        case "rename":
            beginRename();
            break;
        case "pin": {
            const conversation = store.getState().conversation;
            closeMenu();
            if (conversation) void store.setPinned(conversation.id, !conversation.pinnedAt);
            break;
        }
        case "share":
            closeMenu();
            // Already public: the header button asks first (see openSharePop).
            if (button === els.shareBtn && isShared(store.getState().conversation)) {
                if (ui.sharePopOpen) closeSharePop();
                else openSharePop();
            } else {
                void shareConversation();
            }
            break;
        case "share-copy":
            closeSharePop({ restoreFocus: true });
            void shareConversation();
            break;
        case "share-stop":
            closeSharePop({ restoreFocus: true });
            void stopSharing();
            break;
        case "stop-share":
            closeMenu();
            void stopSharing();
            break;
        case "delete":
            void deleteCurrent();
            break;
        case "reload-list":
            maybeLoadList(true);
            break;
        default:
            break;
    }
}

function onNoticeAction() {
    const action = els.noticeAction.dataset.action;
    if (action === "sign-in") {
        if (typeof window.handleSignIn === "function") void window.handleSignIn();
    } else if (action === "retry-open") {
        const id = readRoute().conversation;
        if (id && id !== "new") void store.open(id);
    } else if (action === "new") {
        store.startNew({ minhag: defaultMinhag() });
    }
    scheduleRender();
}

function onAuthChanged(event) {
    const signedIn = Boolean(event?.detail?.signedIn) && isSignedIn();
    const was = ui.signedIn;
    ui.signedIn = signedIn;
    if (!ui.authResolved) {
        ui.authResolved = true;
        resolveAuth();
    }
    if (signedIn && !was) {
        closeGuestCap();
        ui.listLoadedAt = 0;
        maybeLoadList(true);
        if (ui.awaitingOpenId) {
            const id = ui.awaitingOpenId;
            ui.awaitingOpenId = null;
            void store.open(id);
        }
    } else if (!signedIn && was) {
        // Signed out: never leave someone else's thread on screen.
        store.startNew({ minhag: defaultMinhag() });
        closePanel();
    }
    scheduleRender();
}

function syncTray() {
    if (!els.tray) return;
    const want = document.body.classList.contains("mobile-search-open") && effectiveLayout() === "mobile";
    const showing = !els.tray.classList.contains("hidden") && !els.tray.classList.contains("is-hiding");
    if (want && !showing) {
        hideTip();
        show(els.tray, "drawer");
    } else if (!want && showing) {
        if (ui.popTrigger === els.trayHistory) closeHistoryPop();
        hide(els.tray, "drawer");
    }
}

function relocalize() {
    document.querySelectorAll("[data-aria-en]").forEach((el) => {
        const label = lang() === "he" ? el.dataset.ariaHe : el.dataset.ariaEn;
        if (!label) return;
        el.setAttribute("aria-label", label);
        if (el.hasAttribute("title")) el.title = label;
    });
    ui.lastListRef = null;
    els.minhagSelect.dataset.key = "";
    applyAttributes();
    if (ui.tipAnchor) requestAnimationFrame(positionTip);
    scheduleRender();
}

function bindEvents() {
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("shelah:auth-changed", onAuthChanged);

    // The guest-limit dialog: a click on its backdrop dismisses it like Escape
    // does, and focus goes back to the box the question is waiting in.
    els.guestCap?.addEventListener("click", (event) => {
        if (event.target === els.guestCap) closeGuestCap();
    });
    els.guestCap?.addEventListener("close", () => {
        if (ui.open) els.input.focus({ preventScroll: true });
    });

    els.scrim.addEventListener("click", () => closePanel());
    els.menuBtn.addEventListener("click", () => openMenu(els.menuBtn));
    els.pipOpen.addEventListener("click", () => setSize("overlay"));
    els.jump.addEventListener("click", () => scrollToLatest(true));
    els.scroller.addEventListener("scroll", updateJumpButton, { passive: true });
    citePop = createCitationPopover({
        tr,
        lang,
        fetchPayload: fetchSourceText,
        previewHtml,
        openRef: openCitation,
        reducedMotion,
        bounds: () => els.scroller.getBoundingClientRect(),
    });
    // A card follows its chip as the text moves under it, and closes once the
    // chip has scrolled out of view. The hover preview is mouse-only: touch
    // has no hover, and tapping opens it.
    els.scroller.addEventListener("scroll", () => citePop.sync(), { passive: true });
    els.messages.addEventListener("pointerover", (event) => {
        if (event.pointerType !== "mouse") return;
        const mark = event.target.closest?.("[data-mark]");
        if (mark) citePop.hoverIn(mark);
    });
    els.messages.addEventListener("pointerout", (event) => {
        if (event.pointerType !== "mouse") return;
        if (event.target.closest?.("[data-mark]")) citePop.hoverOut();
    });
    els.noticeAction.addEventListener("click", onNoticeAction);
    els.toastAction.addEventListener("click", onToastAction);
    els.toastClose.addEventListener("click", () => {
        clearToast();
        scheduleRender();
    });
    for (const [enter, leave] of [["pointerenter", "pointerleave"], ["focusin", "focusout"]]) {
        els.toast.addEventListener(enter, pauseToast);
        els.toast.addEventListener(leave, armToastTimer);
    }
    els.minhagSelect.addEventListener("change", () => {
        ui.routeMinhag = null;
        store.setDraftMinhag(aiCommunityLens(els.minhagSelect.value));
        savePref("community", els.minhagSelect.value);
    });
    // A new community in the site settings reaches a thread not yet asked
    // (a locked thread keeps its own).
    onMinhagChange(() => {
        if (ui.routeMinhag) return;
        if (store.setDraftMinhag(defaultMinhag())) scheduleRender();
    });
    els.themeBtn?.addEventListener("click", () => {
        const dark = document.documentElement.dataset.theme === "dark";
        if (typeof window.setThemePreference === "function") window.setThemePreference(dark ? "light" : "dark");
    });
    // The theme can change from anywhere (the site's own settings, the system):
    // keep the button's label honest.
    new MutationObserver(syncThemeBtn).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    installVoice();

    els.composer.addEventListener("submit", (event) => {
        event.preventDefault();
        void submitComposer();
    });
    els.input.addEventListener("input", autosize);
    installComposerResize();
    els.input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            void submitComposer();
        }
    });

    els.topAsk?.addEventListener("click", onTopAsk);
    els.phoneAsk?.addEventListener("click", onPhoneAsk);
    els.tipTry?.addEventListener("click", tryFromTip);
    els.tipDismiss?.addEventListener("click", dismissTip);
    els.tip?.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.stopPropagation();
            dismissTip();
        }
    });
    // A source's text preview loads when it is opened (toggle doesn't bubble).
    els.messages.addEventListener("toggle", (event) => {
        if (event.target instanceof HTMLDetailsElement && event.target.dataset.previewRef) void loadPreview(event.target);
    }, true);

    els.trayAsk?.addEventListener("click", () => {
        const input = document.getElementById("searchInput");
        const question = input?.value.trim() || "";
        window.hideSearchSuggestions?.();
        window.setMobileSearchExpanded?.(false);
        if (input && question) input.value = "";
        void openConversation({ question, trigger: els.trayAsk });
    });

    const mq = window.matchMedia(MOBILE_QUERY);
    const onLayout = () => {
        const next = effectiveLayout();
        syncTray();
        if (ui.tipAnchor) {
            // The tip's anchor differs per layout: re-seat it.
            hideTip();
            maybeShowTip();
        }
        if (next === ui.layout) return;
        const previous = ui.layout;
        ui.layout = next;
        closeMenu();
        closeHistoryPop();
        if (!ui.open) {
            applyAttributes();
            return;
        }
        // Crossing the breakpoint: re-seat the panel for the new layout.
        if (previous === "mobile" && ui.size === "mini") hide(els.pip, "fade");
        els.panel.classList.add("hidden");
        applyVisibility({ opening: true });
        scheduleRender();
    };
    mq.addEventListener?.("change", onLayout);

    new MutationObserver(syncTray).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    new MutationObserver(relocalize).observe(document.documentElement, { attributes: true, attributeFilter: ["lang", "dir"] });
    window.addEventListener("resize", () => {
        if (!els.pop.classList.contains("hidden") && ui.popTrigger) positionPop(ui.popTrigger);
        citePop?.place();
        if (ui.tipAnchor) positionTip();
    }, { passive: true });

    watchTipBlockingMenus();
    installMiniDrag();
    installSheetSwipe();
}

// ── install ────────────────────────────────────────────────────────────

export function installConversationUI({ storeFactory = createConversationStore } = {}) {
    if (ui.installed) return window.ShelahConversationUI;
    els = collectElements();
    if (!els) return null;
    ui.installed = true;
    mini = els.sidebar && els.main
        ? createMiniWidget({
            panel: els.panel,
            sidebar: els.sidebar,
            main: els.main,
            historyBtn: els.historyBtn,
            corner: els.resizeCorner,
            edges: els.resizeEdges,
            isActive: isDesktopMini,
            reducedMotion,
        })
        : null;
    mini?.restoreSize();

    try {
        iconPaths = JSON.parse(document.getElementById("convIconPaths")?.textContent || "{}");
    } catch {
        iconPaths = {};
    }

    store = storeFactory({
        // Search-bar answers go through the one-shot /ask (ai-service.js).
        askAnswer: (question, options, extra) => {
            if (!window.ShelahModules?.askAi) throw new Error("AI module unavailable");
            return window.ShelahModules.askAi(question, { ...options, ...extra });
        },
        getPrefs: () => ({
            community: defaultMinhag(),
            mode: currentMode(),
            language: lang(),
        }),
    });
    store.subscribe(scheduleRender);
    shareControl = createConversationShare();
    shareControl.subscribe(scheduleRender);

    ui.layout = effectiveLayout();
    ui.signedIn = isSignedIn();
    // No Clerk on this deployment (e.g. local dev): nothing to wait for.
    if (!clerkConfigured() || ui.signedIn) {
        ui.authResolved = true;
        resolveAuth();
    }

    bindEvents();
    relocalize();
    syncTray();
    if (ui.signedIn) maybeLoadList(true);
    maybeShowTip();

    const api = {
        hydrate,
        open: openConversation,
        close: () => closePanel(),
        setSize,
        openHistory: (trigger) => openHistoryPop(trigger),
        openSettings,
        getStore: () => store,
        markAiUsed,
        askFromSearch,
        askSurface,
        // The search bar can no longer show the wait (the phone's search was
        // closed mid-question): open the panel on the pending answer.
        showPendingAnswer() {
            if (!ui.open && store.getState().sending) presentAnswer();
        },
        showAnswer: showStoredAnswer,
        showPublicConversation,
        showPublicLoading,
        showPublicUnavailable,
        showSavedLoading,
        showSavedUnavailable,
        isShowingAnswer: () => ui.open && Boolean(store.getState().answerView),
        // The community and AI mode for the URL (router.js AI keys).
        aiRoute: () => aiRoute(),
        // Back/Forward onto /answer/<id> for the answer still in the panel
        // (signed out, the server won't hand it back): reopen it as is.
        reopenAnswer(historyId) {
            const view = store.getState().answerView;
            if (!historyId || view?.historyId !== historyId) return false;
            if (!ui.open) presentAnswer();
            return true;
        },
    };
    window.ShelahConversationUI = api;
    return api;
}
