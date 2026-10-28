/**
 * static/js/conversation-ui.js, the corners the other conversation tests leave:
 * the spring between two sizes, a step held on screen long enough to be read,
 * the notice buttons (Retry, New conversation, Sign in), the sidebar's way home,
 * waiting for Clerk, the tip following the layout, and a page whose storage or
 * icon data is unusable. Runs the real module on the real home page in jsdom
 * (tests_js/helpers/conversation_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openConversationPage } = require('./helpers/conversation_page');

const panel = (page) => page.document.getElementById('convPanel');
const failure = (code) => Object.assign(new Error(code), { code });
const authChanged = (page, signedIn) => page.document.dispatchEvent(new page.window.CustomEvent('shelah:auth-changed', { detail: { signedIn } }));

// --- the spring between two sizes ---------------------------------------------

function springMotion(springs) {
    return {
        APPLE_SPRING: { snappy: { stiffness: 1 } },
        springValue(from, to, spring, handlers) {
            const controls = { handlers, stopped: 0, stop() { this.stopped += 1; } };
            springs.push(controls);
            return controls;
        },
    };
}

test('resizing the panel springs it from its old box and scales its content back so nothing is squashed', async () => {
    const springs = [];
    const page = await openConversationPage({ before(window) { window.ShelahMotion = springMotion(springs); } });
    try {
        await page.ui.open({ size: 'mini' });
        await page.flush();
        const el = panel(page);
        const small = { left: 600, top: 400, width: 300, height: 200 };
        const large = { left: 100, top: 50, width: 600, height: 400 };
        const boxes = [small, large];
        el.getBoundingClientRect = () => boxes.shift() || large;

        page.ui.setSize('overlay');
        await page.flush();
        assert.equal(springs.length, 1);
        assert.equal(el.style.transformOrigin, 'top left');
        assert.equal(el.style.transform, 'translate(500px, 350px) scale(0.5, 0.5)', 'starts where the old box was');
        const content = [...el.children].filter((child) => !child.hidden);
        assert.ok(content.length > 0);
        assert.ok(content.every((child) => child.style.transform === 'scale(2, 2)'), 'the inverse scale');

        springs[0].handlers.onUpdate(0.5);
        assert.equal(el.style.transform, 'translate(250px, 175px) scale(0.75, 0.75)');
        springs[0].handlers.onUpdate(1);
        assert.equal(el.style.transform, 'translate(0px, 0px) scale(1, 1)');
        springs[0].handlers.onComplete();
        assert.equal(el.style.transform, '');
        assert.equal(el.style.transformOrigin, '');
        assert.ok(content.every((child) => child.style.transform === ''));
    } finally {
        page.close();
    }
});

test('a resize during a resize stops the running spring and starts from where the panel visibly is', async () => {
    const springs = [];
    const page = await openConversationPage({ before(window) { window.ShelahMotion = springMotion(springs); } });
    try {
        await page.ui.open({ size: 'mini' });
        await page.flush();
        const el = panel(page);
        el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 200 });
        page.ui.setSize('overlay');
        await page.flush();
        page.ui.setSize('full');
        await page.flush();
        assert.equal(springs.length, 2);
        assert.equal(springs[0].stopped, 1);
        // The first spring finishing late does not clear the second one's frame.
        springs[0].handlers.onComplete();
        assert.notEqual(el.style.transform, '');
        springs[1].handlers.onComplete();
        assert.equal(el.style.transform, '');
    } finally {
        page.close();
    }
});

test('with reduced motion, or a panel with no size, the panel just changes size', async () => {
    const springs = [];
    const page = await openConversationPage({
        before(window) {
            window.ShelahMotion = { ...springMotion(springs), isMotionReduced: () => Boolean(window.__reduced) };
        },
    });
    try {
        await page.ui.open({ size: 'mini' });
        await page.flush();
        const el = panel(page);
        const box = { left: 0, top: 0, width: 300, height: 200 };
        el.getBoundingClientRect = () => box;
        page.window.__reduced = true;
        page.ui.setSize('overlay');
        await page.flush();
        assert.equal(springs.length, 0);
        assert.equal(el.dataset.size, 'overlay');

        page.window.__reduced = false;
        el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
        page.ui.setSize('full');
        await page.flush();
        assert.equal(springs.length, 0);
        assert.equal(el.dataset.size, 'full');
    } finally {
        page.close();
    }
});

test('dropping the mini widget in a corner springs it there', async () => {
    const springs = [];
    const page = await openConversationPage({ before(window) { window.ShelahMotion = springMotion(springs); } });
    try {
        await page.ui.open({ size: 'mini' });
        await page.flush();
        panel(page).getBoundingClientRect = () => ({ left: 100, top: 100, width: 300, height: 200, right: 400, bottom: 300 });
        const header = page.$('.conv-header');
        page.pointer(header, 'pointerdown', { clientX: 150, clientY: 120 });
        page.pointer(header, 'pointermove', { clientX: 700, clientY: 600 });
        page.pointer(header, 'pointerup', { clientX: 700, clientY: 600 });
        assert.equal(springs.length, 1);
    } finally {
        page.close();
    }
});

test('on a phone, crossing between the sheet and the bar moves focus with it', async () => {
    const page = await openConversationPage({ mobile: true, signedIn: true });
    try {
        await page.ui.open({ fresh: true });
        await page.flush();
        assert.equal(panel(page).dataset.size, 'overlay');
        page.ui.setSize('mini');
        await page.flush();
        page.clock.runFrames();
        assert.equal(page.hidden('#convPanel') && !page.hidden('#convPip'), true, 'the bar above the tabs');
        assert.equal(page.$('#convPip').contains(page.document.activeElement), true);
        page.ui.setSize('overlay');
        await page.flush();
        page.clock.runFrames();
        assert.equal(page.hidden('#convPanel'), false);
        assert.equal(panel(page).contains(page.document.activeElement), true);
        // The same size again changes nothing.
        page.ui.setSize('overlay');
        await page.flush();
        assert.equal(panel(page).dataset.size, 'overlay');
    } finally {
        page.close();
    }
});

// --- a step held long enough to be read ---------------------------------------

test('a step that changes at once is held back until the one before it has been on screen a moment', async () => {
    let emit;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const page = await openConversationPage({
        signedIn: true,
        api: {
            askInConversation: async (id, { question }, hooks) => {
                emit = hooks.onProgress;
                await gate;
                return {
                    user_message: { id: 'u1', role: 'user', content: question, status: 'complete' },
                    assistant_message: { id: 'a1', role: 'assistant', content: 'Done.', status: 'complete', citations: [] },
                    conversation: { id, title: question, minhag: 'All' },
                };
            },
        },
    });
    try {
        await page.ui.open({ fresh: true });
        await page.flush();
        const sending = page.ask('Slow one');
        await page.flush();
        await page.tick(700); // "Getting started" has been read
        emit({ type: 'stage', stage: 'sources', state: 'start' });
        await page.flush();
        const now = () => page.text('[data-status-now]');
        assert.equal(now(), 'Searching the sources…');

        emit({ type: 'stage', stage: 'sources', state: 'done' });
        emit({ type: 'stage', stage: 'customs', state: 'start' });
        await page.flush();
        assert.equal(now(), 'Searching the sources…', 'the new step waits its turn');
        await page.tick(699);
        assert.equal(now(), 'Searching the sources…');
        await page.tick(1);
        assert.equal(now(), 'Checking community customs…');
        assert.equal(page.text('[data-status-done]'), 'Sources');

        release();
        await sending;
        await page.flush();
        assert.match(page.text('#convMessages'), /Done\./);
    } finally {
        page.close();
    }
});

// --- web pages being read ------------------------------------------------------

async function pageReading(events) {
    let emit;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const page = await openConversationPage({
        signedIn: true,
        api: {
            askInConversation: async (id, { question }, hooks) => {
                emit = hooks.onProgress;
                await gate;
                return {
                    user_message: { id: 'u1', role: 'user', content: question, status: 'complete' },
                    assistant_message: { id: 'a1', role: 'assistant', content: 'Done.', status: 'complete', citations: [] },
                    conversation: { id, title: question, minhag: 'All' },
                };
            },
        },
    });
    await page.ui.open({ fresh: true });
    await page.flush();
    const sending = page.ask('Is this gum kosher?');
    await page.flush();
    events.forEach((event) => emit(event));
    await page.flush();
    return { page, finish: async () => { release(); await sending; page.close(); } };
}

const OU = { type: 'site', stage: 'thinking', site: { title: 'OU Kosher', url: 'https://www.oukosher.org/gum' } };

test('a web page the answer reads is linked under the status line by its site', async () => {
    const { page, finish } = await pageReading([OU]);
    try {
        assert.equal(page.document.querySelector('[data-status-done] a').getAttribute('href'), 'https://www.oukosher.org/gum');
    } finally {
        await finish();
    }
});

test('the link is named by its site and opens in a new tab', async () => {
    const { page, finish } = await pageReading([OU]);
    try {
        const link = page.document.querySelector('[data-status-done] a');
        assert.deepEqual([link.textContent, link.target, link.rel], ['oukosher.org', '_blank', 'noopener noreferrer']);
    } finally {
        await finish();
    }
});

test('a step that found nothing never shows as finished', async () => {
    const { page, finish } = await pageReading([
        { type: 'stage', stage: 'sources', state: 'start' },
        { type: 'stage', stage: 'sources', state: 'none' },
    ]);
    try {
        assert.equal(page.document.querySelector('[data-status-done]').dataset.empty, 'true');
    } finally {
        await finish();
    }
});

// --- notices ------------------------------------------------------------------

test('a conversation that would not load offers Retry, which opens it again', async () => {
    let attempts = 0;
    const page = await openConversationPage({
        signedIn: true,
        api: {
            getConversation: async (id) => {
                attempts += 1;
                if (attempts === 1) throw failure('network');
                return { id, title: 'Back again', minhag: 'All', messages: [] };
            },
        },
    });
    try {
        await page.ui.open({ id: 'c9' });
        await page.flush();
        assert.equal(page.$('#convNoticeAction').dataset.action, 'retry-open');
        assert.match(page.text('#convNoticeText'), /Couldn't reach Sh'elah/);
        page.click('#convNoticeAction');
        await page.flush();
        assert.equal(attempts, 2);
        assert.match(page.text('#convTitle'), /Back again/);
        assert.equal(page.hidden('#convNotice'), true);
    } finally {
        page.close();
    }
});

test('Retry with no conversation in the address opens nothing', async () => {
    const page = await openConversationPage({
        signedIn: true,
        api: { getConversation: async () => { throw failure('network'); } },
    });
    try {
        await page.ui.open({ id: 'c9' });
        await page.flush();
        page.window.history.replaceState({}, '', '/');
        const before = page.api.calls.length;
        page.click('#convNoticeAction');
        await page.flush();
        assert.equal(page.api.calls.length, before);
    } finally {
        page.close();
    }
});

test('a conversation that no longer exists offers a new one', async () => {
    const page = await openConversationPage({
        signedIn: true,
        api: { getConversation: async () => { throw failure('not_found'); } },
    });
    try {
        await page.ui.open({ id: 'gone' });
        await page.flush();
        assert.match(page.text('#convNoticeText'), /no longer exists/);
        assert.equal(page.$('#convNoticeAction').dataset.action, 'new');
        page.click('#convNoticeAction');
        await page.flush();
        assert.equal(page.store.getState().conversation, null);
        assert.equal(page.hidden('#convNotice'), true);
    } finally {
        page.close();
    }
});

test('"Sign in" on an ended session opens sign-in when the page can, and does nothing when it cannot', async () => {
    const page = await openConversationPage({
        signedIn: true,
        api: { getConversation: async () => { throw failure('unauthorized'); } },
    });
    try {
        await page.ui.open({ id: 'c1' });
        await page.flush();
        assert.equal(page.$('#convNoticeAction').dataset.action, 'sign-in');
        page.click('#convNoticeAction');
        assert.deepEqual(page.errors, []);
        const signIns = [];
        page.window.handleSignIn = () => { signIns.push('in'); };
        page.click('#convNoticeAction');
        assert.deepEqual(signIns, ['in']);
    } finally {
        page.close();
    }
});

test('the sidebar\'s Sign in button opens sign-in, and the history popover closes behind it', async () => {
    const page = await openConversationPage({ clerk: true });
    try {
        const signIns = [];
        page.window.handleSignIn = () => { signIns.push('in'); };
        await page.ui.open({ fresh: true });
        await page.flush();
        const button = page.$('[data-conv-action="sign-in"]');
        assert.ok(button, 'the signed-out hint has a Sign in button');
        page.click(button);
        assert.deepEqual(signIns, ['in']);
        // And without a sign-in page it is only closed.
        page.window.handleSignIn = undefined;
        page.click(button);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('the sidebar\'s lockup closes the panel and goes home; an action nobody knows is ignored', async () => {
    const page = await openConversationPage();
    try {
        const homes = [];
        await page.ui.open({ fresh: true });
        await page.flush();
        page.click('[data-conv-action="home"]');
        await page.flush();
        assert.equal(page.hidden('#convPanel'), true, 'closes even when the page has no goHome');

        page.window.goHome = () => { homes.push('home'); };
        await page.ui.open({ fresh: true });
        await page.flush();
        page.click('[data-conv-action="home"]');
        await page.flush();
        assert.deepEqual(homes, ['home']);
        assert.equal(page.hidden('#convPanel'), true);

        await page.ui.open({ fresh: true });
        await page.flush();
        page.$('#convTitle').dataset.convAction = 'nobody-knows-this';
        page.click('#convTitle');
        assert.equal(page.hidden('#convPanel'), false);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

// --- waiting for Clerk ----------------------------------------------------------

test('a question asked before Clerk reports in waits for it, and gives up after ten seconds', async () => {
    const page = await openConversationPage({ clerk: true });
    try {
        const asked = [];
        page.window.handleAiSearch = (question) => { asked.push(question); };
        const opening = page.ui.open({ question: 'Is it late?' });
        await page.flush();
        assert.deepEqual(asked, []);
        await page.tick(9999);
        assert.deepEqual(asked, []);
        await page.tick(1);
        await opening;
        assert.deepEqual(asked, ['Is it late?'], 'signed out as far as anyone can tell: the one-shot search');
    } finally {
        page.close();
    }
});

test('a question asked before Clerk reports in goes to the account when Clerk says signed in', async () => {
    const page = await openConversationPage({ clerk: true });
    try {
        const opening = page.ui.open({ question: 'Is it late?' });
        await page.flush();
        page.window.Clerk = { session: { id: 's' }, user: { id: 'u' } };
        authChanged(page, true);
        await opening;
        await page.flush();
        assert.deepEqual(page.api.calls.filter(([name]) => name === 'ask').map(([, , options]) => options.question), ['Is it late?']);
    } finally {
        page.close();
    }
});

// --- the tip follows the layout ---------------------------------------------------

test('the discovery tip moves to the phone button when the window narrows', async () => {
    const page = await openConversationPage();
    try {
        await page.tick(1700);
        assert.equal(page.hidden('#aiDiscoveryTip'), false);
        assert.ok(page.$('#topbarAskBtn').classList.contains('ai-attention'));

        page.$('#topbarAskBtn').classList.add('hidden');
        page.$('#mobileTopbarAskBtn').classList.remove('hidden');
        page.media.set('(max-width: 1023px)', true);
        await page.tick(1700);
        assert.equal(panel(page).dataset.layout, 'mobile');
        assert.equal(page.hidden('#aiDiscoveryTip'), false);
        assert.ok(page.$('#mobileTopbarAskBtn').classList.contains('ai-attention'));
        assert.equal(page.$('#topbarAskBtn').classList.contains('ai-attention'), false);
    } finally {
        page.close();
    }
});

// --- unusable storage and icon data ----------------------------------------------

test('storage that refuses writes costs nothing when a corner is picked or a dictation fails', async () => {
    globalThis.SpeechRecognition = class {
        constructor() { globalThis.SpeechRecognition.instance = this; }
        start() { this.onstart?.(); }
        stop() { this.onend?.(); }
        abort() { this.onend?.(); }
    };
    const page = await openConversationPage({
        signedIn: true,
        before(window) {
            const refuse = () => { throw new Error('blocked'); };
            Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: refuse, setItem: refuse, removeItem: refuse } });
        },
    });
    try {
        await page.ui.open({ size: 'mini' });
        await page.flush();
        const header = page.$('.conv-header');
        page.pointer(header, 'pointerdown', { clientX: 900, clientY: 700 });
        page.pointer(header, 'pointerup', { clientX: 100, clientY: 80 });

        await page.ui.open({ fresh: true, size: 'overlay' });
        await page.flush();
        page.click('#convMicBtn');
        await page.flush();
        globalThis.SpeechRecognition.instance.onerror?.({ error: 'not-allowed' });
        await page.flush();
        assert.match(page.text('#convToastText'), /Microphone is blocked/);
        assert.deepEqual(page.errors, []);
    } finally {
        delete globalThis.SpeechRecognition;
        page.close();
    }
});

test('icon data that is not JSON leaves the panel working without its custom icons', async () => {
    const page = await openConversationPage({
        install: false,
        before(window) { window.document.getElementById('convIconPaths').textContent = '{not json'; },
    });
    try {
        page.install();
        await page.flush();
        await page.ui.open({ fresh: true });
        await page.flush();
        assert.equal(page.hidden('#convPanel'), false);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});
