/**
 * Small helpers shared between templates/index.html's topbar and
 * templates/components/legal_scripts.html (used by the legal/about/help/
 * glossary pages). Each page's toggleLanguage() / positionFloatingMenu()
 * still owns everything page-specific -- index.html's versions touch dozens
 * of app-only elements and use a CSS class (not an inline style) to cancel
 * the floating menus' centring transform so their open/close animation can
 * still drive `transform` -- these two functions only cover the parts that
 * were verbatim duplicates (Sonar web:S4144) with no page-specific behavior
 * at all.
 *
 * Loaded as a plain classic <script> (not type="module") so its exports
 * become real globals, callable by name the same way
 * the functions themselves were before this was split out.
 */
(function (root) {
    'use strict';

    // The shared prefix of both toggleLanguage() implementations: normalize
    // the language, persist it, and swap every [data-en]/[data-he] element's
    // visible text. Returns the normalized language so the caller can use it
    // for whatever page-specific work (RTL attributes, lang-btn styling, ...)
    // comes next. `persist: false` shows the language without saving it (a
    // link's ?lang= is that page load's language, not the visitor's choice).
    function applyLanguagePreference(lang, options, languageManualKey) {
        const normalized = (lang === 'en' || lang === 'he') ? lang : 'en';
        const autoChange = Boolean(options && options.auto);
        const persist = !(options && options.persist === false);

        if (persist) {
            localStorage.setItem('preferredLanguage', normalized);
            if (!autoChange) {
                localStorage.setItem(languageManualKey, '1');
            }
        }

        swapLanguageText(normalized, document);

        return normalized;
    }

    // Swap every [data-en]/[data-he] element under `scope` to `lang`'s text,
    // leaving any element with no text for that language alone. An element
    // with child elements (a link, <strong>, <code>, an icon) keeps them; see
    // swapTextKeepingChildren.
    function swapLanguageText(lang, scope) {
        scope.querySelectorAll('[data-en], [data-he]').forEach((el) => {
            const text = el.dataset[lang];
            if (!text) return;
            if (el.childElementCount > 0 || originalChildren.has(el)) {
                swapTextKeepingChildren(el, text, lang);
            } else {
                el.textContent = text;
            }
        });
    }

    // The child elements each mixed-content element started with, and whether
    // its data-en text is only the lead-in before them. Kept so a child that
    // has no place in one language's text (an English-only <strong> on a
    // Hebrew swap) comes back on the swap back.
    const originalChildren = new WeakMap();

    function collapseSpace(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function childText(child, lang, fallback) {
        return collapseSpace((child.dataset && child.dataset[lang]) || fallback);
    }

    function rememberChildren(el) {
        let saved = originalChildren.get(el);
        if (!saved) {
            const children = Array.from(el.children).map((child) => ({
                node: child,
                english: collapseSpace(child.textContent),
            }));
            const englishLine = collapseSpace(el.dataset.en);
            // A data-en that names none of its children's text is a lead-in
            // ("see the " before <a>AI Disclosure</a>): only the text before
            // the first child is translated, the rest of the markup stays.
            const leadIn = children.length > 0 && children.every(
                (c) => !c.english || !englishLine.includes(childText(c.node, 'en', c.english)),
            ) && children.some((c) => c.english);
            saved = { children, leadIn };
            originalChildren.set(el, saved);
        }
        return saved;
    }

    // Rebuild a mixed-content element from `text`, putting each original child
    // element back where its own text appears in it (a child's data-<lang>, or
    // its English text). Children that carry no text (icons) go first; children
    // whose text isn't in this language's line are left out of this language.
    function swapTextKeepingChildren(el, text, lang) {
        const { children, leadIn } = rememberChildren(el);
        if (leadIn) {
            const first = children[0].node;
            while (el.firstChild && el.firstChild !== first) el.firstChild.remove();
            el.insertBefore(document.createTextNode(text), first);
            return;
        }
        const nodes = [];
        let rest = text;
        children.forEach(({ node, english }) => {
            const own = childText(node, lang, english);
            if (!own) {
                nodes.push(node);
                return;
            }
            const at = rest.indexOf(own);
            if (at < 0) return;
            if (at > 0) nodes.push(document.createTextNode(rest.slice(0, at)));
            nodes.push(node);
            rest = rest.slice(at + own.length);
        });
        if (rest) nodes.push(document.createTextNode(rest));
        el.replaceChildren(...nodes);
    }

    // index.html's head script marks a Hebrew load data-lang-pending, which
    // keeps [data-he] text unseen until toggleLanguage() swaps it in. A region
    // that calls this from an inline script right after its markup gets its
    // Hebrew text laid out before first paint instead, so the swap doesn't
    // shift the page, and data-lang-ready shows it at once (style.css).
    function swapPendingLanguage(scope) {
        const html = document.documentElement;
        if (!scope || !html.hasAttribute('data-lang-pending')) return;
        const lang = html.getAttribute('lang') === 'he' ? 'he' : 'en';
        swapLanguageText(lang, scope);
        scope.querySelectorAll(`[data-${lang}-placeholder]`).forEach((el) => {
            el.placeholder = el.dataset[`${lang}Placeholder`];
        });
        scope.setAttribute('data-lang-ready', '');
    }

    // The shared geometry of both positionFloatingMenu() implementations:
    // where a dropdown should sit given its trigger button and the shared
    // topbar's bottom edge. Returns null when there's nothing to position.
    // Callers apply the position (and anything page-specific, like the
    // transform-cancelling technique) themselves.
    function computeFloatingMenuPosition(menuEl, triggerEl, options) {
        const opts = options || {};
        if (!menuEl || !triggerEl) return null;

        const viewportWidth = Math.max(Math.round(window.innerWidth || 0), 320);
        const viewportHeight = Math.max(Math.round(window.innerHeight || 0), 320);
        const padding = Number.isFinite(opts.padding) ? opts.padding : 8;
        const offset = Number.isFinite(opts.offset) ? opts.offset : 0;
        const minWidth = Number.isFinite(opts.minWidth) ? opts.minWidth : 160;
        const maxWidth = Number.isFinite(opts.maxWidth) ? opts.maxWidth : 352;
        const triggerRect = triggerEl.getBoundingClientRect();
        const panelWidth = Math.min(maxWidth, Math.max(minWidth, viewportWidth - (padding * 2)));

        const preferredLeft = Math.round(triggerRect.left + triggerRect.width / 2 - panelWidth / 2);
        const left = Math.max(padding, Math.min(preferredLeft, viewportWidth - panelWidth - padding));

        const topbarEl = document.querySelector('header[role="banner"]');
        const anchorBottom = topbarEl ? topbarEl.getBoundingClientRect().bottom : triggerRect.bottom;
        const top = Math.min(viewportHeight - padding, Math.round(anchorBottom + offset));

        return {
            left,
            top,
            width: panelWidth,
            maxWidth: Math.max(0, viewportWidth - (padding * 2)),
        };
    }

    // A theme the visitor just chose crosses over instead of cutting: the
    // browser keeps a picture of the old page and fades it into the new one
    // (View Transitions API, the root only; tokens.css sets the timing under
    // data-vt-theme). Engines without it, a hidden tab and a route transition
    // already in flight just apply the change. `change` runs exactly once
    // either way, so callers keep their own order of work.
    function withThemeFade(change) {
        const doc = typeof document !== 'undefined' ? document : null;
        if (!doc || typeof doc.startViewTransition !== 'function' || doc.hidden
            || doc.documentElement.hasAttribute('data-vt-active')) {
            change();
            return;
        }
        const html = doc.documentElement;
        const done = () => html.removeAttribute('data-vt-theme');
        html.setAttribute('data-vt-theme', '');
        let transition;
        try {
            transition = doc.startViewTransition(change);
        } catch (_) {
            done();
            change();
            return;
        }
        transition.finished.then(done, done);
    }

    // A language the visitor picks crosses over like a theme change instead
    // of the text and the page direction jumping at once. The page's own
    // toggleLanguage() does the work; picking the language already shown
    // just runs it, with nothing to fade.
    function chooseLanguage(lang) {
        const toggle = root.toggleLanguage;
        if (typeof toggle !== 'function') return;
        const doc = typeof document !== 'undefined' ? document : null;
        if (!doc || doc.documentElement.getAttribute('lang') === lang) {
            toggle(lang);
            return;
        }
        withThemeFade(() => toggle(lang));
    }

    const api = { applyLanguagePreference, swapLanguageText, swapPendingLanguage, computeFloatingMenuPosition, withThemeFade, chooseLanguage };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.applyLanguagePreference = applyLanguagePreference;
        root.swapPendingLanguage = swapPendingLanguage;
        root.computeFloatingMenuPosition = computeFloatingMenuPosition;
        root.withThemeFade = withThemeFade;
        root.chooseLanguage = chooseLanguage;
    }
})(typeof window !== 'undefined' ? window : globalThis);
