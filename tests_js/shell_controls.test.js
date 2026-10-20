/**
 * The reader's controls, the personal shelf (bookmarks, recents, import and
 * export), study notes, citation export. Boots the real home page in jsdom
 * (tests_js/helpers/shell_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');
const { GENESIS_1, textPayload } = require('./helpers/shell_data');
const { fakeClerk, withClerk, SIGNED_IN_USER, fakeConversationUI, fakeRouter } = require('./helpers/shell_fakes');

const GENESIS_URL = '/api/text/Genesis%201';

function routes(overrides = {}) {
    return {
        [GENESIS_URL]: GENESIS_1,
        '/api/text/Exodus%202': textPayload('Exodus 2', [['1', 'ואלה שמות', 'These are the names'], ['2', 'ראובן', 'Reuben']]),
        '/api/prayers/list': [{ name: 'Shema' }],
        '/api/prayer/Shema': { title: 'Shema', content: { he: 'שמע', en: 'Hear' } },
        '/api/siddur/full/Shema': { lines: [] },
        '/api/community/Moroccan': { name: 'Moroccan', customs: {} },
        '/api/ask-history': { items: [] },
        ...overrides,
    };
}

async function openText(options = {}) {
    const page = await openShellPage({ fetch: routes(options.fetch), storage: options.storage, url: options.url, before: options.before });
    await page.eval(`readText('Genesis 1', { skipNavigationGrid: true })`);
    await page.settle();
    return page;
}

const el = (page, name) => page.eval(name);
const prefs = (page) => JSON.parse(page.window.localStorage.getItem(page.eval('APP_PREFS_KEY')) || '{}');
const shelf = (page) => JSON.parse(page.window.localStorage.getItem(page.eval('APP_SHELF_KEY')) || '{}');
const change = (page, element, value) => {
    if (typeof value === 'boolean') element.checked = value; else element.value = String(value);
    element.dispatchEvent(new page.window.Event(typeof value === 'boolean' ? 'change' : 'input', { bubbles: true }));
};

// --- the reader's display controls ----------------------------------------

test('the display controls change the reader and are remembered', async () => {
    const page = await openText();
    try {
        change(page, el(page, 'readerFontSize'), 24);
        change(page, el(page, 'readerLineHeight'), 2.1);
        change(page, el(page, 'transliterationToggle'), true);
        change(page, el(page, 'showVowelsToggle'), false);
        change(page, el(page, 'showCantillationToggle'), false);
        assert.equal(prefs(page).fontSize, 24);
        assert.equal(prefs(page).lineHeight, 2.1);
        assert.equal(prefs(page).transliteration, true);
        assert.equal(prefs(page).showVowels, false);
        assert.equal(prefs(page).showCantillation, false);
        assert.match(page.$('#readerSources').textContent, /[A-Za-z]/);

        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('shul mode collapses the library, and its auto-scroll starts and stops with the toggles', async () => {
    const page = await openText();
    try {
        change(page, el(page, 'shulModeToggle'), true);
        assert.ok(page.document.body.classList.contains('shul-mode'));
        change(page, el(page, 'shulAutoScrollToggle'), true);
        change(page, el(page, 'shulScrollSpeed'), 40);
        assert.equal(prefs(page).shulScrollSpeed, 40);
        await page.settle(4);
        await new Promise((resolve) => setTimeout(resolve, 60));
        await page.eval(`toggleShulLibrarySidebar()`);
        assert.equal(page.eval('appState.shulSidebarOpen'), true);
        await page.eval(`toggleShulLibrarySidebar()`);
        assert.equal(page.eval('appState.shulSidebarOpen'), false);
        change(page, el(page, 'shulModeToggle'), false);
        assert.equal(page.document.body.classList.contains('shul-mode'), false);
        page.window.dispatchEvent(new page.window.Event('resize'));
    } finally {
        page.close();
    }
});

test('the theme button cycles the theme and the choice is saved', async () => {
    const page = await openShellPage({ fetch: routes() });
    try {
        const seen = new Set();
        for (let i = 0; i < 4; i += 1) {
            page.click(el(page, 'themeToggleBtn'));
            seen.add(page.eval('appState.prefs.theme'));
        }
        assert.ok(seen.size >= 2, [...seen].join(','));
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('the menus open and close, and a click outside closes them', async () => {
    const page = await openText();
    try {
        for (const name of ['settingsMenuBtn', 'userProfileMenuBtn', 'readerSettingsBtn']) {
            page.click(el(page, name));
            await page.settle(2);
        }
        page.click(page.document.body);
        await page.settle(4);
        page.click(el(page, 'readerLibraryTopBarBtn'));
        page.click(el(page, 'readerCommentaryTopBarBtn'));
        await page.settle(4);
        for (const name of ['hideLeftSidebarBtn', 'hideRightSidebarBtn', 'showLeftSidebarTopBtn', 'closeLeftSidebarBtn', 'closeRightSidebarBtn', 'mobileDrawerBackdrop', 'mobileLangToggle']) {
            const target = page.eval(`typeof ${name} === 'undefined' ? null : ${name}`);
            if (target) page.click(target);
        }
        await page.settle(4);
        page.window.dispatchEvent(new page.window.Event('orientationchange'));
        page.window.dispatchEvent(new page.window.Event('resize'));
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('the search field and the settings button are named in the interface language', async () => {
    const page = await openText();
    try {
        const search = el(page, 'searchInput');
        const settings = el(page, 'settingsMenuBtn');
        page.eval(`applyStaticHebrewFallbackTranslations('he'); localizePlaceholders('he')`);
        assert.equal(settings.getAttribute('aria-label'), 'פתח תפריט הגדרות');
        assert.equal(search.getAttribute('aria-label'), search.dataset.hePlaceholder.replace(/\.+$/, ''));
        page.eval(`applyStaticHebrewFallbackTranslations('en'); localizePlaceholders('en')`);
        assert.equal(settings.getAttribute('aria-label'), 'Open settings menu');
        assert.equal(search.getAttribute('aria-label'), search.dataset.enPlaceholder.replace(/\.+$/, ''));
    } finally {
        page.close();
    }
});

test('the AI settings button opens the conversation panel\'s settings', async () => {
    const ui = fakeConversationUI();
    const page = await openShellPage({ fetch: routes(), before: (window) => { window.ShelahConversationUI = ui; } });
    try {
        const button = page.eval('openAiSettingsBtn');
        if (button) {
            page.click(button);
            assert.equal(ui.calls.some(([name]) => name === 'openSettings'), true);
        }
        page.eval(`window.ShelahPrefs.set('mode', 'deep')`);
        assert.equal(prefs(page).mode, 'deep');
        page.eval(`window.ShelahPrefs.set('mode', 'deep')`);
        page.eval(`window.ShelahPrefs.set('other', 'x')`);
        assert.equal(prefs(page).other, undefined);
    } finally {
        page.close();
    }
});

test('the Web search setting defaults to on, takes only a boolean, and is remembered', async () => {
    const page = await openShellPage({ fetch: routes(), before: (window) => { window.ShelahConversationUI = fakeConversationUI(); } });
    try {
        assert.equal(page.eval('appState.prefs.webSearch'), true, 'on until the reader turns it off');
        page.eval(`window.ShelahPrefs.set('webSearch', 'no')`);
        assert.equal(page.eval('appState.prefs.webSearch'), true, 'a non-boolean is ignored');
        assert.equal(prefs(page).webSearch, undefined, 'and nothing was saved');
        page.eval(`window.ShelahPrefs.set('webSearch', false)`);
        assert.equal(prefs(page).webSearch, false);
        page.eval(`window.ShelahPrefs.set('webSearch', true)`);
        assert.equal(prefs(page).webSearch, true);
    } finally {
        page.close();
    }
});

test('the mobile bottom tabs go home, search, to the library and to the daily section', async () => {
    const page = await openText();
    try {
        for (const tab of page.$$('[data-mobile-tab]')) {
            page.click(tab);
            await page.settle(2);
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

// --- bookmarks, recents, import and export --------------------------------

test('opening a text adds it to Recent; the bookmark button saves and unsaves it', async () => {
    const page = await openText();
    try {
        assert.equal(shelf(page).recent[0].value, 'Genesis 1');
        const button = el(page, 'bookmarkCurrentBtn');
        assert.match(button.textContent, /Save Current/);
        page.click(button);
        assert.equal(shelf(page).bookmarks[0].value, 'Genesis 1');
        assert.match(button.textContent, /Saved/);
        assert.match(page.$('#personalShelf').textContent, /Genesis 1/);
        page.click(button);
        assert.deepEqual(shelf(page).bookmarks, []);
    } finally {
        page.close();
    }
});

test('each kind of shelf item reopens its page', async () => {
    const items = [
        { type: 'text', value: 'Exodus 2', label: 'Exodus 2' },
        { type: 'prayer', value: 'Shema', label: 'Shema' },
        { type: 'community', value: 'Moroccan', label: 'Moroccan' },
        { type: 'history', value: 'history', label: 'Your questions' },
        { type: 'ask', value: 'What is Shabbat?', label: 'What is Shabbat?' },
    ];
    const ui = fakeConversationUI();
    const page = await openShellPage({
        fetch: routes(),
        storage: { [`Sh'elahShelf`]: JSON.stringify({ bookmarks: items, recent: [{ type: 'text', value: 'Genesis 1', label: 'Genesis 1' }] }) },
        before: (window) => { window.ShelahConversationUI = ui; },
    });
    try {
        const bookmarkButtons = () => page.$$('#personalShelf .shelf-open[data-shelf-bucket="bookmarks"]');
        assert.equal(bookmarkButtons().length, 5);
        // The shelf redraws after each open, so each click looks its button up afresh.
        for (let i = 0; i < 5; i += 1) {
            page.click(bookmarkButtons()[i]);
            await page.settle(10);
        }
        assert.ok(page.calls.some((c) => c.url.startsWith('/api/text/Exodus%202')));
        assert.ok(page.calls.some((c) => c.url.includes('Shema')));
        assert.ok(page.calls.some((c) => c.url.startsWith('/api/community/Moroccan')));
        assert.ok(ui.calls.some(([name, question]) => name === 'askFromSearch' && question === 'What is Shabbat?'));
        assert.equal(await page.eval(`openShelfItem('unknown', 'x', 'y')`), undefined);
        await page.eval(`openShelfItem('siddur', 'edot-hamizrach')`);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('a stored answer on the shelf is matched by the ask-history module', async () => {
    const ui = fakeConversationUI();
    const page = await openShellPage({
        fetch: routes(),
        storage: { [`Sh'elahShelf`]: JSON.stringify({ bookmarks: [{ type: 'ask', value: 'old question', label: 'old question' }] }) },
        before: (window) => {
            window.ShelahConversationUI = ui;
            window.ShelahAskHistory = {
                resolveShelfAsk: async () => ({ migrateTo: 'h-9', staleId: 'h-0', reask: 'asked again' }),
                promoteAskEntries: (data, question, id) => ({ ...data, bookmarks: [{ type: 'ask', value: id, label: question }] }),
                sameQuestion: (a, b) => a === b,
                isHistoryId: (id) => /^h-/.test(id),
            };
        },
    });
    try {
        page.click(page.$('#personalShelf .shelf-open'));
        await page.settle(10);
        assert.deepEqual(page.errors, []);
        assert.equal(shelf(page).bookmarks[0].value, 'h-1');
        assert.ok(ui.calls.some(([name, question]) => name === 'askFromSearch' && question === 'asked again'));
    } finally {
        page.close();
    }
});

test('clearing Recent empties it, and a right-click removes a single recent item', async () => {
    const page = await openShellPage({
        fetch: routes(),
        storage: { [`Sh'elahShelf`]: JSON.stringify({ recent: [{ type: 'text', value: 'A 1' }, { type: 'text', value: 'B 1' }], bookmarks: [{ type: 'text', value: 'Keep 1' }] }) },
    });
    try {
        const recent = page.$$('#personalShelf .shelf-open[data-shelf-bucket="recent"]');
        const second = recent.find((b) => b.dataset.value === 'B 1');
        const event = new page.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        second.dispatchEvent(event);
        assert.equal(event.defaultPrevented, true);
        assert.deepEqual(shelf(page).recent.map((i) => i.value), ['A 1']);

        const bookmark = page.$('#personalShelf .shelf-open[data-shelf-bucket="bookmarks"]');
        const keep = new page.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        bookmark.dispatchEvent(keep);
        assert.equal(keep.defaultPrevented, false);

        page.eval(`removeRecentShelfItem('text', 'Nope 1')`);
        page.eval(`removeRecentShelfItem('', '')`);
        page.click(page.$('[data-action="clear-recents"]'));
        assert.deepEqual(shelf(page).recent, []);
        assert.equal(shelf(page).bookmarks.length, 1);
        page.click(page.$('#personalShelf'));
    } finally {
        page.close();
    }
});

test('a shelf can be pasted in as JSON, a share link, a hash or a code', async () => {
    const page = await openShellPage({ fetch: routes() });
    try {
        const data = { recent: [], bookmarks: [{ type: 'text', value: 'Isaiah 1', label: 'Isaiah 1' }], notes: { a: 'b' } };
        const json = JSON.stringify(data);
        const code = Buffer.from(unescape(encodeURIComponent(json))).toString('base64');
        const parse = (raw) => page.eval(`parseShelfImportInput(${JSON.stringify(raw)})`);

        assert.equal(parse(json).bookmarks[0].value, 'Isaiah 1');
        assert.equal(parse(`#shelf=${code}`).bookmarks[0].value, 'Isaiah 1');
        assert.equal(parse(`#shelf=${encodeURIComponent(code)}`).bookmarks[0].value, 'Isaiah 1');
        assert.equal(parse(`https://shelah.org/#shelf=${encodeURIComponent(code)}`).bookmarks[0].value, 'Isaiah 1');
        assert.equal(parse(`see this: x#shelf=${encodeURIComponent(code)}`).bookmarks[0].value, 'Isaiah 1');
        assert.equal(parse(code).bookmarks[0].value, 'Isaiah 1');
        assert.equal(parse(`https://shelah.org/?x=1#shelf=bad`), null);
        assert.equal(parse(''), null);
        assert.equal(parse('{not json'), null);
        assert.equal(parse('%%%'), null);

        page.dialogs.promptAnswer = json;
        page.eval(`importShelfFromPrompt()`);
        assert.equal(shelf(page).bookmarks[0].value, 'Isaiah 1');
        assert.match(page.dialogs.alerts.at(-1), /imported successfully/);

        page.dialogs.promptAnswer = 'garbage ~~';
        page.eval(`importShelfFromPrompt()`);
        assert.match(page.dialogs.alerts.at(-1), /Could not import/);

        page.dialogs.promptAnswer = null;
        const alerts = page.dialogs.alerts.length;
        page.eval(`importShelfFromPrompt()`);
        assert.equal(page.dialogs.alerts.length, alerts);
        assert.equal(page.eval(`decodeShelfSharePayload('@@')`), null);
    } finally {
        page.close();
    }
});

test('a shelf link opened in the browser imports itself and leaves the address clean', async () => {
    const data = { recent: [], bookmarks: [{ type: 'text', value: 'Psalms 23', label: 'Psalms 23' }] };
    const code = Buffer.from(unescape(encodeURIComponent(JSON.stringify(data)))).toString('base64');
    const page = await openShellPage({ fetch: routes(), url: `https://shelah.org/?x=1#shelf=${encodeURIComponent(code)}` });
    try {
        assert.equal(shelf(page).bookmarks[0].value, 'Psalms 23');
        assert.equal(page.window.location.hash, '');
    } finally {
        page.close();
    }
    const broken = await openShellPage({ fetch: routes(), url: 'https://shelah.org/#shelf=@@@' });
    try {
        assert.equal(broken.window.location.hash, '#shelf=@@@');
    } finally {
        broken.close();
    }
});

test('preferences saved by an older version are carried forward', async () => {
    const page = await openShellPage({
        fetch: routes(),
        storage: {
            [`Sh'elahPrefs`]: JSON.stringify({ community: 'Sephardi', showSidebars: false, readerLayout: 'stacked', theme: 'dark', fontSize: 22 }),
        },
    });
    try {
        assert.equal(page.eval('appState.prefs.community'), 'Sefardic');
        assert.equal(page.eval('appState.prefs.readerLayout'), 'interleaved');
        assert.equal('showSidebars' in page.eval('appState.prefs'), false);
        assert.equal(page.eval('appState.prefs.showRightSidebar'), false);
        assert.equal(page.eval('appState.prefs.fontSize'), 22);
    } finally {
        page.close();
    }
    const odd = await openShellPage({ fetch: routes(), storage: { [`Sh'elahPrefs`]: JSON.stringify({ readerLayout: 'zigzag' }) } });
    try {
        assert.equal(odd.eval('appState.prefs.readerLayout'), 'bilingual');
    } finally {
        odd.close();
    }
    const broken = await openShellPage({ fetch: routes(), storage: { [`Sh'elahPrefs`]: '{nope' } });
    try {
        assert.equal(broken.eval('appState.prefs.fontSize'), 18);
    } finally {
        broken.close();
    }
});

// --- study notes, export -----------------------------------------

test('saving a study note needs an open text', async () => {
    const page = await openShellPage({ fetch: routes() });
    try {
        await page.eval(`saveSemanticBookmark()`);
        assert.match(page.dialogs.alerts.at(-1), /Open a text/);
        assert.equal(page.eval('getSemanticBookmarkPayload()'), null);
    } finally {
        page.close();
    }
});

test('a study note is posted with the open passage and the result is reported', async () => {
    const results = [
        [{ status: 200, body: { item: { ai_summary: 'About creation' } } }, /Study note saved\. Summary: About creation/],
        [{ status: 200, body: { summary_error: 'quota' } }, /AI summary is currently unavailable/],
        [{ status: 200, body: {} }, /^Study note saved\.$/],
        [{ status: 500, body: { error: 'database down' } }, /Could not save study note: database down/],
        [{ status: 500, body: {} }, /HTTP 500/],
    ];
    for (const [response, expected] of results) {
        const page = await openText({ fetch: { '/api/bookmarks/semantic': response } });
        try {
            const payload = page.eval('getSemanticBookmarkPayload()');
            assert.equal(payload.ref, 'Genesis 1');
            assert.match(payload.segment_text, /In the beginning/);
            await page.eval(`saveSemanticBookmark()`);
            assert.match(page.dialogs.alerts.at(-1), expected);
            const post = page.calls.find((c) => c.url === '/api/bookmarks/semantic');
            assert.equal(post.init.method, 'POST');
            assert.equal(JSON.parse(post.init.body).ref, 'Genesis 1');
            assert.equal(el(page, 'semanticBookmarkBtn').disabled, false);
        } finally {
            page.close();
        }
    }
});

test('a study note retries once on a 401 with a fresh token, then asks to sign in', async () => {
    const clerk = fakeClerk({ user: SIGNED_IN_USER, tokens: ['t1', 't2'] });
    const page = await openText({
        fetch: { '/api/bookmarks/semantic': { status: 401, body: {} } },
        before: (window) => withClerk(window, clerk),
    });
    try {
        await page.eval(`saveSemanticBookmark()`);
        assert.equal(page.calls.filter((c) => c.url === '/api/bookmarks/semantic').length, 2);
        assert.match(page.dialogs.alerts.at(-1), /sign in to save study notes/);
    } finally {
        page.close();
    }
});

test('a signed-out visitor is sent to sign in before saving a note', async () => {
    const clerk = fakeClerk();
    const page = await openText({ before: (window) => withClerk(window, clerk) });
    try {
        await page.eval(`saveSemanticBookmark()`);
        assert.equal(page.calls.some((c) => c.url === '/api/bookmarks/semantic'), false);
        assert.ok(clerk.calls.some(([name]) => name === 'openSignIn'));
    } finally {
        page.close();
    }
});

test('exporting a chapter posts it and downloads the file', async () => {
    const page = await openText({ fetch: { '/api/export/chapter': { ok: true } } });
    try {
        const payload = page.eval('buildCurrentCitationExportPayload()');
        assert.equal(payload.lines.length, 3);
        page.eval(`exportFormatSelect.value = 'docx'`);
        assert.equal(page.eval('getSelectedExportFormat()'), 'docx');
        page.eval(`exportFormatSelect.value = 'rtf'`);
        assert.equal(page.eval('getSelectedExportFormat()'), 'txt');
        page.eval(`exportFormatSelect.value = 'pdf'`);
        page.click(el(page, 'exportCitationBtn'));
        await page.settle(10);
        const post = page.calls.find((c) => c.url === '/api/export/chapter');
        assert.equal(JSON.parse(post.init.body).format, 'pdf');
        assert.equal(page.objectUrls.length, 1);
    } finally {
        page.close();
    }
});

test('an export that fails, or has nothing to export, says so', async () => {
    const page = await openText({ fetch: { '/api/export/chapter': { status: 500, body: { error: 'renderer down' } } } });
    try {
        await page.eval(`exportCurrentCitation()`);
        assert.match(page.dialogs.alerts.at(-1), /Could not export chapter: renderer down/);
    } finally {
        page.close();
    }
    const empty = await openShellPage({ fetch: routes() });
    try {
        await empty.eval(`exportCurrentCitation()`);
        assert.match(empty.dialogs.alerts.at(-1), /Open a text chapter first/);
        assert.equal(empty.eval('buildCurrentCitationExportPayload()'), null);
    } finally {
        empty.close();
    }
});

// --- developer inspector, citations --------------------------------

test('the developer inspector opens on shift + double-click and polls the heartbeat', async () => {
    const page = await openShellPage({ fetch: routes({ '/api/devtools/heartbeat': { ts: 123, stats: { ok: 1 } } }) });
    try {
        el(page, 'brandHomeBtn').dispatchEvent(new page.window.MouseEvent('dblclick', { bubbles: true, shiftKey: true, cancelable: true }));
        await page.settle();
        assert.equal(el(page, 'devtoolsInspectorModal').classList.contains('flex'), true);
        assert.equal(page.eval('appState.reliability.lastHeartbeat'), 123);
        assert.match(el(page, 'devtoolsLog').textContent, /heartbeat/);
        page.click(el(page, 'closeDevtoolsInspectorBtn'));
        assert.equal(el(page, 'devtoolsInspectorModal').classList.contains('hidden'), true);
        el(page, 'brandHomeBtn').dispatchEvent(new page.window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        assert.equal(el(page, 'devtoolsInspectorModal').classList.contains('flex'), false);
    } finally {
        page.close();
    }
    const down = await openShellPage({ fetch: routes({ '/api/devtools/heartbeat': () => { throw new Error('down'); } }) });
    try {
        await down.eval(`fetchDevtoolsHeartbeat()`);
        assert.match(el(down, 'devtoolsLog').textContent, /heartbeat-error down/);
    } finally {
        down.close();
    }
});

test('the route keeps display settings a link brought and drops the rest', async () => {
    const router = fakeRouter({ layout: 'hebrew', size: '30', vowels: '0' });
    const page = await openShellPage({ fetch: routes(), before: (window) => { window.ShelahRouter = router; } });
    try {
        assert.equal(page.eval(`applyRouteDisplayPrefs({ layout: 'english', size: '30', vowels: '0', taamim: '1', translit: '1' })`), true);
        assert.equal(page.eval('appState.prefs.readerLayout'), 'english');
        assert.equal(page.eval('appState.prefs.fontSize'), 30);
        assert.equal(page.eval('appState.prefs.showVowels'), false);
        assert.deepEqual(JSON.parse(JSON.stringify(page.eval('readerDisplayRoutePatch()'))).layout, 'english');
        assert.equal(JSON.parse(page.window.localStorage.getItem(page.eval('APP_PREFS_KEY')) || 'null'), null);
        page.eval('savePrefs()');
        assert.equal(prefs(page).readerLayout, 'bilingual');
        assert.equal(page.eval(`applyRouteDisplayPrefs({})`), true);
        assert.equal(page.eval('appState.prefs.readerLayout'), 'bilingual');
        page.eval(`applyRouteDisplayPrefs({ layout: 'hebrew' })`);
        page.eval(`releaseRouteDisplayPref('layout')`);
        assert.ok(router.calls.some(([name, patch]) => name === 'pushRoute' && patch.layout === null));
        page.eval(`releaseRouteDisplayPref('nonsense')`);
    } finally {
        page.close();
    }
});
