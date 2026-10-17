/**
 * The reader's surroundings: reference labels in Hebrew, the parasha a Torah
 * chapter falls in, the mobile drawers, the top-bar offsets the sidebars are
 * laid out from, shul auto-scroll, scroll restore after a re-render, and what
 * a text that fails to load says. Boots the real home page in jsdom
 * (tests_js/helpers/shell_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');

const MOBILE = '(max-width: 1023px)';
const logOf = (page) => JSON.parse(page.eval('JSON.stringify(window.__log)'));
const json = (page, source) => JSON.parse(page.eval(`JSON.stringify(${source})`));

async function openPage(extra = '', options = {}) {
    const page = await openShellPage(options);
    page.eval(`
        window.__log = [];
        window.__rec = (name, value) => (...args) => { window.__log.push([name, ...args]); return value; };
        ${extra}
    `);
    return page;
}

// ─── Reference labels in Hebrew ──────────────────────────────────────────────

test('reference labels read as typed in English, tidied of stray spaces', async () => {
    const page = await openPage();
    try {
        assert.equal(page.eval(`localizeReferenceLabel('  Genesis   1:3 ')`), 'Genesis 1:3');
        assert.equal(page.eval('localizeReferenceLabel(null)'), '');
    } finally {
        page.close();
    }
});

for (const [label, expected] of [
    ['a book on its own', ['Genesis', 'בראשית']],
    ['a book that is not in the static labels', ['Psalms', 'תהילים']],
    ['a chapter', ['Genesis 1', 'בראשית א׳']],
    ['a chapter and verse', ['Genesis 1:3', 'בראשית א׳:ג׳']],
    ['a range across chapters', ['Genesis 1:3-2:4', 'בראשית א׳:ג׳-ב׳:ד׳']],
    ['a daf', ['Berakhot 2a', 'ברכות ב׳ ע״א']],
    ['the second side of a daf, with a line', ['Berakhot 2b:3', 'ברכות ב׳ ע״ב:ג׳']],
    ['extra spaces', ['  Genesis   1 ', 'בראשית א׳']],
    ['a book the page has no name for keeps its English name and gets Hebrew digits', ['Totally Unknown 5', 'Totally Unknown ה׳']],
    ['a title it has nothing for', ['Unknown', 'Unknown']],
    ['nothing', ['', '']],
]) {
    test(`in Hebrew a label shows ${label}`, async () => {
        const page = await openPage(`displayedLanguage = 'he'`);
        try {
            assert.equal(page.eval(`localizeReferenceLabel(${JSON.stringify(expected[0])})`), expected[1]);
        } finally {
            page.close();
        }
    });
}

// ─── Parasha ─────────────────────────────────────────────────────────────────

test('a Torah chapter is placed in the parasha that starts at or before it', async () => {
    const page = await openPage();
    try {
        const ofRef = (ref, categories = ['Torah']) => json(page, `getTorahParashaForRef(${JSON.stringify(ref)}, ${JSON.stringify(categories)})`);
        assert.deepEqual(ofRef('Genesis 1'), { chapter: 1, verse: 1, name: 'Bereshit' });
        assert.deepEqual(ofRef('Genesis 7'), { chapter: 7, verse: 9, name: 'Noach' });
        assert.deepEqual(ofRef('Genesis 6'), { chapter: 6, verse: 9, name: 'Noach' });
        assert.deepEqual(ofRef('Genesis 5'), { chapter: 5, verse: 1, name: 'Bereshit' });
        assert.deepEqual(ofRef('Leviticus 30'), { chapter: 30, verse: 3, name: 'Bechukotai' });
        assert.deepEqual(ofRef('Genesis 7:2'), { chapter: 7, verse: 9, name: 'Noach' });
    } finally {
        page.close();
    }
});

test('only a Torah book with a chapter has a parasha', async () => {
    const page = await openPage();
    try {
        const ofRef = (ref, categories) => json(page, `getTorahParashaForRef(${JSON.stringify(ref)}, ${JSON.stringify(categories)})`);
        assert.equal(ofRef('Genesis 1', ['Prophets']), null);
        assert.equal(ofRef('Genesis 1', 'Torah'), null);
        assert.equal(ofRef('Genesis 1', undefined), null);
        assert.equal(ofRef('', ['Torah']), null);
        assert.equal(ofRef(null, ['Torah']), null);
        assert.equal(ofRef('Genesis', ['Torah']), null);
        assert.equal(ofRef('Genesisx 1', ['Torah']), null);
        assert.equal(ofRef('Sefer 3', ['Torah']), null);
        assert.equal(ofRef('Genesis one', ['Torah']), null);
    } finally {
        page.close();
    }
});

test('parashaForChapter falls back to the first parasha before any starts, and to none for a book without any', async () => {
    const page = await openPage();
    try {
        const parashot = [{ chapter: 3, name: 'A' }, { chapter: 9, name: 'B' }];
        assert.deepEqual(json(page, `parashaForChapter(${JSON.stringify(parashot)}, 1)`), { chapter: 1, name: 'A' });
        assert.deepEqual(json(page, `parashaForChapter(${JSON.stringify(parashot)}, 9)`), { chapter: 9, name: 'B' });
        assert.equal(page.eval('parashaForChapter([], 4)'), null);
    } finally {
        page.close();
    }
});

// ─── Mobile drawers ──────────────────────────────────────────────────────────

test('on a phone the library and sources drawers open and close from their buttons', async () => {
    const page = await openPage();
    try {
        page.media.set(MOBILE, true);
        const open = (id) => page.$(id).classList.contains('mobile-open');
        page.eval(`toggleMobilePanel('left')`);
        assert.equal(open('#leftSidebar'), true);
        assert.equal(page.document.body.classList.contains('mobile-panel-open'), true);

        page.eval(`toggleMobilePanel('left')`);
        assert.equal(open('#leftSidebar'), false);
        assert.equal(page.document.body.classList.contains('mobile-panel-open'), false);

        // Opening one drawer closes the other.
        page.eval(`toggleMobilePanel('left'); toggleMobilePanel('right')`);
        assert.equal(open('#rightSidebar'), true);
        assert.equal(open('#leftSidebar'), false);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('toggling a drawer does nothing on a desktop screen', async () => {
    const page = await openPage();
    try {
        page.eval(`toggleMobilePanel('left'); toggleMobilePanel('right')`);
        assert.equal(page.$('#leftSidebar').classList.contains('mobile-open'), false);
        assert.equal(page.$('#rightSidebar').classList.contains('mobile-open'), false);
        assert.equal(page.document.body.classList.contains('mobile-panel-open'), false);
    } finally {
        page.close();
    }
});

// ─── The date in the top bar ─────────────────────────────────────────────────

test('a date from the reader\'s location replaces the one the server drew, once', async () => {
    const page = await openPage(`
        refreshHebrewDateDisplay = window.__rec('refresh');
        syncHebrewDateMobilePosition = window.__rec('position');
    `);
    try {
        page.eval(`setLocationHebrewDate('  5 Cheshvan 5787 ')`);
        assert.equal(page.$('#hebrewDateDisplay').dataset.en, '5 Cheshvan 5787');
        assert.equal(page.eval('hebrewDateFromLocation'), true);
        assert.deepEqual(logOf(page).map(([name]) => name), ['refresh', 'position']);

        // The same date again: nothing to redraw.
        page.eval('window.__log.length = 0');
        page.eval(`setLocationHebrewDate('5 Cheshvan 5787')`);
        assert.deepEqual(logOf(page), []);

        // A new day drops the Hebrew text made from the old one.
        page.$('#hebrewDateDisplay').dataset.he = 'old';
        page.eval(`setLocationHebrewDate('6 Cheshvan 5787')`);
        assert.equal(page.$('#hebrewDateDisplay').dataset.en, '6 Cheshvan 5787');
        assert.equal(page.$('#hebrewDateDisplay').dataset.he, undefined);
        assert.equal(logOf(page).length, 2);
    } finally {
        page.close();
    }
});

test('an empty date, or a page without the date element, leaves the top bar alone', async () => {
    const page = await openPage(`refreshHebrewDateDisplay = window.__rec('refresh');`);
    try {
        const before = page.eval('hebrewDateFromLocation');
        page.eval(`setLocationHebrewDate('   ')`);
        page.eval('setLocationHebrewDate(null)');
        assert.equal(page.eval('hebrewDateFromLocation'), before);
        page.$('#hebrewDateDisplay').remove();
        page.eval(`setLocationHebrewDate('5 Cheshvan 5787')`);
        assert.deepEqual(logOf(page), []);
    } finally {
        page.close();
    }
});

// ─── Top-bar offsets ─────────────────────────────────────────────────────────

const rect = (properties) => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, ...properties });
const cssVar = (page, name) => page.document.documentElement.style.getPropertyValue(name);

function sizeBoxes(page, boxes) {
    page.window.__boxes = boxes;
    page.eval(`
        for (const [selector, box] of Object.entries(window.__boxes)) {
            const el = selector.startsWith('.') ? document.querySelector(selector) : document.getElementById(selector);
            el.getBoundingClientRect = () => box;
        }
    `);
}

test('the sticky bars are laid out below the top bar, whatever height it measures', async () => {
    const page = await openPage();
    try {
        sizeBoxes(page, { '.topbar': rect({ height: 72.4 }) });
        page.eval('syncReaderTopBarOffset()');
        assert.equal(cssVar(page, '--reader-topbar-offset'), '72px');
        // No reader open: the right sidebar starts where the top bar ends.
        assert.equal(cssVar(page, '--right-sidebar-top-offset'), '72px');

        sizeBoxes(page, { '.topbar': rect({ height: 0 }) });
        page.eval('syncReaderTopBarOffset()');
        assert.equal(cssVar(page, '--reader-topbar-offset'), '63px');
    } finally {
        page.close();
    }
});

test('with a text open the right sidebar starts below the reader bar too, at least 36px of it', async () => {
    const page = await openPage();
    try {
        page.$('#reader').classList.remove('hidden');
        page.$('#readerTopBar').classList.remove('hidden');
        sizeBoxes(page, { '.topbar': rect({ height: 60 }), readerTopBar: rect({ height: 50.2 }) });
        page.eval('syncReaderTopBarOffset()');
        assert.equal(cssVar(page, '--right-sidebar-top-offset'), '110px');

        sizeBoxes(page, { readerTopBar: rect({ height: 10 }) });
        page.eval('syncReaderTopBarOffset()');
        assert.equal(cssVar(page, '--right-sidebar-top-offset'), '96px');

        page.$('#readerTopBar').classList.add('hidden');
        page.eval('syncReaderTopBarOffset()');
        assert.equal(cssVar(page, '--right-sidebar-top-offset'), '60px');
    } finally {
        page.close();
    }
});

test('the reader bar keeps clear of a sidebar pinned to either edge', async () => {
    const page = await openPage();
    try {
        page.window.innerWidth = 1280;
        for (const id of ['#leftSidebar', '#rightSidebar']) {
            page.$(id).classList.remove('hidden');
            page.$(id).style.display = 'block';
        }
        sizeBoxes(page, {
            leftSidebar: rect({ left: 0, right: 300, width: 299.6 }),
            rightSidebar: rect({ left: 1000, right: 1280, width: 280 }),
        });
        page.eval('syncReaderTopBarOffset()');
        assert.equal(cssVar(page, '--reader-topbar-left-gap'), '300px');
        assert.equal(cssVar(page, '--reader-topbar-right-gap'), '280px');

        // A sidebar floating mid-page, a hidden one, or a sliver is not a gap.
        sizeBoxes(page, {
            leftSidebar: rect({ left: 40, right: 340, width: 300 }),
            rightSidebar: rect({ left: 1270, right: 1280, width: 10 }),
        });
        page.eval('syncReaderTopBarOffset()');
        assert.equal(cssVar(page, '--reader-topbar-left-gap'), '0px');
        assert.equal(cssVar(page, '--reader-topbar-right-gap'), '0px');

        sizeBoxes(page, { leftSidebar: rect({ left: 0, right: 300, width: 300 }) });
        page.$('#leftSidebar').classList.add('hidden');
        page.eval('syncReaderTopBarOffset()');
        assert.equal(cssVar(page, '--reader-topbar-left-gap'), '0px');

        // On a phone the drawers float over the page: no gaps at all.
        page.$('#leftSidebar').classList.remove('hidden');
        page.media.set(MOBILE, true);
        page.eval('syncReaderTopBarOffset()');
        assert.equal(cssVar(page, '--reader-topbar-left-gap'), '0px');
        assert.equal(cssVar(page, '--reader-topbar-right-gap'), '0px');
    } finally {
        page.close();
    }
});

// ─── Shul auto-scroll ────────────────────────────────────────────────────────

const SHUL = `
    window.__frames = [];
    window.requestAnimationFrame = (fn) => { window.__frames.push(fn); return window.__frames.length; };
    window.cancelAnimationFrame = (id) => window.__log.push(['cancel', id]);
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
`;

const shulOn = (speed) => `
    appState.prefs.shulMode = true;
    appState.prefs.shulAutoScroll = true;
    appState.prefs.shulScrollSpeed = ${speed};
`;
const frame = (page, timestamp) => page.eval(`window.__frames.shift()(${timestamp})`);
const scrollTops = (page) => page.scrolls.map(([options]) => options.top);

test('shul auto-scroll moves the page at the chosen speed, measured by the time between frames', async () => {
    const page = await openPage(SHUL);
    try {
        page.eval(`${shulOn(40)} startShulAutoScroll()`);
        assert.equal(page.$('#shulAutoScrollStatus').classList.contains('hidden'), false);
        assert.equal(page.eval('window.__frames.length'), 1);

        frame(page, 1000);
        assert.deepEqual(scrollTops(page), []);
        frame(page, 2000);
        assert.deepEqual(scrollTops(page), [40]);
        frame(page, 2500);
        assert.deepEqual(scrollTops(page), [40, 20]);
        assert.equal(page.eval('window.__frames.length'), 1);
    } finally {
        page.close();
    }
});

test('shul auto-scroll falls back to the default speed when none is set', async () => {
    const page = await openPage(SHUL);
    try {
        page.eval(`${shulOn(0)} startShulAutoScroll()`);
        frame(page, 0);
        frame(page, 1000);
        assert.deepEqual(scrollTops(page), [28]);
    } finally {
        page.close();
    }
});

test('shul auto-scroll stops at the bottom of the page', async () => {
    const page = await openPage(SHUL);
    try {
        Object.defineProperty(page.window, 'pageYOffset', { value: 4199, configurable: true });
        page.eval(`${shulOn(40)} startShulAutoScroll()`);
        frame(page, 1000);
        assert.deepEqual(scrollTops(page), []);
        assert.equal(page.eval('window.__frames.length'), 0);
        assert.equal(page.$('#shulAutoScrollStatus').classList.contains('hidden'), true);
        assert.deepEqual(logOf(page), [['cancel', 1]]);
    } finally {
        page.close();
    }
});

test('shul auto-scroll stops as soon as shul mode or auto-scroll is switched off', async () => {
    const page = await openPage(SHUL);
    try {
        page.eval(`${shulOn(40)} startShulAutoScroll()`);
        frame(page, 1000);
        page.eval('appState.prefs.shulAutoScroll = false');
        frame(page, 2000);
        assert.deepEqual(scrollTops(page), []);
        assert.equal(page.eval('window.__frames.length'), 0);
        assert.equal(page.$('#shulAutoScrollStatus').classList.contains('hidden'), true);

        // Switched off before it starts: it never takes a frame.
        page.eval('appState.prefs.shulMode = false; startShulAutoScroll()');
        assert.equal(page.eval('window.__frames.length'), 0);

        // Starting again replaces the running one.
        page.eval('window.__log.length = 0');
        page.eval(`${shulOn(40)} startShulAutoScroll(); startShulAutoScroll()`);
        assert.equal(logOf(page).filter(([name]) => name === 'cancel').length, 1);
    } finally {
        page.close();
    }
});

test('scrolling by a distance moves the page, or the main column when that is what scrolls', async () => {
    const page = await openPage();
    try {
        page.eval('scrollPrimaryBy(30)');
        assert.deepEqual(scrollTops(page), [30]);

        page.eval(`
            Object.defineProperty(mainContainer, 'scrollHeight', { value: 3000, configurable: true });
            Object.defineProperty(mainContainer, 'clientHeight', { value: 600, configurable: true });
            mainContainer.scrollTop = 100;
        `);
        page.eval('scrollPrimaryBy(25)');
        assert.equal(page.eval('mainContainer.scrollTop'), 125);
        assert.deepEqual(scrollTops(page), [30]);
    } finally {
        page.close();
    }
});

// ─── Scroll restore after the text re-renders ────────────────────────────────

function drawChunks(page) {
    page.eval(`
        window.currentTextPayloadChain = [{ ref: 'Genesis 1' }, { ref: 'Genesis 2' }, null];
        const host = document.getElementById('readerSources');
        host.replaceChildren();
        for (const index of [0, 1, 2]) {
            const el = document.createElement('div');
            el.dataset.textChunkIndex = String(index);
            el.getBoundingClientRect = () => ({ top: index === 1 ? 200 : 900, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
            host.append(el);
        }
        Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
    `);
}

const scrollState = (page, state) => page.eval(`restoreReaderScrollState(${state})`);
const ANCHOR_KEY = `getRefTrackingKey('Genesis 2')`;

test('after a re-render the section that was being read goes back to the same spot on screen', async () => {
    const page = await openPage();
    try {
        drawChunks(page);
        Object.defineProperty(page.window, 'pageYOffset', { value: 300, configurable: true });
        // It sat 50px from the top; it now sits 200px down: scroll 150 further.
        scrollState(page, `{ pageTarget: true, top: 100, anchorRefKey: ${ANCHOR_KEY}, anchorViewportTop: 50 }`);
        assert.deepEqual(page.scrolls.map(([options]) => ({ ...options })), [{ top: 450, behavior: 'instant' }]);
    } finally {
        page.close();
    }
});

test('with no section to go back to, the reader returns to the old offset, held inside the page', async () => {
    const page = await openPage();
    try {
        drawChunks(page);
        scrollState(page, `{ pageTarget: true, top: 120, anchorRefKey: 'genesis 9', anchorViewportTop: 0 }`);
        scrollState(page, `{ pageTarget: true, top: 80 }`);
        scrollState(page, `{ pageTarget: true, top: -50 }`);
        scrollState(page, `{ pageTarget: true, top: 999999 }`);
        scrollState(page, `{ pageTarget: true }`);
        assert.deepEqual(scrollTops(page), [120, 80, 0, 5000 - 768, 0]);
        assert.equal(page.eval('restoreReaderScrollState(null)'), undefined);
        assert.equal(page.scrolls.length, 5);
    } finally {
        page.close();
    }
});

test('a page whose main column scrolls is restored in that column', async () => {
    const page = await openPage(`
        Object.defineProperty(mainContainer, 'scrollHeight', { value: 3000, configurable: true });
        Object.defineProperty(mainContainer, 'clientHeight', { value: 600, configurable: true });
        mainContainer.scrollTop = 500;
        mainContainer.scrollTo = (options) => window.__log.push(['scrollTo', { ...options }]);
    `);
    try {
        drawChunks(page);
        scrollState(page, `{ pageTarget: false, top: 10, anchorRefKey: ${ANCHOR_KEY}, anchorViewportTop: 100 }`);
        scrollState(page, `{ pageTarget: false, top: 9000 }`);
        assert.deepEqual(logOf(page), [
            ['scrollTo', { top: 600, behavior: 'instant' }],
            ['scrollTo', { top: 2400, behavior: 'instant' }],
        ]);
        // The page itself, when the state was taken there.
        scrollState(page, `{ pageTarget: true, top: 7 }`);
        assert.deepEqual(scrollTops(page), [7]);
    } finally {
        page.close();
    }
});

// ─── A text that cannot be loaded ────────────────────────────────────────────

const RECORD_FAILURE = `
    hideReaderSkeleton = window.__rec('hideReaderSkeleton');
    applySidebarVisibility = window.__rec('applySidebarVisibility');
    renderReaderLoadError = window.__rec('renderReaderLoadError');
    clearReaderAfterLoadFailure = window.__rec('clearReaderAfterLoadFailure');
    logReliability = window.__rec('logReliability');
    reader.classList.add('hidden');
`;

test('a text that fails to load says why, shows the reader, and logs the failure', async () => {
    const page = await openPage(RECORD_FAILURE);
    try {
        page.window.__options = { fromRoute: true };
        page.eval(`showTextRuntimeError(new Error('  Network down '), 'Genesis 1', 'Genesis 1', window.__options)`);
        assert.equal(page.$('#reader').classList.contains('hidden'), false);
        assert.deepEqual(logOf(page), [
            ['hideReaderSkeleton', { loaded: false }],
            ['applySidebarVisibility'],
            ['renderReaderLoadError', 'Error loading text. Network down', 'Genesis 1', { fromRoute: true }],
            ['clearReaderAfterLoadFailure'],
            ['logReliability', 'text-load-runtime-error', { ref: 'Genesis 1', message: 'Network down' }],
        ]);
    } finally {
        page.close();
    }
});

test('a failure with no message gives the plain sentence, in Hebrew when the page is', async () => {
    const page = await openPage(`${RECORD_FAILURE} displayedLanguage = 'he';`);
    try {
        page.eval(`showTextRuntimeError(null, 'Genesis 1', '', {})`);
        const [, , render, , reliability] = logOf(page);
        assert.equal(render[1], 'שגיאה בטעינת הטקסט.');
        assert.deepEqual(reliability, ['logReliability', 'text-load-runtime-error', { ref: 'Genesis 1', message: 'unknown' }]);
    } finally {
        page.close();
    }
});
