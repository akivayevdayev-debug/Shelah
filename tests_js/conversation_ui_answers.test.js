/**
 * static/js/conversation-ui.js and static/js/citation-popover.js, the parts the
 * search bar and the sources under an answer use: a question asked from the
 * search bar (and what the guest limits do to it), a stored or shared answer
 * opened in the panel, the sources list (what each source can do once its
 * passage is looked up, the text preview), the numbered chips and the card they
 * open, and what an answer turn carries besides its text (safety banner,
 * customs, feedback, Copy link). Runs the real module on the real home page in
 * jsdom (tests_js/helpers/conversation_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openConversationPage } = require('./helpers/conversation_page');

const HISTORY_ID = '3f2b8c1e-4d5a-4e6f-8a9b-0c1d2e3f4a5b';
const DASH = '—';

const turns = (page) => page.$$('#convMessages > li');
const failure = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });
const plain = (value) => JSON.parse(JSON.stringify(value));

/** What /ask answers, with two cited sources and the chips that lead to them. */
function answerData(extra = {}) {
    return {
        answer: 'Light before sunset [1]. Some add a custom [2].',
        question: 'When do we light candles?',
        history_id: HISTORY_ID,
        ai_cited_sources: [`Berakhot 2a ${DASH} From when`, `Genesis 1:3 ${DASH} Let there be light`],
        meta: { safety_class: 'ok' },
        ...extra,
    };
}

const textPayload = (extra = {}) => ({
    ref: 'Berakhot 2a',
    heRef: 'ברכות ב׳ א',
    lines: [{ he: 'מאימתי קורין', en: 'From when do we recite' }, { he: 'את שמע', en: 'the Shema' }],
    ...extra,
});

/**
 * The panel, with the one-shot /ask the search bar uses replaced by `ask`
 * (swap it per test with page.setAsk) and the page's /api/text routes by
 * `routes`.
 */
async function openAnswerPage({ routes = {}, ask = async () => answerData(), ...options } = {}) {
    let askAi = ask;
    const asked = [];
    const page = await openConversationPage({
        ...options,
        fetch: routes,
        before(window, clock) {
            window.ShelahModules = { askAi: (question, opts) => { asked.push([question, opts]); return askAi(question, opts); } };
            options.before?.(window, clock);
        },
    });
    page.asked = asked;
    page.setAsk = (fn) => { askAi = fn; };
    return page;
}

const sourceRoutes = (extra = {}) => ({
    '/api/text/Berakhot%202a': textPayload(),
    '/api/text/Genesis%201%3A3': textPayload({ ref: 'Genesis 1:3', heRef: 'בראשית א׳:ג׳', lines: [{ he: 'ויאמר אלהים', en: 'God said' }] }),
    ...extra,
});

// Opens `data` as a stored answer, in place of whatever the panel showed (an
// answer drawn again unchanged is not redrawn, so each starts from a new thread).
const showAnswer = async (page, data = answerData()) => {
    page.store.startNew({});
    await page.flush();
    page.ui.showAnswer(data);
    await page.flush();
};
const row = (page, number) => page.$$('.conv-cite')[number - 1];
const textCalls = (page) => page.calls.filter((call) => call.url.startsWith('/api/text/'));

// --- search-bar answers -------------------------------------------------------

test('a search-bar question opens the overlay on a pending answer, then shows the answer', async () => {
    const page = await openAnswerPage();
    try {
        let release;
        page.setAsk(() => new Promise((resolve) => { release = resolve; }));
        const pending = page.ui.askFromSearch('When do we light candles?', { mode: 'deep', community: 'Sefardic' });
        await page.flush();
        assert.equal(page.hidden('#convPanel'), false);
        assert.equal(page.$('#convPanel').dataset.size, 'overlay');
        assert.equal(page.$('#convPanel').dataset.answerView, 'true');
        assert.equal(page.window.localStorage.getItem('shelah.ai.used'), '1');
        assert.equal(turns(page).length, 2);
        assert.match(turns(page)[0].textContent, /When do we light candles\?/);
        assert.equal(turns(page)[1].getAttribute('aria-busy'), 'true');
        assert.equal(page.ui.isShowingAnswer(), true);
        // The search bar's own mode is what follow-ups and the URL use.
        assert.deepEqual(plain(page.ui.aiRoute()), { minhag: 'All', mode: 'deep' });

        release(answerData());
        const data = await pending;
        await page.flush();
        assert.equal(data.history_id, HISTORY_ID);
        assert.equal(turns(page)[1].getAttribute('aria-busy'), 'false');
        assert.match(page.text('#convMessages'), /Light before sunset/);
        assert.match(page.text('#convTitle'), /When do we light candles\?/);
    } finally {
        page.close();
    }
});

test('the pending turn fades out over the answer as a copy, so the thread never goes blank', async () => {
    const page = await openAnswerPage();
    try {
        let release;
        page.setAsk(() => new Promise((resolve) => { release = resolve; }));
        const pending = page.ui.askFromSearch('When do we light candles?', {});
        await page.flush();
        const li = turns(page)[1];
        assert.ok(li.querySelector('.conv-turn__skel'), 'the pending turn shows its skeleton');
        assert.equal(li.querySelector('.conv-ghost'), null);

        release(answerData());
        await pending;
        await page.flush();
        const ghost = li.querySelector('.conv-ghost');
        assert.ok(ghost, 'a copy of the pending turn is laid over the answer');
        assert.equal(ghost.getAttribute('aria-hidden'), 'true', 'assistive technology reads the answer, not the copy');
        assert.equal(ghost.querySelector('[data-conv-status]'), null, 'the copy does not answer status updates');
        assert.equal(li.classList.contains('conv-turn--ghosting'), true);
        assert.match(li.textContent, /Light before sunset/);

        ghost.dispatchEvent(new page.window.Event('animationend'));
        assert.equal(li.querySelector('.conv-ghost'), null, 'it goes when its fade ends');
        assert.equal(li.classList.contains('conv-turn--ghosting'), false);
    } finally {
        page.close();
    }
});

test('a backgrounded tab never fires animationend, so the copy leaves on a timer', async () => {
    const page = await openAnswerPage();
    try {
        let release;
        page.setAsk(() => new Promise((resolve) => { release = resolve; }));
        const pending = page.ui.askFromSearch('When do we light candles?', {});
        await page.flush();
        release(answerData());
        await pending;
        await page.flush();
        const li = turns(page)[1];
        assert.ok(li.querySelector('.conv-ghost'));
        await page.tick(450);
        assert.equal(li.querySelector('.conv-ghost'), null);
        assert.equal(li.classList.contains('conv-turn--ghosting'), false);
    } finally {
        page.close();
    }
});

test('a search-bar question that fails stays as Not sent and the caller hears about it', async () => {
    const page = await openAnswerPage();
    try {
        page.setAsk(async () => { throw failure('network'); });
        await assert.rejects(page.ui.askFromSearch('Will it send?'), { code: 'network' });
        await page.flush();
        assert.match(turns(page)[0].textContent, /Not sent\./);
        assert.equal(page.hidden('#convNotice'), false);
    } finally {
        page.close();
    }
});

test('a question asked while the panel is full-page keeps it full-page', async () => {
    const page = await openAnswerPage();
    try {
        await page.ui.open({ size: 'full' });
        await page.flush();
        await page.ui.askFromSearch('Where does it stay?');
        await page.flush();
        assert.equal(page.$('#convPanel').dataset.size, 'full');
    } finally {
        page.close();
    }
});

test('a follow-up from the search bar names the answers on screen', async () => {
    const page = await openAnswerPage();
    try {
        await page.ui.askFromSearch('First question');
        await page.flush();
        await page.ui.askFromSearch('And then?', { mode: 'balanced' }, { followUp: true });
        await page.flush();
        assert.deepEqual(page.asked.map(([question]) => question), ['First question', 'And then?']);
        assert.deepEqual(plain(page.asked[1][1].historyIds), [HISTORY_ID]);
        assert.equal(turns(page).length, 4);
    } finally {
        page.close();
    }
});

// --- guest limits -------------------------------------------------------------

test('a refused guest question opens the sign-in dialog with the limit\'s words', async () => {
    const page = await openAnswerPage();
    try {
        page.setAsk(async () => { throw failure('guest_cap_reached', { reason: 'daily', usage: { questions_limit: 8 } }); });
        await assert.rejects(page.ui.askFromSearch('One too many?'), { code: 'guest_cap_reached' });
        await page.flush();
        const dialog = page.$('#convGuestCap');
        assert.equal(dialog.open, true);
        assert.match(page.text('#convGuestCapTitle'), /used today's guest questions/);
        assert.match(page.text('#convGuestCapBody'), /Sign in or create a free account to keep asking/);
        assert.equal(page.hidden('#convNotice'), false, 'what is left on the page once the dialog is dismissed');
    } finally {
        page.close();
    }
});

test('the dialog names the conversation\'s limit, in Hebrew when the page is Hebrew', async () => {
    const page = await openAnswerPage({ lang: 'he' });
    try {
        page.setAsk(async () => { throw failure('guest_cap_reached', { reason: 'thread_questions', usage: { questions_limit: 5 } }); });
        await assert.rejects(page.ui.askFromSearch('שאלה'));
        await page.flush();
        assert.match(page.text('#convGuestCapTitle'), /הגעתם למגבלת האורחים/);
        assert.match(page.text('#convGuestCapBody'), /עד 5 שאלות/);
    } finally {
        page.close();
    }
});

test('a refused follow-up puts its words back in the box; a new question does not', async () => {
    const page = await openAnswerPage();
    try {
        await page.ui.askFromSearch('First question');
        await page.flush();
        page.setAsk(async () => { throw failure('guest_cap_reached', { reason: 'thread_questions', usage: { questions_limit: 8 } }); });
        await assert.rejects(page.ui.askFromSearch('Second question', {}, { followUp: true }));
        await page.flush();
        assert.equal(page.$('#convInput').value, 'Second question');
        assert.equal(page.$('#convSendBtn').disabled, false);

        // Words the visitor has typed meanwhile are not overwritten.
        page.$('#convInput').value = 'Something else';
        await assert.rejects(page.ui.askFromSearch('Third question', {}, { followUp: true }));
        assert.equal(page.$('#convInput').value, 'Something else');

        page.$('#convInput').value = '';
        await assert.rejects(page.ui.askFromSearch('Brand new', {}));
        assert.equal(page.$('#convInput').value, '', 'a refused new question stays on screen as a failed turn');
    } finally {
        page.close();
    }
});

test('the dialog\'s buttons sign in, create an account, or step aside', async () => {
    const page = await openAnswerPage();
    try {
        const signIns = [];
        page.window.handleSignIn = () => { signIns.push('in'); };
        page.window.handleSignUp = () => { signIns.push('up'); };
        const refuse = async () => {
            page.setAsk(async () => { throw failure('guest_cap_reached', { reason: 'daily' }); });
            await assert.rejects(page.ui.askFromSearch('Again?'));
            await page.flush();
        };

        await refuse();
        page.click(page.$('[data-conv-action="guest-sign-in"]'));
        assert.equal(page.$('#convGuestCap').open, false);
        await refuse();
        page.click(page.$('[data-conv-action="guest-sign-up"]'));
        assert.equal(page.$('#convGuestCap').open, false);
        assert.deepEqual(signIns, ['in', 'up']);

        await refuse();
        page.click(page.$('[data-conv-action="guest-cap-close"]'));
        assert.equal(page.$('#convGuestCap').open, false);

        // A click on the backdrop (the dialog itself) dismisses it; one inside does not.
        await refuse();
        page.click(page.$('#convGuestCapBody'));
        assert.equal(page.$('#convGuestCap').open, true);
        page.click(page.$('#convGuestCap'));
        assert.equal(page.$('#convGuestCap').open, false);
    } finally {
        page.close();
    }
});

test('without a sign-in page the dialog\'s buttons only close it', async () => {
    const page = await openAnswerPage();
    try {
        page.setAsk(async () => { throw failure('guest_cap_reached', { reason: 'daily' }); });
        await assert.rejects(page.ui.askFromSearch('Again?'));
        await page.flush();
        page.click(page.$('[data-conv-action="guest-sign-up"]'));
        assert.equal(page.$('#convGuestCap').open, false);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('a browser without <dialog> modals shows nothing and does not break', async () => {
    const page = await openAnswerPage();
    try {
        page.$('#convGuestCap').showModal = undefined;
        page.setAsk(async () => { throw failure('guest_cap_reached', { reason: 'daily' }); });
        await assert.rejects(page.ui.askFromSearch('Again?'));
        await page.flush();
        assert.equal(page.$('#convGuestCap').open, false);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('the composer stops a spent conversation before sending and leaves the words in the box', async () => {
    const page = await openAnswerPage();
    try {
        page.window.handleAiSearch = (question, options) => page.ui.askFromSearch(question, {}, options);
        await page.ui.askFromSearch('First question', {});
        await page.flush();
        // The server's counters say the conversation is used up.
        page.store.getState().guestUsage = { binding: 'thread', remaining: 0, questions_limit: 8 };
        await page.ask('One more');
        assert.equal(page.$('#convGuestCap').open, true);
        assert.equal(page.$('#convInput').value, 'One more');
        assert.equal(page.asked.length, 1);
    } finally {
        page.close();
    }
});

// --- stored and shared answers ------------------------------------------------

test('a stored answer opens in the panel with its question as the title', async () => {
    const page = await openAnswerPage();
    try {
        page.ui.showAnswer(null);
        await page.flush();
        assert.equal(page.hidden('#convPanel'), true, 'nothing to show');

        page.ui.showAnswer(answerData());
        await page.flush();
        assert.equal(page.hidden('#convPanel'), false);
        assert.match(page.text('#convTitle'), /When do we light candles\?/);
        assert.match(turns(page)[1].textContent, /Light before sunset/);
        assert.equal(page.ui.reopenAnswer(HISTORY_ID), true);
        assert.equal(page.ui.reopenAnswer('another-id'), false);
        assert.equal(page.ui.reopenAnswer(''), false);
        page.ui.close();
        await page.flush();
        assert.equal(page.ui.reopenAnswer(HISTORY_ID), true, 'Back onto the answer reopens the panel');
        assert.equal(page.hidden('#convPanel'), false);
    } finally {
        page.close();
    }
});

test('a shared conversation shows its turns without a way to continue them as the owner', async () => {
    const page = await openAnswerPage();
    try {
        page.ui.showPublicConversation(null);
        assert.equal(page.hidden('#convPanel'), true);
        page.ui.showPublicConversation({
            title: 'Shabbat questions',
            messages: [
                { role: 'user', content: 'May I cook?', status: 'complete' },
                { role: 'assistant', content: 'Not on Shabbat.', status: 'complete', citations: [] },
            ],
        });
        await page.flush();
        assert.equal(page.hidden('#convPanel'), false);
        assert.match(page.text('#convTitle'), /Shabbat questions/);
        assert.equal(turns(page).length, 2);
        assert.match(page.text('#convMessages'), /Not on Shabbat\./);
        assert.equal(page.store.getState().answerView.isPublic, true);
        assert.equal(page.$('[data-answer-actions]'), null, 'a read-only shared thread has no rating row');
    } finally {
        page.close();
    }
});

test('a shared link says it is loading, then why it did not open', async () => {
    const page = await openAnswerPage();
    try {
        page.ui.showPublicLoading();
        await page.flush();
        assert.equal(page.hidden('#convLoading'), false);
        assert.match(page.text('#convTitle'), /Shared answer/);

        page.ui.showPublicUnavailable(true);
        await page.flush();
        assert.equal(page.hidden('#convLoading'), true);
        assert.match(page.text('#convNotice'), /shared answer isn't available/);

        page.ui.showPublicUnavailable(false);
        await page.flush();
        assert.match(page.text('#convNotice'), /Couldn't load this shared answer/);
    } finally {
        page.close();
    }
});

test('a saved-answer link says it is loading, then why it did not open, or asks to sign in', async () => {
    const page = await openAnswerPage();
    try {
        page.ui.showSavedLoading();
        await page.flush();
        assert.equal(page.hidden('#convLoading'), false);
        assert.match(page.text('#convTitle'), /Saved answer/);

        page.ui.showSavedUnavailable(true);
        await page.flush();
        assert.match(page.text('#convNotice'), /saved answer isn't available/);
        page.ui.showSavedUnavailable(false);
        await page.flush();
        assert.match(page.text('#convNotice'), /Couldn't load this saved answer/);

        const signIns = [];
        page.window.handleSignIn = () => { signIns.push('in'); };
        page.ui.showSavedUnavailable(false, { signIn: true });
        await page.flush();
        assert.match(page.text('#convNotice'), /Sign in to see this saved answer/);
        page.click(page.$('#convNoticeAction'));
        assert.deepEqual(signIns, ['in']);
    } finally {
        page.close();
    }
});

// --- the sources list ---------------------------------------------------------

test('an answer lists its sources with the reader link, the model\'s note and a preview drawer', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        await showAnswer(page);
        assert.equal(page.$('.conv-cites__title').textContent, 'Sources');
        const rows = page.$$('.conv-cite');
        assert.equal(rows.length, 2);
        assert.equal(rows[0].querySelector('.conv-cite__num').textContent, '1');
        const link = rows[0].querySelector('.conv-cite__ref');
        assert.equal(link.textContent, 'Berakhot 2a');
        assert.equal(link.getAttribute('href'), '/text/Berakhot.2a');
        assert.equal(rows[0].querySelector('.conv-cite__excerpt').textContent, 'From when');
        assert.equal(rows[0].querySelector('summary').textContent.trim(), 'Preview the text');
        assert.ok(rows[0].querySelector('.conv-cite__links a[href*="alhatorah"]'), 'a daf is also linked out');
        assert.equal(page.$$('.conv-mark').length, 2, 'a numbered chip in the answer for each source');
    } finally {
        page.close();
    }
});

test('a source the library has is marked readable', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        await showAnswer(page);
        assert.deepEqual(page.$$('.conv-cite').map((item) => item.dataset.readable), ['true', 'true']);
        assert.equal(textCalls(page).filter((call) => call.url.includes('Berakhot')).length, 1, 'one lookup per ref');
        assert.ok(textCalls(page)[0].url.endsWith('?autotranslate=0'));
    } finally {
        page.close();
    }
});

test('in Hebrew a source\'s name is the Hebrew spelling the library gives', async () => {
    const page = await openAnswerPage({ lang: 'he', routes: sourceRoutes() });
    try {
        await showAnswer(page);
        const link = row(page, 1).querySelector('.conv-cite__ref');
        assert.equal(link.textContent, 'ברכות ב׳ א');
        assert.equal(link.lang, 'he');
    } finally {
        page.close();
    }
});

test('in Hebrew a source with no Hebrew spelling keeps its English name', async () => {
    const page = await openAnswerPage({ lang: 'he', routes: sourceRoutes({ '/api/text/Berakhot%202a': textPayload({ heRef: '' }) }) });
    try {
        await showAnswer(page);
        const link = row(page, 1).querySelector('.conv-cite__ref');
        assert.equal(link.textContent, 'Berakhot 2a');
        assert.equal(link.lang, '');
    } finally {
        page.close();
    }
});

test('a source the library does not have is written out as text with no preview', async () => {
    const page = await openAnswerPage({
        routes: sourceRoutes({ '/api/text/Genesis%201%3A3': { error: 'no such ref', error_type: 'not_found' } }),
    });
    try {
        await showAnswer(page);
        const item = row(page, 2);
        assert.equal(item.dataset.readable, 'false');
        assert.equal(item.querySelector('a.conv-cite__ref'), null, 'no link that leads nowhere');
        assert.equal(item.querySelector('.conv-cite__ref--plain').textContent, 'Genesis 1:3');
        assert.equal(item.querySelector('.conv-cite__why').textContent, "Can't be opened here");
        assert.equal(item.querySelector('.conv-cite__preview'), null);
        assert.equal(row(page, 1).dataset.readable, 'true');
    } finally {
        page.close();
    }
});

test('a lookup that fails leaves the source as it was and is tried again next time', async () => {
    let failing = true;
    const page = await openAnswerPage({
        routes: sourceRoutes({ '/api/text/Berakhot%202a': () => (failing ? { status: 500, body: {} } : textPayload()) }),
    });
    try {
        await showAnswer(page);
        assert.equal(row(page, 1).dataset.readable, 'unknown');
        failing = false;
        await showAnswer(page);
        assert.equal(row(page, 1).dataset.readable, 'true');
        // And once it worked it is kept.
        const before = textCalls(page).length;
        await showAnswer(page);
        assert.equal(textCalls(page).length, before);
    } finally {
        page.close();
    }
});

test('a lookup that throws is treated like one that failed', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes({ '/api/text/Berakhot%202a': () => { throw new Error('offline'); } }) });
    try {
        await showAnswer(page);
        assert.equal(row(page, 1).dataset.readable, 'unknown');
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('a lookup that lands after the answer was replaced changes nothing', async () => {
    let release;
    const page = await openAnswerPage({
        routes: sourceRoutes({ '/api/text/Berakhot%202a': () => new Promise((resolve) => { release = () => resolve(textPayload({ heRef: 'x' })); }) }),
    });
    try {
        await showAnswer(page);
        const stale = row(page, 1);
        await showAnswer(page, answerData({ answer: 'Another answer.', ai_cited_sources: [] }));
        release();
        await page.flush();
        assert.equal(stale.dataset.readable, 'unknown');
        assert.equal(page.$$('.conv-cite').length, 0);
    } finally {
        page.close();
    }
});

test('a blank source is not listed', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        await showAnswer(page, answerData({ answer: 'Unsourced.', ai_cited_sources: [' '] }));
        assert.equal(page.$$('.conv-cite').length, 0);
        assert.equal(page.$('.conv-cites__title'), null);
    } finally {
        page.close();
    }
});

test('a source written with another spelling of the tractate opens in the reader\'s spelling', async () => {
    const page = await openAnswerPage({ routes: { '/api/text/Berakhot%202a': textPayload() } });
    try {
        await showAnswer(page, answerData({ ai_cited_sources: ['Talmud Bavli Berakhot 2a'] }));
        assert.equal(row(page, 1).querySelector('.conv-cite__ref').getAttribute('href'), '/text/Berakhot.2a');
    } finally {
        page.close();
    }
});

// --- the text preview ---------------------------------------------------------

test('opening a preview shows a skeleton while the passage loads, then its first lines', async () => {
    let release;
    const page = await openAnswerPage({
        routes: sourceRoutes({ '/api/text/Berakhot%202a': () => new Promise((resolve) => { release = () => resolve(textPayload()); }) }),
    });
    try {
        await showAnswer(page);
        const details = row(page, 1).querySelector('details');
        const body = details.querySelector('.conv-cite__preview-body');
        const toggle = () => details.dispatchEvent(new page.window.Event('toggle', { bubbles: true }));
        // A toggle that is a close does nothing.
        toggle();
        assert.equal(body.innerHTML, '');

        details.open = true;
        await page.flush();
        assert.equal(body.dataset.state, 'loading');
        assert.equal(body.getAttribute('aria-busy'), 'true');
        assert.ok(body.querySelector('.ai-src-skeleton-line'));
        // A second toggle while it loads starts nothing new.
        toggle();
        assert.equal(textCalls(page).filter((call) => call.url.includes('Berakhot')).length, 1);

        release();
        await page.flush();
        assert.equal(body.dataset.state, 'done');
        assert.equal(body.getAttribute('aria-busy'), 'false');
        assert.equal(body.querySelector('.ai-src-skeleton-line'), null);
        assert.match(body.textContent, /From when do we recite/);
    } finally {
        page.close();
    }
});

test('the preview of an open source fills with the passage and keeps it', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        await showAnswer(page);
        const details = row(page, 1).querySelector('details');
        const body = details.querySelector('.conv-cite__preview-body');
        details.open = true;
        await page.flush();
        assert.equal(body.dataset.state, 'done');
        assert.equal(body.getAttribute('aria-busy'), 'false');
        assert.match(body.textContent, /מאימתי קורין/);
        assert.match(body.textContent, /From when do we recite/);
        // Closing and opening again does not draw it twice.
        details.open = false;
        details.open = true;
        await page.flush();
        assert.equal(body.querySelectorAll('.ai-src-box-body').length, 1);
    } finally {
        page.close();
    }
});

test('in Hebrew the preview is the Hebrew text alone', async () => {
    const page = await openAnswerPage({ lang: 'he', routes: sourceRoutes() });
    try {
        await showAnswer(page);
        const details = row(page, 1).querySelector('details');
        details.open = true;
        await page.flush();
        const body = details.querySelector('.conv-cite__preview-body');
        assert.match(body.textContent, /מאימתי קורין/);
        assert.doesNotMatch(body.textContent, /From when/);
    } finally {
        page.close();
    }
});

test('a preview the library cannot give says so and tries again when reopened', async () => {
    let failing = true;
    const page = await openAnswerPage({
        routes: sourceRoutes({ '/api/text/Berakhot%202a': () => (failing ? { status: 503, body: {} } : textPayload()) }),
    });
    try {
        await showAnswer(page);
        const details = row(page, 1).querySelector('details');
        const body = details.querySelector('.conv-cite__preview-body');
        details.open = true;
        await page.flush();
        assert.match(body.textContent, /Preview unavailable for this source/);
        assert.equal(body.dataset.state, '');
        assert.equal(body.getAttribute('aria-busy'), 'false');

        failing = false;
        details.open = false;
        details.open = true;
        await page.flush();
        assert.equal(body.dataset.state, 'done');
        assert.match(body.textContent, /From when do we recite/);
    } finally {
        page.close();
    }
});

test('a preview that lands after its row is gone is dropped', async () => {
    let release;
    const page = await openAnswerPage({
        routes: sourceRoutes({ '/api/text/Berakhot%202a': () => new Promise((resolve) => { release = () => resolve(textPayload()); }) }),
    });
    try {
        await showAnswer(page);
        const details = row(page, 1).querySelector('details');
        details.open = true;
        await page.flush();
        await showAnswer(page, answerData({ answer: 'Another answer.', ai_cited_sources: [] }));
        release();
        await page.flush();
        assert.deepEqual(page.errors, []);
        assert.equal(details.isConnected, false);
    } finally {
        page.close();
    }
});

test('the preview eases in unless motion is reduced', async () => {
    const page = await openAnswerPage({
        routes: sourceRoutes(),
        before(window) {
            window.ShelahMotion = {
                APPLE_SPRING: { smooth: 'smooth-spring' },
                springAnimate: (...args) => { window.__sprung = (window.__sprung || []).concat([args.slice(1)]); },
                isMotionReduced: () => Boolean(window.__reduced),
            };
        },
    });
    try {
        await showAnswer(page);
        const open = async (number) => {
            const details = row(page, number).querySelector('details');
            details.open = true;
            await page.flush();
        };
        await open(1);
        assert.deepEqual(plain(page.window.__sprung), [[{ opacity: [0, 1], transform: ['translateY(6px)', 'translateY(0px)'] }, 'smooth-spring']]);
        page.window.__reduced = true;
        await open(2);
        assert.equal(page.window.__sprung.length, 1);
    } finally {
        page.close();
    }
});

// --- opening a source in the reader ---------------------------------------------

test('a click on a source\'s reference shrinks the panel and opens the text there', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        const opened = [];
        page.window.readText = (ref, options) => { opened.push([ref, plain(options)]); return Promise.resolve(); };
        await showAnswer(page);
        page.click(row(page, 1).querySelector('.conv-cite__ref'));
        await page.flush();
        assert.deepEqual(opened, [['Berakhot 2a', { skipNavigationGrid: true }]]);
        assert.equal(page.$('#convPanel').dataset.size, 'mini');
    } finally {
        page.close();
    }
});

test('a modified click on a source keeps the browser\'s own behaviour', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        const opened = [];
        page.window.readText = (ref) => { opened.push(ref); return Promise.resolve(); };
        await showAnswer(page);
        const link = row(page, 1).querySelector('.conv-cite__ref');
        const click = (init) => {
            const event = new page.window.MouseEvent('click', { bubbles: true, cancelable: true, ...init });
            link.dispatchEvent(event);
            return event;
        };
        for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { button: 1 }]) {
            assert.equal(click(init).defaultPrevented, false, JSON.stringify(init));
        }
        assert.deepEqual(opened, []);
        assert.equal(click({}).defaultPrevented, true);
        assert.equal(opened.length, 1);
    } finally {
        page.close();
    }
});

test('a source opened on a page with no reader still shrinks the panel and breaks nothing', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        await showAnswer(page);
        page.click(row(page, 1).querySelector('.conv-cite__ref'));
        await page.flush();
        assert.equal(page.$('#convPanel').dataset.size, 'mini');
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('the verse a citation names is highlighted once in the reader; a whole page is not', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        page.document.body.insertAdjacentHTML('beforeend',
            '<div id="readerSources"><div class="reader-source-clean" data-text-chunk-ref="genesis-1-3"><div class="segment-row" id="verse"></div></div></div>');
        page.window.getRefTrackingKey = (ref) => ref.toLowerCase().replace(/\W+/g, '-');
        page.window.readText = () => Promise.resolve();
        await showAnswer(page);
        const verse = page.$('#verse');
        page.click(row(page, 2).querySelector('.conv-cite__ref'));
        await page.flush();
        assert.equal(verse.classList.contains('cite-highlight'), true);
        page.clock.tick(1200);
        assert.equal(verse.classList.contains('cite-highlight'), false);

        // A page-level ref has no single row to mark.
        page.click(row(page, 1).querySelector('.conv-cite__ref'));
        await page.flush();
        assert.equal(verse.classList.contains('cite-highlight'), false);
    } finally {
        page.close();
    }
});

test('with no tracking key the first chunk in the reader is used, and reduced motion or a missing row skip the highlight', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        page.document.body.insertAdjacentHTML('beforeend',
            '<div id="readerSources"><div class="reader-source-clean" data-text-chunk-ref="whatever"><div class="segment-row" id="verse"></div></div></div>');
        page.window.readText = () => Promise.resolve();
        await showAnswer(page);
        const verse = page.$('#verse');
        page.click(row(page, 2).querySelector('.conv-cite__ref'));
        await page.flush();
        assert.equal(verse.classList.contains('cite-highlight'), true);

        verse.classList.remove('cite-highlight');
        page.window.ShelahMotion = { isMotionReduced: () => true };
        page.click(row(page, 2).querySelector('.conv-cite__ref'));
        await page.flush();
        assert.equal(verse.classList.contains('cite-highlight'), false);

        page.window.ShelahMotion = undefined;
        page.$('#readerSources').innerHTML = '';
        page.click(row(page, 2).querySelector('.conv-cite__ref'));
        await page.flush();
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

// --- the numbered chips and their card -------------------------------------------

const chip = (page, number) => page.$$('.conv-mark')[number - 1];
const card = (page) => page.$('.conv-citepop');
const cardOpen = (page) => Boolean(card(page)) && !card(page).classList.contains('hidden');

test('a click on a chip opens its card with the source, the note and two ways on; the same chip closes it', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        await showAnswer(page);
        page.click(chip(page, 1));
        await page.flush();
        assert.equal(cardOpen(page), true);
        assert.equal(card(page).getAttribute('role'), 'dialog');
        assert.equal(card(page).getAttribute('aria-label'), 'Source 1');
        assert.equal(card(page).querySelector('.conv-citepop__num').textContent, '1');
        assert.equal(card(page).querySelector('.conv-citepop__ref').textContent, 'Berakhot 2a');
        assert.equal(card(page).querySelector('.conv-citepop__note').textContent, 'From when');
        assert.deepEqual(
            [...card(page).querySelectorAll('[data-pop-action]')].map((button) => button.textContent),
            ['Open in reader', 'Show in sources'],
        );
        assert.equal(chip(page, 1).getAttribute('aria-expanded'), 'true');
        assert.equal(row(page, 1).classList.contains('conv-cite--active'), true);
        assert.equal(page.document.activeElement, card(page));
        // The first lines of the text, from the same lookup the list used.
        assert.match(card(page).querySelector('.conv-citepop__text').textContent, /מאימתי קורין/);
        assert.equal(card(page).querySelector('.conv-citepop__text').dataset.state, 'done');
        assert.equal(card(page).classList.contains('conv-citepop--in'), true);

        page.click(chip(page, 1));
        await page.flush();
        assert.equal(cardOpen(page), false);
        assert.equal(chip(page, 1).getAttribute('aria-expanded'), 'false');
        assert.equal(row(page, 1).classList.contains('conv-cite--active'), false);
        assert.equal(page.document.activeElement, chip(page, 1), 'focus goes back to the chip');
    } finally {
        page.close();
    }
});

test('another chip replaces the card, a click elsewhere or Escape closes it', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        await showAnswer(page);
        page.click(chip(page, 1));
        await page.flush();
        page.click(chip(page, 2));
        await page.flush();
        assert.equal(page.$$('.conv-citepop').length, 1);
        assert.equal(card(page).querySelector('.conv-citepop__ref').textContent, 'Genesis 1:3');
        assert.equal(chip(page, 1).getAttribute('aria-expanded'), 'false');

        page.click(page.$('#convTitle'));
        await page.flush();
        assert.equal(cardOpen(page), false);

        page.click(chip(page, 1));
        await page.flush();
        page.click(card(page).querySelector('.conv-citepop__ref'));
        assert.equal(cardOpen(page), true, 'a click inside the card keeps it');
        page.key('Escape');
        await page.flush();
        assert.equal(cardOpen(page), false);
        assert.equal(page.hidden('#convPanel'), false, 'Escape closes the card before the panel');
    } finally {
        page.close();
    }
});

test('a card\'s actions open the source in the reader or show its row in the list', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        const opened = [];
        page.window.readText = (ref) => { opened.push(ref); return Promise.resolve(); };
        await showAnswer(page);
        page.click(chip(page, 1));
        await page.flush();
        page.click(card(page).querySelector('[data-pop-action="open"]'));
        await page.flush();
        assert.deepEqual(opened, ['Berakhot 2a']);
        assert.equal(cardOpen(page), false);

        const target = row(page, 2);
        const scrolls = [];
        target.scrollIntoView = (options) => scrolls.push(plain(options));
        page.click(chip(page, 2));
        await page.flush();
        page.click(card(page).querySelector('[data-pop-action="jump"]'));
        await page.flush();
        assert.deepEqual(scrolls, [{ block: 'center', behavior: 'smooth' }]);
        assert.equal(page.document.activeElement, target);
        assert.equal(target.classList.contains('conv-cite--flash'), true);
        page.clock.tick(1400);
        assert.equal(target.classList.contains('conv-cite--flash'), false);
    } finally {
        page.close();
    }
});

test('with reduced motion a card appears and jumps without animation', async () => {
    const page = await openAnswerPage({
        routes: sourceRoutes(),
        before(window) { window.ShelahMotion = { isMotionReduced: () => true }; },
    });
    try {
        await showAnswer(page);
        page.click(chip(page, 1));
        await page.flush();
        assert.equal(card(page).classList.contains('conv-citepop--in'), false);
        const target = row(page, 1);
        const scrolls = [];
        target.scrollIntoView = (options) => scrolls.push(plain(options));
        page.click(card(page).querySelector('[data-pop-action="jump"]'));
        await page.flush();
        assert.deepEqual(scrolls, [{ block: 'center', behavior: 'auto' }]);
        assert.equal(target.classList.contains('conv-cite--flash'), false);
    } finally {
        page.close();
    }
});

test('a source the reader cannot open offers only "Show in sources" and has no text to show', async () => {
    const page = await openAnswerPage({
        routes: sourceRoutes({ '/api/text/Genesis%201%3A3': { error: 'no such ref', error_type: 'not_found' } }),
    });
    try {
        await showAnswer(page);
        page.click(chip(page, 2));
        await page.flush();
        assert.deepEqual([...card(page).querySelectorAll('[data-pop-action]')].map((button) => button.dataset.popAction), ['jump']);
        assert.equal(card(page).querySelector('.conv-citepop__text').dataset.state, 'none');
        assert.equal(card(page).querySelector('.conv-citepop__ref').textContent, 'Genesis 1:3');
    } finally {
        page.close();
    }
});

test('a card whose passage cannot be fetched shows no text', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes({ '/api/text/Berakhot%202a': { status: 500, body: {} } }) });
    try {
        await showAnswer(page);
        page.click(chip(page, 1));
        await page.flush();
        const text = card(page).querySelector('.conv-citepop__text');
        assert.equal(text.dataset.state, 'none');
        assert.equal(text.innerHTML, '');
    } finally {
        page.close();
    }
});

test('a card closed before its text arrives is not filled in afterwards', async () => {
    let release;
    const page = await openAnswerPage({
        routes: sourceRoutes({ '/api/text/Berakhot%202a': () => new Promise((resolve) => { release = () => resolve(textPayload()); }) }),
    });
    try {
        await showAnswer(page);
        page.click(chip(page, 1));
        await page.flush();
        assert.equal(card(page).querySelector('.conv-citepop__text').dataset.state, 'loading');
        assert.ok(card(page).querySelector('.ai-src-skeleton-line'));
        page.click(chip(page, 1));
        await page.flush();
        release();
        await page.flush();
        assert.equal(card(page).querySelector('.conv-citepop__text').dataset.state, 'loading');
        assert.equal(cardOpen(page), false);
    } finally {
        page.close();
    }
});

test('a chip with no row to lead to opens nothing', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        await showAnswer(page);
        chip(page, 1).dataset.markTarget = 'nowhere';
        page.click(chip(page, 1));
        await page.flush();
        assert.equal(card(page), null);
    } finally {
        page.close();
    }
});

test('a mouse resting on a chip previews it after a beat; leaving closes it, a deliberate open stays', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        await showAnswer(page);
        const hover = (target, type, pointerType = 'mouse') => page.pointer(target, type, { pointerType });

        hover(chip(page, 1), 'pointerover');
        assert.equal(card(page), null, 'not at once');
        await page.tick(139);
        assert.equal(card(page), null);
        await page.tick(1);
        assert.equal(cardOpen(page), true);
        assert.notEqual(page.document.activeElement, card(page), 'a preview does not take focus');

        // Pointer moves onto the card: it stays. Off it, it goes after a beat.
        hover(chip(page, 1), 'pointerout');
        card(page).dispatchEvent(new page.window.MouseEvent('pointerenter'));
        await page.tick(500);
        assert.equal(cardOpen(page), true);
        const leave = new page.window.MouseEvent('pointerleave');
        Object.defineProperty(leave, 'pointerType', { value: 'mouse' });
        card(page).dispatchEvent(leave);
        await page.tick(219);
        assert.equal(cardOpen(page), true);
        await page.tick(1);
        assert.equal(cardOpen(page), false);

        // Touch has no hover.
        hover(chip(page, 1), 'pointerover', 'touch');
        await page.tick(500);
        assert.equal(cardOpen(page), false);

        // A card the reader opened on purpose is not replaced by a hover on another chip.
        page.click(chip(page, 1));
        await page.flush();
        hover(chip(page, 2), 'pointerover');
        await page.tick(500);
        assert.equal(card(page).querySelector('.conv-citepop__ref').textContent, 'Berakhot 2a');
        hover(chip(page, 2), 'pointerout');
        await page.tick(500);
        assert.equal(cardOpen(page), true);
    } finally {
        page.close();
    }
});

test('hovering the chip whose preview is open keeps it, another chip replaces it, and leaving early opens nothing', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        await showAnswer(page);
        const over = (target) => page.pointer(target, 'pointerover', { pointerType: 'mouse' });
        const out = (target) => page.pointer(target, 'pointerout', { pointerType: 'mouse' });
        over(chip(page, 1));
        await page.tick(140);
        over(chip(page, 1));
        await page.tick(500);
        assert.equal(card(page).querySelector('.conv-citepop__ref').textContent, 'Berakhot 2a');
        // A preview gives way to the next chip the mouse rests on.
        over(chip(page, 2));
        await page.tick(140);
        assert.equal(card(page).querySelector('.conv-citepop__ref').textContent, 'Genesis 1:3');
        // A pointer that leaves before the beat opens nothing.
        page.ui.close();
        await page.flush();
        assert.equal(cardOpen(page), false);
        over(chip(page, 1));
        await page.tick(100);
        out(chip(page, 1));
        await page.tick(500);
        assert.equal(cardOpen(page), false);
    } finally {
        page.close();
    }
});

test('Tab out of the card closes it; focus staying inside or on the chip keeps it', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        await showAnswer(page);
        page.click(chip(page, 1));
        await page.flush();
        const focusout = (relatedTarget) => card(page).dispatchEvent(new page.window.FocusEvent('focusout', { bubbles: true, relatedTarget }));
        focusout(card(page).querySelector('.conv-citepop__action'));
        assert.equal(cardOpen(page), true);
        focusout(chip(page, 1));
        assert.equal(cardOpen(page), true);
        focusout(null);
        assert.equal(cardOpen(page), true, 'a click on the page is the outside-click handler\'s to close');
        focusout(page.$('#convInput'));
        assert.equal(cardOpen(page), false);
        focusout(page.$('#convInput'));
        assert.equal(cardOpen(page), false);
    } finally {
        page.close();
    }
});

test('the card follows its chip as the text scrolls and closes once the chip has left the view', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        await showAnswer(page);
        const rect = (top, bottom) => ({ top, bottom, left: 100, right: 120, width: 20, height: bottom - top });
        const scroller = page.$('#convScroller');
        scroller.getBoundingClientRect = () => rect(0, 600);
        const anchor = chip(page, 1);
        anchor.getBoundingClientRect = () => rect(100, 120);
        page.click(anchor);
        await page.flush();
        assert.equal(card(page).style.top, '128px', 'just below the chip');

        anchor.getBoundingClientRect = () => rect(200, 220);
        scroller.dispatchEvent(new page.window.Event('scroll'));
        assert.equal(card(page).style.top, '228px');
        assert.equal(cardOpen(page), true);

        anchor.getBoundingClientRect = () => rect(-80, -60);
        scroller.dispatchEvent(new page.window.Event('scroll'));
        assert.equal(cardOpen(page), false, 'scrolled out above');

        page.click(anchor);
        await page.flush();
        anchor.getBoundingClientRect = () => rect(700, 720);
        scroller.dispatchEvent(new page.window.Event('scroll'));
        assert.equal(cardOpen(page), false, 'scrolled out below');

        // Nothing open: a scroll does nothing.
        scroller.dispatchEvent(new page.window.Event('scroll'));
        assert.equal(cardOpen(page), false);
    } finally {
        page.close();
    }
});

test('a card opens above its chip when there is no room below, and stays inside the window', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        // jsdom has no layout: the card is given a size, and the chip a place near the bottom-left corner.
        for (const [name, value] of [['offsetHeight', 200], ['offsetWidth', 300]]) {
            Object.defineProperty(page.window.HTMLElement.prototype, name, {
                configurable: true,
                get() { return this.classList.contains('conv-citepop') ? value : 0; },
            });
        }
        await showAnswer(page);
        const innerHeight = page.window.innerHeight;
        chip(page, 1).getBoundingClientRect = () => ({ top: innerHeight - 40, bottom: innerHeight - 20, left: 2, right: 22, width: 20, height: 20 });
        page.click(chip(page, 1));
        await page.flush();
        assert.equal(card(page).style.top, `${innerHeight - 40 - 8 - 200}px`, 'above the chip, a gap of 8');
        assert.equal(card(page).style.left, '8px', 'kept off the left edge');
        assert.match(card(page).style.getPropertyValue('--citepop-origin'), /100%$/, 'it grows from the chip');
        page.ui.close();
        await page.flush();

        // Room below: it opens below, and a chip at the right edge keeps the card in the window.
        chip(page, 2).getBoundingClientRect = () => ({ top: 100, bottom: 120, left: 1000, right: 1020, width: 20, height: 20 });
        page.click(chip(page, 2));
        await page.flush();
        assert.equal(card(page).style.top, '128px');
        assert.equal(card(page).style.left, `${page.window.innerWidth - 300 - 8}px`);
    } finally {
        page.close();
    }
});

test('a card whose chip is gone when the answer is redrawn closes', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        await showAnswer(page);
        page.click(chip(page, 1));
        await page.flush();
        await showAnswer(page, answerData({ answer: 'A different answer.', ai_cited_sources: [] }));
        assert.equal(cardOpen(page), false);
    } finally {
        page.close();
    }
});

test('the panel changing size closes an open card', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        await showAnswer(page);
        page.click(chip(page, 1));
        await page.flush();
        page.ui.setSize('full');
        await page.flush();
        assert.equal(cardOpen(page), false);
    } finally {
        page.close();
    }
});

// --- what an answer turn carries besides its text -----------------------------------

test('the community customs are listed under the answer with the communities\' names', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        await showAnswer(page, answerData({
            customs: [
                { community: 'Sefardic', ruling: ' Light eighteen minutes before. ' },
                { community: 'Ashkenaz', notes: 'Customs differ.' },
                { community: 'Yemenite', ruling: '', notes: '' },
                null,
            ],
        }));
        const items = page.$$('.conv-custom');
        assert.equal(items.length, 2);
        assert.equal(page.$('.conv-customs__title').textContent, 'Community customs');
        assert.equal(items[0].querySelector('.conv-custom__text').textContent, 'Light eighteen minutes before.');
        assert.equal(items[1].querySelector('.conv-custom__text').textContent, 'Customs differ.');
        assert.ok(items[0].querySelector('.conv-custom__name').textContent.length > 0);
    } finally {
        page.close();
    }
});

test('the page\'s own community name wins, and a name lookup that throws falls back', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        page.window.getCommunityDisplayName = (community) => `Custom ${community}`;
        await showAnswer(page, answerData({ customs: [{ community: 'Sefardic', ruling: 'Yes.' }] }));
        assert.equal(page.$('.conv-custom__name').textContent, 'Custom Sefardic');

        page.window.getCommunityDisplayName = () => { throw new Error('no names yet'); };
        await showAnswer(page, answerData({ customs: [{ community: 'Sefardic', ruling: 'Yes.' }] }));
        assert.ok(page.$('.conv-custom__name').textContent.length > 0);
        assert.doesNotMatch(page.$('.conv-custom__name').textContent, /Custom/);
    } finally {
        page.close();
    }
});

test('an answer with no customs has no customs section', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        await showAnswer(page, answerData({ customs: 'none' }));
        assert.equal(page.$('.conv-customs'), null);
        await showAnswer(page, answerData({ customs: [{ community: 'Sefardic' }] }));
        assert.equal(page.$('.conv-customs'), null);
    } finally {
        page.close();
    }
});

test('the safety banner stays only when it says something the standing disclaimer does not', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        const banners = [];
        page.window.renderDisclaimerBanner = (host, safetyClass, breaker) => {
            banners.push([safetyClass, breaker]);
            host.classList.add(safetyClass === 'referral' ? 'ai-disclaimer-banner--referral' : breaker ? 'ai-disclaimer-banner--breaker-paused' : 'ai-disclaimer-banner--plain');
            host.textContent = 'banner';
        };
        await showAnswer(page, answerData({ meta: { safety_class: 'ok' } }));
        assert.equal(page.$('[data-answer-banner]'), null);
        await showAnswer(page, answerData({ meta: { safety_class: 'referral' } }));
        assert.equal(page.$('[data-answer-banner]').textContent, 'banner');
        assert.ok(page.$('[data-answer-banner]').classList.contains('conv-turn__banner'));
        await showAnswer(page, answerData({ meta: { breaker_tripped: true } }));
        assert.ok(page.$('[data-answer-banner].ai-disclaimer-banner--breaker-paused'));
        assert.deepEqual(banners, [['ok', undefined], ['referral', undefined], [undefined, true]]);
    } finally {
        page.close();
    }
});

test('without the banner renderer the banner host is dropped', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        await showAnswer(page);
        assert.equal(page.$('[data-answer-banner]'), null);
        assert.ok(page.$('[data-answer-actions]'));
    } finally {
        page.close();
    }
});

test('an answer turn gets the feedback widget for its question, and Copy link moves into it', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        const widgets = [];
        const shown = [];
        page.window.renderFeedbackWidget = (host, data, question) => { widgets.push([host.className, data.history_id, question]); };
        page.window.ShelahAnswerLink = { panel: { show: (data) => shown.push(data.history_id), hide() {} } };
        await showAnswer(page);
        assert.deepEqual(widgets, [['conv-turn__feedback', HISTORY_ID, 'When do we light candles?']]);
        assert.deepEqual(shown, [HISTORY_ID]);
        const link = page.$('#convAnswerLink');
        assert.ok(link, 'the panel has one Copy link control');
        assert.equal(link.closest('[data-answer-actions]'), page.$('[data-answer-actions]'));

        // The next answer takes it over; it is parked first so the old turn can be redrawn.
        await showAnswer(page, answerData({ answer: 'Second.', ai_cited_sources: [] }));
        assert.equal(page.$$('#convAnswerLink').length, 1);
        assert.equal(link.closest('[data-answer-actions]'), page.$('[data-answer-actions]'));
        page.ui.close();
        page.ui.getStore().startNew({});
        await page.flush();
        assert.equal(link.closest('[data-answer-actions]'), null, 'parked again once the turn is gone');
    } finally {
        page.close();
    }
});

test('an answer without the page\'s renderers still reads, as escaped text', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        await showAnswer(page, answerData({ answer: 'Line one\n<b>two</b> [1]' }));
        const body = page.$('.conv-answer');
        assert.equal(body.querySelector('b'), null, 'no markup from the answer');
        assert.equal(body.querySelectorAll('br').length, 1);
        assert.match(body.textContent, /<b>two<\/b>/);
    } finally {
        page.close();
    }
});

test('the page\'s Markdown renderer draws the answer, and one that throws falls back to text', async () => {
    const page = await openAnswerPage({ routes: sourceRoutes() });
    try {
        page.window.renderAnswerMarkdown = (content) => `<p class="md">${content}</p>`;
        await showAnswer(page, answerData({ answer: 'Hello [1]' }));
        assert.ok(page.$('.conv-answer p.md'));
        assert.equal(page.$$('.conv-answer .conv-mark').length, 1, 'chips are placed in the rendered markup');

        page.window.renderAnswerMarkdown = () => { throw new Error('marked is not ready'); };
        await showAnswer(page, answerData({ answer: 'Hello again' }));
        assert.equal(page.$('.conv-answer').textContent.trim(), 'Hello again');
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

// --- where a question's loading cues belong -------------------------------------

const barLine = (page) => page.text('#searchLiveStatus [data-status-now]');
const shown = (page) => page.$('#searchLiveStatus').dataset.active;
const loadingClass = (page) => page.document.body.classList.contains('search-loading');
const stageEvent = (stage, state) => ({ type: 'stage', stage, state });
const detailEvent = (stage, detail) => ({ type: 'detail', stage, detail });

/** A bar question that waits until the test lets it go; `emit` feeds it progress events. */
async function askFromBar(page, question = 'When does Shabbat end?', request = {}) {
    let release;
    let fail;
    let emit = () => {};
    page.setAsk((q, opts) => new Promise((resolve, reject) => {
        release = resolve;
        fail = reject;
        emit = (event) => opts.onProgress?.(event);
    }));
    const pending = page.ui.askFromSearch(question, request, { surface: page.ui.askSurface() });
    await page.flush();
    return { pending, release: (data) => release(data ?? answerData()), fail: (error) => fail(error), emit: async (event) => { emit(event); await page.flush(); } };
}

test('askSurface sends a fresh bar question to the bar, and everything else to the panel', async () => {
    const page = await openAnswerPage();
    try {
        assert.equal(page.ui.askSurface(), 'bar');
        assert.equal(page.ui.askSurface({ origin: 'bar' }), 'bar');
        assert.equal(page.ui.askSurface({ origin: 'panel' }), 'panel');
        assert.equal(page.ui.askSurface({ followUp: true }), 'panel');
        await page.ui.open();
        await page.flush();
        assert.equal(page.ui.askSurface(), 'panel', 'with the panel on screen the answer loads there');
    } finally {
        page.close();
    }
});

test('a page without the bar\'s status line sends every question to the panel', async () => {
    const page = await openAnswerPage({ before: (window) => window.document.getElementById('searchLiveStatus').remove() });
    try {
        assert.equal(page.ui.askSurface(), 'panel');
        assert.equal(loadingClass(page), false);
    } finally {
        page.close();
    }
});

test('a question asked from the bar loads in the bar and the panel stays shut until the answer lands', async () => {
    const page = await openAnswerPage();
    try {
        const ask = await askFromBar(page);
        assert.equal(page.store.getState().surface, 'bar');
        assert.equal(page.hidden('#convPanel'), true);
        assert.equal(page.ui.isShowingAnswer(), false);
        assert.equal(loadingClass(page), true);
        assert.equal(shown(page), 'true');
        assert.equal(barLine(page), 'Getting started…');
        // None of the panel's own cues run for it.
        assert.equal(page.$('#convPanel').dataset.sending, 'false');
        assert.equal(page.$('#convPip').dataset.sending, 'false');

        ask.release();
        await ask.pending;
        await page.flush();
        assert.equal(page.hidden('#convPanel'), false);
        assert.equal(page.$('#convPanel').dataset.size, 'overlay');
        assert.equal(loadingClass(page), false);
        assert.equal(shown(page), 'false');
        assert.match(page.text('#convMessages'), /Light before sunset/);
    } finally {
        page.close();
    }
});

test('the bar says what the AI is doing, as the server reports it', async () => {
    const page = await openAnswerPage();
    try {
        const ask = await askFromBar(page);
        await ask.emit(stageEvent('sources', 'start'));
        // "Getting started" has only just appeared: the first real step waits its turn.
        assert.equal(barLine(page), 'Getting started…');
        await page.tick(800);
        assert.equal(barLine(page), 'Searching the sources…');

        await ask.emit(detailEvent('sources', { kind: 'refs', refs: ['Berakhot 2a', 'Shabbat 31a'], count: 2 }));
        await page.tick(800);
        assert.equal(barLine(page), 'Reading Berakhot 2a and Shabbat 31a…');

        await ask.emit(stageEvent('sources', 'done'));
        await ask.emit(stageEvent('times', 'start'));
        await ask.emit(detailEvent('times', { kind: 'times', topic: 'shabbat' }));
        await page.tick(800);
        assert.equal(barLine(page), 'Checking sunset and nightfall for Shabbat times…');
        // What has finished is listed beside it.
        assert.match(page.text('#searchLiveStatus [data-status-done]'), /Sources/);

        await ask.emit(stageEvent('times', 'done'));
        await ask.emit(stageEvent('thinking', 'start'));
        await ask.emit(detailEvent('thinking', { kind: 'tool', tool: 'get_omer' }));
        await page.tick(800);
        assert.equal(barLine(page), 'Checking today\'s Omer count…');

        ask.release();
        await ask.pending;
    } finally {
        page.close();
    }
});

test('a line that changes right after another waits out the minimum time the first was on screen', async () => {
    const page = await openAnswerPage();
    try {
        const ask = await askFromBar(page);
        await ask.emit(stageEvent('sources', 'start'));
        await page.tick(700);
        assert.equal(barLine(page), 'Searching the sources…');
        await ask.emit(stageEvent('sources', 'done'));
        await ask.emit(stageEvent('times', 'start'));
        // The first line is still being read, so the next one is held back.
        assert.equal(barLine(page), 'Searching the sources…');
        await page.tick(700);
        assert.equal(barLine(page), 'Looking up today\'s zmanim and dates…');
        ask.release();
        await ask.pending;
    } finally {
        page.close();
    }
});

test('the bar speaks Hebrew on a Hebrew page', async () => {
    const page = await openAnswerPage({ lang: 'he' });
    try {
        const ask = await askFromBar(page, 'מתי יוצאת שבת?');
        await ask.emit(stageEvent('times', 'start'));
        await ask.emit(detailEvent('times', { kind: 'times', topic: 'shabbat' }));
        await page.tick(800);
        assert.equal(barLine(page), 'בודקים שקיעה וצאת הכוכבים לזמני שבת…');
        ask.release();
        await ask.pending;
    } finally {
        page.close();
    }
});

test('a bar question that fails opens the panel on the failed turn, with its Retry', async () => {
    const page = await openAnswerPage();
    try {
        const ask = await askFromBar(page);
        assert.equal(page.hidden('#convPanel'), true);
        ask.fail(failure('network'));
        await assert.rejects(ask.pending, { code: 'network' });
        await page.flush();
        assert.equal(page.hidden('#convPanel'), false);
        assert.equal(loadingClass(page), false);
        assert.equal(shown(page), 'false');
        assert.match(turns(page)[0].textContent, /Not sent\./);
        assert.ok(page.$('[data-turn-action="retry"]'));
    } finally {
        page.close();
    }
});

test('opening the panel while the bar waits moves the loading cues to the panel', async () => {
    const page = await openAnswerPage();
    try {
        const ask = await askFromBar(page);
        assert.equal(loadingClass(page), true);

        await page.ui.open();
        await page.flush();
        assert.equal(page.store.getState().surface, 'panel');
        assert.equal(loadingClass(page), false);
        assert.equal(page.$('#convPanel').dataset.sending, 'true');
        assert.ok(page.$('[data-conv-status]'), 'the pending turn carries its own status line now');

        ask.release();
        await ask.pending;
        await page.flush();
        // It was already on screen, so the answer is not presented a second time.
        assert.equal(page.hidden('#convPanel'), false);
        assert.match(page.text('#convMessages'), /Light before sunset/);
        assert.equal(page.$('#convPanel').dataset.sending, 'false');
    } finally {
        page.close();
    }
});

test('showPendingAnswer opens the panel on a question the bar can no longer show', async () => {
    const page = await openAnswerPage();
    try {
        // Nothing is waiting: it does nothing.
        page.ui.showPendingAnswer();
        await page.flush();
        assert.equal(page.hidden('#convPanel'), true);

        const ask = await askFromBar(page);
        page.ui.showPendingAnswer();
        await page.flush();
        assert.equal(page.hidden('#convPanel'), false);
        assert.equal(page.$('#convPanel').dataset.sending, 'true');
        assert.equal(loadingClass(page), false);
        assert.equal(page.store.getState().surface, 'panel');

        ask.release();
        await ask.pending;
    } finally {
        page.close();
    }
});

test('a follow-up from the bar loads in the panel even though it was typed in the bar', async () => {
    const page = await openAnswerPage();
    try {
        await page.ui.askFromSearch('First question');
        await page.flush();
        await page.ui.close();
        await page.flush();
        let release;
        page.setAsk(() => new Promise((resolve) => { release = resolve; }));
        const pending = page.ui.askFromSearch('And then?', {}, { followUp: true, surface: 'bar' });
        await page.flush();
        assert.equal(page.hidden('#convPanel'), false);
        assert.equal(loadingClass(page), false);
        assert.equal(page.$('#convPanel').dataset.sending, 'true');
        release(answerData());
        await pending;
    } finally {
        page.close();
    }
});

test('a question asked in the panel never lights the bar', async () => {
    const page = await openAnswerPage({ signedIn: true });
    try {
        await page.ui.open({ fresh: true });
        await page.flush();
        let release;
        page.api.askInConversation = async (id, { question }) => {
            await new Promise((resolve) => { release = resolve; });
            return {
                user_message: { id: 'u1', role: 'user', content: question, status: 'complete' },
                assistant_message: { id: 'a1', role: 'assistant', content: 'Done.', status: 'complete', citations: [] },
                conversation: { id, title: question, minhag: 'All' },
            };
        };
        const sending = page.ask('In the panel');
        await page.flush();
        assert.equal(page.$('#convPanel').dataset.sending, 'true');
        assert.equal(loadingClass(page), false);
        assert.equal(shown(page), 'false');
        release();
        await sending;
    } finally {
        page.close();
    }
});
