/**
 * The page's own event wiring: which function each button, backdrop and window
 * event reaches, and under what conditions. The functions they reach are
 * recorders here (each is tested where it is defined), so a test reads what a
 * click or a resize asked for. Boots the real home page in jsdom
 * (tests_js/helpers/shell_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');

const MOBILE = '(max-width: 1023px)';
const logOf = (page) => JSON.parse(page.eval('JSON.stringify(window.__log)'));
const names = (page) => logOf(page).map(([name]) => name);

/** Opens the page with each named function replaced by a recorder. */
async function openPage(recorded, extra = '') {
    const page = await openShellPage();
    page.eval(`
        window.__log = [];
        window.__rec = (name, value) => (...args) => { window.__log.push([name, ...args]); return value; };
        ${recorded.map((name) => `${name} = window.__rec('${name}');`).join('\n        ')}
        ${extra}
    `);
    return page;
}

// ─── Bookmarks and the mobile nav ────────────────────────────────────────────

test('the semantic bookmark button announces the page\'s own binding to reader-ui.js', async () => {
    const page = await openShellPage();
    try {
        assert.equal(page.eval('window.__shelahLegacyBookmarkBound'), true);
    } finally {
        page.close();
    }
});

test('the phone library tab opens the library drawer; on a wide screen it shows the sidebar', async () => {
    const page = await openPage(['openMobilePanel', 'setSidebarVisibility', 'setMobileSearchExpanded']);
    try {
        page.media.set(MOBILE, true);
        page.click('[data-mobile-tab="library"]');
        assert.deepEqual(logOf(page), [['setMobileSearchExpanded', false], ['openMobilePanel', 'left']]);
        assert.equal(page.$('[data-mobile-tab="library"]').classList.contains('mobile-tab-active'), true);

        page.eval('window.__log.length = 0');
        page.media.set(MOBILE, false);
        page.click('[data-mobile-tab="library"]');
        assert.deepEqual(logOf(page), [['setMobileSearchExpanded', false], ['setSidebarVisibility', 'left', true]]);
    } finally {
        page.close();
    }
});

test('the phone language button switches to the other language', async () => {
    const page = await openPage(['toggleLanguage']);
    try {
        page.click('#mobileLangToggle');
        page.eval(`displayedLanguage = 'he'`);
        page.click('#mobileLangToggle');
        assert.deepEqual(logOf(page), [['toggleLanguage', 'he'], ['toggleLanguage', 'en']]);
    } finally {
        page.close();
    }
});

// ─── Window events ───────────────────────────────────────────────────────────

test('a resize re-lays-out the bars and sidebars, and what depends on the width', async () => {
    const page = await openPage(['syncReaderTopBarOffset', 'applySidebarVisibility', 'positionUserProfileMenu', 'applyShulMode']);
    try {
        const resize = () => {
            page.eval('window.__log.length = 0');
            page.window.dispatchEvent(new page.window.Event('resize'));
            return names(page);
        };
        assert.deepEqual(resize(), ['syncReaderTopBarOffset', 'applySidebarVisibility']);

        page.$('#userProfileMenu').classList.remove('hidden');
        assert.deepEqual(resize(), ['syncReaderTopBarOffset', 'applySidebarVisibility', 'positionUserProfileMenu']);

        page.eval('appState.prefs.shulMode = true');
        assert.deepEqual(resize(), [
            'syncReaderTopBarOffset', 'applySidebarVisibility', 'positionUserProfileMenu', 'applyShulMode',
        ]);
    } finally {
        page.close();
    }
});

test('the settings panel follows a resize or a rotation only while it is open', async () => {
    const page = await openPage(['positionSettingsPanel']);
    try {
        for (const type of ['resize', 'orientationchange']) {
            page.$('#settingsPanel').classList.add('hidden');
            page.eval('window.__log.length = 0');
            page.window.dispatchEvent(new page.window.Event(type));
            assert.deepEqual(logOf(page), [], `${type} while closed`);

            page.$('#settingsPanel').classList.remove('hidden');
            page.window.dispatchEvent(new page.window.Event(type));
            assert.deepEqual(names(page), ['positionSettingsPanel'], `${type} while open`);
        }
    } finally {
        page.close();
    }
});

// ─── Reader top-bar buttons ──────────────────────────────────────────────────

test('the library button in the reader bar opens the library, or its peek panel in shul mode', async () => {
    const page = await openPage(['toggleLeftSidebar', 'toggleShulLibrarySidebar']);
    try {
        page.click('#readerLibraryTopBarBtn');
        assert.deepEqual(names(page), ['toggleLeftSidebar']);

        page.eval('window.__log.length = 0; appState.prefs.shulMode = true');
        page.click('#readerLibraryTopBarBtn');
        assert.deepEqual(names(page), ['toggleShulLibrarySidebar']);
    } finally {
        page.close();
    }
});

const COMMENTARY_STUBS = [
    'startReadingCommentary', 'resetSelectionInsights', 'setCommentaryAvailability', 'showSelectionInsights',
    'openMobilePanel', 'setSidebarVisibility',
];

function commentaryState(page, { eligible, mode, available }) {
    page.eval(`
        window.__log.length = 0;
        isCommentaryEligiblePrimaryText = () => ${eligible};
        selectionCommentaryState.mode = '${mode}';
        commentaryAvailableForCurrentSelection = ${available};
    `);
}

test('the commentary button starts following the verse being read when no passage is selected', async () => {
    const page = await openPage(COMMENTARY_STUBS);
    try {
        commentaryState(page, { eligible: true, mode: 'reading', available: true });
        page.click('#readerCommentaryTopBarBtn');
        assert.deepEqual(logOf(page), [['startReadingCommentary'], ['setSidebarVisibility', 'right', true]]);

        // Nothing available for the selection yet: also follow the reading.
        commentaryState(page, { eligible: true, mode: 'selection', available: false });
        page.click('#readerCommentaryTopBarBtn');
        assert.deepEqual(names(page), ['startReadingCommentary', 'setSidebarVisibility']);
    } finally {
        page.close();
    }
});

test('the commentary button on a selection that has commentary only shows the column', async () => {
    const page = await openPage(COMMENTARY_STUBS);
    try {
        commentaryState(page, { eligible: true, mode: 'selection', available: true });
        page.click('#readerCommentaryTopBarBtn');
        assert.deepEqual(logOf(page), [['setSidebarVisibility', 'right', true]]);
    } finally {
        page.close();
    }
});

test('the commentary button on a page that cannot follow a reading starts afresh and shows the insights', async () => {
    const page = await openPage(COMMENTARY_STUBS);
    try {
        commentaryState(page, { eligible: false, mode: 'selection', available: false });
        page.click('#readerCommentaryTopBarBtn');
        assert.deepEqual(logOf(page), [
            ['resetSelectionInsights'],
            ['setCommentaryAvailability', true],
            ['showSelectionInsights'],
            ['setSidebarVisibility', 'right', true],
        ]);
    } finally {
        page.close();
    }
});

test('on a phone the commentary button opens the sources drawer instead', async () => {
    const page = await openPage(COMMENTARY_STUBS);
    try {
        page.media.set(MOBILE, true);
        commentaryState(page, { eligible: true, mode: 'reading', available: true });
        page.click('#readerCommentaryTopBarBtn');
        assert.deepEqual(logOf(page), [['startReadingCommentary'], ['openMobilePanel', 'right']]);
    } finally {
        page.close();
    }
});

// ─── Chapter grid ────────────────────────────────────────────────────────────

function addGridButton(page, container, className, ref) {
    page.window.__button = { container, className, ref };
    page.eval(`
        const spec = window.__button;
        const button = document.createElement('button');
        button.className = spec.className;
        if (spec.ref !== null) button.dataset.ref = spec.ref;
        button.id = 'gridButton';
        document.getElementById(spec.container).replaceChildren(button);
    `);
}

for (const [container, className] of [
    ['chapterGridItems', 'chapter-grid-item'],
    ['chapterGridParashaStrip', 'chapter-grid-parasha-link'],
]) {
    test(`a click on a ${className} closes the grid and reads that section`, async () => {
        const page = await openPage(['closeChapterGrid', 'readText']);
        try {
            addGridButton(page, container, className, ' Genesis 3 ');
            page.click('#gridButton');
            assert.deepEqual(logOf(page), [['closeChapterGrid'], ['readText', 'Genesis 3', { skipNavigationGrid: true }]]);
        } finally {
            page.close();
        }
    });

    test(`a click in the ${container} that is not on a section, or on one with no reference, does nothing`, async () => {
        const page = await openPage(['closeChapterGrid', 'readText']);
        try {
            addGridButton(page, container, 'something-else', 'Genesis 3');
            page.click('#gridButton');
            addGridButton(page, container, className, '  ');
            page.click('#gridButton');
            addGridButton(page, container, className, null);
            page.click('#gridButton');
            page.click(`#${container}`);
            assert.deepEqual(logOf(page), []);
        } finally {
            page.close();
        }
    });
}

test('the chapter grid closes from its close button and from a click on its backdrop, not from inside it', async () => {
    const page = await openPage(['closeChapterGrid']);
    try {
        page.click('#closeChapterGridModalBtn');
        assert.equal(logOf(page).length, 1);
        page.click('#chapterGridModal');
        assert.equal(logOf(page).length, 2);
        page.click('#chapterGridItems');
        assert.equal(logOf(page).length, 2);
    } finally {
        page.close();
    }
});

// ─── Backdrops and the developer inspector ───────────────────────────────────

test('the library category and privacy dialogs close on a click on their own backdrop, not on their content', async () => {
    const page = await openPage(['closeLibraryCategory', 'closePrivacyDataModal']);
    try {
        page.click('#libraryCategoryModal');
        assert.deepEqual(names(page), ['closeLibraryCategory']);
        page.click('#privacyDataModal');
        assert.deepEqual(names(page), ['closeLibraryCategory', 'closePrivacyDataModal']);

        page.eval('window.__log.length = 0');
        const inner = page.$('#libraryCategoryModal > *');
        if (inner) inner.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        const privacyInner = page.$('#privacyDataModal > *');
        if (privacyInner) privacyInner.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        assert.deepEqual(logOf(page), []);
    } finally {
        page.close();
    }
});

test('a shift double-click on the brand opens the developer inspector; a plain one does not', async () => {
    const page = await openPage(['openDevtoolsInspector']);
    try {
        const dblclick = (init) => {
            const event = new page.window.MouseEvent('dblclick', { bubbles: true, cancelable: true, ...init });
            page.$('#brandHomeBtn').dispatchEvent(event);
            return event.defaultPrevented;
        };
        assert.equal(dblclick({}), false);
        assert.deepEqual(logOf(page), []);
        assert.equal(dblclick({ shiftKey: true }), true);
        assert.deepEqual(names(page), ['openDevtoolsInspector']);
    } finally {
        page.close();
    }
});
