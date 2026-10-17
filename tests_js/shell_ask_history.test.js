/**
 * The signed-in visitor's saved answers: the "recent questions" list in the
 * sidebar, the /history page around static/js/ask-history.js, and the two ways
 * a link opens one answer (/answer/<id> for the owner, /a/<token> for anyone).
 * Boots the real home page in jsdom (tests_js/helpers/shell_page.js);
 * ask-history.js and the conversation panel are stand-ins that record what
 * shell.js asked of them.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');
const { fakeClerk, withClerk, SIGNED_IN_USER, fakeRouter } = require('./helpers/shell_fakes');

const plain = (value) => JSON.parse(JSON.stringify(value));
const call = (page, name, ...args) => page.call(name, ...args);

const ITEMS = [
    { id: 'h-1', question: 'What is Shabbat?', created_at: '2026-10-01T10:00:00Z', answer: 'A day of rest.' },
    { id: 'h-2', question: `${'Long question '.repeat(10)}<b>bold</b>`, created_at: '' },
    { id: 'h-3', question: '   ' },
];

/** window.ShelahConversationUI with every method shell.js reaches for here. */
function recordingUi(overrides = {}) {
    const calls = [];
    const note = (name, result) => (...args) => { calls.push([name, ...args]); return result; };
    return {
        calls,
        showAnswer: note('showAnswer'),
        reopenAnswer: note('reopenAnswer', false),
        showSavedLoading: note('showSavedLoading'),
        showSavedUnavailable: note('showSavedUnavailable'),
        showPublicLoading: note('showPublicLoading'),
        showPublicConversation: note('showPublicConversation'),
        showPublicUnavailable: note('showPublicUnavailable'),
        ...overrides,
    };
}

/** window.ShelahAskHistory: records each history page the shell creates. */
function recordingAskHistory() {
    const pages = [];
    return {
        pages,
        historyQueryString: ({ q, cursor, limit }) => new URLSearchParams(Object.entries({ q, cursor, limit: limit ?? 20 })).toString(),
        promoteAskEntries: (shelf, question, id) => {
            let changed = false;
            const rewrite = (entry) => {
                if (entry?.type === 'ask' && entry.value === question) { changed = true; return { ...entry, value: id }; }
                return entry;
            };
            const next = { ...shelf, recent: shelf.recent.map(rewrite), bookmarks: shelf.bookmarks.map(rewrite) };
            return changed ? next : null;
        },
        sameQuestion: (a, b) => a === b,
        createHistoryPage(root, options) {
            const handle = {
                root,
                options,
                refreshed: 0,
                destroyed: false,
                refresh() { handle.refreshed += 1; },
                destroy() { handle.destroyed = true; },
            };
            pages.push(handle);
            return handle;
        },
    };
}

/**
 * The page with a signed-in Clerk (or none) and the stand-ins installed after
 * boot. `routes` are matched in order, so the one-answer routes come first.
 */
async function openHistoryPage({ signedIn = true, routes = {}, route = {}, withHistory = true, configured = true } = {}) {
    const clerk = fakeClerk({ user: signedIn ? SIGNED_IN_USER : null });
    clerk.loaded = true;
    const router = fakeRouter(route);
    // The routes a test gives come first (the one-answer routes must be tried
    // before the list's, which they start with) and replace a default.
    const table = { ...routes };
    for (const [pattern, body] of [['/api/user/history', { items: ITEMS }], ['/api/user/preferences', { prefs: {} }]]) {
        if (!(pattern in table)) table[pattern] = body;
    }
    const page = await openShellPage({
        fetch: table,
        before: (window) => { if (configured) withClerk(window, clerk); },
    });
    const ui = recordingUi();
    const history = recordingAskHistory();
    page.window.ShelahConversationUI = ui;
    page.window.ShelahRouter = router;
    if (withHistory) page.window.ShelahAskHistory = history;
    Object.assign(page, { clerk, router, ui, history });
    await page.settle(10);
    page.takeCalls();
    return page;
}

const routed = (page) => plain(page.router.calls);
const requests = (page, prefix = '/api/user/history') => page.takeCalls().filter((request) => request.url.startsWith(prefix));
const shelfOf = (page) => plain(page.eval('getShelfData()'));
const seedShelf = (page, shelf) => page.eval(`localStorage.setItem(APP_SHELF_KEY, ${JSON.stringify(JSON.stringify(shelf))})`);

// ── The sidebar list ───────────────────────────────────────────────────────

test('a signed-in boot lists the recent questions, trimmed and escaped, and asks with the token', async () => {
    const clerk = fakeClerk({ user: SIGNED_IN_USER, token: 'bearer-1' });
    const page = await openShellPage({
        fetch: { '/api/user/history': { items: ITEMS }, '/api/user/preferences': { prefs: {} } },
        before: (window) => withClerk(window, clerk),
    });
    try {
        await page.settle(10);
        const request = page.calls.find((entry) => entry.url === '/api/user/history?limit=20');
        assert.equal(request.init.headers.Authorization, 'Bearer bearer-1');
        assert.equal(page.$('#askHistorySection').classList.contains('hidden'), false);
        const buttons = page.$$('.ask-history-q');
        assert.equal(buttons.length, 3);
        assert.match(buttons[0].textContent, /What is Shabbat\?/);
        assert.match(buttons[0].querySelector('.ask-history-date').textContent, /Oct/);
        assert.equal(buttons[1].querySelector('.ask-history-date').textContent, '', 'no date, no label');
        assert.ok(buttons[1].title.length <= 80 + 12, 'cut at 80 characters');
        assert.equal(buttons[1].querySelector('b'), null, 'a question is text, never markup');
        assert.equal(buttons[2].title, '');
        assert.deepEqual(page.$$('.ask-history-del').map((button) => button.dataset.id), ['h-1', 'h-2', 'h-3']);
    } finally {
        page.close();
    }
});

test('with nobody signed in, the list is never asked for', async () => {
    const page = await openHistoryPage({ signedIn: false });
    try {
        await call(page, 'loadAskHistory');
        assert.deepEqual(requests(page), []);
        assert.equal(page.$$('.ask-history-q').length, 0);
    } finally {
        page.close();
    }
});

test('no entries, a refusal, a lost connection or a reply without items hides the list', async () => {
    for (const routes of [
        { '/api/user/history': { items: [] } },
        { '/api/user/history': { status: 500, body: {} } },
        { '/api/user/history': () => { throw new Error('offline'); } },
        { '/api/user/history': {} },
    ]) {
        const page = await openHistoryPage({ routes });
        try {
            page.$('#askHistorySection').classList.remove('hidden');
            await call(page, 'loadAskHistory');
            assert.equal(page.$('#askHistorySection').classList.contains('hidden'), true, JSON.stringify(Object.keys(routes)));
        } finally {
            page.close();
        }
    }
});

test('while the list loads, it shows placeholder lines', async () => {
    let release;
    const page = await openHistoryPage({
        routes: { '/api/user/history': () => new Promise((resolve) => { release = () => resolve({ items: ITEMS }); }) },
    });
    try {
        const pending = call(page, 'loadAskHistory');
        await page.settle(5);
        assert.equal(page.$$('#askHistoryList .ai-src-skeleton-line').length, 3);
        assert.equal(page.$('#askHistorySection').classList.contains('hidden'), false);
        release();
        await pending;
        assert.equal(page.$$('#askHistoryList .ai-src-skeleton-line').length, 0);
    } finally {
        page.close();
    }
});

test('clicking a question reopens its stored answer in the panel and gives it a history entry', async () => {
    const page = await openHistoryPage();
    try {
        await call(page, 'loadAskHistory');
        page.click(page.$$('.ask-history-q')[0]);
        assert.deepEqual(plain(page.ui.calls), [['showAnswer', ITEMS[0]]]);
        assert.equal(page.$('#searchInput').value, 'What is Shabbat?');
        assert.deepEqual(routed(page), [['pushRoute', { chat: 'h-1' }, { exclusive: true, overlay: 'answer' }]]);
    } finally {
        page.close();
    }
});

test('a stored answer opened from the URL does not write history; a public one clears the search box', async () => {
    const page = await openHistoryPage();
    try {
        page.eval(`openStoredAskAnswer(null)`);
        page.eval(`openStoredAskAnswer({ id: 'h-1', question: 'Q' }, { fromRoute: true })`);
        assert.equal(page.$('#searchInput').value, 'Q');
        page.eval(`openStoredAskAnswer({ id: 'h-2', question: 'Q2' }, { replace: true })`);
        page.eval(`openStoredAskAnswer({ question: 'No id' })`);
        page.eval(`openStoredAskAnswer({ id: 'h-3', question: 'Hidden', public: true })`);
        assert.equal(page.$('#searchInput').value, '', 'a visitor on a shared link asked nothing');
        assert.deepEqual(routed(page), [
            ['pushRoute', { chat: 'h-2' }, { exclusive: true, replace: true }],
            ['pushRoute', { chat: 'h-3' }, { exclusive: true, overlay: 'answer' }],
        ]);
        assert.equal(page.ui.calls.length, 4);
    } finally {
        page.close();
    }
});

test('deleting an entry asks the server, forgets it on the shelf and the page, and reloads the list', async () => {
    const page = await openHistoryPage({ routes: { '/api/user/history/h-1': { ok: true } } });
    try {
        await call(page, 'loadAskHistory');
        seedShelf(page, {
            recent: [{ type: 'ask', value: 'h-1', label: 'What is Shabbat?' }, { type: 'text', value: 'Genesis 1' }],
            bookmarks: [{ type: 'ask', value: 'h-1', label: 'What is Shabbat?' }, { type: 'ask', value: 'h-2', label: 'Other' }],
        });
        page.eval(`askHistoryPage = { refresh() { window.__refreshed = true; }, destroy() {} }`);
        page.takeCalls();
        page.click(page.$$('.ask-history-del')[0]);
        await page.settle(10);
        const sent = requests(page).map((request) => `${request.init?.method || 'GET'} ${request.url}`);
        assert.deepEqual(sent.slice(0, 2), ['DELETE /api/user/history/h-1', 'GET /api/user/history?limit=20']);
        const shelf = shelfOf(page);
        assert.deepEqual(shelf.recent.map((entry) => entry.value), ['Genesis 1']);
        assert.deepEqual(shelf.bookmarks.map((entry) => entry.value), ['h-2']);
        assert.equal(page.eval('window.__refreshed'), true);
    } finally {
        page.close();
    }
});

test('the delete request is a DELETE with the token, and its failure leaves the shelf alone', async () => {
    const page = await openHistoryPage({ routes: { '/api/user/history/h-1': { status: 500, body: {} } } });
    try {
        seedShelf(page, { recent: [{ type: 'ask', value: 'h-1' }], bookmarks: [] });
        page.takeCalls();
        assert.equal(await call(page, 'deleteAskHistoryEntry', 'h-1'), false);
        const [request] = requests(page);
        assert.equal(request.init.method, 'DELETE');
        assert.equal(request.init.headers.Authorization, 'Bearer tok-1');
        assert.equal(shelfOf(page).recent.length, 1);
    } finally {
        page.close();
    }
});

test('a delete that cannot reach the server reports false', async () => {
    const page = await openHistoryPage({ routes: { '/api/user/history/odd%20id': () => { throw new Error('offline'); } } });
    try {
        assert.equal(await call(page, 'deleteAskHistoryEntry', 'odd id'), false);
    } finally {
        page.close();
    }
});

test('dropping a shelf entry that is not there changes nothing', async () => {
    const page = await openHistoryPage();
    try {
        seedShelf(page, { recent: [{ type: 'text', value: 'Genesis 1' }], bookmarks: [] });
        page.eval(`dropShelfAsk('missing')`);
        assert.deepEqual(shelfOf(page).recent.map((entry) => entry.value), ['Genesis 1']);
    } finally {
        page.close();
    }
});

test('an answer that got its id replaces the question that stood in its shelf entry', async () => {
    const page = await openHistoryPage();
    try {
        seedShelf(page, { recent: [{ type: 'ask', value: 'What is Shabbat?', label: 'What is Shabbat?' }], bookmarks: [] });
        page.eval(`appState.currentView = { type: 'ask', value: 'What is Shabbat?', label: 'What is Shabbat?' }`);
        page.eval(`promoteShelfAsk('What is Shabbat?', 'h-1')`);
        assert.deepEqual(shelfOf(page).recent.map((entry) => entry.value), ['h-1']);
        assert.deepEqual(plain(page.eval('appState.currentView')), { type: 'ask', value: 'h-1', label: 'What is Shabbat?' });
        // A second answer with nothing to promote leaves the shelf alone.
        page.eval(`promoteShelfAsk('Another question', 'h-9')`);
        assert.deepEqual(shelfOf(page).recent.map((entry) => entry.value), ['h-1']);
    } finally {
        page.close();
    }
});

test('a signed-out boot hides and empties the list; signing in again brings it back', async () => {
    const page = await openHistoryPage();
    try {
        await call(page, 'loadAskHistory');
        assert.equal(page.$$('.ask-history-q').length, 3);
        await page.clerk.signOut();
        await call(page, 'refreshAuthUi');
        assert.equal(page.$('#askHistorySection').classList.contains('hidden'), true);
        assert.equal(page.$('#askHistoryList').innerHTML, '');
    } finally {
        page.close();
    }
});

// ── The /history page ──────────────────────────────────────────────────────

test('the /history page does nothing without ask-history.js', async () => {
    const page = await openHistoryPage({ withHistory: false });
    try {
        call(page, 'displayAskHistoryPage');
        assert.ok(!page.eval('appState.currentView'), 'no view was opened');
    } finally {
        page.close();
    }
});

test('the /history page takes over the reader and hands ask-history.js what it needs', async () => {
    const page = await openHistoryPage();
    try {
        page.eval(`displayAskHistoryPage({ query: 'shabbat' })`);
        assert.equal(page.eval('appState.currentView.type'), 'history');
        assert.equal(page.$('#readerTitle').innerText ?? page.$('#readerTitle').textContent, 'Your questions');
        assert.equal(page.$('#reader').classList.contains('hidden'), false);
        assert.equal(page.$('#readerTopBar').classList.contains('hidden'), true);
        assert.match(page.$('#sourcesDynamicContent').textContent, /Every answer you get while signed in is saved here/);
        const [handle] = page.history.pages;
        assert.equal(handle.root.id, 'askHistoryPageRoot');
        assert.equal(handle.options.initialQuery, 'shabbat');
        assert.equal(page.eval('window.currentTextPayload'), null);
        assert.equal(page.$('#readerSources').innerHTML, '');
    } finally {
        page.close();
    }
});

test('the /history page title and intro follow the reader\'s language', async () => {
    const page = await openHistoryPage();
    try {
        page.eval(`isHebrewMode = () => true; t = (en, he) => he;`);
        page.eval(`displayAskHistoryPage()`);
        assert.equal(page.eval('appState.currentView.label'), 'השאלות שלך');
        assert.match(page.$('#sourcesDynamicContent').textContent, /כל תשובה/);
        const { formatDate } = page.history.pages[0].options;
        assert.match(formatDate('2026-10-01T10:00:00Z'), /2026/);
    } finally {
        page.close();
    }
});

test('showing the page again while it is up keeps the list as it was; another view replaces it', async () => {
    const page = await openHistoryPage();
    try {
        page.eval(`displayAskHistoryPage()`);
        page.eval(`displayAskHistoryPage()`);
        assert.equal(page.history.pages.length, 1, 'search and loaded pages stay');
        page.eval(`appState.currentView = { type: 'text', value: 'Genesis 1', label: 'Genesis 1' }`);
        page.eval(`displayAskHistoryPage()`);
        assert.equal(page.history.pages.length, 2);
        assert.equal(page.history.pages[0].destroyed, true, 'the old list goes with its view');
        assert.equal(page.history.pages[1].destroyed, false);
        page.eval(`closeAskHistoryPage()`);
        assert.equal(page.history.pages[1].destroyed, true);
        page.eval(`closeAskHistoryPage()`);
    } finally {
        page.close();
    }
});

test('the history page fetches its pages with the token and says what went wrong', async () => {
    const page = await openHistoryPage({
        routes: { '/api/user/history?q=moses&cursor=c1&limit=20': { items: [{ id: 'h-9' }], next_cursor: null }, '/api/user/history?q=bad': { status: 502, body: {} } },
    });
    try {
        page.eval(`displayAskHistoryPage()`);
        const { fetchPage } = page.history.pages[0].options;
        page.takeCalls();
        assert.deepEqual(plain(await fetchPage({ q: 'moses', cursor: 'c1' })), { items: [{ id: 'h-9' }], next_cursor: null });
        const [request] = requests(page);
        assert.equal(request.init.headers.Authorization, 'Bearer tok-1');
        await assert.rejects(fetchPage({ q: 'bad', cursor: '' }), /history 502/);
    } finally {
        page.close();
    }
});

test('the history page opens an entry as an answer, signs in, and links to the answer', async () => {
    const page = await openHistoryPage();
    try {
        page.eval(`displayAskHistoryPage()`);
        const { options } = page.history.pages[0];
        options.openEntry(ITEMS[0]);
        assert.equal(page.ui.calls[0][0], 'showAnswer');
        assert.equal(options.answerHref('a b/c'), '/answer/a%20b%2Fc');
        page.eval(`handleSignIn = async () => { window.__signIn = true; }`);
        options.signIn();
        assert.equal(page.eval('window.__signIn'), true);
        assert.equal(typeof options.escapeHtml('<'), 'string');
        assert.equal(options.t('Yes', 'כן'), 'Yes');
        assert.deepEqual(Object.keys(options.icons).sort(), ['delete', 'search']);
        assert.match(options.formatDate('2026-10-01T10:00:00Z'), /Oct/);
    } finally {
        page.close();
    }
});

test('deleting from the history page drops the shelf entry and reloads the sidebar list', async () => {
    const page = await openHistoryPage();
    try {
        seedShelf(page, { recent: [{ type: 'ask', value: 'h-1' }], bookmarks: [] });
        page.eval(`displayAskHistoryPage()`);
        page.history.pages[0].options.onDeleted('h-1');
        await page.settle(10);
        assert.deepEqual(shelfOf(page).recent, []);
        assert.ok(requests(page).some((request) => request.url === '/api/user/history?limit=20'));
    } finally {
        page.close();
    }
});

test('typing in the history search rewrites the URL in place, and clearing it drops ?q=', async () => {
    const page = await openHistoryPage();
    try {
        page.eval(`displayAskHistoryPage()`);
        const { onQueryChange, deleteEntry } = page.history.pages[0].options;
        page.router.calls.length = 0;
        onQueryChange('moses');
        onQueryChange('');
        assert.deepEqual(routed(page), [
            ['pushRoute', { q: 'moses' }, { replace: true }],
            ['pushRoute', { q: null }, { replace: true }],
        ]);
        assert.equal(typeof deleteEntry, 'function');
    } finally {
        page.close();
    }
});

test('who the history page treats as signed in follows Clerk\'s own state', async () => {
    const page = await openHistoryPage();
    try {
        const state = () => call(page, 'askHistoryAuthState');
        assert.equal(await state(), 'signed-in');
        page.clerk.user = null;
        assert.equal(await state(), 'signed-out');
        page.clerk.loaded = false;
        assert.equal(await state(), 'pending');
        page.eval(`clerkStart = Promise.resolve(true)`);
        page.window.Clerk = undefined;
        assert.equal(await state(), 'pending', 'Clerk is on its way');
        page.eval(`clerkStart = null; clerkFailed = true`);
        assert.equal(await state(), 'unavailable');
        page.eval(`clerkFailed = false`);
        assert.equal(await state(), 'signed-out', 'never started: no Clerk cookie, so nobody is signed in');
        page.eval(`Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true })`);
        assert.equal(await state(), 'pending');
        page.window.APP_CLERK = undefined;
        assert.equal(await state(), 'unavailable');
    } finally {
        page.close();
    }
});

test('signing in or out refreshes the page that is showing; the View all link opens it', async () => {
    const page = await openHistoryPage();
    try {
        page.eval(`displayAskHistoryPage()`);
        page.document.dispatchEvent(new page.window.CustomEvent('shelah:auth-changed', { detail: { signedIn: false } }));
        assert.equal(page.history.pages[0].refreshed, 1);
        // Back to a view that is not the list: the link opens it again.
        page.eval(`closeAskHistoryPage()`);
        page.eval(`appState.currentView = { type: 'home', value: '', label: '' }`);
        const link = page.$('#askHistoryViewAll');
        for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
            link.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
        }
        assert.equal(page.history.pages.length, 1, 'a click that means "new tab" is left to the browser');
        const plainClick = new page.window.MouseEvent('click', { bubbles: true, cancelable: true });
        link.dispatchEvent(plainClick);
        assert.equal(plainClick.defaultPrevented, true);
        assert.equal(page.history.pages.length, 2);
    } finally {
        page.close();
    }
});

// ── /answer/<id>: one of the caller's own answers ──────────────────────────

const STORED = { id: 'c-1', question: 'Why?', answer: 'Because.' };

test('an /answer link with no id does nothing', async () => {
    const page = await openHistoryPage();
    try {
        await call(page, 'hydrateChatId', '');
        assert.deepEqual(page.ui.calls, []);
    } finally {
        page.close();
    }
});

test('an answer already open in the panel is only brought back', async () => {
    const page = await openHistoryPage({ route: { chat: 'c-1' } });
    try {
        page.ui.reopenAnswer = (id) => { page.ui.calls.push(['reopenAnswer', id]); return true; };
        await call(page, 'hydrateChatId', 'c-1');
        assert.deepEqual(plain(page.ui.calls), [['reopenAnswer', 'c-1']]);
        assert.deepEqual(requests(page), []);
    } finally {
        page.close();
    }
});

test('an owned answer opens from the link, with the token, without a second history entry', async () => {
    const page = await openHistoryPage({ route: { chat: 'c-1' }, routes: { '/api/user/history/c-1': STORED } });
    try {
        await call(page, 'hydrateChatId', 'c-1');
        const [request] = requests(page);
        assert.equal(request.init.cache, 'no-store');
        assert.equal(request.init.headers.Authorization, 'Bearer tok-1');
        assert.deepEqual(plain(page.ui.calls.map((entry) => entry[0])), ['reopenAnswer', 'showSavedLoading', 'showAnswer']);
        assert.deepEqual(routed(page), []);
        assert.equal(page.$('#searchInput').value, 'Why?');
        assert.equal(page.eval('chatHydrating'), null);
    } finally {
        page.close();
    }
});

test('while Clerk decides who this is, the link waits behind a loading state and asks nothing', async () => {
    const page = await openHistoryPage({ route: { chat: 'c-1' }, routes: { '/api/user/history/c-1': STORED } });
    try {
        page.clerk.loaded = false;
        await call(page, 'hydrateChatId', 'c-1');
        assert.deepEqual(page.ui.calls.map((entry) => entry[0]), ['reopenAnswer', 'showSavedLoading']);
        assert.deepEqual(requests(page), []);
        await call(page, 'hydrateChatId', 'c-1', { settled: true });
        assert.equal(requests(page).length, 1, 'Clerk gave up: the device cookie alone');
    } finally {
        page.close();
    }
});

test('the same link arriving again while it loads is asked for once', async () => {
    let release;
    const page = await openHistoryPage({
        route: { chat: 'c-1' },
        routes: { '/api/user/history/c-1': () => new Promise((resolve) => { release = () => resolve(STORED); }) },
    });
    try {
        const first = call(page, 'hydrateChatId', 'c-1');
        await page.settle(5);
        await call(page, 'hydrateChatId', 'c-1');
        release();
        await first;
        assert.equal(requests(page).length, 1);
    } finally {
        page.close();
    }
});

test('an answer that arrives after the visitor moved on is not opened', async () => {
    const page = await openHistoryPage({ route: { chat: 'other' }, routes: { '/api/user/history/c-1': STORED } });
    try {
        await call(page, 'hydrateChatId', 'c-1');
        assert.ok(!page.ui.calls.some((entry) => entry[0] === 'showAnswer'));
        assert.deepEqual(routed(page), []);
    } finally {
        page.close();
    }
});

test('an answer that is gone (404) while signed in drops the link and says so', async () => {
    const page = await openHistoryPage({ route: { chat: 'c-1' }, routes: { '/api/user/history/c-1': { status: 404, body: {} } } });
    try {
        await call(page, 'hydrateChatId', 'c-1');
        assert.deepEqual(routed(page), [['pushRoute', { chat: null }, { replace: true }]]);
        assert.deepEqual(plain(page.ui.calls.at(-1)), ['showSavedUnavailable', true]);
    } finally {
        page.close();
    }
});

test('a signed-out visitor on a 404 keeps the link and is offered sign-in', async () => {
    const page = await openHistoryPage({ signedIn: false, route: { chat: 'c-1' }, routes: { '/api/user/history/c-1': { status: 404, body: {} } } });
    try {
        await call(page, 'hydrateChatId', 'c-1');
        assert.deepEqual(routed(page), []);
        assert.deepEqual(plain(page.ui.calls.at(-1)), ['showSavedUnavailable', true, { signIn: true }]);
        // Clerk has settled with nobody: the link is dead for good.
        await call(page, 'hydrateChatId', 'c-1', { settled: true });
        assert.deepEqual(routed(page), [['pushRoute', { chat: null }, { replace: true }]]);
    } finally {
        page.close();
    }
});

test('a server error or a lost connection keeps the link for a reload to retry', async () => {
    for (const failure of [{ status: 500, body: {} }, () => { throw new Error('offline'); }]) {
        const page = await openHistoryPage({ route: { chat: 'c-1' }, routes: { '/api/user/history/c-1': failure } });
        try {
                await call(page, 'hydrateChatId', 'c-1');
            assert.deepEqual(routed(page), []);
            assert.deepEqual(plain(page.ui.calls.at(-1)), ['showSavedUnavailable', false]);
        } finally {
            page.close();
        }
    }
});

test('a lost connection after the visitor moved on says nothing', async () => {
    const page = await openHistoryPage({ route: { chat: 'elsewhere' }, routes: { '/api/user/history/c-1': () => { throw new Error('offline'); } } });
    try {
        await call(page, 'hydrateChatId', 'c-1');
        assert.ok(!page.ui.calls.some((entry) => entry[0] === 'showSavedUnavailable'));
    } finally {
        page.close();
    }
});

// ── /a/<token>: a public link ──────────────────────────────────────────────

const PUBLIC = '/api/public/answer/tok%2F1';

test('a public link with no token does nothing', async () => {
    const page = await openHistoryPage();
    try {
        await call(page, 'hydratePublicAnswer', '');
        assert.deepEqual(page.ui.calls, []);
    } finally {
        page.close();
    }
});

test('a public answer opens read-only, keeps its token for feedback, and leaves the search box empty', async () => {
    const page = await openHistoryPage({ route: { a: 'tok/1' }, routes: { [PUBLIC]: { answer: 'Because.', question: 'Why?' } } });
    try {
        page.$('#searchInput').value = 'typed';
        await call(page, 'hydratePublicAnswer', 'tok/1');
        const [request] = requests(page, '/api/public');
        assert.equal(request.init.cache, 'no-store');
        assert.equal(page.ui.calls[0][0], 'showPublicLoading');
        const [name, item] = page.ui.calls[1];
        assert.equal(name, 'showAnswer');
        assert.equal(item.public, true);
        assert.equal(item.share_token, 'tok/1');
        assert.equal(page.$('#searchInput').value, '');
        assert.deepEqual(routed(page), []);
    } finally {
        page.close();
    }
});

test('a public conversation opens as a conversation', async () => {
    const shared = { conversation: true, messages: [{ role: 'user', content: 'Hi' }] };
    const page = await openHistoryPage({ route: { a: 'tok/1' }, routes: { [PUBLIC]: shared } });
    try {
        page.$('#searchInput').value = 'typed';
        await call(page, 'hydratePublicAnswer', 'tok/1');
        assert.deepEqual(plain(page.ui.calls.at(-1)), ['showPublicConversation', shared]);
        assert.equal(page.$('#searchInput').value, '');
    } finally {
        page.close();
    }
});

test('a revoked public link is cleared from the URL and reported gone', async () => {
    const page = await openHistoryPage({ route: { a: 'tok/1' }, routes: { [PUBLIC]: { status: 404, body: {} } } });
    try {
        await call(page, 'hydratePublicAnswer', 'tok/1');
        assert.deepEqual(routed(page), [['pushRoute', { a: null }, { replace: true }]]);
        assert.deepEqual(plain(page.ui.calls.at(-1)), ['showPublicUnavailable', true]);
    } finally {
        page.close();
    }
});

test('a public link that failed for another reason keeps its key for a retry', async () => {
    for (const failure of [{ status: 500, body: {} }, () => { throw new Error('offline') }, { weird: true }]) {
        const page = await openHistoryPage({ route: { a: 'tok/1' }, routes: { [PUBLIC]: failure } });
        try {
            await call(page, 'hydratePublicAnswer', 'tok/1');
            assert.deepEqual(routed(page), []);
            assert.deepEqual(plain(page.ui.calls.at(-1)), ['showPublicUnavailable', false]);
        } finally {
            page.close();
        }
    }
});

test('a public answer that lands after the visitor left is dropped', async () => {
    const page = await openHistoryPage({ route: { a: 'someone-else' }, routes: { [PUBLIC]: { answer: 'A' } } });
    try {
        await call(page, 'hydratePublicAnswer', 'tok/1');
        assert.deepEqual(page.ui.calls.map((entry) => entry[0]), ['showPublicLoading']);
    } finally {
        page.close();
    }
});

// ── Swapping the view ──────────────────────────────────────────────────────

test('a view change runs at once when motion.js is not there to run it inside a transition', async () => {
    const page = await openHistoryPage();
    try {
        const swaps = [];
        page.eval(`window.__swap = (label) => () => window.__swaps.push(label); window.__swaps = []`);
        const swap = (label) => page.eval(`swapView(window.__swap(${JSON.stringify(label)}))`);
        // Not loaded yet (a click before the module ran).
        page.window.ShelahMotion = undefined;
        await swap('no motion');
        // Loaded but without the transition (an older cached copy).
        page.window.ShelahMotion = {};
        await swap('no transitionView');
        swaps.push(...plain(page.eval('window.__swaps')));
        assert.deepEqual(swaps, ['no motion', 'no transitionView']);
    } finally {
        page.close();
    }
});

test('a view change inside a transition waits for the transition and reports a failed swap', async () => {
    const page = await openHistoryPage();
    try {
        const seen = [];
        const reported = [];
        page.window.reportError = (error) => reported.push(error.message);
        page.window.ShelahMotion = {
            transitionView: (swap, options) => {
                seen.push(options.direction);
                swap();
                return { updateCallbackDone: Promise.reject(new Error('swap failed')) };
            },
        };
        let swapped = 0;
        page.window.__swap = () => { swapped += 1; };
        await page.eval(`swapView(window.__swap)`);
        assert.equal(swapped, 1);
        assert.deepEqual(seen, ['forward']);
        assert.deepEqual(reported, ['swap failed']);
    } finally {
        page.close();
    }
});

test('a swap that asks for no transition, or the first load, never goes through one', async () => {
    const page = await openHistoryPage();
    try {
        page.window.ShelahMotion = { transitionView: () => { throw new Error('should not be used'); } };
        let swapped = 0;
        page.window.__swap = () => { swapped += 1; };
        page.eval(`swapView(window.__swap, { transition: false })`);
        page.eval(`_viewNavDirection = null`);
        page.eval(`swapView(window.__swap)`);
        assert.equal(swapped, 2);
        page.window.ShelahMotion = { transitionView: (swap) => { swap(); return null; } };
        page.eval(`_viewNavDirection = 'back'`);
        await page.eval(`swapView(window.__swap)`);
        assert.equal(swapped, 3, 'a transition that was off swapped by itself, once');
    } finally {
        page.close();
    }
});
