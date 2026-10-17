/**
 * The holidays calendar: the year-by-year fetch and its cache, how the grid is
 * built and what each of its callbacks does, the agenda under it, opening and
 * closing the dialog (and the history entry that goes with it), and the Hebrew
 * names it shows. FullCalendar is a stand-in that records its options
 * (tests_js/helpers/shell_fakes.js); the page is the real one in jsdom.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');
const { fakeFullCalendar, fakeRouter } = require('./helpers/shell_fakes');

const plain = (value) => JSON.parse(JSON.stringify(value));
const call = (page, name, ...args) => page.call(name, ...args);
const keyOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const HOLIDAYS_2026 = [
    { title: '🕍 Parashat Bereshit', start: '2026-10-10', category: 'parashat', detail: { reading: 'Genesis 1:1-6:8' } },
    { title: '🌙 Rosh Chodesh Cheshvan', start: '2026-10-11', end: '2026-10-13', category: 'roshchodesh' },
    { title: 'Yom Kippur', start: '2026-09-21', category: 'holiday', detail: { subcat: 'major' } },
    { title: 'Shabbat Shuva', start: '2026-09-19', category: 'shabbat' },
];

/**
 * The home page with FullCalendar, the detail card and the router stood in.
 * `year` routes answer /api/holidays?year=<year>; `calls` lists every request.
 */
async function openCalendarPage({ holidays = () => HOLIDAYS_2026, router = fakeRouter() } = {}) {
    const calendar = fakeFullCalendar();
    const detail = [];
    const reliability = [];
    const page = await openShellPage({
        fetch: { '/api/holidays': (url) => holidays(Number(new URL(url, 'https://shelah.org').searchParams.get('year'))) },
        before: (window) => { window.console.info = (...args) => reliability.push(args.join(' ')); },
    });
    page.window.FullCalendar = calendar.FullCalendar;
    page.window.ShelahRouter = router;
    page.window.ShelahCalendarDetail = {
        open: (options) => detail.push(['open', options]),
        close: (options) => detail.push(['close', options]),
    };
    Object.assign(page, { calendar, detail, router, reliability });
    // The page also fetches its home-page data in the background; these tests only count holiday requests.
    const takeEverything = page.takeCalls.bind(page);
    page.takeCalls = () => takeEverything().filter((request) => request.url.startsWith('/api/holidays'));
    page.takeCalls();
    return page;
}

/** The built stand-in calendar (builds it on first use). */
function built(page) {
    if (!page.calendar.instances.length) call(page, 'ensureCalendarReady');
    return page.calendar.instances[0];
}

/** A calendar day cell as FullCalendar draws it, so the markers have something to land on. */
function addDayCells(page, keys) {
    const grid = page.$('#calendar');
    grid.innerHTML = keys.map((key) => `<div class="fc-daygrid-day${new Date(`${key}T12:00:00`).getDay() === 6 ? ' fc-day-sat' : ''}" data-date="${key}"></div>`).join('');
    return page.$$('#calendar .fc-daygrid-day');
}

const event = (title, start, props = {}, end = null) => ({
    title,
    start: new Date(`${start}T00:00:00`),
    end: end ? new Date(`${end}T00:00:00`) : null,
    extendedProps: { category: 'default', detail: {}, ...props },
});

// ── Titles and icons ───────────────────────────────────────────────────────

test('the server\'s emoji marker becomes an icon name and leaves the title clean', async () => {
    const page = await openCalendarPage();
    try {
        const split = (title) => plain(call(page, 'splitCalendarEmoji', title));
        assert.deepEqual(split('🕍 Parashat Bereshit'), { title: 'Parashat Bereshit', icon: 'synagogue' });
        assert.deepEqual(split('🌙 Rosh Chodesh Av'), { title: 'Rosh Chodesh Av', icon: 'moon' });
        assert.deepEqual(split('🕎 Chanukah: 1 Candle'), { title: 'Chanukah: 1 Candle', icon: 'flame' });
        assert.deepEqual(split('🇮🇱 Yom HaAtzma\'ut'), { title: 'Yom HaAtzma\'ut', icon: 'flag' });
        assert.deepEqual(split('🎉 Something new'), { title: 'Something new', icon: 'star-of-david' }, 'an unknown marker gets the default icon');
        assert.deepEqual(split('Yom Kippur'), { title: 'Yom Kippur', icon: null });
        assert.deepEqual(split('  Plain  '), { title: 'Plain', icon: null });
        assert.deepEqual(split(null), { title: '', icon: null });
    } finally {
        page.close();
    }
});

test('an icon name becomes an inline svg; an unknown one becomes nothing', async () => {
    const page = await openCalendarPage();
    try {
        const svg = call(page, 'calendarIconEl', 'moon');
        assert.equal(svg.tagName.toLowerCase(), 'svg');
        assert.equal(svg.getAttribute('aria-hidden'), 'true');
        assert.equal(svg.getAttribute('class'), 'cal-event-icon');
        assert.ok(svg.querySelector('path').getAttribute('d').length > 10);
        assert.equal(call(page, 'calendarIconEl', 'nope'), null);
        assert.equal(call(page, 'calendarIconEl', null), null);
    } finally {
        page.close();
    }
});

test('a holiday\'s colour follows its sub-category, other kinds their own category', async () => {
    const page = await openCalendarPage();
    try {
        const kind = (props) => call(page, 'calendarVisualCategory', props);
        assert.equal(kind({ category: 'holiday', detail: { subcat: 'Fast' } }), 'fast');
        assert.equal(kind({ category: 'holiday', detail: {} }), 'holiday');
        assert.equal(kind({ category: 'parashat', detail: { subcat: 'x' } }), 'parashat');
        assert.equal(kind({}), 'default');
        assert.equal(kind(), 'default');
    } finally {
        page.close();
    }
});

// ── The year-by-year fetch ─────────────────────────────────────────────────

test('a year is fetched once and its events come back with the icon and detail the grid needs', async () => {
    const page = await openCalendarPage();
    try {
        const first = plain(await call(page, 'fetchCalendarHolidays', 2026));
        await call(page, 'fetchCalendarHolidays', 2026);
        assert.deepEqual(page.takeCalls().map((request) => request.url), ['/api/holidays?year=2026']);
        assert.deepEqual(first.map((item) => item.title), ['Parashat Bereshit', 'Rosh Chodesh Cheshvan', 'Yom Kippur', 'Shabbat Shuva']);
        assert.deepEqual(first[0].extendedProps, { category: 'parashat', detail: { reading: 'Genesis 1:1-6:8' }, icon: 'synagogue' });
        assert.deepEqual(first[2].extendedProps, { category: 'holiday', detail: { subcat: 'major' }, icon: null });
        assert.deepEqual(first[3].extendedProps.detail, {}, 'a missing detail is an empty one');
    } finally {
        page.close();
    }
});

test('the server may wrap the list in {items}', async () => {
    const page = await openCalendarPage({ holidays: () => ({ items: [{ title: '🕯 Erev Shabbat', start: '2026-01-02', category: 'shabbat' }] }) });
    try {
        const items = plain(await call(page, 'fetchCalendarHolidays', 2026));
        assert.deepEqual(items.map((item) => [item.title, item.extendedProps.icon]), [['Erev Shabbat', 'flame']]);
        assert.deepEqual(plain(await call(page, 'fetchCalendarHolidays', 2027)).length, 1);
    } finally {
        page.close();
    }
});

test('a year that failed is asked for again next time', async () => {
    let failing = true;
    const page = await openCalendarPage({ holidays: () => (failing ? { status: 503, body: {} } : HOLIDAYS_2026) });
    try {
        await assert.rejects(call(page, 'fetchCalendarHolidays', 2026), /HTTP 503/);
        failing = false;
        assert.equal((await call(page, 'fetchCalendarHolidays', 2026)).length, 4);
        assert.equal(page.takeCalls().length, 2);
    } finally {
        page.close();
    }
});

test('pointing at the calendar button warms the holidays and the calendar library, once', async () => {
    const page = await openCalendarPage();
    try {
        const loads = [];
        page.window.ShelahLibs = { load: async (name) => { loads.push(name); return true; } };
        const button = page.$('.home-calendar-btn');
        button.dispatchEvent(new page.window.Event('pointerenter'));
        button.dispatchEvent(new page.window.Event('pointerenter'));
        await page.settle();
        assert.deepEqual(loads, ['fullcalendar']);
        assert.deepEqual(page.takeCalls().map((request) => request.url), [`/api/holidays?year=${new Date().getFullYear()}`]);
        button.dispatchEvent(new page.window.Event('focus'));
        await page.settle();
        assert.deepEqual(loads, ['fullcalendar', 'fullcalendar'], 'focus and touch are their own first time');
    } finally {
        page.close();
    }
});

// ── Building the grid ──────────────────────────────────────────────────────

test('the grid is built once, in the reader\'s language, on the month view', async () => {
    const page = await openCalendarPage();
    try {
        call(page, 'ensureCalendarReady');
        call(page, 'ensureCalendarReady');
        assert.equal(page.calendar.instances.length, 1);
        const [instance] = page.calendar.instances;
        assert.equal(instance.rendered, 1);
        assert.equal(instance.element, page.$('#calendar'));
        assert.equal(instance.options.initialView, 'dayGridMonth');
        assert.equal(instance.options.direction, 'ltr');
        assert.deepEqual(plain(instance.options.buttonText), { today: 'Today' });
        assert.equal(page.$('#calendarModal').getAttribute('data-calendar-built'), '1');
    } finally {
        page.close();
    }
});

test('nothing is built until FullCalendar has loaded', async () => {
    const page = await openCalendarPage();
    try {
        delete page.window.FullCalendar;
        call(page, 'ensureCalendarReady');
        assert.equal(page.calendar.instances.length, 0);
        assert.equal(page.$('#calendarModal').hasAttribute('data-calendar-built'), false);
    } finally {
        page.close();
    }
});

test('a Hebrew page builds a right-to-left grid, and a language switch re-labels the built one', async () => {
    const page = await openCalendarPage();
    try {
        page.eval(`displayedLanguage = 'he'`);
        const instance = built(page);
        assert.equal(instance.options.direction, 'rtl');
        assert.deepEqual(plain(instance.options.buttonText), { today: 'היום' });
        assert.equal(instance.options.buttonHints.next, 'החודש הבא');

        page.eval(`displayedLanguage = 'en'`);
        call(page, 'syncCalendarLanguage');
        assert.equal(instance.options.direction, 'ltr');
        assert.equal(instance.options.buttonHints.next, 'Next month');
        assert.equal(instance.rendered, 2);
    } finally {
        page.close();
    }
});

test('a language switch before the calendar exists has nothing to re-label', async () => {
    const page = await openCalendarPage();
    try {
        call(page, 'syncCalendarLanguage');
        assert.equal(page.calendar.instances.length, 0);
    } finally {
        page.close();
    }
});

test('the weekday headers and the month title follow the language, not the machine\'s zone', async () => {
    const page = await openCalendarPage();
    try {
        const { options } = built(page);
        assert.deepEqual([0, 1, 6].map((dow) => options.dayHeaderContent({ dow })), ['Sun', 'Mon', 'Sat']);
        assert.equal(options.titleFormat({ date: { year: 2026, month: 9 } }), 'October 2026');
        page.eval(`displayedLanguage = 'he'`);
        assert.match(options.dayHeaderContent({ dow: 0 }), /א/);
        assert.match(options.titleFormat({ date: { year: 2026, month: 9 } }), /אוקטובר 2026/);
    } finally {
        page.close();
    }
});

test('the grid is marked busy while its events load', async () => {
    const page = await openCalendarPage();
    try {
        const { options } = built(page);
        options.loading(true);
        assert.equal(page.$('#calendar').getAttribute('aria-busy'), 'true');
        options.loading(false);
        assert.equal(page.$('#calendar').getAttribute('aria-busy'), 'false');
    } finally {
        page.close();
    }
});

test('a month\'s events come from the year it is in, and from both years when it straddles two', async () => {
    const page = await openCalendarPage({ holidays: (year) => [{ title: `Day of ${year}`, start: `${year}-06-01`, category: 'default' }] });
    try {
        const { options } = built(page);
        const load = (start, end) => new Promise((resolve, reject) => options.events({ start: new Date(start), end: new Date(end) }, resolve, reject));
        page.takeCalls();
        assert.deepEqual(plain(await load('2026-09-27T00:00:00', '2026-11-08T00:00:00')).map((item) => item.title), ['Day of 2026']);
        assert.deepEqual(plain(await load('2026-12-27T00:00:00', '2027-02-07T00:00:00')).map((item) => item.title), ['Day of 2026', 'Day of 2027']);
        assert.deepEqual(page.takeCalls().map((request) => request.url), ['/api/holidays?year=2026', '/api/holidays?year=2027'], '2026 was fetched once, for both months');
    } finally {
        page.close();
    }
});

test('a month that fails to load retries by itself once, then offers a Retry button', async () => {
    let failing = true;
    const page = await openCalendarPage({ holidays: () => (failing ? { status: 500, body: {} } : HOLIDAYS_2026) });
    try {
        const instance = built(page);
        const timers = [];
        const realSetTimeout = page.window.setTimeout;
        page.window.setTimeout = (fn, ms) => { timers.push([fn, ms]); return 1; };
        const failures = [];
        const request = () => new Promise((resolve) => instance.options.events(
            { start: new Date('2026-09-27T00:00:00'), end: new Date('2026-11-08T00:00:00') },
            () => resolve('loaded'),
            (error) => { failures.push(error.message); resolve('failed'); },
        ));

        assert.equal(await request(), 'failed');
        assert.deepEqual(timers.map(([, ms]) => ms), [3000], 'one automatic retry');
        assert.equal(page.$('#calendarLoadError').classList.contains('hidden'), true, 'nothing alarming yet');
        timers[0][0]();
        assert.equal(instance.refetched, 1);

        assert.equal(await request(), 'failed');
        page.window.setTimeout = realSetTimeout;
        assert.equal(timers.length, 1, 'no second automatic retry');
        const box = page.$('#calendarLoadError');
        assert.equal(box.classList.contains('hidden'), false);
        assert.equal(box.querySelector('span').textContent, "Couldn't load this month's holidays.");
        assert.deepEqual(failures, ['HTTP 500', 'HTTP 500']);

        failing = false;
        page.click(box.querySelector('button'));
        assert.equal(instance.refetched, 2, 'Retry asks the calendar for the month again');
        assert.equal(box.classList.contains('hidden'), true);
        assert.equal(await request(), 'loaded');
    } finally {
        page.close();
    }
});

test('the load error is worded in Hebrew, and Retry with no calendar built builds one', async () => {
    const page = await openCalendarPage();
    try {
        page.eval(`displayedLanguage = 'he'`);
        call(page, 'showCalendarLoadError');
        const box = page.$('#calendarLoadError');
        assert.equal(box.querySelector('span').textContent, 'לא ניתן היה לטעון את החגים לחודש זה.');
        assert.equal(box.querySelector('button').textContent, 'נסה שוב');
        assert.equal(page.calendar.instances.length, 0);
        page.click(box.querySelector('button'));
        assert.equal(page.calendar.instances.length, 1, 'with FullCalendar there, Retry builds the grid');
        assert.equal(box.textContent, '');
    } finally {
        page.close();
    }
});

// ── Loading FullCalendar ───────────────────────────────────────────────────

test('without the library loader the calendar builds from whatever FullCalendar is there', async () => {
    const page = await openCalendarPage();
    try {
        call(page, 'ensureCalendarLibrary');
        assert.equal(page.calendar.instances.length, 1);
        call(page, 'ensureCalendarLibrary');
        assert.equal(page.calendar.instances.length, 1, 'once built, nothing more');
    } finally {
        page.close();
    }
});

test('the library is loaded on first use; the grid waits busy, then builds', async () => {
    const page = await openCalendarPage();
    try {
        delete page.window.FullCalendar;
        let finish;
        page.window.ShelahLibs = { load: (name) => new Promise((resolve) => { finish = () => { page.window.FullCalendar = page.calendar.FullCalendar; resolve(true); }; }) };
        call(page, 'ensureCalendarLibrary');
        assert.equal(page.$('#calendar').getAttribute('aria-busy'), 'true');
        assert.equal(page.calendar.instances.length, 0);
        finish();
        await page.settle();
        assert.equal(page.$('#calendar').getAttribute('aria-busy'), 'false');
        assert.equal(page.calendar.instances.length, 1);
    } finally {
        page.close();
    }
});

test('a library that arrives while the calendar is open re-measures the grid and redraws the agenda', async () => {
    const page = await openCalendarPage();
    try {
        delete page.window.FullCalendar;
        page.window.ShelahLibs = { load: async () => { page.window.FullCalendar = page.calendar.FullCalendar; return true; } };
        page.$('#calendarModal').setAttribute('open', '');
        page.eval(`calendarSelectedKey = '2026-10-10'`);
        call(page, 'ensureCalendarLibrary');
        await page.settle();
        const [instance] = page.calendar.instances;
        assert.equal(instance.sized, true);
        assert.equal(page.$('#calendarAgenda').hidden, false);
    } finally {
        page.close();
    }
});

test('a library that cannot be loaded shows the error with a Retry', async () => {
    const page = await openCalendarPage();
    try {
        delete page.window.FullCalendar;
        page.window.ShelahLibs = { load: async () => false };
        call(page, 'ensureCalendarLibrary');
        await page.settle();
        assert.equal(page.$('#calendarLoadError').classList.contains('hidden'), false);
        assert.equal(page.calendar.instances.length, 0);
        assert.equal(page.$('#calendar').getAttribute('aria-busy'), 'false');
    } finally {
        page.close();
    }
});

// ── Paging months ──────────────────────────────────────────────────────────

const monthInfo = (year, month) => ({ view: { currentStart: new Date(year, month, 1) } });

test('paging to a month keeps the picked day if it is in that month, else today, else the 1st', async () => {
    const page = await openCalendarPage();
    try {
        const { options } = built(page);
        const today = new Date();
        const selected = () => page.eval('calendarSelectedKey');

        page.eval(`calendarSelectedKey = '2026-03-17'`);
        options.datesSet(monthInfo(2026, 2));
        assert.equal(selected(), '2026-03-17');

        options.datesSet(monthInfo(2026, 4));
        assert.equal(selected(), '2026-05-01');

        options.datesSet(monthInfo(today.getFullYear(), today.getMonth()));
        assert.equal(selected(), keyOf(today), 'the current month lands on today');
    } finally {
        page.close();
    }
});

test('paging closes an open detail card and marks the days', async () => {
    const page = await openCalendarPage();
    try {
        const { options } = built(page);
        addDayCells(page, ['2026-10-10', '2026-10-11']);
        page.eval(`calendarDayKinds = new Map([['2026-10-11', 'holiday']])`);
        options.datesSet(monthInfo(2026, 9));
        assert.deepEqual(plain(page.detail.at(-1)), ['close', { immediate: true }]);
        assert.deepEqual(page.$$('#calendar .cal-day-shabbat').map((cell) => cell.dataset.date), ['2026-10-10'], 'every Saturday is Shabbat');
        assert.deepEqual(page.$$('#calendar .cal-day-holiday').map((cell) => cell.dataset.date), ['2026-10-11']);
    } finally {
        page.close();
    }
});

test('near a year boundary the neighbouring year is warmed too', async () => {
    const page = await openCalendarPage();
    try {
        const { options } = built(page);
        page.takeCalls();
        options.datesSet(monthInfo(2026, 0));
        options.datesSet(monthInfo(2026, 10));
        options.datesSet(monthInfo(2026, 11));
        options.datesSet(monthInfo(2026, 5));
        await page.settle();
        assert.deepEqual(page.takeCalls().map((request) => request.url).sort(), ['/api/holidays?year=2025', '/api/holidays?year=2027']);
    } finally {
        page.close();
    }
});

test('after the first draw, a new month fades in', async () => {
    const page = await openCalendarPage();
    try {
        const animated = [];
        page.window.ShelahMotion = { animateIn: (el, options) => animated.push([el.className, options]) };
        page.$('#calendar').innerHTML = '<div class="fc-view-harness"></div>';
        const { options } = built(page);
        options.datesSet(monthInfo(2026, 5));
        assert.deepEqual(animated, [], 'not on the first draw');
        options.datesSet(monthInfo(2026, 6));
        assert.deepEqual(plain(animated), [['fc-view-harness', { y: 6 }]]);
    } finally {
        page.close();
    }
});

// ── Events, kinds of day, and the agenda ───────────────────────────────────

test('a Yom Tov is a holiday, a parasha or Shabbat a Shabbat, and a holiday wins on the same day', async () => {
    const page = await openCalendarPage();
    try {
        const instance = built(page);
        instance.events = [
            event('Parashat Noach', '2026-10-17', { category: 'parashat' }),
            event('Some Yom Tov', '2026-10-17', { category: 'holiday', detail: { subcat: 'major' } }),
            event('Shabbat Shuva', '2026-09-19', { category: 'shabbat' }),
            event('Sukkot', '2026-09-26', { category: 'holiday', detail: { subcat: 'major' } }, '2026-09-29'),
            event('Minor fast', '2026-09-30', { category: 'holiday', detail: { subcat: 'fast' } }),
            event('No start', '2026-09-30', { category: 'shabbat' }),
        ];
        instance.events.at(-1).start = null;
        call(page, 'computeCalendarDayKinds');
        const kinds = Object.fromEntries(page.eval('calendarDayKinds'));
        assert.deepEqual(kinds, {
            '2026-10-17': 'holiday',
            '2026-09-19': 'shabbat',
            '2026-09-26': 'holiday',
            '2026-09-27': 'holiday',
            '2026-09-28': 'holiday',
        });
    } finally {
        page.close();
    }
});

test('with no calendar built there are no kinds of day and no events', async () => {
    const page = await openCalendarPage();
    try {
        call(page, 'computeCalendarDayKinds');
        assert.equal(page.eval('calendarDayKinds.size'), 0);
        assert.deepEqual(plain(call(page, 'calendarEventsOn', '2026-10-10')), []);
        call(page, 'markCalendarDayKinds');
        call(page, 'markCalendarSelectedDay');
    } finally {
        page.close();
    }
});

test('events landing re-mark the days and redraw the agenda of the picked day', async () => {
    const page = await openCalendarPage();
    try {
        const instance = built(page);
        addDayCells(page, ['2026-10-10', '2026-10-11', '2026-10-12']);
        instance.events = [event('Rosh Chodesh', '2026-10-11', { category: 'holiday', detail: { subcat: 'major' } })];
        page.eval(`calendarSelectedKey = '2026-10-11'`);
        instance.options.eventsSet();
        assert.deepEqual(page.$$('#calendar .cal-day-holiday').map((cell) => cell.dataset.date), ['2026-10-11']);
        assert.equal(page.$('#calendarAgendaList').children.length, 1);
    } finally {
        page.close();
    }
});

test('a multi-day event is on each of its days and not on the day it ends', async () => {
    const page = await openCalendarPage();
    try {
        built(page).events = [
            event('Span', '2026-10-11', {}, '2026-10-13'),
            event('One day', '2026-10-12'),
        ];
        const titles = (key) => plain(call(page, 'calendarEventsOn', key)).map((item) => item.title);
        assert.deepEqual(titles('2026-10-10'), []);
        assert.deepEqual(titles('2026-10-11'), ['Span']);
        assert.deepEqual(titles('2026-10-12'), ['Span', 'One day']);
        assert.deepEqual(titles('2026-10-13'), []);
    } finally {
        page.close();
    }
});

test('the picked day is outlined on its cell, and only that one', async () => {
    const page = await openCalendarPage();
    try {
        built(page);
        addDayCells(page, ['2026-10-10', '2026-10-11']);
        call(page, 'selectCalendarDay', '2026-10-10');
        call(page, 'selectCalendarDay', '2026-10-11');
        assert.deepEqual(page.$$('#calendar .cal-day-selected').map((cell) => cell.dataset.date), ['2026-10-11']);
        page.eval('calendarSelectedKey = null');
        call(page, 'markCalendarSelectedDay');
        assert.equal(page.$$('#calendar .cal-day-selected').length, 0);
    } finally {
        page.close();
    }
});

test('picking a day can scroll to its agenda and can write the day to the URL', async () => {
    const page = await openCalendarPage();
    try {
        built(page);
        call(page, 'selectCalendarDay', '2026-10-10');
        assert.deepEqual(page.router.calls.filter(([name]) => name === 'pushRoute'), [], 'a month change does not write history');
        assert.equal(page.scrolls.filter(([name]) => name === 'scrollIntoView').length, 0);

        call(page, 'selectCalendarDay', '2026-10-11', { scroll: true, pushUrl: true });
        assert.equal(page.scrolls.filter(([name]) => name === 'scrollIntoView').length, 1);
        assert.deepEqual(plain(page.router.calls.at(-1)), ['pushRoute', { date: '2026-10-11' }, { replace: true }]);
    } finally {
        page.close();
    }
});

test('the agenda names the day in English and in Hebrew and lists its events', async () => {
    const page = await openCalendarPage();
    try {
        built(page).events = [
            event('Rosh Chodesh Cheshvan', '2026-10-12', { category: 'roshchodesh', icon: 'moon' }),
            event('Sukkot', '2026-10-12', { category: 'holiday', detail: { subcat: 'major' }, icon: null }),
        ];
        call(page, 'selectCalendarDay', '2026-10-12');
        assert.equal(page.$('#calendarAgendaHeading').textContent, 'Monday, October 12');
        assert.equal(page.$('#calendarAgendaHebrew').textContent, 'א׳ בחשוון תשפ״ז');
        assert.equal(page.$('#calendarAgendaHebrew').hidden, false);
        assert.equal(page.$('#calendarAgenda').hidden, false);
        const items = page.$$('#calendarAgendaList li');
        assert.deepEqual(items.map((item) => item.className), [
            'cal-agenda-item cal-cat-roshchodesh is-actionable',
            'cal-agenda-item cal-cat-major is-actionable',
        ]);
        assert.deepEqual(items.map((item) => item.querySelector('.cal-agenda-title').textContent), ['Rosh Chodesh Cheshvan', 'Sukkot']);
        assert.ok(items[0].querySelector('svg.cal-event-icon'), 'the event\'s icon is drawn');
        assert.equal(items[1].querySelector('svg'), null);

        page.eval(`displayedLanguage = 'he'`);
        call(page, 'renderCalendarAgenda');
        assert.match(page.$('#calendarAgendaHeading').textContent, /יום שני/);
        assert.deepEqual(page.$$('#calendarAgendaList .cal-agenda-title').map((title) => title.textContent), ['ראש חודש חשוון', 'סוכות']);
    } finally {
        page.close();
    }
});

test('a day with nothing on it says so', async () => {
    const page = await openCalendarPage();
    try {
        built(page);
        call(page, 'selectCalendarDay', '2026-10-14');
        assert.equal(page.$('#calendarAgendaList').textContent, 'No holidays or special days.');
        page.eval(`displayedLanguage = 'he'`);
        call(page, 'renderCalendarAgenda');
        assert.equal(page.$('#calendarAgendaList').textContent, 'אין חגים או ימים מיוחדים.');
    } finally {
        page.close();
    }
});

test('the agenda stays hidden until a day has been picked', async () => {
    const page = await openCalendarPage();
    try {
        call(page, 'renderCalendarAgenda');
        assert.equal(page.$('#calendarAgenda').hidden, true);
    } finally {
        page.close();
    }
});

// ── Clicking in the grid, and the detail card ──────────────────────────────

test('tapping a day picks it, writes it to the URL, and opens its card', async () => {
    const page = await openCalendarPage();
    try {
        const instance = built(page);
        instance.events = [event('Parashat Bereshit', '2026-10-10', { category: 'parashat', detail: { reading: 'x' } })];
        const cell = addDayCells(page, ['2026-10-10'])[0];
        instance.options.dateClick({ dateStr: '2026-10-10T00:00:00', dayEl: cell });
        assert.equal(page.eval('calendarSelectedKey'), '2026-10-10');
        assert.deepEqual(plain(page.router.calls.at(-1)), ['pushRoute', { date: '2026-10-10' }, { replace: true }]);
        const [, opened] = page.detail.at(-1);
        assert.equal(opened.anchor, cell);
        assert.equal(opened.dateKey, '2026-10-10');
        assert.deepEqual(opened.events.map((item) => item.title), ['Parashat Bereshit']);
        assert.equal(opened.event, null);
        assert.equal(opened.he, false);
        assert.equal(opened.location, null);
        assert.equal(typeof opened.openText, 'function');
        assert.equal(typeof opened.bookName, 'function');
    } finally {
        page.close();
    }
});

test('tapping an event goes straight to that event on its card, and does not follow its link', async () => {
    const page = await openCalendarPage();
    try {
        const instance = built(page);
        const rosh = event('Rosh Chodesh', '2026-10-11', { category: 'roshchodesh' });
        instance.events = [rosh, event('Other', '2026-10-11')];
        const chip = page.document.createElement('a');
        const clickEvent = new page.window.MouseEvent('click', { cancelable: true });
        instance.options.eventClick({ jsEvent: clickEvent, event: rosh, el: chip });
        assert.equal(clickEvent.defaultPrevented, true);
        const [, opened] = page.detail.at(-1);
        assert.equal(opened.anchor, chip);
        assert.equal(opened.event.title, 'Rosh Chodesh');
        assert.equal(opened.allEvents.length, 2);
    } finally {
        page.close();
    }
});

test('the card shows the zmanim location when the panel has one, and Hebrew names in a Hebrew page', async () => {
    const page = await openCalendarPage();
    try {
        const instance = built(page);
        instance.events = [event('Parashat Bereshit', '2026-10-10')];
        page.window.ShelahModules = { getZmanimLocation: () => ({ lat: 31.7, lon: 35.2 }) };
        page.eval(`displayedLanguage = 'he'`);
        const anchor = page.document.createElement('div');
        call(page, 'openCalendarDetail', anchor, '2026-10-10');
        const [, opened] = page.detail.at(-1);
        assert.deepEqual(plain(opened.location), { lat: 31.7, lon: 35.2 });
        assert.equal(opened.he, true);
        assert.equal(opened.bookName('Genesis'), 'בראשית');
    } finally {
        page.close();
    }
});

test('a tapped event the day list does not have is passed on as it is', async () => {
    const page = await openCalendarPage();
    try {
        built(page);
        const stray = event('Stray', '2026-10-20');
        call(page, 'openCalendarDetail', page.document.createElement('div'), '2026-10-10', stray);
        assert.equal(page.detail.at(-1)[1].event.title, 'Stray');
    } finally {
        page.close();
    }
});

test('no card opens without the card module, an anchor, or a calendar', async () => {
    const page = await openCalendarPage();
    try {
        const anchor = page.document.createElement('div');
        call(page, 'openCalendarDetail', anchor, '2026-10-10');
        assert.deepEqual(page.detail, [], 'no calendar built yet');
        built(page);
        call(page, 'openCalendarDetail', null, '2026-10-10');
        delete page.window.ShelahCalendarDetail;
        call(page, 'openCalendarDetail', anchor, '2026-10-10');
        assert.deepEqual(page.detail, []);
    } finally {
        page.close();
    }
});

test('an agenda entry opens the same card for its event', async () => {
    const page = await openCalendarPage();
    try {
        built(page).events = [event('Sukkot', '2026-10-12', { category: 'holiday', detail: { subcat: 'major' } })];
        call(page, 'selectCalendarDay', '2026-10-12');
        page.click(page.$('#calendarAgendaList button'));
        const [, opened] = page.detail.at(-1);
        assert.equal(opened.dateKey, '2026-10-12');
        assert.equal(opened.event.title, 'Sukkot');
        assert.equal(opened.anchor, page.$('#calendarAgendaList li'));
    } finally {
        page.close();
    }
});

test('a reading tapped on the card closes the calendar and opens the text', async () => {
    const page = await openCalendarPage();
    try {
        page.eval(`window.__read = []; readText = async (ref) => { window.__read.push(ref); };`);
        page.eval(`window.closeCalendarModal = async () => { window.__read.push('closed'); };`);
        await call(page, 'openCalendarText', 'Genesis 1:1-6:8');
        assert.deepEqual(plain(page.eval('window.__read')), ['closed', 'Genesis 1:1-6:8']);
    } finally {
        page.close();
    }
});

test('what the grid draws for an event: a localized name, a full-name tooltip, an icon, a class', async () => {
    const page = await openCalendarPage();
    try {
        const { options } = built(page);
        const rosh = event('Rosh Chodesh <Av>', '2026-10-11', { category: 'roshchodesh', icon: 'moon' });
        assert.deepEqual(plain(options.eventContent({ event: rosh })), { html: 'Rosh Chodesh &lt;Av&gt;' });
        assert.deepEqual(plain(options.eventClassNames({ event: rosh })), ['cal-cat-roshchodesh']);

        const chip = page.document.createElement('div');
        chip.innerHTML = '<div class="fc-event-main"><span>name</span></div>';
        options.eventDidMount({ el: chip, event: rosh });
        assert.equal(chip.title, 'Rosh Chodesh <Av>');
        assert.ok(chip.querySelector('.fc-event-main > svg.cal-event-icon'));

        const bare = page.document.createElement('div');
        options.eventDidMount({ el: bare, event: event('Plain', '2026-10-11', { icon: 'moon' }) });
        assert.equal(bare.querySelector('svg'), null, 'no slot, no icon');
        options.eventDidMount({ el: chip, event: event('No icon', '2026-10-11') });
        assert.equal(chip.title, 'No icon');

        page.eval(`displayedLanguage = 'he'`);
        assert.deepEqual(plain(options.eventContent({ event: event('Purim', '2026-03-03') })), { html: 'פורים' });
    } finally {
        page.close();
    }
});

test('a day cell drawn later keeps the picked outline and its kind', async () => {
    const page = await openCalendarPage();
    try {
        const { options } = built(page);
        page.eval(`calendarSelectedKey = '2026-10-10'; calendarDayKinds = new Map([['2026-10-11', 'holiday']])`);
        const [picked, holiday, ordinary] = addDayCells(page, ['2026-10-10', '2026-10-11', '2026-10-12']);
        [picked, holiday, ordinary].forEach((cell) => options.dayCellDidMount({ el: cell }));
        assert.equal(picked.classList.contains('cal-day-selected'), true);
        assert.equal(picked.classList.contains('cal-day-shabbat'), true, 'a Saturday');
        assert.equal(holiday.classList.contains('cal-day-holiday'), true);
        assert.equal(ordinary.className.includes('cal-day'), false);
        call(page, 'applyCalendarDayKind', null);
        call(page, 'applyCalendarDayKind', page.document.createElement('td'));
    } finally {
        page.close();
    }
});

// ── Opening and closing the dialog ─────────────────────────────────────────

test('opening the calendar writes its own history entry, shows the dialog and builds the grid', async () => {
    const page = await openCalendarPage();
    try {
        page.window.openCalendarModal();
        const modal = page.$('#calendarModal');
        assert.equal(modal.open, true);
        assert.equal(modal.classList.contains('hidden'), false);
        assert.equal(modal.querySelector(':scope > div').style.transform, 'none');
        assert.equal(page.calendar.instances.length, 1);
        assert.deepEqual(plain(page.router.calls.at(-1).slice(0, 3)), ['pushRoute', { date: keyOf(new Date()) }, { overlay: 'calendar' }]);
        assert.deepEqual(page.takeCalls().map((request) => request.url), [`/api/holidays?year=${new Date().getFullYear()}`]);
    } finally {
        page.close();
    }
});

test('opening from a link or on a dated URL adds no history entry', async () => {
    const page = await openCalendarPage({ router: fakeRouter({ date: '2026-10-10' }) });
    try {
        page.window.openCalendarModal({ fromRoute: true });
        page.window.openCalendarModal();
        assert.deepEqual(page.router.calls, []);
    } finally {
        page.close();
    }
});

test('opening a calendar that is already open adds no second entry', async () => {
    const page = await openCalendarPage();
    try {
        page.window.openCalendarModal();
        const pushes = () => page.router.calls.filter(([name]) => name === 'pushRoute').length;
        assert.equal(pushes(), 1);
        page.window.openCalendarModal();
        assert.equal(pushes(), 1);
    } finally {
        page.close();
    }
});

test('reopening starts at the top of the card and redraws the picked day\'s agenda', async () => {
    const page = await openCalendarPage();
    try {
        const scroller = page.$('#calendarModal .overflow-y-auto');
        scroller.scrollTop = 120;
        built(page);
        page.eval(`calendarSelectedKey = '2026-10-14'`);
        page.window.openCalendarModal({ fromRoute: true });
        assert.equal(scroller.scrollTop, 0);
        assert.equal(page.$('#calendarAgendaList').textContent, 'No holidays or special days.');
        await page.settle();
        assert.equal(page.calendar.instances[0].sized, true);
    } finally {
        page.close();
    }
});

test('closing hides and closes the dialog, and drops the date from the URL in place', async () => {
    const page = await openCalendarPage({ router: fakeRouter({ date: '2026-10-10' }) });
    try {
        page.window.openCalendarModal({ fromRoute: true });
        await page.window.closeCalendarModal();
        const modal = page.$('#calendarModal');
        assert.equal(modal.open, false);
        assert.equal(modal.classList.contains('hidden'), true);
        assert.deepEqual(plain(page.router.calls.at(-1)), ['closeOverlay', 'calendar', { date: null }]);
        assert.deepEqual(plain(page.detail.at(-1)), ['close', { immediate: true }]);
    } finally {
        page.close();
    }
});

test('closing a calendar the app pushed steps Back, and waits for the browser to follow', async () => {
    const router = fakeRouter({ date: '2026-10-10' });
    router.closeOverlay = (name, patch) => { router.calls.push(['closeOverlay', name, patch]); return 'back'; };
    const page = await openCalendarPage({ router });
    try {
        page.window.openCalendarModal({ fromRoute: true });
        let done = false;
        const closing = page.window.closeCalendarModal().then(() => { done = true; });
        const again = page.window.closeCalendarModal();
        await page.settle();
        assert.equal(done, false, 'still waiting for the Back to land');
        page.window.dispatchEvent(new page.window.Event('popstate'));
        await closing;
        await again;
        assert.equal(done, true);
        assert.equal(router.calls.filter(([name]) => name === 'closeOverlay').length, 1, 'a second close joins the first');
    } finally {
        page.close();
    }
});

test('Escape and a click on the backdrop close the calendar; a click on the card does not', async () => {
    const page = await openCalendarPage({ router: fakeRouter({ date: '2026-10-10' }) });
    try {
        const modal = page.$('#calendarModal');
        page.window.openCalendarModal({ fromRoute: true });
        page.click(modal.querySelector(':scope > div'));
        assert.equal(modal.open, true);
        page.click(modal);
        await page.settle();
        assert.equal(modal.open, false);

        page.window.openCalendarModal({ fromRoute: true });
        const cancel = new page.window.Event('cancel', { cancelable: true });
        modal.dispatchEvent(cancel);
        assert.equal(cancel.defaultPrevented, true, 'the native close is replaced by ours');
        await page.settle();
        assert.equal(modal.open, false);
    } finally {
        page.close();
    }
});

// ── Jumping to a date ──────────────────────────────────────────────────────

test('a ?date= link opens the calendar on that day', async () => {
    const page = await openCalendarPage({ router: fakeRouter({ date: '2026-10-10' }) });
    try {
        call(page, 'hydrateCalendarDate', '2026-12-25');
        const [instance] = page.calendar.instances;
        assert.equal(page.$('#calendarModal').open, true);
        assert.equal(instance.went.getTime(), new Date(2026, 11, 25).getTime(), 'the grid is moved to that month');
        assert.equal(page.eval('calendarSelectedKey'), '2026-12-25');
        assert.equal(page.scrolls.filter(([name]) => name === 'scrollIntoView').length, 1);
        assert.deepEqual(page.router.calls.filter(([name]) => name === 'pushRoute'), [], 'a link does not write history');
    } finally {
        page.close();
    }
});

test('a day asked for while FullCalendar is still loading is the month the grid first shows', async () => {
    const page = await openCalendarPage({ router: fakeRouter({ date: '2026-10-10' }) });
    try {
        delete page.window.FullCalendar;
        let finish;
        page.window.ShelahLibs = { load: () => new Promise((resolve) => { finish = () => { page.window.FullCalendar = page.calendar.FullCalendar; resolve(true); }; }) };
        call(page, 'hydrateCalendarDate', '2026-12-25');
        assert.equal(page.calendar.instances.length, 0);
        finish();
        await page.settle();
        const [instance] = page.calendar.instances;
        assert.equal(instance.options.initialDate.getTime(), new Date(2026, 11, 25).getTime());
        assert.equal(page.eval('calendarGotoDate'), null, 'asked for once, used once');
    } finally {
        page.close();
    }
});

test('a malformed date is ignored', async () => {
    const page = await openCalendarPage();
    try {
        for (const bad of ['', null, 'today', '2026-1-5', '2026-10-10T00:00']) {
            call(page, 'hydrateCalendarDate', bad);
            call(page, 'openCalendarOnDate', bad);
        }
        assert.equal(page.$('#calendarModal').open, false);
    } finally {
        page.close();
    }
});

test('a holiday name on the home page opens the calendar on its date and writes it to the URL', async () => {
    const page = await openCalendarPage();
    try {
        call(page, 'openCalendarOnDate', '2026-09-21');
        assert.equal(page.$('#calendarModal').open, true);
        assert.equal(page.eval('calendarSelectedKey'), '2026-09-21');
        const pushes = page.router.calls.filter(([name]) => name === 'pushRoute').map(([, patch, options]) => [patch, options]);
        assert.deepEqual(plain(pushes), [[{ date: keyOf(new Date()) }, { overlay: 'calendar' }], [{ date: '2026-09-21' }, { replace: true }]]);
    } finally {
        page.close();
    }
});

test('"today" opens the calendar on today', async () => {
    const page = await openCalendarPage();
    try {
        call(page, 'openTodayInCalendar');
        assert.equal(page.eval('calendarSelectedKey'), keyOf(new Date()));
    } finally {
        page.close();
    }
});

test('a date asked for before the grid exists is remembered; a grid that fails to move is left alone', async () => {
    const page = await openCalendarPage();
    try {
        call(page, 'gotoCalendarDate', new Date(2026, 5, 1));
        assert.deepEqual(page.eval('calendarGotoDate'), new Date(2026, 5, 1));
        const instance = built(page);
        assert.equal(page.eval('calendarGotoDate'), null, 'used up by the build');
        instance.gotoDate = () => { throw new Error('not rendered yet'); };
        call(page, 'gotoCalendarDate', new Date(2026, 6, 1));
    } finally {
        page.close();
    }
});

// ── Holiday names in Hebrew ────────────────────────────────────────────────

test('holiday names are translated whole, by phrase, and by the words in them', async () => {
    const page = await openCalendarPage();
    try {
        const he = (name) => call(page, 'holidayNameToHebrew', name);
        assert.equal(he(''), '');
        assert.equal(he(null), '');
        assert.equal(he('Yom Kippur'), 'יום כיפור');
        assert.equal(he('Passover'), 'פסח');
        assert.equal(he('Rosh Hashana 5787'), 'ראש השנה תשפ״ז');
        assert.equal(he('Erev Rosh Hashana'), 'ערב ראש השנה');
        assert.equal(he('Rosh Chodesh Tevet'), 'ראש חודש טבת');
        assert.equal(he('Rosh Chodesh Sh\'vat'), 'ראש חודש שבט');
        assert.equal(he('Mevarchim Chodesh Adar'), 'מברכים חודש אדר');
        assert.equal(he('Chanukah: 1 Candle'), 'חנוכה: נר ראשון');
        assert.equal(he('Chanukah: 3 Candles'), 'חנוכה: ג׳ נרות');
        assert.equal(he('Chanukah: 8th Day'), 'חנוכה: יום ח׳');
        assert.equal(he('Sukkot III (CH\'\'M)'), 'סוכות ג׳ (חוה״מ)');
        assert.equal(he('Pesach Sheni'), 'פסח שני');
        assert.equal(he('Shushan Purim'), 'שושן פורים');
        assert.equal(he('Purim Katan'), 'פורים קטן');
        assert.equal(he('Lag BaOmer'), 'ל״ג בעומר');
        assert.equal(he('Tu BiShvat'), 'ט״ו בשבט');
        assert.equal(he('Tu B\'Av'), 'ט״ו באב');
        assert.equal(he('Tish\'a B\'Av'), 'תשעה באב');
        assert.equal(he('Ta\'anit Esther'), 'תענית אסתר');
        assert.equal(he('Asara B\'Tevet'), 'עשרה בטבת');
        assert.equal(he('Tzom Gedaliah'), 'צום גדליה');
        assert.equal(he('Tzom Tammuz'), 'צום תמוז');
        assert.equal(he('Yom HaAtzma\'ut'), 'יום העצמאות');
        assert.equal(he('Yom HaShoah'), 'יום השואה');
        assert.equal(he('Yom Yerushalayim'), 'יום ירושלים');
        assert.equal(he('Hoshana Raba'), 'הושענא רבה');
        assert.equal(he('Leil Selichot'), 'ליל סליחות');
        assert.equal(he('Simchat Torah'), 'שמחת תורה');
        assert.equal(he('Shmini Atzeret'), 'שמיני עצרת');
        assert.equal(he('Shavuot II'), 'שבועות ב׳');
    } finally {
        page.close();
    }
});

test('a parasha is "פרשת" plus its name; a double one is joined; one it does not know is left as it is', async () => {
    const page = await openCalendarPage();
    try {
        const he = (name) => call(page, 'holidayNameToHebrew', name);
        assert.equal(he('Parashat Bereshit'), 'פרשת בראשית');
        assert.equal(he('Parashat Vayakhel-Pekudei'), 'פרשת ויקהל-פקודי');
        assert.equal(he('Parashat Ha’azinu'), 'פרשת האזינו');
        assert.equal(he('Parashat Nonexistent'), 'פרשת Nonexistent');
        assert.equal(he('Shabbat Shuva'), 'שבת שובה');
        assert.equal(he('Shabbat HaGadol'), 'שבת הגדול');
        assert.equal(he('Shabbat Chazon'), 'שבת חזון');
    } finally {
        page.close();
    }
});

test('names are only translated in a Hebrew page', async () => {
    const page = await openCalendarPage();
    try {
        assert.equal(call(page, 'translateHolidayName', ' Yom Kippur '), 'Yom Kippur');
        page.eval(`displayedLanguage = 'he'`);
        assert.equal(call(page, 'translateHolidayName', ' Yom Kippur '), 'יום כיפור');
        assert.equal(call(page, 'translateHolidayName', ''), '');
    } finally {
        page.close();
    }
});
