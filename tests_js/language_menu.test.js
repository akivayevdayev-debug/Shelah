/**
 * static/js/language-menu.js -- the topbar language menu shown once three or
 * more languages are switched on: opening and closing, the keyboard, the
 * outside click, and the tick following <html lang>.
 *
 * Run with: node --test tests_js/*.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { createLanguageMenu } = require('../static/js/language-menu.js');

const MARKUP = `
<header role="banner"><div class="lang-menu" data-lang-menu>
  <button type="button" class="lang-menu-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="langMenu">
    <span data-lang-menu-current>English</span>
  </button>
  <div id="langMenu" class="lang-menu-panel hidden" role="menu">
    <button role="menuitemradio" tabindex="-1" data-lang="en" aria-checked="true"><span class="lang-menu-name" dir="ltr">English</span></button>
    <button role="menuitemradio" tabindex="-1" data-lang="he" aria-checked="false"><span class="lang-menu-name" dir="rtl">עברית</span></button>
    <button role="menuitemradio" tabindex="-1" data-lang="es" aria-checked="false"><span class="lang-menu-name" dir="ltr">Español</span></button>
  </div>
</div></header>
<p id="outside">elsewhere</p>`;

function setup(lang = 'en') {
    const dom = new JSDOM(`<!doctype html><html lang="${lang}"><body>${MARKUP}</body></html>`);
    const { window } = dom;
    const doc = window.document;
    const container = doc.querySelector('[data-lang-menu]');
    const menu = createLanguageMenu(container, { win: window, doc });
    return {
        window,
        doc,
        menu,
        button: doc.querySelector('.lang-menu-btn'),
        panel: doc.querySelector('.lang-menu-panel'),
        item: (code) => doc.querySelector(`[data-lang="${code}"]`),
        key: (target, key) => target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true })),
    };
}

test('a click on the globe button shows the menu', () => {
    const { button, panel } = setup();
    button.click();
    assert.equal(panel.classList.contains('hidden'), false);
});

test('the open menu reports itself expanded', () => {
    const { button } = setup();
    button.click();
    assert.equal(button.getAttribute('aria-expanded'), 'true');
});

test('opening focuses the language on screen', () => {
    const { button, doc, item } = setup('he');
    button.click();
    assert.equal(doc.activeElement, item('he'));
});

test('ArrowDown on the button opens on the first language', () => {
    const { button, doc, item, key } = setup('es');
    key(button, 'ArrowDown');
    assert.equal(doc.activeElement, item('en'));
});

test('ArrowUp on the button opens on the last language', () => {
    const { button, doc, item, key } = setup();
    key(button, 'ArrowUp');
    assert.equal(doc.activeElement, item('es'));
});

test('ArrowDown inside the menu wraps from the last language to the first', () => {
    const { button, doc, item, key } = setup('es');
    button.click();
    key(item('es'), 'ArrowDown');
    assert.equal(doc.activeElement, item('en'));
});

test('End moves to the last language', () => {
    const { button, doc, item, key } = setup();
    button.click();
    key(item('en'), 'End');
    assert.equal(doc.activeElement, item('es'));
});

test('Escape closes the menu', () => {
    const { button, item, key } = setup();
    button.click();
    key(item('en'), 'Escape');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
});

test('Escape gives focus back to the globe button', () => {
    const { button, doc, item, key } = setup();
    button.click();
    key(item('en'), 'Escape');
    assert.equal(doc.activeElement, button);
});

test('the menu hides once closed', async () => {
    const { button, panel } = setup();
    button.click();
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(panel.classList.contains('hidden'), true);
});

test('a press outside the menu closes it', () => {
    const { button, doc, window } = setup();
    button.click();
    doc.getElementById('outside').dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    assert.equal(button.getAttribute('aria-expanded'), 'false');
});

test('the panel moves to <body> so page overlays cannot cover it', () => {
    const { doc, panel } = setup();
    assert.equal(panel.parentElement, doc.body);
});

test('a press inside the moved panel keeps the menu open', () => {
    const { button, item, window } = setup();
    button.click();
    item('es').dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    assert.equal(button.getAttribute('aria-expanded'), 'true');
});

test('picking a language closes the menu', () => {
    const { button, item } = setup();
    button.click();
    item('he').click();
    assert.equal(button.getAttribute('aria-expanded'), 'false');
});

test('the tick follows the page language', async () => {
    const { doc, item } = setup();
    doc.documentElement.setAttribute('lang', 'he');
    await Promise.resolve();
    assert.equal(item('he').getAttribute('aria-checked'), 'true');
});

test('the previous language loses its tick', async () => {
    const { doc, item } = setup();
    doc.documentElement.setAttribute('lang', 'he');
    await Promise.resolve();
    assert.equal(item('en').getAttribute('aria-checked'), 'false');
});

test('the button shows the page language in its own name', async () => {
    const { doc } = setup();
    doc.documentElement.setAttribute('lang', 'es');
    await Promise.resolve();
    assert.equal(doc.querySelector('[data-lang-menu-current]').textContent, 'Español');
});

test('ShelahMotion, when loaded, opens the menu with the popover preset', () => {
    const { window, button } = setup();
    let seen = null;
    window.ShelahMotion = { present: (el, opts) => { seen = opts.preset; el.classList.remove('hidden'); } };
    button.click();
    assert.equal(seen, 'popover');
});
