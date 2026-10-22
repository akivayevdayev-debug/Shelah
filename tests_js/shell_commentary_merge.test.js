/**
 * A commentary that Sefaria links as several passages ("Rashi on Genesis
 * 1:1:1", ":2", ":3") is one comment on the verse: the chooser lists it once
 * and the sidebar shows it as one block, under one heading, with its paragraphs
 * in order. The data is real: the Genesis 1:1 links and the first 260
 * characters of every line of Rashi, Ramban and Ibn Ezra on it
 * (tests_js/fixtures/commentary_genesis_1_1.json; docs/evals/2026-10-21-
 * commentary-merge.md). Boots the real home page in jsdom
 * (tests_js/helpers/shell_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');
const { GENESIS_1, textPayload } = require('./helpers/shell_data');
const REAL = require('./fixtures/commentary_genesis_1_1.json');

const plain = (value) => JSON.parse(JSON.stringify(value));
const LINKS = JSON.parse(JSON.stringify(REAL.links));
const textUrl = (ref) => `/api/text/${encodeURIComponent(ref)}`;

async function readGenesis(pageOptions = {}) {
    const routes = { '/api/text/Genesis%201': GENESIS_1 };
    for (const [ref, payload] of Object.entries(REAL.texts)) routes[textUrl(ref)] = payload;
    const page = await openShellPage({ fetch: routes, ...pageOptions });
    await page.eval(`readText('Genesis 1', { skipNavigationGrid: true })`);
    await page.settle();
    page.takeCalls();
    return page;
}

const view = (page) => page.$('#selectionInsightsBody');
const asked = (page, ref) => page.calls.filter((call) => call.url.startsWith(textUrl(ref)));

// --- the chooser: one entry per commentary ----------------------------------------

test('the three Rashi passages on Genesis 1:1 are one entry, and so are Ramban (4), Ibn Ezra (5) and Or HaChaim', async () => {
    const page = await readGenesis();
    try {
        const refs = plain(page.call('extractCommentaryRefs', LINKS));
        for (const ref of ['Rashi on Genesis 1:1', 'Ramban on Genesis 1:1', 'Ibn Ezra on Genesis 1:1', 'Or HaChaim on Genesis 1:1', 'Rashbam on Genesis 1:1']) {
            assert.equal(refs.filter((candidate) => candidate === ref).length, 1, ref);
        }
        assert.deepEqual(refs.filter((ref) => /^(Rashi|Ramban|Ibn Ezra|Or HaChaim) on Genesis 1:1:/.test(ref)), []);
    } finally {
        page.close();
    }
});

test('the group of a commentator counts commentaries, not passages', async () => {
    const page = await readGenesis();
    try {
        const groups = plain(page.call('groupCommentaryRefsByAuthor', page.call('extractCommentaryRefs', LINKS)));
        const refsOf = (author) => groups.find((group) => group.author === author).refs;
        assert.deepEqual(refsOf('Rashi'), ['Rashi on Genesis 1:1']);
        assert.deepEqual(refsOf('Ramban'), ['Ramban on Genesis 1:1']);
        assert.deepEqual(refsOf('Ibn Ezra'), ['Ibn Ezra on Genesis 1:1']);
        assert.deepEqual(refsOf('Or HaChaim'), ['Or HaChaim on Genesis 1:1']);
    } finally {
        page.close();
    }
});

test('a commentary indexed in its own sections collapses to its section, ranges included', async () => {
    const page = await readGenesis();
    try {
        const refs = plain(page.call('extractCommentaryRefs', LINKS));
        assert.equal(refs.filter((ref) => ref.startsWith('Rabbeinu Bahya')).join('|'), 'Rabbeinu Bahya, Bereshit 1:1');
    } finally {
        page.close();
    }
});

test('a commentary that is also linked whole is listed once', async () => {
    const page = await readGenesis();
    try {
        const refs = plain(page.call('extractCommentaryRefs', LINKS));
        assert.deepEqual(refs.filter((ref) => ref.startsWith('Abarbanel')), ['Abarbanel on Torah, Genesis 1:1']);
    } finally {
        page.close();
    }
});

test('a passage of another verse that is linked here keeps its own verse', async () => {
    const page = await readGenesis();
    try {
        const refs = plain(page.call('extractCommentaryRefs', LINKS));
        const kehot = refs.filter((ref) => ref.startsWith('The Kehot Chumash'));
        assert.ok(kehot.includes('The Kehot Chumash; A Chasidic Commentary, Genesis 1:4'));
        assert.ok(kehot.includes('The Kehot Chumash; A Chasidic Commentary, Genesis 1:28'));
        assert.equal(kehot.length, new Set(kehot).size);
    } finally {
        page.close();
    }
});

test('refs that are not passages of a commentary are left alone', async () => {
    const page = await readGenesis();
    try {
        const links = { Commentary: [
            { ref: 'Onkelos Genesis 1:1' }, { ref: 'Targum Neofiti 1:1' }, { ref: 'Bereshit Rabbah 1:5' },
            { ref: 'Penei David, Genesis, Bereshit 1:1-2' }, { ref: 'Recanati on the Torah, Bereshit 1' }, { ref: 'Zohar 1:15b:3' },
        ] };
        assert.deepEqual(plain(page.call('extractCommentaryRefs', links)), links.Commentary.map((item) => item.ref));
    } finally {
        page.close();
    }
});

test('a Talmud passage collapses to its section, and a Mishnah one to its mishnah', async () => {
    const page = await readGenesis();
    try {
        const links = { Commentary: [
            { ref: 'Rashi on Berakhot 2a:1:1' }, { ref: 'Rashi on Berakhot 2a:1:2' }, { ref: 'Bartenura on Mishnah Berakhot 1:1:3' },
        ] };
        assert.deepEqual(plain(page.call('extractCommentaryRefs', links)), ['Rashi on Berakhot 2a:1', 'Bartenura on Mishnah Berakhot 1:1']);
    } finally {
        page.close();
    }
});

test('in Hebrew the entry is named by the Hebrew ref of the verse, not of the first passage', async () => {
    const page = await readGenesis({ storage: { preferredLanguage: 'he' } });
    try {
        page.call('extractCommentaryRefs', LINKS);
        assert.equal(page.call('localizeCommentaryReferenceLabel', 'Rashi on Genesis 1:1'), 'רש"י על בראשית א׳:א׳');
        assert.equal(page.call('localizeCommentaryReferenceLabel', 'Rabbeinu Bahya, Bereshit 1:1').includes(':א׳:'), false);
    } finally {
        page.close();
    }
});

test('the chooser draws one button per commentary', async () => {
    const page = await readGenesis();
    try {
        page.eval(`selectionCommentaryState.groupedCommentaries = groupCommentaryRefsByAuthor(extractCommentaryRefs(${JSON.stringify(LINKS)}))`);
        page.eval('renderSelectionInsightsChooser()');
        const rashi = page.$$('#selectionInsightsBody details').find((group) => group.querySelector('summary span').textContent === 'Rashi');
        assert.equal(rashi.querySelector('summary span:last-child').textContent, '1');
        page.window.__details = rashi;
        page.eval('fillCommentaryGroup(window.__details)');
        assert.deepEqual([...rashi.querySelectorAll('button')].map((button) => button.dataset.commentaryRef), ['Rashi on Genesis 1:1']);
    } finally {
        page.close();
    }
});

// --- the view: one block ------------------------------------------------------------

for (const [ref, parts] of [['Rashi on Genesis 1:1', 3], ['Ramban on Genesis 1:1', 4], ['Ibn Ezra on Genesis 1:1', 5]]) {
    test(`${ref}: ${parts} comments make one block with one heading`, async () => {
        const page = await readGenesis();
        try {
            page.call('extractCommentaryRefs', LINKS);
            await page.eval(`openCommentaryInline(${JSON.stringify(ref)})`);
            const box = view(page);
            assert.equal(box.querySelectorAll('h5').length, 1);
            assert.equal(box.querySelectorAll('[data-commentary-scroll] p[dir=rtl]').length, parts);
            assert.equal(box.querySelectorAll('[data-commentary-scroll] p[dir=ltr]').length, parts);
        } finally {
            page.close();
        }
    });
}

test('the heading names the commentator and the verse, in both languages', async () => {
    const page = await readGenesis();
    try {
        await page.eval(`openCommentaryInline('Rashi on Genesis 1:1')`);
        assert.equal(view(page).querySelector('h5').textContent, 'Rashi on Genesis 1:1 · רש"י על בראשית א׳:א׳');
    } finally {
        page.close();
    }
});

test('in Hebrew mode the heading is the Hebrew ref of the verse', async () => {
    const page = await readGenesis({ storage: { preferredLanguage: 'he' } });
    try {
        await page.eval(`openCommentaryInline('Ramban on Genesis 1:1')`);
        assert.equal(view(page).querySelector('h5').textContent, 'רמב"ן על בראשית א׳:א׳');
    } finally {
        page.close();
    }
});

test('the comments keep their order, each Hebrew paragraph before its English one', async () => {
    const page = await readGenesis();
    try {
        await page.eval(`openCommentaryInline('Rashi on Genesis 1:1')`);
        const paragraphs = [...view(page).querySelectorAll('[data-commentary-scroll] p')];
        assert.deepEqual(paragraphs.map((p) => p.getAttribute('dir')), ['rtl', 'ltr', 'rtl', 'ltr', 'rtl', 'ltr']);
        const starts = [...view(page).querySelectorAll('[data-commentary-scroll] p[dir=rtl]')].map((p) => p.textContent.slice(0, 8));
        assert.deepEqual(starts, REAL.texts['Rashi on Genesis 1:1'].lines.map((line) => line.he.replace(/<[^>]+>/g, '').slice(0, 8)));
    } finally {
        page.close();
    }
});

test('the block has no per-passage number or card, and no second heading', async () => {
    const page = await readGenesis();
    try {
        await page.eval(`openCommentaryInline('Ibn Ezra on Genesis 1:1')`);
        const box = view(page);
        assert.equal(box.querySelectorAll('article').length, 0);
        assert.deepEqual([...box.querySelectorAll('[data-commentary-scroll] p')].filter((p) => /^\d+$/.test(p.textContent.trim())), []);
        assert.equal(box.querySelectorAll('h1, h2, h3, h4, h5, h6').length, 1);
    } finally {
        page.close();
    }
});

test('the Hebrew paragraphs say they are Hebrew', async () => {
    const page = await readGenesis();
    try {
        await page.eval(`openCommentaryInline('Rashi on Genesis 1:1')`);
        const hebrew = [...view(page).querySelectorAll('[data-commentary-scroll] p[dir=rtl]')];
        assert.deepEqual(hebrew.map((p) => p.getAttribute('lang')), ['he', 'he', 'he']);
    } finally {
        page.close();
    }
});

test('opening the merged commentary asks for it once, not once per passage', async () => {
    const page = await readGenesis();
    try {
        page.call('extractCommentaryRefs', LINKS);
        await page.eval(`openCommentaryInline('Rashi on Genesis 1:1')`);
        await page.settle();
        assert.ok(asked(page, 'Rashi on Genesis 1:1').length > 0);
        assert.deepEqual(asked(page, 'Rashi on Genesis 1:1:'), []);
    } finally {
        page.close();
    }
});

// --- only the passages that are linked ---------------------------------------------

const SECTION = textPayload('Some Work, Genesis 1:4', [
    ['1', 'ראשון', 'first'], ['2', 'שני', 'second'], ['3', 'שלישי', 'third'],
], { heRef: 'עבודה א׳:ד׳' });

async function readSection(links) {
    const page = await openShellPage({ fetch: { '/api/text/Genesis%201': GENESIS_1, [textUrl('Some Work, Genesis 1:4')]: SECTION } });
    await page.eval(`readText('Genesis 1', { skipNavigationGrid: true })`);
    await page.settle();
    page.call('extractCommentaryRefs', { Commentary: links.map((ref) => ({ ref })) });
    return page;
}

const shown = (page) => [...view(page).querySelectorAll('[data-commentary-scroll] p[dir=ltr]')].map((p) => p.textContent);

test('only the passages the verse links are shown when the commentary belongs to another verse', async () => {
    const page = await readSection(['Some Work, Genesis 1:4:2']);
    try {
        await page.eval(`openCommentaryInline('Some Work, Genesis 1:4')`);
        assert.deepEqual(shown(page), ['second']);
    } finally {
        page.close();
    }
});

test('linked ranges and several linked passages are all shown, in text order', async () => {
    const page = await readSection(['Some Work, Genesis 1:4:3', 'Some Work, Genesis 1:4:1-2']);
    try {
        await page.eval(`openCommentaryInline('Some Work, Genesis 1:4')`);
        assert.deepEqual(shown(page), ['first', 'second', 'third']);
    } finally {
        page.close();
    }
});

test('a commentary linked whole shows every passage', async () => {
    const page = await readSection(['Some Work, Genesis 1:4:2', 'Some Work, Genesis 1:4']);
    try {
        await page.eval(`openCommentaryInline('Some Work, Genesis 1:4')`);
        assert.deepEqual(shown(page), ['first', 'second', 'third']);
    } finally {
        page.close();
    }
});

test('if no passage matches the linked numbers, the whole commentary is shown, never an empty block', async () => {
    const page = await readSection(['Some Work, Genesis 1:4:9']);
    try {
        await page.eval(`openCommentaryInline('Some Work, Genesis 1:4')`);
        assert.deepEqual(shown(page), ['first', 'second', 'third']);
    } finally {
        page.close();
    }
});

// --- the same text, however it arrives ---------------------------------------------

test('commentary that comes as parallel he/en lists is one block too', async () => {
    const page = await readGenesis();
    try {
        const box = page.document.createElement('div');
        box.innerHTML = page.call('renderInlineCommentaryLines', { lines: [], he: ['א', '', 'ג'], en: ['one', '', 'three', 'four'] });
        assert.equal(box.querySelectorAll('article').length, 0);
        assert.deepEqual([...box.querySelectorAll('p[dir=ltr]')].map((p) => p.textContent), ['one', 'three', 'four']);
        assert.deepEqual([...box.querySelectorAll('p[dir=rtl]')].map((p) => p.textContent), ['א', 'ג']);
    } finally {
        page.close();
    }
});
