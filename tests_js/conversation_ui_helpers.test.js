/**
 * static/js/conversation-ui-helpers.js -- the pure pieces of the
 * conversation UI: size steps, list-row times, the minhag lock line, error
 * notices, mini-widget corner snapping (incl. RTL), citation excerpts, and
 * the transcript's change-detection key.
 *
 * Run with: node --test tests_js/*.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsmModule } = require('./helpers/esm_harness');

async function load() {
    const mod = await loadEsmModule('static/js/conversation-ui-helpers.js', { window: {} });
    return mod.namespace;
}

test('sizes normalize to overlay and expand one step at a time', async () => {
    const h = await load();
    assert.equal(h.normalizeSize('full'), 'full');
    assert.equal(h.normalizeSize('huge'), 'overlay');
    assert.equal(h.normalizeSize(undefined), 'overlay');
    assert.equal(h.expandedSize('mini'), 'overlay');
    assert.equal(h.expandedSize('overlay'), 'full');
    assert.equal(h.expandedSize('full'), 'full');
    assert.equal(h.isModalSize('mini'), false);
    assert.equal(h.isModalSize('overlay'), true);
    assert.equal(h.isModalSize('full'), true);
});

test('relativeTime buckets into now / minutes / hours / yesterday / date', async () => {
    const h = await load();
    const now = Date.parse('2026-09-24T12:00:00Z');
    const ago = (s) => new Date(now - s * 1000).toISOString();
    assert.equal(h.relativeTime(ago(10), { now }), 'now');
    assert.equal(h.relativeTime(ago(5 * 60), { now }), '5m');
    assert.equal(h.relativeTime(ago(3 * 3600), { now }), '3h');
    assert.equal(h.relativeTime(ago(30 * 3600), { now }), 'Yesterday');
    assert.equal(h.relativeTime(ago(30 * 3600), { now, lang: 'he' }), 'אתמול');
    assert.match(h.relativeTime(ago(10 * 86400), { now }), /Sep/);
    assert.equal(h.relativeTime('not a date', { now }), '');
    assert.equal(h.relativeTime(null, { now }), '');
});

test('lock line names the community, localized, and handles All', async () => {
    const h = await load();
    const options = [{ value: 'Sefardic', en: 'Sefardic', he: 'ספרדי' }];
    assert.equal(h.lockLine('Sefardic', 'en', options), 'Answers in this conversation follow Sefardic practice.');
    assert.match(h.lockLine('Sefardic', 'he', options), /ספרדי/);
    assert.match(h.lockLine(null, 'en'), /all communities/);
    assert.match(h.lockLine('ALL', 'en'), /all communities/);
    assert.equal(h.communityName('Syrian', 'he', options), 'Syrian'); // unknown option: raw value
});

test('noticeFor maps store error codes to user-facing notices', async () => {
    const h = await load();
    assert.equal(h.noticeFor(null), null);
    assert.match(h.noticeFor({ code: 'budget_exhausted' }).text, /today's AI limit.*midnight UTC/);
    assert.match(h.noticeFor({ code: 'ai_paused', retryAfter: 90 }).text, /2 min/);
    assert.match(h.noticeFor({ code: 'ai_paused' }).text, /paused/);
    assert.match(h.noticeFor({ code: 'rate_limited', retryAfter: 12 }).text, /12s/);
    assert.equal(h.noticeFor({ code: 'unauthorized' }).action, 'sign-in');
    assert.equal(h.noticeFor({ code: 'not_found' }).action, 'new');
    assert.equal(h.noticeFor({ code: 'answer_incomplete' }), null);
    assert.match(h.noticeFor({ code: 'server' }).text, /Something went wrong/);
    assert.match(h.noticeFor({ code: 'network' }, 'he').text, /החיבור/);
});

test('snapCorner picks the nearest corner and logicalCorner mirrors for RTL', async () => {
    const h = await load();
    const vp = { width: 1000, height: 800 };
    assert.equal(h.snapCorner({ x: 900, y: 700 }, vp), 'br');
    assert.equal(h.snapCorner({ x: 100, y: 700 }, vp), 'bl');
    assert.equal(h.snapCorner({ x: 900, y: 100 }, vp), 'tr');
    assert.equal(h.snapCorner({ x: 100, y: 100 }, vp), 'tl');
    assert.equal(h.logicalCorner('br', false), 'br');
    assert.equal(h.logicalCorner('br', true), 'bl');
    assert.equal(h.logicalCorner('tl', true), 'tr');
    assert.equal(h.logicalCorner('bogus', false), 'br');
});

test('citationExcerpt prefers the reader language and falls back', async () => {
    const h = await load();
    const c = { excerptEn: 'english', excerptHe: 'עברית' };
    assert.equal(h.citationExcerpt(c, 'en'), 'english');
    assert.equal(h.citationExcerpt(c, 'he'), 'עברית');
    assert.equal(h.citationExcerpt({ excerptEn: '', excerptHe: 'עברית' }, 'en'), 'עברית');
    assert.equal(h.citationExcerpt(null), '');
});

test('turnSignature changes when status, content, or citations change', async () => {
    const h = await load();
    const base = { role: 'assistant', status: 'pending', content: '', citations: [] };
    const done = { ...base, status: 'complete', content: 'answer' };
    const cited = { ...done, citations: [{ ref: 'Berakhot 2a' }] };
    assert.notEqual(h.turnSignature(base), h.turnSignature(done));
    assert.notEqual(h.turnSignature(done), h.turnSignature(cited));
    assert.equal(h.turnSignature(cited), h.turnSignature({ ...cited }));
    assert.equal(h.turnSignature(null), '');
});

test('conversationGroup sorts pinned first, then by calendar day', async () => {
    const h = await load();
    const now = new Date(2026, 9, 9, 15, 0, 0).getTime(); // Fri 9 Oct 2026, 15:00 local
    const at = (daysAgo, hour = 12) => new Date(2026, 9, 9 - daysAgo, hour, 0, 0).toISOString();
    assert.equal(h.conversationGroup({ pinnedAt: at(40), updatedAt: at(40) }, { now }), 'pinned');
    assert.equal(h.conversationGroup({ updatedAt: at(0, 9) }, { now }), 'today');
    assert.equal(h.conversationGroup({ updatedAt: at(1, 23) }, { now }), 'yesterday');
    assert.equal(h.conversationGroup({ updatedAt: at(4) }, { now }), 'week');
    assert.equal(h.conversationGroup({ updatedAt: at(7) }, { now }), 'earlier');
    // updatedAt wins; createdAt is the fallback; nothing parseable is just "earlier".
    assert.equal(h.conversationGroup({ createdAt: at(0, 9) }, { now }), 'today');
    assert.equal(h.conversationGroup({ updatedAt: 'not a date' }, { now }), 'earlier');
    assert.equal(h.conversationGroup(null, { now }), 'earlier');
});

test('conversationGroupLabel is localized and falls back to Earlier', async () => {
    const h = await load();
    assert.equal(h.conversationGroupLabel('today', 'en'), 'Today');
    assert.equal(h.conversationGroupLabel('today', 'he'), 'היום');
    assert.equal(h.conversationGroupLabel('week', 'en'), 'Previous 7 days');
    assert.equal(h.conversationGroupLabel('nope', 'en'), 'Earlier');
});

test('mostlyHebrew tells a Hebrew answer from an English one, with a few source names allowed in', async () => {
    const h = await load();
    assert.equal(h.mostlyHebrew('אסור לבשל בשבת'), true);
    assert.equal(h.mostlyHebrew('מותר לבשל על להבה מכוסה (Rema)'), true);
    assert.equal(h.mostlyHebrew('You may keep a pot on a blech.'), false);
    assert.equal(h.mostlyHebrew('You may keep a pot, as the Rambam says: כירה'), false);
    assert.equal(h.mostlyHebrew(''), false);
    assert.equal(h.mostlyHebrew(undefined), false);
});

// --- mini widget size ----------------------------------------------------------

const DESKTOP = { width: 1440, height: 900 };

test('clampMiniSize keeps the width and height inside the bounds and the window', async () => {
    const h = await load();
    assert.deepEqual({ ...h.clampMiniSize({ w: 100, h: 100 }, DESKTOP) }, { w: 300, h: 320 });
    assert.deepEqual({ ...h.clampMiniSize({ w: 9999, h: 9999 }, DESKTOP) }, { w: 520, h: 720 });
    assert.deepEqual({ ...h.clampMiniSize({ w: 400.4, h: 500.6 }, DESKTOP) }, { w: 400, h: 501 });
    // A still-automatic height stays automatic.
    assert.equal(h.clampMiniSize({ w: 400 }, DESKTOP).h, null);
    assert.equal(h.clampMiniSize({ w: 400, h: null }, DESKTOP).h, null);
    // A short, narrow window wins over the ceiling: 32px of gutter, 120px for the top bar.
    assert.deepEqual({ ...h.clampMiniSize({ w: 520, h: 720 }, { width: 400, height: 600 }) }, { w: 368, h: 480 });
    // ...but never below the floor, even in a window smaller than it.
    assert.deepEqual({ ...h.clampMiniSize({ w: 520, h: 720 }, { width: 320, height: 400 }) }, { w: 300, h: 320 });
});

test('clampMiniSize leaves room for the history column when it is open', async () => {
    const h = await load();
    // The chat and a column 0.6 as wide must fit in the window less its gutters.
    const window700 = { width: 700, height: 800 };
    assert.equal(h.clampMiniSize({ w: 520 }, window700).w, 520);
    const open = h.clampMiniSize({ w: 520 }, window700, { historyOpen: true });
    assert.equal(open.w, Math.round((700 - 32) / 1.6));
    assert.ok(open.w * 1.6 <= 700 - 32 + 1);
    // A 1024px window has room for the widest chat and its column.
    assert.equal(h.clampMiniSize({ w: 520 }, { width: 1024, height: 800 }, { historyOpen: true }).w, 520);
});

test('parseMiniSize reads a saved size and rejects anything else', async () => {
    const h = await load();
    assert.deepEqual({ ...h.parseMiniSize('{"w":400,"h":500}') }, { w: 400, h: 500 });
    assert.deepEqual({ ...h.parseMiniSize('{"w":400}') }, { w: 400, h: null });
    assert.deepEqual({ ...h.parseMiniSize('{"w":400,"h":"tall"}') }, { w: 400, h: null });
    // Stale or hand-edited values are pulled inside the bounds.
    assert.deepEqual({ ...h.parseMiniSize('{"w":5000,"h":5}') }, { w: 520, h: 320 });
    for (const raw of [null, undefined, '', 'nope', '[]', '42', 'null', '{"h":400}', '{"w":"wide"}', '{"w":null}']) {
        assert.equal(h.parseMiniSize(raw), null, String(raw));
    }
});

test('dragMiniSize grows the widget away from the corner it sits in', async () => {
    const h = await load();
    const start = { w: 340, h: 400 };
    const drag = (dx, dy, extra) => ({ ...h.dragMiniSize({ start, dx, dy, ...extra }, DESKTOP) });
    // Bottom-right corner: a leftward, upward pull grows it.
    assert.deepEqual(drag(-60, -40, { anchor: { right: true, bottom: true } }), { w: 400, h: 440 });
    assert.deepEqual(drag(60, 40, { anchor: { right: true, bottom: true } }), { w: 300, h: 360 });
    // Top-left corner: the other way round.
    assert.deepEqual(drag(60, 40, { anchor: { right: false, bottom: false } }), { w: 400, h: 440 });
    // Mixed corners flip one axis each.
    assert.deepEqual(drag(60, 40, { anchor: { right: false, bottom: true } }), { w: 400, h: 360 });
    assert.deepEqual(drag(-60, -40, { anchor: { right: true, bottom: false } }), { w: 400, h: 360 });
});

test('dragMiniSize moves only the axes its handle owns', async () => {
    const h = await load();
    const start = { w: 340, h: 400 };
    const anchor = { right: true, bottom: true };
    assert.deepEqual({ ...h.dragMiniSize({ start, dx: -60, dy: -40, anchor, axes: 'x' }, DESKTOP) }, { w: 400, h: 400 });
    assert.deepEqual({ ...h.dragMiniSize({ start, dx: -60, dy: -40, anchor, axes: 'y' }, DESKTOP) }, { w: 340, h: 440 });
    // An automatic height is left alone by a horizontal drag, and starts from 0 on a vertical one.
    assert.equal(h.dragMiniSize({ start: { w: 340, h: null }, dx: -60, dy: 0, anchor, axes: 'x' }, DESKTOP).h, null);
    assert.equal(h.dragMiniSize({ start: { w: 340, h: null }, dx: 0, dy: -500, anchor, axes: 'y' }, DESKTOP).h, 500);
});

test('dragMiniSize spreads a horizontal drag over the chat and its history column', async () => {
    const h = await load();
    const start = { w: 340, h: 400 };
    const anchor = { right: true, bottom: true };
    // 80px of pointer travel is 80/1.6 = 50px of chat width when the column is open.
    assert.equal(h.dragMiniSize({ start, dx: -80, dy: 0, anchor, axes: 'x', historyOpen: true }, DESKTOP).w, 390);
    assert.equal(h.dragMiniSize({ start, dx: -80, dy: 0, anchor, axes: 'x' }, DESKTOP).w, 420);
    // And it stops where the pair would leave the window.
    const narrow = { width: 700, height: 800 };
    assert.equal(h.dragMiniSize({ start, dx: -900, dy: 0, anchor, axes: 'x', historyOpen: true }, narrow).w, Math.round((700 - 32) / 1.6));
});

test('miniKeyDelta turns the arrow keys into one step in that screen direction', async () => {
    const h = await load();
    assert.equal(h.MINI_STEP_PX, 24);
    assert.deepEqual({ ...h.miniKeyDelta('ArrowLeft') }, { dx: -24, dy: 0 });
    assert.deepEqual({ ...h.miniKeyDelta('ArrowRight') }, { dx: 24, dy: 0 });
    assert.deepEqual({ ...h.miniKeyDelta('ArrowUp') }, { dx: 0, dy: -24 });
    assert.deepEqual({ ...h.miniKeyDelta('ArrowDown') }, { dx: 0, dy: 24 });
    for (const key of ['Home', 'Enter', 'a', ' ']) assert.equal(h.miniKeyDelta(key), null, key);
});
