/**
 * Boots the real home page in jsdom (shell_page.js, without its classic
 * scripts) and installs static/js/conversation-ui.js on it, the way main.js
 * does in the browser. conversation-ui.js is an ES module, so it is loaded
 * through esm_harness.js with the page's window/document bound to it and to
 * every module it imports.
 *
 * Two things are faked on purpose:
 *   - time: setTimeout / requestAnimationFrame / performance.now run on a clock
 *     the test advances (`clock.tick(ms)`, `clock.frames()`), so the panel's
 *     timers (toast, discovery tip, status dwell) are exact and instant;
 *   - the conversation API: the store gets a recording fake instead of fetch
 *     (the store has its own tests), so a test says what the server answered.
 *
 * Everything else is real: the router writes the page's history, the share
 * state talks to the page's `fetch` routes, and the markup is `GET /`'s.
 */
'use strict';

const { openShellPage } = require('./shell_page');
const { loadEsmModule } = require('./esm_harness');

/** A manual clock: timers and animation frames run only when the test says so. */
function fakeClock() {
    let now = 0;
    let nextId = 1;
    const timers = new Map();
    let frames = [];
    const clock = {
        get now() { return now; },
        timers,
        setTimeout(fn, delay = 0, ...args) {
            const id = nextId++;
            timers.set(id, { at: now + Math.max(0, Number(delay) || 0), fn: () => fn(...args) });
            return id;
        },
        clearTimeout(id) { timers.delete(id); },
        requestAnimationFrame(fn) {
            const id = nextId++;
            frames.push([id, fn]);
            return id;
        },
        cancelAnimationFrame(id) { frames = frames.filter(([frameId]) => frameId !== id); },
        performance: { now: () => now },
        /** Run every animation frame queued so far (and any a frame queues). */
        runFrames(limit = 10) {
            for (let i = 0; i < limit && frames.length; i += 1) {
                const batch = frames;
                frames = [];
                for (const [, fn] of batch) fn(now);
            }
        },
        /** Advance time, running timers (and frames) that fall due, in order. */
        tick(ms = 0) {
            const end = now + ms;
            for (;;) {
                let next = null;
                for (const [id, timer] of timers) {
                    if (timer.at <= end && (!next || timer.at < next.timer.at)) next = { id, timer };
                }
                if (!next) break;
                timers.delete(next.id);
                now = Math.max(now, next.timer.at);
                next.timer.fn();
            }
            now = end;
            clock.runFrames();
        },
        pending: () => timers.size,
    };
    return clock;
}

/** A conversation-api stand-in; override any method per test. Records calls. */
function fakeConversationApi(overrides = {}) {
    const calls = [];
    const record = (name, fn) => async (...args) => {
        calls.push([name, ...args]);
        return fn(...args);
    };
    const api = {
        ERROR_CODES: { NETWORK: 'network', ANSWER_INCOMPLETE: 'answer_incomplete' },
        createConversation: record('create', async ({ minhag }) => ({ id: 'c1', title: '', minhag })),
        askInConversation: record('ask', async (id, { question }) => ({
            user_message: { id: 'u1', role: 'user', content: question, status: 'complete' },
            assistant_message: {
                id: 'a1',
                role: 'assistant',
                content: 'The answer [1].',
                status: 'complete',
                citations: [{ ordinal: 1, source_ref: 'Berakhot 2a', excerpt_en: 'From when', url: 'https://www.sefaria.org/Berakhot.2a' }],
            },
            conversation: { id, title: question, minhag: 'Sefardic' },
        })),
        getConversation: record('get', async (id) => ({ id, title: 'Saved chat', minhag: 'Ashkenaz', messages: [] })),
        listConversations: record('list', async () => []),
        renameConversation: record('rename', async (id, title) => ({ id, title, title_is_custom: true })),
        setConversationPinned: record('pin', async (id, pinned) => ({ id, pinned_at: pinned ? '2026-09-23T00:00:00Z' : null })),
        deleteConversation: record('delete', async () => ({ ok: true })),
        restoreConversation: record('restore', async (id) => ({ id, title: 'Restored', updated_at: '2026-09-10T00:00:00Z' })),
    };
    Object.assign(api, Object.fromEntries(Object.entries(overrides).map(([name, fn]) => [name, record(name, fn)])));
    api.calls = calls;
    return api;
}

const CONVERSATION_MODULE = 'static/js/conversation-ui.js';
const STORE_MODULE = 'static/js/conversation-store.js';

/**
 * @param {object} [options]
 * @param {boolean} [options.signedIn] Clerk is configured and has a session and user.
 * @param {boolean} [options.clerk] Clerk is configured but nobody is signed in.
 * @param {boolean} [options.mobile] The viewport matches (max-width: 1023px).
 * @param {'en'|'he'} [options.lang]
 * @param {object} [options.prefs] Overrides for window.appState.prefs (community, mode).
 * @param {object} [options.api] Overrides for fakeConversationApi().
 * @param {object} [options.fetch] shell_page route table, for everything but the store.
 * @param {string} [options.url]
 * @param {Record<string,string>} [options.storage]
 * @param {(window: Window, clock: object) => void} [options.before] Runs before the module loads.
 * @param {boolean} [options.install] Install the UI (default true).
 */
async function openConversationPage(options = {}) {
    const { signedIn = false, clerk = false, mobile = false, lang = 'en', api: apiOverrides = {}, install = true, before = null } = options;
    const clock = fakeClock();
    const page = await openShellPage({
        scripts: [],
        fetch: options.fetch || {},
        url: options.url,
        storage: options.storage,
        before(window) {
            window.setTimeout = clock.setTimeout;
            window.clearTimeout = clock.clearTimeout;
            window.requestAnimationFrame = clock.requestAnimationFrame;
            window.cancelAnimationFrame = clock.cancelAnimationFrame;
            // jsdom has no pointer capture, scrolling or layout.
            window.Element.prototype.setPointerCapture = function setPointerCapture() {};
            window.Element.prototype.releasePointerCapture = function releasePointerCapture() {};
            window.Element.prototype.scrollTo = function scrollTo(...args) { this.scrolledTo = args; };
            // jsdom has no layout: an element is "rendered" unless it, or an
            // ancestor, carries the `hidden` class or is a <dialog> that is not open.
            Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
                configurable: true,
                get() {
                    for (let node = this; node && node.nodeType === 1; node = node.parentElement) {
                        if (node.classList.contains('hidden')) return null;
                        if (node.localName === 'dialog' && !node.open) return null;
                    }
                    return this.isConnected ? this.parentElement : null;
                },
            });
            // The two Ask buttons are shown by breakpoint CSS (`hidden lg:flex`
            // and its phone twin), which jsdom does not apply.
            window.document.getElementById('topbarAskBtn')?.classList.toggle('hidden', mobile);
            window.document.getElementById('mobileTopbarAskBtn')?.classList.toggle('hidden', !mobile);
            // The visitor's saved preferences, as shell.js keeps them.
            window.appState = { prefs: { community: 'All', mode: 'balanced', ...options.prefs } };
            if (signedIn || clerk) window.APP_CLERK = { publishableKey: 'pk_test_example' };
            if (signedIn) window.Clerk = { session: { id: 'sess_1' }, user: { id: 'user_1' } };
            setDocumentLanguage(window, lang);
            if (before) before(window, clock);
        },
    });
    const { window, document } = page;
    if (mobile) page.media.set('(max-width: 1023px)', true);

    const globals = {
        window,
        document,
        navigator: window.navigator,
        localStorage: window.localStorage,
        sessionStorage: window.sessionStorage,
        location: window.location,
        history: window.history,
        fetch: window.fetch,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        requestAnimationFrame: clock.requestAnimationFrame,
        cancelAnimationFrame: clock.cancelAnimationFrame,
        performance: clock.performance,
        getComputedStyle: window.getComputedStyle.bind(window),
        CSS: { escape: (value) => String(value).replace(/[^\w-]/g, '\\$&') },
        Element: window.Element,
        HTMLElement: window.HTMLElement,
        HTMLDetailsElement: window.HTMLDetailsElement,
        Node: window.Node,
        MutationObserver: window.MutationObserver,
        ResizeObserver: window.ResizeObserver,
        DOMParser: window.DOMParser,
    };

    const ns = (await loadEsmModule(CONVERSATION_MODULE, globals)).namespace;
    const storeNs = (await loadEsmModule(STORE_MODULE, globals)).namespace;
    const api = fakeConversationApi(apiOverrides);
    const storeFactory = (storeOptions) => storeNs.createConversationStore({ ...storeOptions, api });

    const conversation = {
        ...page,
        clock,
        api,
        ns,
        storeNs,
        storeFactory,
        install: () => ns.installConversationUI({ storeFactory }),
        /** The installed public API (window.ShelahConversationUI). */
        get ui() { return window.ShelahConversationUI; },
        get store() { return window.ShelahConversationUI.getStore(); },
        /** Let queued renders, promises and zero-delay work finish. */
        async flush(rounds = 6) {
            for (let i = 0; i < rounds; i += 1) {
                await page.settle(4);
                clock.tick(0);
            }
        },
        /** Advance the fake clock, then let the promises it released finish. */
        async tick(ms) {
            clock.tick(ms);
            await conversation.flush(3);
        },
        text: (selector) => (document.querySelector(selector)?.textContent || '').replace(/\s+/g, ' ').trim(),
        hidden: (selector) => document.querySelector(selector).classList.contains('hidden'),
        /** Type into the composer and press Enter. */
        async ask(text) {
            const input = document.getElementById('convInput');
            input.value = text;
            input.dispatchEvent(new window.Event('input', { bubbles: true }));
            input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            await conversation.flush();
        },
        key(key, init = {}, target = document) {
            const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
            target.dispatchEvent(event);
            return event;
        },
        /** A pointer event (jsdom has PointerEvent only as a MouseEvent with extras). */
        pointer(target, type, init = {}) {
            const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
            Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 });
            Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'mouse' });
            target.dispatchEvent(event);
            return event;
        },
    };
    if (install) {
        conversation.install();
        await conversation.flush();
    }
    return conversation;
}

function setDocumentLanguage(window, lang) {
    window.document.documentElement.lang = lang;
    window.document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
}

module.exports = { openConversationPage, fakeClock, fakeConversationApi };
