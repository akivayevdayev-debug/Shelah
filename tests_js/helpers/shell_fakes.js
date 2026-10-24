/**
 * Stand-ins for the things shell.js reaches that are a third party's or another
 * module's: Clerk (sign-in), the conversation panel (conversation-ui.js), the
 * router (router.js), and FullCalendar. Each records what shell.js asked of it
 * in `calls`, so a test can assert on the request, not on the fake's insides.
 */
'use strict';

/** window.Clerk: loads at once; `user` / `session` decide who is signed in. */
function fakeClerk({ user = null, token = 'tok-1', tokens = null } = {}) {
    const calls = [];
    const listeners = [];
    const queue = tokens ? [...tokens] : null;
    const clerk = {
        calls,
        listeners,
        loaded: false,
        user,
        session: user ? {
            getToken: async (options) => {
                calls.push(['getToken', options || null]);
                if (queue) return queue.shift() ?? null;
                return token;
            },
        } : null,
        load: async (options) => { calls.push(['load', options]); clerk.loaded = true; },
        addListener: (fn) => { listeners.push(fn); },
        openSignIn: async (options) => { calls.push(['openSignIn', options]); },
        openSignUp: async (options) => { calls.push(['openSignUp', options]); },
        openUserProfile: async (options) => { calls.push(['openUserProfile', options]); },
        closeSignIn: () => calls.push(['closeSignIn']),
        closeUserProfile: () => calls.push(['closeUserProfile']),
        signOut: async () => { calls.push(['signOut']); clerk.user = null; clerk.session = null; },
        /** Sign in as `next` and tell the page, as Clerk's own listener would. */
        async signInAs(next) {
            clerk.user = next;
            clerk.session = { getToken: async () => token };
            for (const fn of listeners) await fn();
        },
    };
    return clerk;
}

const SIGNED_IN_USER = {
    id: 'user_1',
    firstName: 'Dana',
    primaryEmailAddress: { emailAddress: 'dana@example.org' },
};

/** Installs window.APP_CLERK (and window.Clerk when `clerk` is given). */
function withClerk(window, clerk = null) {
    window.APP_CLERK = { publishableKey: 'pk_test_example' };
    if (clerk) window.Clerk = clerk;
    return clerk;
}

/** window.ShelahConversationUI as shell.js uses it: ask, settings, a few probes. */
function fakeConversationUI(overrides = {}) {
    const calls = [];
    const ui = {
        calls,
        // The real rule (conversation-ui.js askSurface) with the panel shut.
        askSurface: ({ origin = 'bar', followUp = false } = {}) => (origin === 'bar' && !followUp ? 'bar' : 'panel'),
        showPendingAnswer: () => calls.push(['showPendingAnswer']),
        askFromSearch: async (question, options, extra) => {
            calls.push(['askFromSearch', question, options, extra]);
            return { answer: 'A', history_id: 'h-1', meta: { mode: options.mode, source_count: 2 } };
        },
        isShowingAnswer: () => true,
        aiRoute: () => ({ mode: 'balanced' }),
        openSettings: (anchor) => calls.push(['openSettings', anchor?.id]),
        ...overrides,
    };
    return ui;
}

/** window.ShelahRouter as shell.js uses it: records every push, reads a settable route. */
function fakeRouter(initialRoute = {}) {
    const calls = [];
    const router = {
        calls,
        route: { ...initialRoute },
        readRoute: () => ({ ...router.route }),
        pushRoute: (patch, options) => {
            calls.push(['pushRoute', patch, options || null]);
            for (const [key, value] of Object.entries(patch)) {
                if (value === null || value === undefined) delete router.route[key];
                else router.route[key] = value;
            }
        },
        clearRoute: (options) => { calls.push(['clearRoute', options || null]); router.route = {}; },
        closeOverlay: (name, patch) => { calls.push(['closeOverlay', name, patch]); return router.closeHow; },
        closeHow: 'replace',
        /** The URL of a route over a path: just the query the route's own keys make. */
        routeUrl: (route, pathname) => {
            const query = new URLSearchParams(Object.entries(route).filter(([, value]) => value)).toString();
            return `${pathname}${query ? `?${query}` : ''}`;
        },
        /** Navigating to a path inside the app: the router takes it unless `pathTaken` is false. */
        pathTaken: true,
        pushPath: (path, options) => { calls.push(['pushPath', path, options || null]); return router.pathTaken; },
        markNotFound: () => calls.push(['markNotFound']),
    };
    return router;
}

/** A FullCalendar.Calendar that records its options and exposes the callbacks. */
function fakeFullCalendar() {
    const instances = [];
    class Calendar {
        constructor(element, options) {
            this.element = element;
            this.options = options;
            this.events = [];
            this.rendered = 0;
            this.view = { type: options.initialView || 'dayGridMonth', currentStart: new Date(2026, 9, 1), currentEnd: new Date(2026, 10, 1), title: 'October 2026' };
            instances.push(this);
        }
        render() { this.rendered += 1; }
        destroy() { this.destroyed = true; }
        getDate() { return new Date(2026, 9, 16); }
        gotoDate(date) { this.went = date; }
        changeView(type) { this.view.type = type; this.changedTo = type; }
        today() { this.todayCalled = true; }
        next() { this.nextCalled = true; }
        prev() { this.prevCalled = true; }
        getEvents() { return this.events; }
        refetchEvents() { this.refetched = (this.refetched || 0) + 1; }
        addEvent(event) { this.events.push(event); return event; }
        removeAllEvents() { this.events = []; }
        setOption(name, value) { this.options[name] = value; }
        select(...args) { this.selected = args; }
        unselect() { this.unselected = true; }
    }
    return { instances, FullCalendar: { Calendar } };
}

module.exports = { fakeClerk, withClerk, SIGNED_IN_USER, fakeConversationUI, fakeRouter, fakeFullCalendar };
