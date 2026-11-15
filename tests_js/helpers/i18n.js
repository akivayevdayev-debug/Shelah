'use strict';
/**
 * Interface text for tests, read from the real catalogs (locales/) through the
 * real lookup (static/js/i18n.js), the same way the page gets it from
 * backend/i18n.py client_catalog.
 *
 *   const { tFor, catalog } = require('./helpers/i18n');
 *   const t = tFor('en');        // (key, values) => text
 *   window.ShelahI18n = createTranslator(catalog)  // for scripts that read the global
 */
const fs = require('node:fs');
const path = require('node:path');
const { createTranslator } = require('../../static/js/i18n.js');

const LOCALES = path.join(__dirname, '..', '..', 'locales');

function loadCatalog() {
    const meta = JSON.parse(fs.readFileSync(path.join(LOCALES, 'meta.json'), 'utf8'));
    const namespaces = meta.client_namespaces || [];
    const enabled = meta.locales.filter((loc) => loc.enabled !== false);
    const strings = {};
    for (const loc of enabled) {
        strings[loc.code] = {};
        for (const ns of namespaces) {
            const file = path.join(LOCALES, loc.code, `${ns}.json`);
            if (!fs.existsSync(file)) continue;
            for (const [key, text] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))) {
                strings[loc.code][`${ns}.${key}`] = text;
            }
        }
    }
    return {
        default: meta.default || 'en',
        strict: true,
        locales: enabled.map(({ code, name, dir, fallback }) => ({ code, name, dir: dir || 'ltr', fallback: fallback || null })),
        strings,
    };
}

const catalog = loadCatalog();
const translator = createTranslator(catalog);

/** A t(key, values) for one language. */
function tFor(lang) {
    return (key, values) => translator.translate(lang, key, values);
}

module.exports = { catalog, translator, tFor, createTranslator };
