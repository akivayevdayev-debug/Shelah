/**
 * static/js/state.js community (minhag) accessor and static/js/minhag-setting.js,
 * the settings radio group that changes it.
 *
 * Run with: node --test tests_js/*.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsmModule } = require('./helpers/esm_harness');

function fakeWindow(prefs = {}) {
    const listeners = new Map();
    const saves = [];
    return {
        saves,
        appState: { prefs },
        ShelahPrefs: { save: () => saves.push({ ...prefs }) },
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(fn);
        },
        removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
        dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); return true; },
    };
}

class FakeCustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
}

async function loadState(prefs) {
    const window = fakeWindow(prefs);
    const { namespace } = await loadEsmModule('static/js/state.js', { window, CustomEvent: FakeCustomEvent });
    return { state: namespace, window };
}

test('getMinhag defaults to Sephardi and ignores unknown values', async () => {
    assert.equal((await loadState({})).state.getMinhag(), 'sephardi');
    assert.equal((await loadState({ minhag: 'chabad' })).state.getMinhag(), 'sephardi');
    assert.equal((await loadState({ minhag: ' Ashkenazi ' })).state.getMinhag(), 'ashkenazi');
});

test('setMinhag stores, saves once and fires one change event per real change', async () => {
    const { state, window } = await loadState({});
    const seen = [];
    state.onMinhagChange((minhag, previous) => seen.push([minhag, previous]));

    assert.equal(state.announceMinhag(), true, 'the first announcement says what is in effect');
    assert.equal(state.setMinhag('mizrahi'), true);
    assert.equal(state.setMinhag('mizrahi'), true, 'the same value again is accepted');
    assert.equal(state.setMinhag('reform'), false, 'an unknown value is refused');

    assert.equal(window.appState.prefs.minhag, 'mizrahi');
    assert.deepEqual(window.saves, [{ minhag: 'mizrahi' }]);
    assert.deepEqual(seen, [['sephardi', null], ['mizrahi', 'sephardi']]);
});

test('announceMinhag fires after prefs arrive from the server, and only on a change', async () => {
    const { state, window } = await loadState({});
    const seen = [];
    state.onMinhagChange((minhag) => seen.push(minhag));
    state.announceMinhag();
    window.appState.prefs.minhag = 'ashkenazi'; // shell.js merged the server's prefs
    assert.equal(state.announceMinhag(), true);
    assert.equal(state.announceMinhag(), false);
    assert.deepEqual(seen, ['sephardi', 'ashkenazi']);
});

test('the AI lens is the chat pick when it names a community, else all communities', async () => {
    const { state } = await loadState({});
    assert.equal(state.aiCommunityLens('All'), 'All');
    assert.equal(state.aiCommunityLens(''), 'All');
    assert.equal(state.aiCommunityLens(undefined), 'All');
    assert.equal(state.aiCommunityLens('all'), 'All');
    assert.equal(state.aiCommunityLens('Yemenite'), 'Yemenite');
});

test('haftarahFor picks the Sephardi haftarah only where Hebcal lists one', async () => {
    const { state } = await loadState({});
    const vayetzei = { haftarah: 'Hosea 12:13-14:10', haftarah_sephardic: 'Hosea 11:7-12:12' };
    assert.equal(state.haftarahFor(vayetzei, 'sephardi'), 'Hosea 11:7-12:12');
    assert.equal(state.haftarahFor(vayetzei, 'mizrahi'), 'Hosea 11:7-12:12');
    assert.equal(state.haftarahFor(vayetzei, 'ashkenazi'), 'Hosea 12:13-14:10');
    assert.equal(state.haftarahFor({ haftarah: 'Ezekiel 28:25-29:21' }, 'sephardi'), 'Ezekiel 28:25-29:21');
    assert.equal(state.haftarahFor(null), null);
});

// ── The settings radio group ────────────────────────────────────────────────

function fakeGroup(values) {
    const handlers = [];
    const inputs = values.map((value) => ({ name: 'minhag', value, checked: false }));
    const group = {
        inputs,
        querySelectorAll: (sel) => (sel === 'input[name="minhag"]' ? inputs : []),
        addEventListener: (type, fn) => { if (type === 'change') handlers.push(fn); },
        pick(value) {
            inputs.forEach((input) => { input.checked = input.value === value; });
            const target = inputs.find((input) => input.value === value);
            handlers.forEach((fn) => fn({ target }));
        },
    };
    return group;
}

async function loadSetting(prefs) {
    const window = fakeWindow(prefs);
    const group = fakeGroup(['sephardi', 'mizrahi', 'ashkenazi']);
    const document = { getElementById: (id) => (id === 'minhagSetting' ? group : null) };
    const globals = { window, document, CustomEvent: FakeCustomEvent };
    const setting = (await loadEsmModule('static/js/minhag-setting.js', globals)).namespace;
    const checked = () => group.inputs.filter((input) => input.checked).map((input) => input.value);
    return { setting, window, group, document, checked };
}

test('the radio group shows the saved minhag and saves a new pick', async () => {
    const { setting, window, group, document, checked } = await loadSetting({ minhag: 'ashkenazi' });
    assert.ok(setting.installMinhagSetting({ doc: document }));
    assert.deepEqual(checked(), ['ashkenazi']);

    group.pick('mizrahi');
    assert.equal(window.appState.prefs.minhag, 'mizrahi');
    assert.deepEqual(checked(), ['mizrahi']);
    assert.equal(window.saves.length, 1);
});

test('the radio group follows a change made elsewhere (server prefs)', async () => {
    const { setting, window, document, checked } = await loadSetting({});
    setting.installMinhagSetting({ doc: document });
    assert.deepEqual(checked(), ['sephardi']);
    window.ShelahState.announceMinhag();
    window.appState.prefs.minhag = 'ashkenazi';
    window.ShelahState.announceMinhag();
    assert.deepEqual(checked(), ['ashkenazi']);
});

test('no markup, no setting', async () => {
    const { setting } = await loadSetting({});
    assert.equal(setting.installMinhagSetting({ doc: { getElementById: () => null } }), null);
});
