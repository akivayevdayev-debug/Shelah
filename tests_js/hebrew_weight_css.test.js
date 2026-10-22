/**
 * Hebrew emphasis weight (docs/evals/2026-10-21-hebrew-weight.md). Ezra SIL has
 * one weight, so a bold request on it is smeared on by the browser and the
 * Hebrew came out far heavier than the English beside it. These read the CSS
 * sources and pin the three decisions that fixed it: no synthesized bold, one
 * calibrated stroke token, and no stroke written as a literal anywhere.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const TOKENS = read('static/css/tokens.css');
const STYLE = read('static/style.css');
const CONVERSATION = read('static/css/conversation.css');

// Every `selector { body }` block, comments dropped.
function blocks(css) {
    const out = [];
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(clean)) !== null) out.push({ selector: m[1].trim(), body: m[2] });
    return out;
}

const withStroke = (css) => blocks(css).filter((b) => b.body.includes('-webkit-text-stroke'));

test('the page never asks the browser to synthesize a bold', () => {
    const html = blocks(STYLE).find((b) => b.selector === 'html' && b.body.includes('font-synthesis-weight'));
    assert.match(html.body, /font-synthesis-weight:\s*none/);
});

test('the stroke is defined once, as a token, at 0.03em or less', () => {
    const defs = TOKENS.match(/--he-emphasis-stroke:\s*([\d.]+)em/g);
    assert.equal(defs.length, 1);
    assert.ok(parseFloat(defs[0].split(':')[1]) <= 0.03);
});

test('every Hebrew emphasis stroke reads the token', () => {
    const rules = [...withStroke(STYLE), ...withStroke(CONVERSATION)];
    const literal = rules.filter((b) => !/-webkit-text-stroke:\s*var\(--he-emphasis-stroke,/.test(b.body));
    assert.deepEqual(literal.map((b) => b.selector), []);
});

test('the stroke rules cover the reader, the AI sources, the conversation and the Hebrew titles', () => {
    const selectors = [...withStroke(STYLE), ...withStroke(CONVERSATION)].map((b) => b.selector).join('\n');
    for (const part of ['.reader-text-he', '.ai-src-box-he', '.conv-answer[data-script="he"]', '.conv-title[data-script="he"]', '.home-topic-title']) {
        assert.ok(selectors.includes(part), part);
    }
});

test('a stroked Hebrew rule never asks for a bold on top of the stroke', () => {
    const bold = withStroke(STYLE).filter((b) => /font-weight:\s*(700|bold|600)/.test(b.body));
    assert.deepEqual(bold.map((b) => b.selector), []);
});

test('the Hebrew UI titles in Cardo use the regular face, because its Hebrew bold is partial', () => {
    const titles = withStroke(STYLE).find((b) => b.selector.startsWith('html.rtl :is(.home-topic-title'));
    assert.match(titles.body, /font-weight:\s*400/);
});
