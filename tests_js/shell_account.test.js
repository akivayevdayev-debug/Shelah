/**
 * The account side of the page: starting Clerk, who the header says is signed
 * in, the bearer token on a request, the sign-in / sign-up / profile windows
 * and the URL that goes with them, the preferences that follow a signed-in
 * reader around, and the Privacy & Data download. Boots the real home page in
 * jsdom (tests_js/helpers/shell_page.js); Clerk, the router and the library
 * loader are stand-ins that record what shell.js asked of them.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');
const { fakeClerk, withClerk, SIGNED_IN_USER, fakeRouter } = require('./helpers/shell_fakes');

const plain = (value) => JSON.parse(JSON.stringify(value));
const call = (page, name, ...args) => page.call(name, ...args);
const names = (clerk) => clerk.calls.map(([name]) => name);
const redirected = (page) => page.errors.some((error) => /navigation/i.test(error.message));
const requests = (page, prefix) => page.takeCalls().filter((request) => request.url.startsWith(prefix));

/**
 * The home page with Clerk configured. `clerk` is installed as window.Clerk
 * (leave it out for "the SDK has not loaded"); `libs` is what
 * ShelahLibs.load('clerk') does; the router goes in before boot only when the
 * test says so, because the boot reads it to decide whether Clerk is needed.
 */
async function openAccountPage({ clerk = null, configured = true, libs = null, router = null, earlyRouter = false, html = null, ...pageOptions } = {}) {
    const loads = [];
    const reliability = [];
    const page = await openShellPage({
        ...pageOptions,
        fetch: {
            '/api/user/preferences': { prefs: {} },
            '/api/user/history': { items: [] },
            ...pageOptions.fetch,
        },
        before: (window) => {
            window.console.info = (...args) => reliability.push(args.join(' '));
            if (configured) withClerk(window, clerk);
            if (libs) {
                window.ShelahLibs = { load: async (name) => { loads.push(name); return libs(window, name); } };
            }
            if (router && earlyRouter) window.ShelahRouter = router;
            if (html) html(window);
        },
    });
    if (router && !earlyRouter) page.window.ShelahRouter = router;
    Object.assign(page, { clerk, router, loads, reliability });
    await page.settle(10);
    page.takeCalls();
    return page;
}

const signedIn = () => fakeClerk({ user: SIGNED_IN_USER });

// ── Starting Clerk ─────────────────────────────────────────────────────────

test('without a Clerk key there is no account to start and the sign-in slot goes away', async () => {
    const page = await openAccountPage({ configured: false });
    try {
        assert.equal(await call(page, 'ensureClerk'), false);
        await call(page, 'refreshAuthUi');
        assert.equal(page.$('#authControls').classList.contains('hidden'), true);
        assert.equal(page.$('#authControls').hasAttribute('aria-busy'), false);
    } finally {
        page.close();
    }
});

test('Clerk is fetched once, loaded with the page\'s settings, and listened to', async () => {
    const clerk = signedIn();
    const page = await openAccountPage({ libs: (window) => { window.Clerk = clerk; return true; } });
    try {
        const first = call(page, 'ensureClerk');
        const second = call(page, 'ensureClerk');
        assert.equal(await first, true);
        assert.equal(await second, true);
        assert.deepEqual(page.loads, ['clerk']);
        assert.equal(clerk.calls.filter(([name]) => name === 'load').length, 1);
        const [, options] = clerk.calls.find(([name]) => name === 'load');
        assert.equal(options.publishableKey, 'pk_test_example');
        assert.equal(options.signInFallbackRedirectUrl, 'https://shelah.org/');
        assert.equal(options.signUpFallbackRedirectUrl, 'https://shelah.org/');
        assert.equal(typeof options.routerPush, 'function');
        assert.equal(clerk.listeners.length, 1);
        assert.equal(page.$('#userProfileMenuLabel').textContent, 'Dana');
    } finally {
        page.close();
    }
});

test('Clerk\'s own redirects stay in the page', async () => {
    const clerk = signedIn();
    const router = fakeRouter();
    const page = await openAccountPage({ clerk, router });
    try {
        await call(page, 'initClerkAuth');
        const [, options] = clerk.calls.find(([name]) => name === 'load');
        options.routerPush('/profile');
        options.routerReplace('/profile');
        assert.deepEqual(plain(router.calls.filter(([name]) => name === 'pushPath')), [
            ['pushPath', '/profile', { replace: false }],
            ['pushPath', '/profile', { replace: true }],
        ]);
    } finally {
        page.close();
    }
});

test('when the SDK never arrives the slot goes, the reason is logged, and the next click tries again', async () => {
    let attempts = 0;
    const page = await openAccountPage({ libs: () => { attempts += 1; return false; } });
    try {
        assert.equal(await call(page, 'ensureClerk'), false);
        assert.ok(page.console.warn.some((args) => /Clerk script did not load/.test(args.join(' '))));
        assert.equal(page.$('#authControls').classList.contains('hidden'), true);
        assert.equal(await call(page, 'ensureClerk'), false);
        assert.equal(attempts, 2);
    } finally {
        page.close();
    }
});

test('a saved link waiting on Clerk is tried on its own when Clerk will never come', async () => {
    const router = fakeRouter({ chat: 'c-1' });
    const page = await openAccountPage({ libs: () => false, router });
    try {
        page.eval(`hydrateChatId = (id, options) => { window.__hydrated = [id, options]; }`);
        await call(page, 'ensureClerk');
        assert.deepEqual(plain(page.eval('window.__hydrated')), ['c-1', { settled: true }]);
    } finally {
        page.close();
    }
});

test('a blank Clerk key is reported and treated as no Clerk', async () => {
    const page = await openAccountPage({ clerk: fakeClerk() });
    try {
        page.window.APP_CLERK = { publishableKey: '  ' };
        await call(page, 'initClerkAuth');
        assert.ok(page.console.warn.some((args) => /publishable key is missing/.test(args.join(' '))));
        assert.equal(page.$('#authControls').classList.contains('hidden'), true);
    } finally {
        page.close();
    }
});

test('Clerk failing to load is logged and leaves the page without an account button', async () => {
    const clerk = fakeClerk();
    clerk.load = async () => { throw new Error('network'); };
    const page = await openAccountPage({ clerk });
    try {
        await call(page, 'initClerkAuth');
        assert.ok(page.console.error.some((args) => /Failed to initialize Clerk/.test(args.join(' '))));
        assert.equal(page.$('#authControls').classList.contains('hidden'), true);
    } finally {
        page.close();
    }
});

test('a sign-in that finishes later updates the header and any URL asking for the account', async () => {
    const clerk = fakeClerk();
    const router = fakeRouter();
    const page = await openAccountPage({ clerk, router });
    try {
        await call(page, 'initClerkAuth');
        assert.equal(page.$('#signInBtn').classList.contains('hidden'), false);
        await clerk.signInAs(SIGNED_IN_USER);
        assert.equal(page.$('#signInBtn').classList.contains('hidden'), true);
        assert.equal(page.$('#userProfileMenuLabel').textContent, 'Dana');
    } finally {
        page.close();
    }
});

test('a visit that may be signed in starts Clerk at once; any other waits for someone to reach for it', async () => {
    const early = signedIn();
    const eager = await openAccountPage({ clerk: early, libs: () => true, html: (window) => window.document.documentElement.classList.add('auth-likely-in') });
    try {
        assert.ok(names(early).includes('load'), 'the cookie says there is a session');
    } finally {
        eager.close();
    }

    const lazyClerk = fakeClerk();
    const lazy = await openAccountPage({ clerk: lazyClerk, libs: () => true });
    try {
        assert.equal(names(lazyClerk).includes('load'), false);
        assert.equal(lazy.$('#signInBtn').classList.contains('hidden'), false, 'Sign in is there before Clerk is');
        lazy.$('#authControls').dispatchEvent(new lazy.window.Event('pointerenter'));
        await lazy.settle(10);
        assert.ok(names(lazyClerk).includes('load'));
    } finally {
        lazy.close();
    }

    const linked = signedIn();
    const named = await openAccountPage({ clerk: linked, libs: () => true, router: fakeRouter({ history: '1' }), earlyRouter: true });
    try {
        assert.ok(names(linked).includes('load'), 'a link that needs an identity');
    } finally {
        named.close();
    }
});

// ── The bearer token ───────────────────────────────────────────────────────

test('a request carries the token, and a missing first token is asked for again without the cache', async () => {
    const clerk = signedIn();
    const page = await openAccountPage({ clerk });
    try {
        const queue = [null, 'second'];
        clerk.session = { getToken: async (options) => { clerk.calls.push(['getToken', options || null]); return queue.shift(); } };
        clerk.calls.length = 0;
        const headers = plain(await call(page, 'authHeaders', { Accept: 'application/json' }));
        assert.deepEqual(headers, { Accept: 'application/json', Authorization: 'Bearer second' });
        assert.deepEqual(plain(clerk.calls), [['getToken', null], ['getToken', { skipCache: true }]]);
    } finally {
        page.close();
    }
});

test('no token at all, a failing Clerk, or no session sends the request as a guest', async () => {
    const clerk = signedIn();
    const page = await openAccountPage({ clerk });
    try {
        clerk.session = { getToken: async () => null };
        assert.deepEqual(plain(await call(page, 'authHeaders', { A: '1' })), { A: '1' });
        clerk.session = { getToken: async () => { throw new Error('expired'); } };
        assert.deepEqual(plain(await call(page, 'authHeaders')), {});
        clerk.session = null;
        assert.deepEqual(plain(await call(page, 'authHeaders', { B: '2' })), { B: '2' });
        page.window.APP_CLERK = undefined;
        assert.deepEqual(plain(await call(page, 'authHeaders')), {});
    } finally {
        page.close();
    }
});

test('a request made while Clerk is on its way waits for it, but not for ever', async () => {
    const clerk = fakeClerk({ user: SIGNED_IN_USER });
    const page = await openAccountPage({ clerk });
    try {
        clerk.loaded = false;
        page.eval(`clerkStart = new Promise(() => {})`);
        const waiting = call(page, 'authHeaders');
        let done = false;
        waiting.then(() => { done = true; });
        await page.settle(3);
        assert.equal(done, false, 'still waiting for Clerk');
        clerk.loaded = true;
        page.eval(`settleClerkLoaded(true)`);
        assert.deepEqual(plain(await waiting), { Authorization: 'Bearer tok-1' });

        // Clerk never loads: the wait ends on its own timer.
        clerk.loaded = false;
        const realSetTimeout = page.window.setTimeout;
        page.window.setTimeout = (fn, ms, ...args) => (ms === 4000 ? realSetTimeout(fn, 0) : realSetTimeout(fn, ms, ...args));
        page.eval(`clerkStart = new Promise(() => {})`);
        assert.deepEqual(plain(await call(page, 'authHeaders')), { Authorization: 'Bearer tok-1' });
    } finally {
        page.close();
    }
});

// ── Who the header says is signed in ───────────────────────────────────────

test('the header names the reader by first name, then user name, then email, then "Signed in"', async () => {
    const page = await openAccountPage({ clerk: signedIn() });
    try {
        const label = () => page.$('#userProfileMenuLabel').textContent;
        const as = async (user) => {
            page.clerk.user = user;
            page.eval('syncedPrefsUserId = null');
            await call(page, 'refreshAuthUi');
        };
        await as({ id: 'u1', username: 'dana_s', primaryEmailAddress: { emailAddress: 'd@example.org' } });
        assert.equal(label(), 'dana_s');
        await as({ id: 'u2', primaryEmailAddress: { emailAddress: 'd@example.org' } });
        assert.equal(label(), 'd@example.org');
        await as({ id: 'u3', emailAddresses: [{ emailAddress: 'second@example.org' }] });
        assert.equal(label(), 'second@example.org');
        await as({ id: 'u4' });
        assert.equal(label(), 'Signed in');
    } finally {
        page.close();
    }
});

test('signing in shows the account menu and tells the page; the reader\'s data is fetched once per account', async () => {
    const page = await openAccountPage({ clerk: signedIn() });
    try {
        const events = [];
        page.document.addEventListener('shelah:auth-changed', (event) => events.push(event.detail.signedIn));
        page.eval('syncedPrefsUserId = null');
        await call(page, 'refreshAuthUi');
        await call(page, 'refreshAuthUi');
        assert.deepEqual(events, [true, true]);
        assert.equal(page.$('#userProfileMenuContainer').classList.contains('hidden'), false);
        assert.equal(page.$('#authControls').style.display, 'flex');
        const fetched = page.takeCalls().map((request) => request.url);
        assert.equal(fetched.filter((url) => url === '/api/user/preferences').length, 1);
        assert.equal(fetched.filter((url) => url === '/api/user/history?limit=20').length, 1);
    } finally {
        page.close();
    }
});

test('a page loaded on a saved answer retries it once Clerk reports the reader', async () => {
    const router = fakeRouter({ chat: 'c-9' });
    const page = await openAccountPage({ clerk: signedIn(), router });
    try {
        page.eval(`hydrateChatId = (id) => { window.__hydrated = (window.__hydrated || []).concat(id); }`);
        page.eval('syncedPrefsUserId = null');
        await call(page, 'refreshAuthUi');
        assert.deepEqual(plain(page.eval('window.__hydrated')), ['c-9']);
    } finally {
        page.close();
    }
});

test('signing out restores Sign in, closes the menu, forgets the account and retries a saved link once', async () => {
    const router = fakeRouter({ chat: 'c-9' });
    const page = await openAccountPage({ clerk: signedIn(), router });
    try {
        page.eval(`hydrateChatId = (id) => { window.__hydrated = (window.__hydrated || []).concat(id); }`);
        page.eval(`lastAuthSignedIn = true`);
        page.clerk.user = null;
        page.clerk.session = null;
        const events = [];
        page.document.addEventListener('shelah:auth-changed', (event) => events.push(event.detail.signedIn));
        await call(page, 'refreshAuthUi');
        assert.equal(page.$('#signInBtn').classList.contains('hidden'), false);
        assert.equal(page.$('#userProfileMenuContainer').classList.contains('hidden'), true);
        assert.equal(page.eval('syncedPrefsUserId'), null);
        assert.deepEqual(events, [false]);
        assert.deepEqual(plain(page.eval('window.__hydrated')), ['c-9']);
        // Still nobody: Clerk's next event is not a change.
        await call(page, 'refreshAuthUi');
        assert.deepEqual(plain(page.eval('window.__hydrated')), ['c-9']);
    } finally {
        page.close();
    }
});

test('signing out through the menu asks Clerk and redraws the header', async () => {
    const page = await openAccountPage({ clerk: signedIn() });
    try {
        await call(page, 'handleSignOut');
        assert.ok(names(page.clerk).includes('signOut'));
        assert.equal(page.$('#signInBtn').classList.contains('hidden'), false);
        page.window.Clerk = undefined;
        await call(page, 'handleSignOut');
    } finally {
        page.close();
    }
});

// ── The sign-in, sign-up and profile windows ───────────────────────────────

const lastCall = (clerk, name) => clerk.calls.filter(([entry]) => entry === name).at(-1);
const pushes = (router) => plain(router.calls.filter(([name]) => name === 'pushRoute'));

test('Sign in puts /signin in the URL and opens Clerk\'s window over the page it came from', async () => {
    const clerk = fakeClerk();
    const router = fakeRouter({ text: 'Genesis.1' });
    const page = await openAccountPage({ clerk, router, libs: () => true });
    try {
        await call(page, 'handleSignIn');
        assert.deepEqual(pushes(router), [['pushRoute', { auth: 'signin' }, { overlay: 'auth' }]]);
        const [, options] = lastCall(clerk, 'openSignIn');
        assert.equal(options.fallbackRedirectUrl, 'https://shelah.org/?text=Genesis.1', 'back to the page under the window, never /signin');
        assert.equal(page.eval('authModal.kind'), 'signin');
        // The same window asked for again stays as it is.
        await call(page, 'showAuthModal', 'signin');
        assert.equal(clerk.calls.filter(([name]) => name === 'openSignIn').length, 1);
    } finally {
        page.close();
    }
});

test('with no router the sign-in window returns to the home page', async () => {
    const clerk = fakeClerk();
    const page = await openAccountPage({ clerk });
    try {
        await call(page, 'showAuthModal', 'signin');
        assert.equal(lastCall(clerk, 'openSignIn')[1].fallbackRedirectUrl, 'https://shelah.org/');
    } finally {
        page.close();
    }
});

test('Create account opens the sign-up window; without one the sign-in window offers it', async () => {
    const clerk = fakeClerk();
    const router = fakeRouter();
    const page = await openAccountPage({ clerk, router, libs: () => true });
    try {
        await call(page, 'handleSignUp');
        assert.deepEqual(pushes(router), [['pushRoute', { auth: 'signup' }, { overlay: 'auth' }]]);
        assert.equal(names(clerk).includes('openSignUp'), true);
    } finally {
        page.close();
    }

    const bare = fakeClerk();
    bare.openSignUp = undefined;
    const fallback = await openAccountPage({ clerk: bare, router: fakeRouter(), libs: () => true });
    try {
        await call(fallback, 'handleSignUp');
        assert.equal(names(bare).includes('openSignIn'), true);
    } finally {
        fallback.close();
    }
});

test('the account menu opens the profile or the settings window', async () => {
    const clerk = signedIn();
    const router = fakeRouter();
    const page = await openAccountPage({ clerk, router, libs: () => true });
    try {
        await call(page, 'openClerkUserProfile');
        assert.deepEqual(pushes(router), [['pushRoute', { auth: 'profile' }, { overlay: 'auth' }]]);
        assert.equal(names(clerk).includes('openUserProfile'), true);
        await call(page, 'openClerkUserProfile', 'settings');
        assert.deepEqual(pushes(router).at(-1), ['pushRoute', { auth: 'settings' }, { overlay: 'auth' }]);
        assert.equal(page.eval('authModal.kind'), 'profile');
    } finally {
        page.close();
    }
});

test('a profile link from a signed-out reader asks for sign-in first and keeps its own URL', async () => {
    const clerk = fakeClerk();
    const router = fakeRouter({ auth: 'profile' });
    const page = await openAccountPage({ clerk, router, url: 'https://shelah.org/profile' });
    try {
        await call(page, 'showAuthModal', 'profile');
        assert.equal(lastCall(clerk, 'openSignIn')[1].fallbackRedirectUrl, 'https://shelah.org/profile');
        assert.equal(page.eval('authModal.kind'), 'signin');
        // The reader signs in and the window closes: the profile they asked for opens.
        clerk.user = SIGNED_IN_USER;
        page.document.body.insertAdjacentHTML('beforeend', '<div class="cl-modalBackdrop"></div>');
        await page.settle();
        page.$('.cl-modalBackdrop').remove();
        await page.settle(10);
        assert.equal(names(clerk).includes('openUserProfile'), true);
    } finally {
        page.close();
    }
});

test('a sign-in or sign-up link for someone already signed in closes at once', async () => {
    const clerk = signedIn();
    const router = fakeRouter({ auth: 'signin' });
    const page = await openAccountPage({ clerk, router });
    try {
        await call(page, 'showAuthModal', 'signin');
        assert.deepEqual(plain(router.calls), [['closeOverlay', 'auth', { auth: null }]]);
        assert.equal(names(clerk).includes('openSignIn'), false);
        await call(page, 'showAuthModal', 'x');
        page.window.Clerk = undefined;
        await call(page, 'showAuthModal', 'signin');
    } finally {
        page.close();
    }
});

test('closing the window takes /signin off the URL, stepping Back once', async () => {
    const clerk = fakeClerk();
    const router = fakeRouter({ auth: 'signin' });
    router.closeHow = 'back';
    const page = await openAccountPage({ clerk, router });
    try {
        await call(page, 'showAuthModal', 'signin');
        page.document.body.insertAdjacentHTML('beforeend', '<div class="cl-modalBackdrop"></div>');
        await page.settle();
        assert.equal(page.eval('authModal.page'), 'signin', 'watching a window that is open');
        page.$('.cl-modalBackdrop').remove();
        await page.settle();
        assert.deepEqual(plain(router.calls), [['closeOverlay', 'auth', { auth: null }]]);
        assert.equal(page.eval('authModal'), null);
        assert.equal(page.eval('authLeaving'), true);
        // A second caller cannot step Back again until the first Back has landed.
        await call(page, 'leaveAuthRoute');
        assert.equal(router.calls.length, 1);
        page.window.dispatchEvent(new page.window.PopStateEvent('popstate'));
        assert.equal(page.eval('authLeaving'), false);
    } finally {
        page.close();
    }
});

test('a window that never renders is given up on after ten seconds and the URL is left alone', async () => {
    const clerk = fakeClerk();
    const router = fakeRouter({ auth: 'signin' });
    const page = await openAccountPage({ clerk, router });
    try {
        const timers = [];
        page.window.setTimeout = (fn, ms) => { timers.push([fn, ms]); return timers.length; };
        await call(page, 'showAuthModal', 'signin');
        const [fn, ms] = timers.find(([, delay]) => delay === 10000);
        assert.equal(ms, 10000);
        fn();
        assert.equal(page.eval('authModal'), null);
        assert.deepEqual(plain(router.calls), []);
    } finally {
        page.close();
    }
});

test('a window that fails to open is reported and the URL is taken back', async () => {
    const clerk = fakeClerk();
    clerk.openSignIn = async () => { throw new Error('component'); };
    const router = fakeRouter({ auth: 'signin' });
    const page = await openAccountPage({ clerk, router });
    try {
        await call(page, 'showAuthModal', 'signin');
        assert.ok(page.console.warn.some((args) => /Unable to open the Clerk signin modal/.test(args.join(' '))));
        assert.deepEqual(plain(router.calls), [['closeOverlay', 'auth', { auth: null }]]);
    } finally {
        page.close();
    }
});

test('closing by hand asks Clerk to close whichever window is open', async () => {
    const clerk = signedIn();
    const page = await openAccountPage({ clerk, router: fakeRouter() });
    try {
        page.eval(`closeAuthModal()`);
        for (const [kind, closer] of [['signin', 'closeSignIn'], ['signup', 'closeSignUp'], ['profile', 'closeUserProfile']]) {
            clerk[closer] = clerk[closer] || (() => clerk.calls.push([closer]));
            page.eval(`authModal = { kind: '${kind}', observer: { disconnect() {} }, timer: 0 }; closeAuthModal()`);
            assert.equal(names(clerk).includes(closer), true, kind);
        }
        clerk.closeSignIn = () => { throw new Error('already closed'); };
        page.eval(`authModal = { kind: 'signin', observer: { disconnect() {} }, timer: 0 }; closeAuthModal()`);
    } finally {
        page.close();
    }
});

test('the URL naming no window closes the one on screen and forgets a return trip', async () => {
    const clerk = fakeClerk();
    const page = await openAccountPage({ clerk, router: fakeRouter({ auth: 'signin' }), libs: () => true });
    try {
        page.window.Clerk.loaded = true;
        page.eval(`syncAuthRoute({ auth: 'signin' })`);
        await page.settle(10);
        assert.equal(names(clerk).includes('openSignIn'), true);
        page.eval(`authReturnPath = '/privacy'`);
        page.eval(`syncAuthRoute({})`);
        assert.equal(page.eval('authReturnPath'), null);
        assert.equal(page.eval('authModal'), null);
        assert.equal(names(clerk).includes('closeSignIn'), true);
        // Clerk not up yet: the route starts it, and its init opens the window.
        const waiting = await openAccountPage({ clerk: fakeClerk(), libs: (window) => true });
        try {
            waiting.window.Clerk = undefined;
            waiting.eval(`syncAuthRoute({ auth: 'signin' })`);
            await waiting.settle(10);
            assert.deepEqual(waiting.loads, ['clerk']);
        } finally {
            waiting.close();
        }
    } finally {
        page.close();
    }
});

test('an account URL with no Clerk to show it is taken back out', async () => {
    const router = fakeRouter({ auth: 'signin' });
    const page = await openAccountPage({ configured: false, router });
    try {
        await call(page, 'handleAuthRouteIntent');
        assert.deepEqual(plain(router.calls), [['closeOverlay', 'auth', { auth: null }]]);
        router.route = {};
        router.calls.length = 0;
        await call(page, 'handleAuthRouteIntent');
        assert.deepEqual(plain(router.calls), [], 'no window asked for');
    } finally {
        page.close();
    }
});

test('an account URL with Clerk up opens the window it names', async () => {
    const clerk = fakeClerk();
    const page = await openAccountPage({ clerk, router: fakeRouter({ auth: 'signup' }) });
    try {
        await call(page, 'handleAuthRouteIntent');
        assert.equal(names(clerk).includes('openSignUp'), true);
    } finally {
        page.close();
    }
});

// ── Coming back to where the reader was ────────────────────────────────────

const RETURN_KEY = 'shelah:authReturn';

test('a legal page\'s Sign in returns to that page when the window closes, and the note is used once', async () => {
    const router = fakeRouter({ auth: 'signin' });
    const page = await openAccountPage({
        clerk: fakeClerk(),
        router,
        url: 'https://shelah.org/signin',
        session: { [RETURN_KEY]: JSON.stringify({ path: '/privacy', at: Date.now() }) },
    });
    try {
        assert.equal(page.eval('authReturnPath'), '/privacy');
        assert.equal(call(page, 'authRedirectUrl'), 'https://shelah.org/privacy');
        await call(page, 'leaveAuthRoute');
        assert.equal(redirected(page), true, 'sent to /privacy');
        assert.equal(page.window.sessionStorage.getItem(RETURN_KEY), null);
        assert.equal(page.eval('authReturnPath'), null);
        assert.equal(page.eval('authLeaving'), true);
        assert.deepEqual(plain(router.calls), []);
    } finally {
        page.close();
    }
});

test('a saved return that is stale, odd, unreadable, or for another page is not followed', async () => {
    const cases = [
        [JSON.stringify({ path: '/privacy', at: Date.now() - 11 * 60 * 1000 }), 'https://shelah.org/signin'],
        [JSON.stringify({ path: 'https://evil.example/', at: Date.now() }), 'https://shelah.org/signin'],
        ['{not json', 'https://shelah.org/signin'],
        [JSON.stringify({ path: '/privacy', at: Date.now() }), 'https://shelah.org/'],
    ];
    for (const [saved, url] of cases) {
        const page = await openAccountPage({ clerk: fakeClerk(), url, session: { [RETURN_KEY]: saved } });
        try {
            assert.equal(page.eval('authReturnPath'), null, saved);
        } finally {
            page.close();
        }
    }
});

test('Clerk\'s redirect to the page already under the window just closes the window', async () => {
    const router = fakeRouter({ auth: 'signin', text: 'Genesis.1' });
    const page = await openAccountPage({ clerk: fakeClerk(), router });
    try {
        call(page, 'clerkNavigate', '/?text=Genesis.1');
        assert.deepEqual(plain(router.calls), [['closeOverlay', 'auth', { auth: null }]]);
    } finally {
        page.close();
    }
});

test('Clerk\'s redirect elsewhere goes through the router, or a page load when the router declines', async () => {
    const router = fakeRouter();
    const page = await openAccountPage({ clerk: fakeClerk(), router });
    try {
        call(page, 'clerkNavigate', '/profile?x=1#top');
        assert.deepEqual(plain(router.calls), [['pushPath', '/profile?x=1#top', { replace: false }]]);
        assert.equal(redirected(page), false);
        router.pathTaken = false;
        call(page, 'clerkNavigate', '/somewhere');
        call(page, 'clerkNavigate', '/somewhere', { replace: true });
        call(page, 'clerkNavigate', 'https://accounts.example.org/oauth');
        call(page, 'clerkNavigate', 'https://accounts.example.org/oauth', { replace: true });
        assert.equal(page.errors.filter((error) => /navigation/i.test(error.message)).length >= 1, true);
        assert.equal(router.calls.filter(([name]) => name === 'pushPath').length, 3, 'another site is never the router\'s');
    } finally {
        page.close();
    }
});

test('a click that means "new tab" is recognised by its button or modifier', async () => {
    const page = await openAccountPage({ clerk: fakeClerk() });
    try {
        const clicked = (init) => call(page, 'isModifiedClick', { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init });
        assert.equal(clicked({}), false);
        for (const init of [{ button: 1 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
            assert.equal(clicked(init), true, JSON.stringify(init));
        }
    } finally {
        page.close();
    }
});

// ── Preferences that follow the reader ─────────────────────────────────────

const SERVER_STATE = {
    prefs: { fontSize: 22, lineHeight: 1.9, metadataFilters: { chapter: true } },
    reading_state: { ref: 'Genesis 3' },
    shelf: { recent: [{ type: 'text', value: 'Exodus 1', label: 'Exodus 1' }], bookmarks: [] },
    notes: { 'Genesis 1': 'A note' },
};

test('signed in, the reader\'s saved settings, place, shelf and notes replace the local ones', async () => {
    const page = await openAccountPage({ clerk: signedIn(), fetch: { '/api/user/preferences': SERVER_STATE } });
    try {
        await call(page, 'loadPrefsFromServerIfSignedIn');
        const [request] = requests(page, '/api/user/preferences');
        assert.equal(request.init.headers.Authorization, 'Bearer tok-1');
        assert.equal(page.eval('appState.prefs.fontSize'), 22);
        assert.deepEqual(plain(page.eval('appState.readingState')), { ref: 'Genesis 3' });
        const shelf = JSON.parse(page.window.localStorage.getItem(page.eval('APP_SHELF_KEY')));
        assert.deepEqual(shelf.recent.map((entry) => entry.value), ['Exodus 1']);
        assert.deepEqual(shelf.notes, { 'Genesis 1': 'A note' });
        assert.equal(JSON.parse(page.window.localStorage.getItem(page.eval('APP_PREFS_KEY'))).fontSize, 22);
        assert.ok(page.reliability.some((line) => /prefs-synced-from-server/.test(line)));
    } finally {
        page.close();
    }
});

test('a reply without settings, a refusal, or no connection leaves the local ones as they were', async () => {
    for (const route of [{ prefs: null }, { prefs: 'text' }, { status: 500, body: {} }, () => { throw new Error('offline'); }]) {
        const page = await openAccountPage({ clerk: signedIn(), fetch: { '/api/user/preferences': route } });
        try {
            const before = page.eval('appState.prefs.fontSize');
            await call(page, 'loadPrefsFromServerIfSignedIn');
            assert.equal(page.eval('appState.prefs.fontSize'), before);
            assert.equal(page.window.localStorage.getItem(page.eval('APP_SHELF_KEY')), null);
        } finally {
            page.close();
        }
    }
});

test('a server reply with only settings keeps this device\'s shelf and still takes the server\'s notes', async () => {
    const page = await openAccountPage({ clerk: signedIn(), fetch: { '/api/user/preferences': { prefs: { fontSize: 20 }, notes: { 'Exodus 2': 'Local?' } } } });
    try {
        page.window.localStorage.setItem(page.eval('APP_SHELF_KEY'), JSON.stringify({ recent: [{ type: 'text', value: 'Leviticus 1' }], bookmarks: [], notes: { 'Genesis 1': 'Mine' } }));
        await call(page, 'loadPrefsFromServerIfSignedIn');
        const shelf = JSON.parse(page.window.localStorage.getItem(page.eval('APP_SHELF_KEY')));
        assert.deepEqual(shelf.recent.map((entry) => entry.value), ['Leviticus 1']);
        assert.deepEqual(shelf.notes, { 'Genesis 1': 'Mine', 'Exodus 2': 'Local?' });
    } finally {
        page.close();
    }
});

test('signed out, nothing is fetched or sent', async () => {
    const page = await openAccountPage({ clerk: fakeClerk() });
    try {
        await call(page, 'loadPrefsFromServerIfSignedIn');
        await call(page, 'pushPrefsToServer');
        assert.deepEqual(requests(page, '/api/user'), []);
    } finally {
        page.close();
    }
});

test('saving sends the settings, shelf, notes and place with the token', async () => {
    const page = await openAccountPage({ clerk: signedIn(), fetch: { '/api/user/preferences': { ok: true } } });
    try {
        page.window.localStorage.setItem(page.eval('APP_SHELF_KEY'), JSON.stringify({ recent: [], bookmarks: [{ type: 'text', value: 'Genesis 1' }], notes: { 'Genesis 1': 'N' } }));
        page.eval(`appState.readingState = { ref: 'Genesis 2' }`);
        await call(page, 'pushPrefsToServer');
        const [request] = requests(page, '/api/user/preferences');
        assert.equal(request.init.method, 'PUT');
        assert.equal(request.init.headers.Authorization, 'Bearer tok-1');
        assert.equal(request.init.headers['Content-Type'], 'application/json');
        const body = JSON.parse(request.init.body);
        assert.deepEqual(Object.keys(body).sort(), ['notes', 'prefs', 'reading_state', 'shelf']);
        assert.deepEqual(body.notes, { 'Genesis 1': 'N' });
        assert.deepEqual(body.reading_state, { ref: 'Genesis 2' });
        assert.equal(body.shelf.bookmarks[0].value, 'Genesis 1');
    } finally {
        page.close();
    }
});

test('a save that cannot reach the server is dropped without a word', async () => {
    const page = await openAccountPage({ clerk: signedIn(), fetch: { '/api/user/preferences': () => { throw new Error('offline'); } } });
    try {
        await call(page, 'pushPrefsToServer');
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

// ── Privacy & Data ─────────────────────────────────────────────────────────

const statusOf = (page, id) => ({ kind: page.$(id).dataset.kind, text: page.$(id).textContent.trim() });

test('the Privacy & Data window opens clean, takes focus, and puts focus back when it closes', async () => {
    const page = await openAccountPage({ clerk: signedIn() });
    try {
        const trigger = page.$('#userProfilePrivacyDataAction');
        trigger.focus();
        page.$('#privacyDeleteConfirmInput').value = 'DELETE';
        page.eval(`openPrivacyDataModal()`);
        const modal = page.$('#privacyDataModal');
        assert.equal(modal.style.display, 'flex');
        assert.equal(page.$('#privacyDeleteConfirmInput').value, '');
        assert.equal(page.$('#privacyDeleteAccountBtn').disabled, true);
        assert.equal(page.document.activeElement, page.$('#privacyDataModalCloseBtn'));
        page.eval(`closePrivacyDataModal()`);
        assert.equal(modal.style.display, 'none');
        assert.equal(page.document.activeElement, trigger);
        assert.equal(page.eval('privacyDataModalTrigger'), null);
    } finally {
        page.close();
    }
});

test('a delete in flight keeps the window open; the Delete button wakes only for the word DELETE', async () => {
    const page = await openAccountPage({ clerk: signedIn() });
    try {
        page.eval(`openPrivacyDataModal()`);
        page.eval(`privacyDeleteInFlight = true`);
        page.eval(`closePrivacyDataModal()`);
        assert.equal(page.$('#privacyDataModal').style.display, 'flex');
        page.eval(`privacyDeleteInFlight = false`);
        const input = page.$('#privacyDeleteConfirmInput');
        input.value = ' DELETE ';
        page.eval(`handlePrivacyDeleteConfirmInput()`);
        assert.equal(page.$('#privacyDeleteAccountBtn').disabled, false);
        input.value = 'delete';
        page.eval(`handlePrivacyDeleteConfirmInput()`);
        assert.equal(page.$('#privacyDeleteAccountBtn').disabled, true);
    } finally {
        page.close();
    }
});

test('a status line shows the right icon for its kind, and an unknown kind reads as pending', async () => {
    const page = await openAccountPage({ clerk: signedIn() });
    try {
        const line = page.$('#privacyDataExportStatus');
        for (const [kind, icon] of [['success', true], ['error', true], ['warning', true], ['pending', false], ['odd', true]]) {
            page.eval(`_setPrivacyStatus(document.getElementById('privacyDataExportStatus'), '${kind}', 'Text')`);
            assert.equal(Boolean(line.querySelector('svg')), icon, kind);
            assert.equal(line.querySelector('span').textContent, 'Text');
        }
        assert.equal(line.dataset.kind, 'pending', 'an unknown kind');
        page.eval(`_setPrivacyStatus(document.getElementById('privacyDataExportStatus'), '', '')`);
        assert.equal(line.innerHTML, '');
    } finally {
        page.close();
    }
});

test('the download is the server\'s copy plus what this browser keeps, saved as a dated file', async () => {
    const page = await openAccountPage({ clerk: signedIn(), fetch: { '/api/user/data-export': { account: { id: 'user_1' } } } });
    try {
        page.window.localStorage.setItem(page.eval('APP_SHELF_KEY'), JSON.stringify({ recent: [{ type: 'text', value: 'Genesis 1' }], bookmarks: [], notes: { n: 1 }, tracks: { 'Daily Study': ['x'] } }));
        page.window.localStorage.setItem(page.eval('APP_PREFS_KEY'), '{"fontSize":21}');
        const clicked = [];
        page.window.HTMLAnchorElement.prototype.click = function click() { clicked.push([this.download, this.href]); };
        await call(page, 'handlePrivacyDataExport');
        const [request] = requests(page, '/api/user/data-export');
        assert.equal(request.init.headers.Accept, 'application/json');
        assert.equal(request.init.headers.Authorization, 'Bearer tok-1');
        assert.match(clicked[0][0], /^shelah-data-export-\d{4}-\d{2}-\d{2}\.json$/);
        assert.equal(page.document.querySelector('a[download]'), null, 'the link is removed again');
        const [blob] = page.objectUrls;
        const saved = JSON.parse(await blob.text());
        assert.deepEqual(saved.account, { id: 'user_1' });
        assert.deepEqual(saved.this_device, {
            recent_history: [{ type: 'text', value: 'Genesis 1' }],
            shelf_bookmarks: [],
            notes: { n: 1 },
            study_tracks: { 'Daily Study': ['x'] },
            settings: { fontSize: 21 },
        });
        assert.deepEqual(statusOf(page, '#privacyDataExportStatus'), { kind: 'success', text: 'Download started.' });
        assert.equal(page.$('#privacyDataExportBtn').disabled, false);
    } finally {
        page.close();
    }
});

test('a download that left some categories out says which', async () => {
    const page = await openAccountPage({ clerk: signedIn(), fetch: { '/api/user/data-export': { partial_errors: { history: 'x', notes: 'y' } } } });
    try {
        page.window.HTMLAnchorElement.prototype.click = () => {};
        await call(page, 'handlePrivacyDataExport');
        assert.deepEqual(statusOf(page, '#privacyDataExportStatus'), {
            kind: 'warning',
            text: 'Download started, but these categories could not be included: history, notes. Please try again later.',
        });
        page.eval('isHebrewMode = () => true');
        await call(page, 'handlePrivacyDataExport');
        assert.match(page.$('#privacyDataExportStatus').textContent, /ההורדה החלה, אך קטגוריות אלו לא נכללו: history, notes/);
    } finally {
        page.close();
    }
});

test('a failed download says so, in the reader\'s language, and the button is usable again', async () => {
    const page = await openAccountPage({ clerk: signedIn(), fetch: { '/api/user/data-export': { status: 500, body: {} } } });
    try {
        await call(page, 'handlePrivacyDataExport');
        assert.deepEqual(statusOf(page, '#privacyDataExportStatus'), { kind: 'error', text: 'Download failed. Please try again later.' });
        assert.ok(page.console.error.some((args) => /Data export failed/.test(args.join(' '))));
        assert.equal(page.$('#privacyDataExportBtn').disabled, false);
        page.eval('isHebrewMode = () => true');
        await call(page, 'handlePrivacyDataExport');
        assert.match(page.$('#privacyDataExportStatus').textContent, /ההורדה נכשלה/);
    } finally {
        page.close();
    }
});

test('while the download is prepared the button is held and the line says so', async () => {
    let release;
    const page = await openAccountPage({
        clerk: signedIn(),
        fetch: { '/api/user/data-export': () => new Promise((resolve) => { release = () => resolve({}); }) },
    });
    try {
        page.window.HTMLAnchorElement.prototype.click = () => {};
        const pending = call(page, 'handlePrivacyDataExport');
        await page.settle(5);
        assert.equal(page.$('#privacyDataExportBtn').disabled, true);
        assert.deepEqual(statusOf(page, '#privacyDataExportStatus'), { kind: 'pending', text: 'Preparing your download...' });
        release();
        await pending;
        assert.equal(page.$('#privacyDataExportBtn').disabled, false);
    } finally {
        page.close();
    }
});

test('what this browser keeps is exported even when its settings cannot be read', async () => {
    const page = await openAccountPage({ clerk: signedIn() });
    try {
        page.window.localStorage.setItem(page.eval('APP_PREFS_KEY'), '{broken');
        const local = plain(page.eval('privacyLocalExport()'));
        assert.deepEqual(local.settings, {});
        assert.deepEqual(local.recent_history, []);
    } finally {
        page.close();
    }
});

test('a failed delete reads out which part of the account is left over', async () => {
    const page = await openAccountPage({ clerk: signedIn() });
    try {
        const message = (status, body) => page.eval(`privacyDeleteFailureMessage({ status: ${status} }, ${JSON.stringify(body)})`);
        assert.equal(message(500, { error: 'Server said no' }), 'Server said no');
        assert.equal(message(207, { table_errors: { notes: 'x', history: 'y' } }), 'Delete incomplete (207) (failed categories: notes, history)');
        assert.equal(message(207, { clerk_error: 'x' }), 'Delete incomplete (207) (sign-in deletion failed)');
        assert.equal(message(200, {}), 'Delete incomplete (200)');
        page.eval('isHebrewMode = () => true');
        assert.match(message(207, { table_errors: { notes: 'x' } }), /קטגוריות שנכשלו: notes/);
        assert.match(message(207, { clerk_error: 'x' }), /מחיקת ההתחברות נכשלה/);
    } finally {
        page.close();
    }
});

test('a Clerk load that never settles still shows the Sign In button, and a late load corrects it', async () => {
    const clerk = signedIn();
    let finishLoad;
    const realLoad = clerk.load;
    clerk.load = (...args) => new Promise((resolve) => { finishLoad = () => resolve(realLoad.apply(clerk, args)); });
    const page = await openAccountPage({ libs: (window) => { window.Clerk = clerk; return true; } });
    try {
        page.eval('clerkStallMs = 20');
        page.$('#authControls').setAttribute('aria-busy', 'true');
        const started = call(page, 'ensureClerk');
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(page.$('#authControls').hasAttribute('aria-busy'), false);
        assert.equal(page.$('#signInBtn').classList.contains('hidden'), false);
        finishLoad();
        assert.equal(await started, true);
        assert.equal(page.$('#signInBtn').classList.contains('hidden'), true);
        assert.equal(page.$('#userProfileMenuLabel').textContent, 'Dana');
    } finally {
        page.close();
    }
});
