/*
 * The topbar language menu (templates/components/language_menu.html), shown
 * once three or more languages are switched on.
 *
 *   - Opens and closes with the site's anchored-menu motion: ShelahMotion's
 *     'popover' preset where motion.js is loaded (the app page), growing out
 *     of the globe button; elsewhere (legal pages) the same rise-and-fade
 *     played with the Web Animations API. Reduced motion fades only.
 *   - Sits under the topbar like the other floating menus
 *     (computeFloatingMenuPosition in topbar_shared.js).
 *   - Keyboard: ArrowDown / ArrowUp on the button open it; inside, the arrows,
 *     Home and End move between languages, Escape closes and returns focus,
 *     Tab closes. A click or tap outside closes it.
 *   - The tick and the button's label follow <html lang>, whoever changes it
 *     (this menu, a ?lang= link, the saved preference), so they never go stale.
 *
 * Picking a language is the item's own data-onclick="chooseLanguage"
 * (actions.js); this file only closes the menu after it.
 *
 * Node tests require createLanguageMenu and pass their own document/window.
 */
(function (root) {
    'use strict';

    const ENTER = { duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };
    const LEAVE = { duration: 120, easing: 'cubic-bezier(0.25, 0, 0.3, 1)' };
    const RISE = 'translateY(8px) scale(0.98)';
    const REST = 'translateY(0) scale(1)';

    function createLanguageMenu(container, env) {
        const win = env?.win || root;
        const doc = env?.doc || win.document;
        const button = container.querySelector('.lang-menu-btn');
        const panel = container.querySelector('.lang-menu-panel');
        const current = container.querySelector('[data-lang-menu-current]');
        const items = () => Array.from(panel.querySelectorAll('[role="menuitemradio"]'));
        let running = null;

        // The topbar is its own stacking layer (z-200), so inside it the
        // panel's z-index loses to page-level overlays such as the one-time
        // AI tip, which then swallow the click meant for a language. The panel
        // is fixed-positioned anyway, so it lives on <body>.
        if (doc.body && panel.parentElement !== doc.body) doc.body.appendChild(panel);
        const inside = (target) => container.contains(target) || panel.contains(target);

        const isOpen = () => button.getAttribute('aria-expanded') === 'true';
        const reducedMotion = () => Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

        function sync() {
            const lang = doc.documentElement.getAttribute('lang') || items()[0]?.dataset.lang;
            let chosen = null;
            for (const item of items()) {
                const on = item.dataset.lang === lang;
                item.setAttribute('aria-checked', String(on));
                if (on) chosen = item;
            }
            if (current && chosen) {
                const name = chosen.querySelector('.lang-menu-name');
                current.textContent = name?.textContent || chosen.dataset.lang;
                current.setAttribute('lang', chosen.dataset.lang);
                current.setAttribute('dir', name?.getAttribute('dir') || 'ltr');
            }
        }

        function place() {
            const position = win.computeFloatingMenuPosition?.(panel, button, { padding: 8, offset: 4, minWidth: 176, maxWidth: 240 });
            if (!position) return;
            panel.classList.add('is-floating-menu');
            panel.style.left = `${position.left}px`;
            panel.style.top = `${position.top}px`;
            panel.style.width = `${position.width}px`;
        }

        // The Web Animations stand-in for ShelahMotion.present / dismiss.
        function play(showing) {
            running?.cancel();
            running = null;
            if (typeof panel.animate !== 'function') return Promise.resolve();
            const reduced = reducedMotion();
            const from = { opacity: 0, transform: reduced ? REST : RISE };
            const to = { opacity: 1, transform: REST };
            const frames = showing ? [from, to] : [to, from];
            const animation = panel.animate(frames, showing ? ENTER : LEAVE);
            running = animation;
            return animation.finished.then(() => running === animation, () => false);
        }

        function show() {
            const motion = win.ShelahMotion;
            if (motion?.present) return motion.present(panel, { preset: 'popover', origin: button });
            panel.classList.remove('hidden', 'is-hiding');
            return play(true);
        }

        function hide() {
            const motion = win.ShelahMotion;
            if (motion?.dismiss) return motion.dismiss(panel, { preset: 'popover' });
            panel.classList.add('is-hiding');
            return play(false).then((finished) => {
                if (finished === false || isOpen()) return;
                panel.classList.add('hidden');
                panel.classList.remove('is-hiding');
            });
        }

        function focusItem(which) {
            const list = items();
            if (!list.length) return;
            const at = list.indexOf(doc.activeElement);
            const checked = list.findIndex((item) => item.getAttribute('aria-checked') === 'true');
            const index = {
                first: 0,
                last: list.length - 1,
                next: (at + 1) % list.length,
                prev: (at - 1 + list.length) % list.length,
                checked: Math.max(0, checked),
            }[which];
            list[index].focus();
        }

        function open(focusOn) {
            if (isOpen()) return;
            sync();
            button.setAttribute('aria-expanded', 'true');
            place();
            show();
            focusItem(focusOn || 'checked');
        }

        function close(options) {
            if (!isOpen()) return;
            button.setAttribute('aria-expanded', 'false');
            hide();
            if (options?.returnFocus) button.focus();
        }

        const MOVES = { ArrowDown: 'next', ArrowUp: 'prev', Home: 'first', End: 'last' };

        button.addEventListener('click', () => (isOpen() ? close() : open()));
        button.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            open(event.key === 'ArrowDown' ? 'first' : 'last');
        });
        panel.addEventListener('keydown', (event) => {
            if (MOVES[event.key]) {
                event.preventDefault();
                focusItem(MOVES[event.key]);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                close({ returnFocus: true });
            } else if (event.key === 'Tab') {
                close();
            }
        });
        // After actions.js has run chooseLanguage for the item.
        panel.addEventListener('click', (event) => {
            if (event.target.closest?.('[role="menuitemradio"]')) close({ returnFocus: true });
        });
        doc.addEventListener('pointerdown', (event) => {
            if (isOpen() && !inside(event.target)) close();
        });
        win.addEventListener('resize', () => { if (isOpen()) place(); });

        if (typeof win.MutationObserver === 'function') {
            new win.MutationObserver(sync).observe(doc.documentElement, { attributes: true, attributeFilter: ['lang'] });
        }
        sync();

        return { open, close, isOpen, sync };
    }

    function start(doc) {
        doc.querySelectorAll('[data-lang-menu]').forEach((container) => createLanguageMenu(container));
    }

    if (typeof module === 'object' && module.exports) {
        module.exports = { createLanguageMenu };
    } else if (root.document.readyState === 'loading') {
        root.document.addEventListener('DOMContentLoaded', () => start(root.document), { once: true });
    } else {
        start(root.document);
    }
})(typeof window === 'undefined' ? globalThis : window);
