/**
 * static/js/ask-progress.js -- the live status of an AI answer: the step
 * state machine behind the status line, its bilingual labels, and the NDJSON
 * reader both ask clients share.
 *
 * Run with: node --test tests_js/*.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsmModule } = require('./helpers/esm_harness');

async function load() {
    const mod = await loadEsmModule('static/js/ask-progress.js', {});
    return mod.namespace;
}

const start = (stage) => ({ type: 'stage', stage, state: 'start' });
const done = (stage) => ({ type: 'stage', stage, state: 'done' });

function apply(ns, events) {
    return events.reduce((state, event) => ns.applyProgressEvent(state, event), ns.createProgress());
}

// A Response whose body arrives in the given chunks (strings or bytes).
function streamResponse(chunks, { neverEnds = false } = {}) {
    const encoder = new TextEncoder();
    let i = 0;
    let cancelled = false;
    let release = null;
    return {
        cancelled: () => cancelled,
        body: {
            getReader: () => ({
                read: () => {
                    if (i < chunks.length) {
                        const chunk = chunks[i++];
                        return Promise.resolve({ done: false, value: typeof chunk === 'string' ? encoder.encode(chunk) : chunk });
                    }
                    if (!neverEnds) return Promise.resolve({ done: true, value: undefined });
                    return new Promise((resolve) => { release = () => resolve({ done: true, value: undefined }); });
                },
                cancel: async () => { cancelled = true; if (release) release(); },
            }),
        },
    };
}

test('events build up an ordered state, ignoring duplicates and unknown steps', async () => {
    const ns = await load();
    const state = apply(ns, [start('sources'), start('sources'), start('bogus'), { type: 'ping' }, done('sources')]);
    assert.deepEqual(state.order, ['sources']);
    assert.equal(state.status.sources, 'done');
    const unchanged = ns.applyProgressEvent(state, done('sources'));
    assert.equal(unchanged, state, 'an event that changes nothing returns the same object');
});

test('a step can run again after it finished', async () => {
    const ns = await load();
    const state = apply(ns, [start('commentary'), done('commentary'), start('commentary')]);
    assert.equal(state.status.commentary, 'active');
    assert.deepEqual(state.order, ['commentary']);
});

test('before anything starts there is nothing to name', async () => {
    const ns = await load();
    assert.deepEqual(ns.progressView(ns.createProgress()), { active: null, detail: null, done: [] });
    assert.equal(ns.activeLabel(null, 'en'), 'Getting started');
    assert.equal(ns.activeLabel(null, 'he'), 'מתחילים');
});

test('the status names the longest-running step and lists finished ones in start order', async () => {
    const ns = await load();
    const state = apply(ns, [
        start('sources'), start('commentary'), start('customs'), start('times'),
        done('times'), done('customs'),
    ]);
    const view = ns.progressView(state);
    assert.equal(view.active, 'sources');
    assert.deepEqual(view.done, ['customs', 'times']);
});

test('when the running step ends the next one takes over', async () => {
    const ns = await load();
    const state = apply(ns, [
        start('sources'), start('commentary'), done('sources'),
    ]);
    assert.equal(ns.progressView(state).active, 'commentary');
});

test('the model call outranks lookups still winding down', async () => {
    const ns = await load();
    const state = apply(ns, [start('sources'), start('commentary'), done('sources'), start('thinking')]);
    assert.equal(ns.progressView(state).active, 'thinking');
});

test('once every lookup is done and the model has not started, the model is what remains', async () => {
    const ns = await load();
    const state = apply(ns, [start('sources'), done('sources'), start('times'), done('times')]);
    assert.equal(ns.progressView(state).active, 'thinking');
    assert.deepEqual(ns.progressView(state).done, ['sources', 'times']);
});

test('the thinking step is never listed as finished', async () => {
    const ns = await load();
    const state = apply(ns, [start('thinking'), done('thinking')]);
    assert.deepEqual(ns.progressView(state).done, []);
});

test('every step has an English and a Hebrew label', async () => {
    const ns = await load();
    for (const id of ns.STAGE_IDS) {
        assert.ok(ns.activeLabel(id, 'en').length > 3, `${id} en`);
        assert.match(ns.activeLabel(id, 'he'), /[֐-׿]/, `${id} he`);
        assert.notEqual(ns.activeLabel(id, 'en'), ns.activeLabel(id, 'he'));
        if (id !== 'thinking') {
            assert.ok(ns.doneLabel(id, 'en'));
            assert.match(ns.doneLabel(id, 'he'), /[֐-׿]/);
        }
    }
    assert.equal(ns.doneLabel('thinking', 'en'), '');
});

// -- what a running step is doing right now ---------------------------------

const detail = (stage, body) => ({ type: 'detail', stage, detail: body });
const refsOf = (refs, count = refs.length) => ({ kind: 'refs', refs, count });
const toolOf = (tool, ref) => ({ kind: 'tool', tool, ...(ref ? { ref } : {}) });

test('a detail is kept for its step until the step ends or the server clears it', async () => {
    const ns = await load();
    let state = apply(ns, [start('sources'), detail('sources', refsOf(['Berakhot 2a']))]);
    assert.deepEqual(state.details.sources, refsOf(['Berakhot 2a']));
    assert.deepEqual(ns.progressView(state).detail, refsOf(['Berakhot 2a']));

    state = ns.applyProgressEvent(state, done('sources'));
    assert.deepEqual(state.details, {}, 'a finished step is no longer doing the thing it described');

    state = apply(ns, [start('thinking'), detail('thinking', toolOf('get_omer')), detail('thinking', null)]);
    assert.deepEqual(state.details, {});
});

test('details that change nothing, or that the page has no words for, return the same state', async () => {
    const ns = await load();
    const state = apply(ns, [start('thinking'), detail('thinking', toolOf('get_omer'))]);
    assert.equal(ns.applyProgressEvent(state, detail('thinking', toolOf('get_omer'))), state);
    assert.equal(ns.applyProgressEvent(state, detail('not-a-stage', toolOf('get_omer'))), state);
    assert.equal(ns.applyProgressEvent(state, detail('thinking', { kind: 'free-text', text: 'hi' })), state);
    assert.equal(ns.applyProgressEvent(state, detail('thinking', 'a string')), state);
    assert.equal(ns.applyProgressEvent(state, detail('sources', null)), state, 'clearing what is not there');
});

test('a detail may arrive before its step starts, as the times topic does', async () => {
    const ns = await load();
    const state = apply(ns, [detail('times', { kind: 'times', topic: 'shabbat' }), start('times')]);
    assert.deepEqual(ns.progressView(state), { active: 'times', detail: { kind: 'times', topic: 'shabbat' }, done: [] });
});

test('a step that can say what it is doing outranks a lookup that only has a name; the model call outranks both', async () => {
    const ns = await load();
    let state = apply(ns, [
        start('sources'), start('commentary'), start('customs'),
        detail('customs', { kind: 'community', community: 'Sephardi' }),
    ]);
    assert.equal(ns.progressView(state).active, 'customs');
    assert.equal(ns.progressView(state).detail.community, 'Sephardi');

    state = apply(ns, [start('sources'), start('customs'), detail('customs', { kind: 'community', community: 'Sephardi' }), start('thinking')]);
    assert.equal(ns.progressView(state).active, 'thinking');
    assert.equal(ns.progressView(state).detail, null);

    state = ns.applyProgressEvent(state, detail('thinking', toolOf('get_parasha')));
    assert.deepEqual(ns.progressView(state).detail, toolOf('get_parasha'));
});

test('between the last lookup and the model call the model\'s own detail, if any, still shows', async () => {
    const ns = await load();
    const state = apply(ns, [start('sources'), done('sources'), detail('thinking', toolOf('web_search'))]);
    assert.deepEqual(ns.progressView(state), { active: 'thinking', detail: toolOf('web_search'), done: ['sources'] });
});

test('viewKey changes when the step or what it is doing changes, and only then', async () => {
    const ns = await load();
    const a = ns.progressView(apply(ns, [start('sources')]));
    const b = ns.progressView(apply(ns, [start('sources'), detail('sources', refsOf(['Shabbat 31a']))]));
    const c = ns.progressView(apply(ns, [start('sources'), detail('sources', refsOf(['Shabbat 31a'])), start('times')]));
    assert.notEqual(ns.viewKey(a), ns.viewKey(b));
    assert.equal(ns.viewKey(b), ns.viewKey(c), 'a lookup winding down behind it does not change the line');
    assert.equal(ns.viewKey(ns.progressView(ns.createProgress())), '|');
});

test('every kind of time question has an English and a Hebrew line', async () => {
    const ns = await load();
    const seen = new Set();
    for (const topic of ['shabbat', 'zmanim', 'omer', 'parasha', 'holiday']) {
        const en = ns.detailLabel({ kind: 'times', topic }, 'en');
        const he = ns.detailLabel({ kind: 'times', topic }, 'he');
        assert.ok(en.length > 8, topic);
        assert.match(he, /[֐-׿]/, topic);
        seen.add(en);
    }
    assert.equal(seen.size, 5);
    assert.match(ns.detailLabel({ kind: 'times', topic: 'shabbat' }, 'en'), /sunset and nightfall/i, 'says what the lookup really returns');
    assert.equal(ns.detailLabel({ kind: 'times', topic: 'nope' }, 'en'), '');
});

test('the sources line names up to three references and counts the rest', async () => {
    const ns = await load();
    assert.equal(ns.detailLabel(refsOf(['Berakhot 2a']), 'en'), 'Reading Berakhot 2a');
    assert.equal(ns.detailLabel(refsOf(['Berakhot 2a', 'Shabbat 31a']), 'en'), 'Reading Berakhot 2a and Shabbat 31a');
    assert.equal(
        ns.detailLabel(refsOf(['Berakhot 2a', 'Shabbat 31a', 'Eruvin 3b'], 8), 'en'),
        'Reading Berakhot 2a, Shabbat 31a, Eruvin 3b and 5 more',
    );
    assert.equal(ns.detailLabel(refsOf(['Berakhot 2a', 'Shabbat 31a'], 5), 'he'), 'קוראים Berakhot 2a, Shabbat 31a ועוד 3');
    assert.equal(ns.detailLabel(refsOf(['Berakhot 2a'], 1), 'he'), 'קוראים Berakhot 2a');
    assert.equal(ns.detailLabel({ kind: 'refs', refs: ['', '  '], count: 4 }, 'en'), '', 'nothing to name');
    assert.equal(ns.detailLabel(refsOf(['Berakhot 2a']), 'en', { ref: (r) => r.toUpperCase() }), 'Reading BERAKHOT 2A');
});

test('the customs line names the community the way the page does', async () => {
    const ns = await load();
    const community = { kind: 'community', community: 'Sephardi' };
    assert.equal(ns.detailLabel(community, 'en'), 'Checking Sephardi customs');
    assert.equal(ns.detailLabel(community, 'he', { community: () => 'ספרדי' }), 'בודקים מנהגי ספרדי');
    assert.equal(ns.detailLabel({ kind: 'community', community: '  ' }, 'en'), '');
});

test('a tool call is named, and a source it opens is named with its reference', async () => {
    const ns = await load();
    assert.equal(ns.detailLabel(toolOf('get_text_by_ref', 'Shabbat 31a'), 'en'), 'Reading Shabbat 31a');
    assert.equal(ns.detailLabel(toolOf('get_text_by_ref', 'Shabbat 31a'), 'he'), 'קוראים Shabbat 31a');
    assert.equal(ns.detailLabel(toolOf('get_text_by_ref'), 'en'), 'Reading a source');
    assert.match(ns.detailLabel(toolOf('get_text_by_ref'), 'he'), /[֐-׿]/);
    assert.equal(ns.detailLabel(toolOf('web_search'), 'en'), 'Searching the web');
    assert.match(ns.detailLabel(toolOf('web_search'), 'he'), /[֐-׿]/);
    assert.equal(ns.detailLabel(toolOf('get_zmanim'), 'en'), ns.detailLabel({ kind: 'times', topic: 'zmanim' }, 'en'));
    assert.equal(ns.detailLabel(toolOf('a_tool_from_the_future'), 'en'), '', 'unknown tools fall back to the step');
});

test('every AI tool the server can run has a line in both languages', async () => {
    const ns = await load();
    const tools = [
        'search_judaic_texts', 'get_text_by_ref', 'search_responsa_external', 'get_zmanim', 'get_hebrew_date',
        'get_parasha', 'get_omer', 'get_holidays', 'get_daily_study', 'web_search', 'lookup_word_meaning',
        'translate_text', 'get_commentaries', 'search_community_customs', 'get_community_profile', 'browse_library',
        'search_library', 'get_prayer_text', 'get_daily_zmanim_summary', 'convert_measurements',
        'calculate_hebrew_date_math', 'format_source_citation',
    ];
    for (const tool of tools) {
        assert.ok(ns.detailLabel(toolOf(tool), 'en'), `${tool} en`);
        assert.match(ns.detailLabel(toolOf(tool), 'he'), /[֐-׿]/, `${tool} he`);
    }
});

test('activeLabel prefers what a step is doing and falls back to the step\'s own words', async () => {
    const ns = await load();
    assert.equal(ns.activeLabel('sources', 'en'), 'Searching the sources');
    assert.equal(ns.activeLabel('sources', 'en', refsOf(['Berakhot 2a'])), 'Reading Berakhot 2a');
    assert.equal(ns.activeLabel('sources', 'en', { kind: 'free-text' }), 'Searching the sources');
    assert.equal(ns.activeLabel('thinking', 'he', toolOf('get_omer')), ns.detailLabel(toolOf('get_omer'), 'he'));
});

test('the stream reader reports steps and resolves with the terminal result', async () => {
    const ns = await load();
    const seen = [];
    const response = streamResponse([
        `${JSON.stringify(start('sources'))}\n${JSON.stringify({ type: 'ping' })}\n`,
        `${JSON.stringify({ type: 'result', payload: { answer: 'A' } })}\n`,
    ]);
    const terminal = await ns.readProgressStream(response, (event) => seen.push(event));
    assert.deepEqual(terminal, { type: 'result', payload: { answer: 'A' } });
    assert.deepEqual(seen, [start('sources'), { type: 'ping' }]);
    assert.equal(response.cancelled(), true, 'the body is released once the answer is in');
});

test('a line split across chunks, even inside a multi-byte Hebrew letter, is reassembled', async () => {
    const ns = await load();
    const bytes = new TextEncoder().encode(`${JSON.stringify({ type: 'result', payload: { answer: 'שלום' } })}\n`);
    // Each Hebrew letter is two bytes: cut between the halves of one.
    const cut = bytes.indexOf(0xd7) + 1;
    const response = streamResponse([bytes.slice(0, cut), bytes.slice(cut)]);
    const terminal = await ns.readProgressStream(response, () => {});
    assert.equal(terminal.payload.answer, 'שלום');
});

test('an unterminated final line is still read', async () => {
    const ns = await load();
    const response = streamResponse([JSON.stringify({ type: 'error', status: 500, detail: 'x' })]);
    const terminal = await ns.readProgressStream(response, () => {});
    assert.equal(terminal.type, 'error');
});

test('malformed lines are skipped, not fatal', async () => {
    const ns = await load();
    const response = streamResponse([
        `not json\n${JSON.stringify(start('times'))}\n{"type":\n${JSON.stringify({ type: 'result', payload: {} })}\n`,
    ]);
    const seen = [];
    const terminal = await ns.readProgressStream(response, (event) => seen.push(event));
    assert.equal(terminal.type, 'result');
    assert.deepEqual(seen, [start('times')]);
});

test('a throwing progress handler never aborts the answer', async () => {
    const ns = await load();
    const response = streamResponse([
        `${JSON.stringify(start('sources'))}\n${JSON.stringify({ type: 'result', payload: { ok: 1 } })}\n`,
    ]);
    const terminal = await ns.readProgressStream(response, () => { throw new Error('ui blew up'); });
    assert.deepEqual(terminal.payload, { ok: 1 });
});

test('a stream that ends without a terminal line rejects as interrupted', async () => {
    const ns = await load();
    const response = streamResponse([`${JSON.stringify(start('sources'))}\n`]);
    await assert.rejects(ns.readProgressStream(response, () => {}), (error) => {
        assert.equal(error.interrupted, true);
        assert.match(error.message, /interrupted/);
        return true;
    });
});

test('a stream that outlives its deadline is cut and rejects', async () => {
    const ns = await load();
    const response = streamResponse([`${JSON.stringify(start('sources'))}\n`], { neverEnds: true });
    await assert.rejects(ns.readProgressStream(response, () => {}, { timeoutMs: 20 }), (error) => {
        assert.equal(error.interrupted, true);
        assert.match(error.message, /too long/);
        return true;
    });
    assert.equal(response.cancelled(), true);
});

test('without a streaming body the whole text is read as NDJSON', async () => {
    const ns = await load();
    const text = `${JSON.stringify(start('sources'))}\n${JSON.stringify({ type: 'result', payload: { answer: 'B' } })}\n`;
    const seen = [];
    const terminal = await ns.readProgressStream({ text: async () => text }, (event) => seen.push(event));
    assert.equal(terminal.payload.answer, 'B');
    assert.deepEqual(seen, [start('sources')]);
});

test('only an ndjson content type is treated as a progress stream', async () => {
    const ns = await load();
    const withType = (value) => ({ headers: { get: () => value } });
    assert.equal(ns.isProgressResponse(withType('application/x-ndjson')), true);
    assert.equal(ns.isProgressResponse(withType('Application/X-NDJSON; charset=utf-8')), true);
    assert.equal(ns.isProgressResponse(withType('application/json')), false);
    assert.equal(ns.isProgressResponse({}), false);
});
