/**
 * Boots the app's real home page in jsdom: the markup `GET /` renders
 * (tests_js/fixtures/index_page.txt, kept current by
 * tests/test_shell_dom_fixture.py) and the page's classic scripts from
 * static/js/ -- topbar_shared.js, hebrew-ref.js, community-labels.js,
 * load-region.js, shell.js, actions.js, clerk-appearance.js -- run in document
 * order in one window, exactly as the browser runs them.
 *
 * Why not esm_harness.js: shell.js is a classic script, not an ES module. Its
 * top-level const/let/function declarations are globals shared with every other
 * script, so the files are compiled with `vm.Script` into the window's context.
 * The file's own `file:` URL is the script name, which is what makes
 * `node --test --experimental-test-coverage` attribute the executed lines to
 * static/js/shell.js (no preamble is added, so offsets are the file's own).
 *
 * What is faked, because the real thing is the browser's or a CDN's:
 * `fetch` (routes the test declares; anything else is a 404 the test can see in
 * `page.calls`), `matchMedia`, the observers, `scrollTo`, `alert`/`confirm`/
 * `prompt`, marked and DOMPurify (CDN scripts). The ES modules main.js loads
 * (ShelahRouter, ShelahSiddur, ...) are not run: a test that needs one passes a
 * stand-in in `window` and says what it does.
 *
 * Usage:
 *   const page = await openShellPage({ fetch: { '/api/parasha': { name: 'Bereshit' } } });
 *   page.click('#themeToggleBtn');
 *   assert.equal(page.document.documentElement.classList.contains('dark'), true);
 *   page.close();
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { JSDOM, VirtualConsole } = require('jsdom');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATIC_JS = path.join(REPO_ROOT, 'static', 'js');
const FIXTURE_PATH = path.join(REPO_ROOT, 'tests_js', 'fixtures', 'index_page.txt');

// Document order in templates/index.html (topbar_shared.js and hebrew-ref.js are
// inline in the head there; the rest are deferred, shell.js before actions.js).
const PAGE_SCRIPTS = [
    'topbar_shared.js',
    'hebrew-ref.js',
    'community-labels.js',
    'load-region.js',
    'shell.js',
    'actions.js',
    'clerk-appearance.js',
];

let fixtureHtml = null;
function readFixture() {
    if (fixtureHtml === null) fixtureHtml = fs.readFileSync(FIXTURE_PATH, 'utf8');
    return fixtureHtml;
}

/** A Response-like object whose json() parses inside the window (same-realm arrays/objects). */
function makeResponse(window, status, body, headers) {
    const text = typeof body === 'string' ? body : JSON.stringify(body ?? {});
    const lowered = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const response = {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : String(status),
        url: '',
        headers: { get: (name) => lowered[String(name).toLowerCase()] ?? null, has: (name) => String(name).toLowerCase() in lowered },
        json: async () => window.JSON.parse(text),
        text: async () => text,
        blob: async () => new window.Blob([text]),
        clone: () => makeResponse(window, status, text, headers),
    };
    return response;
}

function matches(pattern, url) {
    if (pattern instanceof RegExp) return pattern.test(url);
    return url === pattern || url.split('?')[0] === pattern || url.startsWith(pattern);
}

/**
 * @param {object} [options]
 * @param {string} [options.url] The page URL (default https://shelah.org/).
 * @param {Record<string,string>} [options.storage] localStorage seeded before any script runs.
 * @param {Record<string,string>} [options.session] sessionStorage seed.
 * @param {Record<string|RegExp, any>|Array<[string|RegExp, any]>} [options.fetch]
 *   Route table. A value is the JSON body (200); a function is called with
 *   (url, init) and returns the body, or { status, body, headers }, or throws to reject.
 * @param {(window: Window) => void} [options.before] Runs after the stubs, before the first script.
 * @param {string[]} [options.scripts] Replaces the default script list.
 * @param {boolean} [options.dark] prefers-color-scheme: dark.
 */
async function openShellPage(options = {}) {
    const {
        url = 'https://shelah.org/',
        storage = {},
        session = {},
        fetch: routes = {},
        before = null,
        scripts = PAGE_SCRIPTS,
        dark = false,
    } = options;

    const errors = [];
    const consoleLog = { error: [], warn: [], log: [] };
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (error) => errors.push(error));
    virtualConsole.on('error', (...args) => consoleLog.error.push(args));
    virtualConsole.on('warn', (...args) => consoleLog.warn.push(args));
    virtualConsole.on('log', (...args) => consoleLog.log.push(args));

    const dom = new JSDOM(readFixture(), {
        url,
        runScripts: 'outside-only',
        pretendToBeVisual: true,
        virtualConsole,
    });
    const { window } = dom;
    const { document } = window;

    for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
    for (const [key, value] of Object.entries(session)) window.sessionStorage.setItem(key, value);

    // --- fetch -------------------------------------------------------------
    const table = Array.isArray(routes) ? routes : Object.entries(routes);
    const calls = [];
    window.fetch = async (input, init = {}) => {
        const target = typeof input === 'string' ? input : (input && input.url) || String(input);
        const relative = target.replace(window.location.origin, '');
        calls.push({ url: relative, init });
        const route = table.find(([pattern]) => matches(pattern, relative));
        if (!route) return makeResponse(window, 404, { error: 'unrouted' }, {});
        let result = route[1];
        if (typeof result === 'function') result = await result(relative, init);
        if (result && typeof result === 'object' && 'status' in result && 'body' in result) {
            return makeResponse(window, result.status, result.body, result.headers || {});
        }
        return makeResponse(window, 200, result, { 'content-type': 'application/json' });
    };

    // --- browser APIs jsdom does not implement -------------------------------
    const mediaState = { '(prefers-color-scheme: dark)': dark };
    const mediaListeners = new Set();
    window.matchMedia = (query) => ({
        get matches() { return Boolean(mediaState[query]); },
        media: query,
        addEventListener: (_type, fn) => mediaListeners.add(fn),
        removeEventListener: (_type, fn) => mediaListeners.delete(fn),
        addListener: (fn) => mediaListeners.add(fn),
        removeListener: (fn) => mediaListeners.delete(fn),
    });
    const observers = [];
    class FakeObserver {
        constructor(callback, observerOptions) {
            this.callback = callback;
            this.options = observerOptions;
            this.targets = new Set();
            observers.push(this);
        }
        observe(target) { this.targets.add(target); }
        unobserve(target) { this.targets.delete(target); }
        disconnect() { this.targets.clear(); }
        takeRecords() { return []; }
    }
    window.IntersectionObserver = class IntersectionObserver extends FakeObserver {};
    window.ResizeObserver = class ResizeObserver extends FakeObserver {};
    const scrolls = [];
    window.scrollTo = (...args) => scrolls.push(args);
    window.Element.prototype.scrollIntoView = function scrollIntoView(arg) { scrolls.push(['scrollIntoView', this, arg]); };
    window.requestIdleCallback = (fn) => window.setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 50 }), 0);
    window.cancelIdleCallback = (id) => window.clearTimeout(id);
    const dialogs = { alerts: [], confirms: [], prompts: [], confirmAnswer: true, promptAnswer: null };
    window.alert = (message) => dialogs.alerts.push(message);
    window.confirm = (message) => { dialogs.confirms.push(message); return dialogs.confirmAnswer; };
    window.prompt = (message) => { dialogs.prompts.push(message); return dialogs.promptAnswer; };
    // jsdom has no layout, so no innerText; shell.js reads and writes it as it would textContent.
    Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
        configurable: true,
        get() { return this.textContent; },
        set(value) { this.textContent = value; },
    });
    // <dialog>: jsdom parses it but has no showModal()/close().
    const dialogProto = window.HTMLDialogElement.prototype;
    dialogProto.show = function show() { this.setAttribute('open', ''); };
    dialogProto.showModal = dialogProto.show;
    dialogProto.close = function close() {
        if (!this.hasAttribute('open')) return;
        this.removeAttribute('open');
        this.dispatchEvent(new window.Event('close'));
    };
    const clipboard = [];
    Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text) => { clipboard.push(text); }, readText: async () => clipboard[clipboard.length - 1] ?? '' },
    });
    const objectUrls = [];
    window.URL.createObjectURL = (blob) => { objectUrls.push(blob); return `blob:test/${objectUrls.length}`; };
    window.URL.revokeObjectURL = () => {};
    // The CDN scripts the page loads in the head.
    window.marked = { parse: (text) => `<p>${String(text)}</p>`, parseInline: (text) => String(text) };
    window.DOMPurify = { sanitize: (html) => String(html) };

    if (before) before(window);

    // --- the page's scripts, in order --------------------------------------
    for (const name of scripts) {
        const file = path.join(STATIC_JS, name);
        const script = new vm.Script(fs.readFileSync(file, 'utf8'), { filename: pathToFileURL(file).href });
        script.runInContext(dom.getInternalVMContext());
    }

    const page = {
        dom,
        window,
        document,
        calls,
        errors,
        console: consoleLog,
        dialogs,
        clipboard,
        objectUrls,
        scrolls,
        observers,
        media: {
            set(query, value) {
                mediaState[query] = value;
                for (const fn of [...mediaListeners]) fn({ matches: value, media: query });
            },
        },

        /** Evaluate code in the page's global scope (sees shell.js's top-level const/let/function). */
        eval: (code) => window.eval(code),
        /** Call a global function of the page by name with arguments from the test. */
        call: (name, ...args) => window.eval(name)(...args),
        $: (selector) => document.querySelector(selector),
        $$: (selector) => [...document.querySelectorAll(selector)],
        el(target) {
            const found = typeof target === 'string' ? document.querySelector(target) : target;
            if (!found) throw new Error(`shell_page: no element for ${String(target)}`);
            return found;
        },
        click(target, init = {}) {
            const element = page.el(target);
            element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
            return element;
        },
        /** Set an input's value and fire `input` (and `change` when asked). */
        type(target, value, { change = false } = {}) {
            const element = page.el(target);
            element.value = value;
            element.dispatchEvent(new window.Event('input', { bubbles: true }));
            if (change) element.dispatchEvent(new window.Event('change', { bubbles: true }));
            return element;
        },
        key(target, key, init = {}) {
            const element = page.el(target);
            element.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
            return element;
        },
        /** Let promises and zero-delay timers run: enough for a fetch -> render chain. */
        async settle(rounds = 8) {
            for (let i = 0; i < rounds; i += 1) {
                await new Promise((resolve) => setImmediate(resolve));
            }
        },
        /** Requests made since the last call (and clears the list). */
        takeCalls() {
            return calls.splice(0, calls.length);
        },
        close() {
            window.close();
        },
    };
    await page.settle();
    return page;
}

module.exports = { openShellPage, PAGE_SCRIPTS };
