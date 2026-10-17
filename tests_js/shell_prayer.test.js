/**
 * Prayers, the siddur and community customs: the three "not a Sefaria text"
 * readers. Boots the real home page in jsdom (tests_js/helpers/shell_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');

const PRAYERS = [
    { name: 'Shema', source: 'sefaria' },
    { name: 'Amidah', source: 'sefaria' },
    { name: 'Aleinu' },
    { name: 'Shema' },
    { title: 'Kaddish' },
    {},
];

const SHEMA_PREVIEW = {
    title: 'Shema',
    content: { he: 'שמע ישראל\n\nה׳ אלהינו', en: 'Hear, O Israel\n\nThe Lord is our God' },
};

const SHEMA_FULL = {
    lines: [
        { type: 'header', he: 'שמע', en: 'Shema' },
        { type: 'paragraph', he: 'שְׁמַע יִשְׂרָאֵל', en: 'Hear, O Israel' },
        { type: 'paragraph', he: '', en: '' },
        { type: 'paragraph', he: 'בָּרוּךְ <b>שֵׁם</b>', en: 'Blessed is <b>the name</b>' },
        { type: 'header', he: 'ברכה', en: 'A blessing' },
        { type: 'paragraph', he: 'אֶחָד', en: '' },
    ],
};

const COMMUNITY = {
    name: 'Moroccan',
    primary_origin: 'Morocco',
    major_authorities: ['Rabbi A', 'Rabbi B', 'Rabbi C', 'Rabbi D', 'Rabbi E'],
    customs: {
        b: {
            category: 'Shabbat', topic: 'Cholent', topic_he: 'חמין', ruling: 'Eat it hot', ruling_he: 'אוכלים חם',
            common_practices: ['Overnight', '', 'In the oven'],
            confidence: 'disputed',
            source: 'Source book', source_url: 'https://example.org/src',
            references: [
                { url: 'https://example.org/src', title: 'Same page' },
                { url: 'https://example.org/other', title: 'Other page' },
            ],
            variants: [{ subgroup: 'Turkish', practice: 'No rice' }, { practice: 'Plain' }, { subgroup: 'Skip' }],
        },
        a: { category: 'Passover', topic: 'Charoset' },
        junk: null,
        c: { },
    },
    distinctive_customs: [
        { name: 'Mimouna', name_he: 'מימונה', description: 'A party', description_he: 'מסיבה', when: 'After Passover', confidence: 'regional', source: 'Elders' },
        { name: '' },
    ],
    disputes: ['Whether to eat rice'],
    gaps: ['Wedding customs'],
};

function prayerRoutes(overrides = {}) {
    return {
        '/api/prayers/list': PRAYERS,
        '/api/prayer/Shema': SHEMA_PREVIEW,
        '/api/siddur/full/Shema': SHEMA_FULL,
        '/api/prayer/Amidah': { status: 404, body: { error: 'Prayer not found' } },
        '/api/siddur/full/Amidah': { status: 404, body: { error: 'not found' } },
        '/api/prayer/Aleinu': { status: 404, body: { error: 'Prayer not found' } },
        '/api/siddur/full/Aleinu': { lines: [{ type: 'paragraph', he: 'עלינו', en: 'It is our duty' }] },
        '/api/prayer/Kaddish': { status: 500, body: { error: 'boom' } },
        '/api/siddur/full/Kaddish': { status: 500, body: { error: 'boom' } },
        '/api/communities/list': [{ name: 'Moroccan' }, { name: 'Yemenite' }],
        '/api/community/Moroccan': COMMUNITY,
        '/api/community/Yemenite': { name: 'Yemenite', customs: {} },
        ...overrides,
    };
}

async function openPrayer(name = 'Shema', overrides = {}, pageOptions = {}) {
    const page = await openShellPage({ fetch: prayerRoutes(overrides), ...pageOptions });
    await page.eval(`displayPrayer(${JSON.stringify(name)})`);
    await page.settle();
    return page;
}

test('a prayer draws its title, navigation, lines and source', async () => {
    const page = await openPrayer();
    try {
        assert.match(page.$('#readerTitle').textContent, /Shema/);
        assert.match(page.$('#readerContent').textContent, /Prayer Navigation/);
        assert.match(page.$('#readerContent').textContent, /Previous: Kaddish/);
        assert.match(page.$('#prayer-display').textContent, /Hear, O Israel/);
        assert.match(page.$('#prayer-display').textContent, /Blessed is/);
        assert.match(page.$('#sourcesDynamicContent').textContent, /Sefaria Liturgy Collection/);
        assert.equal(page.window.currentPrayerName, 'Shema');
        assert.equal(page.window.currentPrayerIsHtml, true);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('the prayer navigation buttons open the neighbouring prayers', async () => {
    const page = await openPrayer();
    try {
        const next = page.$$('#readerContent button[data-onclick="displayPrayer"]');
        assert.ok(next.length >= 1);
        assert.equal(decodeURIComponent(next[0].dataset.onclickArg).length > 0, true);
    } finally {
        page.close();
    }
});

for (const layout of ['english', 'hebrew', 'interleaved', 'bilingual-reverse', 'bilingual']) {
    test(`a prayer redraws in the ${layout} layout`, async () => {
        const page = await openPrayer();
        try {
            const select = page.$('#readerLayoutSelect');
            select.value = layout;
            select.dispatchEvent(new page.window.Event('change', { bubbles: true }));
            await page.settle();
            assert.ok(page.$$('#prayer-display > *').length > 0, `no rows in ${layout}`);
            assert.deepEqual(page.errors, []);
        } finally {
            page.close();
        }
    });
}

test('a prayer with no Sefaria lines falls back to the preview paragraphs', async () => {
    const page = await openPrayer('Shema', { '/api/siddur/full/Shema': { status: 404, body: { error: 'x' } } });
    try {
        assert.match(page.$('#prayer-display').textContent, /Hear, O Israel|שמע ישראל/);
        assert.equal(page.window.currentPrayerIsHtml, false);
        assert.match(page.$('#sourcesDynamicContent').textContent, /Sefaria Prayer Book Preview/);
        for (const layout of ['english', 'hebrew', 'interleaved', 'bilingual-reverse', 'bilingual']) {
            const select = page.$('#readerLayoutSelect');
            select.value = layout;
            select.dispatchEvent(new page.window.Event('change', { bubbles: true }));
            await page.settle();
            assert.ok(page.$$('#prayer-display > *').length > 0, `no rows in ${layout}`);
        }
    } finally {
        page.close();
    }
});

test('a prayer only Sefaria has is built from the Sefaria lines alone', async () => {
    const page = await openPrayer('Aleinu');
    try {
        assert.match(page.$('#prayer-display').textContent, /It is our duty/);
    } finally {
        page.close();
    }
});

test('a prayer neither source has says it is not in the library and offers a way back', async () => {
    const page = await openPrayer('Amidah');
    try {
        assert.match(page.$('#readerContent').textContent, /This prayer isn't in the library\./);
        assert.match(page.$('#readerContent').textContent, /Back to prayers/);
        assert.equal(page.$('#readerContent').querySelector('.region-retry, [data-region-retry]'), null);
        const back = [...page.$$('#readerContent button, #readerContent a')].find((b) => /Back to prayers/.test(b.textContent));
        page.click(back);
        await page.settle();
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('a prayer the server fails on offers Retry', async () => {
    const page = await openPrayer('Kaddish');
    try {
        assert.match(page.$('#readerContent').textContent, /Couldn't load this prayer/);
        assert.match(page.$('#readerContent').textContent, /Retry/i);
    } finally {
        page.close();
    }
});

test('a prayer from a route that is not found tells the router', async () => {
    const marks = [];
    const page = await openShellPage({
        fetch: prayerRoutes(),
        before: (window) => { window.ShelahRouter = { markNotFound: () => marks.push('nf') }; },
    });
    try {
        await page.eval(`displayPrayer('Amidah', { fromRoute: true })`);
        await page.settle();
        assert.deepEqual(marks, ['nf']);
    } finally {
        page.close();
    }
});

test('the prayer list is fetched once and survives a failed fetch', async () => {
    const page = await openShellPage({ fetch: { '/api/prayers/list': { status: 500, body: {} } } });
    try {
        const list = await page.eval(`ensurePrayerListLoaded()`);
        assert.deepEqual([...list], []);
        await assert.rejects(page.eval(`ensurePrayerListLoaded({ rethrow: true })`));
        assert.deepEqual([...page.eval(`normalizePrayerList(null)`)], []);
        const names = page.eval(`normalizePrayerList(${JSON.stringify(PRAYERS)})`).map((p) => p.name);
        assert.deepEqual([...names], ['Aleinu', 'Amidah', 'Kaddish', 'Shema']);
        assert.equal(page.eval(`getPrayerNavigationContext('Nope')`), null);
        assert.equal(page.eval(`renderPrayerNavigation('Nope')`), '');
    } finally {
        page.close();
    }
});

// --- siddur ---------------------------------------------------------------

function fakeSiddur(overrides = {}) {
    const calls = [];
    const siddur = {
        calls,
        prepare: async (value) => {
            calls.push(['prepare', value]);
            if (value === 'missing') throw Object.assign(new Error('nope'), { name: 'SiddurNotFound' });
            if (value === 'offline') throw new Error('offline');
            return { value, toc: { source: { index: 'Siddur Edot HaMizrach', he: { title: 'סידור', license: 'CC0' }, en: { title: 'Siddur', license: 'CC-BY' } } } };
        },
        mount: (node, prepared) => {
            node.innerHTML = `<div id="siddur-body">${prepared.value}</div>`;
            return { label: `Siddur ${prepared.value}`, section: prepared.value.split('/')[2] || null };
        },
        rerender: () => calls.push(['rerender']),
        renderToc: async (mount, opts) => {
            calls.push(['renderToc', mount?.id, opts]);
            if (overrides.tocFails) throw new Error('toc offline');
            mount.innerHTML = '<a data-siddur-path="edot-hamizrach/shacharit">Shacharit</a>';
        },
    };
    return siddur;
}

test('the siddur view draws the module body under the reader chrome', async () => {
    const siddur = fakeSiddur();
    const page = await openShellPage({ fetch: prayerRoutes(), before: (window) => { window.ShelahSiddur = siddur; } });
    try {
        await page.eval(`displaySiddur('edot-hamizrach/shacharit')`);
        await page.settle();
        assert.equal(page.$('#siddur-body').textContent, 'edot-hamizrach/shacharit');
        assert.match(page.$('#readerTitle').textContent, /Siddur edot-hamizrach\/shacharit/);
        assert.match(page.$('#sourcesDynamicContent').textContent, /Siddur Edot HaMizrach · Sefaria/);
        assert.ok(siddur.calls.some(([name]) => name === 'renderToc'));
    } finally {
        page.close();
    }
});

test('a plain click on a siddur link opens it in place; a modified click does not', async () => {
    const siddur = fakeSiddur();
    const page = await openShellPage({ fetch: prayerRoutes(), before: (window) => { window.ShelahSiddur = siddur; } });
    try {
        await page.eval(`displaySiddur('edot-hamizrach')`);
        await page.settle();
        const link = page.$('#siddurTocMenu a[data-siddur-path], #siddurTocSidebar a[data-siddur-path]');
        assert.ok(link, 'the table of contents has a link');
        page.click(link, { ctrlKey: true });
        await page.settle();
        const before = siddur.calls.filter(([name]) => name === 'prepare').length;
        page.click(link);
        await page.settle();
        assert.equal(siddur.calls.filter(([name]) => name === 'prepare').length, before + 1);
    } finally {
        page.close();
    }
});

test('a siddur page the module does not have says so and offers the way back', async () => {
    const siddur = fakeSiddur();
    const marks = [];
    const page = await openShellPage({
        fetch: prayerRoutes(),
        before: (window) => { window.ShelahSiddur = siddur; window.ShelahRouter = { markNotFound: () => marks.push(1) }; },
    });
    try {
        await page.eval(`displaySiddur('missing', { fromRoute: true })`);
        await page.settle();
        assert.match(page.$('#readerContent').textContent, /This page isn't in the siddur\./);
        assert.deepEqual(marks, [1]);
        const back = [...page.$$('#readerContent button, #readerContent a')].find((b) => /Back to the siddur/.test(b.textContent));
        page.click(back);
        await page.settle();
        assert.ok(siddur.calls.some(([name, value]) => name === 'prepare' && value === 'edot-hamizrach'));
    } finally {
        page.close();
    }
});

test('a siddur that cannot load offers Retry, and one that never arrived says so', async () => {
    const siddur = fakeSiddur();
    const page = await openShellPage({ fetch: prayerRoutes(), before: (window) => { window.ShelahSiddur = siddur; } });
    try {
        await page.eval(`displaySiddur('offline')`);
        await page.settle();
        assert.match(page.$('#readerContent').textContent, /Couldn't load the siddur/);
    } finally {
        page.close();
    }
    const bare = await openShellPage({ fetch: prayerRoutes() });
    try {
        await bare.eval(`displaySiddur('edot-hamizrach')`);
        await bare.settle();
        assert.match(bare.$('#readerContent').textContent, /Couldn't load the siddur/);
    } finally {
        bare.close();
    }
});

test('a siddur table of contents that fails to load is shown as a failed list', async () => {
    const siddur = fakeSiddur({ tocFails: true });
    const page = await openShellPage({ fetch: prayerRoutes(), before: (window) => { window.ShelahSiddur = siddur; } });
    try {
        page.eval(`renderSiddurMenus()`);
        await page.settle();
        assert.match(page.$('#siddurTocMenu').textContent, /Couldn't load the siddur/);
    } finally {
        page.close();
    }
});

// --- communities ----------------------------------------------------------

test('the communities menu lists the communities and caches the list', async () => {
    const page = await openShellPage({ fetch: prayerRoutes() });
    try {
        await page.eval(`loadCommunitiesMenu()`);
        await page.settle();
        assert.deepEqual(page.$$('#communitiesList button').map((b) => b.textContent.trim()), ['Moroccan', 'Yemenite']);
        const before = page.calls.length;
        await page.eval(`loadCommunitiesMenu()`);
        assert.equal(page.calls.length, before);
    } finally {
        page.close();
    }
});

test('a communities list that fails to load shows the failure in the menu', async () => {
    const page = await openShellPage({ fetch: prayerRoutes({ '/api/communities/list': { status: 500, body: {} } }) });
    try {
        await page.eval(`textsCache.communitiesList = null; loadCommunitiesMenu()`);
        await page.settle();
        assert.match(page.$('#communitiesList').textContent, /Couldn't load the communities/);
    } finally {
        page.close();
    }
});

test('a community page lists customs by category, with sources, variants and notes', async () => {
    const page = await openShellPage({ fetch: prayerRoutes() });
    try {
        await page.eval(`displayCommunity('Moroccan')`);
        await page.settle();
        const text = page.$('#readerContent').textContent;
        assert.match(page.$('#readerTitle').textContent, /Moroccan Community Customs/);
        assert.match(text, /Passover: Charoset/);
        assert.match(text, /Shabbat: Cholent/);
        assert.match(text, /Eat it hot/);
        assert.match(text, /In the oven/);
        assert.match(text, /Turkish:\s*No rice/);
        assert.match(text, /Other page/);
        assert.doesNotMatch(text, /Same page/);
        assert.match(text, /Distinctive customs/);
        assert.match(text, /Mimouna/);
        assert.match(text, /Where sources disagree/);
        assert.match(text, /Not yet documented/);
        assert.match(page.$('#sourcesDynamicContent').textContent, /Rabbi A, Rabbi B, Rabbi C, Rabbi D/);
        assert.doesNotMatch(page.$('#sourcesDynamicContent').textContent, /Rabbi E/);
        assert.ok(page.$('#readerContent a.community-link'));
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('a community page reads in Hebrew when the app is in Hebrew', async () => {
    const page = await openShellPage({ fetch: prayerRoutes(), storage: { preferredLanguage: 'he' } });
    try {
        await page.eval(`displayCommunity('Moroccan')`);
        await page.settle();
        assert.ok(page.$('#readerContent').textContent.length > 100);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('a community with no customs says so', async () => {
    const page = await openShellPage({ fetch: prayerRoutes() });
    try {
        await page.eval(`displayCommunity('Yemenite')`);
        await page.settle();
        assert.match(page.$('#readerContent').textContent, /No structured customs are available/);
    } finally {
        page.close();
    }
});

test('an unknown community gets a message and a way back; a server error gets Retry', async () => {
    const page = await openShellPage({
        fetch: prayerRoutes({
            '/api/community/Nowhere': { status: 404, body: { error: 'none' } },
            '/api/community/Broken': { status: 500, body: {} },
        }),
    });
    const marks = [];
    page.window.ShelahRouter = { markNotFound: () => marks.push(1) };
    try {
        await page.eval(`displayCommunity('Nowhere', { fromRoute: true })`);
        await page.settle();
        assert.match(page.$('#readerContent').textContent, /There are no customs for this community yet\./);
        assert.deepEqual(marks, [1]);
        await page.eval(`displayCommunity('Broken')`);
        await page.settle();
        assert.match(page.$('#readerContent').textContent, /Couldn't load these customs/);
    } finally {
        page.close();
    }
});
