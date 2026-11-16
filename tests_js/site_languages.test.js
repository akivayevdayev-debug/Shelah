/**
 * A third language: the switched-on list in the page catalog decides which
 * languages the topbar helpers accept, which direction the page takes, and
 * which text an element shows when it has none in the chosen language.
 *
 * Run with: node --test tests_js/*.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTranslator } = require('../static/js/i18n.js');
const { siteLanguage, applyHtmlLanguage, swapLanguageText } = require('../static/js/topbar_shared.js');

const FOUR = createTranslator({
    default: 'en',
    locales: [
        { code: 'en', name: 'English', dir: 'ltr', fallback: null },
        { code: 'he', name: 'עברית', dir: 'rtl', fallback: 'en' },
        { code: 'es', name: 'Español', dir: 'ltr', fallback: 'en' },
        { code: 'ar', name: 'العربية', dir: 'rtl', fallback: 'en' },
    ],
    strings: {},
});

function withLanguages(t, translator) {
    const saved = { i18n: globalThis.ShelahI18n, document: globalThis.document };
    globalThis.ShelahI18n = translator;
    t.after(() => {
        globalThis.ShelahI18n = saved.i18n;
        globalThis.document = saved.document;
    });
}

function fakeHtml() {
    const attrs = {};
    const classes = new Set();
    return {
        attrs,
        classes,
        setAttribute: (name, value) => { attrs[name] = value; },
        classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) },
    };
}

test('normalize keeps a switched-on language', () => {
    assert.equal(FOUR.normalize('es'), 'es');
});

test('normalize drops the region from a language tag', () => {
    assert.equal(FOUR.normalize('es-MX'), 'es');
});

test('normalize turns an unknown language into the default', () => {
    assert.equal(FOUR.normalize('fr'), 'en');
});

test('chain lists a language, then English', () => {
    assert.deepEqual(FOUR.chain('es'), ['es', 'en']);
});

test('siteLanguage accepts a third switched-on language', (t) => {
    withLanguages(t, FOUR);
    assert.equal(siteLanguage('es'), 'es');
});

test('siteLanguage without a page catalog keeps the English and Hebrew pair', (t) => {
    withLanguages(t, undefined);
    assert.equal(siteLanguage('es'), 'en');
});

test('applyHtmlLanguage turns the page right-to-left for Arabic', (t) => {
    withLanguages(t, FOUR);
    const html = fakeHtml();
    globalThis.document = { documentElement: html };
    applyHtmlLanguage('ar');
    assert.equal(html.attrs.dir, 'rtl');
});

test('applyHtmlLanguage keeps Spanish left-to-right', (t) => {
    withLanguages(t, FOUR);
    const html = fakeHtml();
    globalThis.document = { documentElement: html };
    applyHtmlLanguage('es');
    assert.equal(html.classes.has('rtl'), false);
});

test('an element with no Spanish text shows its English text in Spanish', (t) => {
    withLanguages(t, FOUR);
    const el = { dataset: { en: 'Library', he: 'ספרייה' }, textContent: 'ספרייה', childElementCount: 0 };
    swapLanguageText('es', { querySelectorAll: () => [el] });
    assert.equal(el.textContent, 'Library');
});

test('an element with Spanish text shows it', (t) => {
    withLanguages(t, FOUR);
    const el = { dataset: { en: 'Library', he: 'ספרייה', es: 'Biblioteca' }, textContent: 'Library', childElementCount: 0 };
    swapLanguageText('es', { querySelectorAll: () => [el] });
    assert.equal(el.textContent, 'Biblioteca');
});
