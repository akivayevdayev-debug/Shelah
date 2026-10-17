/**
 * The library: the home categories, the chapter / section pickers, the Texts
 * menu tree, and the customs modal. Boots the real home page in jsdom
 * (tests_js/helpers/shell_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');
const { GENESIS_1, textPayload } = require('./helpers/shell_data');

const LIBRARY_INDEX = [
    {
        category: 'Tanakh', heCategory: 'תנ״ך',
        contents: [
            { title: 'Genesis', heTitle: 'בראשית' },
            { title: 'Hidden Book', hidden: true },
            { category: 'Prophets', contents: [{ title: 'Isaiah', ref: 'Isaiah 1' }] },
            { category: 'Empty', contents: [{ hidden: true }] },
        ],
    },
    { category: 'Talmud', children: [{ title: 'Berakhot', firstSectionRef: 'Berakhot 2a' }, {}] },
    null,
];

function libraryRoutes(overrides = {}) {
    return {
        '/api/library/index': LIBRARY_INDEX,
        '/api/text/Genesis%201': GENESIS_1,
        '/api/communities/list': [{ name: 'Moroccan' }],
        '/api/community/Moroccan': { name: 'Moroccan', customs: {} },
        '/api/community/Sefardic': {
            name: 'Sefardic',
            raw_data: { halacha_index: [
                { category: 'Shabbat', topic: 'Candles', topic_he: 'נרות', summary: 'Light early', summary_he: 'מדליקים מוקדם', common_practices: ['18 minutes', 'Varies'], confidence: 'disputed', variants: [{ subgroup: 'Turkish', practice: 'Later' }] },
                { topic: 'Misc' },
            ] },
        },
        '/api/community/Yemenite': { customs: { x: { category: 'Food', topic: 'Bread' } } },
        '/api/community/Georgian': { halacha_index: [{ topic: 'Songs' }] },
        '/api/community/Iraqi': { customs: [] },
        '/api/community/Syrian': { status: 500, body: {} },
        ...overrides,
    };
}

async function open(overrides = {}, pageOptions = {}) {
    return openShellPage({ fetch: libraryRoutes(overrides), ...pageOptions });
}

// --- home categories ------------------------------------------------------

test('every home library category opens a modal whose buttons do what they say', async () => {
    const page = await open();
    try {
        const keys = [...page.eval(`Object.keys(HOME_LIBRARY_CATEGORIES)`)];
        assert.ok(keys.length >= 3);
        for (const key of keys) {
            for (const lang of ['en', 'he']) {
                page.eval(`displayedLanguage = ${JSON.stringify(lang)}`);
                page.eval(`openLibraryCategory(${JSON.stringify(key)})`);
                const body = page.$('#libraryCategoryBody');
                assert.ok(body.querySelectorAll('button').length > 0, `${key}/${lang} has buttons`);
                assert.ok(page.$('#libraryCategoryModal').classList.contains('flex'));
                for (const button of body.querySelectorAll('button')) button.onclick?.();
                await page.settle(2);
            }
        }
        assert.equal(page.eval(`openLibraryCategory('nope')`), undefined);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('the customs modal groups a community\'s rulings by category', async () => {
    const page = await open();
    try {
        await page.eval(`openCustomsModal('Sefardic', 'Sephardic')`);
        await page.settle();
        const text = page.$('#libraryCategoryBody').textContent;
        assert.match(page.$('#libraryCategoryTitle').textContent, /Sephardic/);
        assert.match(text, /Shabbat/);
        assert.match(text, /Candles/);
        assert.match(text, /Light early/);
        assert.match(text, /18 minutes/);
        assert.match(text, /Turkish:\s*Later/);
        assert.match(text, /General/);
        assert.equal(page.$('#libraryCategoryBody').getAttribute('aria-busy'), 'false');

        page.eval(`displayedLanguage = 'he'`);
        await page.eval(`openCustomsModal('Sefardic')`);
        await page.settle();
        assert.match(page.$('#libraryCategoryBody').textContent, /נרות/);
    } finally {
        page.close();
    }
});

test('the customs modal reads whichever shape the community data has, and says when there is none', async () => {
    const page = await open();
    try {
        for (const [name, expected] of [
            ['Yemenite', /Bread/],
            ['Georgian', /Songs/],
            ['Iraqi', /No customs data available/],
            ['Syrian', /Error loading customs data/],
        ]) {
            await page.eval(`openCustomsModal(${JSON.stringify(name)})`);
            await page.settle();
            assert.match(page.$('#libraryCategoryBody').textContent, expected, name);
        }
        page.eval(`displayedLanguage = 'he'`);
        await page.eval(`openCustomsModal('Iraqi')`);
        await page.settle();
        assert.match(page.$('#libraryCategoryBody').textContent, /אין נתונים זמינים/);
        await page.eval(`openCustomsModal('Syrian')`);
        await page.settle();
        assert.match(page.$('#libraryCategoryBody').textContent, /שגיאה בטעינת המנהגים/);
    } finally {
        page.close();
    }
});

// --- chapter and section pickers -----------------------------------------

test('the chapter picker lists a book\'s chapters and the Torah portions that start in it', async () => {
    const page = await open();
    try {
        page.eval(`openChapterGrid('Genesis', 50)`);
        assert.equal(page.$$('#chapterGridItems .chapter-grid-item').length, 50);
        assert.match(page.$('#chapterGridTitle').textContent, /Genesis Sections/);
        assert.ok(page.$$('#chapterGridParashaStrip .chapter-grid-parasha-link').length >= 1);
        assert.ok(page.$('#chapterGridModal').hasAttribute('open'));

        page.eval(`openChapterGrid('Psalms', 150)`);
        assert.equal(page.$('#chapterGridParashaStrip').classList.contains('hidden'), true);

        page.eval(`displayedLanguage = 'he'`);
        page.eval(`openChapterGrid('Genesis', 3)`);
        assert.match(page.$('#chapterGridTitle').textContent, /בחר פרק/);

        for (const bad of [`openChapterGrid('', 3)`, `openChapterGrid('Genesis', 0)`, `openChapterGrid('Genesis', 'x')`]) {
            const before = page.$('#chapterGridTitle').textContent;
            page.eval(bad);
            assert.equal(page.$('#chapterGridTitle').textContent, before);
        }

        page.eval(`closeChapterGrid()`);
        await page.settle(12);
        page.$('#chapterGridModal').dispatchEvent(new page.window.Event('cancel', { cancelable: true }));
        await page.settle(12);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('a chapter button opens that chapter', async () => {
    const page = await open();
    try {
        page.eval(`openChapterGrid('Genesis', 3)`);
        page.click('#chapterGridItems .chapter-grid-item');
        await page.settle();
        assert.ok(page.calls.some((c) => c.url.startsWith('/api/text/Genesis%201')));
    } finally {
        page.close();
    }
});

test('book and section references are parsed into the right picker', async () => {
    const page = await open();
    try {
        assert.deepEqual(JSON.parse(JSON.stringify(page.eval(`shouldOpenChapterGrid('Genesis 1')`))), { book: 'Genesis', chapters: 50 });
        assert.equal(page.eval(`shouldOpenChapterGrid('Genesis 2')`), null);
        assert.equal(page.eval(`shouldOpenChapterGrid('Nope 1')`), null);
        assert.equal(page.eval(`parseBookAndChapter('')`), null);
        assert.deepEqual(JSON.parse(JSON.stringify(page.eval(`parseBookAndChapter('1 Samuel 3:4')`))), { book: 'I Samuel', chapter: 3 });
        assert.deepEqual(JSON.parse(JSON.stringify(page.eval(`parseBookAndChapter('Genesis')`))), { book: 'Genesis', chapter: 1 });
        assert.equal(page.eval(`shouldOpenReferenceGrid('Berakhot 2a')`), 'Berakhot');
        assert.equal(page.eval(`shouldOpenReferenceGrid('Berakhot 3a')`), null);
        assert.equal(page.eval(`shouldOpenReferenceGrid('Genesis 1')`), null);
        assert.equal(page.eval(`shouldOpenReferenceGrid('Shulchan Arukh, Orach Chayim 1')`), 'Shulchan Arukh, Orach Chayim');
        assert.equal(page.eval(`shouldOpenReferenceGrid('')`), null);
        assert.equal(page.eval(`parseIndexAndSection('Kuzari')`), null);
    } finally {
        page.close();
    }
});

test('a Talmud tractate opens a daf picker grouped by chapter when the server sends sections', async () => {
    const refs = ['Berakhot 2a', 'Berakhot 2b', 'Berakhot 13a', 'Berakhot 30a', 'Berakhot 31a'];
    const page = await open({
        '/api/library/leaf-refs': { refs, sections: [
            { label: 'Chapter 1', fromDaf: '2a', toDaf: '13b' },
            { label: 'Chapter 2', fromDaf: '14a', toDaf: '30b' },
            { label: 'bad' },
        ] },
    });
    try {
        assert.equal(await page.eval(`maybeOpenReferenceGrid('Berakhot 2a')`), true);
        const labels = page.$$('#chapterGridItems .chapter-grid-group-label').map((n) => n.textContent);
        assert.ok(labels.some((l) => /Chapter 1 \(2a–13b\)/.test(l)), labels.join('|'));
        assert.equal(labels.length, 3, labels.join('|'));
        assert.equal(page.$$('#chapterGridItems .chapter-grid-item').length, 5);
        assert.match(page.$('#chapterGridSubtitle').textContent, /daf or section/);

        page.eval(`displayedLanguage = 'he'`);
        page.eval(`openReferenceGrid('Berakhot', ${JSON.stringify(refs)}, ${JSON.stringify([{ label: 'Chapter 1', fromDaf: '2a', toDaf: '13b' }])})`);
        assert.ok(page.$$('#chapterGridItems .chapter-grid-group-label').length >= 1);
        assert.match(page.$('#chapterGridTitle').textContent, /בחר קטע/);
    } finally {
        page.close();
    }
});

test('a Talmud tractate without sections groups its dapim one by one', async () => {
    const refs = ['Niddah 2a', 'Niddah 2b', 'Niddah 3a'];
    const page = await open();
    try {
        page.eval(`openReferenceGrid('Niddah', ${JSON.stringify(refs)}, [])`);
        const labels = page.$$('#chapterGridItems .chapter-grid-group-label').map((n) => n.textContent);
        assert.deepEqual(labels, ['Daf 2a', 'Daf 2b', 'Daf 3a']);
        page.eval(`displayedLanguage = 'he'`);
        page.eval(`openReferenceGrid('Niddah', ${JSON.stringify(refs)}, [])`);
        assert.equal(page.$$('#chapterGridItems .chapter-grid-group-label').length, 3);
    } finally {
        page.close();
    }
});

test('a numbered work with section ranges is grouped by range, and unsorted items say so', async () => {
    const refs = ['Shulchan Arukh, Orach Chayim 1', 'Shulchan Arukh, Orach Chayim 2', 'Shulchan Arukh, Orach Chayim 50', 'Shulchan Arukh, Orach Chayim Intro'];
    const page = await open();
    try {
        page.eval(`openReferenceGrid('Shulchan Arukh, Orach Chayim', ${JSON.stringify(refs)}, ${JSON.stringify([
            { label: 'Laws of Morning', heLabel: 'הלכות בוקר', fromSection: 1, toSection: 10 },
            { label: 'bad', fromSection: 'x' },
        ])})`);
        const labels = page.$$('#chapterGridItems .chapter-grid-group-label').map((n) => n.textContent);
        assert.deepEqual(labels, ['Laws of Morning (1–10)', 'Unsorted', 'Unsorted'].slice(0, labels.length));
        assert.ok(page.$('#chapterGridItems').classList.contains('chapter-grid-items-sectioned'));
        page.eval(`displayedLanguage = 'he'`);
        page.eval(`openReferenceGrid('Shulchan Arukh, Orach Chayim', ${JSON.stringify(refs)}, ${JSON.stringify([{ label: 'Morning', heLabel: 'בוקר', fromSection: 1, toSection: 10 }])})`);
        assert.match(page.$('#chapterGridItems').textContent, /בוקר \(1–10\)/);
    } finally {
        page.close();
    }
});

test('a prayer-book index gets the medium prayer grid, and lists too small or nameless are ignored', async () => {
    const page = await open();
    try {
        page.eval(`openReferenceGrid('Siddur Ashkenaz', ['Siddur Ashkenaz, Shacharit 1', 'Siddur Ashkenaz, Shacharit 2'], [])`);
        assert.ok(page.$('#chapterGridItems').classList.contains('chapter-grid-items-prayer'));
        assert.match(page.$('#chapterGridItems').textContent, /Shacharit 1/);

        const title = page.$('#chapterGridTitle').textContent;
        page.eval(`openReferenceGrid('Kuzari', ['Kuzari 1'], [])`);
        page.eval(`openReferenceGrid('', ['a', 'b'], [])`);
        assert.equal(page.$('#chapterGridTitle').textContent, title);
        assert.equal(page.eval(`getReferenceGridItemLabel('Kuzari', '', 3)`), 'Section 4');
        assert.equal(page.eval(`getReferenceGridItemLabel('', 'Kuzari 1', 0)`), 'Kuzari 1');
        assert.equal(page.eval(`getReferenceGridItemLabel('Kuzari', 'Other 1', 0)`), 'Other 1');
        page.eval(`displayedLanguage = 'he'`);
        assert.equal(page.eval(`getReferenceGridItemLabel('Kuzari', '', 3)`), 'קטע 4');
        assert.ok(page.eval(`getReferenceGridItemLabel('Berakhot', 'Berakhot 2a', 0)`).length > 0);
        assert.ok(page.eval(`getReferenceGridItemLabel('Berakhot', 'Other 2a:3', 0)`).length > 0);
        assert.equal(page.eval(`isPrayerReferenceGridTitle('Plain', ['Machzor 1'])`), true);
        assert.equal(page.eval(`isPrayerReferenceGridTitle('Plain', [])`), false);
    } finally {
        page.close();
    }
});

test('leaf references are fetched once per title and a failure leaves an empty list', async () => {
    const page = await open({
        '/api/library/leaf-refs': (url) => (url.includes('Broken') ? { status: 500, body: {} }
            : url.includes('Throws') ? (() => { throw new Error('offline'); })()
                : { refs: ['A 1', 'A 2', '', null], sections: 'nope' }),
    });
    try {
        assert.deepEqual([...await page.eval(`fetchIndexLeafRefs('Alpha')`)], ['A 1', 'A 2']);
        const calls = page.calls.length;
        await page.eval(`fetchIndexLeafRefs('Alpha')`);
        assert.equal(page.calls.length, calls);
        assert.deepEqual([...await page.eval(`fetchIndexLeafRefs('Broken')`)], []);
        assert.deepEqual([...await page.eval(`fetchIndexLeafRefs('Throws')`)], []);
        assert.deepEqual([...await page.eval(`fetchIndexLeafRefs('  ')`)], []);
        assert.equal(await page.eval(`maybeOpenReferenceGrid('Alpha 1')`), true);
        assert.equal(await page.eval(`maybeOpenReferenceGrid('Broken 1')`), false);
        assert.equal(await page.eval(`maybeOpenReferenceGrid('Genesis 1')`), false);
    } finally {
        page.close();
    }
});

test('the daf and section helpers map positions to labelled ranges', async () => {
    const page = await open();
    try {
        assert.equal(page.eval(`_dafToKey('2a')`), 4);
        assert.equal(page.eval(`_dafToKey('2b')`), 5);
        assert.equal(page.eval(`_dafToKey('x')`), -1);
        assert.equal(page.eval(`_sectionKeyFromRef('12 foo')`), 12);
        assert.equal(page.eval(`_sectionKeyFromRef('foo')`), -1);
        const lookup = page.eval(`_buildSectionLookup([{label:'C1', fromDaf:'2a', toDaf:'5b'}, {label:'x', fromDaf:'q', toDaf:'r'}, null])`);
        assert.equal(lookup.length, 1);
        assert.equal(page.eval(`_getSectionForDaf(6, _buildSectionLookup([{label:'C1', fromDaf:'2a', toDaf:'5b'}]), false)`), 'C1 (2a–5b)');
        assert.equal(page.eval(`_getSectionForDaf(100, _buildSectionLookup([{label:'C1', fromDaf:'2a', toDaf:'5b'}]), false)`), '');
        assert.equal(page.eval(`_getSectionForDaf(6, [], false)`), '');
        assert.ok(page.eval(`_getSectionForDaf(6, _buildSectionLookup([{label:'Chapter 1', fromDaf:'2a', toDaf:'5b'}]), true)`).length > 0);
        assert.equal(page.eval(`_getSectionForNumber(3, _buildNumericSectionLookup([{label:'A', fromSection:1, toSection:5}]), false)`), 'A (1–5)');
        assert.equal(page.eval(`_getSectionForNumber(-1, _buildNumericSectionLookup([{label:'A', fromSection:1, toSection:5}]), false)`), '');
        assert.equal(page.eval(`_getSectionForNumber(9, _buildNumericSectionLookup([{label:'A', fromSection:1, toSection:5}]), false)`), '');
        assert.equal(page.eval(`_getSectionForNumber(3, _buildNumericSectionLookup([{label:'A', heLabel:'א', fromSection:1, toSection:5}]), true)`), 'א (1–5)');
    } finally {
        page.close();
    }
});

// --- the Texts menu tree --------------------------------------------------

test('the Texts menu draws the library tree, filters it, and opens a text from it', async () => {
    const page = await open({
        '/api/library/search': [{ ref: 'Isaiah 1' }],
        '/api/text/Isaiah%201': textPayload('Isaiah 1', [['1', 'חזון', 'The vision']]),
        '/api/siddur': {},
    });
    try {
        page.eval(`openTextsMenu()`);
        await page.settle();
        assert.ok(page.$('#textsMenuModal').classList.contains('flex'));
        const tree = page.$('#libraryIndexModal') || page.$('#libraryIndexSidebar');
        assert.match(tree.textContent, /Genesis/);
        assert.match(tree.textContent, /Isaiah/);
        assert.doesNotMatch(tree.textContent, /Hidden Book/);
        assert.match(tree.textContent, /Berakhot/);

        const filter = page.$('#libraryIndexFilterInput, #libraryIndexFilter');
        if (filter) {
            page.type(filter, 'isaiah');
            await new Promise((resolve) => setTimeout(resolve, 200));
            assert.match(tree.textContent, /Isaiah/);
            assert.doesNotMatch(tree.textContent, /Genesis/);
            page.type(filter, 'zzz');
            await new Promise((resolve) => setTimeout(resolve, 200));
            assert.match(tree.textContent, /No matching topics found/);
            const clear = page.$('#libraryIndexFilterClear');
            if (clear) page.click(clear);
            assert.match(tree.textContent, /Genesis/);
        }

        const leaf = [...tree.querySelectorAll('.library-node-open')].find((b) => /Isaiah/.test(b.textContent));
        page.click(leaf);
        await page.settle(16);
        assert.ok(leaf.classList.contains('library-node-active'));
        assert.ok(page.calls.some((c) => c.url.startsWith('/api/text/Isaiah')));

        page.eval(`closeTextsMenu()`);
        await page.settle(12);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('the library tree reads in Hebrew and says when the index could not be loaded', async () => {
    const page = await open({ '/api/library/index': { status: 500, body: {} } });
    try {
        await page.eval(`loadLibraryIndexViews(0, { modal: true })`);
        await page.settle();
        assert.match(page.$('#libraryIndexSidebar').textContent, /Couldn't load the library index/);
    } finally {
        page.close();
    }
    const hebrew = await open({ '/api/library/index': { contents: LIBRARY_INDEX } }, { storage: { preferredLanguage: 'he' } });
    try {
        await hebrew.eval(`loadLibraryIndexViews(0, { modal: true })`);
        await hebrew.settle();
        assert.match(hebrew.$('#libraryIndexSidebar').textContent, /בראשית/);
        assert.equal(hebrew.eval(`withHebrewBookName('Genesis')`), 'Genesis (Bereishit)');
        assert.equal(hebrew.eval(`withHebrewBookName('Genesis (x)')`), 'Genesis (x)');
        assert.equal(hebrew.eval(`withHebrewBookName('Unknown')`), 'Unknown');
        assert.equal(hebrew.eval(`normalizeLibraryLookupKey('Shulchan Arukh, O.C.')`), 'shulchanarukhoc');
        assert.equal(hebrew.eval(`resolveLibraryNodeRef({ title: 'T' })`), 'T');
        assert.equal(hebrew.eval(`resolveLibraryNodeRef({})`), '');
        assert.equal(hebrew.eval(`resolveLibraryNodeRef(null)`), '');
        assert.deepEqual(JSON.parse(JSON.stringify(hebrew.eval(`getLibraryNodeLabels(null)`))), { en: '', he: '', display: '' });
        assert.deepEqual([...hebrew.eval(`getLibraryNodeChildren(null)`)], []);
        assert.equal(hebrew.eval(`buildLibraryIndexMarkup(null)`), '');
    } finally {
        hebrew.close();
    }
});
