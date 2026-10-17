/**
 * scripts/build_critical_css.mjs: the extraction of the first-paint CSS and the
 * check that it paints what the whole bundle paints. The in-page functions run
 * against a jsdom document (called directly, so the script's own coverage
 * counts them); the browser and the server are fakes, so no Chrome or uvicorn
 * is needed. A temp tree stands in for the repo (SHELAH_ASSETS_ROOT).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'build_critical_css.mjs');

let ROOT;
let mod;

// The "python" the server starter runs: a script that starts a small node server
// on the port it is given, after a delay so the starter's retry is exercised.
const FAKE_SERVER = `
const http = require('node:http');
const i = process.argv.indexOf('--port');
const port = Number(process.argv[i + 1]);
const body = JSON.stringify({
    args: process.argv.slice(2),
    cwd: process.cwd(),
    source: process.env.SHELAH_SOURCE_ASSETS ?? null,
    ratelimit: process.env.RATELIMIT_ENABLED ?? null,
});
setTimeout(() => http.createServer((req, res) => res.end(body)).listen(port, '127.0.0.1'), 700);
`;

test.before(async () => {
    ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'shelah-critical-'));
    fs.mkdirSync(path.join(ROOT, '.venv', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'fake_server.js'), FAKE_SERVER);
    const python = path.join(ROOT, '.venv', 'bin', 'python');
    fs.writeFileSync(python, `#!/bin/sh\nexec "${process.execPath}" "${path.join(ROOT, 'fake_server.js')}" "$@"\n`);
    fs.chmodSync(python, 0o755);
    process.env.SHELAH_ASSETS_ROOT = ROOT;
    process.env.SHELAH_SETTLE_MS = '0';
    mod = await import(pathToFileURL(SCRIPT).href);
});

test.after(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
});

// ─── A document for the in-page functions ────────────────────────────────────

/**
 * Installs a jsdom document as the globals the in-page functions read, and
 * returns what they need to be driven. `sheets` are [href, css] pairs (an
 * `unreadable` href gets a stylesheet whose rules cannot be read); an element
 * with no layout box is one that is, or sits inside, a `display: none` element.
 */
function withDocument(body, sheets, run) {
    const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`);
    const { window } = dom;
    const wrapped = [];
    for (const [href, css] of sheets) {
        if (css === 'unreadable') {
            wrapped.push({ href, get cssRules() { throw new Error('SecurityError'); } });
            continue;
        }
        const style = window.document.createElement('style');
        style.textContent = css;
        window.document.head.append(style);
        wrapped.push({ href, cssRules: style.sheet.cssRules });
    }
    const hidden = (el) => {
        for (let node = el; node && node.nodeType === 1; node = node.parentNode) {
            if (window.getComputedStyle(node).display === 'none') return true;
        }
        return false;
    };
    window.Element.prototype.getClientRects = function getClientRects() {
        return hidden(this) ? [] : [{}];
    };
    const animations = [];
    const pseudo = {};
    const fakeDocument = {
        documentElement: window.document.documentElement,
        querySelectorAll: (selector) => window.document.querySelectorAll(selector),
        styleSheets: wrapped,
        getAnimations: () => animations,
    };
    const saved = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle };
    globalThis.document = fakeDocument;
    globalThis.getComputedStyle = (el, which) => {
        if (!which) return window.getComputedStyle(el);
        const content = pseudo[`${el.id}${which}`];
        return { content, getPropertyValue: (prop) => (prop === 'content' ? content : '') };
    };
    const restore = () => {
        globalThis.document = saved.document;
        globalThis.getComputedStyle = saved.getComputedStyle;
        window.close();
    };
    let result;
    try {
        result = run({ window, animations, pseudo });
    } catch (error) {
        restore();
        throw error;
    }
    if (result && typeof result.then === 'function') return result.finally(restore);
    restore();
    return result;
}

const SHEET = '/static/css/layout.css';

// ─── pageKeepRules ───────────────────────────────────────────────────────────

test('a rule is kept when its selector matches something drawn; the path is its position in the sheet', () => {
    const css = '.a{color:red}.nope{color:blue}.b{margin:0}';
    withDocument('<div class="a"><span class="b"></span></div>', [[`http://x${SHEET}`, css]], () => {
        assert.deepEqual(mod.pageKeepRules(), { [SHEET]: ['/0', '/2'] });
    });
});

test('only the page\'s own stylesheets count; an unreadable one or one with no address is skipped', () => {
    withDocument('<p class="a"></p>', [
        ['http://x/static/css/ok-name.css', '.a{color:red}'],
        ['http://x/static/style.css', '.a{color:red}'],
        ['http://x/static/vendor/lib.css', '.a{color:red}'],
        ['http://x/static/css/deep/nested.css', '.a{color:red}'],
        [null, '.a{color:red}'],
        ['http://x/static/css/blocked.css', 'unreadable'],
    ], () => {
        assert.deepEqual(mod.pageKeepRules(), {
            '/static/css/ok-name.css': ['/0'],
            '/static/style.css': ['/0'],
        });
    });
});

test('a rule that only matters in a state a visitor is not in at first paint is dropped', () => {
    const css = '.a:hover{color:red}.a:focus-visible{color:red}.a:checked{color:red}.a:not(.z){margin:0}.a:first-child{margin:1px}';
    withDocument('<p class="a"></p>', [[`http://x${SHEET}`, css]], () => {
        assert.deepEqual(mod.pageKeepRules(), { [SHEET]: ['/3', '/4'] });
    });
});

test('a selector with a pseudo-element is judged by the element it belongs to', () => {
    const css = '.a::before{content:"x"}.nope::after{content:"y"}::selection{color:red}.a::-webkit-scrollbar{width:0}';
    withDocument('<p class="a"></p>', [[`http://x${SHEET}`, css]], () => {
        // ::selection alone is "*": the root matches it. A -webkit- pseudo-element reads as a
        // -webkit- state to the state filter, so it waits for the bundle with the hover rules.
        assert.deepEqual(mod.pageKeepRules(), { [SHEET]: ['/0', '/2'] });
    });
});

test('a selector list is kept when any of its parts is used; commas inside brackets do not split it', () => {
    const css = '.nope,.a{color:red}.nope,.also-nope{color:blue}:is(.nope,.a){margin:0}[data-x="a,b"]{padding:0}';
    withDocument('<p class="a" data-x="a,b"></p>', [[`http://x${SHEET}`, css]], () => {
        assert.deepEqual(mod.pageKeepRules(), { [SHEET]: ['/0', '/2', '/3'] });
    });
});

test('a selector this browser cannot test is kept rather than lost', () => {
    withDocument('<p class="a"></p>', [[`http://x${SHEET}`, '.a:not-a-real-pseudo-class{color:red}.nope{color:red}']], () => {
        assert.deepEqual(mod.pageKeepRules(), { [SHEET]: ['/0'] });
    });
});

test('what is hidden is critical only down to the element that hides it', () => {
    const css = '.gone{display:none}.inside{color:red}.a{color:blue}';
    withDocument('<div class="a"><div class="gone"><span class="inside"></span></div></div>', [[`http://x${SHEET}`, css]], () => {
        assert.deepEqual(mod.pageKeepRules(), { [SHEET]: ['/0', '/2'] });
    });
});

test('display: contents elements count as drawn even with no box', () => {
    const css = '.wrap{display:contents}.child{color:red}';
    withDocument('<div class="wrap"><span class="child"></span></div>', [[`http://x${SHEET}`, css]], ({ window }) => {
        window.Element.prototype.getClientRects = function getClientRects() {
            return this.classList.contains('wrap') ? [] : [{}];
        };
        assert.deepEqual(mod.pageKeepRules(), { [SHEET]: ['/0', '/1'] });
    });
});

test('at-rules: font faces and layer statements are always kept; grouping rules when something inside is; print and keyframes never', () => {
    const css = [
        '@font-face{font-family:x;src:url(a.woff)}',
        '@media (min-width:600px){.a{color:green}.nope{color:red}}',
        '@media (min-width:900px){.nope{color:red}}',
        '@media print{.a{color:black}}',
        '@supports (display:grid){.a{display:grid}}',
        '@keyframes spin{from{opacity:0}to{opacity:1}}',
        '@layer base{.a{margin:0}}',
        '@layer empty{.nope{margin:0}}',
        '@media (min-width:100px){@supports (display:grid){.a{gap:1px}}}',
    ].join('\n');
    withDocument('<p class="a"></p>', [[`http://x${SHEET}`, css]], () => {
        const kept = mod.pageKeepRules()[SHEET];
        // Inner rules come before the group that holds them.
        assert.deepEqual(kept, ['/0', '/1/0', '/1', '/4/0', '/4', '/6/0', '/6', '/8/0/0', '/8/0', '/8']);
    });
});

// ─── pageSerialize ───────────────────────────────────────────────────────────

test('the kept rules are written out sheet by sheet in document order, groups with their at-rule head', () => {
    const first = '.a{color:red}.drop{color:blue}@media (min-width:600px){.a{margin:0}.drop{x:y}}';
    const second = '@supports (display:grid){.a{display:grid}}@layer base{.a{gap:1px}}.b{padding:0}';
    withDocument('<p class="a"></p>', [[`http://x${SHEET}`, first], ['http://x/static/style.css', second], ['http://x/static/css/skipped.css', '.a{z:1}']], () => {
        const { text, order, keyframes } = mod.pageSerialize({
            '/static/style.css': ['/0/0', '/0', '/1/0', '/1'],
            [SHEET]: ['/0', '/2/0', '/2'],
        });
        assert.deepEqual(order, [SHEET, '/static/style.css']);
        assert.deepEqual(keyframes, []);
        assert.match(text, /^\n\/\* \/static\/css\/layout\.css \*\/\n/);
        assert.match(text, /\.a \{ color: red; \}/);
        assert.doesNotMatch(text, /drop|\.b|skipped/);
        assert.match(text, /@media \(min-width:600px\)\{\s*\.a \{ margin: 0px; \}\s*\}/);
        assert.match(text, /\/\* \/static\/style\.css \*\/\n@supports \(display:grid\)\{\s*\.a \{ display: grid; \}\s*\}@layer base\{\s*\.a \{ gap: 1px; \}\s*\}/);
    });
});

test('a grouping rule with no known head is written as its body; unreadable sheets are skipped', () => {
    withDocument('<p class="a"></p>', [[`http://x${SHEET}`, '.a{color:red}'], ['http://x/static/css/blocked.css', 'unreadable']], () => {
        const sheet = globalThis.document.styleSheets[0];
        const group = { constructor: { name: 'CSSScopeRule' }, cssRules: sheet.cssRules, cssText: '@scope{}' };
        globalThis.document.styleSheets[0] = { href: sheet.href, cssRules: [group] };
        const { text, order } = mod.pageSerialize({ [SHEET]: ['/0', '/0/0'], '/static/css/blocked.css': ['/0'] });
        assert.match(text, /\.a \{ color: red; \}/);
        assert.doesNotMatch(text, /@scope/);
        assert.deepEqual(order, [SHEET, '/static/css/blocked.css']);
    });
});

test('every keyframes block is reported, kept or not, for the caller to decide', () => {
    withDocument('<p class="a"></p>', [[`http://x${SHEET}`, '.a{animation:spin 1s}@keyframes spin{from{opacity:0}to{opacity:1}}@keyframes fade{from{opacity:1}to{opacity:0}}']], () => {
        const { keyframes } = mod.pageSerialize({ [SHEET]: ['/0'] });
        assert.deepEqual(keyframes.map(([name]) => name), ['spin', 'fade']);
        assert.match(keyframes[0][1], /^@keyframes spin/);
    });
});

test('a container rule is written with its name and query', () => {
    withDocument('<p></p>', [[`http://x${SHEET}`, '.a{x:y}']], () => {
        const rule = { constructor: { name: 'CSSContainerRule' }, containerName: 'card', containerQuery: '(min-width: 400px)', cssRules: [{ constructor: { name: 'CSSStyleRule' }, cssText: '.b{c:d}' }] };
        globalThis.document.styleSheets[0] = { href: `http://x${SHEET}`, cssRules: [rule] };
        const { text } = mod.pageSerialize({ [SHEET]: ['/0', '/0/0'] });
        assert.match(text, /@container card \(min-width: 400px\)\{\.b\{c:d\}\}/);
    });
});

// ─── pageSignature ───────────────────────────────────────────────────────────

test('the signature has one entry per drawn element, keyed by its path, with the compared properties joined', () => {
    withDocument('<div id="main"><p class="a">x</p><p class="gone">y</p></div>', [['http://x/static/css/s.css', '.a{color:red}.gone{display:none}']], () => {
        const sig = mod.pageSignature(['color', 'display']);
        const keys = Object.keys(sig);
        assert.ok(keys.includes('body:1'), keys.join(','));
        assert.ok(keys.includes('body:1>div#main:0'));
        assert.ok(keys.includes('body:1>div#main:0>p:0'));
        assert.equal(keys.some((key) => key.endsWith('p:1')), false, 'a hidden element has no entry');
        assert.equal(keys.includes(''), true, 'the root is always there');
        assert.equal(sig['body:1>div#main:0>p:0'], 'rgb(255, 0, 0)|block');
    });
});

test('a pseudo-element with content is a signature entry of its own', () => {
    withDocument('<div id="main"></div>', [], ({ pseudo }) => {
        pseudo['main::before'] = '"x"';
        pseudo['main::after'] = 'none';
        const sig = mod.pageSignature(['content']);
        assert.equal(sig['body:1>div#main:0::before'], '"x"');
        assert.equal('body:1>div#main:0::after' in sig, false);
    });
});

test('running animations are paused at their start so two loads compare the same frame', () => {
    withDocument('<p></p>', [], ({ animations }) => {
        const calls = [];
        animations.push(
            { pause: () => calls.push('pause'), set currentTime(value) { calls.push(['time', value]); } },
            { pause: () => { throw new Error('not pausable'); } },
        );
        mod.pageSignature(['color']);
        assert.deepEqual(calls, ['pause', ['time', 0]]);
    });
});

// ─── Small helpers ───────────────────────────────────────────────────────────

test('arg reads the value after a flag, or null', () => {
    assert.equal(mod.arg('--base-url', ['node', 'x', '--base-url', 'http://a']), 'http://a');
    assert.equal(mod.arg('--base-url', ['node', 'x']), null);
    assert.equal(mod.arg('--base-url', ['node', 'x', '--base-url']), undefined);
});

test('cellsFor is every width x theme x language x signed-in state', () => {
    const cells = mod.cellsFor({ widths: [375, 1280] });
    assert.equal(cells.length, 2 * 2 * 2 * 2);
    assert.deepEqual(cells[0], { w: 375, theme: 'light', lang: 'en', auth: false });
    assert.deepEqual(cells.at(-1), { w: 1280, theme: 'dark', lang: 'he', auth: true });
    const signedOut = mod.cellsFor({ widths: [375] }, false);
    assert.equal(signedOut.length, 4);
    assert.equal(signedOut.some((cell) => cell.auth), false);
});

test('the kinds of page cover the home page, the text pages and the other deep links', () => {
    assert.deepEqual(Object.keys(mod.KINDS), ['home', 'text', 'app']);
    for (const routes of Object.values(mod.KINDS)) {
        for (const [route, matrix] of routes) {
            assert.match(route, /^\//);
            assert.ok(matrix.widths.length >= 2);
        }
    }
});

test('pool runs the tasks n at a time and returns their results in order', async () => {
    let running = 0;
    let peak = 0;
    const tasks = Array.from({ length: 9 }, (_, index) => async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5 * ((index % 3) + 1)));
        running -= 1;
        return index * 2;
    });
    assert.deepEqual(await mod.pool(tasks, 4), [0, 2, 4, 6, 8, 10, 12, 14, 16]);
    assert.equal(peak, 4);
    assert.deepEqual(await mod.pool([], 4), []);
    assert.deepEqual(await mod.pool([async () => 'only'], 4), ['only']);
});

test('a keyframes block is added once, when the kept CSS names it', () => {
    const keyframes = [
        ['spin', '@keyframes spin{to{opacity:1}}'],
        ['spin', '@keyframes spin{to{opacity:0}}'],
        ['fade', '@keyframes fade{to{opacity:0}}'],
    ];
    assert.equal(mod.withKeyframes('.a{animation:spin 1s}', keyframes), '.a{animation:spin 1s}@keyframes spin{to{opacity:1}}');
    assert.equal(mod.withKeyframes('.a{color:red}', keyframes), '.a{color:red}');
    assert.equal(mod.withKeyframes('.a{}', []), '.a{}');
});

test('the compared properties have no duplicates and the verification widths differ from the extraction ones', () => {
    assert.equal(new Set(mod.COMPARED).size, mod.COMPARED.length);
    const extracted = new Set(Object.values(mod.KINDS).flat().flatMap(([, matrix]) => matrix.widths));
    for (const width of mod.VERIFY_WIDTHS) assert.equal(extracted.has(width), false, String(width));
});

test('chromePath is the CHROME_PATH override, else Chrome on a Mac if installed, else nothing', () => {
    const saved = process.env.CHROME_PATH;
    try {
        process.env.CHROME_PATH = '/opt/chrome';
        assert.equal(mod.chromePath(), '/opt/chrome');
        delete process.env.CHROME_PATH;
        const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        assert.equal(mod.chromePath(), fs.existsSync(mac) ? mac : undefined);
    } finally {
        if (saved === undefined) delete process.env.CHROME_PATH;
        else process.env.CHROME_PATH = saved;
    }
});

test('freePort hands back a port nothing is listening on', async () => {
    const port = await mod.freePort();
    assert.ok(Number.isInteger(port) && port > 0);
    await new Promise((resolve, reject) => {
        const server = http.createServer();
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => server.close(resolve));
    });
});

test('startServer waits for the server to answer, passes it the flags, and stop ends it', async () => {
    const { base, stop } = await mod.startServer({ SHELAH_SOURCE_ASSETS: '1' });
    try {
        assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
        const seen = await (await fetch(`${base}/`)).json();
        assert.equal(seen.source, '1');
        assert.equal(seen.ratelimit, 'false');
        assert.equal(fs.realpathSync(seen.cwd), fs.realpathSync(ROOT));
        assert.deepEqual(seen.args.slice(0, 3), ['-m', 'uvicorn', 'asgi:app']);
        assert.ok(seen.args.includes('--log-level'));
    } finally {
        stop();
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    await assert.rejects(fetch(`${base}/`));
});

test('startServer gives up when nothing answers', async () => {
    // Nothing listens on the port the starter picked: the fake server only comes up after 700 ms.
    await assert.rejects(mod.startServer({}, { attempts: 3, waitMs: 5 }), /the server did not start/);
});

// ─── A fake browser ──────────────────────────────────────────────────────────

/**
 * Stands in for a puppeteer browser. `onEvaluate(fn, args, page)` answers the
 * page's evaluate calls; `requests` are what a page asks for as it loads.
 */
function fakeBrowser({ onEvaluate = (fn, args) => fn(...args), requests = [], failGoto = false } = {}) {
    const log = { pages: [], closedContexts: 0, closed: false };
    return {
        log,
        createBrowserContext: async () => ({
            close: async () => { log.closedContexts += 1; },
            newPage: async () => {
                const page = {
                    viewport: null,
                    initScripts: [],
                    dispositions: [],
                    handlers: [],
                    interception: false,
                    bundleBlocked: false,
                    setViewport: async (value) => { page.viewport = value; },
                    evaluateOnNewDocument: async (fn, ...args) => { page.initScripts.push([fn, args]); },
                    setRequestInterception: async (value) => { page.interception = value; },
                    on: (event, handler) => { if (event === 'request') page.handlers.push(handler); },
                    goto: async (url, options) => {
                        if (failGoto) throw new Error('net::ERR_CONNECTION_REFUSED');
                        page.url = url;
                        page.gotoOptions = options;
                        for (const requestUrl of requests) {
                            for (const handler of page.handlers) {
                                handler({
                                    url: () => requestUrl,
                                    abort: () => page.dispositions.push([requestUrl, 'abort']),
                                    continue: () => page.dispositions.push([requestUrl, 'continue']),
                                    respond: (response) => {
                                        page.dispositions.push([requestUrl, 'respond', response]);
                                        if (/app\.css/.test(requestUrl)) page.bundleBlocked = true;
                                    },
                                });
                            }
                        }
                    },
                    evaluate: async (fn, ...args) => onEvaluate(fn, args, page),
                };
                log.pages.push(page);
                return page;
            },
        }),
        close: async () => { log.closed = true; },
    };
}

const CELL = { w: 375, theme: 'dark', lang: 'he', auth: true };
const BASE = 'http://127.0.0.1:9999';

// ─── openPage ────────────────────────────────────────────────────────────────

test('openPage sets the viewport, seeds the visitor\'s preferences, and opens the route', async () => {
    const browser = fakeBrowser();
    const { page, close } = await mod.openPage(browser, BASE, '/text/Genesis.1', CELL, { blockScripts: true });
    assert.deepEqual(page.viewport, { width: 375, height: 800, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    assert.equal(page.url, `${BASE}/text/Genesis.1`);
    assert.deepEqual(page.gotoOptions, { waitUntil: 'load' });
    assert.equal(page.interception, true);

    const stored = {};
    const fakeDocument = { cookie: '' };
    const saved = { localStorage: globalThis.localStorage, document: globalThis.document };
    globalThis.localStorage = { setItem: (key, value) => { stored[key] = value; } };
    globalThis.document = fakeDocument;
    try {
        const [[init, args]] = page.initScripts;
        init(...args);
    } finally {
        globalThis.localStorage = saved.localStorage;
        globalThis.document = saved.document;
    }
    assert.deepEqual(stored, {
        "Sh'elahPrefs": JSON.stringify({ theme: 'dark' }),
        preferredLanguage: 'he',
        "Sh'elahLanguageManuallySet": '1',
    });
    assert.equal(fakeDocument.cookie, '__client_uat=1700000000; path=/');

    await close();
    assert.equal(browser.log.closedContexts, 1);
});

test('openPage: a wide signed-out visitor is not a phone and has no session cookie', async () => {
    const browser = fakeBrowser();
    const { page } = await mod.openPage(browser, BASE, '/', { w: 1280, theme: 'light', lang: 'en', auth: false }, { blockScripts: false });
    assert.deepEqual(page.viewport, { width: 1280, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    const fakeDocument = { cookie: '' };
    const saved = { localStorage: globalThis.localStorage, document: globalThis.document };
    globalThis.localStorage = { setItem() {} };
    globalThis.document = fakeDocument;
    try {
        const [[init, args]] = page.initScripts;
        init(...args);
    } finally {
        globalThis.localStorage = saved.localStorage;
        globalThis.document = saved.document;
    }
    assert.equal(fakeDocument.cookie, '');
});

test('openPage keeps third-party requests out, and the page\'s scripts when asked', async () => {
    const requests = [
        'https://cdn.jsdelivr.net/npm/x.js',
        'https://browser.sentry-cdn.com/a.js',
        'https://clerk.shelah.org/v1',
        'https://va.vercel-scripts.com/_vercel/insights',
        'https://fonts.googleapis.com/css',
        'https://fonts.gstatic.com/s/a.woff2',
        'https://challenges.cloudflare.com/x',
        `${BASE}/static/js/main.js`,
        `${BASE}/static/min/js/main.js`,
        `${BASE}/static/css/layout.css`,
        `${BASE}/`,
    ];
    const blocked = fakeBrowser({ requests });
    const { page } = await mod.openPage(blocked, BASE, '/', CELL, { blockScripts: true });
    assert.deepEqual(page.dispositions.map(([, what]) => what), [
        'abort', 'abort', 'abort', 'abort', 'abort', 'abort', 'abort', 'abort', 'abort', 'continue', 'continue',
    ]);

    const open = fakeBrowser({ requests });
    const { page: other } = await mod.openPage(open, BASE, '/', CELL, { blockScripts: false });
    assert.deepEqual(other.dispositions.filter(([url]) => url.includes('/static/')).map(([, what]) => what), ['continue', 'continue', 'continue']);
});

test('openPage lets the caller answer a request itself', async () => {
    const seen = [];
    const browser = fakeBrowser({ requests: [`${BASE}/static/min/css/app.css`, `${BASE}/other`] });
    const { page } = await mod.openPage(browser, BASE, '/', CELL, {
        blockScripts: true,
        onRequest: (req) => {
            seen.push(req.url());
            if (!/app\.css/.test(req.url())) return false;
            req.respond({ status: 200, body: '' });
            return true;
        },
    });
    assert.deepEqual(seen, [`${BASE}/static/min/css/app.css`, `${BASE}/other`]);
    assert.deepEqual(page.dispositions.map(([, what]) => what), ['respond', 'continue']);
});

// ─── collectKept / extractKind ───────────────────────────────────────────────

const PAGE_CSS = [
    '@font-face{font-family:x;src:url(a.woff)}',
    '.a{color:red;animation:spin 1s}',
    '.nope{color:blue}',
    '@media (min-width:600px){.a{margin:0}}',
    '@keyframes spin{from{opacity:0}to{opacity:1}}',
    '@keyframes unused{from{opacity:0}to{opacity:1}}',
].join('\n');

test('collectKept unions what every route and cell of a kind keeps', async () => {
    const answers = [];
    const browser = fakeBrowser({
        onEvaluate: (fn, args, page) => {
            assert.equal(fn, mod.pageKeepRules);
            assert.deepEqual(args, []);
            answers.push(page.viewport.width);
            // Narrow pages keep rule 1; wide ones also keep rule 3 and a second sheet.
            return page.viewport.width < 600
                ? { [SHEET]: ['/1'] }
                : { [SHEET]: ['/1', '/3'], '/static/style.css': ['/0'] };
        },
    });
    const union = await mod.collectKept(browser, BASE, 'text');
    assert.deepEqual(Object.keys(union).sort(), [SHEET, '/static/style.css']);
    assert.deepEqual([...union[SHEET]].sort(), ['/1', '/3']);
    assert.deepEqual([...union['/static/style.css']], ['/0']);
    // Every cell of both routes was visited, and every page was closed.
    const cells = mod.KINDS.text.reduce((n, [, matrix]) => n + mod.cellsFor(matrix).length, 0);
    assert.equal(answers.length, cells);
    assert.equal(browser.log.closedContexts, cells);
});

test('extractKind writes the kept rules as minified CSS with the keyframes they name', async () => {
    await withDocument('<p class="a"></p>', [[`http://x${SHEET}`, PAGE_CSS]], async () => {
        const browser = fakeBrowser({ onEvaluate: (fn, args) => fn(...args) });
        const result = await mod.extractKind(browser, BASE, 'home');
        assert.deepEqual(result.order, [SHEET]);
        assert.deepEqual(result.routes, ['/']);
        assert.match(result.code, /@font-face\{[^}]*font-family:x/);
        assert.match(result.code, /\.a\{color:red;animation:spin 1s\}/);
        assert.match(result.code, /@media ?\(min-width: ?600px\)\{\.a\{margin:0\}\}/);
        assert.match(result.code, /@keyframes spin\{/);
        assert.doesNotMatch(result.code, /nope|unused/);
        assert.equal(/\n/.test(result.code.trim()), false);
    });
});

test('extractKind lists every route of the kind', async () => {
    await withDocument('<p class="a"></p>', [[`http://x${SHEET}`, PAGE_CSS]], async () => {
        const result = await mod.extractKind(fakeBrowser(), BASE, 'app');
        assert.deepEqual(result.routes, mod.KINDS.app.map(([route]) => route));
    });
});

test('extractKind refuses CSS that could end an inline <style> early', async () => {
    await withDocument('<p class="a"></p>', [[`http://x${SHEET}`, '.a{--v: </style>}']], async () => {
        await assert.rejects(mod.extractKind(fakeBrowser(), BASE, 'home'), /critical CSS contains '<\/style'/);
    });
});

// ─── verifyKind ──────────────────────────────────────────────────────────────

const SIGNED_OUT = 6 * 2 * 2;
const SIGNED_IN = 2 * 2 * 2;

function signatureBrowser(sigFor) {
    return fakeBrowser({
        requests: [`${BASE}/static/min/css/app.css`],
        onEvaluate: (fn, args, page) => {
            assert.equal(fn, mod.pageSignature);
            assert.equal(args[0], mod.COMPARED);
            return sigFor(page.viewport.width, !page.bundleBlocked);
        },
    });
}

test('verifyKind finds identical cells when the first paint equals the full page', async () => {
    const browser = signatureBrowser(() => ({ 'body:1': 'a|b', 'body:1>p:0': 'c|d' }));
    const result = await mod.verifyKind(browser, BASE, 'home');
    assert.deepEqual(result, { bad: 0, cells: SIGNED_OUT + SIGNED_IN });
    // Each cell is loaded twice, once with the bundle answered with nothing.
    const respondedEmpty = browser.log.pages.filter((page) => page.bundleBlocked);
    assert.equal(respondedEmpty.length, SIGNED_OUT + SIGNED_IN);
    const [, , response] = respondedEmpty[0].dispositions.find(([, what]) => what === 'respond');
    assert.deepEqual(response, { status: 200, contentType: 'text/css', body: '' });
});

test('verifyKind reports each cell whose elements differ, with the properties that do', async () => {
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
        const props = mod.COMPARED;
        const row = (color) => props.map((p) => (p === 'color' ? color : 'x')).join('|');
        const browser = signatureBrowser((width, bundle) => ({
            'html>body:1': row('red'),
            'html>body:1>main:0': width === 1100 && !bundle ? row('blue') : row('red'),
            ...(width === 1100 && !bundle ? { 'html>body:1>extra:1': row('red') } : {}),
        }));
        const result = await mod.verifyKind(browser, BASE, 'text');
        assert.equal(result.cells, SIGNED_OUT + SIGNED_IN);
        assert.equal(result.bad, 4, 'the four 1100px signed-out cells');
    } finally {
        console.error = original;
    }
    const diffs = errors.filter((line) => line.includes('DIFF text /text/Genesis.1 1100px'));
    assert.equal(diffs.length, 4);
    assert.match(diffs[0], /2 of 3 elements/);
    assert.ok(errors.some((line) => line.includes('color: red -> blue')), errors.join('\n'));
    assert.ok(errors.some((line) => line.includes('extra:1') && line.includes('display:  -> x')));
    assert.ok(errors.some((line) => /1100px light\/en:/.test(line)));
});

test('verifyKind marks the signed-in cells in its report', async () => {
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
        const browser = signatureBrowser((width, bundle) => ({ 'body:1': bundle ? 'a' : 'b' }));
        const result = await mod.verifyKind(browser, BASE, 'home');
        assert.equal(result.bad, result.cells);
    } finally {
        console.error = original;
    }
    assert.ok(errors.some((line) => /DIFF home \/ 412px (light|dark)\/(en|he)\/in:/.test(line)));
});

// ─── main ────────────────────────────────────────────────────────────────────

const MANIFEST = { css: { sourcesHash: 'hash-of-the-sources', sources: {}, critical: {} }, js: { classic: {}, modules: {} } };
const minDir = () => path.join(ROOT, 'static', 'min');

function writeManifest(manifest = MANIFEST) {
    fs.rmSync(minDir(), { recursive: true, force: true });
    fs.mkdirSync(minDir(), { recursive: true });
    fs.writeFileSync(path.join(minDir(), 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** The fakes for one run: what was launched, served and stopped. */
function fakes(options = {}) {
    const run = { launches: [], serves: [], stops: 0, browsers: [] };
    return {
        run,
        puppeteer: {
            launch: async (launchOptions) => {
                run.launches.push(launchOptions);
                const browser = fakeBrowser(options);
                run.browsers.push(browser);
                return browser;
            },
        },
        serve: async (env) => {
            run.serves.push(env);
            return { base: BASE, stop: () => { run.stops += 1; } };
        },
    };
}

async function quietly(fn) {
    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
        return { result: await fn(), lines };
    } finally {
        console.log = original;
    }
}

test('main needs a manifest from the asset build first', async () => {
    fs.rmSync(minDir(), { recursive: true, force: true });
    await assert.rejects(mod.main({ argv: ['node', 'x'], ...fakes() }), /static\/min\/manifest\.json is missing: run npm run build:assets first/);
});

test('main extracts every kind, records it in the manifest, and verifies the shipped page', async () => {
    writeManifest();
    await withDocument('<p class="a"></p>', [[`http://x${SHEET}`, PAGE_CSS]], async () => {
        const f = fakes({
            requests: [`${BASE}/static/min/css/app.css`],
            onEvaluate: (fn, args) => (fn === mod.pageSignature ? { 'body:1': 'same' } : fn(...args)),
        });
        const { result, lines } = await quietly(() => mod.main({ argv: ['node', 'x'], ...f }));
        assert.equal(result, 0);

        // One server from the sources for extraction, then one serving the built page.
        assert.deepEqual(f.run.serves, [{ SHELAH_SOURCE_ASSETS: '1' }, { SHELAH_SOURCE_ASSETS: '' }]);
        assert.equal(f.run.stops, 2);
        assert.equal(f.run.launches.length, 2);
        assert.ok(f.run.launches.every((launch) => launch.headless === true));
        assert.ok(f.run.browsers.every((browser) => browser.log.closed));

        const manifest = JSON.parse(fs.readFileSync(path.join(minDir(), 'manifest.json'), 'utf8'));
        assert.deepEqual(Object.keys(manifest.css.critical), ['home', 'text', 'app']);
        assert.deepEqual(manifest.css.critical.text, {
            file: 'css/critical-text.css',
            sourcesHash: 'hash-of-the-sources',
            routes: ['/text/Genesis.1', '/text/Berakhot.2a'],
        });
        for (const kind of ['home', 'text', 'app']) {
            assert.match(fs.readFileSync(path.join(minDir(), `css/critical-${kind}.css`), 'utf8'), /\.a\{color:red/);
        }
        assert.ok(fs.readFileSync(path.join(minDir(), 'manifest.json'), 'utf8').endsWith('}\n'));

        assert.equal(lines.filter((line) => /^(home|text|app)\s+[\d.]+ KB from 1 sheets, \d+ route\(s\)/.test(line)).length, 3, lines.join('\n'));
        assert.equal(lines.filter((line) => /^verify (home|text|app)\s+all 32 cells identical$/.test(line)).length, 3, lines.join('\n'));
    });
});

test('main --no-verify stops after writing the critical CSS', async () => {
    writeManifest();
    await withDocument('<p class="a"></p>', [[`http://x${SHEET}`, PAGE_CSS]], async () => {
        const f = fakes();
        const { result } = await quietly(() => mod.main({ argv: ['node', 'x', '--no-verify'], ...f }));
        assert.equal(result, 0);
        assert.deepEqual(f.run.serves, [{ SHELAH_SOURCE_ASSETS: '1' }]);
        assert.equal(f.run.launches.length, 1);
        assert.equal(fs.existsSync(path.join(minDir(), 'css/critical-home.css')), true);
    });
});

test('main --verify-only checks what is on disk without extracting', async () => {
    writeManifest();
    const f = fakes({
        requests: [`${BASE}/static/min/css/app.css`],
        onEvaluate: () => ({ 'body:1': 'same' }),
    });
    const { result } = await quietly(() => mod.main({ argv: ['node', 'x', '--verify-only'], ...f }));
    assert.equal(result, 0);
    assert.deepEqual(f.run.serves, [{ SHELAH_SOURCE_ASSETS: '' }]);
    assert.equal(f.run.launches.length, 1);
    assert.equal(fs.existsSync(path.join(minDir(), 'css/critical-home.css')), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(minDir(), 'manifest.json'), 'utf8')).css.critical, {});
});

test('main --base-url uses the running server and starts none', async () => {
    writeManifest();
    await withDocument('<p class="a"></p>', [[`http://x${SHEET}`, PAGE_CSS]], async () => {
        const f = fakes({
            requests: [`${BASE}/static/min/css/app.css`],
            onEvaluate: (fn, args) => (fn === mod.pageSignature ? { 'body:1': 'same' } : fn(...args)),
        });
        await quietly(() => mod.main({ argv: ['node', 'x', '--base-url', 'http://127.0.0.1:5000'], ...f }));
        assert.deepEqual(f.run.serves, []);
        assert.ok(f.run.browsers.every((browser) => browser.log.pages.every((page) => page.url.startsWith('http://127.0.0.1:5000/'))));
    });
});

test('main resolves to how many cells differ, for the command line to turn into an exit code', async () => {
    writeManifest();
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
        await withDocument('<p class="a"></p>', [[`http://x${SHEET}`, PAGE_CSS]], async () => {
            const f = fakes({
                requests: [`${BASE}/static/min/css/app.css`],
                onEvaluate: (fn, args, page) => (fn === mod.pageSignature ? { 'body:1': page.bundleBlocked ? 'a' : 'b' } : fn(...args)),
            });
            const { result, lines } = await quietly(() => mod.main({ argv: ['node', 'x'], ...f }));
            assert.equal(result, 3 * 32);
            assert.ok(lines.some((line) => /^verify home\s+32 of 32 cells differ$/.test(line)), lines.join('\n'));
        });
    } finally {
        console.error = original;
    }
});

test('main closes the browser and stops the server when the extraction fails', async () => {
    writeManifest();
    const f = fakes({ failGoto: true });
    await assert.rejects(quietly(() => mod.main({ argv: ['node', 'x'], ...f })), /ERR_CONNECTION_REFUSED/);
    assert.equal(f.run.stops, 1);
    assert.equal(f.run.browsers.length, 1);
    assert.equal(f.run.browsers[0].log.closed, true);
});

test('main closes the second browser and stops the shipped server when verification fails', async () => {
    writeManifest();
    await withDocument('<p class="a"></p>', [[`http://x${SHEET}`, PAGE_CSS]], async () => {
        const f = fakes({
            onEvaluate: (fn, args) => {
                if (fn === mod.pageSignature) throw new Error('page crashed');
                return fn(...args);
            },
        });
        await assert.rejects(quietly(() => mod.main({ argv: ['node', 'x'], ...f })), /page crashed/);
        assert.equal(f.run.stops, 2);
        assert.ok(f.run.browsers.every((browser) => browser.log.closed));
    });
});

// ─── The command line ────────────────────────────────────────────────────────

test('run as a script it says what is missing and exits 1', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelah-critical-empty-'));
    try {
        const result = spawnSync(process.execPath, [SCRIPT, '--no-verify'], {
            env: { ...process.env, SHELAH_ASSETS_ROOT: root },
            encoding: 'utf8',
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /static\/min\/manifest\.json is missing: run npm run build:assets first/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('importing the script runs nothing', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)}); console.log('imported');`], {
        env: { ...process.env, SHELAH_ASSETS_ROOT: path.join(os.tmpdir(), 'shelah-critical-none') },
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'imported');
});
