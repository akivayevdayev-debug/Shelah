/**
 * static/js/hebrew-keyboard.js -- the on-screen keyboard under the search
 * bar: which layout it opens in, typing at the caret (and firing `input`),
 * surrogate-safe backspace, the EN/עב toggle, focus staying in the field,
 * Escape / outside click / the button closing it, the phone's own keyboard
 * held down on a touch screen, labels following the site's language, and
 * the standard layouts: the full Israeli (SI-1452) and US keyboards with
 * Shift/Caps/Enter on a wide bar, the phone layouts with "?123" on a narrow one.
 *
 * Run with: node --test tests_js/*.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { loadEsmModule } = require('./helpers/esm_harness');

const MARKUP = `
<form id="searchForm">
  <input type="text" id="searchInput">
  <button type="button" id="hebrewKeyboardBtn" aria-expanded="false"></button>
  <div id="hebrewKeyboard" class="hidden"></div>
  <div id="searchSuggestions" class="hidden"></div>
</form>
<button id="elsewhere">elsewhere</button>`;

async function setup({ lang = 'en', coarse = false, width = 0 } = {}) {
    const dom = new JSDOM(`<!doctype html><html lang="${lang}"><body>${MARKUP}</body></html>`, { pretendToBeVisual: true });
    const win = dom.window;
    win.matchMedia = (q) => ({ matches: coarse && q === '(pointer: coarse)' });
    const { namespace } = await loadEsmModule('static/js/hebrew-keyboard.js', {});
    const doc = win.document;
    // jsdom has no layout: give the bar a width (0 = unknown -> full keyboard).
    doc.getElementById('searchForm').getBoundingClientRect = () => ({ width, height: 40, left: 0, top: 0, right: width, bottom: 40 });
    const kbd = namespace.installHebrewKeyboard({ doc, win });
    const $ = (sel) => doc.querySelector(sel);
    const key = (text) => doc.querySelector(`.kbd-key[data-text="${text}"]`);
    return { win, doc, kbd, $, key };
}

test('returns null when the page has no keyboard markup', async () => {
    const dom = new JSDOM('<!doctype html><html><body><input id="searchInput"></body></html>');
    const { namespace } = await loadEsmModule('static/js/hebrew-keyboard.js', {});
    assert.equal(namespace.installHebrewKeyboard({ doc: dom.window.document, win: dom.window }), null);
});

test('the button opens Hebrew letters on the English site, with ARIA and focus in the field', async () => {
    const { kbd, $, doc } = await setup();
    const btn = $('#hebrewKeyboardBtn');
    assert.equal(btn.getAttribute('aria-label'), 'Hebrew keyboard');
    btn.click();
    assert.equal(kbd.isOpen(), true);
    assert.equal(kbd.layout(), 'he');
    assert.equal(btn.getAttribute('aria-expanded'), 'true');
    assert.equal($('#hebrewKeyboard').classList.contains('hidden'), false);
    assert.equal($('#hebrewKeyboard').getAttribute('aria-label'), 'Hebrew keyboard');
    assert.equal($('#searchForm').classList.contains('kbd-open'), true);
    assert.equal(doc.activeElement, $('#searchInput'));
    // Final letters and both marks are there.
    for (const ch of ['ך', 'ם', 'ן', 'ף', 'ץ', '׳', '״']) assert.ok(doc.querySelector(`.kbd-key[data-text="${ch}"]`), ch);
    assert.equal(doc.querySelector('.kbd-key[data-text="ק"]').getAttribute('lang'), 'he');
});

test('the Hebrew site opens English letters', async () => {
    const { kbd, $ } = await setup({ lang: 'he' });
    assert.equal($('#hebrewKeyboardBtn').getAttribute('aria-label'), 'מקלדת עברית');
    kbd.open();
    assert.equal(kbd.layout(), 'en');
    assert.ok($('.kbd-key[data-text="q"]'));
    assert.equal($('.kbd-toggle').textContent, 'עב');
});

test('keys type at the caret, replace a selection and fire input', async () => {
    const { kbd, $, key } = await setup();
    const input = $('#searchInput');
    let inputs = 0;
    input.addEventListener('input', () => inputs++);
    input.value = 'שע';
    kbd.open();
    input.setSelectionRange(1, 1);
    key('מ').click();
    assert.equal(input.value, 'שמע');
    assert.equal(input.selectionStart, 2);
    $('.kbd-key-space').click();
    assert.equal(input.value, 'שמ ע');
    input.setSelectionRange(0, 4);
    key('א').click();
    assert.equal(input.value, 'א');
    assert.equal(inputs, 3);
});

test('backspace deletes one character, a whole selection, a whole surrogate pair, and nothing at the start', async () => {
    const { kbd, $ } = await setup();
    const input = $('#searchInput');
    let inputs = 0;
    input.addEventListener('input', () => inputs++);
    kbd.open();
    const bs = () => $('.kbd-backspace').click();
    input.value = 'אב😀';
    input.setSelectionRange(4, 4);
    bs();
    assert.equal(input.value, 'אב');
    bs();
    assert.equal(input.value, 'א');
    input.value = 'שלום';
    input.setSelectionRange(1, 3);
    bs();
    assert.equal(input.value, 'שם');
    input.setSelectionRange(0, 0);
    bs();
    assert.equal(input.value, 'שם');
    assert.equal(inputs, 3);
});

test('a key press is cancelled at pointerdown and mousedown so the field keeps focus', async () => {
    const { kbd, win, key } = await setup();
    kbd.open();
    for (const type of ['pointerdown', 'mousedown']) {
        const ev = new win.Event(type, { bubbles: true, cancelable: true });
        key('ש').dispatchEvent(ev);
        assert.equal(ev.defaultPrevented, true, type);
    }
});

test('the toggle switches layouts and keeps focus on itself when focused', async () => {
    const { kbd, $, doc } = await setup();
    kbd.open();
    const toggle = $('.kbd-toggle');
    assert.equal(toggle.textContent, 'EN');
    assert.equal(toggle.getAttribute('aria-label'), 'Switch to English letters');
    toggle.focus();
    toggle.click();
    assert.equal(kbd.layout(), 'en');
    assert.equal($('#hebrewKeyboard').getAttribute('aria-label'), 'English keyboard');
    assert.equal(doc.activeElement, $('.kbd-toggle'));
    assert.equal($('.kbd-key-mark'), null, 'the English keyboard has no Hebrew marks');
    // The chosen layout is kept across close and reopen.
    kbd.close();
    kbd.open();
    assert.equal(kbd.layout(), 'en');
});

test('Escape closes it and returns focus to the button, unless suggestions are showing', async () => {
    const { kbd, $, win, doc } = await setup();
    const btn = $('#hebrewKeyboardBtn');
    let bubbled = 0;
    doc.addEventListener('keydown', () => bubbled++);
    kbd.open();
    $('#searchSuggestions').classList.remove('hidden');
    $('#searchInput').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(kbd.isOpen(), true, 'suggestions close first');
    assert.equal(bubbled, 1);
    $('#searchSuggestions').classList.add('hidden');
    $('#searchInput').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(kbd.isOpen(), false);
    assert.equal(bubbled, 1, 'only the keyboard closes (the phone search tray stays)');
    assert.equal(doc.activeElement, btn);
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    assert.equal($('#hebrewKeyboard').classList.contains('hidden'), true);
    assert.equal($('#searchForm').classList.contains('kbd-open'), false);
});

test('a click outside the search form closes it; a click inside does not', async () => {
    const { kbd, $ } = await setup();
    kbd.open();
    $('#searchInput').click();
    assert.equal(kbd.isOpen(), true);
    $('#elsewhere').click();
    assert.equal(kbd.isOpen(), false);
});

test('the button toggles it closed and takes focus back', async () => {
    const { kbd, $, doc } = await setup();
    const btn = $('#hebrewKeyboardBtn');
    btn.click();
    btn.click();
    assert.equal(kbd.isOpen(), false);
    assert.equal(doc.activeElement, btn);
});

test('on a touch screen the phone keyboard stays down while it is open', async () => {
    const { kbd, $ } = await setup({ coarse: true });
    const input = $('#searchInput');
    kbd.open();
    assert.equal(input.getAttribute('inputmode'), 'none');
    kbd.close();
    assert.equal(input.hasAttribute('inputmode'), false);
});

test('a mouse screen leaves inputmode alone', async () => {
    const { kbd, $ } = await setup();
    kbd.open();
    assert.equal($('#searchInput').hasAttribute('inputmode'), false);
});

test('the panel height is passed to the form for the suggestions offset, and cleared on close', async () => {
    const { kbd, $ } = await setup();
    kbd.open();
    assert.match($('#searchForm').style.getPropertyValue('--hebrew-kbd-h'), /^\d+px$/);
    kbd.close();
    assert.equal($('#searchForm').style.getPropertyValue('--hebrew-kbd-h'), '');
});

test('labels follow the site language when it changes', async () => {
    const { kbd, $, doc } = await setup();
    kbd.open();
    doc.documentElement.setAttribute('lang', 'he');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal($('#hebrewKeyboardBtn').getAttribute('aria-label'), 'מקלדת עברית');
    assert.equal($('#hebrewKeyboard').getAttribute('aria-label'), 'מקלדת עברית');
    assert.equal($('.kbd-backspace').getAttribute('aria-label'), 'מחיקה');
    assert.equal(kbd.layout(), 'he', 'the open layout is not swapped under the reader');
});

test('uses ShelahMotion present/dismiss when it is there', async () => {
    const { kbd, win, $ } = await setup();
    const calls = [];
    win.ShelahMotion = {
        present: (el, opts) => { calls.push(['present', el.id, opts.preset]); el.classList.remove('hidden'); },
        dismiss: (el, opts) => { calls.push(['dismiss', el.id, opts.preset]); el.classList.add('hidden'); },
    };
    kbd.open();
    kbd.close();
    assert.deepEqual(calls, [['present', 'hebrewKeyboard', 'popover'], ['dismiss', 'hebrewKeyboard', 'popover']]);
    assert.equal($('#hebrewKeyboard').classList.contains('hidden'), true);
});

test('the layout toggle keeps the keyboard (and the phone search tray) open', async () => {
    // The toggle re-renders the keys, so its click target is detached by the
    // time the click reaches the document: an outside-click check there would
    // read it as a click outside and close everything.
    const { kbd, $, doc } = await setup();
    let reachedDocument = 0;
    doc.addEventListener('click', () => reachedDocument++);
    kbd.open();
    $('.kbd-toggle').click();
    assert.equal(kbd.isOpen(), true);
    $('.kbd-key[data-text="a"]').click();
    assert.equal(kbd.isOpen(), true);
    assert.equal(reachedDocument, 0, 'clicks on keys stop at the panel');
    assert.equal($('#searchInput').value, 'a');
});


const rowTexts = (doc) => [...doc.querySelectorAll('#hebrewKeyboard .kbd-row')].map((row) =>
    [...row.querySelectorAll('.kbd-key')].map((k) => k.dataset.text ?? k.dataset.key));

test('a wide bar gets the full Israeli (SI-1452) keyboard, with Latin letters on the keys', async () => {
    const { kbd, doc, key } = await setup({ width: 766 });
    kbd.open();
    assert.equal(kbd.mode(), 'full');
    assert.deepEqual(rowTexts(doc), [
        [';', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'backspace'],
        ['/', "'", 'ק', 'ר', 'א', 'ט', 'ו', 'ן', 'ם', 'פ', ']', '[', '\\'],
        ['caps', 'ש', 'ד', 'ג', 'כ', 'ע', 'י', 'ח', 'ל', 'ך', 'ף', ',', 'enter'],
        ['shift', 'ז', 'ס', 'ב', 'ה', 'נ', 'מ', 'צ', 'ת', 'ץ', '.', 'shift'],
        ['toggle', '׳', ' ', '״'],
    ]);
    assert.equal(key('ק').querySelector('.kbd-sub').textContent, 'E');
    assert.equal(key('ק').querySelector('.kbd-sub').getAttribute('aria-hidden'), 'true');
});

test('the full English keyboard is US QWERTY with every key', async () => {
    const { kbd, doc } = await setup({ width: 766, lang: 'he' });
    kbd.open();
    assert.deepEqual(rowTexts(doc), [
        ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'backspace'],
        ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
        ['caps', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'", 'enter'],
        ['shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', 'shift'],
        ['toggle', ' '],
    ]);
});

test('fullKeyChar: Shift gives the shifted symbol; Shift or Caps on a Hebrew letter gives the Latin capital', async () => {
    const { namespace } = await loadEsmModule('static/js/hebrew-keyboard.js', {});
    const { fullKeyChar } = namespace;
    assert.equal(fullKeyChar('e', 'he'), 'ק');
    assert.equal(fullKeyChar('e', 'he', { shift: true }), 'E');
    assert.equal(fullKeyChar('e', 'he', { caps: true }), 'E');
    assert.equal(fullKeyChar('e', 'he', { shift: true, caps: true }), 'ק');
    assert.equal(fullKeyChar('1', 'he', { shift: true }), '!');
    assert.equal(fullKeyChar('1', 'en', { caps: true }), '1', 'Caps Lock leaves digits alone');
    assert.equal(fullKeyChar(',', 'he'), 'ת');
    assert.equal(fullKeyChar('/', 'en', { shift: true }), '?');
    assert.equal(fullKeyChar('a', 'en', { caps: true }), 'A');
});

test('Shift is one-shot, a quick double tap locks it, and Caps Lock stays on', async () => {
    const { kbd, $, key } = await setup({ width: 766, lang: 'he' });
    const input = $('#searchInput');
    kbd.open();
    $('.kbd-shift').click();
    assert.equal($('.kbd-shift').getAttribute('aria-pressed'), 'true');
    key('A').click();
    key('b').click();
    assert.equal(input.value, 'Ab');
    assert.equal($('.kbd-shift').getAttribute('aria-pressed'), 'false');
    $('.kbd-shift').click();
    $('.kbd-shift').click();
    key('C').click();
    key('D').click();
    assert.equal(input.value, 'AbCD', 'double-tapped Shift stays on');
    $('.kbd-shift').click();
    $('.kbd-caps').click();
    assert.equal($('.kbd-caps').getAttribute('aria-pressed'), 'true');
    key('E').click();
    assert.equal(key('!'), null, 'Caps Lock does not shift digits');
    assert.equal(input.value, 'AbCDE');
});

test('Enter runs the search and closes the keyboard; it does nothing in an empty field', async () => {
    const { kbd, $ } = await setup({ width: 766 });
    let submits = 0;
    $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); submits++; });
    kbd.open();
    $('.kbd-enter').click();
    assert.equal(submits, 0);
    assert.equal(kbd.isOpen(), true);
    $('#searchInput').value = 'שמע';
    $('.kbd-enter').click();
    assert.equal(submits, 1);
    assert.equal(kbd.isOpen(), false);
});

test('a narrow bar gets the standard phone Hebrew layout', async () => {
    const { kbd, doc } = await setup({ width: 304 });
    kbd.open();
    assert.equal(kbd.mode(), 'compact');
    assert.deepEqual(rowTexts(doc), [
        ['ק', 'ר', 'א', 'ט', 'ו', 'ן', 'ם', 'פ', 'backspace'],
        ['ש', 'ד', 'ג', 'כ', 'ע', 'י', 'ח', 'ל', 'ך', 'ף'],
        ['ז', 'ס', 'ב', 'ה', 'נ', 'מ', 'צ', 'ת', 'ץ'],
        ['layer', 'toggle', '׳', ' ', '״', 'enter'],
    ]);
    assert.equal(doc.querySelector('.kbd-sub'), null, 'no Latin letters on the phone layout');
});

test('the phone English layout has Shift, and ?123 opens digits and symbols', async () => {
    const { kbd, doc, $, key } = await setup({ width: 304, lang: 'he' });
    kbd.open();
    assert.deepEqual(rowTexts(doc), [
        ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
        ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
        ['shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'backspace'],
        ['layer', 'toggle', ',', ' ', '.', 'enter'],
    ]);
    $('.kbd-shift').click();
    key('Q').click();
    assert.equal($('#searchInput').value, 'Q');
    $('.kbd-layer').click();
    assert.equal(rowTexts(doc)[0].join(''), '1234567890');
    assert.ok(key('₪'));
    assert.equal($('.kbd-layer').textContent, 'ABC');
    assert.equal($('.kbd-layer').getAttribute('aria-label'), 'אותיות');
    key('7').click();
    assert.equal($('#searchInput').value, 'Q7');
    $('.kbd-layer').click();
    assert.ok(key('q'), 'back to letters');
});

test('the layout swaps between full and phone when the bar is resized', async () => {
    const { kbd, doc, win } = await setup({ width: 766 });
    let observer = null;
    win.ResizeObserver = class { constructor(cb) { observer = cb; } observe() {} disconnect() {} };
    kbd.open();
    assert.equal(kbd.mode(), 'full');
    doc.getElementById('searchForm').getBoundingClientRect = () => ({ width: 340 });
    observer();
    assert.equal(kbd.mode(), 'compact');
    assert.ok(doc.querySelector('.kbd-layer'));
});
