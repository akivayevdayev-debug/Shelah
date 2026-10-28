/**
 * static/js/common-answers.js -- answers to common questions, shown the
 * moment a reader sends one. Folding must match backend/common_answers.py:
 * both sides check tests_js/fixtures/common_answer_cases.json.
 *
 * Run with: node --test tests_js/*.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { loadEsmModule } = require('./helpers/esm_harness');

const SHARED = require(path.join(__dirname, 'fixtures', 'common_answer_cases.json'));
const SETTING = { kind: 'ask', mode: 'balanced', language: 'en', lens: 'All', web: true };

async function load() {
    const mod = await loadEsmModule('static/js/common-answers.js', {});
    return mod.namespace;
}

// A fake server: the list names one question, its answer is "Not on Shabbat. [1]".
async function fakeServer(ns, { listed = true } = {}) {
    const key = ns.questionKey('Can I cook on Shabbat?', SHARED.rules);
    const print = await ns.fingerprint(key, webcrypto.subtle);
    const calls = [];
    const fetchJson = async (url) => {
        calls.push(url);
        if (url.startsWith('/api/ai/common-answers?')) return { ...SHARED.rules, keys: listed ? [print] : [] };
        if (url.startsWith(`/api/ai/common-answers/${print}?`)) return { answer: 'Not on Shabbat. [1]' };
        return null;
    };
    return { calls, answers: ns.createCommonAnswers({ fetchJson, subtle: webcrypto.subtle }) };
}

for (const { question, key } of SHARED.cases) {
    test(`folds like the server: ${question}`, async () => {
        const ns = await load();
        assert.equal(ns.questionKey(question, SHARED.rules), key);
    });
}

test('fingerprints like the server', async () => {
    const ns = await load();
    assert.equal(await ns.fingerprint(SHARED.fingerprint.key, webcrypto.subtle), SHARED.fingerprint.print);
});

test('no fingerprint without Web Crypto', async () => {
    const ns = await load();
    assert.equal(await ns.fingerprint('x', null), '');
});

test('web search off is part of the setting', async () => {
    const ns = await load();
    assert.match(ns.settingQuery({ ...SETTING, web: false }), /web=0/);
});

test('nothing loads before the panel asks', async () => {
    const ns = await load();
    const { answers, calls } = await fakeServer(ns);
    await answers.prefetch('Can I cook on Shabbat?', SETTING);
    assert.deepEqual(calls, []);
});

test('a listed question is fetched while typed', async () => {
    const ns = await load();
    const { answers } = await fakeServer(ns);
    await answers.load(SETTING);
    assert.equal(await answers.prefetch('can i cook on shabbos', SETTING), 'Not on Shabbat.');
});

test('a fetched answer is there at once on send', async () => {
    const ns = await load();
    const { answers } = await fakeServer(ns);
    await answers.load(SETTING);
    await answers.prefetch('Can I cook on Shabbat?', SETTING);
    assert.equal(answers.instant('can I cook on Shabbos??', SETTING), 'Not on Shabbat.');
});

test('a different question gets nothing at once', async () => {
    const ns = await load();
    const { answers } = await fakeServer(ns);
    await answers.load(SETTING);
    await answers.prefetch('Can I cook on Shabbat?', SETTING);
    assert.equal(answers.instant('Can I not cook on Shabbat?', SETTING), null);
});

test('another setting gets nothing at once', async () => {
    const ns = await load();
    const { answers } = await fakeServer(ns);
    await answers.load(SETTING);
    await answers.prefetch('Can I cook on Shabbat?', SETTING);
    assert.equal(answers.instant('Can I cook on Shabbat?', { ...SETTING, language: 'he' }), null);
});

test('an unlisted question is never fetched', async () => {
    const ns = await load();
    const { answers, calls } = await fakeServer(ns, { listed: false });
    await answers.load(SETTING);
    await answers.prefetch('Can I cook on Shabbat?', SETTING);
    assert.equal(calls.length, 1);
});

test('the list loads once per setting', async () => {
    const ns = await load();
    const { answers, calls } = await fakeServer(ns);
    await answers.load(SETTING);
    await answers.load(SETTING);
    assert.equal(calls.length, 1);
});

test('a failed list means no answers, not an error', async () => {
    const ns = await load();
    const answers = ns.createCommonAnswers({ fetchJson: async () => { throw new Error('offline'); }, subtle: webcrypto.subtle });
    await answers.load(SETTING);
    assert.equal(await answers.prefetch('Can I cook on Shabbat?', SETTING), null);
});
