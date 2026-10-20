/**
 * static/js/conversation-mini.js -- the desktop mini widget's two extras: the
 * history column that opens beside the chat, and the resize handles. The module
 * is loaded on its own against the real home page's markup (the panel, its
 * sidebar, the history button and the three handles), so each test says what
 * the widget is told (`isActive`, the corner, the window) and checks what lands
 * on the panel. How conversation-ui.js uses it is covered in
 * conversation_ui.test.js.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openConversationPage } = require('./helpers/conversation_page');
const { loadEsmModule } = require('./helpers/esm_harness');

const SIZE_KEY = 'shelah.conv.miniSize';
const WINDOW = { width: 1440, height: 900 };

/**
 * The panel, a fake WAAPI (jsdom has none) and a widget on them.
 * @param {object} [options]
 * @param {boolean} [options.active] The widget is the desktop mini one.
 * @param {string} [options.corner] Logical corner, as conversation-ui.js writes it.
 * @param {boolean} [options.reduced]
 * @param {object} [options.rects] Boxes for `getBoundingClientRect`, by element key.
 * @param {boolean} [options.animate] Give the panel and sidebar a recording `animate`.
 */
async function openWidget({ active = true, corner = 'br', reduced = false, rects = {}, animate = false, lang = 'en', storage = {} } = {}) {
    const page = await openConversationPage({ install: false, lang, storage });
    const { window, document } = page;
    const panel = document.getElementById('convPanel');
    const sidebar = document.getElementById('convSidebar');
    const main = panel.querySelector('.conv-main');
    const historyBtn = document.getElementById('convHistoryBtn');
    const cornerHandle = document.getElementById('convResizeBtn');
    const edges = [...panel.querySelectorAll('.conv-resize[data-resize-axis]')];
    panel.dataset.corner = corner;

    const boxes = { panel: { left: 700, top: 300, width: 340, height: 400 }, sidebar: { left: 1040, top: 300, width: 204, height: 400 }, main: { left: 700, top: 300, width: 340, height: 400 }, ...rects };
    const rect = (b) => ({ ...b, right: b.left + b.width, bottom: b.top + b.height, x: b.left, y: b.top });
    panel.getBoundingClientRect = () => rect(boxes.panel);
    sidebar.getBoundingClientRect = () => rect(boxes.sidebar);
    main.getBoundingClientRect = () => rect(boxes.main);

    const animations = [];
    if (animate) {
        const record = (target) => function fakeAnimate(frames, options) {
            const run = { target, frames, options, cancelled: false, cancel() { this.cancelled = true; }, finish() { this.onfinish?.(); } };
            animations.push(run);
            return run;
        };
        panel.animate = record('panel');
        sidebar.animate = record('sidebar');
    }

    const state = { active, reduced, viewport: WINDOW };
    const globals = { window, document, getComputedStyle: () => ({ clipPath: state.clip || 'none' }) };
    const { createMiniWidget } = (await loadEsmModule('static/js/conversation-mini.js', globals)).namespace;
    const widget = createMiniWidget({
        panel, sidebar, main, historyBtn, corner: cornerHandle, edges,
        isActive: () => state.active,
        reducedMotion: () => state.reduced,
        viewport: () => state.viewport,
    });
    return { page, window, document, panel, sidebar, main, historyBtn, cornerHandle, edges, widget, animations, state, boxes };
}

const drag = (w, handle, from, to, { id = 1 } = {}) => {
    w.page.pointer(handle, 'pointerdown', { clientX: from[0], clientY: from[1], pointerId: id });
    w.page.pointer(handle, 'pointermove', { clientX: to[0], clientY: to[1], pointerId: id });
    w.page.pointer(handle, 'pointerup', { clientX: to[0], clientY: to[1], pointerId: id });
};
const stored = (w) => JSON.parse(w.window.localStorage.getItem(SIZE_KEY));
const cssVar = (w, name) => w.panel.style.getPropertyValue(name);

// --- the history column -------------------------------------------------------

test('opening the history column marks the panel, the button and the sidebar', async () => {
    const w = await openWidget();
    try {
        assert.equal(w.widget.isHistoryOpen(), false);
        assert.notEqual(w.historyBtn.getAttribute('aria-expanded'), 'true');

        assert.equal(w.widget.openHistory(), true);
        assert.equal(w.widget.isHistoryOpen(), true);
        assert.equal(w.panel.dataset.history, 'open');
        assert.equal(w.historyBtn.getAttribute('aria-expanded'), 'true');
        // A disclosure beside the chat, not a popup over it.
        assert.equal(w.historyBtn.getAttribute('aria-controls'), 'convSidebar');
        assert.equal(w.historyBtn.hasAttribute('aria-haspopup'), false);

        // Opening twice changes nothing and reports it.
        assert.equal(w.widget.openHistory(), false);
    } finally {
        w.page.close();
    }
});

test('closing the history column folds it away at once when nothing can animate', async () => {
    const w = await openWidget();
    try {
        w.widget.openHistory();
        w.widget.closeHistory();
        assert.equal(w.widget.isHistoryOpen(), false);
        assert.equal('history' in w.panel.dataset, false);
        assert.equal(w.historyBtn.getAttribute('aria-expanded'), 'false');
        // Closing a closed column is a no-op.
        w.widget.closeHistory();
        assert.equal(w.historyBtn.getAttribute('aria-expanded'), 'false');
    } finally {
        w.page.close();
    }
});

test('toggleHistory opens, then closes, and says which it did', async () => {
    const w = await openWidget();
    try {
        assert.equal(w.widget.toggleHistory(), true);
        assert.equal(w.panel.dataset.history, 'open');
        assert.equal(w.widget.toggleHistory(), false);
        assert.equal(w.widget.isHistoryOpen(), false);
    } finally {
        w.page.close();
    }
});

test('outside the desktop mini widget the column never opens and the button keeps its popover wiring', async () => {
    const w = await openWidget({ active: false });
    try {
        assert.equal(w.widget.openHistory(), false);
        assert.equal('history' in w.panel.dataset, false);
        w.widget.sync();
        assert.equal(w.historyBtn.getAttribute('aria-expanded'), 'false');
        assert.equal(w.historyBtn.getAttribute('aria-controls'), 'convHistoryPop');
        assert.equal(w.historyBtn.getAttribute('aria-haspopup'), 'dialog');
    } finally {
        w.page.close();
    }
});

test('leaving the mini widget with the column open folds it away immediately', async () => {
    const w = await openWidget({ animate: true });
    try {
        w.widget.openHistory();
        assert.equal(w.panel.dataset.history, 'open');
        w.state.active = false;
        w.widget.sync();
        assert.equal(w.widget.isHistoryOpen(), false);
        assert.equal('history' in w.panel.dataset, false);
        // The running slide is cancelled rather than left holding the drawer.
        assert.ok(w.animations.every((a) => a.cancelled));
        assert.equal(w.historyBtn.getAttribute('aria-controls'), 'convHistoryPop');
        w.state.active = true;
        w.widget.sync();
        assert.equal(w.historyBtn.getAttribute('aria-controls'), 'convSidebar');
    } finally {
        w.page.close();
    }
});

test('an immediate close skips the slide even where animation is available', async () => {
    const w = await openWidget({ animate: true });
    try {
        w.widget.openHistory();
        const before = w.animations.length;
        w.widget.closeHistory({ immediate: true });
        assert.equal(w.animations.length, before);
        assert.equal('history' in w.panel.dataset, false);
    } finally {
        w.page.close();
    }
});

test('opening never animates or resizes the panel: the drawer slides in on transform and opacity only', async () => {
    const w = await openWidget({ animate: true });
    try {
        const before = { w: cssVar(w, '--conv-mini-w'), h: cssVar(w, '--conv-mini-h'), style: w.panel.style.getPropertyValue('width') + w.panel.style.getPropertyValue('height') };
        w.widget.openHistory();
        assert.equal(w.animations.filter((a) => a.target === 'panel').length, 0);
        const [slide] = w.animations;
        assert.equal(slide.target, 'sidebar');
        // Bottom-right widget: the free side is the left, so it comes in from the left.
        assert.deepEqual(slide.frames, [
            { opacity: 0, transform: 'translateX(-16px)' },
            { opacity: 1, transform: 'translateX(0)' },
        ]);
        for (const frame of slide.frames) assert.deepEqual(Object.keys(frame).sort(), ['opacity', 'transform']);
        assert.equal(slide.options.duration, 220);
        slide.finish();
        assert.equal(slide.cancelled, true);
        assert.equal(w.panel.dataset.history, 'open');
        // Open and close again: nothing on the panel itself changed.
        w.widget.closeHistory();
        w.animations.at(-1).finish();
        assert.deepEqual({ w: cssVar(w, '--conv-mini-w'), h: cssVar(w, '--conv-mini-h'), style: w.panel.style.getPropertyValue('width') + w.panel.style.getPropertyValue('height') }, before);
    } finally {
        w.page.close();
    }
});

test('a widget on the left of the screen slides its drawer in from the right', async () => {
    const w = await openWidget({ animate: true, corner: 'bl' });
    try {
        w.widget.openHistory();
        assert.deepEqual(w.animations[0].frames[0], { opacity: 0, transform: 'translateX(16px)' });
    } finally {
        w.page.close();
    }
});

test('closing slides back, and the panel drops its history mark only when the slide is done', async () => {
    const w = await openWidget({ animate: true });
    try {
        w.widget.openHistory();
        w.animations[0].finish();
        w.widget.closeHistory();
        const closing = w.animations.at(-1);
        assert.deepEqual(closing.frames, [
            { opacity: 1, transform: 'translateX(0)' },
            { opacity: 0, transform: 'translateX(-16px)' },
        ]);
        assert.equal(w.panel.dataset.history, 'open');
        assert.equal(w.historyBtn.getAttribute('aria-expanded'), 'false');
        closing.finish();
        assert.equal('history' in w.panel.dataset, false);
    } finally {
        w.page.close();
    }
});

test('a toggle in mid-flight reverses the running slide instead of starting over', async () => {
    const w = await openWidget({ animate: true });
    try {
        w.widget.openHistory();
        const opening = w.animations[0];
        let reversed = 0;
        opening.reverse = () => { reversed += 1; };
        w.widget.closeHistory();
        assert.equal(reversed, 1);
        assert.equal(w.animations.length, 1);
        assert.equal(opening.cancelled, false);
        // Its finish now lands closed.
        opening.finish();
        assert.equal('history' in w.panel.dataset, false);
    } finally {
        w.page.close();
    }
});

test('with reduced motion the drawer only fades in and the close is immediate', async () => {
    const w = await openWidget({ animate: true, reduced: true });
    try {
        w.widget.openHistory();
        const [fade] = w.animations;
        assert.deepEqual(fade.frames, [{ opacity: 0 }, { opacity: 1 }]);
        assert.equal(fade.options.duration, 120);
        w.widget.closeHistory();
        assert.equal('history' in w.panel.dataset, false);
    } finally {
        w.page.close();
    }
});

// --- resizing -----------------------------------------------------------------

test('dragging the corner handle away from the widget\'s corner grows it and remembers the size', async () => {
    const w = await openWidget({ corner: 'br' });
    try {
        drag(w, w.cornerHandle, [700, 300], [640, 260]); // up and to the left
        assert.equal(cssVar(w, '--conv-mini-w'), '400px');
        assert.equal(cssVar(w, '--conv-mini-h'), '440px');
        assert.equal(w.panel.dataset.miniH, 'fixed');
        assert.deepEqual({ ...stored(w) }, { w: 400, h: 440 });
        assert.equal(w.panel.classList.contains('is-resizing'), false);
        assert.deepEqual({ ...w.widget.getSize() }, { w: 400, h: 440 });
    } finally {
        w.page.close();
    }
});

test('the widget is marked as resizing for the length of the drag only', async () => {
    const w = await openWidget();
    try {
        w.page.pointer(w.cornerHandle, 'pointerdown', { clientX: 700, clientY: 300 });
        assert.equal(w.panel.classList.contains('is-resizing'), true);
        w.page.pointer(w.cornerHandle, 'pointermove', { clientX: 690, clientY: 300, pointerId: 2 }); // another finger
        assert.equal(w.widget.getSize(), null);
        w.page.pointer(w.cornerHandle, 'pointercancel');
        assert.equal(w.panel.classList.contains('is-resizing'), false);
    } finally {
        w.page.close();
    }
});

test('a widget in the top-left corner grows the other way', async () => {
    const w = await openWidget({ corner: 'tl' });
    try {
        drag(w, w.cornerHandle, [700, 300], [760, 340]);
        assert.deepEqual({ ...stored(w) }, { w: 400, h: 440 });
    } finally {
        w.page.close();
    }
});

test('in a right-to-left page the logical corner is mirrored, so "br" is the left side', async () => {
    const w = await openWidget({ corner: 'br', lang: 'he' });
    try {
        // Physically bottom-left: pulling right and up grows it.
        drag(w, w.cornerHandle, [700, 300], [760, 260]);
        assert.deepEqual({ ...stored(w) }, { w: 400, h: 440 });
    } finally {
        w.page.close();
    }
});

test('the side strips each move one axis', async () => {
    const w = await openWidget({ corner: 'br' });
    try {
        const x = w.edges.find((edge) => edge.dataset.resizeAxis === 'x');
        const y = w.edges.find((edge) => edge.dataset.resizeAxis === 'y');
        drag(w, x, [700, 500], [650, 540]);
        assert.equal(cssVar(w, '--conv-mini-w'), '390px');
        // The height was left to the content.
        assert.equal(cssVar(w, '--conv-mini-h'), '');
        assert.equal('miniH' in w.panel.dataset, false);
        assert.deepEqual({ ...stored(w) }, { w: 390, h: null });

        // jsdom has no layout: the page would now measure the wider box.
        w.boxes.panel = { ...w.boxes.panel, width: 390 };
        drag(w, y, [800, 300], [800, 250]);
        assert.equal(cssVar(w, '--conv-mini-w'), '390px');
        assert.equal(cssVar(w, '--conv-mini-h'), '450px');
    } finally {
        w.page.close();
    }
});

test('the size stays inside the bounds however far the pointer goes', async () => {
    const w = await openWidget();
    try {
        drag(w, w.cornerHandle, [700, 300], [-4000, -4000]);
        assert.deepEqual({ ...stored(w) }, { w: 520, h: 720 });
        drag(w, w.cornerHandle, [100, 100], [4000, 4000]);
        assert.deepEqual({ ...stored(w) }, { w: 300, h: 320 });
    } finally {
        w.page.close();
    }
});

test('with the drawer open a drag resizes the widget exactly as with it closed', async () => {
    const w = await openWidget();
    try {
        w.widget.openHistory();
        drag(w, w.cornerHandle, [700, 300], [640, 300]);
        assert.equal(cssVar(w, '--conv-mini-w'), '400px');
    } finally {
        w.page.close();
    }
});

test('the arrow keys resize by a step, cumulatively, and Home puts the default back', async () => {
    const w = await openWidget({ corner: 'br' });
    try {
        const key = (name) => w.page.key(name, {}, w.cornerHandle);
        const first = key('ArrowLeft');
        assert.equal(first.defaultPrevented, true);
        key('ArrowLeft');
        assert.equal(cssVar(w, '--conv-mini-w'), '388px');
        // Up grows a bottom-anchored widget; the height was automatic, so it starts from the box.
        key('ArrowUp');
        assert.equal(cssVar(w, '--conv-mini-h'), '424px');
        key('ArrowDown');
        assert.equal(cssVar(w, '--conv-mini-h'), '400px');
        assert.deepEqual({ ...stored(w) }, { w: 388, h: 400 });

        const home = key('Home');
        assert.equal(home.defaultPrevented, true);
        assert.equal(cssVar(w, '--conv-mini-w'), '');
        assert.equal(cssVar(w, '--conv-mini-h'), '');
        assert.equal('miniH' in w.panel.dataset, false);
        assert.equal(w.window.localStorage.getItem(SIZE_KEY), null);
        assert.equal(w.widget.getSize(), null);

        // Other keys are left to the browser.
        assert.equal(key('Enter').defaultPrevented, false);
        assert.equal(key('a').defaultPrevented, false);
    } finally {
        w.page.close();
    }
});

test('a double click on the corner handle resets the size', async () => {
    const w = await openWidget();
    try {
        drag(w, w.cornerHandle, [700, 300], [660, 260]);
        assert.ok(w.widget.getSize());
        w.cornerHandle.dispatchEvent(new w.window.MouseEvent('dblclick', { bubbles: true }));
        assert.equal(w.widget.getSize(), null);
        assert.equal(w.window.localStorage.getItem(SIZE_KEY), null);
    } finally {
        w.page.close();
    }
});

test('resizing is ignored unless the widget is the desktop mini one, or for any button but the primary', async () => {
    const w = await openWidget({ active: false });
    try {
        drag(w, w.cornerHandle, [700, 300], [600, 200]);
        w.page.key('ArrowLeft', {}, w.cornerHandle);
        w.page.key('Home', {}, w.cornerHandle);
        assert.equal(w.widget.getSize(), null);
        assert.equal(w.window.localStorage.getItem(SIZE_KEY), null);

        w.state.active = true;
        w.page.pointer(w.cornerHandle, 'pointerdown', { button: 2, clientX: 700, clientY: 300 });
        assert.equal(w.panel.classList.contains('is-resizing'), false);
    } finally {
        w.page.close();
    }
});

test('the corner handle shows the diagonal it drags along', async () => {
    const cases = [['br', 'nwse-resize'], ['tl', 'nwse-resize'], ['bl', 'nesw-resize'], ['tr', 'nesw-resize']];
    for (const [corner, cursor] of cases) {
        const w = await openWidget({ corner });
        try {
            w.page.pointer(w.cornerHandle, 'pointerenter');
            assert.equal(w.cornerHandle.style.cursor, cursor, corner);
        } finally {
            w.page.close();
        }
    }
});

test('restoreSize puts back the saved size, pulled inside the window, and ignores junk', async () => {
    const w = await openWidget({ storage: { [SIZE_KEY]: JSON.stringify({ w: 500, h: 700 }) } });
    try {
        w.state.viewport = { width: 1000, height: 600 };
        w.widget.restoreSize();
        assert.equal(cssVar(w, '--conv-mini-w'), '500px');
        assert.equal(cssVar(w, '--conv-mini-h'), '480px');
        assert.equal(w.panel.dataset.miniH, 'fixed');
    } finally {
        w.page.close();
    }

    const empty = await openWidget({ storage: { [SIZE_KEY]: 'not json' } });
    try {
        empty.widget.restoreSize();
        assert.equal(empty.widget.getSize(), null);
        assert.equal(cssVar(empty, '--conv-mini-w'), '');
    } finally {
        empty.page.close();
    }
});

test('a width saved without a height restores as a width only', async () => {
    const w = await openWidget({ storage: { [SIZE_KEY]: JSON.stringify({ w: 420 }) } });
    try {
        w.widget.restoreSize();
        assert.equal(cssVar(w, '--conv-mini-w'), '420px');
        assert.equal(cssVar(w, '--conv-mini-h'), '');
        assert.equal('miniH' in w.panel.dataset, false);
    } finally {
        w.page.close();
    }
});

test('blocked storage never stops a resize', async () => {
    const w = await openWidget();
    try {
        const refuse = () => { throw new Error('blocked'); };
        Object.defineProperty(w.window, 'localStorage', { configurable: true, value: { getItem: refuse, setItem: refuse, removeItem: refuse } });
        w.widget.restoreSize();
        assert.equal(w.widget.getSize(), null);
        drag(w, w.cornerHandle, [700, 300], [660, 260]);
        assert.equal(cssVar(w, '--conv-mini-w'), '380px');
        w.page.key('Home', {}, w.cornerHandle);
        assert.equal(cssVar(w, '--conv-mini-w'), '');
        assert.deepEqual(w.page.errors, []);
    } finally {
        w.page.close();
    }
});

test('a widget built without handles or a history button still works', async () => {
    const page = await openConversationPage({ install: false });
    try {
        const { window, document } = page;
        const panel = document.getElementById('convPanel');
        const sidebar = document.getElementById('convSidebar');
        const globals = { window, document, getComputedStyle: () => ({ clipPath: 'none' }) };
        const { createMiniWidget } = (await loadEsmModule('static/js/conversation-mini.js', globals)).namespace;
        const widget = createMiniWidget({ panel, sidebar, main: panel.querySelector('.conv-main'), isActive: () => true });
        assert.equal(widget.openHistory(), true);
        widget.sync();
        widget.closeHistory({ immediate: true });
        assert.equal('history' in panel.dataset, false);
    } finally {
        page.close();
    }
});
