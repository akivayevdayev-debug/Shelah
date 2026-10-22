/**
 * static/js/text-versions.js -- the reader's edition/translation picker:
 * which stored pick a ref gets, the /api/text query, the picker drawn from a
 * payload's allowed versions, and a pick being remembered per book.
 *
 * Run with: node --test tests_js/*.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { loadEsmModule } = require('./helpers/esm_harness');

const MARKUP = `
<fieldset id="readerVersionPicker" class="hidden">
  <label id="readerVersionHeRow"><select id="readerVersionHe"></select></label>
  <label id="readerVersionEnRow"><select id="readerVersionEn"></select></label>
</fieldset>`;

const GENESIS = {
    indexTitle: 'Genesis',
    versions: {
        he: { title: 'Miqra according to the Masorah', label: 'Aleppo Codex (Masorah)' },
        en: { title: 'The Koren Jerusalem Bible', label: 'Orthodox (Koren)' },
        available: [
            { title: 'Miqra according to the Masorah', lang: 'he', label: 'Aleppo Codex (Masorah)' },
            { title: "Tanach with Ta'amei Hamikra", lang: 'he', label: 'Leningrad Codex' },
            { title: 'The Koren Jerusalem Bible', lang: 'en', label: 'Orthodox (Koren)' },
            { title: 'Metsudah Chumash, Metsudah Publications, 2009', lang: 'en', label: 'Metsudah' },
        ],
    },
};

function memoryStorage(initial = {}) {
    const data = { ...initial };
    return {
        getItem: (key) => (key in data ? data[key] : null),
        setItem: (key, value) => { data[key] = String(value); },
        data,
    };
}

async function setup({ minhag = 'sephardi', storage = memoryStorage() } = {}) {
    const dom = new JSDOM(`<!doctype html><html><body>${MARKUP}</body></html>`);
    const { namespace } = await loadEsmModule('static/js/text-versions.js', {});
    const picks = [];
    const picker = namespace.installTextVersionPicker({
        doc: dom.window.document, storage, getMinhag: () => minhag, onPick: (p) => picks.push(p),
    });
    return { dom, doc: dom.window.document, picker, picks, storage, namespace };
}

test('a ref finds the pick of the longest book title it starts with', async () => {
    const { namespace } = await setup();
    const picks = {
        'Shulchan Arukh': { en: 'A' },
        'Shulchan Arukh, Orach Chayim': { en: 'B' },
        Genesis: { he: 'C' },
    };
    assert.deepEqual(namespace.pickForRef('Shulchan Arukh, Orach Chayim 1:1', picks), { en: 'B' });
    assert.deepEqual(namespace.pickForRef('Genesis 1', picks), { he: 'C' });
    assert.equal(namespace.pickForRef('Genesisx 1', picks), null);
    assert.equal(namespace.pickForRef('Exodus 1', picks), null);
});

test('the query leaves out the default community and carries the picks', async () => {
    const { namespace } = await setup();
    assert.equal(namespace.textQuery('Genesis 1', { minhag: 'sephardi', picks: {} }), '');
    assert.equal(namespace.textQuery('Genesis 1', { minhag: 'ashkenazi', picks: {} }), 'minhag=ashkenazi');
    assert.equal(
        namespace.textQuery('Genesis 1', { minhag: 'sephardi', picks: { Genesis: { en: 'Metsudah Chumash' } } }),
        'ven=Metsudah+Chumash',
    );
});

test('the picker lists the allowed versions and names the community default', async () => {
    const { doc, picker } = await setup();
    picker.render(GENESIS);
    assert.equal(doc.getElementById('readerVersionPicker').classList.contains('hidden'), false);
    const en = doc.getElementById('readerVersionEn');
    assert.deepEqual([...en.options].map((o) => o.textContent),
        ['Default for my community (Orthodox (Koren))', 'Orthodox (Koren)', 'Metsudah']);
    assert.equal(en.value, '');
});

test('a text with no choice hides the picker', async () => {
    const { doc, picker } = await setup();
    picker.render({ indexTitle: 'Some Book', versions: { he: null, en: null, available: [
        { title: 'Original', lang: 'he', label: 'Original text' }] } });
    assert.equal(doc.getElementById('readerVersionPicker').classList.contains('hidden'), true);
    picker.render({ error: 'Text not available' });
    assert.equal(doc.getElementById('readerVersionPicker').classList.contains('hidden'), true);
});

test('a pick is remembered for the book and sent with its refs', async () => {
    const storage = memoryStorage();
    const { doc, dom, picker, picks } = await setup({ storage });
    picker.render(GENESIS);
    const en = doc.getElementById('readerVersionEn');
    en.value = 'Metsudah Chumash, Metsudah Publications, 2009';
    en.dispatchEvent(new dom.window.Event('change'));
    assert.deepEqual(picks, [{ book: 'Genesis', lang: 'en', title: 'Metsudah Chumash, Metsudah Publications, 2009' }]);
    assert.match(picker.query('Genesis 5'), /^ven=Metsudah/);
    assert.equal(picker.query('Exodus 1'), '');
    assert.deepEqual(JSON.parse(storage.data['shelah:textVersions']),
        { Genesis: { en: 'Metsudah Chumash, Metsudah Publications, 2009' } });

    // Back to the default clears it.
    en.value = '';
    en.dispatchEvent(new dom.window.Event('change'));
    assert.equal(picker.query('Genesis 5'), '');
});

test('a stored pick the server no longer lists shows as the default', async () => {
    const storage = memoryStorage({ 'shelah:textVersions': JSON.stringify({ Genesis: { en: 'Gone Edition' } }) });
    const { doc, picker } = await setup({ storage });
    picker.render(GENESIS);
    assert.equal(doc.getElementById('readerVersionEn').value, '');
});

test('broken storage never breaks the picker', async () => {
    const storage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
    const { doc, dom, picker } = await setup({ storage });
    picker.render(GENESIS);
    const he = doc.getElementById('readerVersionHe');
    he.value = "Tanach with Ta'amei Hamikra";
    he.dispatchEvent(new dom.window.Event('change'));
    assert.equal(picker.query('Genesis 1'), "vhe=Tanach+with+Ta%27amei+Hamikra");
});
