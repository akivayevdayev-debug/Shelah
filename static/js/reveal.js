/**
 * Scroll reveal for the short info pages (about, help, accessibility, the AI
 * disclosure): a block that starts below the fold comes in once, with a small
 * rise and a fade, the first time it scrolls into view. It never runs again for
 * that block, and nothing already on screen at load is touched.
 *
 * Opt-in per page: <article data-reveal>. The long legal documents (terms,
 * privacy, licenses) stay still on purpose: people search and skim them, and
 * text that is still fading in is text they cannot read yet.
 *
 * The hidden state is only ever put on by this script, so a page without it (or
 * a browser without IntersectionObserver) shows everything. The motion itself is
 * CSS (legal.css, .reveal-pending / .is-revealed): transform and opacity only,
 * and a plain opacity fade under reduced motion.
 *
 * Loaded as a plain classic <script>; the pure part is exported for the tests.
 */
(function (root) {
    'use strict';

    const PENDING = 'reveal-pending';
    const SHOWN = 'is-revealed';
    // Blocks that carry their own behaviour or are not content to reveal.
    const SKIP = '.legal-toolbar, .legal-toc, nav, script, style, [hidden]';
    // Blocks that arrive together (a jump to an anchor) follow one another by this
    // many steps at most, so a long page never waits on the last of them.
    const MAX_STEPS = 3;

    /** The direct children of every [data-reveal] host that are worth revealing. */
    function revealTargets(doc) {
        const targets = [];
        doc.querySelectorAll('[data-reveal]').forEach((host) => {
            Array.from(host.children).forEach((el) => {
                if (!el.matches(SKIP)) targets.push(el);
            });
        });
        return targets;
    }

    /** Hide what starts below the fold and reveal it on first sight. Returns how many it watches. */
    function initReveal(doc) {
        const win = doc && doc.defaultView;
        if (!win || typeof win.IntersectionObserver !== 'function') return 0;

        const targets = revealTargets(doc);
        if (!targets.length) return 0;

        const fold = win.innerHeight || doc.documentElement.clientHeight || 0;
        const observer = new win.IntersectionObserver((entries) => {
            let step = 0;
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.style.setProperty('--reveal-i', String(Math.min(step, MAX_STEPS)));
                entry.target.classList.add(SHOWN);
                observer.unobserve(entry.target);
                step += 1;
            });
        // threshold 0, not a fraction: a block taller than about twenty screens
        // can never show 5% of itself at once, and would stay hidden for good.
        }, { rootMargin: '0px 0px -6% 0px', threshold: 0 });

        let watched = 0;
        targets.forEach((el) => {
            // On screen (or already scrolled past, after a reload) stays as it is.
            if (el.getBoundingClientRect().top < fold) return;
            el.classList.add(PENDING);
            observer.observe(el);
            watched += 1;
        });
        return watched;
    }

    const api = { initReveal, revealTargets };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.ShelahReveal = api;
        if (root.document) initReveal(root.document);
    }
})(typeof window !== 'undefined' ? window : globalThis);
