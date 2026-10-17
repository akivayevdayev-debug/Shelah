/**
 * Two page-level behaviours that had no tests: the "Delete my account" button
 * of the Privacy & Data modal (what it sends, and that it only signs the
 * reader out once the server confirms everything is gone) and the router's
 * view dispatcher (which opener a URL reaches, and what a Back/Forward onto a
 * page that is already on screen leaves alone). Boots the real home page in
 * jsdom (tests_js/helpers/shell_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');

// ── Delete account ─────────────────────────────────────────────────────────

const DELETE_URL = '/api/user/delete-account';

async function openDeleteModal(deleteRoute, pageOptions = {}) {
    // The page is not already "/": jsdom ignores a navigation to the URL it is
    // on, and reports one to anywhere else, which is how the redirect shows.
    const page = await openShellPage({ url: 'https://shelah.org/?settings=open', fetch: { [DELETE_URL]: deleteRoute }, ...pageOptions });
    // The modal's side effects are stubbed; what they were asked is recorded.
    page.eval(`
        window.__log = [];
        closePrivacyDataModal = () => window.__log.push('close-modal');
        handleSignOut = async () => { window.__log.push('sign-out'); };
    `);
    return page;
}

function typeConfirmation(page, value) {
    const input = page.$('#privacyDeleteConfirmInput');
    input.value = value;
    return input;
}

const log = (page) => JSON.parse(page.eval('JSON.stringify(window.__log)'));
const statusText = (page) => page.$('#privacyDeleteStatus').textContent.trim();
const statusKind = (page) => page.$('#privacyDeleteStatus').dataset.kind;
const redirected = (page) => page.errors.some((error) => /navigation/i.test(error.message));

test('deleting only starts once the reader has typed DELETE', async () => {
    const page = await openDeleteModal({ ok: true });
    try {
        typeConfirmation(page, 'delete');
        await page.eval('handlePrivacyDeleteAccount()');
        assert.equal(page.calls.some((call) => call.url === DELETE_URL), false);
        assert.equal(page.$('#privacyDeleteStatus').classList.contains('hidden'), true);
        assert.deepEqual(log(page), []);
    } finally {
        page.close();
    }
});

test('a confirmed deletion closes the modal, signs the reader out and goes home', async () => {
    const page = await openDeleteModal({ ok: true });
    try {
        typeConfirmation(page, ' DELETE ');
        await page.eval('handlePrivacyDeleteAccount()');
        const [call] = page.takeCalls().filter((entry) => entry.url === DELETE_URL);
        assert.equal(call.init.method, 'POST');
        assert.deepEqual(JSON.parse(call.init.body), { confirmation: 'DELETE' });
        assert.equal(call.init.headers['Content-Type'], 'application/json');
        assert.deepEqual(log(page), ['close-modal', 'sign-out']);
        assert.equal(redirected(page), true, 'navigates away to "/"');
        assert.equal(page.eval('privacyDeleteInFlight'), false);
    } finally {
        page.close();
    }
});

test('a sign-out that throws after a confirmed deletion is not reported as a failed deletion', async () => {
    const page = await openDeleteModal({ ok: true });
    try {
        page.eval(`handleSignOut = async () => { throw new Error('Clerk session already gone'); }`);
        typeConfirmation(page, 'DELETE');
        await page.eval('handlePrivacyDeleteAccount()');
        assert.deepEqual(log(page), ['close-modal']);
        assert.equal(page.$('#privacyDeleteStatus').dataset.kind, 'pending', 'no error message in a closed modal');
        assert.equal(redirected(page), true);
        assert.equal(page.console.error.some((args) => /Post-deletion sign-out failed/.test(String(args[0]))), true);
    } finally {
        page.close();
    }
});

test('while the request is out the button and field are locked and the status says so', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const page = await openDeleteModal(async () => { await gate; return { ok: true }; });
    try {
        const input = typeConfirmation(page, 'DELETE');
        const first = page.eval('handlePrivacyDeleteAccount()');
        await page.settle();
        assert.equal(page.$('#privacyDeleteAccountBtn').disabled, true);
        assert.equal(input.disabled, true);
        assert.equal(statusKind(page), 'pending');
        assert.equal(statusText(page), 'Deleting your account...');
        assert.equal(page.eval('privacyDeleteInFlight'), true);

        // A second press while the first is out is ignored, not a second request.
        await page.eval('handlePrivacyDeleteAccount()');
        assert.equal(page.calls.filter((call) => call.url === DELETE_URL).length, 1);

        release();
        await first;
    } finally {
        page.close();
    }
});

test('anything short of a full success keeps the reader signed in and says what is left', async () => {
    const cases = [
        {
            name: 'a 200 that reports ok:false with failed tables',
            reply: { ok: false, table_errors: { bookmarks: 'x', notes: 'y' } },
            message: /Delete incomplete \(200\) \(failed categories: bookmarks, notes\)/,
        },
        {
            name: 'a 207 where the sign-in identity survived',
            reply: { status: 207, body: { ok: false, clerk_error: 'boom' } },
            message: /Delete incomplete \(207\) \(sign-in deletion failed\)/,
        },
        {
            name: 'a server error message wins over the generic text',
            reply: { status: 500, body: { ok: false, error: 'Database unavailable' } },
            message: /did not fully complete: Database unavailable\./,
        },
        {
            name: 'a reply that is not JSON',
            reply: { status: 502, body: 'Bad gateway' },
            message: /Delete incomplete \(502\)\./,
        },
    ];
    for (const { name, reply, message } of cases) {
        const page = await openDeleteModal(reply);
        try {
            const input = typeConfirmation(page, 'DELETE');
            await page.eval('handlePrivacyDeleteAccount()');
            assert.equal(statusKind(page), 'error', name);
            assert.match(statusText(page), message, name);
            assert.match(statusText(page), /Some data may still remain/, name);
            assert.deepEqual(log(page), [], `${name}: neither closes the modal nor signs out`);
            assert.equal(redirected(page), false, name);
            assert.equal(page.eval('privacyDeleteInFlight'), false, name);
            assert.equal(input.disabled, false, name);
            assert.equal(page.$('#privacyDeleteAccountBtn').disabled, false, 'still armed: DELETE is typed');
        } finally {
            page.close();
        }
    }
});

test('a failed request that leaves the field changed disarms the button, and Hebrew mode answers in Hebrew', async () => {
    const page = await openDeleteModal({ status: 500, body: { ok: false, table_errors: { notes: 'y' } } });
    try {
        page.eval(`displayedLanguage = 'he'`);
        const input = typeConfirmation(page, 'DELETE');
        const done = page.eval('handlePrivacyDeleteAccount()');
        input.value = 'DELET';
        await done;
        assert.equal(page.$('#privacyDeleteAccountBtn').disabled, true);
        assert.match(statusText(page), /המחיקה לא הושלמה במלואה/);
        assert.match(statusText(page), /קטגוריות שנכשלו: notes/);
    } finally {
        page.close();
    }
});

test('a network failure is reported the same way', async () => {
    const page = await openDeleteModal(() => { throw new Error('offline'); });
    try {
        typeConfirmation(page, 'DELETE');
        await page.eval('handlePrivacyDeleteAccount()');
        assert.equal(statusKind(page), 'error');
        assert.match(statusText(page), /did not fully complete: offline/);
        assert.deepEqual(log(page), []);
    } finally {
        page.close();
    }
});

// ── Router dispatch ────────────────────────────────────────────────────────

const OPENERS = ['readText', 'displayPrayer', 'displaySiddur', 'displayCommunity', 'hydrateChatId',
    'hydratePublicAnswer', 'displayAskHistoryPage', 'hydrateCalendarDate', 'syncAuthRoute',
    'restoreShownView', 'restoreViewScroll', 'syncPrefsInputsFromState', 'applyReaderPreferences'];

/**
 * Replaces every function hydrateRouteViews can reach with a recorder so a
 * test reads off exactly which ones a route touched, and with what.
 */
async function openRouter(extra = '') {
    const page = await openShellPage();
    page.eval(`
        window.__log = [];
        const record = (name, value) => (...args) => { window.__log.push([name, ...args]); return value; };
        ${OPENERS.map((name) => `${name} = record('${name}');`).join('\n        ')}
        goHome = (...args) => { window.__log.push(['goHome', ...args]); return Promise.resolve(); };
        applyRouteDisplayPrefs = () => false;
        routeViewOnScreen = () => false;
        window.closeCalendarModal = record('closeCalendarModal');
        window.ShelahConversationUI = { hydrate: record('conversationHydrate') };
        window.ShelahSiddur = { scrollTo: record('siddurScrollTo') };
        ${extra}
    `);
    return page;
}

async function hydrate(page, route, options = {}) {
    page.eval('window.__log.length = 0');
    page.window.__route = route;
    page.window.__options = { isInitial: false, restoreScroll: null, ...options };
    page.eval('hydrateRouteViews(window.__route, window.__options)');
    await page.settle();
    return JSON.parse(page.eval('JSON.stringify(window.__log)'));
}

const names = (entries) => entries.map(([name]) => name);

test('each URL kind reaches its own opener, with the section it names', async () => {
    const page = await openRouter();
    try {
        const scroll = { top: 120 };
        assert.deepEqual(await hydrate(page, { text: 'Genesis.1' }, { restoreScroll: scroll }), [
            ['readText', 'Genesis.1', { fromRoute: true, skipNavigationGrid: true, restoreScroll: scroll }],
            ['closeCalendarModal'],
            ['conversationHydrate', { text: 'Genesis.1' }, { isInitial: false }],
            ['syncAuthRoute', { text: 'Genesis.1' }],
        ]);
        assert.deepEqual((await hydrate(page, { prayer: 'Shema' }, { restoreScroll: scroll }))[0],
            ['displayPrayer', 'Shema', { fromRoute: true, restoreScroll: scroll }]);
        assert.deepEqual((await hydrate(page, { siddur: 'shacharit' }, { restoreScroll: scroll }))[0],
            ['displaySiddur', 'shacharit', { fromRoute: true, restoreScroll: scroll }]);
        assert.deepEqual((await hydrate(page, { community: 'Yemenite' }, { restoreScroll: scroll }))[0],
            ['displayCommunity', 'Yemenite', { fromRoute: true, restoreScroll: scroll }]);
        assert.deepEqual((await hydrate(page, { chat: 'c-1' }))[0], ['hydrateChatId', 'c-1']);
        assert.deepEqual((await hydrate(page, { a: 'tok' }))[0], ['hydratePublicAnswer', 'tok']);
        assert.deepEqual((await hydrate(page, { history: true, q: 'shabbat' }))[0],
            ['displayAskHistoryPage', { fromRoute: true, query: 'shabbat' }]);
        assert.deepEqual((await hydrate(page, { history: true }))[0],
            ['displayAskHistoryPage', { fromRoute: true, query: '' }]);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('when a URL names several views the first in the list wins', async () => {
    const page = await openRouter();
    try {
        const order = [
            [{ text: 'a', prayer: 'b', siddur: 'c', community: 'd', chat: 'e', a: 'f', history: true }, 'readText'],
            [{ prayer: 'b', siddur: 'c', community: 'd', chat: 'e', a: 'f', history: true }, 'displayPrayer'],
            [{ siddur: 'c', community: 'd', chat: 'e', a: 'f', history: true }, 'displaySiddur'],
            [{ community: 'd', chat: 'e', a: 'f', history: true }, 'displayCommunity'],
            [{ chat: 'e', a: 'f', history: true }, 'hydrateChatId'],
            [{ a: 'f', history: true }, 'hydratePublicAnswer'],
            [{ history: true }, 'displayAskHistoryPage'],
        ];
        for (const [route, expected] of order) {
            const calls = names(await hydrate(page, route)).filter((name) => OPENERS.includes(name) && name !== 'syncAuthRoute');
            assert.deepEqual(calls, [expected], JSON.stringify(route));
        }
    } finally {
        page.close();
    }
});

test('a URL naming no view goes home on Back/Forward, and puts the home scroll back after', async () => {
    const page = await openRouter();
    try {
        const scroll = { top: 40 };
        const calls = await hydrate(page, {}, { restoreScroll: scroll });
        assert.deepEqual(calls[0], ['goHome', { fromRoute: true }]);
        assert.deepEqual(calls.find(([name]) => name === 'restoreViewScroll'), ['restoreViewScroll', scroll, 'home']);
    } finally {
        page.close();
    }
});

test('the first load of a bare URL leaves the page as the server drew it', async () => {
    const page = await openRouter();
    try {
        const calls = names(await hydrate(page, {}, { isInitial: true }));
        assert.deepEqual(calls, ['conversationHydrate', 'syncAuthRoute']);
    } finally {
        page.close();
    }
});

test('a calendar day opens its day; a URL without one closes the calendar except on first load', async () => {
    const page = await openRouter();
    try {
        const open = await hydrate(page, { date: '2026-10-17' });
        assert.deepEqual(open.find(([name]) => name === 'hydrateCalendarDate'), ['hydrateCalendarDate', '2026-10-17']);
        assert.equal(names(open).includes('closeCalendarModal'), false);

        const closed = names(await hydrate(page, { text: 'Genesis.1' }));
        assert.equal(closed.includes('closeCalendarModal'), true);

        const first = names(await hydrate(page, { text: 'Genesis.1' }, { isInitial: true }));
        assert.equal(first.includes('closeCalendarModal'), false);
    } finally {
        page.close();
    }
});

test('display keys in the URL are applied before the view opens, and refresh the reader settings', async () => {
    const page = await openRouter(`applyRouteDisplayPrefs = (route) => { window.__log.push(['applyRouteDisplayPrefs', route.layout]); return Boolean(route.layout); };`);
    try {
        const calls = names(await hydrate(page, { text: 'Genesis.1', layout: 'stacked' }));
        assert.deepEqual(calls.slice(0, 4), ['applyRouteDisplayPrefs', 'syncPrefsInputsFromState', 'applyReaderPreferences', 'readText']);

        const untouched = names(await hydrate(page, { text: 'Genesis.1' }));
        assert.deepEqual(untouched.slice(0, 2), ['applyRouteDisplayPrefs', 'readText']);
    } finally {
        page.close();
    }
});

test('Back onto a page that is still on screen restores it instead of reloading it', async () => {
    const page = await openRouter(`routeViewOnScreen = () => true;`);
    try {
        const scroll = { top: 300 };
        const calls = await hydrate(page, { text: 'Genesis.1' }, { restoreScroll: scroll, left: { text: 'Genesis.1' } });
        assert.deepEqual(names(calls).slice(0, 2), ['restoreShownView', 'restoreViewScroll']);
        assert.deepEqual(calls[1], ['restoreViewScroll', scroll, 'text']);
        assert.equal(names(calls).includes('readText'), false);
    } finally {
        page.close();
    }
});

test('closing an overlay over a text leaves the text where it is', async () => {
    const page = await openRouter(`routeViewOnScreen = () => true;`);
    try {
        for (const overlay of ['chat', 'a', 'conversation', 'date', 'auth']) {
            const calls = names(await hydrate(page, { text: 'Genesis.1' }, {
                restoreScroll: { top: 1 },
                left: { text: 'Genesis.1', [overlay]: 'open' },
            }));
            assert.equal(calls.includes('restoreShownView'), true, overlay);
            assert.equal(calls.includes('restoreViewScroll'), false, `${overlay}: the page under it is left as it is`);
        }
    } finally {
        page.close();
    }
});

test('onto a text the reader did not leave from, nothing scrolls', async () => {
    const page = await openRouter(`routeViewOnScreen = () => true;`);
    try {
        const calls = names(await hydrate(page, { text: 'Genesis.1' }, { restoreScroll: { top: 1 }, left: { prayer: 'Shema' } }));
        assert.equal(calls.includes('restoreViewScroll'), false);
        assert.equal(calls.includes('readText'), false);
    } finally {
        page.close();
    }
});

test('a siddur on screen is scrolled to the section the URL names', async () => {
    const page = await openRouter(`routeViewOnScreen = () => true;`);
    try {
        const calls = await hydrate(page, { siddur: 'shacharit/amidah' });
        assert.deepEqual(calls.find(([name]) => name === 'siddurScrollTo'), ['siddurScrollTo', 'shacharit/amidah']);

        const overlay = await hydrate(page, { siddur: 'shacharit/amidah' }, { left: { chat: 'c-1' } });
        assert.equal(names(overlay).includes('siddurScrollTo'), false);
    } finally {
        page.close();
    }
});

test('the first load never counts a page as already on screen', async () => {
    const page = await openRouter(`routeViewOnScreen = () => true;`);
    try {
        const calls = names(await hydrate(page, { text: 'Genesis.1' }, { isInitial: true }));
        assert.deepEqual(calls.filter((name) => name === 'readText' || name === 'restoreShownView'), ['readText']);
    } finally {
        page.close();
    }
});
