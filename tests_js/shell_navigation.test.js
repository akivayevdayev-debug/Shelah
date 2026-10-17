/**
 * Moving between pages: hydrateRoute (what Back, Forward and a pasted link
 * call), which page a route names counts as already on screen, putting the
 * reader back where Back/Forward left it, and a shelf item opening its page.
 * Boots the real home page in jsdom (tests_js/helpers/shell_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');

const logOf = (page) => JSON.parse(page.eval('JSON.stringify(window.__log)'));

/** A page whose openers and views are recorders, so a test reads what a call touched. */
async function openPage(extra = '', options = {}) {
    const page = await openShellPage(options);
    page.eval(`
        window.__log = [];
        window.__rec = (name, value) => (...args) => { window.__log.push([name, ...args]); return value; };
        ${extra}
    `);
    return page;
}

/** Stubs hydrateRouteViews so the flags hydrateRoute sets around it can be read. */
const RECORD_VIEWS = `
    preferencesHydrated = true;
    hydrateRouteViews = (route, options) => {
        window.__log.push(['views', route, options, _viewNavDirection, _viewScrollSaveOff]);
    };
`;

// ─── hydrateRoute ────────────────────────────────────────────────────────────

test('the first route waits for the saved preferences, then opens', async () => {
    const page = await openPage(RECORD_VIEWS);
    try {
        page.eval('preferencesHydrated = false; pendingInitialRoute = null;');
        page.window.__route = { text: 'Genesis.1' };
        page.eval('hydrateRoute(window.__route, { isInitial: true })');
        assert.deepEqual(logOf(page), []);
        assert.equal(page.eval('pendingInitialRoute === window.__route'), true);

        page.eval('hydratePreferences()');
        assert.equal(page.eval('preferencesHydrated'), true);
        assert.equal(page.eval('pendingInitialRoute'), null);
        assert.deepEqual(logOf(page), [
            ['views', { text: 'Genesis.1' }, { isInitial: true, restoreScroll: null, left: null }, null, true],
        ]);
    } finally {
        page.close();
    }
});

test('a deep link waits for the full stylesheet; a route that opens no view does not', async () => {
    const page = await openPage(RECORD_VIEWS);
    try {
        page.eval(`
            window.ShelahStyles = { done: false, ready: new Promise((resolve) => {
                window.__stylesReady = () => { window.ShelahStyles.done = true; resolve(); };
            }) };
        `);
        page.window.__route = { prayer: 'Shema' };
        page.eval('hydrateRoute(window.__route, { isInitial: true })');
        await page.settle();
        assert.deepEqual(logOf(page), []);

        page.eval('window.__stylesReady()');
        await page.settle();
        assert.deepEqual(logOf(page).map(([name, route]) => [name, route]), [['views', { prayer: 'Shema' }]]);

        // Nothing to build from script, so nothing to wait for.
        page.eval('window.ShelahStyles = { done: false, ready: new Promise(() => {}) }; window.__log.length = 0;');
        page.eval('hydrateRoute({}, { isInitial: true })');
        assert.equal(logOf(page).length, 1);

        // Back/Forward is never held up: the styles are long applied by then.
        page.eval('window.__log.length = 0; hydrateRoute({ prayer: "Shema" }, { isInitial: false })');
        assert.equal(logOf(page).length, 1);
    } finally {
        page.close();
    }
});

test('the views swap the way the navigation went, and the flags are put back after', async () => {
    const page = await openPage(RECORD_VIEWS);
    try {
        const direction = (options) => {
            page.eval(`window.__log.length = 0; hydrateRoute({ text: 'Genesis.1' }, ${JSON.stringify(options)})`);
            const [[, , , navDirection, saveOff]] = logOf(page);
            return [navDirection, saveOff];
        };
        assert.deepEqual(direction({ isInitial: true }), [null, true]);
        assert.deepEqual(direction({ direction: 'back' }), ['back', true]);
        assert.deepEqual(direction({ direction: 'forward' }), ['forward', true]);
        assert.deepEqual(direction({}), ['forward', true]);
        assert.deepEqual(JSON.parse(page.eval('JSON.stringify([_viewNavDirection, _viewScrollSaveOff])')), ['forward', false]);
    } finally {
        page.close();
    }
});

test('a view that throws still leaves the flags as they were', async () => {
    const page = await openPage(`
        preferencesHydrated = true;
        hydrateRouteViews = () => { throw new Error('boom'); };
    `);
    try {
        page.eval(`
            try { hydrateRoute({ text: 'Genesis.1' }, { direction: 'back' }); } catch (error) { window.__caught = error.message; }
        `);
        assert.equal(page.eval('window.__caught'), 'boom');
        assert.deepEqual(JSON.parse(page.eval('JSON.stringify([_viewNavDirection, _viewScrollSaveOff])')), ['forward', false]);
    } finally {
        page.close();
    }
});

test('hydrateRoute hands the saved scroll and the entry left on to the views; no route is an empty one', async () => {
    const page = await openPage(RECORD_VIEWS);
    try {
        page.eval('hydrateRoute(null)');
        page.eval(`hydrateRoute({ text: 'Genesis.2' }, {
            saved: { viewScroll: { view: 'text', top: 5 } }, left: { text: 'Genesis.1' },
        })`);
        page.eval(`hydrateRoute({ text: 'Genesis.2' }, { saved: {} })`);
        assert.deepEqual(logOf(page).map(([, route, options]) => [route, options]), [
            [{}, { isInitial: false, restoreScroll: null, left: null }],
            [{ text: 'Genesis.2' }, { isInitial: false, restoreScroll: { view: 'text', top: 5 }, left: { text: 'Genesis.1' } }],
            [{ text: 'Genesis.2' }, { isInitial: false, restoreScroll: null, left: null }],
        ]);
    } finally {
        page.close();
    }
});

// ─── hydrateRouteViews picks between "put it back" and "open it" ─────────────

test('Back onto the page already shown puts it back; the first load and a new page open it', async () => {
    const page = await openPage(`
        applyRouteDisplayPrefs = () => false;
        restoreOnScreenRouteView = window.__rec('restoreOnScreen');
        openRouteView = window.__rec('openRouteView');
        hydrateCalendarDate = window.__rec('hydrateCalendarDate');
        syncAuthRoute = window.__rec('syncAuthRoute');
        window.closeCalendarModal = window.__rec('closeCalendarModal');
        window.ShelahConversationUI = { hydrate: window.__rec('conversationHydrate') };
        appState.shownView = { type: 'text', value: 'Genesis 1', view: 'text' };
        window.currentTextPayloadChain = [{ ref: 'Genesis 1' }];
    `);
    try {
        const run = (route, options) => {
            page.eval(`window.__log.length = 0; hydrateRouteViews(${JSON.stringify(route)}, ${JSON.stringify(options)})`);
            return logOf(page).map(([name]) => name);
        };
        assert.deepEqual(run({ text: 'Genesis.1' }, { isInitial: false }), [
            'restoreOnScreen', 'closeCalendarModal', 'conversationHydrate', 'syncAuthRoute',
        ]);
        assert.deepEqual(run({ text: 'Genesis.1' }, { isInitial: true }).slice(0, 1), ['openRouteView']);
        assert.deepEqual(run({ text: 'Exodus.1' }, { isInitial: false }).slice(0, 1), ['openRouteView']);
        assert.deepEqual(run({ text: 'Genesis.1', date: '2026-10-17' }, { isInitial: false }),
            ['restoreOnScreen', 'hydrateCalendarDate', 'conversationHydrate', 'syncAuthRoute']);
    } finally {
        page.close();
    }
});

test('display keys in the URL re-sync the settings and the reader before the page opens', async () => {
    const page = await openPage(`
        applyRouteDisplayPrefs = () => true;
        syncPrefsInputsFromState = window.__rec('syncPrefsInputs');
        applyReaderPreferences = window.__rec('applyReaderPreferences');
        routeViewOnScreen = () => false;
        openRouteView = window.__rec('openRouteView');
        syncAuthRoute = () => {};
        window.ShelahConversationUI = { hydrate() {} };
    `);
    try {
        page.eval('hydrateRouteViews({ text: "Genesis.1" }, { isInitial: false })');
        assert.deepEqual(logOf(page).map(([name]) => name), ['syncPrefsInputs', 'applyReaderPreferences', 'openRouteView']);
    } finally {
        page.close();
    }
});

// ─── routeViewOnScreen ───────────────────────────────────────────────────────

const ON_SCREEN = [
    // [what is shown, what the route names, expected]
    ['nothing is shown', null, { text: 'Genesis.1' }, false],
    ['the same chapter', { type: 'text' }, { text: 'Genesis.1' }, true],
    ['a verse inside a loaded chapter', { type: 'text' }, { text: 'Genesis.1.3' }, true],
    ['a verse range inside a loaded chapter', { type: 'text' }, { text: 'Genesis.1:3-5' }, true],
    ['a later chapter of the same text, loaded by scrolling', { type: 'text' }, { text: 'Genesis.2' }, true],
    ['a chapter that is not loaded', { type: 'text' }, { text: 'Genesis.3' }, false],
    ['a chapter whose number only starts like a loaded one', { type: 'text' }, { text: 'Genesis.12' }, false],
    ['a text while a prayer is shown', { type: 'prayer', value: 'Shema' }, { text: 'Genesis.1' }, false],
    ['an answer (a panel over the page, never the page)', { type: 'text' }, { text: 'Genesis.1', chat: 'c-1' }, false],
    ['a public answer', { type: 'home' }, { a: 'tok' }, false],
    ['the same prayer', { type: 'prayer', value: 'Shema' }, { prayer: 'Shema' }, true],
    ['another prayer', { type: 'prayer', value: 'Shema' }, { prayer: 'Amidah' }, false],
    ['a prayer while a text is shown', { type: 'text' }, { prayer: 'Shema' }, false],
    ['the same community', { type: 'community', value: 'Yemenite' }, { community: 'Yemenite' }, true],
    ['another community', { type: 'community', value: 'Yemenite' }, { community: 'Ashkenaz' }, false],
    ['the history page', { type: 'history' }, { history: true }, true],
    ['the history page while home is shown', { type: 'home' }, { history: true }, false],
    ['home for a bare URL', { type: 'home' }, {}, true],
    ['home for a bare URL while a text is shown', { type: 'text' }, {}, false],
];

for (const [name, shown, route, expected] of ON_SCREEN) {
    test(`routeViewOnScreen: ${name} -> ${expected}`, async () => {
        const page = await openPage(`
            appState.shownView = ${JSON.stringify(shown)};
            window.currentTextPayloadChain = [{ ref: 'Genesis 1' }, { ref: 'Genesis 2' }, {}];
        `);
        try {
            assert.equal(page.eval(`routeViewOnScreen(${JSON.stringify(route)})`), expected);
        } finally {
            page.close();
        }
    });
}

test('routeViewOnScreen: a text route is not on screen when no text has loaded', async () => {
    const page = await openPage(`
        appState.shownView = { type: 'text' };
        window.currentTextPayloadChain = [];
        window.currentTextPayload = null;
    `);
    try {
        assert.equal(page.eval(`routeViewOnScreen({ text: 'Genesis.1' })`), false);
        // One loaded section with no chain is still a chain of one.
        page.eval(`window.currentTextPayload = { ref: 'Genesis 1' }`);
        assert.equal(page.eval(`routeViewOnScreen({ text: 'Genesis.1' })`), true);
    } finally {
        page.close();
    }
});

test('routeViewOnScreen: a siddur service is on screen whichever section the URL names', async () => {
    const page = await openPage(`
        appState.shownView = { type: 'siddur', value: 'shacharit' };
        window.ShelahSiddur = { isShowing: (name) => name === 'shacharit' };
    `);
    try {
        assert.equal(page.eval(`routeViewOnScreen({ siddur: 'shacharit' })`), true);
        assert.equal(page.eval(`routeViewOnScreen({ siddur: 'maariv' })`), false);
        page.eval('delete window.ShelahSiddur');
        assert.equal(page.eval(`routeViewOnScreen({ siddur: 'shacharit' })`), false);
        page.eval(`appState.shownView = { type: 'text' }; window.ShelahSiddur = { isShowing: () => true }`);
        assert.equal(page.eval(`routeViewOnScreen({ siddur: 'shacharit' })`), false);
    } finally {
        page.close();
    }
});

// ─── restoreOnScreenRouteView / restoreShownView ─────────────────────────────

const RECORD_RESTORE = `
    restoreShownView = window.__rec('restoreShownView');
    restoreViewScroll = window.__rec('restoreViewScroll');
    window.ShelahSiddur = { scrollTo: window.__rec('siddurScrollTo') };
`;

test('Back within one continuous text puts the reader where that entry was left', async () => {
    const page = await openPage(RECORD_RESTORE);
    try {
        const scroll = { view: 'text', top: 40 };
        page.window.__scroll = scroll;
        page.eval(`restoreOnScreenRouteView({ text: 'Genesis.1' }, window.__scroll, { text: 'Genesis.2' })`);
        assert.deepEqual(logOf(page), [['restoreShownView'], ['restoreViewScroll', scroll, 'text']]);
    } finally {
        page.close();
    }
});

test('closing or opening an overlay leaves the page under it as it is', async () => {
    const page = await openPage(RECORD_RESTORE);
    try {
        for (const key of ['chat', 'a', 'conversation', 'date', 'auth']) {
            page.eval(`window.__log.length = 0; restoreOnScreenRouteView(
                { text: 'Genesis.1', ${key}: 'x' }, { top: 1 }, { text: 'Genesis.1' })`);
            assert.deepEqual(logOf(page), [['restoreShownView']], key);
        }
        // The same overlay on both sides is not a move.
        page.eval(`window.__log.length = 0; restoreOnScreenRouteView(
            { text: 'Genesis.1', date: 'd' }, { top: 1 }, { text: 'Genesis.1', date: 'd' })`);
        assert.deepEqual(logOf(page).map(([name]) => name), ['restoreShownView', 'restoreViewScroll']);
        // Coming from a page that was not a text: nothing to restore.
        page.eval(`window.__log.length = 0; restoreOnScreenRouteView({ text: 'Genesis.1' }, { top: 1 }, null)`);
        assert.deepEqual(logOf(page), [['restoreShownView']]);
    } finally {
        page.close();
    }
});

test('Back onto a siddur service scrolls it to the section the URL names, unless an overlay moved', async () => {
    const page = await openPage(RECORD_RESTORE);
    try {
        page.eval(`restoreOnScreenRouteView({ siddur: 'shacharit' }, null, null)`);
        assert.deepEqual(logOf(page), [['restoreShownView'], ['siddurScrollTo', 'shacharit']]);
        page.eval(`window.__log.length = 0; restoreOnScreenRouteView({ siddur: 'shacharit', chat: 'c' }, null, null)`);
        assert.deepEqual(logOf(page), [['restoreShownView']]);
        page.eval(`delete window.ShelahSiddur; restoreOnScreenRouteView({ siddur: 'shacharit' }, null, null)`);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('closing an answer gives the page under it its view back', async () => {
    const page = await openPage(`
        updateBookmarkButton = window.__rec('updateBookmarkButton');
        syncDocumentTitle = window.__rec('syncDocumentTitle');
        window.ShelahState = { setState: window.__rec('setState') };
        appState.shownView = { type: 'text', value: 'Genesis 1', view: 'text' };
        appState.currentView = 'ask';
    `);
    try {
        page.eval('restoreShownView()');
        assert.equal(page.eval('appState.currentView'), 'text');
        assert.deepEqual(logOf(page), [['setState', { currentView: 'text' }], ['updateBookmarkButton'], ['syncDocumentTitle']]);

        // Already the shown view, or nothing shown: nothing to redo.
        page.eval('window.__log.length = 0; restoreShownView()');
        assert.deepEqual(logOf(page), []);
        page.eval('appState.shownView = null; appState.currentView = "ask"; restoreShownView()');
        assert.equal(page.eval('appState.currentView'), 'ask');
        assert.deepEqual(logOf(page), []);
    } finally {
        page.close();
    }
});

test('restoreShownView works without a shared-state store', async () => {
    const page = await openPage(`
        updateBookmarkButton = () => {};
        syncDocumentTitle = () => {};
        delete window.ShelahState;
        appState.shownView = { type: 'home', value: null, view: 'home' };
        appState.currentView = 'ask';
    `);
    try {
        page.eval('restoreShownView()');
        assert.equal(page.eval('appState.currentView'), 'home');
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

// ─── Scroll: capture, restore and the verse anchor ───────────────────────────

/**
 * Chunks in #readerSources with the rectangles a layout would give them. A
 * chunk is `{ ref, top, bottom, rows: [{ segment, top, bottom }], transform }`;
 * `transform` is the pending entrance translateY of the chunk.
 */
function drawReader(page, chunks) {
    page.window.__chunks = chunks;
    page.eval(`
        window.DOMMatrixReadOnly = class { constructor(t) { this.m42 = Number(String(t).match(/,\\s*([-\\d.]+)\\)$/)?.[1] || 0); } };
        const realStyle = window.getComputedStyle.bind(window);
        window.getComputedStyle = (node, ...rest) => (node.__transform
            ? { transform: node.__transform }
            : realStyle(node, ...rest));
        const rect = (top, bottom) => () => ({ top, bottom, height: bottom - top, left: 0, right: 0, width: 0 });
        const host = document.getElementById('readerSources');
        host.replaceChildren();
        for (const chunk of window.__chunks) {
            const el = document.createElement('div');
            el.className = 'reader-source-clean';
            el.dataset.textChunkRef = chunk.ref;
            el.getBoundingClientRect = rect(chunk.top, chunk.bottom);
            if (chunk.transform) el.__transform = 'matrix(1, 0, 0, 1, 0, ' + chunk.transform + ')';
            for (const row of chunk.rows || []) {
                const rowEl = document.createElement('div');
                rowEl.className = 'segment-row';
                rowEl.dataset.segment = row.segment;
                rowEl.getBoundingClientRect = rect(row.top, row.bottom);
                el.append(rowEl);
            }
            host.append(el);
        }
    `);
}

const CHAPTERS = [
    { ref: 'Genesis 1', top: -400, bottom: -20, rows: [{ segment: '1', top: -400, bottom: -200 }, { segment: '2', top: -200, bottom: -20 }] },
    { ref: 'Genesis 2', top: -20, bottom: 500, rows: [{ segment: '1', top: -20, bottom: 60 }, { segment: '2', top: 60, bottom: 300 }] },
];

test('captureReaderChunkAnchor names the verse at the top of the page and how far down it sits', async () => {
    const page = await openPage();
    try {
        drawReader(page, CHAPTERS);
        assert.deepEqual(JSON.parse(page.eval('JSON.stringify(captureReaderChunkAnchor())')),
            { ref: 'Genesis 2', segment: '1', offset: -20 });
        assert.deepEqual(JSON.parse(page.eval('JSON.stringify(captureViewScroll())')), { view: 'home', top: 0, anchor: null });
        page.eval(`appState.shownView = { type: 'text', value: 'Genesis 2', view: 'text' }`);
        assert.deepEqual(JSON.parse(page.eval('JSON.stringify(captureViewScroll())')),
            { view: 'text', top: 0, anchor: { ref: 'Genesis 2', segment: '1', offset: -20 } });
        page.eval('appState.shownView = null');
        assert.equal(page.eval('captureViewScroll()'), null);
    } finally {
        page.close();
    }
});

test('the anchor is read where the entrance animation will leave a section, not mid-travel', async () => {
    const page = await openPage();
    try {
        // The section is still 8px low in its fade-up: it will rest at -8.
        drawReader(page, [{ ref: 'Genesis 1', top: 0, bottom: 300, transform: 8, rows: [] }]);
        assert.deepEqual(JSON.parse(page.eval('JSON.stringify(captureReaderChunkAnchor())')),
            { ref: 'Genesis 1', segment: '', offset: -8 });
    } finally {
        page.close();
    }
});

test('the anchor is null when every section is above the viewport', async () => {
    const page = await openPage();
    try {
        drawReader(page, [{ ref: 'Genesis 1', top: -400, bottom: -20, rows: [] }]);
        assert.equal(page.eval('captureReaderChunkAnchor()'), null);
    } finally {
        page.close();
    }
});

test('restoreReaderChunkAnchor needs an anchor whose section is still on the page', async () => {
    const page = await openPage();
    try {
        drawReader(page, CHAPTERS);
        assert.equal(page.eval('restoreReaderChunkAnchor(null)'), false);
        assert.equal(page.eval('restoreReaderChunkAnchor({})'), false);
        assert.equal(page.eval(`restoreReaderChunkAnchor({ ref: 'Genesis 9', segment: '1', offset: 0 })`), false);
        assert.deepEqual(page.scrolls, []);
    } finally {
        page.close();
    }
});

test('restoreReaderChunkAnchor scrolls the page by exactly how far the verse has drifted', async () => {
    const page = await openPage();
    try {
        drawReader(page, CHAPTERS);
        Object.defineProperty(page.window, 'pageYOffset', { value: 300, configurable: true });
        // The verse rests at -20 but was left at 15, so the page is 35px too far down.
        assert.equal(page.eval(`restoreReaderChunkAnchor({ ref: 'Genesis 2', segment: '1', offset: 15 })`), true);
        assert.deepEqual(page.scrolls.map(([options]) => ({ ...options })), [{ top: 300 - 35, behavior: 'instant' }]);

        // Within a pixel: left alone.
        page.scrolls.length = 0;
        assert.equal(page.eval(`restoreReaderChunkAnchor({ ref: 'Genesis 2', segment: '1', offset: -20.4 })`), true);
        assert.deepEqual(page.scrolls, []);

        // No verse named: the section's own top is the mark.
        assert.equal(page.eval(`restoreReaderChunkAnchor({ ref: 'Genesis 2', segment: '', offset: -10 })`), true);
        assert.deepEqual(page.scrolls.map(([options]) => ({ ...options })), [{ top: 300 - 10, behavior: 'instant' }]);

        // A verse that is no longer there falls back to the section too.
        page.scrolls.length = 0;
        assert.equal(page.eval(`restoreReaderChunkAnchor({ ref: 'Genesis 2', segment: '99', offset: -20 })`), true);
        assert.deepEqual(page.scrolls, []);
    } finally {
        page.close();
    }
});

test('restoreReaderChunkAnchor scrolls the main column when that is what scrolls', async () => {
    const page = await openPage();
    try {
        drawReader(page, CHAPTERS);
        page.eval(`
            Object.defineProperty(mainContainer, 'scrollHeight', { value: 2000, configurable: true });
            Object.defineProperty(mainContainer, 'clientHeight', { value: 600, configurable: true });
            Object.defineProperty(mainContainer, 'scrollTop', { value: 120, configurable: true });
            mainContainer.getBoundingClientRect = () => ({ top: 10, bottom: 610, height: 600, left: 0, right: 0, width: 0 });
            mainContainer.scrollTo = (options) => window.__log.push(['scrollTo', { ...options }]);
        `);
        // The viewport top is the column's (10), so the verse at -20 is 30 above it.
        assert.equal(page.eval(`restoreReaderChunkAnchor({ ref: 'Genesis 2', segment: '1', offset: -50 })`), true);
        assert.deepEqual(logOf(page), [['scrollTo', { top: 120 + 20, behavior: 'instant' }]]);
        assert.deepEqual(page.scrolls, []);
    } finally {
        page.close();
    }
});

test('restoreViewScroll lands on the verse once the view has drawn, else on the offset', async () => {
    const page = await openPage(`
        window.__frames = [];
        window.requestAnimationFrame = (fn) => { window.__frames.push(fn); return window.__frames.length; };
        restoreReaderChunkAnchor = (anchor) => { window.__log.push(['anchor', anchor]); return Boolean(anchor.found); };
        _viewScrollHeld = true;
    `);
    try {
        const frame = () => page.eval('window.__frames.shift()()');

        // Saved for another view, or nothing saved: nothing to do, but the hold is released.
        assert.equal(page.eval(`restoreViewScroll(null, 'text')`), false);
        assert.equal(page.eval('_viewScrollHeld'), false);
        assert.equal(page.eval(`restoreViewScroll({ view: 'home', top: 5 }, 'text')`), false);
        assert.equal(page.eval('window.__frames.length'), 0);

        // The verse is found: no offset scroll.
        assert.equal(page.eval(`restoreViewScroll({ view: 'text', top: 90, anchor: { ref: 'a', found: true } }, 'text')`), true);
        frame();
        assert.deepEqual(logOf(page), [['anchor', { ref: 'a', found: true }]]);
        assert.deepEqual(page.scrolls, []);

        // The verse is gone: the offset it was left at.
        page.eval(`restoreViewScroll({ view: 'text', top: 90, anchor: { ref: 'a', found: false } }, 'text')`);
        frame();
        assert.deepEqual(page.scrolls.map(([options]) => ({ ...options })), [{ top: 90, behavior: 'instant' }]);

        // A view with no anchor, a bad or negative offset: the top.
        page.scrolls.length = 0;
        page.eval(`restoreViewScroll({ view: 'home', top: -50 }, 'home')`);
        frame();
        page.eval(`restoreViewScroll({ view: 'home', top: 'far' }, 'home')`);
        frame();
        assert.deepEqual(page.scrolls.map(([options]) => options.top), [0, 0]);
    } finally {
        page.close();
    }
});

test('restoreViewScroll scrolls the main column when that is what scrolls', async () => {
    const page = await openPage(`
        window.__frames = [];
        window.requestAnimationFrame = (fn) => { window.__frames.push(fn); return 1; };
        Object.defineProperty(mainContainer, 'scrollHeight', { value: 2000, configurable: true });
        Object.defineProperty(mainContainer, 'clientHeight', { value: 600, configurable: true });
        mainContainer.scrollTo = (options) => window.__log.push(['scrollTo', { ...options }]);
    `);
    try {
        page.eval(`restoreViewScroll({ view: 'home', top: 250 }, 'home')`);
        page.eval('window.__frames.shift()()');
        assert.deepEqual(logOf(page), [['scrollTo', { top: 250, behavior: 'instant' }]]);
        assert.deepEqual(page.scrolls, []);
    } finally {
        page.close();
    }
});

// ─── Shelf items ─────────────────────────────────────────────────────────────

const OPENERS = ['readText', 'displayPrayer', 'displaySiddur', 'displayCommunity', 'displayAskHistoryPage'];

async function openShelf(extra = '') {
    return openPage(`
        ${OPENERS.map((name) => `${name} = window.__rec('${name}');`).join('\n        ')}
        openStoredAskAnswer = window.__rec('openStoredAskAnswer');
        promoteShelfAsk = window.__rec('promoteShelfAsk');
        dropShelfAsk = window.__rec('dropShelfAsk');
        handleAiSearch = window.__rec('handleAiSearch');
        ${extra}
    `);
}

test('a shelf item opens the kind of page it was saved from', async () => {
    const page = await openShelf();
    try {
        for (const [type, value, opener] of [
            ['text', 'Genesis 1', 'readText'],
            ['prayer', 'Shema', 'displayPrayer'],
            ['siddur', 'shacharit', 'displaySiddur'],
            ['community', 'Yemenite', 'displayCommunity'],
        ]) {
            page.eval(`window.__log.length = 0; openShelfItem('${type}', '${value}', 'a label')`);
            assert.deepEqual(logOf(page), [[opener, value]], type);
        }
        page.eval(`window.__log.length = 0; openShelfItem('history', '', 'Ask history')`);
        assert.deepEqual(logOf(page), [['displayAskHistoryPage']]);
        page.eval(`window.__log.length = 0; openShelfItem('unknown', 'x', 'x')`);
        assert.deepEqual(logOf(page), []);
    } finally {
        page.close();
    }
});

test('a saved question opens its stored answer, and tidies the shelf when the id has moved', async () => {
    const page = await openShelf(`
        window.ShelahAskHistory = {
            resolveShelfAsk: async (entry, options) => {
                window.__log.push(['resolve', entry, options.signedIn]);
                window.__options = options;
                return { item: { id: 'id-2', question: 'May I carry?' }, migrateTo: 'id-2', staleId: 'id-1' };
            },
        };
        askHistoryAuthState = () => 'signed-in';
    `);
    try {
        await page.eval(`openShelfItem('ask', 'May I carry?', 'May I carry?')`);
        assert.deepEqual(logOf(page), [
            ['resolve', { value: 'May I carry?', label: 'May I carry?' }, true],
            ['promoteShelfAsk', 'May I carry?', 'id-2'],
            ['dropShelfAsk', 'id-1'],
            ['openStoredAskAnswer', { id: 'id-2', question: 'May I carry?' }],
        ]);
    } finally {
        page.close();
    }
});

test('a saved question the history cannot place is asked again', async () => {
    const page = await openShelf(`
        window.ShelahAskHistory = { resolveShelfAsk: async () => ({ reask: 'May I carry?' }) };
        askHistoryAuthState = () => 'signed-out';
    `);
    try {
        await page.eval(`openShelfItem('ask', 'old text', 'May I carry?')`);
        assert.deepEqual(logOf(page), [['handleAiSearch', 'May I carry?']]);

        // Nothing to re-ask: an empty question, not a crash.
        page.eval(`window.__log.length = 0; window.ShelahAskHistory = { resolveShelfAsk: async () => ({}) }`);
        await page.eval(`openShelfItem('ask', '', '')`);
        assert.deepEqual(logOf(page), [['handleAiSearch', '']]);
    } finally {
        page.close();
    }
});

test('without the history module a saved question is asked again from its value, else its label', async () => {
    const page = await openShelf('delete window.ShelahAskHistory;');
    try {
        await page.eval(`openShelfItem('ask', 'by value', 'by label')`);
        await page.eval(`openShelfItem('ask', '', 'by label')`);
        await page.eval(`openShelfItem('ask', '', '')`);
        assert.deepEqual(logOf(page), [
            ['handleAiSearch', 'by value'],
            ['handleAiSearch', 'by label'],
            ['handleAiSearch', ''],
        ]);
    } finally {
        page.close();
    }
});

test('the history module is given the reader\'s sign-in state and the page\'s own fetchers', async () => {
    const page = await openShelf(`
        askHistoryAuthState = () => 'signed-in';
        fetchAskHistoryPage = window.__rec('fetchAskHistoryPage', Promise.resolve({ items: [] }));
        fetchAskHistoryEntry = window.__rec('fetchAskHistoryEntry');
        window.ShelahAskHistory = {
            resolveShelfAsk: async (entry, options) => {
                options.searchHistory('carry');
                options.fetchEntry('id-9');
                window.__signedIn = options.signedIn;
                return { reask: 'x' };
            },
        };
    `);
    try {
        await page.eval(`openShelfItem('ask', 'q', 'q')`);
        assert.equal(page.eval('window.__signedIn'), true);
        assert.deepEqual(logOf(page).filter(([name]) => name.startsWith('fetchAskHistory')), [
            ['fetchAskHistoryPage', { q: 'carry', limit: 10 }],
            ['fetchAskHistoryEntry', 'id-9'],
        ]);
    } finally {
        page.close();
    }
});
