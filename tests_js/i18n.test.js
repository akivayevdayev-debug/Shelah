/**
 * static/js/i18n.js -- the browser's interface-text lookup: fallback to
 * English, {placeholders}, plural forms picked by { count }, and what a
 * missing key does in development and in production.
 *
 * Run with: node --test tests_js/*.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTranslator } = require('../static/js/i18n.js');
const { tFor, catalog } = require('./helpers/i18n');

const CATALOG = {
    default: 'en',
    strict: true,
    locales: [
        { code: 'en', name: 'English', dir: 'ltr', fallback: null },
        { code: 'he', name: 'עברית', dir: 'rtl', fallback: 'en' },
    ],
    strings: {
        en: { 'x.hi': 'Hello, {name}', 'x.only_en': 'English only', 'x.items.one': '1 item', 'x.items.other': '{count} items' },
        he: { 'x.hi': 'שלום, {name}', 'x.items.one': 'פריט אחד', 'x.items.two': 'שני פריטים', 'x.items.other': '{count} פריטים' },
    },
};

const i18n = createTranslator(CATALOG);

test('placeholders are filled', () => {
    assert.equal(i18n.translate('he', 'x.hi', { name: 'דוד' }), 'שלום, דוד');
});

test('a string the language lacks comes from English', () => {
    assert.equal(i18n.translate('he', 'x.only_en'), 'English only');
});

test('an unknown language reads English', () => {
    assert.equal(i18n.translate('xx', 'x.hi', { name: 'A' }), 'Hello, A');
});

test('a placeholder with no value is left as written', () => {
    assert.equal(i18n.translate('en', 'x.hi'), 'Hello, {name}');
});

test('count picks the English plural form', () => {
    assert.equal(i18n.translate('en', 'x.items', { count: 3 }), '3 items');
});

test('count picks the singular form', () => {
    assert.equal(i18n.translate('en', 'x.items', { count: 1 }), '1 item');
});

test('count picks the Hebrew dual form', () => {
    assert.equal(i18n.translate('he', 'x.items', { count: 2 }), 'שני פריטים');
});

test('a plural form the language lacks falls back to other', () => {
    assert.equal(i18n.translate('en', 'x.items', { count: 2 }), '2 items');
});

test('a missing key throws while the catalog is strict', () => {
    assert.throws(() => i18n.translate('en', 'x.nope'), /x\.nope/);
});

test('a missing key renders nothing in production', () => {
    const quiet = createTranslator({ ...CATALOG, strict: false });
    const original = console.error;
    console.error = () => {};
    try {
        assert.equal(quiet.translate('en', 'x.nope'), '');
    } finally {
        console.error = original;
    }
});

test('Hebrew reads right to left', () => {
    assert.equal(i18n.direction('he'), 'rtl');
});

test('the languages list carries code, name and direction for a menu', () => {
    assert.deepEqual(i18n.languages.map((l) => [l.code, l.name, l.dir]), [['en', 'English', 'ltr'], ['he', 'עברית', 'rtl']]);
});

test('an empty catalog still answers, in production mode', () => {
    const original = console.error;
    console.error = () => {};
    try {
        assert.equal(createTranslator({}).translate('en', 'x.hi'), '');
    } finally {
        console.error = original;
    }
});

test('the real catalogs carry Hebrew for the shell', () => {
    assert.equal(tFor('he')('shell.places', { count: 3 }), '3 מקומות');
});

test('the real catalogs ship every enabled language to the page, English first', () => {
    assert.deepEqual(catalog.locales.map((l) => l.code), ['en', 'he', 'es', 'ru', 'fr', 'de', 'ar']);
});
