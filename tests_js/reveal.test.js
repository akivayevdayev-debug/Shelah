/**
 * Tests for static/js/reveal.js -- the scroll reveal on the short info pages.
 * Real jsdom documents with a fake IntersectionObserver (jsdom has none), so the
 * selection rules (what is hidden, what is left alone) run against real markup.
 *
 * Run with: node --test tests_js/*.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { initReveal, revealTargets } = require('../static/js/reveal.js');

const PAGE = `<!doctype html><html><body>
<article id="a" data-reveal>
  <div class="legal-toolbar">back</div>
  <h2 id="h1">First</h2>
  <p id="p1">Above the fold</p>
  <h2 id="h2">Second</h2>
  <p id="p2">Below</p>
  <p id="p3">Further below</p>
  <p id="hid" hidden>Not content</p>
  <script id="s">1</script>
</article>
<article id="plain"><p id="x">No opt-in</p></article>
</body></html>`;

/** A document whose elements report a top by id; `observe` is recorded by the fake observer. */
function makePage({ withObserver = true, innerHeight = 800 } = {}) {
    const dom = new JSDOM(PAGE);
    const { window } = dom;
    const tops = { h1: 40, p1: 120, h2: 900, p2: 960, p3: 1500 };
    for (const [id, top] of Object.entries(tops)) {
        window.document.getElementById(id).getBoundingClientRect = () => ({ top });
    }
    Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true });
    const observed = [];
    const unobserved = [];
    let callback = null;
    if (withObserver) {
        window.IntersectionObserver = function FakeObserver(cb, options) {
            callback = cb;
            this.options = options;
            this.observe = (el) => observed.push(el.id);
            this.unobserve = (el) => unobserved.push(el.id);
        };
    }
    return {
        dom,
        doc: window.document,
        observed,
        unobserved,
        fire: (...ids) => callback(ids.map((id) => ({ target: window.document.getElementById(id), isIntersecting: true }))),
        fireOffscreen: (id) => callback([{ target: window.document.getElementById(id), isIntersecting: false }]),
    };
}

test('revealTargets takes the direct children of an opted-in host, not the toolbar, scripts or hidden blocks', () => {
    const { doc, dom } = makePage();
    const ids = revealTargets(doc).map((el) => el.id || el.className);
    assert.deepEqual(ids, ['h1', 'p1', 'h2', 'p2', 'p3']);
    dom.window.close();
});

test('initReveal hides only what starts below the fold and watches exactly that', () => {
    const { doc, observed, dom } = makePage();
    assert.equal(initReveal(doc), 3);
    assert.deepEqual(observed, ['h2', 'p2', 'p3']);
    for (const id of ['h1', 'p1']) assert.equal(doc.getElementById(id).classList.contains('reveal-pending'), false, id);
    for (const id of ['h2', 'p2', 'p3']) assert.equal(doc.getElementById(id).classList.contains('reveal-pending'), true, id);
    assert.equal(doc.getElementById('x').classList.contains('reveal-pending'), false, 'a page without data-reveal is untouched');
    dom.window.close();
});

test('a block is revealed once, then no longer watched', () => {
    const { doc, observed, unobserved, fire, dom } = makePage();
    initReveal(doc);
    fire('h2');
    assert.equal(doc.getElementById('h2').classList.contains('is-revealed'), true);
    assert.deepEqual(unobserved, ['h2']);
    assert.deepEqual(observed, ['h2', 'p2', 'p3'], 'nothing is observed again');
    dom.window.close();
});

test('blocks that arrive together follow one another, capped at three steps', () => {
    const { doc, fire, dom } = makePage();
    initReveal(doc);
    fire('h2', 'p2', 'p3');
    const steps = ['h2', 'p2', 'p3'].map((id) => doc.getElementById(id).style.getPropertyValue('--reveal-i'));
    assert.deepEqual(steps, ['0', '1', '2']);
    dom.window.close();
});

test('an entry that is not intersecting changes nothing', () => {
    const { doc, unobserved, fireOffscreen, dom } = makePage();
    initReveal(doc);
    fireOffscreen('p2');
    assert.equal(doc.getElementById('p2').classList.contains('is-revealed'), false);
    assert.deepEqual(unobserved, []);
    dom.window.close();
});

test('without IntersectionObserver nothing is hidden: the page is simply there', () => {
    const { doc, dom } = makePage({ withObserver: false });
    assert.equal(initReveal(doc), 0);
    assert.equal(doc.querySelectorAll('.reveal-pending').length, 0);
    dom.window.close();
});

test('a page with no data-reveal host creates no observer and hides nothing', () => {
    const dom = new JSDOM('<!doctype html><body><article><p>x</p></article></body>');
    let created = 0;
    dom.window.IntersectionObserver = function Counting() { created += 1; this.observe = () => {}; };
    assert.equal(initReveal(dom.window.document), 0);
    assert.equal(created, 0);
    dom.window.close();
});

test('any pixel in view reveals a block: a block taller than the screen can never reach a fractional threshold', () => {
    const { doc, dom } = makePage();
    let options = null;
    dom.window.IntersectionObserver = function Capturing(cb, opts) { options = opts; this.observe = () => {}; this.unobserve = () => {}; };
    initReveal(doc);
    assert.equal(options.threshold, 0);
    dom.window.close();
});
