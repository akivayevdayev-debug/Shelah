// The two extras of the desktop mini widget (#convPanel[data-size="mini"]):
//
//   - History: the conversation list opens as a drawer on the widget's free
//     side (the side away from its screen corner), laid over the chat inside
//     the widget's own box. The widget never changes width or height for it,
//     so closing the drawer leaves the exact layout it found. It slides a few
//     pixels in and fades (transform and opacity only); a toggle mid-slide
//     turns the same animation around. The full page keeps its permanent
//     sidebar and the centred overlay keeps the history popover; only the mini
//     widget uses this.
//
//   - Resize: a corner handle (keyboard-operable) and two edge strips on the
//     free edges. Width and height stay inside MINI_BOUNDS and the window; the
//     size is remembered between visits. Everything is written as CSS custom
//     properties on the panel (--conv-mini-w / --conv-mini-h), so the widget
//     lays itself out and the drag only moves two numbers.
//
// conversation-ui.js owns when the widget is a mini one (`isActive`), the
// list's contents and the focus rules around it; this module owns the column
// and the handles.

import { clampMiniSize, dragMiniSize, miniKeyDelta, parseMiniSize } from "./conversation-ui-helpers.js";

const SIZE_KEY = "shelah.conv.miniSize";
// --motion-dur-base and --motion-ease-decel (tokens.css), as WAAPI needs numbers.
const REVEAL = Object.freeze({ duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
// How far the drawer travels in from the free edge.
const SLIDE_PX = 16;

function readSize() {
    try {
        return parseMiniSize(window.localStorage.getItem(SIZE_KEY));
    } catch {
        return null;
    }
}

function writeSize(size) {
    try {
        if (size) window.localStorage.setItem(SIZE_KEY, JSON.stringify(size));
        else window.localStorage.removeItem(SIZE_KEY);
    } catch {
        // Private mode / blocked storage: the size just isn't remembered.
    }
}

export function createMiniWidget({
    panel,
    sidebar,
    main,
    historyBtn,
    corner,
    edges = [],
    isActive,
    reducedMotion = () => false,
    viewport = () => ({ width: window.innerWidth, height: window.innerHeight }),
}) {
    let open = false;     // what the user last asked for; the attribute lags a close slide
    let reveal = null;    // the running slide
    let size = null;      // { w, h } once resized, else null (the CSS defaults)

    // ── history column ─────────────────────────────────────────────────

    function syncAria() {
        if (!historyBtn) return;
        const mini = isActive();
        historyBtn.setAttribute("aria-expanded", mini && open ? "true" : "false");
        if (mini) {
            // A disclosure beside the chat, not a popup over it.
            historyBtn.setAttribute("aria-controls", sidebar.id);
            historyBtn.removeAttribute("aria-haspopup");
        } else {
            historyBtn.setAttribute("aria-controls", "convHistoryPop");
            historyBtn.setAttribute("aria-haspopup", "dialog");
        }
    }

    function canAnimate() {
        return typeof sidebar.animate === "function" && !reducedMotion();
    }

    function settleClosed() {
        reveal?.cancel();
        reveal = null;
        delete panel.dataset.history;
    }

    // The drawer comes in from the widget's free side: the left when the
    // widget sits on the right of the screen, and the other way round.
    function slideFrames() {
        const offset = anchor().right ? -SLIDE_PX : SLIDE_PX;
        return [
            { opacity: 0, transform: `translateX(${offset}px)` },
            { opacity: 1, transform: "translateX(0)" },
        ];
    }

    // One slide at a time. A toggle in mid-flight reverses the running one from
    // wherever it has got to, rather than finishing first.
    function slide(opening) {
        const running = reveal;
        if (running && running.opening !== opening && typeof running.reverse === "function") {
            running.opening = opening;
            running.reverse();
            return;
        }
        running?.cancel();
        const frames = slideFrames();
        const animation = sidebar.animate(opening ? frames : frames.reverse(), { ...REVEAL, fill: "both" });
        animation.opening = opening;
        reveal = animation;
        animation.onfinish = () => {
            if (reveal !== animation) return;
            reveal = null;
            animation.cancel();
            if (!open) delete panel.dataset.history;
        };
    }

    function openHistory() {
        if (open || !isActive()) return false;
        open = true;
        // The drawer starts under the header, which keeps the history button
        // (and the rest of the header) where the visitor can reach it.
        const header = main?.querySelector?.(".conv-header");
        panel.style.setProperty("--conv-mini-head", `${Math.round(header?.getBoundingClientRect().height || 0)}px`);
        panel.dataset.history = "open";
        syncAria();
        if (canAnimate()) {
            slide(true);
        } else if (typeof sidebar.animate === "function") {
            // Reduced motion: no travel, just a gentle arrival.
            sidebar.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: "linear", fill: "backwards" });
        }
        return true;
    }

    function closeHistory({ immediate = false } = {}) {
        if (!open && !panel.dataset.history) return;
        open = false;
        syncAria();
        if (immediate || !canAnimate() || !panel.dataset.history) settleClosed();
        else slide(false);
    }

    function toggleHistory() {
        if (open) {
            closeHistory();
            return false;
        }
        return openHistory();
    }

    // ── resize ─────────────────────────────────────────────────────────

    // Which screen corner the widget sits in (data-corner is logical: its
    // "l"/"r" are the inline start/end, so RTL flips them).
    function anchor() {
        const [block, inline] = (panel.dataset.corner || "br").split("");
        const rtl = document.documentElement.dir === "rtl";
        return { right: rtl ? inline === "l" : inline === "r", bottom: block === "b" };
    }

    function measure() {
        const rect = panel.getBoundingClientRect();
        return { w: rect.width, h: rect.height };
    }

    // The size the next drag or key press starts from. A horizontal move
    // leaves a still-automatic height alone. Key presses build on the size last
    // set rather than on the page: under reduced motion the panel's 1ms
    // transitions mean a measurement taken a moment after a change still reads
    // the old box, and two presses in a frame would cancel one step.
    function startFor(axes, { fromState = false } = {}) {
        if (fromState && size) {
            return { w: size.w, h: axes.includes("y") ? (size.h ?? measure().h) : size.h };
        }
        const now = measure();
        return { w: now.w, h: axes.includes("y") ? now.h : (size?.h ?? null) };
    }

    function applySize(next) {
        size = next;
        if (!next) {
            panel.style.removeProperty("--conv-mini-w");
            panel.style.removeProperty("--conv-mini-h");
            delete panel.dataset.miniH;
            return;
        }
        panel.style.setProperty("--conv-mini-w", `${next.w}px`);
        if (next.h == null) {
            panel.style.removeProperty("--conv-mini-h");
            delete panel.dataset.miniH;
        } else {
            panel.style.setProperty("--conv-mini-h", `${next.h}px`);
            panel.dataset.miniH = "fixed";
        }
    }

    function resetSize() {
        applySize(null);
        writeSize(null);
    }

    function restoreSize() {
        const saved = readSize();
        applySize(saved ? clampMiniSize(saved, viewport()) : null);
    }

    function bindDrag(handle, axes) {
        let drag = null;
        handle.addEventListener("pointerdown", (event) => {
            if (!isActive() || event.button !== 0) return;
            event.preventDefault();
            handle.setPointerCapture?.(event.pointerId);
            drag = {
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                start: startFor(axes),
                anchor: anchor(),
            };
            panel.classList.add("is-resizing");
        });
        handle.addEventListener("pointermove", (event) => {
            if (!drag || event.pointerId !== drag.id) return;
            applySize(dragMiniSize({
                start: drag.start,
                dx: event.clientX - drag.x,
                dy: event.clientY - drag.y,
                anchor: drag.anchor,
                axes,
            }, viewport()));
        });
        const end = (event) => {
            if (!drag || event.pointerId !== drag.id) return;
            drag = null;
            panel.classList.remove("is-resizing");
            writeSize(size);
        };
        handle.addEventListener("pointerup", end);
        handle.addEventListener("pointercancel", end);
        handle.addEventListener("dblclick", resetSize);
    }

    function bindKeys(handle) {
        handle.addEventListener("keydown", (event) => {
            if (!isActive()) return;
            if (event.key === "Home") {
                event.preventDefault();
                resetSize();
                return;
            }
            const delta = miniKeyDelta(event.key);
            if (!delta) return;
            event.preventDefault();
            const axes = delta.dx ? "x" : "y";
            applySize(dragMiniSize({ start: startFor(axes, { fromState: true }), ...delta, anchor: anchor(), axes }, viewport()));
            writeSize(size);
        });
    }

    if (corner) {
        bindDrag(corner, "xy");
        bindKeys(corner);
        // The diagonal the handle drags along, whichever corner it sits in.
        corner.addEventListener("pointerenter", () => {
            const a = anchor();
            corner.style.cursor = a.right === a.bottom ? "nwse-resize" : "nesw-resize";
        });
    }
    edges.forEach((edge) => bindDrag(edge, edge.dataset.resizeAxis || "x"));

    // ── lifecycle ──────────────────────────────────────────────────────

    // The panel's size or layout changed: leaving the desktop mini widget
    // folds the column away (the popover or sidebar takes over there).
    function sync() {
        if (!isActive()) closeHistory({ immediate: true });
        syncAria();
    }

    return {
        sync,
        isHistoryOpen: () => open,
        openHistory,
        closeHistory,
        toggleHistory,
        restoreSize,
        resetSize,
        getSize: () => size,
    };
}
