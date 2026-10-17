/**
 * The "Was this answer helpful?" widget under an answer: what it draws, what a
 * rating sends (and for which stored answer), and the optional comment after a
 * thumbs-down. Boots the real home page in jsdom (tests_js/helpers/shell_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');
const { fakeClerk, withClerk, SIGNED_IN_USER } = require('./helpers/shell_fakes');

const plain = (value) => JSON.parse(JSON.stringify(value));
const HISTORY_ID = '3f2b8c1e-4d5a-4e6f-8a9b-0c1d2e3f4a5b';

async function openFeedbackPage({ routes = {}, clerk = null } = {}) {
    const page = await openShellPage({
        fetch: { '/api/feedback': { ok: true }, ...routes },
        before: (window) => { if (clerk) withClerk(window, clerk); },
    });
    // ask-history.js is a module the harness does not run; only the id check is used here.
    page.window.ShelahAskHistory = { isHistoryId: (value) => /^[0-9a-f-]{36}$/.test(String(value)) };
    page.document.body.insertAdjacentHTML('beforeend', '<div id="feedbackHost"></div>');
    page.takeCalls();
    return page;
}

const render = (page, data, question = 'What is Shabbat?') => {
    page.window.__data = data;
    page.eval(`renderFeedbackWidget(document.getElementById('feedbackHost'), window.__data, ${JSON.stringify(question)})`);
};
const feedbackRequests = (page) => page.takeCalls().filter((request) => request.url === '/api/feedback');
const sent = (request) => JSON.parse(request.init.body);
const state = (page) => page.$('.answer-feedback')?.dataset.feedbackState;

test('with nowhere to draw, nothing happens', async () => {
    const page = await openFeedbackPage();
    try {
        assert.equal(page.eval(`renderFeedbackWidget(null, {}, 'q')`), undefined);
    } finally {
        page.close();
    }
});

test('the widget asks the question and offers a thumbs-up and a thumbs-down', async () => {
    const page = await openFeedbackPage();
    try {
        render(page, {});
        assert.equal(state(page), 'idle');
        assert.equal(page.$('.answer-feedback-prompt').textContent, 'Was this answer helpful?');
        const buttons = page.$$('.answer-feedback-btn');
        assert.deepEqual(buttons.map((button) => button.dataset.verdict), ['helpful', 'not_helpful']);
        assert.deepEqual(buttons.map((button) => button.getAttribute('aria-label')), ['Helpful', 'Not helpful']);
        assert.deepEqual(buttons.map((button) => button.getAttribute('aria-pressed')), ['false', 'false']);
        assert.ok(buttons.every((button) => button.querySelector('svg path')));
    } finally {
        page.close();
    }
});

test('in Hebrew the prompt, labels and thanks are Hebrew', async () => {
    const page = await openFeedbackPage();
    try {
        page.eval(`t = (en, he) => he`);
        render(page, {});
        assert.equal(page.$('.answer-feedback-prompt').textContent, 'האם התשובה הייתה מועילה?');
        assert.deepEqual(page.$$('.answer-feedback-btn').map((button) => button.getAttribute('aria-label')), ['מועיל', 'לא מועיל']);
        page.click(page.$$('.answer-feedback-btn')[0]);
        assert.equal(page.$('.answer-feedback-thanks').textContent, 'תודה על המשוב!');
    } finally {
        page.close();
    }
});

test('a thumbs-up is sent at once with the answer\'s mode, language and stored id, then thanks the reader', async () => {
    const page = await openFeedbackPage({ clerk: fakeClerk({ user: SIGNED_IN_USER }) });
    try {
        render(page, { history_id: HISTORY_ID, meta: { mode: 'deep', language: 'he', fallback: true, safety_class: 'caution' } });
        page.click(page.$$('.answer-feedback-btn')[0]);
        await page.settle();
        const [request] = feedbackRequests(page);
        assert.equal(request.init.method, 'POST');
        assert.equal(request.init.headers['Content-Type'], 'application/json');
        assert.equal(request.init.headers.Authorization, 'Bearer tok-1');
        assert.deepEqual(sent(request), {
            question: 'What is Shabbat?', verdict: 'helpful', comment: '', mode: 'deep', language: 'he',
            fallback: true, safety_class: 'caution', history_id: HISTORY_ID,
        });
        assert.equal(state(page), 'done');
        assert.equal(page.$('.answer-feedback-thanks').textContent, 'Thank you for your feedback!');
    } finally {
        page.close();
    }
});

test('an answer without metadata or a stored id is rated with the defaults and no link', async () => {
    const page = await openFeedbackPage();
    try {
        render(page, undefined, '');
        page.click(page.$$('.answer-feedback-btn')[0]);
        await page.settle();
        assert.deepEqual(sent(feedbackRequests(page)[0]), {
            question: '', verdict: 'helpful', comment: '', mode: 'balanced', language: 'en', fallback: false, safety_class: 'ok',
        });
    } finally {
        page.close();
    }
});

test('which stored answer a rating is about: the owner\'s id, a public link\'s token, or none', async () => {
    const page = await openFeedbackPage();
    try {
        const link = (data) => plain(page.window.eval('feedbackAnswerLink')(data));
        assert.deepEqual(link({ history_id: ` ${HISTORY_ID} ` }), { history_id: HISTORY_ID });
        assert.deepEqual(link({ id: HISTORY_ID }), { history_id: HISTORY_ID });
        assert.deepEqual(link({ history_id: 'not-an-id' }), {});
        assert.deepEqual(link({ public: true, share_token: 'tok-1' }), { share_token: 'tok-1' });
        assert.deepEqual(link({ public: true }), {}, 'a public answer is never linked by id');
        assert.deepEqual(link({ public: true, history_id: HISTORY_ID }), {});
        assert.deepEqual(link(null), {});
        page.window.ShelahAskHistory = undefined;
        assert.deepEqual(link({ history_id: HISTORY_ID }), {});
    } finally {
        page.close();
    }
});

test('a thumbs-down is counted at once and then offers a comment box', async () => {
    const page = await openFeedbackPage();
    try {
        render(page, { history_id: HISTORY_ID });
        const [up, down] = page.$$('.answer-feedback-btn');
        page.click(down);
        await page.settle();
        const requests = feedbackRequests(page);
        assert.equal(requests.length, 1, 'the bare verdict, before any comment');
        assert.deepEqual([sent(requests[0]).verdict, sent(requests[0]).comment], ['not_helpful', '']);
        assert.equal(state(page), 'commenting');
        assert.deepEqual([up.disabled, down.disabled], [true, true]);
        assert.deepEqual([up.getAttribute('aria-pressed'), down.getAttribute('aria-pressed')], ['false', 'true']);
        const textarea = page.$('.answer-feedback-comment-row textarea');
        assert.equal(textarea.getAttribute('maxlength'), '500');
        assert.equal(textarea.getAttribute('placeholder'), 'What went wrong? (optional)');
        assert.equal(page.$('.answer-feedback-submit').textContent, 'Send feedback');
    } finally {
        page.close();
    }
});

test('a comment is sent as a second rating with the same verdict, then the reader is thanked', async () => {
    const page = await openFeedbackPage();
    try {
        render(page, { history_id: HISTORY_ID });
        page.click(page.$$('.answer-feedback-btn')[1]);
        await page.settle();
        page.takeCalls();
        page.$('.answer-feedback-comment-row textarea').value = 'The source was wrong';
        page.click(page.$('.answer-feedback-submit'));
        await page.settle();
        const [request] = feedbackRequests(page);
        assert.deepEqual([sent(request).verdict, sent(request).comment], ['not_helpful', 'The source was wrong']);
        assert.equal(state(page), 'done');
        assert.equal(page.$('.answer-feedback-thanks').textContent, 'Thank you for your feedback!');
    } finally {
        page.close();
    }
});

test('an empty or blank comment sends nothing more and still thanks the reader', async () => {
    const page = await openFeedbackPage();
    try {
        render(page, {});
        page.click(page.$$('.answer-feedback-btn')[1]);
        await page.settle();
        page.takeCalls();
        page.$('.answer-feedback-comment-row textarea').value = '   ';
        page.click(page.$('.answer-feedback-submit'));
        await page.settle();
        assert.deepEqual(feedbackRequests(page), []);
        assert.equal(state(page), 'done');
    } finally {
        page.close();
    }
});

test('a second click on a rated answer is ignored', async () => {
    const page = await openFeedbackPage();
    try {
        render(page, {});
        const [up, down] = page.$$('.answer-feedback-btn');
        page.click(down);
        await page.settle();
        page.takeCalls();
        up.disabled = false;
        page.click(up);
        down.disabled = false;
        page.click(down);
        await page.settle();
        assert.deepEqual(feedbackRequests(page), []);
        assert.equal(state(page), 'commenting');
    } finally {
        page.close();
    }
});

test('a rating that cannot be sent is not the reader\'s problem', async () => {
    const page = await openFeedbackPage({ routes: { '/api/feedback': () => { throw new Error('offline'); } } });
    try {
        render(page, {});
        page.click(page.$$('.answer-feedback-btn')[0]);
        await page.settle();
        assert.equal(state(page), 'done');
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});
