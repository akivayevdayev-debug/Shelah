/**
 * Saved preferences: what the page makes of what an older version (or a
 * hand-edited entry) left in localStorage. Boots the real home page in jsdom
 * (tests_js/helpers/shell_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');

const PREFS_KEY = "Sh'elahPrefs";

async function openWithSaved(saved) {
    const raw = typeof saved === 'string' ? saved : JSON.stringify(saved);
    return openShellPage({ storage: { [PREFS_KEY]: raw } });
}

const prefs = (page) => JSON.parse(page.eval('JSON.stringify(appState.prefs)'));

test('saved preferences are laid over the defaults', async () => {
    const page = await openWithSaved({ mode: 'deep', shulScrollSpeed: 55, theme: 'dark', transliteration: 1 });
    try {
        const saved = prefs(page);
        assert.equal(saved.mode, 'deep');
        assert.equal(saved.shulScrollSpeed, 55);
        assert.equal(saved.theme, 'dark');
        assert.equal(saved.transliteration, true);
        assert.equal(saved.community, 'All');
        assert.equal(page.eval('preferencesHydrated'), true);
    } finally {
        page.close();
    }
});

test('an unreadable saved entry leaves the defaults in place', async () => {
    const page = await openWithSaved('{not json');
    try {
        const saved = prefs(page);
        assert.equal(saved.mode, 'balanced');
        assert.equal(saved.theme, 'light');
        assert.equal(saved.shulScrollSpeed, 28);
        assert.equal(saved.showVowels, true);
        assert.equal(saved.showCantillation, true);
        assert.equal(saved.shulMode, false);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('community names from older versions are renamed to today\'s', async () => {
    for (const [old, current] of [
        ['Ashkenazi', 'Ashkenaz'],
        ['Sefardi', 'Sefardic'],
        ['Sephardi', 'Sefardic'],
        ['Mizrahi', 'Iraqi'],
        ['Turkish-Ottoman Sefardic', 'Turkish-Ottoman'],
        ['Legacy Customs DB', 'Ashkenaz'],
        ['Yemenite', 'Yemenite'],
    ]) {
        const page = await openWithSaved({ community: old });
        try {
            assert.equal(prefs(page).community, current, old);
        } finally {
            page.close();
        }
    }
});

test('a side with no usable saved value takes the old single sidebar switch; the old key is dropped', async () => {
    const hidden = await openWithSaved({ showSidebars: false, showLeftSidebar: null, showRightSidebar: 'yes' });
    try {
        const saved = prefs(hidden);
        assert.equal(saved.showLeftSidebar, false);
        assert.equal(saved.showRightSidebar, false);
        assert.equal('showSidebars' in saved, false);
    } finally {
        hidden.close();
    }

    const shown = await openWithSaved({ showSidebars: true, showLeftSidebar: 'yes' });
    try {
        assert.equal(prefs(shown).showLeftSidebar, true);
    } finally {
        shown.close();
    }

    // A side that was saved on its own is kept as saved.
    const mixed = await openWithSaved({ showSidebars: false, showLeftSidebar: true, showRightSidebar: true });
    try {
        assert.equal(prefs(mixed).showLeftSidebar, true);
        assert.equal(prefs(mixed).showRightSidebar, true);
    } finally {
        mixed.close();
    }
});

test('the reader layout is one the reader can draw', async () => {
    for (const [saved, expected] of [
        ['stacked', 'interleaved'],
        ['interleaved', 'interleaved'],
        ['english', 'english'],
        ['hebrew', 'hebrew'],
        ['bilingual-reverse', 'bilingual-reverse'],
        ['sideways', 'bilingual'],
        [undefined, undefined],
    ]) {
        const page = await openWithSaved(saved === undefined ? {} : { readerLayout: saved });
        try {
            const layout = prefs(page).readerLayout;
            if (expected === undefined) {
                assert.ok(['bilingual', 'bilingual-reverse', 'interleaved', 'english', 'hebrew'].includes(layout), layout);
            } else {
                assert.equal(layout, expected, String(saved));
            }
        } finally {
            page.close();
        }
    }
});

test('metadata filters are trimmed to strings, and an unknown theme is light', async () => {
    const page = await openWithSaved({
        theme: 'neon',
        metadataFilters: { era: ' Rishonim ', author: 5, category: null, junk: 'dropped' },
    });
    try {
        const saved = prefs(page);
        assert.deepEqual(saved.metadataFilters, { era: 'Rishonim', author: '5', category: '', geography: '', nusach: '' });
        assert.equal(saved.theme, 'light');
    } finally {
        page.close();
    }
});

test('shul settings are coerced to the types the reader expects', async () => {
    const page = await openWithSaved({ shulMode: 'yes', shulAutoScroll: 0, shulScrollSpeed: '35', showVowels: false, showCantillation: false });
    try {
        const saved = prefs(page);
        assert.equal(saved.shulMode, true);
        assert.equal(saved.shulAutoScroll, false);
        assert.equal(saved.shulScrollSpeed, 35);
        assert.equal(saved.showVowels, false);
        assert.equal(saved.showCantillation, false);
    } finally {
        page.close();
    }
});
