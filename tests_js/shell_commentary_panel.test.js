/**
 * The commentary sidebar once it is open: the list that follows the verse the
 * reader is on, opening one commentary (cached, loading, translating, failing),
 * the preloaded texts it reads from, the hover/focus prefetch, and the
 * word-meaning refresh. The lookup that a text selection starts is covered in
 * shell_selection_insights.test.js. Boots the real home page in jsdom
 * (tests_js/helpers/shell_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');
const { GENESIS_1, textPayload } = require('./helpers/shell_data');

const plain = (value) => JSON.parse(JSON.stringify(value));
const LINKS_URL = '/api/sidebar/Genesis%201%3A1?stage=links';
const TEXTS_URL = '/api/sidebar/Genesis%201%3A1?stage=texts';
const RASHI_LINKS = {
    links: {
        Commentary: [
            { ref: 'Rashi on Genesis 1:1', collectiveTitle: { en: 'Rashi', he: 'רש״י' } },
            { ref: 'Rashi on Genesis 1:2', collectiveTitle: { en: 'Rashi', he: 'רש״י' } },
            { ref: 'Ramban on Genesis 1:1', collectiveTitle: { en: 'Ramban', he: 'רמב״ן' } },
        ],
    },
};
const COMMENTARY = (ref, lines, extra = {}) => textPayload(ref, lines, { categories: ['Tanakh', 'Commentary'], ...extra });
const RASHI_1 = COMMENTARY('Rashi on Genesis 1:1', [['1', 'בראשית', 'In the beginning, said Rashi']]);

async function readGenesis(routes = {}, pageOptions = {}) {
    const page = await openShellPage({
        fetch: { ...routes, '/api/text/Genesis%201': GENESIS_1 },
        ...pageOptions,
    });
    await page.eval(`readText('Genesis 1', { skipNavigationGrid: true })`);
    await page.settle();
    page.takeCalls();
    return page;
}

const body = (page) => page.$('#selectionInsightsBody').textContent.replace(/\s+/g, ' ').trim();
const hint = (page) => page.$('#selectionInsightsHint').textContent.trim();
const panelHidden = (page) => page.$('#selectionInsights').classList.contains('hidden');
const asked = (page, prefix) => page.calls.map((call) => call.url).filter((url) => url.startsWith(prefix));

/** A stand-in for the preloader main.js builds (static/js/commentary-preload.js is tested on its own). */
function fakePreloader(page, ref = '') {
    const preloader = {
        ref, options: null, refreshes: [], focused: [],
        refresh(options) { preloader.refreshes.push(options || null); },
        currentRef() { return preloader.ref; },
        focusRow(row) { preloader.focused.push(row); },
    };
    page.window.ShelahCommentaryPreload = { createCommentaryPreloader: (options) => { preloader.options = options; return preloader; } };
    return preloader;
}

// --- the commentary text, line by line ------------------------------------------

test('commentary lines show the segment, the Hebrew and the English, and skip empty ones', async () => {
    const page = await readGenesis();
    try {
        const html = page.call('renderInlineCommentaryLines', {
            lines: [
                { segment: '3', he: 'עברית', en: 'first\nsecond' },
                { segment: '4', he: '  ', en: '' },
                { segment: 7, en: 'only English' },
                { he: 'only Hebrew' },
            ],
        });
        const box = page.document.createElement('div');
        box.innerHTML = html;
        const articles = [...box.querySelectorAll('article')];
        assert.equal(articles.length, 3);
        assert.deepEqual(articles.map((article) => article.querySelector('p').textContent), ['3', '7', '4']);
        assert.equal(articles[0].querySelector('[dir=rtl]').textContent, 'עברית');
        assert.equal(articles[0].querySelector('[dir=ltr]').innerHTML, 'first<br>second');
        assert.equal(articles[1].querySelector('[dir=rtl]'), null);
        assert.equal(articles[2].querySelector('[dir=ltr]'), null);
    } finally {
        page.close();
    }
});

test('commentary text goes through the emphasis-only allowlist: no attributes, no other tags', async () => {
    const page = await readGenesis();
    try {
        const seen = [];
        page.window.DOMPurify = { sanitize: (html, options) => { seen.push([html, plain(options)]); return html; } };
        page.call('renderInlineCommentaryLines', { lines: [{ segment: '1', he: 'א<br>ב', en: 'one<sup>1</sup><i class="footnote">note</i> two' }] });
        assert.deepEqual(seen.map(([html]) => html), ['א\nב', 'one  two']);
        for (const [, options] of seen) {
            assert.deepEqual(options, { ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'small'], ALLOWED_ATTR: [] });
        }
    } finally {
        page.close();
    }
});

test('without DOMPurify, commentary markup is stripped and what is left is escaped', async () => {
    const page = await readGenesis();
    try {
        page.window.DOMPurify = undefined;
        const box = page.document.createElement('div');
        box.innerHTML = page.call('renderInlineCommentaryLines', {
            lines: [{ segment: '1', he: '<script>bad()</script>א', en: '<img src=x onerror=bad()> <b>kept</b> & more' }],
        });
        assert.equal(box.querySelector('script'), null);
        assert.equal(box.querySelector('img'), null);
        assert.equal(box.querySelector('[onerror]'), null);
        assert.equal(box.querySelector('b'), null, 'the fallback keeps no tags at all');
        assert.match(box.querySelector('[dir=ltr]').textContent, /kept & more/);
    } finally {
        page.close();
    }
});

test('commentary that comes as parallel he/en lists is numbered by position', async () => {
    const page = await readGenesis();
    try {
        const box = page.document.createElement('div');
        box.innerHTML = page.call('renderInlineCommentaryLines', { lines: [], he: ['א', '', 'ג'], en: ['one', '', 'three', 'four'] });
        const articles = [...box.querySelectorAll('article')];
        assert.deepEqual(articles.map((article) => article.querySelector('p').textContent), ['1', '3', '4']);
        assert.equal(articles[0].querySelector('[dir=rtl]').textContent, 'א');
        assert.equal(articles[2].querySelector('[dir=rtl]'), null);
        assert.equal(articles[2].querySelector('[dir=ltr]').textContent, 'four');
    } finally {
        page.close();
    }
});

test('commentary with no text says so, in the page language', async () => {
    const page = await readGenesis();
    try {
        for (const data of [null, {}, { lines: [{ segment: '1' }], he: [], en: [] }, { lines: [], he: ['', ' '] }]) {
            const html = page.call('renderInlineCommentaryLines', data);
            if (data?.he?.length) {
                assert.equal(html, '', 'blank parallel lists draw nothing');
            } else {
                assert.match(html, /No commentary text found for this reference/);
            }
        }
        page.eval(`t = (en, he) => he`);
        assert.match(page.call('renderInlineCommentaryLines', null), /לא נמצא טקסט פירוש/);
    } finally {
        page.close();
    }
});

// --- preloaded commentary texts ----------------------------------------------------

test('the preloaded texts land in the cache the chooser reads, once, with translated ones kept apart', async () => {
    const page = await readGenesis({
        [TEXTS_URL]: {
            texts: {
                'Rashi on Genesis 1:1': { lines: [{ segment: '1', he: 'א', en: 'one' }] },
                'Ramban on Genesis 1:1': { lines: [{ segment: '1', he: 'ב', en: 'two' }], translation_attempted: true },
                'Broken': { lines: 'nope' },
                'Empty': null,
            },
        },
    });
    try {
        await page.eval(`loadSidebarTexts('Genesis 1:1')`);
        await page.eval(`loadSidebarTexts('Genesis 1:1')`);
        assert.deepEqual(asked(page, '/api/sidebar/'), [TEXTS_URL], 'the second call is answered from memory');
        assert.deepEqual(plain(page.eval(`[...commentaryTextCache.keys()].filter((key) => !key.startsWith('Genesis'))`)).sort(),
            ['Ramban on Genesis 1:1\u0000t', 'Rashi on Genesis 1:1']);
    } finally {
        page.close();
    }
});

test('two loads of the same passage at once share one request, and a failed one can be retried', async () => {
    let answer = { status: 500, body: {} };
    const page = await readGenesis({ [TEXTS_URL]: () => answer });
    try {
        const first = page.eval(`loadSidebarTexts('Genesis 1:1')`);
        const second = page.eval(`loadSidebarTexts('Genesis 1:1')`);
        assert.equal(first, second, 'one promise');
        await assert.rejects(first, (error) => error.status === 500);
        assert.equal(asked(page, '/api/sidebar/').length, 1);

        answer = { texts: 'not an object' };
        await page.eval(`loadSidebarTexts('Genesis 1:1')`);
        assert.equal(asked(page, '/api/sidebar/').length, 2, 'a failure is not remembered');
        await page.eval(`loadSidebarTexts('Genesis 1:1')`);
        assert.equal(asked(page, '/api/sidebar/').length, 2, 'a success is');
    } finally {
        page.close();
    }
});

// --- opening one commentary --------------------------------------------------------

test('opening a commentary that was preloaded paints at once, with a back button and a labelled header', async () => {
    const page = await readGenesis({
        [TEXTS_URL]: {
            texts: { 'Rashi on Genesis 1:1': { lines: [{ segment: '1', he: 'בראשית', en: 'In the beginning' }], title: 'Rashi on Genesis 1:1', heTitle: 'רש״י על בראשית א׳:א׳' } },
        },
    });
    try {
        await page.eval(`loadSidebarTexts('Genesis 1:1')`);
        page.takeCalls();
        const opened = page.eval(`openCommentaryInline('  Rashi on Genesis 1:1  ')`);
        assert.match(body(page), /In the beginning/, 'painted before the first await resolves');
        await opened;
        assert.deepEqual(page.calls.filter((call) => call.url.startsWith('/api/text/')), []);
        assert.match(body(page), /Commentary Back to list/);
        assert.equal(page.$('#selectionInsightsBody h5').textContent, 'Rashi on Genesis 1:1 · רש״י על בראשית א׳:א׳');
        assert.equal(hint(page), 'Viewing commentary: Rashi on Genesis 1:1');
        assert.equal(page.$('#selectionInsightsBody').getAttribute('aria-busy'), 'false');
        assert.equal(plain(page.eval('selectionCommentaryState.activeCommentaryRef')), 'Rashi on Genesis 1:1');
    } finally {
        page.close();
    }
});

test('a commentary that is not cached shows a skeleton while it loads, then the text', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const page = await readGenesis({
        '/api/text/Rashi%20on%20Genesis%201%3A1': async () => { await gate; return { ...RASHI_1, title: 'Rashi on Genesis 1:1', heTitle: 'רש״י על בראשית א׳:א׳' }; },
    });
    try {
        const opened = page.eval(`openCommentaryInline('Rashi on Genesis 1:1')`);
        await page.settle(2);
        assert.equal(page.$$('#selectionInsightsBody .sk-reader-para').length, 4);
        assert.equal(page.$('#selectionInsightsBody').getAttribute('aria-busy'), 'true');
        assert.equal(hint(page), '');

        release();
        await opened;
        assert.match(body(page), /In the beginning, said Rashi/);
        assert.equal(page.$('#selectionInsightsBody h5').textContent, 'Rashi on Genesis 1:1 · רש״י על בראשית א׳:א׳');
        const fetches = asked(page, '/api/text/Rashi');
        assert.deepEqual(fetches.sort(), [
            '/api/text/Rashi%20on%20Genesis%201%3A1?autotranslate=0',
            '/api/text/Rashi%20on%20Genesis%201%3A1?autotranslate=1',
        ], 'the plain text and the translated one are asked for together');
    } finally {
        page.close();
    }
});

test('in Hebrew mode the header is the Hebrew title, falling back to the English one', async () => {
    const page = await readGenesis({
        '/api/text/Rashi%20on%20Genesis%201%3A1': { ...RASHI_1, heTitle: 'רש״י' },
        '/api/text/Ramban%20on%20Genesis%201%3A1': { ...COMMENTARY('Ramban on Genesis 1:1', [['1', 'ב', 'two']]), heTitle: '' },
    }, { storage: { preferredLanguage: 'he' } });
    try {
        await page.eval(`openCommentaryInline('Rashi on Genesis 1:1')`);
        assert.equal(page.$('#selectionInsightsBody h5').textContent, 'רש״י');
        await page.eval(`openCommentaryInline('Ramban on Genesis 1:1')`);
        assert.equal(page.$('#selectionInsightsBody h5').textContent, 'Ramban on Genesis 1:1');
        assert.match(body(page), /חזרה לרשימה/);
        assert.match(hint(page), /^מציג פירוש:/);
    } finally {
        page.close();
    }
});

test('Hebrew-only commentary is translated in the background and swapped in when it arrives', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const hebrewOnly = COMMENTARY('Rashi on Genesis 1:1', [['1', 'בראשית', '']]);
    const translated = COMMENTARY('Rashi on Genesis 1:1', [['1', 'בראשית', 'In the beginning (translated)']]);
    const page = await readGenesis({
        '/api/text/Rashi%20on%20Genesis%201%3A1?autotranslate=1': async () => { await gate; return translated; },
        '/api/text/Rashi%20on%20Genesis%201%3A1?autotranslate=0': hebrewOnly,
    });
    try {
        const opened = page.eval(`openCommentaryInline('Rashi on Genesis 1:1')`);
        await page.settle();
        assert.doesNotMatch(body(page), /translated/, 'the Hebrew paints without waiting for the translation');
        release();
        await opened;
        assert.match(body(page), /In the beginning \(translated\)/);
        assert.deepEqual(plain(page.eval(`[...commentaryTextCache.keys()].filter((key) => key.startsWith('Rashi'))`)).sort(),
            ['Rashi on Genesis 1:1', 'Rashi on Genesis 1:1\u0000t']);
    } finally {
        page.close();
    }
});

test('a translation that arrives before the plain text still ends up on screen', async () => {
    const hebrewOnly = COMMENTARY('Rashi on Genesis 1:1', [['1', 'בראשית', '']]);
    const translated = COMMENTARY('Rashi on Genesis 1:1', [['1', 'בראשית', 'In the beginning (translated)']]);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const page = await readGenesis({
        '/api/text/Rashi%20on%20Genesis%201%3A1?autotranslate=1': translated,
        '/api/text/Rashi%20on%20Genesis%201%3A1?autotranslate=0': async () => { await gate; return hebrewOnly; },
    });
    try {
        const opened = page.eval(`openCommentaryInline('Rashi on Genesis 1:1')`);
        await page.settle();
        assert.equal(page.eval(`commentaryTextCache.has('Rashi on Genesis 1:1\u0000t')`), true, 'the translation is already in');
        release();
        await opened;
        assert.match(body(page), /In the beginning \(translated\)/);
    } finally {
        page.close();
    }
});

test('a commentary that is already translated is not translated again', async () => {
    const page = await readGenesis({
        '/api/text/Rashi%20on%20Genesis%201%3A1': COMMENTARY('Rashi on Genesis 1:1', [['1', 'בראשית', 'complete']]),
    });
    try {
        await page.eval(`openCommentaryInline('Rashi on Genesis 1:1')`);
        await page.eval(`openCommentaryInline('Rashi on Genesis 1:1')`);
        assert.equal(asked(page, '/api/text/Rashi').length, 2, 'one plain and one translated request, the second open from memory');
    } finally {
        page.close();
    }
});

test('if the translation fails the untranslated text stays on screen', async () => {
    const hebrewOnly = COMMENTARY('Rashi on Genesis 1:1', [['1', 'בראשית', '']]);
    const page = await readGenesis({
        '/api/text/Rashi%20on%20Genesis%201%3A1?autotranslate=1': { status: 500, body: { error: 'translator down' } },
        '/api/text/Rashi%20on%20Genesis%201%3A1?autotranslate=0': hebrewOnly,
    });
    try {
        await page.eval(`openCommentaryInline('Rashi on Genesis 1:1')`);
        await page.settle();
        assert.match(body(page), /בראשית/);
        assert.doesNotMatch(body(page), /Unable to load/);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('a commentary that cannot be loaded offers a way back to the list', async () => {
    const page = await readGenesis({ '/api/text/Rashi%20on%20Genesis%201%3A1': { status: 500, body: { error: 'down' } } });
    try {
        await page.eval(`openCommentaryInline('Rashi on Genesis 1:1')`);
        assert.match(body(page), /Unable to load commentary text right now/);
        assert.match(body(page), /Back to linked commentaries/);
        assert.equal(hint(page), 'Could not load commentary.');
        assert.equal(page.$('#selectionInsightsBody').getAttribute('aria-busy'), 'false');
        assert.equal(plain(page.eval('selectionCommentaryState.activeCommentaryRef')), '');
        assert.ok(page.$('#selectionInsightsBody [data-onclick="renderSelectionInsightsChooser"]'));
        page.eval(`t = (en, he) => he`);
        await page.eval(`openCommentaryInline('Rashi on Genesis 1:1')`);
        assert.match(body(page), /לא ניתן לטעון כרגע/);
        assert.equal(hint(page), 'לא ניתן לטעון את הפירוש.');
    } finally {
        page.close();
    }
});

test('opening nothing does nothing, and a slow commentary never paints over a newer choice', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const page = await readGenesis({
        '/api/text/Rashi%20on%20Genesis%201%3A1': async () => { await gate; return RASHI_1; },
        '/api/text/Ramban%20on%20Genesis%201%3A1': COMMENTARY('Ramban on Genesis 1:1', [['1', 'ב', 'Ramban says']]),
    });
    try {
        await page.eval(`openCommentaryInline('')`);
        await page.eval(`openCommentaryInline(null)`);
        assert.deepEqual(page.calls, []);

        const slow = page.eval(`openCommentaryInline('Rashi on Genesis 1:1')`);
        await page.settle(2);
        await page.eval(`openCommentaryInline('Ramban on Genesis 1:1')`);
        assert.match(body(page), /Ramban says/);
        release();
        await slow;
        await page.settle();
        assert.match(body(page), /Ramban says/);
        assert.doesNotMatch(body(page), /said Rashi/);

        const failing = page.eval(`openCommentaryInline('Missing on Genesis 1:1')`);
        await page.eval(`openCommentaryInline('Ramban on Genesis 1:1')`);
        await failing;
        assert.match(body(page), /Ramban says/, 'a failure of a superseded request shows nothing either');
    } finally {
        page.close();
    }
});

test('the reader\'s place in a long commentary is kept when the translation replaces it', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const hebrewOnly = COMMENTARY('Rashi on Genesis 1:1', [['1', 'בראשית', '']]);
    const page = await readGenesis({
        '/api/text/Rashi%20on%20Genesis%201%3A1?autotranslate=1': async () => { await gate; return COMMENTARY('Rashi on Genesis 1:1', [['1', 'בראשית', 'translated']]); },
        '/api/text/Rashi%20on%20Genesis%201%3A1?autotranslate=0': hebrewOnly,
    });
    try {
        const opened = page.eval(`openCommentaryInline('Rashi on Genesis 1:1')`);
        await page.settle();
        page.$('#selectionInsightsBody [data-commentary-scroll]').scrollTop = 120;
        release();
        await opened;
        assert.match(body(page), /translated/);
        assert.equal(page.$('#selectionInsightsBody [data-commentary-scroll]').scrollTop, 120);
    } finally {
        page.close();
    }
});

test('swapContent fades replaced content in, or just replaces it without the motion library', async () => {
    const page = await readGenesis();
    try {
        const element = page.document.createElement('div');
        const fades = [];
        page.window.ShelahMotion = { fadeOpacity: (el, to, options) => { fades.push([el, to, plain(options)]); return Promise.resolve(); } };
        page.window.__el = element;
        page.eval(`swapContent(window.__el, () => { window.__el.dataset.seen = window.__el.style.opacity; })`);
        assert.equal(element.dataset.seen, '0', 'hidden while it is mutated');
        assert.deepEqual([fades[0][0] === element, fades[0][1], fades[0][2]], [true, 1, { duration: 0.15 }]);

        page.window.ShelahMotion = undefined;
        page.eval(`swapContent(window.__el, () => { window.__el.dataset.seen = window.__el.style.opacity; })`);
        assert.equal(element.dataset.seen, '0');
        assert.equal(element.style.opacity, '', 'back to its natural opacity');

        let ran = 0;
        page.window.__run = () => { ran += 1; };
        page.eval(`swapContent(null, window.__run)`);
        assert.equal(ran, 1, 'with nothing to fade the change still happens');
    } finally {
        page.close();
    }
});

// --- the chooser -------------------------------------------------------------------

test('commentators are grouped by author, best-known first, and a group fills in when it opens', async () => {
    const page = await readGenesis({ [LINKS_URL]: RASHI_LINKS });
    try {
        page.eval(`selectionCommentaryState.groupedCommentaries = groupCommentaryRefsByAuthor(['Ramban on Genesis 1:1', 'Rashi on Genesis 1:2', 'Rashi on Genesis 1:1'])`);
        page.eval('renderSelectionInsightsChooser()');
        const groups = page.$$('#selectionInsightsBody details');
        assert.deepEqual(groups.map((group) => group.querySelector('summary span').textContent), ['Rashi', 'Ramban']);
        assert.deepEqual(groups.map((group) => group.querySelector('summary span:last-child').textContent), ['2', '1']);
        assert.equal(groups[0].querySelector(':scope > div').childElementCount, 0, 'buttons are built on demand');

        page.window.__details = groups[0];
        page.eval('fillCommentaryGroup(window.__details)');
        const buttons = [...groups[0].querySelectorAll('button')];
        assert.deepEqual(buttons.map((button) => button.dataset.commentaryRef), ['Rashi on Genesis 1:1', 'Rashi on Genesis 1:2']);
        assert.equal(buttons[0].getAttribute('data-onclick'), 'openCommentaryInline');
        assert.equal(decodeURIComponent(buttons[0].getAttribute('data-onclick-arg')), 'Rashi on Genesis 1:1');
        assert.equal(buttons[0].getAttribute('dir'), 'ltr');
        assert.ok(buttons[0].classList.contains('text-start'));
        page.eval('fillCommentaryGroup(window.__details)');
        assert.equal(groups[0].querySelectorAll('button').length, 2, 'filling twice does not duplicate');
        page.eval('fillCommentaryGroup(null)');
    } finally {
        page.close();
    }
});

test('in Hebrew mode the commentary buttons read right to left and use the Hebrew names', async () => {
    const page = await readGenesis({}, { storage: { preferredLanguage: 'he' } });
    try {
        const html = page.call('renderCommentaryGroupRefs', { author: 'Rashi', refs: ['Rashi on Genesis 1:1'] });
        const box = page.document.createElement('div');
        box.innerHTML = html;
        const button = box.querySelector('button');
        assert.equal(button.getAttribute('dir'), 'rtl');
        assert.ok(button.classList.contains('text-end'));
        assert.match(button.textContent, /רש.י על בראשית/);
    } finally {
        page.close();
    }
});

test('a passage with no linked commentaries says so instead of drawing an empty list', async () => {
    const page = await readGenesis();
    try {
        assert.match(page.call('renderCommentaryChooser', []), /No linked commentaries found for this passage/);
        assert.match(page.call('renderCommentaryChooser', null), /No linked commentaries/);
        page.eval(`t = (en, he) => he`);
        assert.match(page.call('renderCommentaryChooser', []), /לא נמצאו מפרשים מקושרים/);
        assert.deepEqual(plain(page.call('groupCommentaryRefsByAuthor', null)), []);
        assert.equal(page.call('getCommentaryAuthorLabel', ''), 'פרשן לא ידוע');
    } finally {
        page.close();
    }
});

// --- intent prefetch -----------------------------------------------------------------

async function openChooser(routes = {}, pageOptions = {}) {
    const page = await readGenesis({ [LINKS_URL]: RASHI_LINKS, ...routes }, pageOptions);
    page.eval(`selectionCommentaryState.groupedCommentaries = groupCommentaryRefsByAuthor(['Rashi on Genesis 1:1', 'Rashi on Genesis 1:2', 'Ramban on Genesis 1:1'])`);
    page.eval('renderSelectionInsightsChooser()');
    const group = page.$('#selectionInsightsBody details');
    page.window.__details = group;
    page.eval('fillCommentaryGroup(window.__details)');
    page.takeCalls();
    return { page, group, button: group.querySelector('button') };
}

test('hovering a commentator for a moment starts loading its text before the click', async () => {
    const { page, button } = await openChooser({ '/api/text/Rashi%20on%20Genesis%201%3A1': RASHI_1 });
    try {
        const timers = [];
        page.window.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
        button.dispatchEvent(new page.window.Event('pointerover', { bubbles: true }));
        assert.deepEqual(timers.map((timer) => timer.ms), [90]);
        assert.deepEqual(page.calls, [], 'nothing before the dwell is up');
        timers[0].fn();
        await page.settle();
        assert.deepEqual(asked(page, '/api/text/'), ['/api/text/Rashi%20on%20Genesis%201%3A1?autotranslate=0']);

        page.takeCalls();
        page.$('#selectionInsightsBody').dispatchEvent(new page.window.Event('pointerover', { bubbles: true }));
        assert.equal(timers.length, 1, 'moving over the panel itself schedules nothing');
    } finally {
        page.close();
    }
});

test('pressing or focusing a commentator loads its text at once; a failure there is silent', async () => {
    const { page, button } = await openChooser({
        '/api/text/Rashi%20on%20Genesis%201%3A1': RASHI_1,
        '/api/text/Rashi%20on%20Genesis%201%3A2': { status: 500, body: { error: 'down' } },
    });
    try {
        button.dispatchEvent(new page.window.Event('pointerdown', { bubbles: true }));
        const second = page.$$('#selectionInsightsBody button')[1];
        second.dispatchEvent(new page.window.Event('focusin', { bubbles: true }));
        await page.settle();
        assert.deepEqual(asked(page, '/api/text/').sort(), [
            '/api/text/Rashi%20on%20Genesis%201%3A1?autotranslate=0',
            '/api/text/Rashi%20on%20Genesis%201%3A2?autotranslate=0',
        ]);
        page.$('#selectionInsightsBody').dispatchEvent(new page.window.Event('pointerdown', { bubbles: true }));
        await page.settle();
        assert.equal(asked(page, '/api/text/').length, 2);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('opening an author group fills it and loads the text of its first entry', async () => {
    const { page, group } = await openChooser({
        '/api/text/Rashi%20on%20Genesis%201%3A1': RASHI_1,
        '/api/text/Ramban%20on%20Genesis%201%3A1': COMMENTARY('Ramban on Genesis 1:1', [['1', 'ב', 'Ramban says']]),
    });
    try {
        const second = page.$$('#selectionInsightsBody details')[1];
        assert.equal(second.querySelector(':scope > div').childElementCount, 0);
        second.open = true;
        await page.settle();
        assert.equal(second.querySelectorAll('button').length, 1, 'the group was filled');
        assert.deepEqual(asked(page, '/api/text/'), ['/api/text/Ramban%20on%20Genesis%201%3A1?autotranslate=0']);

        page.takeCalls();
        second.open = false;
        await page.settle();
        assert.deepEqual(page.calls, [], 'closing one loads nothing');
        assert.equal(group.open, false);
    } finally {
        page.close();
    }
});

test('the prefetch is wired once however often the chooser is redrawn', async () => {
    const { page, button } = await openChooser({ '/api/text/Rashi%20on%20Genesis%201%3A1': RASHI_1 });
    try {
        page.eval('renderSelectionInsightsChooser()');
        page.eval('renderSelectionInsightsChooser()');
        page.window.__details = page.$('#selectionInsightsBody details');
        page.eval('fillCommentaryGroup(window.__details)');
        const redrawn = page.$('#selectionInsightsBody button');
        redrawn.dispatchEvent(new page.window.Event('pointerdown', { bubbles: true }));
        await page.settle();
        assert.equal(asked(page, '/api/text/').length, 1, 'one listener, one request');
        assert.notEqual(redrawn, button);
        assert.equal(page.eval(`prefetchCommentaryText('   ')`), undefined);
        assert.equal(page.eval(`prefetchCommentaryText(null)`), undefined);
    } finally {
        page.close();
    }
});

// --- commentary on the verse being read ---------------------------------------------

test('the Commentary button lists the commentary on the verse the reader is on', async () => {
    const page = await readGenesis({ [LINKS_URL]: RASHI_LINKS });
    try {
        const preloader = fakePreloader(page, 'Genesis 1:1');
        await page.eval('startReadingCommentary()');
        assert.deepEqual(plain(preloader.refreshes.at(-1)), { immediate: true });
        assert.equal(panelHidden(page), false);
        assert.equal(plain(page.eval('selectionCommentaryState.mode')), 'reading');
        assert.equal(plain(page.eval('selectionCommentaryState.readingRef')), 'Genesis 1:1');
        assert.match(body(page), /Linked Commentaries/);
        assert.match(body(page), /Rashi/);
        assert.equal(hint(page), 'Commentary on Genesis 1:1');
        assert.equal(page.window.localStorage.getItem('shelahCommentaryHintSeen'), '1', 'the one-time pulse is retired');
    } finally {
        page.close();
    }
});

test('the first look at a verse shows a skeleton; a repeat does not', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const page = await readGenesis({ [LINKS_URL]: async () => { await gate; return RASHI_LINKS; } });
    try {
        fakePreloader(page, 'Genesis 1:1');
        const started = page.eval('startReadingCommentary()');
        await page.settle(2);
        assert.equal(page.$$('#selectionInsightsBody .sk-reader-para').length, 4);
        assert.equal(page.$('#selectionInsightsBody').getAttribute('aria-busy'), 'true');
        release();
        await started;
        await page.eval(`renderReadingCommentary('Genesis 1:1')`);
        assert.equal(page.$$('#selectionInsightsBody .sk-reader-para').length, 0);
    } finally {
        page.close();
    }
});

test('with no preloader or no verse yet, opening the panel just shows the hint', async () => {
    const page = await readGenesis();
    try {
        await page.eval('startReadingCommentary()');
        assert.equal(panelHidden(page), false);
        assert.equal(body(page), '');
        assert.match(hint(page), /Highlight a passage/);

        const preloader = fakePreloader(page, '');
        await page.eval('startReadingCommentary()');
        assert.deepEqual(plain(preloader.refreshes.at(-1)), { immediate: true });
        assert.match(hint(page), /Highlight a passage/);
        assert.equal(page.calls.some((call) => call.url.startsWith('/api/sidebar/')), false);
    } finally {
        page.close();
    }
});

test('a verse with no commentary says so; in a Torah text it still offers Rashi', async () => {
    const daf = textPayload('Berakhot 2a', [['1', 'מאימתי', 'From when']], { categories: ['Talmud', 'Bavli'] });
    const page = await openShellPage({ fetch: { '/api/text/Berakhot%202a': daf } });
    try {
        await page.eval(`readText('Berakhot 2a', { skipNavigationGrid: true })`);
        await page.settle();
        fakePreloader(page, 'Berakhot 2a:1');
        await page.eval('startReadingCommentary()');
        assert.match(body(page), /No linked commentaries found for this passage/);
        assert.equal(page.$('#selectionInsightsBody').getAttribute('aria-busy'), 'false');
        assert.deepEqual(plain(page.eval('selectionCommentaryState.groupedCommentaries')), []);
    } finally {
        page.close();
    }
    const torah = await readGenesis({});
    try {
        fakePreloader(torah, 'Genesis 1:1');
        await torah.eval('startReadingCommentary()');
        assert.match(body(torah), /Rashi/);
        torah.eval(`renderReadingCommentary('Genesis 1')`);
        await torah.settle();
        assert.equal(plain(torah.eval('selectionCommentaryState.groupedCommentaries'))[0].refs[0], 'Rashi on Genesis 1:1');
    } finally {
        torah.close();
    }
});

test('an older verse lookup never paints over the verse the reader has moved to', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const page = await readGenesis({
        [LINKS_URL]: async () => { await gate; return RASHI_LINKS; },
        '/api/sidebar/Genesis%201%3A2?stage=links': { links: { Commentary: [{ ref: 'Sforno on Genesis 1:2', collectiveTitle: { en: 'Sforno' } }] } },
    });
    try {
        const preloader = fakePreloader(page, 'Genesis 1:1');
        page.eval(`selectionCommentaryState.mode = 'reading'`);
        const slow = page.eval(`renderReadingCommentary('Genesis 1:1')`);
        await page.settle(2);
        preloader.ref = 'Genesis 1:2';
        await page.eval(`renderReadingCommentary('Genesis 1:2')`);
        assert.match(body(page), /Sforno/);
        release();
        await slow;
        await page.settle();
        assert.match(body(page), /Sforno/);
        assert.doesNotMatch(body(page), /Ramban/);

        await page.eval(`selectionCommentaryState.mode = 'selection'`);
        const abandoned = page.eval(`renderReadingCommentary('Genesis 1:3')`);
        await page.eval(`selectionCommentaryState.mode = 'selection'`);
        await abandoned;
        assert.doesNotMatch(body(page), /Genesis 1:3/);
        assert.equal(await page.eval(`renderReadingCommentary('')`), undefined);
    } finally {
        page.close();
    }
});

test('back to the list after reading on lists the verse the reader is on now', async () => {
    const page = await readGenesis({
        [LINKS_URL]: RASHI_LINKS,
        '/api/sidebar/Genesis%201%3A2?stage=links': { links: { Commentary: [{ ref: 'Sforno on Genesis 1:2', collectiveTitle: { en: 'Sforno' } }] } },
        '/api/text/Rashi%20on%20Genesis%201%3A1': RASHI_1,
    });
    try {
        const preloader = fakePreloader(page, 'Genesis 1:1');
        await page.eval('startReadingCommentary()');
        await page.eval(`openCommentaryInline('Rashi on Genesis 1:1')`);
        assert.match(body(page), /said Rashi/);

        preloader.ref = 'Genesis 1:2';
        page.eval('renderSelectionInsightsChooser()');
        await page.settle();
        assert.match(body(page), /Sforno/);
        assert.equal(hint(page), 'Commentary on Genesis 1:2');
        assert.equal(plain(page.eval('selectionCommentaryState.activeCommentaryRef')), '');

        preloader.ref = 'Genesis 1:2';
        page.eval('renderSelectionInsightsChooser()');
        await page.settle();
        assert.match(body(page), /Sforno/, 'the verse the list is for is the one being read: a plain redraw');
    } finally {
        page.close();
    }
});

test('the chooser is hidden when the verse has neither commentary nor a word meaning', async () => {
    const page = await readGenesis();
    try {
        await page.eval('showSelectionInsights()');
        page.eval(`selectionCommentaryState.groupedCommentaries = []; selectionCommentaryState.wordInfo = null`);
        page.eval('renderSelectionInsightsChooser()');
        assert.equal(panelHidden(page), true);
        assert.equal(body(page), '');
        page.eval(`selectionCommentaryState.groupedCommentaries = null`);
        page.eval('renderSelectionInsightsChooser()');
        assert.equal(panelHidden(page), true);
    } finally {
        page.close();
    }
});

test('the reading hint names the verse in Hebrew in Hebrew mode', async () => {
    const page = await readGenesis({ [LINKS_URL]: RASHI_LINKS }, { storage: { preferredLanguage: 'he' } });
    try {
        fakePreloader(page, 'Genesis 1:1');
        await page.eval('startReadingCommentary()');
        assert.match(hint(page), /^פירושים על /);
        assert.doesNotMatch(hint(page), /Genesis/);
        assert.equal(page.call('readingRefLabel', ''), '');
    } finally {
        page.close();
    }
});

// --- what the preloader is given -------------------------------------------------------

test('the preloader is built once, and only when the module that provides it has loaded', async () => {
    const page = await readGenesis();
    try {
        assert.equal(page.eval('ensureCommentaryPreloader()'), null, 'main.js has not run yet: try again later');
        const preloader = fakePreloader(page);
        const built = page.eval('ensureCommentaryPreloader()');
        assert.equal(built, preloader);
        assert.equal(page.eval('ensureCommentaryPreloader()'), preloader, 'the same one');
        page.window.dispatchEvent(new page.window.Event('load'));
    } finally {
        page.close();
    }
});

test('the preloader is told how to find verses, what is eligible, and what to fetch', async () => {
    const page = await readGenesis({
        [LINKS_URL]: RASHI_LINKS,
        [TEXTS_URL]: { texts: { 'Rashi on Genesis 1:1': { lines: [{ segment: '1', he: 'א', en: 'one' }] } } },
        '/api/sidebar/Genesis%201%3A2?stage=links': { links: {} },
        '/api/sidebar/Genesis%201%3A3?stage=links': { status: 500, body: {} },
        '/api/text/Genesis%201%3A3/links': { status: 404, body: {} },
    });
    try {
        const preloader = fakePreloader(page);
        page.eval('ensureCommentaryPreloader()');
        const { options } = preloader;

        const row = page.$('#readerSources .segment-row[data-segment="1"]');
        assert.equal(options.resolveRef(row), 'Genesis 1:1');
        assert.equal(options.resolveRef(null), '');
        assert.equal(options.isEligible(), true);
        page.eval(`window.currentTextPayload = { ...window.currentTextPayload, categories: ['Liturgy'] }`);
        assert.equal(options.isEligible(), false);
        page.eval(`window.currentTextPayload = { ...window.currentTextPayload, categories: ['Tanakh'] }`);
        assert.ok(options.getScrollEl, 'the reader\'s scroll element is supplied');

        const links = await options.loadLinks('Genesis 1:1');
        assert.equal(links.resolvedRef, 'Genesis 1:1');
        await options.loadTexts('Genesis 1:1');
        assert.deepEqual(asked(page, '/api/sidebar/Genesis%201%3A1?stage=texts'), [TEXTS_URL]);

        page.takeCalls();
        assert.equal(await options.loadLinks('Genesis 1:2'), null, 'a verse with no commentary is not an error');
        await options.loadTexts('Genesis 1:2');
        assert.deepEqual(asked(page, '/api/sidebar/Genesis%201%3A2?stage=texts'), [], 'a verse with no commentary has no text to preload');
        await assert.rejects(options.loadLinks('Genesis 1:3'), (error) => error.status === 404, 'a failed request rejects with its status');
    } finally {
        page.close();
    }
});

test('a verse the preloader reaches updates the panel only while it is following the reading', async () => {
    const page = await readGenesis({
        [LINKS_URL]: RASHI_LINKS,
        '/api/sidebar/Genesis%201%3A2?stage=links': { links: { Commentary: [{ ref: 'Sforno on Genesis 1:2', collectiveTitle: { en: 'Sforno' } }] } },
        '/api/sidebar/Genesis%201%3A3?stage=links': { links: { Commentary: [{ ref: 'Ibn Ezra on Genesis 1:3', collectiveTitle: { en: 'Ibn Ezra' } }] } },
    });
    try {
        const preloader = fakePreloader(page, 'Genesis 1:1');
        await page.eval('startReadingCommentary()');

        preloader.ref = 'Genesis 1:2';
        preloader.options.onReadingRef('Genesis 1:2');
        await page.settle();
        assert.match(body(page), /Sforno/, 'following: the list moves to the new verse');

        page.eval(`selectionCommentaryState.activeCommentaryRef = 'Sforno on Genesis 1:2'`);
        preloader.ref = 'Genesis 1:3';
        preloader.options.onReadingRef('Genesis 1:3');
        await page.settle();
        assert.doesNotMatch(body(page), /Ibn Ezra/, 'a commentary is open: leave it alone');

        page.eval(`selectionCommentaryState.activeCommentaryRef = ''; hideSelectionInsights()`);
        preloader.options.onReadingRef('Genesis 1:3');
        await page.settle();
        assert.doesNotMatch(body(page), /Ibn Ezra/, 'the panel is closed');

        page.eval(`showSelectionInsights(); selectionCommentaryState.mode = 'selection'`);
        preloader.options.onReadingRef('Genesis 1:3');
        await page.settle();
        assert.doesNotMatch(body(page), /Ibn Ezra/, 'a selection lookup owns the panel');
    } finally {
        page.close();
    }
});

test('pressing on a verse hands it to the preloader; without one, its commentary is fetched directly', async () => {
    const page = await readGenesis({ [LINKS_URL]: RASHI_LINKS });
    try {
        const row = page.$('#readerSources .segment-row[data-segment="1"]');
        const press = (target) => page.eval(`prefetchSegmentCommentaryLinks({ target: window.__target })`);
        page.window.__target = row.querySelector('.source-en p');
        press();
        await page.settle();
        assert.deepEqual(asked(page, '/api/sidebar/'), [LINKS_URL], 'no preloader yet: the links are fetched');

        page.takeCalls();
        const preloader = fakePreloader(page);
        press();
        assert.deepEqual(preloader.focused, [row]);
        assert.deepEqual(page.calls, []);

        page.window.__target = page.$('#readerContent');
        press();
        page.window.__target = null;
        press();
        assert.equal(preloader.focused.length, 1, 'not on a verse');

        page.eval(`window.currentTextPayload = { ...window.currentTextPayload, categories: ['Liturgy'] }`);
        page.window.__target = row;
        press();
        assert.equal(preloader.focused.length, 1, 'not an eligible text');
    } finally {
        page.close();
    }
});

// --- the word meaning ------------------------------------------------------------------

const WORD = (word = 'beginning') => `selectionCommentaryState.wordInfo = { word: '${word}', meaning: '', alternatives: [] }`;

test('refreshing the word meaning with no word does nothing', async () => {
    const page = await readGenesis();
    try {
        await page.eval('refreshSelectionWordMeaning()');
        page.eval(`selectionCommentaryState.wordInfo = { word: '   ' }`);
        await page.eval('refreshSelectionWordMeaning()');
        assert.deepEqual(page.calls, []);
    } finally {
        page.close();
    }
});

test('the refreshed meaning redraws the list; the language follows the word and the page', async () => {
    const page = await readGenesis({
        '/api/word/meaning': { word: 'start', meaning: 'the beginning of things', alternatives: ['origin', 'dawn'] },
        [LINKS_URL]: RASHI_LINKS,
    });
    try {
        page.eval(`selectionCommentaryState.groupedCommentaries = groupCommentaryRefsByAuthor(['Rashi on Genesis 1:1'])`);
        page.eval(WORD());
        await page.eval('refreshSelectionWordMeaning()');
        assert.deepEqual(asked(page, '/api/word/meaning'), ['/api/word/meaning?word=beginning&lang=en']);
        assert.match(body(page), /Word Meaning/);
        assert.match(body(page), /start: the beginning of things/);
        assert.match(body(page), /origin · dawn/);
        assert.deepEqual(plain(page.eval('selectionCommentaryState.wordInfo')), { word: 'start', meaning: 'the beginning of things', alternatives: ['origin', 'dawn'] });

        page.eval(`isHebrewMode = () => true`);
        page.eval(WORD('בראשית'));
        await page.eval('refreshSelectionWordMeaning()');
        page.eval(WORD('word'));
        await page.eval('refreshSelectionWordMeaning()');
        assert.deepEqual(asked(page, '/api/word/meaning').slice(1).map((url) => url.split('&').pop()), ['lang=en', 'lang=he'],
            'a Hebrew word is asked for in English, an English one in Hebrew');
    } finally {
        page.close();
    }
});

test('a meaning with no word of its own keeps the one that was asked for', async () => {
    const page = await readGenesis({ '/api/word/meaning': { meaning: 'the start', alternatives: 'not a list' } });
    try {
        page.eval(`selectionCommentaryState.groupedCommentaries = groupCommentaryRefsByAuthor(['Rashi on Genesis 1:1'])`);
        page.eval(WORD());
        await page.eval('refreshSelectionWordMeaning()');
        assert.deepEqual(plain(page.eval('selectionCommentaryState.wordInfo')), { word: 'beginning', meaning: 'the start', alternatives: [] });
    } finally {
        page.close();
    }
});

test('a refresh that fails, or answers nothing, leaves the panel as it was', async () => {
    for (const answer of [{ status: 500, body: {} }, { word: 'beginning', meaning: '' }, () => { throw new Error('offline'); }]) {
        const page = await readGenesis({ '/api/word/meaning': answer });
        try {
            page.eval(WORD());
            await page.eval('refreshSelectionWordMeaning()');
            assert.equal(plain(page.eval('selectionCommentaryState.wordInfo.meaning')), '');
            assert.equal(body(page), '');
            assert.deepEqual(page.errors, []);
        } finally {
            page.close();
        }
    }
});

test('with a commentary open, the refreshed meaning reloads that commentary instead of the list', async () => {
    const page = await readGenesis({
        '/api/word/meaning': { word: 'beginning', meaning: 'the start', alternatives: [] },
        '/api/text/Rashi%20on%20Genesis%201%3A1': RASHI_1,
    });
    try {
        page.eval(WORD());
        page.eval(`selectionCommentaryState.activeCommentaryRef = 'Rashi on Genesis 1:1'`);
        await page.eval('refreshSelectionWordMeaning()');
        assert.match(body(page), /said Rashi/);
        assert.doesNotMatch(body(page), /Word Meaning/);
    } finally {
        page.close();
    }
});

// --- Rashi from the library ---------------------------------------------------------------

test('Rashi from the library opens Rashi on the passage being read, in the sidebar', async () => {
    const page = await readGenesis({ '/api/text/Rashi%20on%20Genesis%201%3A1': RASHI_1 });
    try {
        await page.eval(`appState.prefs.showRightSidebar = false`);
        await page.eval('openRashiCommentaryFromLibrary()');
        assert.equal(panelHidden(page), false);
        assert.match(body(page), /said Rashi/);
        assert.equal(plain(page.eval('appState.prefs.showRightSidebar')), true, 'a hidden sidebar is brought back');
        assert.equal(plain(page.eval('selectionCommentaryState.activeCommentaryRef')), 'Rashi on Genesis 1:1');
    } finally {
        page.close();
    }
});

test('Rashi from the library starts at verse one of a bare Torah chapter, and leaves other refs alone', async () => {
    const page = await readGenesis({
        '/api/text/Rashi%20on%20Genesis%201%3A1': RASHI_1,
        '/api/text/Rashi%20on%20Genesis%201%3A5': COMMENTARY('Rashi on Genesis 1:5', [['1', 'ויקרא', 'Called']]),
        '/api/text/Rashi%20on%20Isaiah%201': COMMENTARY('Rashi on Isaiah 1', [['1', 'ישעיהו', 'Isaiah']]),
    });
    try {
        page.eval(`window.currentTextPayload = { ref: 'Genesis 1', categories: ['Tanakh'] }`);
        await page.eval('openRashiCommentaryFromLibrary()');
        assert.equal(plain(page.eval('selectionCommentaryState.activeCommentaryRef')), 'Rashi on Genesis 1:1');

        page.eval(`window.currentTextPayload = { ref: 'Genesis 1:5', categories: ['Tanakh'] }`);
        await page.eval('openRashiCommentaryFromLibrary()');
        assert.equal(plain(page.eval('selectionCommentaryState.activeCommentaryRef')), 'Rashi on Genesis 1:5');

        page.eval(`window.currentTextPayload = { ref: 'Isaiah 1', categories: ['Tanakh'] }`);
        await page.eval('openRashiCommentaryFromLibrary()');
        assert.equal(plain(page.eval('selectionCommentaryState.activeCommentaryRef')), 'Rashi on Isaiah 1');
    } finally {
        page.close();
    }
});

test('Rashi from the library with nothing open first opens Genesis 1, and on a phone uses the drawer', async () => {
    const page = await openShellPage({
        fetch: { '/api/text/Genesis%201': GENESIS_1, '/api/text/Rashi%20on%20Genesis%201%3A1': RASHI_1 },
    });
    try {
        page.media.set('(max-width: 1023px)', true);
        await page.eval('openRashiCommentaryFromLibrary()');
        await page.settle();
        assert.equal(plain(page.eval('window.currentTextPayload.ref')), 'Genesis 1');
        assert.equal(plain(page.eval('selectionCommentaryState.activeCommentaryRef')), 'Rashi on Genesis 1:1');
        assert.ok(page.$('#rightSidebar').classList.contains('mobile-open'));
    } finally {
        page.close();
    }
});
