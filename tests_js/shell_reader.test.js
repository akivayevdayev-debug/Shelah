/**
 * The reader: reading a text from the page's own entry point (readText), what
 * it draws for each layout, and what it says when the text cannot be loaded.
 * Boots the real home page in jsdom (tests_js/helpers/shell_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');
const { GENESIS_1, textPayload } = require('./helpers/shell_data');

const GENESIS_URL = '/api/text/Genesis%201';

async function readGenesis(overrides = {}) {
    const page = await openShellPage({
        fetch: { [GENESIS_URL]: GENESIS_1, ...overrides },
    });
    await page.eval(`readText('Genesis 1', { skipNavigationGrid: true })`);
    await page.settle();
    return page;
}

function rowSegments(page) {
    return page.$$('#readerSources .segment-row').map((row) => row.dataset.segment);
}

test('readText draws one row per line under the title, with the reference in the sidebar', async () => {
    const page = await readGenesis();
    try {
        assert.deepEqual(rowSegments(page), ['1', '2', '3']);
        assert.match(page.$('#readerSources').textContent, /In the beginning God created/);
        assert.match(page.$('#readerSources').textContent, /בְּרֵאשִׁ֖ית/);
        assert.match(page.$('#readerTitle').textContent, /^Genesis 1/);
        assert.equal(page.$('#reader').classList.contains('hidden'), false);
        assert.match(page.$('#sourcesDynamicContent').textContent, /Reference:\s*Genesis 1/);
        assert.match(page.$('#sourcesDynamicContent').textContent, /Category:\s*Tanakh › Torah/);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('the default layout puts Hebrew and English side by side in each row', async () => {
    const page = await readGenesis();
    try {
        const row = page.$('#readerSources .segment-row');
        assert.ok(row.classList.contains('reader-side-row'));
        assert.equal(row.querySelectorAll('.source-he').length, 1);
        assert.equal(row.querySelectorAll('.source-en').length, 1);
    } finally {
        page.close();
    }
});

for (const [layout, rowClass, hasHebrew, hasEnglish] of [
    ['english', 'reader-single-row', false, true],
    ['hebrew', 'reader-single-row', true, false],
    ['interleaved', 'reader-interleaved-row', true, true],
    ['bilingual-reverse', 'reader-side-row', true, true],
]) {
    test(`choosing the ${layout} layout redraws the same lines in that layout`, async () => {
        const page = await readGenesis();
        try {
            const select = page.$('#readerLayoutSelect');
            select.value = layout;
            select.dispatchEvent(new page.window.Event('change', { bubbles: true }));
            await page.settle();

            assert.deepEqual(rowSegments(page), ['1', '2', '3']);
            const row = page.$('#readerSources .segment-row');
            assert.ok(row.classList.contains(rowClass), `row is ${row.className}`);
            assert.equal(row.querySelectorAll('.source-he').length > 0, hasHebrew);
            assert.equal(row.querySelectorAll('.source-en').length > 0, hasEnglish);
            if (layout === 'bilingual-reverse') {
                assert.ok(row.firstElementChild.nextElementSibling.classList.contains('source-en'));
            }
            assert.equal(page.window.localStorage.getItem('readerLayoutManual'), null);
        } finally {
            page.close();
        }
    });
}

test('a line with only one language fills the row instead of leaving an empty column', async () => {
    const page = await readGenesis({
        [GENESIS_URL]: textPayload('Genesis 1', [['1', '', 'Only English'], ['2', 'רק עברית', '']]),
    });
    try {
        const rows = page.$$('#readerSources .segment-row');
        assert.equal(rows[0].querySelectorAll('.source-he').length, 0);
        assert.match(rows[0].textContent, /Only English/);
        assert.equal(rows[1].querySelectorAll('.source-en').length, 0);
        assert.match(rows[1].textContent, /רק עברית/);
        assert.ok(rows.every((row) => row.classList.contains('reader-single-row')));
    } finally {
        page.close();
    }
});

test('a text with no lines says so instead of drawing an empty reader', async () => {
    const page = await readGenesis({ [GENESIS_URL]: textPayload('Genesis 1', []) });
    try {
        assert.equal(page.$$('#readerSources .segment-row').length, 0);
        assert.match(page.$('#readerSources').textContent, /No text content found for this reference/);
    } finally {
        page.close();
    }
});

test('a text the server says does not exist gets a message and a search, not a Retry', async () => {
    const page = await readGenesis({
        [GENESIS_URL]: { error: 'Text not found', error_type: 'not_found' },
    });
    try {
        assert.match(page.$('#readerContent').textContent, /This text could not be found\./);
        assert.equal(page.$('#readerContent').querySelector('[data-region-retry], .region-retry'), null);
        assert.match(page.$('#readerContent').textContent, /Search for “Genesis 1”/);
        assert.equal(page.window.currentTextPayload, null);
    } finally {
        page.close();
    }
});

test('when neither our server nor Sefaria answers, the reader says the connection failed', async () => {
    const page = await readGenesis({
        [GENESIS_URL]: () => { throw new Error('offline'); },
        'https://www.sefaria.org': () => { throw new Error('offline'); },
    });
    try {
        assert.match(page.$('#readerContent').textContent, /Couldn't connect to load this text/);
    } finally {
        page.close();
    }
});

test('a blocked Sefaria is reported as unavailable rather than as a missing text', async () => {
    const page = await readGenesis({
        [GENESIS_URL]: { error: '403 Forbidden', error_type: 'sefaria_blocked' },
        'https://www.sefaria.org': { status: 403, body: { error: 'blocked' } },
    });
    try {
        assert.match(page.$('#readerContent').textContent, /Sefaria is temporarily unavailable/);
    } finally {
        page.close();
    }
});
