/**
 * The home page's three server-fed regions (this week's parasha link, today's
 * study, popular texts), the offline worker's registration, and the Hebrew date
 * that floats in the mobile top bar. Boots the real home page in jsdom
 * (tests_js/helpers/shell_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');

const plain = (value) => JSON.parse(JSON.stringify(value));
const PARASHA = { title: 'Parashat Noach', heTitle: 'פרשת נח', ref: 'Genesis 6:9' };
const DAILY = {
    hebrew_date: '7 Cheshvan 5787',
    daf_yomi: { title: 'Berakhot 2a', title_he: 'ברכות ב׳ א', ref: 'Berakhot 2a' },
    mishnah_yomi: { title: 'Mishnah Peah 1:1', ref: 'Mishnah Peah 1:1' },
    rambam: {},
};
const POPULAR = {
    Tanakh: [{ ref: 'Genesis 1', title: 'Genesis', he: 'בראשית', description: 'The book of beginnings' }],
    Talmud: [{ ref: 'Berakhot 2a', title: 'Berakhot', description: 'Blessings' }],
    Other: [{ ref: 'Odd & <Ref>', title: '<b>Odd</b>', he: '<i>x</i>', description: 'a "quoted" thing' }],
};

/** The page with every home region answered; a test overrides what it is about. */
function openHomePage({ routes = {}, ...options } = {}) {
    return openShellPage({
        fetch: { '/api/parasha': PARASHA, '/api/daily-study': DAILY, '/api/library/popular': POPULAR, ...routes },
        ...options,
    });
}
const only = (page, url) => page.calls.filter((call) => call.url === url);
const text = (element) => element.textContent.replace(/\s+/g, ' ').trim();

// --- this week's parasha ------------------------------------------------------------

test('the parasha link names the portion in both languages and opens its first verse', async () => {
    const page = await openHomePage();
    try {
        for (const id of ['parashaQuickLink', 'homeParashaQuickLink']) {
            const link = page.$(`#${id}`);
            assert.equal(link.textContent, 'Parashat Noach · פרשת נח', id);
            assert.equal(link.dataset.en, 'Parashat Noach · פרשת נח');
            assert.equal(link.dataset.he, 'פרשת נח');
            assert.equal(link.title, 'Open Parashat Noach (פרשת נח)');
            assert.equal(link.dataset.onclickArg, 'Genesis 6:9');
        }
        const week = page.$('#shabbatWeekName');
        assert.equal(week.title, 'Open Parashat Noach (פרשת נח)', 'the Shabbat widget keeps its text but opens the same portion');
        assert.equal(week.dataset.onclickArg, 'Genesis 6:9');
        assert.notEqual(week.textContent, 'Parashat Noach · פרשת נח');
    } finally {
        page.close();
    }
});

test('in Hebrew mode the parasha link reads in Hebrew', async () => {
    const page = await openHomePage({ storage: { preferredLanguage: 'he' } });
    try {
        const link = page.$('#parashaQuickLink');
        assert.equal(link.textContent, 'פרשת נח');
        assert.equal(link.title, 'פתח פרשת נח');
    } finally {
        page.close();
    }
});

test('without a Hebrew title the page derives one from the English name', async () => {
    const page = await openHomePage({ routes: { '/api/parasha': { title: 'Parashat Noach', source: 'calendar-fallback' } } });
    try {
        assert.equal(page.$('#parashaQuickLink').textContent, 'Parashat Noach · פרשת נח');
    } finally {
        page.close();
    }
});

test('a parasha answer with no title or ref falls back to the generic link', async () => {
    const page = await openHomePage({ routes: { '/api/parasha': {} } });
    try {
        const link = page.$('#parashaQuickLink');
        assert.equal(link.textContent, 'Parashat HaShavua · פרשת השבוע');
        assert.equal(link.title, 'Open Parashat HaShavua (פרשת השבוע)');
        assert.equal(link.dataset.onclickArg, 'Genesis 1');
    } finally {
        page.close();
    }
});

test('a recent answer is reused, an old one is asked for again', async () => {
    const page = await openHomePage();
    try {
        assert.equal(only(page, '/api/parasha').length, 1);
        await page.eval('loadParashaQuickLink()');
        assert.equal(only(page, '/api/parasha').length, 1, 'fresh in memory');

        page.eval(`textsCache.parashaQuickLinkTs = Date.now() - PARASHA_CACHE_TTL_MS - 1`);
        await page.eval('loadParashaQuickLink()');
        assert.equal(only(page, '/api/parasha').length, 2, 'older than the cache lifetime');
    } finally {
        page.close();
    }
});

test('a parasha that cannot be fetched leaves the default link and tries again later', async () => {
    const page = await openHomePage({ routes: { '/api/parasha': { status: 503, body: {} } } });
    try {
        const retries = [];
        page.window.ShelahLoadRegion.retryLater = (...args) => retries.push(args);
        assert.equal(page.$('#parashaQuickLink').dataset.onclickArg, 'Genesis 1');
        await page.eval('loadParashaQuickLink(2)');
        assert.equal(retries.length, 1);
        assert.equal(retries[0][0], page.$('#parashaQuickLink'));
        assert.equal(retries[0][2].attempt, 2);
        retries[0][1](3);
        await page.settle();
        assert.equal(only(page, '/api/parasha').length, 3, 'boot, the failed retry call, and the scheduled retry');

        const before = retries.length;
        page.window.fetch = () => { throw new Error('offline'); };
        await page.eval('loadParashaQuickLink()');
        assert.equal(retries.length, before + 1, 'a network error is retried too');
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('with none of the parasha links on the page there is nothing to fetch', async () => {
    const page = await openHomePage();
    try {
        for (const id of ['parashaQuickLink', 'homeParashaQuickLink', 'shabbatWeekName']) page.$(`#${id}`).remove();
        page.takeCalls();
        await page.eval('loadParashaQuickLink()');
        assert.deepEqual(page.calls, []);
    } finally {
        page.close();
    }
});

// --- today's study --------------------------------------------------------------------

test('today\'s study lists each schedule that has a title, and sets the Hebrew date', async () => {
    const page = await openHomePage();
    try {
        const rows = page.$$('#dailyStudyList .home-daily-entry');
        assert.deepEqual(rows.map(text), ['Daf Yomi Berakhot 2a', 'Mishnah Yomi Mishnah Peah 1:1']);
        const [daf, mishnah] = page.$$('#dailyStudyList .daily-study-link');
        assert.equal(daf.dataset.dailyRef, 'Berakhot 2a');
        assert.equal(daf.dataset.he, 'ברכות ב׳ א');
        assert.equal(mishnah.dataset.he, 'Mishnah Peah 1:1', 'no Hebrew title: the English one');
        assert.equal(page.$('#dailyStudyList').hasAttribute('aria-busy'), false);
        assert.equal(page.$('#hebrewDateDisplay').textContent, '7 Cheshvan 5787');
        assert.equal(page.$('#hebrewDateDisplay').dataset.en, '7 Cheshvan 5787');
    } finally {
        page.close();
    }
});

test('in Hebrew mode today\'s study uses the Hebrew labels and titles', async () => {
    const page = await openHomePage({ storage: { preferredLanguage: 'he' } });
    try {
        const [first] = page.$$('#dailyStudyList .home-daily-entry');
        assert.equal(first.querySelector('.home-daily-label').textContent, 'דף יומי');
        assert.equal(first.querySelector('.daily-study-link').textContent, 'ברכות ב׳ א');
        assert.equal(page.$('#hebrewDateDisplay').getAttribute('dir'), 'rtl');
    } finally {
        page.close();
    }
});

test('clicking today\'s study opens that text; a link with no reference does nothing', async () => {
    const page = await openHomePage();
    try {
        const opened = [];
        page.window.__opened = opened;
        page.eval(`readText = async (ref) => { window.__opened.push(ref); }`);
        page.click(page.$$('#dailyStudyList .daily-study-link')[0]);
        await page.settle();
        assert.deepEqual(opened, ['Berakhot 2a']);
        const blank = page.$$('#dailyStudyList .daily-study-link')[1];
        blank.dataset.dailyRef = '  ';
        page.click(blank);
        await page.settle();
        assert.deepEqual(opened, ['Berakhot 2a']);
    } finally {
        page.close();
    }
});

test('today\'s study escapes what the server sends', async () => {
    const page = await openHomePage({
        routes: { '/api/daily-study': { daf_yomi: { title: '<img src=x onerror=bad()>', ref: '"><script>bad()</script>' } } },
    });
    try {
        assert.equal(page.$('#dailyStudyList img'), null);
        assert.equal(page.$('#dailyStudyList script'), null);
        assert.equal(page.$('#dailyStudyList .daily-study-link').textContent, '<img src=x onerror=bad()>');
        assert.equal(page.$('#dailyStudyList .daily-study-link').dataset.dailyRef, '"><script>bad()</script>');
    } finally {
        page.close();
    }
});

test('with no schedule in the answer, or an unreadable one, the list says so', async () => {
    for (const answer of [{}, 'not json at all']) {
        const page = await openHomePage({ routes: { '/api/daily-study': answer } });
        try {
            assert.equal(text(page.$('#dailyStudyList')), 'No active schedule fetched.');
            assert.equal(page.$('#hebrewDateDisplay').textContent, 'Today');
        } finally {
            page.close();
        }
    }
});

test('a date taken from the reader\'s location is not overwritten by the server\'s', async () => {
    const page = await openShellPage({
        fetch: { '/api/parasha': PARASHA, '/api/library/popular': POPULAR, '/api/daily-study': DAILY },
        before: () => {},
    });
    try {
        page.eval(`hebrewDateFromLocation = true; document.getElementById('hebrewDateDisplay').textContent = 'From location'`);
        await page.eval('populateDailyStudy()');
        assert.equal(page.$('#hebrewDateDisplay').textContent, 'From location');
    } finally {
        page.close();
    }
});

test('if today\'s study cannot be loaded the list offers a retry that brings it back', async () => {
    let answer = { status: 500, body: {} };
    const page = await openHomePage({ routes: { '/api/daily-study': () => answer } });
    try {
        const alert = page.$('#dailyStudyList [role="alert"]');
        assert.match(alert.textContent, /Couldn't load today's study/);
        answer = DAILY;
        page.click(alert.querySelector('.region-error__retry'));
        await page.settle();
        assert.equal(page.$('#dailyStudyList [role="alert"]'), null);
        assert.equal(page.$$('#dailyStudyList .home-daily-entry').length, 2);
        assert.equal(page.$('#dailyStudyList').getAttribute('aria-busy'), 'false');
    } finally {
        page.close();
    }
});

test('the Hebrew failure message is Hebrew', async () => {
    const page = await openHomePage({ routes: { '/api/daily-study': { status: 500, body: {} } }, storage: { preferredLanguage: 'he' } });
    try {
        assert.match(page.$('#dailyStudyList [role="alert"]').textContent, /לא ניתן לטעון את הלימוד היומי/);
    } finally {
        page.close();
    }
});

test('without a daily study list there is nothing to fetch', async () => {
    const page = await openHomePage();
    try {
        page.$('#dailyStudyList').remove();
        page.takeCalls();
        await page.eval('populateDailyStudy()');
        assert.deepEqual(page.calls, []);
    } finally {
        page.close();
    }
});

// --- popular texts -----------------------------------------------------------------------

test('popular texts become one button per text, under the category colours', async () => {
    const page = await openHomePage();
    try {
        const buttons = page.$$('#popularTextsGrid button');
        assert.equal(buttons.length, 3);
        const [genesis, berakhot] = buttons;
        assert.equal(genesis.getAttribute('data-onclick'), 'readText');
        assert.equal(decodeURIComponent(genesis.getAttribute('data-onclick-arg')), 'Genesis 1');
        assert.equal(genesis.getAttribute('data-onclick-encoding'), 'uri');
        assert.equal(genesis.getAttribute('dir'), 'ltr');
        assert.ok(genesis.classList.contains('text-start'));
        assert.ok(genesis.className.includes('hover:border-[#004e5f]'), 'Tanakh colour');
        assert.ok(berakhot.className.includes('hover:border-[#a08a4a]'), 'Talmud colour');
        assert.ok(buttons[2].className.includes('hover:border-[#374151]'), 'unknown category colour');
        assert.deepEqual([...genesis.querySelectorAll('div')].map(text), ['בראשית', 'Genesis', 'The book of beginnings']);
        assert.equal(page.$('#popularTextsGrid').getAttribute('aria-busy'), 'false');
    } finally {
        page.close();
    }
});

test('a text with no Hebrew name is headed by its Hebrew label or its English title', async () => {
    const page = await openHomePage();
    try {
        const heading = (button) => button.querySelector('div').textContent;
        const [, berakhot] = page.$$('#popularTextsGrid button');
        assert.equal(heading(berakhot), 'ברכות', 'the static Hebrew label for the title');
        assert.equal(heading(page.$$('#popularTextsGrid button')[2]), '<i>x</i>', 'shown as text, not markup');
    } finally {
        page.close();
    }
});

test('popular texts never turn server text into markup', async () => {
    const page = await openHomePage();
    try {
        const odd = page.$$('#popularTextsGrid button')[2];
        assert.equal(odd.querySelector('b'), null);
        assert.equal(odd.querySelector('i'), null);
        assert.equal(decodeURIComponent(odd.getAttribute('data-onclick-arg')), 'Odd & <Ref>');
        assert.equal(odd.querySelectorAll('div')[1].textContent, '<b>Odd</b>');
        assert.equal(odd.querySelectorAll('div')[2].textContent, 'a "quoted" thing');
    } finally {
        page.close();
    }
});

test('in Hebrew mode popular texts read right to left with Hebrew titles', async () => {
    const page = await openHomePage({ storage: { preferredLanguage: 'he' } });
    try {
        const genesis = page.$('#popularTextsGrid button');
        assert.equal(genesis.getAttribute('dir'), 'rtl');
        assert.ok(genesis.classList.contains('text-end'));
        assert.equal(genesis.querySelectorAll('div')[1].textContent, 'בראשית');
    } finally {
        page.close();
    }
});

test('popular texts are fetched once for twelve hours, then again', async () => {
    const page = await openHomePage();
    try {
        assert.equal(only(page, '/api/library/popular').length, 1);
        await page.eval('populatePopularTexts()');
        assert.equal(only(page, '/api/library/popular').length, 1);
        page.eval(`textsCache.popularTextsTs = Date.now() - POPULAR_TEXTS_CACHE_TTL_MS - 1`);
        await page.eval('populatePopularTexts()');
        assert.equal(only(page, '/api/library/popular').length, 2);
    } finally {
        page.close();
    }
});

test('if popular texts cannot be loaded the grid offers a retry that brings them back', async () => {
    let answer = { status: 502, body: {} };
    const page = await openHomePage({ routes: { '/api/library/popular': () => answer } });
    try {
        const alert = page.$('#popularTextsGrid [role="alert"]');
        assert.match(alert.textContent, /Couldn't load popular texts/);
        answer = POPULAR;
        page.click(alert.querySelector('.region-error__retry'));
        await page.settle();
        assert.equal(page.$$('#popularTextsGrid button').length, 3);
        assert.equal(page.$('#popularTextsGrid [role="alert"]'), null);
    } finally {
        page.close();
    }
});

test('without a popular-texts grid there is nothing to fetch', async () => {
    const page = await openHomePage();
    try {
        page.$('#popularTextsGrid').remove();
        page.takeCalls();
        await page.eval('populatePopularTexts()');
        assert.deepEqual(page.calls, []);
    } finally {
        page.close();
    }
});

// --- the offline worker --------------------------------------------------------------------

function fakeServiceWorker(page, { registrations = [], cacheKeys = [], registerError = null, getError = null } = {}) {
    const log = { unregistered: [], deleted: [], registered: [] };
    Object.defineProperty(page.window.navigator, 'serviceWorker', {
        configurable: true,
        value: {
            getRegistrations: async () => {
                if (getError) throw getError;
                return registrations.map((name) => ({ unregister: async () => { log.unregistered.push(name); } }));
            },
            register: async (...args) => {
                if (registerError) throw registerError;
                log.registered.push(plain(args));
            },
        },
    });
    page.window.caches = {
        keys: async () => cacheKeys,
        delete: async (key) => { log.deleted.push(key); return true; },
    };
    return log;
}

function recordReliability(page) {
    page.reliability = [];
    page.window.console.info = (...args) => page.reliability.push(args.join(' '));
}

test('without service worker support nothing is registered', async () => {
    const page = await openHomePage();
    try {
        assert.equal('serviceWorker' in page.window.navigator, false);
        assert.equal(await page.eval('registerServiceWorker()'), undefined);
    } finally {
        page.close();
    }
});

test('the first visit after the version bump clears the old workers and caches, then registers the new one', async () => {
    const page = await openHomePage();
    try {
        recordReliability(page);
        const log = fakeServiceWorker(page, {
            registrations: ['old-1', 'old-2'],
            cacheKeys: ['shelah-cache-v1', 'someone-elses-cache', 'shelah-cache-v2'],
        });
        await page.eval('registerServiceWorker()');
        assert.deepEqual(log.unregistered, ['old-1', 'old-2']);
        assert.deepEqual(log.deleted, ['shelah-cache-v1', 'shelah-cache-v2'], 'only this app\'s caches');
        assert.deepEqual(log.registered, [['/service-worker.js?swv=3', { updateViaCache: 'none' }]]);
        assert.equal(page.window.localStorage.getItem('shelah-sw-v3-migrated'), 'true');
        assert.ok(page.reliability.some((line) => line.includes('service-worker-registered')));
    } finally {
        page.close();
    }
});

test('once migrated, the cleanup is not repeated', async () => {
    const page = await openHomePage({ storage: { 'shelah-sw-v3-migrated': 'true' } });
    try {
        const log = fakeServiceWorker(page, { registrations: ['old'], cacheKeys: ['shelah-cache-v1'] });
        await page.eval('registerServiceWorker()');
        assert.deepEqual([log.unregistered, log.deleted], [[], []]);
        assert.equal(log.registered.length, 1);
    } finally {
        page.close();
    }
});

test('a cleanup that fails does not stop the new worker from registering', async () => {
    const page = await openHomePage();
    try {
        const log = fakeServiceWorker(page, { getError: new Error('denied') });
        await page.eval('registerServiceWorker()');
        assert.equal(log.registered.length, 1);
        assert.equal(page.window.localStorage.getItem('shelah-sw-v3-migrated'), 'true');
    } finally {
        page.close();
    }
});

test('without the Cache API only the registrations are cleared', async () => {
    const page = await openHomePage();
    try {
        const log = fakeServiceWorker(page, { registrations: ['old'] });
        delete page.window.caches;
        await page.eval('registerServiceWorker()');
        assert.deepEqual(log.unregistered, ['old']);
        assert.equal(log.registered.length, 1);
    } finally {
        page.close();
    }
});

test('a worker that cannot be registered is logged, not thrown', async () => {
    const page = await openHomePage();
    try {
        recordReliability(page);
        fakeServiceWorker(page, { registerError: new Error('blocked by policy') });
        await page.eval('registerServiceWorker()');
        assert.ok(page.reliability.some((line) => line.includes('service-worker-register-failed') && line.includes('blocked by policy')));
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});

test('the worker is registered a few seconds after the page settles', async () => {
    const delays = [];
    const page = await openHomePage({
        before: (window) => {
            const real = window.setTimeout.bind(window);
            window.setTimeout = (fn, ms, ...rest) => { delays.push(ms); return real(fn, ms, ...rest); };
        },
    });
    try {
        assert.ok(delays.includes(3000), 'registration waits three seconds');
    } finally {
        page.close();
    }
});

// --- the Hebrew date in the mobile top bar ----------------------------------------------------

function layOutTopbar(page, { brand, settings, dateWidth }) {
    const rect = ([left, right]) => ({ left, right, top: 0, bottom: 40, width: right - left, height: 40 });
    page.$('#brandHomeBtn').getBoundingClientRect = () => rect(brand);
    page.$('#settingsMenuBtn').getBoundingClientRect = () => rect(settings);
    Object.defineProperty(page.$('#hebrewDateDisplay'), 'offsetWidth', { configurable: true, value: dateWidth });
}

test('on a desktop the date is left to the stylesheet', async () => {
    const page = await openHomePage();
    try {
        const date = page.$('#hebrewDateDisplay');
        date.style.display = 'none';
        date.style.left = '5px';
        page.eval('syncHebrewDateMobilePosition()');
        assert.equal(date.style.display, '');
        assert.equal(date.style.left, '');
    } finally {
        page.close();
    }
});

test('on a phone the date sits in the gap, next to the settings button', async () => {
    const page = await openHomePage();
    try {
        page.media.set('(max-width: 1023px)', true);
        layOutTopbar(page, { brand: [0, 100], settings: [300, 340], dateWidth: 80 });
        page.eval('syncHebrewDateMobilePosition()');
        const date = page.$('#hebrewDateDisplay');
        assert.equal(date.style.display, 'block');
        // The right edge hugs the settings button (16px away); the centre is half its width left of that.
        assert.equal(date.style.left, '244px');
    } finally {
        page.close();
    }
});

test('with the settings button on the left (right-to-left) the date hugs it from the other side', async () => {
    const page = await openHomePage();
    try {
        page.media.set('(max-width: 1023px)', true);
        layOutTopbar(page, { brand: [300, 400], settings: [20, 60], dateWidth: 80 });
        page.eval('syncHebrewDateMobilePosition()');
        assert.equal(page.$('#hebrewDateDisplay').style.left, '116px');
    } finally {
        page.close();
    }
});

test('the date keeps 12px clear of the logo when the gap is only just wide enough', async () => {
    const wide = async (layout) => {
        const page = await openHomePage();
        try {
            page.media.set('(max-width: 1023px)', true);
            layOutTopbar(page, layout);
            page.eval('syncHebrewDateMobilePosition()');
            return [page.$('#hebrewDateDisplay').style.display, page.$('#hebrewDateDisplay').style.left];
        } finally {
            page.close();
        }
    };
    // 105px gap for an 80px date: hugging the settings button would leave the date 11px from the logo.
    assert.deepEqual(await wide({ brand: [0, 100], settings: [205, 245], dateWidth: 80 }), ['block', '152px']);
    assert.deepEqual(await wide({ brand: [145, 245], settings: [0, 40], dateWidth: 80 }), ['block', '93px']);
});

test('when there is no room for the date it is hidden', async () => {
    const page = await openHomePage();
    try {
        page.media.set('(max-width: 1023px)', true);
        layOutTopbar(page, { brand: [0, 100], settings: [150, 190], dateWidth: 80 });
        page.eval('syncHebrewDateMobilePosition()');
        assert.equal(page.$('#hebrewDateDisplay').style.display, 'none');
    } finally {
        page.close();
    }
});

test('without the date, the brand or the settings button there is nothing to position', async () => {
    const page = await openHomePage();
    try {
        page.media.set('(max-width: 1023px)', true);
        page.$('#settingsMenuBtn').remove();
        assert.equal(page.eval('syncHebrewDateMobilePosition()'), undefined);
    } finally {
        page.close();
    }
});
