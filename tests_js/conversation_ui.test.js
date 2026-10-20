/**
 * static/js/conversation-ui.js -- the "Ask Sh'elah" panel: opening, sizes and
 * the URL, the transcript, the history list, the menu (rename, pin, delete,
 * share), the discovery tip, keyboard handling, the phone sheet and the mini
 * widget's drag. Runs the real module on the real home page in jsdom
 * (tests_js/helpers/conversation_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openConversationPage } = require('./helpers/conversation_page');

const SHARE_TOKEN = 'x'.repeat(32); // a public-link token only has to look like one
// The server's shape (snake_case); the store turns it into the panel's.
const LIST = [
    { id: 'c1', title: 'Shabbat candles', minhag: 'Sefardic', updated_at: '2026-10-15T09:00:00Z' },
    { id: 'c2', title: 'Pinned question', minhag: 'Ashkenaz', pinned_at: '2026-10-01T09:00:00Z', updated_at: '2026-09-01T09:00:00Z' },
    { id: 'c3', title: '', minhag: 'All', updated_at: '2026-01-01T09:00:00Z' },
];

const route = (page) => page.window.location.pathname;
const panel = (page) => page.document.getElementById('convPanel');
const turns = (page) => page.$$('#convMessages > li');
const failure = (code) => Object.assign(new Error(code), { code });

async function openAsk(options = {}) {
    const page = await openConversationPage({ signedIn: true, ...options });
    await page.ui.open({ fresh: true });
    await page.flush();
    return page;
}

// --- install ---------------------------------------------------------------

test('a page without the panel gets no conversation UI', async () => {
    const page = await openConversationPage({
        install: false,
        before: (window) => window.document.getElementById('convPanel').remove(),
    });
    try {
        assert.equal(page.install(), null);
        assert.equal(page.window.ShelahConversationUI, undefined);
    } finally {
        page.close();
    }
});

test('installing twice returns the same API', async () => {
    const page = await openConversationPage();
    try {
        const first = page.ui;
        assert.equal(page.install(), first);
        for (const name of ['hydrate', 'open', 'close', 'setSize', 'openHistory', 'openSettings', 'getStore', 'askFromSearch', 'showAnswer', 'aiRoute']) {
            assert.equal(typeof first[name], 'function', name);
        }
        assert.equal(first.isShowingAnswer(), false);
        assert.deepEqual({ ...first.aiRoute() }, { minhag: 'All', mode: 'balanced' });
    } finally {
        page.close();
    }
});

test('signed out, a question goes to the one-shot search instead of the conversation API', async () => {
    const page = await openConversationPage();
    try {
        const asked = [];
        page.window.handleAiSearch = (question, options) => { asked.push([question, { ...options }]); };
        // No Clerk on the deployment (local dev): the panel does not wait for sign-in.
        await page.ui.open({ question: '  What is Shabbat?  ' });
        await page.flush();
        assert.deepEqual(asked, [['What is Shabbat?', { followUp: false, origin: 'panel' }]]);

        // The composer does the same from inside the panel.
        await page.ui.open({ fresh: true });
        await page.flush();
        await page.ask('And Rosh Chodesh?');
        assert.deepEqual(asked.map(([question]) => question), ['What is Shabbat?', 'And Rosh Chodesh?']);
        assert.equal(page.$('#convInput').value, '');
        assert.equal(page.api.calls.length, 0);
    } finally {
        page.close();
    }
});

test('a paused answer shows the banner and the sources it found, not the server sentence again', async () => {
    const page = await openConversationPage();
    try {
        page.window.renderDisclaimerBanner = (el, _safety, paused) => {
            el.classList.toggle('ai-disclaimer-banner--breaker-paused', Boolean(paused));
            el.textContent = 'Answers are paused today.';
        };
        await page.ui.open({ fresh: true });
        await page.flush();
        page.ui.showAnswer({
            id: 'h-paused',
            question: 'Hot plate?',
            answer: 'AI answers are paused for today -- try later.',
            ai_cited_sources: [],
            sources: [{ ref: 'Shulchan Arukh, Orach Chayim 253:1', lines: [] }],
            meta: { fallback: true, breaker_tripped: true },
        });
        await page.flush();

        const turn = page.$('#convMessages .conv-turn--assistant') || page.$('#convMessages li:last-child');
        assert.ok(turn.querySelector('.ai-disclaimer-banner--breaker-paused'));
        assert.equal(turn.querySelector('.conv-answer'), null);
        assert.match(turn.textContent, /Shulchan Arukh, Orach Chayim 253:1/);
        assert.doesNotMatch(turn.textContent, /try later/);
    } finally {
        page.close();
    }
});

// --- opening, sizes, the URL ----------------------------------------------

test('Ask AI opens the mini widget and a second press closes it', async () => {
    const page = await openConversationPage();
    try {
        const ask = page.$('#topbarAskBtn');
        page.click(ask);
        await page.flush();
        assert.equal(page.hidden('#convPanel'), false);
        assert.equal(panel(page).dataset.size, 'mini');
        assert.equal(ask.getAttribute('aria-expanded'), 'true');
        assert.match(route(page), /^\/chat\/new/);
        assert.equal(page.window.localStorage.getItem('shelah.ai.used'), '1');

        page.click(ask);
        await page.flush();
        assert.equal(page.hidden('#convPanel'), true);
        assert.equal(ask.getAttribute('aria-expanded'), 'false');
        assert.doesNotMatch(route(page), /^\/chat\//);
    } finally {
        page.close();
    }
});

test('a press on Ask AI while the panel is large shrinks it to the mini widget', async () => {
    const page = await openConversationPage();
    try {
        await page.ui.open({ size: 'full' });
        await page.flush();
        assert.equal(panel(page).dataset.size, 'full');
        page.click('#topbarAskBtn');
        await page.flush();
        assert.equal(panel(page).dataset.size, 'mini');
    } finally {
        page.close();
    }
});

test('the sizes set the dialog semantics, lock the page behind a modal, and Escape closes a modal', async () => {
    const page = await openConversationPage();
    try {
        await page.ui.open({ size: 'overlay' });
        await page.flush();
        assert.equal(panel(page).getAttribute('role'), 'dialog');
        assert.equal(panel(page).getAttribute('aria-modal'), 'true');
        assert.ok(page.document.body.classList.contains('conv-modal-open'));
        assert.equal(page.hidden('#convScrim'), false);

        page.click('#convExpandBtn');
        await page.flush();
        assert.equal(panel(page).dataset.size, 'full');
        assert.equal(page.hidden('#convScrim'), true);
        assert.match(page.$('#convExpandBtn').getAttribute('aria-label'), /full page/);

        page.ui.setSize('mini');
        await page.flush();
        assert.equal(panel(page).getAttribute('role'), 'region');
        assert.equal(panel(page).getAttribute('aria-modal'), 'false');
        assert.equal(page.document.body.classList.contains('conv-modal-open'), false);
        assert.match(page.$('#convExpandBtn').getAttribute('aria-label'), /Expand/);

        // Escape leaves a mini widget alone.
        assert.equal(page.key('Escape').defaultPrevented, false);
        assert.equal(page.hidden('#convPanel'), false);

        page.ui.setSize('overlay');
        await page.flush();
        assert.equal(page.key('Escape').defaultPrevented, true);
        assert.equal(page.hidden('#convPanel'), true);
    } finally {
        page.close();
    }
});

test('the scrim, the Close action and the size buttons drive the panel', async () => {
    const page = await openConversationPage();
    try {
        await page.ui.open({ size: 'overlay' });
        await page.flush();
        page.click('#convScrim');
        await page.flush();
        assert.equal(page.hidden('#convPanel'), true);

        await page.ui.open({ size: 'overlay' });
        await page.flush();
        const sizeButton = page.document.createElement('button');
        sizeButton.dataset.convSize = 'expand';
        panel(page).appendChild(sizeButton);
        page.click(sizeButton);
        assert.equal(panel(page).dataset.size, 'full');
        sizeButton.dataset.convSize = 'mini';
        page.click(sizeButton);
        assert.equal(panel(page).dataset.size, 'mini');

        const close = page.document.createElement('button');
        close.dataset.convAction = 'close';
        panel(page).appendChild(close);
        page.click(close);
        await page.flush();
        assert.equal(page.hidden('#convPanel'), true);
        // Closing a closed panel does nothing.
        page.ui.close();
    } finally {
        page.close();
    }
});

test('the panel closes onto the page that was showing, and returns focus to what opened it', async () => {
    const page = await openConversationPage();
    try {
        let restored = 0;
        page.window.restoreShownView = () => { restored += 1; };
        const ask = page.$('#topbarAskBtn');
        ask.focus();
        page.click(ask);
        await page.flush();
        page.click(ask);
        await page.flush();
        assert.equal(restored, 1);
        assert.equal(page.document.activeElement, ask);
    } finally {
        page.close();
    }
});

test('the URL follows the panel: a deep link opens it, Back/Forward close and reopen it', async () => {
    const page = await openConversationPage({ signedIn: true });
    try {
        page.ui.hydrate({ conversation: 'c9', cv: 'full' }, { isInitial: true });
        await page.flush();
        assert.equal(panel(page).dataset.size, 'full');
        assert.deepEqual(page.api.calls.filter(([name]) => name === 'get').map(([, id]) => id), ['c9']);

        page.ui.hydrate({ conversation: 'c9', cv: 'mini' });
        await page.flush();
        assert.equal(panel(page).dataset.size, 'mini');

        page.ui.hydrate({ conversation: 'new' });
        await page.flush();
        assert.equal(page.hidden('#convPanel'), false);
        assert.equal(page.store.getState().conversation, null);

        page.ui.hydrate({});
        await page.flush();
        assert.equal(page.hidden('#convPanel'), true);

        // An answer's URL belongs to the classic script: the panel is left alone.
        page.ui.hydrate({ chat: 'h-1' });
        assert.equal(page.hidden('#convPanel'), true);
    } finally {
        page.close();
    }
});

test('a link\'s community and mode become the panel\'s, and unknown communities are ignored', async () => {
    const page = await openConversationPage({ signedIn: true });
    try {
        page.ui.hydrate({ conversation: 'new', minhag: 'Sefardic', mode: 'sources' });
        await page.flush();
        assert.deepEqual({ ...page.ui.aiRoute() }, { minhag: 'Sefardic', mode: 'sources' });
        assert.equal(page.store.getState().draftMinhag, 'Sefardic');
        assert.match(route(page), /sefardic/i);

        page.ui.hydrate({ conversation: 'new', minhag: 'Atlantis', mode: 'strict' });
        await page.flush();
        assert.equal(page.ui.aiRoute().mode, 'strict');
        assert.notEqual(page.store.getState().draftMinhag, 'Atlantis');
    } finally {
        page.close();
    }
});

test('a deep link to a conversation waits for sign-in and says so', async () => {
    const page = await openConversationPage({ clerk: true });
    try {
        page.ui.hydrate({ conversation: 'c7' }, { isInitial: true });
        await page.flush();
        // Until Clerk reports in, the panel just shows it is loading.
        assert.equal(page.hidden('#convLoading'), false);
        assert.equal(page.hidden('#convNotice'), true);
        page.document.dispatchEvent(new page.window.CustomEvent('shelah:auth-changed', { detail: { signedIn: false } }));
        await page.flush();
        assert.equal(page.hidden('#convLoading'), true);
        assert.equal(page.hidden('#convNotice'), false);
        assert.match(page.text('#convNoticeText'), /Sign in to open this conversation/);
        assert.equal(page.$('#convNoticeAction').dataset.action, 'sign-in');
        let signIns = 0;
        page.window.handleSignIn = () => { signIns += 1; };
        page.click('#convNoticeAction');
        assert.equal(signIns, 1);

        // Signing in opens the conversation that was waiting.
        page.window.Clerk = { session: { id: 's' }, user: { id: 'u' } };
        page.document.dispatchEvent(new page.window.CustomEvent('shelah:auth-changed', { detail: { signedIn: true } }));
        await page.flush();
        assert.deepEqual(page.api.calls.filter(([name]) => name === 'get').map(([, id]) => id), ['c7']);
        assert.ok(page.api.calls.some(([name]) => name === 'list'));
    } finally {
        page.close();
    }
});

test('signing out closes the panel and drops the signed-in thread', async () => {
    const page = await openAsk();
    try {
        await page.ask('A question');
        assert.equal(page.store.getState().conversation.id, 'c1');
        page.window.Clerk = { session: null, user: null };
        page.document.dispatchEvent(new page.window.CustomEvent('shelah:auth-changed', { detail: { signedIn: false } }));
        await page.flush();
        assert.equal(page.hidden('#convPanel'), true);
        assert.equal(page.store.getState().conversation, null);
        assert.equal(page.hidden('#convSignedOutHint'), false);
    } finally {
        page.close();
    }
});

// --- the transcript --------------------------------------------------------

test('a question creates the conversation and shows both turns, locked to its community', async () => {
    const page = await openAsk();
    try {
        assert.match(page.text('#convTitle'), /Ask Sh'elah/);
        assert.equal(page.hidden('#convEmpty'), false);
        assert.equal(page.$('#convSendBtn').disabled, true);

        await page.ask('When do we light candles?');
        // "All communities" is the absence of a lock, not a community of its own.
        assert.deepEqual(page.api.calls.filter(([name]) => name === 'create').map(([, options]) => options.minhag), [null]);
        assert.equal(turns(page).length, 2);
        assert.match(turns(page)[0].textContent, /When do we light candles\?/);
        assert.ok(turns(page)[1].querySelector('.conv-answer'));
        assert.match(page.text('#convTitle'), /When do we light candles\?/);
        assert.equal(page.$('#convInput').value, '');
        assert.equal(page.hidden('#convEmpty'), true);
        assert.match(page.text('#convLockLine'), /follow Sefardic practice/);
        assert.match(page.text('#convMenuMinhagLocked'), /locked for this conversation/);
        assert.equal(page.$('#convMenuBtn').dataset.locked, 'true');
        // The default size (overlay) is not spelled out in the URL.
        assert.equal(route(page), '/chat/c1/sefardic/balanced');
        assert.match(page.$('#convInput').placeholder, /follow-up/);
    } finally {
        page.close();
    }
});

test('a reply in the signed-in thread can be rated, with the question it answers', async () => {
    const page = await openAsk();
    try {
        const widgets = [];
        page.window.renderFeedbackWidget = (host, data, question) => { widgets.push([host.className, data.meta.language, question, data.history_id]); };
        await page.ask('When do we light candles?');
        assert.deepEqual(widgets, [['conv-turn__feedback', 'en', 'When do we light candles?', undefined]]);
        assert.ok(turns(page)[1].querySelector('[data-answer-actions] .conv-turn__feedback'), 'the reply has its rating row');
        assert.equal(turns(page)[0].querySelector('[data-answer-actions]'), null, 'the question has none');
    } finally {
        page.close();
    }
});

test('a reply that is still pending, failed or came back empty has no rating row', async () => {
    const reply = (content, status) => async (id, { question }) => ({
        user_message: { id: 'u1', role: 'user', content: question, status: 'complete' },
        assistant_message: { id: 'a1', role: 'assistant', content, status, citations: [] },
        conversation: { id, title: question, minhag: 'All' },
    });
    const rated = [];
    const run = async (api) => {
        const page = await openAsk({ api });
        try {
            page.window.renderFeedbackWidget = (host, data, question) => { rated.push(question); };
            await page.ask('A question?');
            return page.$$('#convMessages [data-answer-actions]').length;
        } finally {
            page.close();
        }
    };
    assert.equal(await run({ askInConversation: () => new Promise(() => {}) }), 0, 'pending');
    assert.equal(await run({ askInConversation: reply('', 'error') }), 0, 'failed');
    assert.equal(await run({ askInConversation: reply('  ', 'complete') }), 0, 'empty');
    assert.deepEqual(rated, []);
});

test('Shift+Enter keeps typing; Enter on an empty box and an open request send nothing', async () => {
    const page = await openAsk();
    try {
        const input = page.$('#convInput');
        input.value = 'half';
        const shifted = new page.window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
        input.dispatchEvent(shifted);
        assert.equal(shifted.defaultPrevented, false);
        input.value = '   ';
        input.dispatchEvent(new page.window.Event('input', { bubbles: true }));
        assert.equal(page.$('#convSendBtn').disabled, true);
        page.key('Enter', {}, input);
        await page.flush();
        assert.equal(page.api.calls.length, 1); // only the history list
    } finally {
        page.close();
    }
});

test('the composer form submits through the send button', async () => {
    const page = await openAsk();
    try {
        page.$('#convInput').value = 'From the button';
        page.$('#convInput').dispatchEvent(new page.window.Event('input', { bubbles: true }));
        assert.equal(page.$('#convSendBtn').disabled, false);
        page.$('#convComposer').dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));
        await page.flush();
        assert.ok(page.api.calls.some(([name]) => name === 'ask'));
    } finally {
        page.close();
    }
});

test('an unsent question shows Not sent with a Retry that asks again', async () => {
    let attempts = 0;
    const page = await openAsk({
        api: {
            askInConversation: async (id, { question }) => {
                attempts += 1;
                if (attempts === 1) throw failure('network');
                return {
                    user_message: { id: 'u1', role: 'user', content: question, status: 'complete' },
                    assistant_message: { id: 'a1', role: 'assistant', content: 'Recovered.', status: 'complete', citations: [] },
                    conversation: { id, title: question, minhag: 'All' },
                };
            },
        },
    });
    try {
        await page.ask('Will it send?');
        assert.match(turns(page)[0].textContent, /Not sent\./);
        assert.equal(page.hidden('#convNotice'), false);
        page.click(page.$('.conv-turn__retry'));
        await page.flush();
        assert.equal(attempts, 2);
        assert.match(page.text('#convMessages'), /Recovered\./);
    } finally {
        page.close();
    }
});

test('an answer the server could not produce shows a Retry on the last turn only', async () => {
    const page = await openAsk({
        api: {
            askInConversation: async (id, { question }) => ({
                user_message: { id: 'u1', role: 'user', content: question, status: 'complete' },
                assistant_message: { id: 'a1', role: 'assistant', content: '', status: 'error', citations: [] },
                conversation: { id, title: question, minhag: 'All' },
            }),
        },
    });
    try {
        await page.ask('Hard question');
        assert.match(turns(page)[1].textContent, /couldn't answer this one/);
        assert.ok(turns(page)[1].querySelector('[data-turn-action="retry"]'));
    } finally {
        page.close();
    }
});

test('a slow answer can be checked again', async () => {
    let checks = 0;
    const page = await openAsk({
        api: {
            askInConversation: async (id, { question }) => {
                throw Object.assign(new Error('slow'), {
                    code: 'answer_incomplete',
                    userMessage: { id: 'u1', role: 'user', content: question, status: 'complete' },
                });
            },
            getConversation: async (id) => {
                checks += 1;
                return {
                    id,
                    title: 'Take your time',
                    minhag: 'All',
                    messages: [
                        { id: 'u1', role: 'user', content: 'Take your time', status: 'complete' },
                        { id: 'a1', role: 'assistant', content: 'Here it is.', status: 'complete', citations: [] },
                    ],
                };
            },
        },
    });
    try {
        await page.ask('Take your time');
        const check = page.$('[data-turn-action="check"]');
        assert.ok(check, 'an unfinished answer offers Check again');
        page.click(check);
        await page.flush();
        assert.equal(checks, 1);
        assert.match(page.text('#convMessages'), /Here it is\./);
        assert.equal(page.$('[data-turn-action="check"]'), null);
    } finally {
        page.close();
    }
});

test('while an answer is pending the minimised bar names the step', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const page = await openAsk({
        api: {
            askInConversation: async (id, { question }, hooks) => {
                hooks?.onProgress?.({ type: 'status', stage: 'searching' });
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
        const sending = page.ask('Slow one');
        await page.flush();
        assert.equal(panel(page).dataset.sending, 'true');
        assert.ok(page.$('[data-conv-status]'));
        assert.equal(page.$('#convSendBtn').disabled, true);
        await page.tick(800);
        release();
        await sending;
        await page.flush();
        assert.equal(panel(page).dataset.sending, 'false');
        assert.match(page.text('#convMessages'), /Done\./);
    } finally {
        page.close();
    }
});

test('a suggested question fills the box without sending it', async () => {
    const page = await openAsk();
    try {
        const suggestion = page.document.createElement('button');
        suggestion.dataset.convSuggest = '';
        suggestion.textContent = '  What is the blessing for bread?  ';
        panel(page).appendChild(suggestion);
        page.click(suggestion);
        assert.equal(page.$('#convInput').value, 'What is the blessing for bread?');
        assert.equal(page.api.calls.filter(([name]) => name === 'ask').length, 0);
    } finally {
        page.close();
    }
});

test('the jump button appears when the newest question is off screen', async () => {
    const page = await openAsk();
    try {
        await page.ask('First');
        const scroller = page.$('#convScroller');
        Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 2000 });
        Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 400 });
        // The newest question sits well below the top of the visible area.
        for (const question of page.$$('#convMessages .conv-turn--user')) {
            question.getBoundingClientRect = () => ({ top: 1000, bottom: 1040, left: 0, right: 0, width: 0, height: 40 });
        }
        scroller.scrollTop = 0;
        scroller.dispatchEvent(new page.window.Event('scroll'));
        assert.equal(page.hidden('#convJumpBtn'), false);
        page.click('#convJumpBtn');
        assert.ok(scroller.scrolledTo);
        assert.equal(scroller.scrolledTo[0].behavior, 'smooth');
    } finally {
        page.close();
    }
});

test('a new conversation opens at the top of its empty state, even on a short screen', async () => {
    const page = await openConversationPage({
        signedIn: true,
        before: (window) => {
            const scroller = window.document.getElementById('convScroller');
            Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 600 });
            Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 400 });
        },
    });
    try {
        await page.ui.open({ fresh: true });
        await page.flush();
        await page.tick(50);
        const scroller = page.$('#convScroller');
        assert.ok(scroller.scrolledTo, 'the thread was positioned on open');
        assert.equal(scroller.scrolledTo[0].top, 0);
    } finally {
        page.close();
    }
});

// --- history list -----------------------------------------------------------

test('the history list groups conversations by day and opens one', async () => {
    const page = await openConversationPage({
        signedIn: true,
        api: { listConversations: async () => LIST, getConversation: async (id) => ({ id, title: 'Shabbat candles', minhag: 'Sefardic', messages: [] }) },
    });
    try {
        const trigger = page.$('.conv-history-trigger');
        assert.ok(trigger, 'a history trigger exists');
        page.click(trigger);
        await page.flush();
        assert.equal(page.hidden('#convHistoryPop'), false);
        assert.equal(trigger.getAttribute('aria-expanded'), 'true');
        const items = page.$$('#convHistoryPop .conv-list__item');
        assert.equal(items.length, 3);
        // Pinned conversations come first.
        assert.match(items[0].textContent, /Pinned question/);
        assert.match(items[1].textContent, /Shabbat candles/);
        assert.match(page.$('#convHistoryPop').textContent, /Untitled conversation/);
        assert.ok(page.$$('#convHistoryPop .conv-list__group').length >= 2);
        assert.match(page.$('#convHistoryPop').innerHTML, /Pinned/);

        // A second press on the same trigger closes it.
        page.click(trigger);
        await page.flush();
        assert.equal(page.hidden('#convHistoryPop'), true);

        page.click(trigger);
        await page.flush();
        page.click(page.$('#convHistoryPop [data-conv-open="c1"]'));
        await page.flush();
        assert.equal(page.hidden('#convPanel'), false);
        assert.equal(page.store.getState().conversation.id, 'c1');
        assert.equal(page.hidden('#convHistoryPop'), true);
        assert.match(route(page), /^\/chat\/c1/);
    } finally {
        page.close();
    }
});

test('the history list says when it is empty, failed, or the visitor is signed out', async () => {
    const page = await openConversationPage({ signedIn: true, api: { listConversations: async () => [] } });
    try {
        page.ui.openHistory(page.$('.conv-history-trigger'));
        await page.flush();
        assert.match(page.text('#convHistoryPop'), /No conversations yet/);
    } finally {
        page.close();
    }
    let fail = true;
    const broken = await openConversationPage({
        signedIn: true,
        api: { listConversations: async () => { if (fail) throw failure('network'); return LIST; } },
    });
    try {
        await broken.flush();
        broken.ui.openHistory(broken.$('.conv-history-trigger'));
        await broken.flush();
        assert.match(broken.text('#convHistoryPop'), /Couldn't load conversations/);
        fail = false;
        broken.click(broken.$('[data-conv-action="reload-list"]'));
        await broken.flush();
        assert.equal(broken.$$('#convHistoryPop .conv-list__item').length, 3);
    } finally {
        broken.close();
    }
    const out = await openConversationPage({ clerk: true });
    try {
        out.ui.openHistory(out.$('.conv-history-trigger'));
        await out.flush();
        assert.equal(out.$$('#convHistoryPop .conv-list__item').length, 0);
        assert.equal(out.$('#convHistoryPop .conv-pop__signed-out').classList.contains('hidden'), false);
        let signIns = 0;
        out.window.handleSignIn = () => { signIns += 1; };
        const signIn = out.document.createElement('button');
        signIn.dataset.convAction = 'sign-in';
        out.$('#convHistoryPop').appendChild(signIn);
        out.click(signIn);
        assert.equal(signIns, 1);
        assert.equal(out.hidden('#convHistoryPop'), true);
    } finally {
        out.close();
    }
});

test('a click outside, or Escape, closes the history popover', async () => {
    const page = await openConversationPage({ signedIn: true, api: { listConversations: async () => LIST } });
    try {
        const trigger = page.$('.conv-history-trigger');
        page.click(trigger);
        await page.flush();
        page.click(page.document.body);
        await page.flush();
        assert.equal(page.hidden('#convHistoryPop'), true);

        page.click(trigger);
        await page.flush();
        assert.equal(page.key('Escape').defaultPrevented, true);
        assert.equal(page.hidden('#convHistoryPop'), true);
        assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    } finally {
        page.close();
    }
});

test('a new conversation from the popover starts a fresh draft', async () => {
    const page = await openAsk({ api: { listConversations: async () => LIST } });
    try {
        await page.ask('First thread');
        const newChat = page.document.createElement('button');
        newChat.dataset.convAction = 'new';
        page.$('#convHistoryPop').appendChild(newChat);
        page.document.body.classList.add('mobile-search-open');
        let collapsed = 0;
        page.window.setMobileSearchExpanded = () => { collapsed += 1; };
        page.click(newChat);
        await page.flush();
        assert.equal(page.store.getState().conversation, null);
        assert.equal(turns(page).length, 0);
        assert.equal(page.store.getState().draftMinhag, 'All');
        // The phone's search bar folds away so the fresh panel is not under it.
        assert.equal(collapsed, 1);
    } finally {
        page.close();
    }
});

// --- the settings menu ------------------------------------------------------

test('the settings menu changes the mode and community and remembers both as the defaults', async () => {
    const page = await openAsk();
    try {
        const saved = [];
        page.window.ShelahPrefs = { set: (key, value) => saved.push([key, value]) };
        page.click('#convMenuBtn');
        await page.flush();
        assert.equal(page.hidden('#convMenu'), false);
        assert.equal(page.$('#convMenuBtn').getAttribute('aria-expanded'), 'true');
        assert.ok(page.$('#convMinhagSelect').options.length > 3);

        const deep = page.$('[data-conv-mode="sources"]');
        assert.ok(deep, 'a Deep mode button exists');
        page.click(deep);
        assert.equal(deep.getAttribute('aria-checked'), 'true');

        const select = page.$('#convMinhagSelect');
        select.value = 'Ashkenaz';
        select.dispatchEvent(new page.window.Event('change', { bubbles: true }));
        assert.equal(page.store.getState().draftMinhag, 'Ashkenaz');
        assert.deepEqual(saved, [['mode', 'sources'], ['community', 'Ashkenaz']]);

        // A second press, a click outside, or Escape all close it.
        page.click('#convMenuBtn');
        assert.equal(page.hidden('#convMenu'), true);
        page.click('#convMenuBtn');
        page.click(page.document.body);
        await page.flush();
        assert.equal(page.hidden('#convMenu'), true);
        page.click('#convMenuBtn');
        assert.equal(page.key('Escape').defaultPrevented, true);
        assert.equal(page.hidden('#convMenu'), true);
    } finally {
        page.close();
    }
});

test('the Web search switch shows On or Off, flips the saved setting and is reachable by keyboard', async () => {
    const page = await openAsk();
    try {
        const saved = [];
        page.window.appState.prefs = { ...(page.window.appState.prefs || {}) };
        page.window.ShelahPrefs = {
            set: (key, value) => {
                saved.push([key, value]);
                page.window.appState.prefs[key] = value;
            },
        };
        page.click('#convMenuBtn');
        await page.flush();
        const sw = page.$('#convWebSearchSwitch');
        assert.ok(sw, 'the switch exists');
        assert.equal(sw.getAttribute('role'), 'switch');
        assert.equal(sw.getAttribute('aria-checked'), 'true', 'on by default');
        assert.equal(page.$('#convWebSearchState').textContent, 'On');

        page.click(sw);
        await page.flush();
        assert.deepEqual(saved, [['webSearch', false]]);
        assert.equal(page.$('#convWebSearchSwitch').getAttribute('aria-checked'), 'false');
        assert.equal(page.$('#convWebSearchState').textContent, 'Off');

        page.click(page.$('#convWebSearchSwitch'));
        await page.flush();
        assert.deepEqual(saved.at(-1), ['webSearch', true]);
        assert.equal(page.$('#convWebSearchState').textContent, 'On');
    } finally {
        page.close();
    }
});

test('Quick Settings\' AI settings opens the panel and then its menu', async () => {
    const page = await openConversationPage({ signedIn: true });
    try {
        await page.ui.openSettings(page.$('#topbarAskBtn'));
        await page.tick(1);
        assert.equal(page.hidden('#convPanel'), false);
        assert.equal(page.hidden('#convMenu'), false);
        // Already open at a normal size: it keeps that size.
        page.ui.close();
        await page.flush();
        await page.ui.open({ size: 'full' });
        await page.ui.openSettings();
        await page.tick(1);
        assert.equal(panel(page).dataset.size, 'full');
    } finally {
        page.close();
    }
});

test('Rename edits the title in place: Enter saves, Escape and an empty name do not', async () => {
    const page = await openAsk();
    try {
        await page.ask('Original title');
        const rename = (current, finish) => {
            const action = page.document.createElement('button');
            action.dataset.convAction = 'rename';
            page.$('#convMenu').appendChild(action);
            page.click(action);
            const input = page.$('#convTitle input');
            assert.ok(input, 'the title became an input');
            assert.equal(input.value, current);
            finish(input);
        };

        rename('Original title', (input) => {
            input.value = 'Better title';
            page.key('Enter', {}, input);
        });
        await page.flush();
        assert.deepEqual(page.api.calls.filter(([name]) => name === 'rename').map(([, id, title]) => [id, title]), [['c1', 'Better title']]);
        assert.equal(page.$('#convTitle input'), null);

        rename('Better title', (input) => {
            input.value = 'Thrown away';
            const escape = page.key('Escape', {}, input);
            assert.equal(escape.defaultPrevented, true);
        });
        rename('Better title', (input) => {
            input.value = '   ';
            input.dispatchEvent(new page.window.Event('blur'));
        });
        await page.flush();
        assert.equal(page.api.calls.filter(([name]) => name === 'rename').length, 1);

        // A second Rename while editing is ignored.
        const again = page.document.createElement('button');
        again.dataset.convAction = 'rename';
        page.$('#convMenu').appendChild(again);
        page.click(again);
        page.click(again);
        assert.equal(page.$$('#convTitle input').length, 1);
    } finally {
        page.close();
    }
});

test('Pin and Unpin toggle the conversation\'s pin and the menu\'s label', async () => {
    const page = await openAsk();
    try {
        await page.ask('Pin me');
        assert.equal(page.text('#convPinLabel'), 'Pin');
        const pin = page.document.createElement('button');
        pin.dataset.convAction = 'pin';
        page.$('#convMenu').appendChild(pin);
        page.click(pin);
        await page.flush();
        assert.deepEqual(page.api.calls.filter(([name]) => name === 'pin').map(([, id, pinned]) => [id, pinned]), [['c1', true]]);
        assert.equal(page.text('#convPinLabel'), 'Unpin');
        page.click(pin);
        await page.flush();
        assert.equal(page.text('#convPinLabel'), 'Pin');
    } finally {
        page.close();
    }
});

test('Delete removes the conversation, offers Undo, and the toast leaves on its own', async () => {
    const page = await openAsk({ api: { listConversations: async () => LIST } });
    try {
        await page.ask('Delete me');
        const del = page.document.createElement('button');
        del.dataset.convAction = 'delete';
        page.$('#convMenu').appendChild(del);
        page.click(del);
        await page.flush();
        assert.ok(page.api.calls.some(([name]) => name === 'delete'));
        assert.equal(page.hidden('#convToast'), false);
        assert.match(page.text('#convToastText'), /Conversation deleted/);
        assert.equal(page.$('#convToastAction').dataset.action, 'undo');

        page.click('#convToastAction');
        await page.flush();
        assert.ok(page.api.calls.some(([name]) => name === 'restore'));
        assert.equal(page.hidden('#convToast'), true);

        // Deleting again, then waiting past the toast's lifetime.
        page.click(del);
        await page.flush();
        assert.equal(page.hidden('#convToast'), false);
        await page.tick(8100);
        assert.equal(page.hidden('#convToast'), true);

        // With nothing open there is nothing to delete.
        const before = page.api.calls.length;
        page.click(del);
        await page.flush();
        assert.equal(page.api.calls.length, before);
    } finally {
        page.close();
    }
});

test('a toast waits while it is being read and closes on its X', async () => {
    const page = await openAsk();
    try {
        await page.ask('Delete me too');
        const del = page.document.createElement('button');
        del.dataset.convAction = 'delete';
        page.$('#convMenu').appendChild(del);
        page.click(del);
        await page.flush();
        const toast = page.$('#convToast');
        toast.dispatchEvent(new page.window.Event('pointerenter'));
        await page.tick(20000);
        assert.equal(page.hidden('#convToast'), false);
        toast.dispatchEvent(new page.window.Event('pointerleave'));
        await page.tick(8100);
        assert.equal(page.hidden('#convToast'), true);

        page.ui.getStore().startNew({ minhag: 'All' });
        await page.ask('Another');
        page.click(del);
        await page.flush();
        page.click('#convToastClose');
        await page.flush();
        assert.equal(page.hidden('#convToast'), true);
    } finally {
        page.close();
    }
});

// --- sharing ----------------------------------------------------------------

function shareRoutes(state = { shared: false }) {
    return {
        '/api/conversations/c1/share': (_url, init) => {
            if (init.method === 'POST') {
                state.shared = true;
                return { shared: true, share_token: SHARE_TOKEN };
            }
            if (init.method === 'DELETE') {
                state.shared = false;
                return { shared: false };
            }
            return state.shared ? { shared: true, share_token: SHARE_TOKEN } : { shared: false };
        },
    };
}

async function withClipboard(page, writeText, run) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText } } });
    try {
        return await run();
    } finally {
        if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
        else delete globalThis.navigator;
    }
}

test('Share copies a public link, then the header asks before copying again or stopping', async () => {
    const copied = [];
    const page = await openAsk({ fetch: shareRoutes() });
    try {
        await page.ask('Share this');
        await withClipboard(page, async (text) => { copied.push(text); }, async () => {
            page.click('#convShareBtn');
            await page.flush();
        });
        assert.equal(copied.length, 1);
        assert.match(copied[0], new RegExp(`/a/${SHARE_TOKEN}$`));
        assert.match(page.text('#convToastText'), /Public link copied/);
        assert.equal(panel(page).dataset.shared, 'true');
        assert.equal(page.$('#convShareBtn').dataset.shared, 'true');

        // Shared: the header button now opens a small card.
        page.click('#convShareBtn');
        await page.flush();
        assert.equal(page.hidden('#convSharePop'), false);
        assert.equal(page.$('#convShareBtn').getAttribute('aria-expanded'), 'true');
        page.click('#convShareBtn');
        await page.flush();
        assert.equal(page.hidden('#convSharePop'), true);

        page.click('#convShareBtn');
        await page.flush();
        assert.equal(page.key('Escape').defaultPrevented, true);
        assert.equal(page.hidden('#convSharePop'), true);

        page.click('#convShareBtn');
        await page.flush();
        page.click(page.document.body);
        await page.flush();
        assert.equal(page.hidden('#convSharePop'), true);

        const action = (name) => {
            const button = page.document.createElement('button');
            button.dataset.convAction = name;
            page.$('#convSharePop').appendChild(button);
            return button;
        };
        page.click('#convShareBtn');
        await page.flush();
        await withClipboard(page, async (text) => { copied.push(text); }, async () => {
            page.click(action('share-copy'));
            await page.flush();
        });
        assert.equal(copied.length, 2);

        page.click('#convShareBtn');
        await page.flush();
        page.click(action('share-stop'));
        await page.flush();
        assert.match(page.text('#convToastText'), /Sharing stopped/);
        assert.equal(panel(page).dataset.shared, 'false');
    } finally {
        page.close();
    }
});

test('Share falls back to showing the link when the clipboard refuses, and reports the other outcomes', async () => {
    const page = await openAsk({ fetch: shareRoutes() });
    try {
        await page.ask('Share this too');
        page.click('#convShareBtn');
        await page.flush();
        assert.match(page.text('#convToastText'), /Copy this link:.*\/a\//);
        assert.equal(page.$('#convToastAction').dataset.action, 'stop-share');

        // The toast's Stop sharing revokes the link.
        page.click('#convToastAction');
        await page.flush();
        assert.match(page.text('#convToastText'), /Sharing stopped/);
    } finally {
        page.close();
    }
    const empty = await openAsk({
        fetch: { '/api/conversations/c1/share': (_url, init) => (init.method === 'POST' ? { status: 409, body: { code: 'empty_conversation' } } : { shared: false }) },
    });
    try {
        await empty.ask('Nothing yet');
        empty.click('#convShareBtn');
        await empty.flush();
        assert.match(empty.text('#convToastText'), /nothing to share yet/);
    } finally {
        empty.close();
    }
    const down = await openAsk({
        fetch: { '/api/conversations/c1/share': (_url, init) => (init.method === 'GET' ? { shared: false } : { status: 500, body: {} }) },
    });
    try {
        await down.ask('Server down');
        down.click('#convShareBtn');
        await down.flush();
        assert.match(down.text('#convToastText'), /Couldn't create a link/);
        const stop = down.document.createElement('button');
        stop.dataset.convAction = 'stop-share';
        down.$('#convMenu').appendChild(stop);
        down.click(stop);
        await down.flush();
        assert.match(down.text('#convToastText'), /Couldn't stop sharing/);
    } finally {
        down.close();
    }
});

test('with no conversation yet there is nothing to share or stop', async () => {
    const page = await openAsk({ fetch: shareRoutes() });
    try {
        const share = page.document.createElement('button');
        share.dataset.convAction = 'share';
        page.$('#convMenu').appendChild(share);
        page.click(share);
        const stop = page.document.createElement('button');
        stop.dataset.convAction = 'stop-share';
        page.$('#convMenu').appendChild(stop);
        page.click(stop);
        await page.flush();
        assert.equal(page.calls.filter((c) => c.url.includes('/share')).length, 0);
    } finally {
        page.close();
    }
});

// --- the discovery tip -------------------------------------------------------

test('the discovery tip appears once the page is calm, and Dismiss keeps it away for good', async () => {
    const page = await openConversationPage();
    try {
        const ask = page.$('#topbarAskBtn');
        assert.equal(page.hidden('#aiDiscoveryTip'), true);
        await page.tick(1700);
        assert.equal(page.hidden('#aiDiscoveryTip'), false);
        assert.ok(ask.classList.contains('ai-attention'));
        assert.equal(page.$('#aiDiscoveryTip').dataset.placement, 'below');

        page.click('#aiDiscoveryTipDismiss');
        await page.flush();
        assert.equal(page.hidden('#aiDiscoveryTip'), true);
        assert.equal(ask.classList.contains('ai-attention'), false);
        assert.equal(page.window.localStorage.getItem('shelah.ai.tipDismissed'), '1');
    } finally {
        page.close();
    }
});

test('Try it opens the mini widget; Escape inside the tip dismisses it', async () => {
    const page = await openConversationPage();
    try {
        await page.tick(1700);
        page.click('#aiDiscoveryTipTry');
        await page.flush();
        assert.equal(panel(page).dataset.size, 'mini');
        assert.equal(page.hidden('#aiDiscoveryTip'), true);
        assert.equal(page.window.localStorage.getItem('shelah.ai.used'), '1');
    } finally {
        page.close();
    }
    const other = await openConversationPage();
    try {
        await other.tick(1700);
        const tip = other.$('#aiDiscoveryTip');
        other.key('Escape', {}, tip);
        await other.flush();
        assert.equal(other.hidden('#aiDiscoveryTip'), true);
        assert.equal(other.window.localStorage.getItem('shelah.ai.tipDismissed'), '1');
    } finally {
        other.close();
    }
});

test('the tip never shows for someone who has used the AI or dismissed it', async () => {
    for (const key of ['shelah.ai.used', 'shelah.ai.tipDismissed']) {
        const page = await openConversationPage({ storage: { [key]: '1' } });
        try {
            await page.tick(5000);
            assert.equal(page.hidden('#aiDiscoveryTip'), true, key);
        } finally {
            page.close();
        }
    }
});

test('the tip steps aside for an open menu and returns when it closes', async () => {
    const page = await openConversationPage();
    try {
        const menu = page.document.getElementById('settingsPanel');
        await page.tick(1700);
        assert.equal(page.hidden('#aiDiscoveryTip'), false);

        menu.classList.remove('hidden');
        await page.flush();
        assert.equal(page.hidden('#aiDiscoveryTip'), true, 'hides while a menu opens');
        assert.equal(page.$('#topbarAskBtn').classList.contains('ai-attention'), false);

        // A menu that is leaving counts as closed.
        menu.classList.add('is-hiding');
        menu.classList.add('hidden');
        await page.flush();
        menu.classList.remove('is-hiding');
        await page.tick(1700);
        assert.equal(page.hidden('#aiDiscoveryTip'), false);
        // The bar changing size re-seats it.
        for (const observer of page.observers) observer.callback([]);
    } finally {
        page.close();
    }
});

test('a menu that is open when the tip is due holds it back until the menu closes, and an open search keeps it away', async () => {
    const page = await openConversationPage();
    try {
        const menu = page.document.getElementById('userProfileMenu');
        menu.classList.remove('hidden');
        await page.tick(1700);
        assert.equal(page.hidden('#aiDiscoveryTip'), true);
        // Not for good: closing the menu brings the tip that was due back.
        menu.classList.add('hidden');
        await page.flush();
        await page.tick(1700);
        assert.equal(page.hidden('#aiDiscoveryTip'), false);
    } finally {
        page.close();
    }
    const search = await openConversationPage();
    try {
        search.document.body.classList.add('mobile-search-open');
        await search.tick(1700);
        assert.equal(search.hidden('#aiDiscoveryTip'), true);
    } finally {
        search.close();
    }
});

test('on a phone the tip points at the phone Ask button, and opening the AI clears it', async () => {
    const page = await openConversationPage({ mobile: true });
    try {
        await page.tick(1700);
        const phone = page.$('#mobileTopbarAskBtn');
        assert.equal(page.hidden('#aiDiscoveryTip'), false);
        assert.ok(phone.classList.contains('ai-attention'));
        page.click('#aiDiscoveryTipTry');
        await page.flush();
        assert.equal(panel(page).dataset.layout, 'mobile');
        assert.equal(panel(page).dataset.size, 'overlay');
        assert.equal(page.hidden('#aiDiscoveryTip'), true);
    } finally {
        page.close();
    }
});

// --- keyboard ----------------------------------------------------------------

test('Tab stays inside a modal panel, wrapping from the last control to the first', async () => {
    const page = await openAsk();
    try {
        await page.ui.setSize('overlay');
        await page.flush();
        const items = [...panel(page).querySelectorAll('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
            .filter((el) => el.offsetParent !== null);
        assert.ok(items.length > 2);
        const first = items[0];
        const last = items[items.length - 1];

        last.focus();
        assert.equal(page.key('Tab').defaultPrevented, true);
        assert.equal(page.document.activeElement, first);

        first.focus();
        assert.equal(page.key('Tab', { shiftKey: true }).defaultPrevented, true);
        assert.equal(page.document.activeElement, last);

        // Focus outside the panel is pulled in.
        page.document.body.focus();
        page.$('#topbarAskBtn').focus();
        assert.equal(page.key('Tab').defaultPrevented, true);
        assert.equal(page.document.activeElement, first);

        // In the middle, Tab is the browser's own.
        items[1].focus();
        assert.equal(page.key('Tab').defaultPrevented, false);

        // A mini widget is not a modal: Tab is left alone.
        page.ui.setSize('mini');
        await page.flush();
        assert.equal(page.key('Tab').defaultPrevented, false);
    } finally {
        page.close();
    }
});

// --- language and theme -----------------------------------------------------

test('switching the page to Hebrew relabels the panel and the controls', async () => {
    const page = await openAsk();
    try {
        assert.match(page.$('#convInput').placeholder, /Ask a question/);
        page.document.documentElement.lang = 'he';
        page.document.documentElement.dir = 'rtl';
        await page.flush();
        assert.match(page.$('#convInput').placeholder, /שאל שאלה/);
        assert.match(page.text('#convTitle'), /שאל את ש׳אלה/);
        const labelled = page.$('[data-aria-he]');
        assert.ok(labelled, 'the page marks its Hebrew labels');
        assert.equal(labelled.getAttribute('aria-label'), labelled.dataset.ariaHe);
        assert.equal(page.window.ShelahConversationUI.aiRoute().mode, 'balanced');
    } finally {
        page.close();
    }
});

test('the theme button flips the page theme and names where it goes', async () => {
    const page = await openAsk();
    try {
        const html = page.document.documentElement;
        const themes = [];
        page.window.setThemePreference = (value) => {
            themes.push(value);
            html.setAttribute('data-theme', value);
        };
        html.setAttribute('data-theme', 'light');
        await page.flush();
        assert.match(page.$('#convThemeBtn').getAttribute('aria-label'), /dark/);
        page.click('#convThemeBtn');
        await page.flush();
        assert.deepEqual(themes, ['dark']);
        assert.match(page.$('#convThemeBtn').getAttribute('aria-label'), /light/);
        page.click('#convThemeBtn');
        await page.flush();
        assert.deepEqual(themes, ['dark', 'light']);

        // Without the page's own theme switch the button does nothing.
        delete page.window.setThemePreference;
        page.click('#convThemeBtn');
        assert.deepEqual(themes, ['dark', 'light']);
    } finally {
        page.close();
    }
});

// --- the phone ---------------------------------------------------------------

/** On a phone "minimised" is the bar, not the panel: the panel itself keeps its last size. */
function minimised(page) {
    return page.hidden('#convPanel') && !page.hidden('#convPip');
}

test('on a phone the panel is a bottom sheet; swiping it down minimises it to the bar', async () => {
    const page = await openConversationPage({ mobile: true, signedIn: true });
    try {
        page.click('#mobileTopbarAskBtn');
        await page.flush();
        assert.equal(panel(page).dataset.layout, 'mobile');
        assert.equal(panel(page).dataset.size, 'overlay');
        assert.match(page.text('#convSubtitle'), /practice$/);

        const grabber = page.$('.conv-grabber');
        // A short, slow drag springs back.
        page.pointer(grabber, 'pointerdown', { clientY: 100 });
        page.pointer(grabber, 'pointermove', { clientY: 130 });
        assert.match(panel(page).style.transform, /translateY\(30px\)/);
        page.clock.tick(300);
        page.pointer(grabber, 'pointerup', { clientY: 130 });
        assert.equal(minimised(page), false);
        assert.equal(panel(page).style.transform, '');

        // An upward drag is resisted, not followed 1:1.
        page.pointer(grabber, 'pointerdown', { clientY: 400 });
        page.pointer(grabber, 'pointermove', { clientY: 100 });
        const resisted = Number(/translateY\((-?[\d.]+)px\)/.exec(panel(page).style.transform)[1]);
        assert.ok(resisted < 0 && resisted > -300);
        page.pointer(grabber, 'pointercancel', { clientY: 100 });
        assert.equal(minimised(page), false);

        // A long drag minimises to the bar.
        page.pointer(grabber, 'pointerdown', { clientY: 100 });
        page.pointer(grabber, 'pointermove', { clientY: 400 });
        page.clock.tick(600);
        page.pointer(grabber, 'pointerup', { clientY: 400 });
        await page.flush();
        assert.equal(minimised(page), true);

        // The bar reopens the sheet; the phone Ask button closes it.
        page.click('#convPipOpen');
        await page.flush();
        assert.equal(minimised(page), false);
        assert.equal(page.hidden('#convPanel'), false);
        page.click('#mobileTopbarAskBtn');
        await page.flush();
        assert.equal(page.hidden('#convPanel'), true);
        assert.equal(page.hidden('#convPip'), true);

        // A press on a button inside the header does not start a swipe.
        page.click('#mobileTopbarAskBtn');
        await page.flush();
        const button = page.$('.conv-header button');
        page.pointer(button, 'pointerdown', { clientY: 100 });
        page.pointer(button, 'pointermove', { clientY: 400 });
        assert.equal(panel(page).style.transform, '');
    } finally {
        page.close();
    }
});

test('a fast flick minimises the sheet even when it is short', async () => {
    const page = await openConversationPage({ mobile: true, signedIn: true });
    try {
        page.click('#mobileTopbarAskBtn');
        await page.flush();
        const header = page.$('.conv-header');
        page.pointer(header, 'pointerdown', { clientY: 100 });
        page.pointer(header, 'pointermove', { clientY: 160 });
        page.clock.tick(10);
        page.pointer(header, 'pointerup', { clientY: 160 });
        await page.flush();
        assert.equal(minimised(page), true);
        assert.equal(panel(page).style.transform, '');
        // A move from another pointer is ignored.
        page.click('#convPipOpen');
        await page.flush();
        page.pointer(header, 'pointerdown', { clientY: 100 });
        page.pointer(header, 'pointermove', { clientY: 300, pointerId: 9 });
        assert.equal(panel(page).style.transform, '');
        page.pointer(header, 'pointerup', { clientY: 300, pointerId: 9 });
    } finally {
        page.close();
    }
});

test('crossing the phone breakpoint re-seats an open panel', async () => {
    const page = await openAsk();
    try {
        assert.equal(panel(page).dataset.layout, 'desktop');
        page.media.set('(max-width: 1023px)', true);
        await page.flush();
        assert.equal(panel(page).dataset.layout, 'mobile');
        assert.equal(page.hidden('#convPanel'), false);

        page.ui.setSize('mini');
        await page.flush();
        assert.equal(page.hidden('#convPip'), false);
        page.media.set('(max-width: 1023px)', false);
        await page.flush();
        assert.equal(panel(page).dataset.layout, 'desktop');
        assert.equal(page.hidden('#convPip'), true);

        // A closed panel just takes the new layout.
        page.ui.close();
        await page.flush();
        page.media.set('(max-width: 1023px)', true);
        await page.flush();
        assert.equal(panel(page).dataset.layout, 'mobile');
    } finally {
        page.close();
    }
});

test('the phone search tray rises with phone search and asks the typed question', async () => {
    const page = await openConversationPage({ mobile: true, signedIn: true });
    try {
        const input = page.$('#searchInput');
        let collapsed = 0;
        let suggestions = 0;
        page.window.setMobileSearchExpanded = () => { collapsed += 1; };
        page.window.hideSearchSuggestions = () => { suggestions += 1; };

        page.document.body.classList.add('mobile-search-open');
        await page.flush();
        assert.equal(page.hidden('#mobileSearchTray'), false);

        input.value = '  What about leap years?  ';
        page.click('#mobileTrayAskBtn');
        await page.flush();
        assert.equal(input.value, '');
        assert.equal(collapsed, 1);
        assert.equal(suggestions, 1);
        assert.deepEqual(page.api.calls.filter(([name]) => name === 'ask').map(([, , options]) => options.question), ['What about leap years?']);

        page.document.body.classList.remove('mobile-search-open');
        await page.flush();
        assert.equal(page.hidden('#mobileSearchTray'), true);
    } finally {
        page.close();
    }
});

test('the tray\'s history button opens the popover and closing the tray closes it', async () => {
    const page = await openConversationPage({ mobile: true, signedIn: true, api: { listConversations: async () => LIST } });
    try {
        page.document.body.classList.add('mobile-search-open');
        await page.flush();
        page.click('#mobileTrayHistoryBtn');
        await page.flush();
        assert.equal(page.hidden('#convHistoryPop'), false);
        page.document.body.classList.remove('mobile-search-open');
        await page.flush();
        assert.equal(page.hidden('#mobileSearchTray'), true);
        assert.equal(page.hidden('#convHistoryPop'), true);
    } finally {
        page.close();
    }
});

// --- the mini widget -----------------------------------------------------------

test('the mini widget is dragged by its header and snaps to the nearest corner', async () => {
    const page = await openConversationPage();
    try {
        page.ui.open({ size: 'mini' });
        await page.flush();
        const header = page.$('.conv-header');
        assert.equal(page.window.innerWidth, 1024);

        page.pointer(header, 'pointerdown', { clientX: 900, clientY: 700 });
        assert.ok(panel(page).classList.contains('is-dragging'));
        page.pointer(header, 'pointermove', { clientX: 100, clientY: 80 });
        assert.match(panel(page).style.transform, /translate\(-800px, -620px\)/);
        page.pointer(header, 'pointerup', { clientX: 100, clientY: 80 });
        assert.equal(panel(page).classList.contains('is-dragging'), false);
        assert.equal(page.window.localStorage.getItem('shelah.conv.corner'), 'tl');
        assert.equal(panel(page).dataset.corner, 'tl');

        // A click that barely moves leaves no transform behind.
        page.pointer(header, 'pointerdown', { clientX: 10, clientY: 10 });
        page.pointer(header, 'pointerup', { clientX: 11, clientY: 11 });
        assert.equal(panel(page).style.transform, '');

        // A press on a button inside the header, or a right click, is not a drag.
        page.pointer(page.$('#convMenuBtn'), 'pointerdown');
        assert.equal(panel(page).classList.contains('is-dragging'), false);
        page.pointer(header, 'pointerdown', { button: 2 });
        assert.equal(panel(page).classList.contains('is-dragging'), false);
        page.pointer(header, 'pointercancel');
    } finally {
        page.close();
    }
});

test('in a right-to-left page the stored corner is logical, so it stays on the end side', async () => {
    const page = await openConversationPage({ lang: 'he', storage: { 'shelah.conv.corner': 'bl' } });
    try {
        page.ui.open({ size: 'mini' });
        await page.flush();
        assert.equal(panel(page).dataset.corner, 'br');
        // jsdom has no layout: put the panel in the page's bottom-right corner.
        panel(page).getBoundingClientRect = () => ({ left: 600, top: 400, width: 400, height: 300, right: 1000, bottom: 700 });
        const header = page.$('.conv-header');
        page.pointer(header, 'pointerdown', { clientX: 100, clientY: 700 });
        page.pointer(header, 'pointerup', { clientX: 100, clientY: 700 });
        // Physically bottom-right is the start side of a right-to-left page.
        assert.equal(page.window.localStorage.getItem('shelah.conv.corner'), 'bl');
    } finally {
        page.close();
    }
});

test('blocked storage never breaks the panel', async () => {
    const page = await openConversationPage({
        before(window) {
            const refuse = () => { throw new Error('blocked'); };
            Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: refuse, setItem: refuse, removeItem: refuse } });
        },
    });
    try {
        page.ui.open({ size: 'mini' });
        await page.flush();
        assert.equal(panel(page).dataset.corner, 'br');
        await page.tick(1700);
        page.click('#aiDiscoveryTipDismiss');
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

// --- dictation ----------------------------------------------------------------

class FakeRecognition {
    constructor() { FakeRecognition.instance = this; this.started = 0; this.stopped = 0; }
    start() { this.started += 1; this.onstart?.(); }
    stop() { this.stopped += 1; this.onend?.(); }
    abort() { this.stopped += 1; this.onend?.(); }
}

test('the microphone button dictates into the box and explains itself once', async () => {
    globalThis.SpeechRecognition = FakeRecognition;
    const page = await openAsk();
    try {
        const mic = page.$('#convMicBtn');
        assert.equal(mic.classList.contains('hidden'), false);
        page.click(mic);
        await page.flush();
        assert.equal(FakeRecognition.instance.started, 1);
        assert.match(mic.getAttribute('aria-label'), /Stop dictation/);
        assert.match(page.text('#convToastText'), /speech recognition/);
        assert.equal(page.window.localStorage.getItem('shelah.conv.voiceNotice'), '1');

        page.click(mic);
        await page.flush();
        assert.match(mic.getAttribute('aria-label'), /Dictate your question/);
        page.click(mic);
        await page.flush();
        // The note is not repeated on the second use.
        page.click('#convToastClose');
        await page.flush();
        assert.equal(page.hidden('#convToast'), true);

        // A refused microphone says why, and the first-use note is owed again.
        FakeRecognition.instance.onerror?.({ error: 'not-allowed' });
        await page.flush();
        assert.match(page.text('#convToastText'), /Microphone is blocked/);
        assert.equal(page.window.localStorage.getItem('shelah.conv.voiceNotice'), null);
    } finally {
        delete globalThis.SpeechRecognition;
        page.close();
    }
});

test('each dictation failure has its own wording', async () => {
    globalThis.SpeechRecognition = FakeRecognition;
    const page = await openAsk();
    try {
        for (const [error, expected] of [['audio-capture', /No microphone/], ['network', /internet connection/], ['language-not-supported', /can't dictate in this language/]]) {
            page.click('#convMicBtn');
            await page.flush();
            FakeRecognition.instance.onerror?.({ error });
            await page.flush();
            assert.match(page.text('#convToastText'), expected, error);
        }
    } finally {
        delete globalThis.SpeechRecognition;
        page.close();
    }
});

test('without speech recognition the microphone button stays hidden', async () => {
    delete globalThis.SpeechRecognition;
    delete globalThis.webkitSpeechRecognition;
    const page = await openAsk();
    try {
        assert.equal(page.$('#convMicBtn').classList.contains('hidden'), true);
    } finally {
        page.close();
    }
});

// --- the mini widget's history column and size ----------------------------------

const historyListApi = {
    listConversations: async () => LIST,
    getConversation: async (id) => ({ id, title: 'Shabbat candles', minhag: 'Sefardic', messages: [] }),
};

async function openMini(options = {}) {
    const page = await openConversationPage({ signedIn: true, api: historyListApi, ...options });
    page.ui.open({ size: 'mini' });
    await page.flush();
    return page;
}

test('in the mini widget the history button opens a column beside the chat, not the popover', async () => {
    const page = await openMini();
    try {
        const button = page.$('#convHistoryBtn');
        assert.equal(button.getAttribute('aria-controls'), 'convSidebar');
        page.click(button);
        await page.flush();
        assert.equal(panel(page).dataset.history, 'open');
        assert.equal(button.getAttribute('aria-expanded'), 'true');
        assert.equal(page.hidden('#convHistoryPop'), true);
        const items = page.$$('#convSidebar .conv-list__item');
        assert.equal(items.length, 3);
        assert.match(items[0].textContent, /Pinned question/);
        // Focus lands on the list so the keyboard can carry on from the button.
        assert.ok(page.$('#convSidebar').contains(page.document.activeElement));

        page.click(button);
        await page.flush();
        assert.equal('history' in panel(page).dataset, false);
        assert.equal(button.getAttribute('aria-expanded'), 'false');
    } finally {
        page.close();
    }
});

test('picking a conversation from the column opens it and leaves the column open', async () => {
    const page = await openMini();
    try {
        page.click('#convHistoryBtn');
        await page.flush();
        page.click(page.$('#convSidebar [data-conv-open="c1"]'));
        await page.flush();
        assert.equal(page.store.getState().conversation.id, 'c1');
        assert.equal(panel(page).dataset.size, 'mini');
        assert.equal(panel(page).dataset.history, 'open');
        assert.match(route(page), /^\/chat\/c1/);
    } finally {
        page.close();
    }
});

test('Escape inside the widget folds the column away first and keeps the widget', async () => {
    const page = await openMini();
    try {
        page.click('#convHistoryBtn');
        await page.flush();
        const event = page.key('Escape');
        assert.equal(event.defaultPrevented, true);
        assert.equal('history' in panel(page).dataset, false);
        assert.equal(page.document.activeElement.id, 'convHistoryBtn');
        assert.equal(page.hidden('#convPanel'), false);
        assert.equal(panel(page).dataset.size, 'mini');
    } finally {
        page.close();
    }
});

test('the column is a mini-widget thing: the centred overlay keeps its popover', async () => {
    const page = await openMini();
    try {
        page.click('#convHistoryBtn');
        await page.flush();
        assert.equal(panel(page).dataset.history, 'open');
        // Growing to the overlay folds the column away and hands the button back to the popover.
        page.ui.setSize('overlay');
        await page.flush();
        assert.equal('history' in panel(page).dataset, false);
        assert.equal(page.$('#convHistoryBtn').getAttribute('aria-controls'), 'convHistoryPop');
        assert.equal(page.$('#convHistoryBtn').getAttribute('aria-haspopup'), 'dialog');

        page.click('#convHistoryBtn');
        await page.flush();
        assert.equal(page.hidden('#convHistoryPop'), false);
        assert.equal('history' in panel(page).dataset, false);
    } finally {
        page.close();
    }
});

test('closing the panel folds the column away', async () => {
    const page = await openMini();
    try {
        page.click('#convHistoryBtn');
        await page.flush();
        page.ui.close();
        await page.flush();
        assert.equal('history' in panel(page).dataset, false);
        // Reopening starts with the column shut.
        page.ui.open({ size: 'mini' });
        await page.flush();
        assert.equal('history' in panel(page).dataset, false);
        assert.equal(page.$('#convHistoryBtn').getAttribute('aria-expanded'), 'false');
    } finally {
        page.close();
    }
});

test('on a phone the history button still opens the popover', async () => {
    const page = await openConversationPage({ signedIn: true, mobile: true, api: historyListApi });
    try {
        page.ui.open({ size: 'overlay' });
        await page.flush();
        page.click('#convHistoryBtn');
        await page.flush();
        assert.equal(page.hidden('#convHistoryPop'), false);
        assert.equal('history' in panel(page).dataset, false);
        assert.equal(page.$('#convHistoryBtn').getAttribute('aria-haspopup'), 'dialog');
    } finally {
        page.close();
    }
});

test('the widget comes back at the size it was left at', async () => {
    const page = await openConversationPage({ storage: { 'shelah.conv.miniSize': JSON.stringify({ w: 440, h: 520 }) } });
    try {
        page.ui.open({ size: 'mini' });
        await page.flush();
        assert.equal(panel(page).style.getPropertyValue('--conv-mini-w'), '440px');
        assert.equal(panel(page).style.getPropertyValue('--conv-mini-h'), '520px');
        assert.equal(panel(page).dataset.miniH, 'fixed');
    } finally {
        page.close();
    }
});

test('dragging the corner handle of the real widget resizes it and keeps the size', async () => {
    const page = await openMini();
    try {
        // jsdom has no layout: the widget sits in the bottom-right corner, 340 by 400.
        panel(page).getBoundingClientRect = () => ({ left: 700, top: 300, width: 340, height: 400, right: 1040, bottom: 700 });
        const handle = page.$('#convResizeBtn');
        page.pointer(handle, 'pointerdown', { clientX: 700, clientY: 300 });
        page.pointer(handle, 'pointermove', { clientX: 650, clientY: 280 });
        page.pointer(handle, 'pointerup', { clientX: 650, clientY: 280 });
        assert.equal(panel(page).style.getPropertyValue('--conv-mini-w'), '390px');
        assert.equal(panel(page).style.getPropertyValue('--conv-mini-h'), '420px');
        assert.deepEqual(JSON.parse(page.window.localStorage.getItem('shelah.conv.miniSize')), { w: 390, h: 420 });
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

// --- the composer box --------------------------------------------------------

test('typing several lines grows the box a line at a time, caps it, and never moves the thread', async () => {
    const page = await openAsk();
    try {
        const input = page.$('#convInput');
        const scroller = page.$('#convScroller');
        // jsdom has no layout: give the box a rendered box and a content height
        // that follows its line count, the way a browser would.
        input.getClientRects = () => [{ width: 212, height: 38 }];
        Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => 16 + 22 * input.value.split('\n').length });
        scroller.scrollTop = 120;
        const heights = [];
        for (const line of ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']) {
            input.value = input.value ? `${input.value}\n${line}` : line;
            input.dispatchEvent(new page.window.Event('input', { bubbles: true }));
            heights.push(input.style.height);
        }
        assert.deepEqual(heights.slice(0, 4), ['38px', '60px', '82px', '104px']);
        assert.equal(heights.at(-1), '160px');
        assert.equal(scroller.scrollTop, 120);
    } finally {
        page.close();
    }
});

test('a box filled while it is not laid out keeps its CSS height instead of collapsing to 0', async () => {
    const page = await openAsk();
    try {
        const input = page.$('#convInput');
        input.getClientRects = () => [];
        Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 0 });
        input.style.height = '82px';
        input.value = 'a question\nover two lines';
        input.dispatchEvent(new page.window.Event('input', { bubbles: true }));
        assert.equal(input.style.height, '');
    } finally {
        page.close();
    }
});
