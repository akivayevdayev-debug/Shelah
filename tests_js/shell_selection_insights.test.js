/**
 * Selecting words in the reader: the commentary sidebar that opens for the
 * selection (linked commentaries, a single word's meaning), what it does when
 * there is nothing to show, and that a slower, older lookup never paints over
 * a newer one. Boots the real home page in jsdom
 * (tests_js/helpers/shell_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');
const { GENESIS_1, textPayload } = require('./helpers/shell_data');

const RASHI_LINKS = {
    links: {
        Commentary: [
            { ref: 'Rashi on Genesis 1:1', heRef: 'רש״י על בראשית א׳:א׳', collectiveTitle: { en: 'Rashi', he: 'רש״י' } },
            { ref: 'Ramban on Genesis 1:1', collectiveTitle: { en: 'Ramban', he: 'רמב״ן' } },
        ],
        Targum: [{ ref: 'Onkelos Genesis 1:1', collectiveTitle: { en: 'Onkelos Genesis' } }],
        Reference: [{ ref: 'Jastrow, Beit 1' }],
    },
};
const SIDEBAR_VERSE_1 = '/api/sidebar/Genesis%201%3A1';
const MEANING = { word: 'beginning', meaning: 'the start', alternatives: ['start', 'The Start', 'origin', 'source', 'root'] };

async function readGenesis(routes = {}, pageOptions = {}) {
    const page = await openShellPage({
        fetch: { '/api/text/Genesis%201': GENESIS_1, ...routes },
        ...pageOptions,
    });
    await page.eval(`readText('Genesis 1', { skipNavigationGrid: true })`);
    await page.settle();
    page.takeCalls();
    return page;
}

/** Selects characters [from, to) of the English text of one verse. */
function select(page, text, segment = '1') {
    const node = page.$(`#readerSources .segment-row[data-segment="${segment}"] .source-en p`).firstChild;
    const start = node.data.indexOf(text);
    assert.notEqual(start, -1, `"${text}" is not in verse ${segment}`);
    const range = page.document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + text.length);
    const selection = page.window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
}

async function lookup(page) {
    const done = page.eval('updateSelectionInsights()');
    await page.settle();
    return done;
}

const panelHidden = (page) => page.$('#selectionInsights').classList.contains('hidden');
const body = (page) => page.$('#selectionInsightsBody').textContent.replace(/\s+/g, ' ').trim();
const hint = (page) => page.$('#selectionInsightsHint').textContent.trim();

test('selecting a phrase lists the commentators linked to that verse, best-known first', async () => {
    const page = await readGenesis({ [SIDEBAR_VERSE_1]: RASHI_LINKS });
    try {
        select(page, 'God created');
        await lookup(page);
        assert.equal(panelHidden(page), false);
        assert.equal(hint(page), 'Selected text: God created');
        assert.match(body(page), /Linked Commentaries/);
        assert.match(body(page), /Rashi/);
        assert.match(body(page), /Ramban/);
        assert.doesNotMatch(body(page), /Word Meaning/);
        assert.equal(page.$('#selectionInsightsBody').getAttribute('aria-busy'), 'false');
        assert.ok(page.calls.some((call) => call.url.startsWith(`${SIDEBAR_VERSE_1}?stage=links`)));
        assert.equal(page.calls.some((call) => call.url.startsWith('/api/word/meaning')), false);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('selecting one word also shows its meaning and the other renderings, once, without repeating it', async () => {
    const page = await readGenesis({ [SIDEBAR_VERSE_1]: RASHI_LINKS, '/api/word/meaning': MEANING });
    try {
        select(page, 'beginning');
        await lookup(page);
        assert.match(body(page), /Word Meaning/);
        assert.match(body(page), /beginning: the start/);
        assert.match(body(page), /start · origin · source/);
        assert.doesNotMatch(body(page), /The Start/);
        assert.doesNotMatch(body(page), /root/);
        assert.match(body(page), /Linked Commentaries/);
        const meaningCall = page.calls.find((call) => call.url.startsWith('/api/word/meaning'));
        assert.equal(meaningCall.url, '/api/word/meaning?word=beginning&lang=en');
    } finally {
        page.close();
    }
});

test('in Hebrew mode the meaning of an English word is asked for in Hebrew', async () => {
    const page = await readGenesis({ [SIDEBAR_VERSE_1]: RASHI_LINKS, '/api/word/meaning': MEANING }, { storage: { preferredLanguage: 'he' } });
    try {
        select(page, 'beginning');
        await lookup(page);
        const meaningCall = page.calls.find((call) => call.url.startsWith('/api/word/meaning'));
        assert.equal(meaningCall.url, '/api/word/meaning?word=beginning&lang=he');
    } finally {
        page.close();
    }
});

test('a lookup that fails or answers nothing for the word still shows the commentators', async () => {
    for (const word of [{ status: 500, body: {} }, { word: 'beginning', meaning: '' }]) {
        const page = await readGenesis({ [SIDEBAR_VERSE_1]: RASHI_LINKS, '/api/word/meaning': word });
        try {
            select(page, 'beginning');
            await lookup(page);
            assert.doesNotMatch(body(page), /Word Meaning/);
            assert.match(body(page), /Linked Commentaries/);
        } finally {
            page.close();
        }
    }
});

test('a word the lexicon does not know says "No definition found" beside the commentators, and opens nothing alone', async () => {
    const notFound = { status: 404, body: { word: 'beginning', meaning: '', alternatives: [], status: 'not_found' } };
    const page = await readGenesis({ [SIDEBAR_VERSE_1]: RASHI_LINKS, '/api/word/meaning': notFound });
    try {
        select(page, 'beginning');
        await lookup(page);
        assert.match(body(page), /Word Meaning/);
        assert.match(body(page), /beginning: No definition found/);
        assert.match(body(page), /Linked Commentaries/);
    } finally {
        page.close();
    }

    const daf = textPayload('Berakhot 2a', [['1', 'מאימתי', 'From when']], { categories: ['Talmud', 'Bavli'] });
    const bare = await openShellPage({ fetch: { '/api/text/Berakhot%202a': daf, '/api/word/meaning': notFound } });
    try {
        await bare.eval(`readText('Berakhot 2a', { skipNavigationGrid: true })`);
        await bare.settle();
        select(bare, 'From');
        await lookup(bare);
        assert.equal(panelHidden(bare), true);
        assert.doesNotMatch(body(bare), /No definition found/);
    } finally {
        bare.close();
    }
});

test('the commentators appear without waiting for a slow word meaning, which joins them when it lands', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const page = await readGenesis({
        [SIDEBAR_VERSE_1]: RASHI_LINKS,
        '/api/word/meaning': async () => { await gate; return MEANING; },
    });
    try {
        select(page, 'beginning');
        await lookup(page);
        assert.match(body(page), /Linked Commentaries/);
        assert.doesNotMatch(body(page), /Word Meaning/);

        release();
        await page.settle();
        assert.match(body(page), /Word Meaning/);
        assert.match(body(page), /beginning: the start/);
    } finally {
        page.close();
    }
});

test('a late word meaning does not redraw the list over a commentary the reader already opened', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const page = await readGenesis({
        [SIDEBAR_VERSE_1]: RASHI_LINKS,
        '/api/word/meaning': async () => { await gate; return MEANING; },
        '/api/text/Rashi%20on%20Genesis%201%3A1': textPayload('Rashi on Genesis 1:1', [['1', 'בראשית', 'In the beginning, said Rashi']], { categories: ['Tanakh', 'Commentary'] }),
    });
    try {
        select(page, 'beginning');
        await lookup(page);
        await page.eval(`openCommentaryInline('Rashi on Genesis 1:1')`);
        await page.settle();
        assert.match(body(page), /said Rashi/);

        release();
        await page.settle();
        assert.match(body(page), /said Rashi/);
        assert.doesNotMatch(body(page), /Word Meaning/);
    } finally {
        page.close();
    }
});

test('with no commentary to show, the meaning of the word waits for and is shown alone', async () => {
    const daf = textPayload('Berakhot 2a', [['1', 'מאימתי', 'From when']], { categories: ['Talmud', 'Bavli'] });
    const page = await openShellPage({ fetch: { '/api/text/Berakhot%202a': daf, '/api/word/meaning': async () => ({ ...MEANING, word: 'From' }) } });
    try {
        await page.eval(`readText('Berakhot 2a', { skipNavigationGrid: true })`);
        await page.settle();
        select(page, 'From');
        await lookup(page);
        assert.equal(panelHidden(page), false);
        assert.match(body(page), /Word Meaning/);
        assert.match(body(page), /From: the start/);
        assert.doesNotMatch(body(page), /Linked Commentaries/);
    } finally {
        page.close();
    }
});

test('a Torah verse with no linked commentary still offers Rashi on that verse', async () => {
    const page = await readGenesis({});
    try {
        select(page, 'God created');
        await lookup(page);
        assert.match(body(page), /Rashi/);
    } finally {
        page.close();
    }
});

test('a text with no commentary and no word meaning collapses the panel', async () => {
    const daf = textPayload('Berakhot 2a', [['1', 'מאימתי', 'From when']], { categories: ['Talmud', 'Bavli'] });
    const page = await openShellPage({ fetch: { '/api/text/Berakhot%202a': daf } });
    try {
        await page.eval(`readText('Berakhot 2a', { skipNavigationGrid: true })`);
        await page.settle();
        select(page, 'From when');
        await lookup(page);
        assert.equal(panelHidden(page), true);
        // The segment, then the daf: nothing beyond the text's own page is asked.
        const asked = page.calls.map((call) => decodeURIComponent(call.url)).filter((url) => url.startsWith('/api/sidebar/'));
        assert.deepEqual(asked, ['/api/sidebar/Berakhot 2a:1?stage=links', '/api/sidebar/Berakhot 2a?stage=links']);
    } finally {
        page.close();
    }
});

test('an empty selection clears the panel; one the reader opened on purpose stays', async () => {
    const page = await readGenesis({ [SIDEBAR_VERSE_1]: RASHI_LINKS });
    try {
        select(page, 'God created');
        await lookup(page);
        assert.equal(panelHidden(page), false);

        page.window.getSelection().removeAllRanges();
        await lookup(page);
        assert.equal(panelHidden(page), true);
        assert.equal(body(page), '');
        assert.match(hint(page), /Highlight a passage/);

        await page.eval(`selectionCommentaryState.mode = 'reading'; showSelectionInsights()`);
        await lookup(page);
        assert.equal(panelHidden(page), false);
    } finally {
        page.close();
    }
});

test('a selection too long to be a lookup closes the panel, except one opened on purpose', async () => {
    const page = await readGenesis({ [SIDEBAR_VERSE_1]: RASHI_LINKS });
    try {
        page.$('#readerSources .segment-row[data-segment="1"] .source-en p').textContent = 'word '.repeat(60);
        select(page, 'word word word word word word word word word word '.repeat(5).trim());
        await page.eval(`showSelectionInsights()`);
        await lookup(page);
        assert.equal(panelHidden(page), true);
        assert.equal(page.calls.some((call) => call.url.startsWith('/api/sidebar/')), false);

        await page.eval(`selectionCommentaryState.mode = 'reading'; showSelectionInsights()`);
        await lookup(page);
        assert.equal(panelHidden(page), false);
    } finally {
        page.close();
    }
});

test('a text that is not commentary-eligible collapses the panel without a lookup', async () => {
    const page = await readGenesis({ [SIDEBAR_VERSE_1]: RASHI_LINKS });
    try {
        await page.eval(`window.currentTextPayload = { ...window.currentTextPayload, categories: ['Liturgy'] }`);
        select(page, 'God created');
        await page.eval(`showSelectionInsights()`);
        await lookup(page);
        assert.equal(panelHidden(page), true);
        assert.equal(page.calls.some((call) => call.url.startsWith('/api/sidebar/')), false);
    } finally {
        page.close();
    }
});

test('outside a text, a selection only closes the panel', async () => {
    const page = await openShellPage({ fetch: {} });
    try {
        await page.eval(`showSelectionInsights()`);
        await lookup(page);
        assert.equal(panelHidden(page), true);
    } finally {
        page.close();
    }
});

test('a lookup that a newer selection overtook never paints', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const page = await readGenesis({
        [`${SIDEBAR_VERSE_1}`]: async () => { await gate; return RASHI_LINKS; },
    });
    try {
        select(page, 'God created');
        const slow = page.eval('updateSelectionInsights()');
        await page.settle(2);
        assert.equal(page.$('#selectionInsightsBody').getAttribute('aria-busy'), 'true');
        assert.match(hint(page), /Loading selected passage tools/);

        page.window.getSelection().removeAllRanges();
        await lookup(page);
        assert.equal(panelHidden(page), true);

        release();
        await slow;
        await page.settle();
        assert.equal(panelHidden(page), true);
        assert.equal(body(page), '');
    } finally {
        page.close();
    }
});

test('the first lookup of a verse shows a loading skeleton and opens the panel; a repeat of it does not', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const page = await readGenesis({ [SIDEBAR_VERSE_1]: async () => { await gate; return RASHI_LINKS; } });
    try {
        select(page, 'God created');
        const first = page.eval('updateSelectionInsights()');
        await page.settle(2);
        assert.equal(panelHidden(page), false);
        assert.equal(page.$$('#selectionInsightsBody .sk-reader-para').length, 4);
        release();
        await first;
        await page.settle();
        assert.match(body(page), /Linked Commentaries/);

        // Cached now: the second lookup goes straight to the list.
        select(page, 'God created');
        await page.eval('updateSelectionInsights()');
        await page.settle();
        assert.equal(page.$$('#selectionInsightsBody .sk-reader-para').length, 0);
    } finally {
        page.close();
    }
});

test('on a phone the commentary opens in the right-hand drawer; on a desktop it reopens a hidden sidebar', async () => {
    const mobile = await readGenesis({ [SIDEBAR_VERSE_1]: RASHI_LINKS }, { before: () => {} });
    try {
        mobile.media.set('(max-width: 1023px)', true);
        select(mobile, 'God created');
        await lookup(mobile);
        assert.ok(mobile.$('#rightSidebar').classList.contains('mobile-open'));
    } finally {
        mobile.close();
    }

    const desktop = await readGenesis({ [SIDEBAR_VERSE_1]: RASHI_LINKS });
    try {
        await desktop.eval(`appState.prefs.showRightSidebar = false`);
        select(desktop, 'God created');
        await lookup(desktop);
        assert.equal(await desktop.eval(`appState.prefs.showRightSidebar`), true);
    } finally {
        desktop.close();
    }
});
