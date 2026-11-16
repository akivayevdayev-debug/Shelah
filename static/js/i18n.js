/*
 * Interface text for the browser, from the same catalogs the server uses
 * (locales/<code>/<namespace>.json, registry in locales/meta.json).
 *
 * The server writes the client namespaces of every switched-on language into
 * the page as a data block, <script type="application/json" id="i18n-catalog">
 * (backend/i18n.py client_catalog). This file reads it once and exposes
 * window.ShelahI18n:
 *
 *   translate(lang, 'ns.key', { name })  the text, {name} placeholders filled
 *   languages                            [{ code, name, dir }], for a language menu
 *   direction(lang)                      'ltr' | 'rtl'
 *   normalize(value)                     a switched-on code for value ('he-IL' -> 'he'),
 *                                        else the default; the one test of "is this a
 *                                        language the site shows"
 *   chain(lang)                          lang, then the languages that fill its gaps,
 *                                        ending with the default
 *
 * Counted text: when 'ns.key' itself is absent and the values carry a numeric
 * `count`, the text comes from 'ns.key.one' / '.two' / '.few' / '.many' /
 * '.other', chosen by the language's plural rules (Intl.PluralRules), with
 * '.other' as the fallback. "{count} places" never needs an n === 1 branch.
 *
 * A string missing in `lang` comes from its fallback language, then the
 * default (English). A key missing everywhere throws while the catalog is
 * strict (development and tests) and renders '' in production, with a
 * console error either way.
 *
 * The caller decides which language is on screen (shell.js t() passes its
 * own); this file only looks text up. Loaded inline in the head, before
 * topbar_shared.js, so every later script can use it. Node tests require it
 * and build a translator with createTranslator(catalog).
 */
(function (root) {
    'use strict';

    const PLACEHOLDER = /\{(\w+)\}/g;

    function fill(text, values) {
        if (!values) return text;
        return text.replace(PLACEHOLDER, (whole, name) => (
            Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole
        ));
    }

    function createTranslator(catalog) {
        const source = catalog || {};
        const strings = source.strings || {};
        const fallbackLang = source.default || 'en';
        const locales = Array.isArray(source.locales) ? source.locales : [];
        const byCode = new Map(locales.map((loc) => [loc.code, loc]));
        const chains = new Map();
        const pluralRules = new Map();

        function chain(lang) {
            if (chains.has(lang)) return chains.get(lang);
            const order = [];
            let current = byCode.has(lang) ? lang : fallbackLang;
            while (current && !order.includes(current)) {
                order.push(current);
                current = byCode.get(current)?.fallback || null;
            }
            if (!order.includes(fallbackLang)) order.push(fallbackLang);
            chains.set(lang, order);
            return order;
        }

        function find(lang, key) {
            for (const code of chain(lang)) {
                const text = strings[code]?.[key];
                if (typeof text === 'string') return text;
            }
            return null;
        }

        function missing(lang, key) {
            const message = `i18n: no text for "${key}" in any language (asked for ${lang})`;
            if (source.strict) throw new Error(message);
            if (root.console) root.console.error(message);
            return '';
        }

        function translate(lang, key, values) {
            let text = find(lang, key);
            if (text === null && typeof values?.count === 'number') {
                text = find(lang, `${key}.${category(lang, values.count)}`) ?? find(lang, `${key}.other`);
            }
            return text === null ? missing(lang, key) : fill(text, values);
        }

        function category(lang, n) {
            if (!pluralRules.has(lang)) {
                let rules = null;
                try { rules = new Intl.PluralRules(lang); } catch { rules = null; }
                pluralRules.set(lang, rules);
            }
            return pluralRules.get(lang)?.select(n) || 'other';
        }

        function direction(lang) {
            return byCode.get(lang)?.dir === 'rtl' ? 'rtl' : 'ltr';
        }

        function normalize(value) {
            const code = String(value || '').trim().toLowerCase().replace('_', '-').split('-')[0];
            return byCode.has(code) ? code : fallbackLang;
        }

        return Object.freeze({
            translate,
            direction,
            normalize,
            chain: (lang) => chain(lang).slice(),
            languages: Object.freeze(locales.map(({ code, name, dir }) => Object.freeze({ code, name, dir }))),
        });
    }

    function readPageCatalog(doc) {
        const block = doc?.getElementById?.('i18n-catalog');
        if (!block) return {};
        try { return JSON.parse(block.textContent || '{}'); } catch { return {}; }
    }

    if (typeof module === 'object' && module.exports) {
        module.exports = { createTranslator };
    } else {
        root.ShelahI18n = createTranslator(readPageCatalog(root.document));
    }
})(typeof window === 'undefined' ? globalThis : window);
