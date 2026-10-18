/**
 * The search bar: the type-ahead list under it (what it asks the server, what
 * it shows, how the keys and clicks move through it), what a submitted
 * question resolves to (a book alias, a reference, a library hit, the siddur,
 * or the AI), what happens around an AI answer, and the zmanim city search.
 * Boots the real home page in jsdom (tests_js/helpers/shell_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');
const { fakeConversationUI, fakeRouter } = require('./helpers/shell_fakes');

const plain = (value) => JSON.parse(JSON.stringify(value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MOBILE = '(max-width: 1023px)';

const BACKGROUND_REQUEST = /^\/api\/(library\/popular|daily-study|parasha)(\?|$)/;

/** A page with the Reliability log captured, and the search stand-ins installed. */
async function openPage(options = {}) {
    const reliability = [];
    const page = await openShellPage({
        ...options,
        before: (window) => {
            window.console.info = (...args) => reliability.push(args.join(' '));
            options.before?.(window);
        },
    });
    page.reliability = reliability;
    // The home page's own lists arrive in the background, at any moment; they are not what search asked for.
    const takeEverything = page.takeCalls.bind(page);
    page.takeCalls = () => takeEverything().filter((request) => !BACKGROUND_REQUEST.test(request.url));
    return page;
}

/** Replaces the navigation functions so a test sees what search asked for. */
function recordNavigation(page) {
    page.eval(`
        window.__nav = [];
        readText = async (ref) => { window.__nav.push(['text', ref]); };
        displayPrayer = async (name) => { window.__nav.push(['prayer', name]); };
        displaySiddur = async (value) => { window.__nav.push(['siddur', value]); };
        displayCommunity = async (name) => { window.__nav.push(['community', name]); };
        handleAiSearch = async (question) => { window.__nav.push(['ask', question]); };
    `);
    return () => plain(page.eval('window.__nav'));
}

const suggestions = (page) => page.$$('#searchSuggestions .suggestion-item').map((item) => ({
    label: item.querySelector('.text-sm').textContent,
    subtitle: item.querySelector('.text-xs').textContent,
    badge: item.querySelector('span')?.textContent ?? '',
    active: item.classList.contains('bg-[#efe5d4]'),
}));
/** The lookups a search makes (the page's own background requests are not its business). */
const searchRequests = (page) => page.takeCalls().filter((request) => /^\/api\/(text\/|library\/search|search\/)/.test(request.url));
const listVisible = (page) => !page.$('#searchSuggestions').classList.contains('hidden');
const status = (page) => page.$('#searchSuggestStatus').textContent;

const ITEMS = [
    { type: 'text', value: 'Genesis 1', label: 'Genesis 1', label_he: 'בראשית א', subtitle: 'Tanakh > Torah' },
    { type: 'prayer', value: 'Shema', label: 'Shema', label_he: 'שמע', subtitle: 'Liturgy from Sefaria' },
    { type: 'community', value: 'Yemenite', label: 'Community Yemenite', subtitle: 'Community customs' },
    { type: 'ask', value: 'why do we wash', label: 'why do we wash' },
];

const reply = (items) => ({ ok: true, json: async () => items });

/**
 * Answers the type-ahead's requests with `handler(url)`. The page's own
 * background requests (the daily study, the parasha) get a 404 instead of
 * landing in the handler, so a test controls only the requests it is about.
 */
function answerSuggestions(page, handler) {
    page.window.fetch = (input) => {
        const url = String(input);
        if (!url.startsWith('/api/search/suggest')) return Promise.resolve({ ok: false, status: 404, json: async () => ({}), text: async () => '' });
        return handler(url);
    };
}

/** Shows ITEMS in the list, as a server answer would. */
async function showItems(page, items = ITEMS) {
    page.eval(`suppressSuggestionMenu = false`);
    answerSuggestions(page, async () => reply(items));
    await page.call('fetchOmniboxSuggestions', 'gen');
}

// ── What the type-ahead asks and shows ─────────────────────────────────────

test('typing under two characters shows nothing and asks nothing', async () => {
    const page = await openPage();
    try {
        page.takeCalls();
        await page.call('fetchOmniboxSuggestions', ' g ');
        await page.call('fetchOmniboxSuggestions', null);
        assert.deepEqual(page.takeCalls(), []);
        assert.equal(listVisible(page), false);
    } finally {
        page.close();
    }
});

test('a query goes to the suggest endpoint with its size and the metadata filters', async () => {
    const page = await openPage({ fetch: { '/api/search/suggest': ITEMS } });
    try {
        page.eval(`appState.prefs.metadataFilters = { era: ' Rishonim ', nusach: 'Sefard', author: '' }`);
        page.takeCalls();
        await page.call('fetchOmniboxSuggestions', '  gen  ');
        const [request] = page.takeCalls();
        const params = new URL(request.url, 'https://shelah.org').searchParams;
        assert.equal(params.get('q'), 'gen');
        assert.equal(params.get('size'), '8');
        assert.equal(params.get('era'), 'Rishonim');
        assert.equal(params.get('nusach'), 'Sefard');
        assert.equal(params.has('author'), false, 'an empty filter is not sent');
    } finally {
        page.close();
    }
});

test('the list shows each result with its type, a subtitle, and an announced count', async () => {
    const page = await openPage({ fetch: { '/api/search/suggest': ITEMS } });
    try {
        await page.call('fetchOmniboxSuggestions', 'gen');
        assert.equal(listVisible(page), true);
        assert.deepEqual(suggestions(page), [
            { label: 'Genesis 1', subtitle: 'Tanakh > Torah', badge: '', active: false },
            { label: 'Prayer Shema', subtitle: 'Liturgy from Sefaria', badge: 'Prayer', active: false },
            { label: 'Community Yemenite', subtitle: 'Community customs', badge: 'Community', active: false },
            { label: "Ask Sh'elah: why do we wash", subtitle: '', badge: 'Ask', active: false },
        ]);
        assert.equal(status(page), '4 suggestions');
    } finally {
        page.close();
    }
});

test('the Hebrew list uses the Hebrew labels and translates what the server left in English', async () => {
    const page = await openPage({ fetch: { '/api/search/suggest': ITEMS } });
    try {
        page.eval(`displayedLanguage = 'he'`);
        await page.call('fetchOmniboxSuggestions', 'gen');
        const shown = suggestions(page);
        assert.deepEqual(shown.map((item) => item.label), ['בראשית א', 'תפילה שמע', 'קהילה Community Yemenite', "שאל את ש'אלה: why do we wash"]);
        assert.deepEqual(shown.map((item) => item.badge), ['', 'תפילה', 'קהילה', 'שאלה']);
        assert.deepEqual(shown.map((item) => item.subtitle), ['תנ״ך › תורה', 'ליטורגיה מספריא', 'מנהגי קהילה', 'סינתזת בינה מלאכותית']);
        assert.equal(page.$$('#searchSuggestions .suggestion-item')[0].getAttribute('dir'), 'rtl');
        assert.equal(page.$$('#searchSuggestions .suggestion-item')[0].classList.contains('text-end'), true);
    } finally {
        page.close();
    }
});

test('a Hebrew result keeps the subtitle the server already wrote in Hebrew', async () => {
    const page = await openPage({ fetch: { '/api/search/suggest': [{ type: 'text', value: 'Genesis 1', label: 'Genesis 1', subtitle: 'Tanakh', subtitle_he: 'ספר ראשון' }] } });
    try {
        page.eval(`displayedLanguage = 'he'`);
        await page.call('fetchOmniboxSuggestions', 'gen');
        assert.equal(suggestions(page)[0].subtitle, 'ספר ראשון');
        assert.equal(page.call('translateSuggestionSubtitle', 'Anything', 'text'), 'Anything', 'a path with no known words is left as it is');
    } finally {
        page.close();
    }
});

test('a label that already starts with its type is not prefixed twice', async () => {
    const items = [{ type: 'prayer', value: 'Shema', label: 'Prayer Shema' }];
    const page = await openPage({ fetch: { '/api/search/suggest': items } });
    try {
        await page.call('fetchOmniboxSuggestions', 'she');
        assert.equal(suggestions(page)[0].label, 'Prayer Shema');
    } finally {
        page.close();
    }
});

test('a result the server labels with HTML is shown as text, not parsed', async () => {
    const items = [{ type: 'text', value: 'x', label: '<img src=x onerror=alert(1)>', subtitle: '<b>bold</b>' }];
    const page = await openPage({ fetch: { '/api/search/suggest': items } });
    try {
        await page.call('fetchOmniboxSuggestions', 'xx');
        assert.equal(page.$$('#searchSuggestions img, #searchSuggestions b').length, 0);
        assert.equal(suggestions(page)[0].label, '<img src=x onerror=alert(1)>');
        assert.equal(suggestions(page)[0].subtitle, '<b>bold</b>');
    } finally {
        page.close();
    }
});

test('no results closes the list and says so', async () => {
    const page = await openPage({ fetch: { '/api/search/suggest': [] } });
    try {
        await showItems(page);
        assert.equal(listVisible(page), true);
        answerSuggestions(page, async () => reply([]));
        await page.call('fetchOmniboxSuggestions', 'zzz');
        assert.equal(listVisible(page), false);
        assert.equal(page.$('#searchSuggestions').innerHTML, '', 'the markup goes once the list has closed');
        assert.equal(status(page), 'No suggestions');
        answerSuggestions(page, async () => reply({ not: 'a list' }));
        await page.call('fetchOmniboxSuggestions', 'zzz');
        assert.equal(status(page), 'No suggestions', 'an answer that is not a list is no results');
    } finally {
        page.close();
    }
});

test('the count is spoken in the singular and in Hebrew', async () => {
    const page = await openPage();
    try {
        assert.equal(page.call('suggestCountLabel', 1), '1 suggestion');
        assert.equal(page.call('suggestCountLabel', 0), 'No suggestions');
        page.eval(`displayedLanguage = 'he'`);
        assert.equal(page.call('suggestCountLabel', 1), 'הצעה אחת');
        assert.equal(page.call('suggestCountLabel', 3), '3 הצעות');
        assert.equal(page.call('suggestCountLabel', 0), 'אין הצעות');
    } finally {
        page.close();
    }
});

test('a server error closes the list and leaves the old results out', async () => {
    const page = await openPage();
    try {
        await showItems(page);
        answerSuggestions(page, async () => ({ ok: false, status: 503, json: async () => ({}) }));
        await page.call('fetchOmniboxSuggestions', 'gen');
        assert.equal(listVisible(page), false);
        assert.equal(page.eval('appState.suggestionItems.length'), 0);
        assert.deepEqual(page.reliability, []);
    } finally {
        page.close();
    }
});

test('a network failure closes the list and is logged', async () => {
    const page = await openPage();
    try {
        await showItems(page);
        answerSuggestions(page, async () => { throw new Error('offline'); });
        await page.call('fetchOmniboxSuggestions', 'gen');
        assert.equal(listVisible(page), false);
        assert.deepEqual(page.reliability, ['[Reliability] suggestions-error']);
    } finally {
        page.close();
    }
});

test('while the menu is suppressed (after a pick) nothing is asked or shown', async () => {
    const page = await openPage({ fetch: { '/api/search/suggest': ITEMS } });
    try {
        page.eval('suppressSuggestionMenu = true');
        page.takeCalls();
        await page.call('fetchOmniboxSuggestions', 'gen');
        assert.deepEqual(page.takeCalls(), []);
        assert.equal(listVisible(page), false);
    } finally {
        page.close();
    }
});

test('an answer that arrives after a newer query, or after a pick, is dropped', async () => {
    const page = await openPage();
    try {
        const pending = [];
        answerSuggestions(page, (url) => new Promise((resolve) => pending.push({ url, resolve })));
        const first = page.call('fetchOmniboxSuggestions', 'gen');
        const second = page.call('fetchOmniboxSuggestions', 'gene');
        const answer = reply;
        pending[1].resolve(answer([{ type: 'text', value: 'Genesis 1', label: 'Genesis 1' }]));
        await second;
        pending[0].resolve(answer([{ type: 'text', value: 'Gen. Rabbah', label: 'Gen. Rabbah' }]));
        await first;
        assert.deepEqual(suggestions(page).map((item) => item.label), ['Genesis 1'], 'the older answer does not replace the newer');

        const third = page.call('fetchOmniboxSuggestions', 'gene');
        page.eval('suppressSuggestionMenu = true');
        pending[2].resolve(answer(ITEMS));
        await third;
        assert.equal(page.eval('appState.suggestionItems.length'), 1, 'an answer for a search the reader already left is ignored');
    } finally {
        page.close();
    }
});

test('a slow answer says "Searching…" once, and a fast one never does', async () => {
    const page = await openPage();
    try {
        let release;
        answerSuggestions(page, () => new Promise((resolve) => { release = () => resolve(reply(ITEMS)); }));
        const slow = page.call('fetchOmniboxSuggestions', 'gen');
        await sleep(100);
        assert.equal(status(page), '', 'quiet while it is still quick');
        await sleep(400);
        assert.equal(status(page), 'Searching…');
        release();
        await slow;
        assert.equal(status(page), '4 suggestions');

        answerSuggestions(page, async () => reply(ITEMS));
        await page.call('fetchOmniboxSuggestions', 'gen');
        await sleep(450);
        assert.equal(status(page), '4 suggestions', 'the timer is cleared when the answer comes');
    } finally {
        page.close();
    }
});

test('typing asks the server once the typing has paused', async () => {
    const page = await openPage({ fetch: { '/api/search/suggest': ITEMS } });
    try {
        page.takeCalls();
        page.type('#searchInput', 'ge');
        page.type('#searchInput', 'gen');
        page.type('#searchInput', 'gene');
        assert.deepEqual(searchRequests(page), [], 'nothing yet while the keys are still going');
        await sleep(260);
        await page.settle();
        const asked = searchRequests(page).map((request) => new URL(request.url, 'https://shelah.org').searchParams.get('q'));
        assert.deepEqual(asked, ['gene'], 'one request, for the final text');
        assert.equal(listVisible(page), true);
    } finally {
        page.close();
    }
});

test('focusing a filled search box brings the list back; an empty one does not', async () => {
    const page = await openPage({ fetch: { '/api/search/suggest': ITEMS } });
    try {
        const focus = () => page.$('#searchInput').dispatchEvent(new page.window.Event('focus'));
        page.takeCalls();
        focus();
        await page.settle();
        assert.deepEqual(page.takeCalls(), []);

        page.$('#searchInput').value = 'gen';
        focus();
        await page.settle();
        assert.equal(page.takeCalls().length, 1);
        assert.equal(listVisible(page), true);

        page.eval('suppressSuggestionMenu = true');
        focus();
        await page.settle();
        assert.deepEqual(page.takeCalls(), [], 'not while the menu is suppressed');
    } finally {
        page.close();
    }
});

test('on a phone, focusing the search box opens the full-width search', async () => {
    const page = await openPage({ fetch: { '/api/search/suggest': ITEMS } });
    try {
        page.media.set(MOBILE, true);
        page.$('#searchInput').dispatchEvent(new page.window.Event('focus'));
        assert.equal(page.document.body.classList.contains('mobile-search-open'), true);
        page.eval('setMobileSearchExpanded(false)');
        assert.equal(page.document.body.classList.contains('mobile-search-open'), false);
    } finally {
        page.close();
    }
});

// ── Keys and clicks in the list ────────────────────────────────────────────

test('the arrow keys move the highlight, stopping at the ends', async () => {
    const page = await openPage();
    try {
        await showItems(page);
        const active = () => suggestions(page).findIndex((item) => item.active);
        assert.equal(active(), -1);
        for (const expected of [0, 1, 2, 3, 3]) {
            page.key('#searchInput', 'ArrowDown');
            assert.equal(active(), expected);
        }
        for (const expected of [2, 1, 0, -1, -1]) {
            page.key('#searchInput', 'ArrowUp');
            assert.equal(active(), expected);
        }
    } finally {
        page.close();
    }
});

test('the arrow keys keep the caret where it is (the default is prevented)', async () => {
    const page = await openPage();
    try {
        await showItems(page);
        const event = new page.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
        page.$('#searchInput').dispatchEvent(event);
        assert.equal(event.defaultPrevented, true);
    } finally {
        page.close();
    }
});

test('Escape closes the list', async () => {
    const page = await openPage();
    try {
        await showItems(page);
        page.key('#searchInput', 'Escape');
        assert.equal(listVisible(page), false);
        assert.equal(page.eval('appState.suggestionItems.length'), 0);
    } finally {
        page.close();
    }
});

test('keys do nothing while the list is closed', async () => {
    const page = await openPage();
    try {
        const event = new page.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
        page.$('#searchInput').dispatchEvent(event);
        assert.equal(event.defaultPrevented, false);
        assert.equal(page.eval('appState.activeSuggestionIndex'), -1);
    } finally {
        page.close();
    }
});

test('Enter on a highlighted suggestion opens it; Enter on none is left to the form', async () => {
    const page = await openPage();
    try {
        const navigation = recordNavigation(page);
        await showItems(page);
        page.$('#searchInput').value = 'sh';

        const plainEnter = new page.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        page.$('#searchInput').dispatchEvent(plainEnter);
        await page.settle();
        assert.equal(plainEnter.defaultPrevented, false);
        assert.deepEqual(navigation(), []);

        page.key('#searchInput', 'ArrowDown');
        page.key('#searchInput', 'ArrowDown');
        const enter = new page.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        page.$('#searchInput').dispatchEvent(enter);
        await page.settle();
        assert.equal(enter.defaultPrevented, true);
        assert.deepEqual(navigation(), [['prayer', 'Shema']]);
        assert.equal(page.$('#searchInput').value, '', 'the box is cleared once the page has changed');
        assert.equal(listVisible(page), false);
    } finally {
        page.close();
    }
});

test('Enter on a suggestion on a phone puts the normal top bar back', async () => {
    const page = await openPage();
    try {
        recordNavigation(page);
        page.media.set(MOBILE, true);
        await showItems(page);
        page.eval('setMobileSearchExpanded(true)');
        assert.equal(page.document.body.classList.contains('mobile-search-open'), true);
        page.key('#searchInput', 'ArrowDown');
        page.key('#searchInput', 'Enter');
        await page.settle();
        assert.equal(page.document.body.classList.contains('mobile-search-open'), false);
    } finally {
        page.close();
    }
});

test('clicking a suggestion opens it with the text typed so far as the fallback question', async () => {
    const page = await openPage();
    try {
        const navigation = recordNavigation(page);
        await showItems(page);
        page.$('#searchInput').value = 'why';
        page.click(page.$$('#searchSuggestions .suggestion-item')[3].querySelector('.text-sm'));
        await page.settle();
        assert.deepEqual(navigation(), [['ask', 'why do we wash']]);

        page.click(page.$$('#searchSuggestions .suggestion-item')[0]);
        await page.settle();
        assert.deepEqual(navigation().slice(1), [['text', 'Genesis 1']]);
    } finally {
        page.close();
    }
});

test('a click in the list that is not on a suggestion does nothing', async () => {
    const page = await openPage();
    try {
        const navigation = recordNavigation(page);
        await showItems(page);
        page.click('#searchSuggestions');
        await page.settle();
        assert.deepEqual(navigation(), []);
        assert.equal(listVisible(page), true);
    } finally {
        page.close();
    }
});

test('a click anywhere outside the search form closes the list; one inside keeps it', async () => {
    const page = await openPage();
    try {
        await showItems(page);
        page.click('#searchInput');
        assert.equal(listVisible(page), true);
        page.click(page.document.body);
        assert.equal(listVisible(page), false);
    } finally {
        page.close();
    }
});

test('on a phone, a tap outside the open search closes it, a tap inside does not', async () => {
    const page = await openPage();
    try {
        page.media.set(MOBILE, true);
        page.eval('setMobileSearchExpanded(true)');
        page.click('#searchInput');
        assert.equal(page.document.body.classList.contains('mobile-search-open'), true);
        page.click(page.document.body);
        assert.equal(page.document.body.classList.contains('mobile-search-open'), false);

        page.eval('setMobileSearchExpanded(true)');
        page.key(page.document.body, 'Escape');
        assert.equal(page.document.body.classList.contains('mobile-search-open'), false, 'Escape closes it too');
        page.key(page.document.body, 'Escape');
    } finally {
        page.close();
    }
});

// ── Opening a suggestion ───────────────────────────────────────────────────

test('openSearchTarget opens each kind of target and clears the search', async () => {
    const page = await openPage();
    try {
        const navigation = recordNavigation(page);
        for (const target of [
            { type: 'prayer', value: 'Shema' },
            { type: 'siddur', value: 'Shacharit' },
            { type: 'community', value: 'Yemenite' },
            { type: 'text', value: 'Genesis 1' },
        ]) {
            page.$('#searchInput').value = 'typed';
            assert.equal(await page.call('openSearchTarget', target), true, target.type);
            assert.equal(page.$('#searchInput').value, '', target.type);
        }
        assert.deepEqual(navigation(), [['prayer', 'Shema'], ['siddur', 'Shacharit'], ['community', 'Yemenite'], ['text', 'Genesis 1']]);
        assert.equal(page.eval('suppressSuggestionMenu'), true, 'the list stays shut until the reader types again');
    } finally {
        page.close();
    }
});

test('an ask target asks its own question, or else the one typed', async () => {
    const page = await openPage();
    try {
        const navigation = recordNavigation(page);
        assert.equal(await page.call('openSearchTarget', { type: 'ask', value: 'own question' }, 'typed'), true);
        assert.equal(await page.call('openSearchTarget', { type: 'ask' }, 'typed'), true);
        assert.deepEqual(navigation(), [['ask', 'own question'], ['ask', 'typed']]);
    } finally {
        page.close();
    }
});

test('no target, or one of a kind the page does not know, opens nothing', async () => {
    const page = await openPage();
    try {
        const navigation = recordNavigation(page);
        assert.equal(await page.call('openSearchTarget', null), false);
        assert.equal(await page.call('openSearchTarget', { type: 'video', value: 'x' }), false);
        assert.deepEqual(navigation(), []);
    } finally {
        page.close();
    }
});

// ── What a submitted search resolves to ────────────────────────────────────

test('the question words that send a search to the AI', async () => {
    const page = await openPage();
    try {
        const prefers = (q) => page.call('shouldPreferAiSearch', q);
        assert.equal(prefers(''), false);
        assert.equal(prefers(null), false);
        assert.equal(prefers('Genesis 1'), false);
        assert.equal(prefers('Rashi on Genesis'), false);
        assert.equal(prefers('is it ok'), true);
        assert.equal(prefers('Does a mourner'), true);
        assert.equal(prefers('shabbat candles?'), true);
        assert.equal(prefers('kashrut of gelatin'), true);
        assert.equal(prefers('minhag of hakafot'), true);
        assert.equal(prefers('Issues'), false, '"is" must be a whole word');
    } finally {
        page.close();
    }
});

test('a Talmud page is also tried under the tractate\'s Sefaria spelling', async () => {
    const page = await openPage();
    try {
        const candidates = (q) => plain(page.call('buildTalmudRefCandidates', q));
        assert.deepEqual(candidates('brachot 2a'), ['Berakhot 2a', 'Berakhot 2a:1', 'Talmud Berakhot 2a']);
        assert.deepEqual(candidates('Berachot 10B'), ['Berakhot 10b', 'Berakhot 10b:1', 'Talmud Berakhot 10b']);
        assert.deepEqual(candidates('niddah 3b'), ['Niddah 3b', 'Niddah 3b:1', 'Talmud Niddah 3b']);
        assert.deepEqual(candidates('bava metzia 4a'), ['Bava Metzia 4a', 'Bava Metzia 4a:1', 'Talmud Bava Metzia 4a']);
        assert.deepEqual(candidates('Genesis 1'), []);
        assert.deepEqual(candidates('Berakhot'), []);
        assert.deepEqual(candidates(''), []);
        assert.deepEqual(candidates(undefined), []);
    } finally {
        page.close();
    }
});

test('book names and common aliases open their first chapter without a request', async () => {
    const page = await openPage();
    try {
        assert.equal(page.call('searchQuickTarget', 'bereishit'), 'Genesis 1');
        assert.equal(page.call('searchQuickTarget', 'tehillim'), 'Psalms 1');
        assert.equal(page.call('searchQuickTarget', 'rashi on torah'), 'Rashi on Genesis 1:1');
        assert.equal(page.call('searchQuickTarget', 'siddur sefard'), 'Siddur Sefard');
        assert.equal(page.call('searchQuickTarget', 'constructor'), undefined, 'an inherited property is not an alias');
        assert.equal(page.call('searchQuickTarget', 'hasownproperty'), undefined);
        assert.equal(page.call('searchQuickTarget', 'nothing'), undefined);
        assert.equal(page.call('normalizeSearchKey', '  Siddur,  Ashkenaz!! '), 'siddur ashkenaz');
        assert.equal(page.call('normalizeSearchKey', null), '');
    } finally {
        page.close();
    }
});

test('resolveSearchTarget tries the siddur, the aliases, the reference itself, then the library', async () => {
    const page = await openPage({
        fetch: {
            '/api/text/Exodus%2020': { ref: 'Exodus 20', title: 'Exodus' },
            '/api/text/': { error: 'Text not found' },
            '/api/library/search': [{ ref: 'Pirkei Avot 1:1', title: 'Avot' }],
        },
    });
    try {
        page.window.ShelahSiddur = { find: async (query) => (query === 'shacharit' ? 'Shacharit' : null) };
        const resolve = async (q) => plain(await page.call('resolveSearchTarget', q));
        assert.deepEqual(await resolve('shacharit'), { type: 'siddur', value: 'Shacharit' });
        assert.deepEqual(await resolve('Genesis'), { type: 'text', value: 'Genesis 1' });
        assert.deepEqual(await resolve('Exodus 20'), { type: 'text', value: 'Exodus 20' });
        assert.deepEqual(await resolve('avot wisdom'), { type: 'text', value: 'Pirkei Avot 1:1' });
    } finally {
        page.close();
    }
});

test('a siddur table of contents that cannot be reached falls through to the text search', async () => {
    const page = await openPage({ fetch: { '/api/text/Exodus%2020': { ref: 'Exodus 20' } } });
    try {
        page.window.ShelahSiddur = { find: async () => { throw new Error('contents unavailable'); } };
        assert.deepEqual(plain(await page.call('resolveSearchTarget', 'Exodus 20')), { type: 'text', value: 'Exodus 20' });
        assert.equal(await page.call('findSiddurPage', 'x'), null);
    } finally {
        page.close();
    }
});

test('a reference is tried as typed, as a Talmud page, and as a book\'s first section', async () => {
    const page = await openPage({ fetch: { '/api/text/': { error: 'nope' } } });
    try {
        page.takeCalls();
        assert.equal(await page.call('resolveDirectRef', 'Berakhot 2a'), null);
        const urls = page.takeCalls().map((request) => decodeURIComponent(request.url.replace('/api/text/', '').replace('?autotranslate=0', '')));
        assert.deepEqual(urls, ['Berakhot 2a', 'Berakhot 2a:1', 'Talmud Berakhot 2a']);

        assert.equal(await page.call('resolveDirectRef', 'Ruth'), null);
        assert.deepEqual(page.takeCalls().map((request) => decodeURIComponent(request.url.replace('/api/text/', '').replace('?autotranslate=0', ''))), ['Ruth', 'Ruth 1']);
    } finally {
        page.close();
    }
});

test('a reference the server resolves is returned under the name it gave', async () => {
    const calls = [];
    const page = await openPage({
        fetch: [
            ['/api/text/Hakdama%201', () => { calls.push('second'); return { title: 'Hakdama', ref: '' }; }],
            ['/api/text/Hakdama', () => ({ status: 500, body: {} })],
        ],
    });
    try {
        assert.deepEqual(plain(await page.call('resolveDirectRef', 'Hakdama')), { type: 'text', value: 'Hakdama 1' });
        assert.deepEqual(calls, ['second']);
    } finally {
        page.close();
    }
});

test('a reference lookup that throws is skipped, not fatal', async () => {
    const page = await openPage({
        fetch: [
            ['/api/text/Ruth%201', () => { throw new Error('socket closed'); }],
            ['/api/text/Ruth', () => { throw new Error('socket closed'); }],
        ],
    });
    try {
        assert.equal(await page.call('resolveDirectRef', 'Ruth 1'), null);
    } finally {
        page.close();
    }
});

test('the library search picks the first hit that has a reference', async () => {
    const page = await openPage({
        fetch: {
            '/api/library/search': (url) => (url.includes('q=none') ? [] : (url.includes('q=bad') ? { status: 502, body: {} } : (url.includes('q=odd') ? { not: 'a list' } : (url.includes('q=bare') ? [{ title: 'No ref' }] : [{ ref: 'Midrash Rabbah 1' }])))),
        },
    });
    try {
        const hit = async (q) => plain(await page.call('resolveLibraryHit', q));
        assert.deepEqual(await hit('rabbah'), { type: 'text', value: 'Midrash Rabbah 1' });
        assert.equal(await hit('none'), null);
        assert.equal(await hit('bad'), null);
        assert.equal(await hit('odd'), null);
        assert.equal(await hit('bare'), null);
    } finally {
        page.close();
    }
});

// ── Submitting the search form ─────────────────────────────────────────────

/** Types into the search box and submits the form, as Enter does. */
async function submit(page, text) {
    page.$('#searchInput').value = text;
    page.$('#searchForm').dispatchEvent(new page.window.Event('submit', { cancelable: true }));
    await page.settle(20);
}

test('submitting an empty search does nothing', async () => {
    const page = await openPage();
    try {
        const navigation = recordNavigation(page);
        await submit(page, '   ');
        await submit(page, '​‍');
        assert.deepEqual(navigation(), []);
        assert.deepEqual(searchRequests(page), []);
    } finally {
        page.close();
    }
});

test('a book name opens the book; the box shows the cleaned text first', async () => {
    const page = await openPage();
    try {
        const navigation = recordNavigation(page);
        page.takeCalls();
        await submit(page, '  Genesis ​ ');
        assert.deepEqual(navigation(), [['text', 'Genesis 1']]);
        assert.deepEqual(page.takeCalls().filter((request) => request.url.startsWith('/api/text/')), [], 'an alias needs no lookup');
    } finally {
        page.close();
    }
});

test('a reference the server knows opens as the server names it', async () => {
    const page = await openPage({ fetch: { '/api/text/Exodus%2020%3A1': { ref: 'Exodus 20:1' } } });
    try {
        const navigation = recordNavigation(page);
        await submit(page, 'Exodus 20:1');
        assert.deepEqual(navigation(), [['text', 'Exodus 20:1']]);
    } finally {
        page.close();
    }
});

test('an unknown phrase is looked up in the library, then given to the AI if the library has nothing', async () => {
    const page = await openPage({
        fetch: {
            '/api/text/': { error: 'Text not found' },
            '/api/library/search': (url) => (url.includes('q=zzz') ? [] : [{ ref: 'Mishneh Torah, Prayer 1' }]),
        },
    });
    try {
        const navigation = recordNavigation(page);
        await submit(page, 'maimonides prayer');
        assert.deepEqual(navigation(), [['text', 'Mishneh Torah, Prayer 1']]);
        await submit(page, 'zzz');
        assert.deepEqual(navigation().slice(1), [['ask', 'zzz']]);
        assert.equal(listVisible(page), false);
    } finally {
        page.close();
    }
});

test('a question goes straight to the AI without looking for a text first', async () => {
    const page = await openPage();
    try {
        const navigation = recordNavigation(page);
        page.takeCalls();
        await submit(page, 'Why do we cover the challah?');
        assert.deepEqual(navigation(), [['ask', 'Why do we cover the challah?']]);
        assert.deepEqual(searchRequests(page), []);
    } finally {
        page.close();
    }
});

test('a text lookup that fails falls back to the AI', async () => {
    const page = await openPage({
        fetch: { '/api/library/search': () => { throw new Error('search is down'); }, '/api/text/': { error: 'nope' } },
    });
    try {
        const navigation = recordNavigation(page);
        await submit(page, 'shulchan');
        assert.deepEqual(navigation(), [['ask', 'shulchan']]);
    } finally {
        page.close();
    }
});

test('a highlighted suggestion wins over whatever resolution would pick', async () => {
    const page = await openPage();
    try {
        const navigation = recordNavigation(page);
        await showItems(page);
        page.key('#searchInput', 'ArrowDown');
        page.key('#searchInput', 'ArrowDown');
        await submit(page, 'Genesis');
        assert.deepEqual(navigation(), [['prayer', 'Shema']]);
    } finally {
        page.close();
    }
});

test('a search that is not a suggestion\'s index (stale highlight) is resolved normally', async () => {
    const page = await openPage();
    try {
        const navigation = recordNavigation(page);
        page.eval('appState.suggestionItems = []; appState.activeSuggestionIndex = 2');
        await submit(page, 'Psalms');
        assert.deepEqual(navigation(), [['text', 'Psalms 1']]);
    } finally {
        page.close();
    }
});

test('setQuery fills the box and submits', async () => {
    const page = await openPage();
    try {
        const navigation = recordNavigation(page);
        page.call('setQuery', 'Proverbs');
        await page.settle(20);
        assert.deepEqual(navigation(), [['text', 'Proverbs 1']]);
    } finally {
        page.close();
    }
});

// ── An AI search, and its side effects ─────────────────────────────────────

/** Opens the page with the conversation panel and router stood in, the way main.js leaves them. */
async function openAiPage({ ui = fakeConversationUI(), router = fakeRouter(), fetch = {} } = {}) {
    const page = await openPage({
        fetch,
        before: (window) => { window.ShelahConversationUI = ui; window.ShelahRouter = router; },
    });
    page.ui = ui;
    page.router = router;
    return page;
}

test('an AI search shows the question on the page, asks the panel, and files the answer under its id', async () => {
    const page = await openAiPage();
    try {
        await page.call('handleAiSearch', '  Why   do we fast?  ');
        const [asked] = page.ui.calls;
        assert.deepEqual(plain(asked), ['askFromSearch', 'Why do we fast?', { mode: page.eval('appState.prefs.mode'), community: page.eval('appState.prefs.community'), language: 'en' }, { followUp: false, surface: 'bar' }]);
        assert.equal(page.$('#searchInput').value, 'Why do we fast?');
        assert.equal(page.document.body.classList.contains('search-loading'), false, 'the loading state ends with the answer');
        assert.equal(page.eval('suppressSuggestionMenu'), false);
        const pushed = page.router.calls.find(([name, patch]) => name === 'pushRoute' && patch.chat);
        assert.deepEqual(plain(pushed.slice(1)), [{ chat: 'h-1', mode: 'balanced' }, { exclusive: true, overlay: 'answer' }]);
        assert.deepEqual(page.reliability, []);
    } finally {
        page.close();
    }
});

test('a question asked from the bar loads in the bar; one asked in the panel, or a follow-up, loads in the panel', async () => {
    const page = await openAiPage();
    try {
        const form = page.$('#searchForm');
        await page.call('handleAiSearch', 'Why do we fast?');
        assert.equal(plain(page.ui.calls.at(-1))[3].surface, 'bar');
        assert.equal(form.classList.contains('search-liftoff'), true, 'the bar acknowledges its question');

        form.classList.remove('search-liftoff');
        await page.call('handleAiSearch', 'And on Tisha B\'Av?', { origin: 'panel' });
        assert.equal(plain(page.ui.calls.at(-1))[3].surface, 'panel');
        await page.call('handleAiSearch', 'And on Yom Kippur?', { followUp: true });
        assert.equal(plain(page.ui.calls.at(-1))[3].surface, 'panel');
        assert.equal(form.classList.contains('search-liftoff'), false, 'the bar stays still for questions asked elsewhere');
    } finally {
        page.close();
    }
});

test('the loading class is the conversation module\'s to set: the page leaves it alone while a question loads', async () => {
    let seen = null;
    const page = await openAiPage();
    page.ui.askFromSearch = async () => {
        seen = page.document.body.classList.contains('search-loading');
        return { answer: 'A', meta: {} };
    };
    try {
        await page.call('handleAiSearch', 'Why do we fast?');
        assert.equal(seen, false);
    } finally {
        page.close();
    }
});

test('closing the phone search while its question loads hands the wait to the panel', async () => {
    let release;
    const ui = fakeConversationUI({
        askFromSearch: () => new Promise((resolve) => { release = () => resolve({ answer: 'A', meta: {} }); }),
    });
    const page = await openAiPage({ ui });
    try {
        const asking = page.call('handleAiSearch', 'Why do we fast?');
        await page.settle(20);
        // The reader taps away while the question is still loading in the bar.
        page.document.body.classList.add('mobile-search-open');
        page.call('setMobileSearchExpanded', false);
        assert.deepEqual(page.ui.calls.filter(([name]) => name === 'showPendingAnswer').length, 1);

        // Once the question is over, closing the search no longer calls the panel.
        release();
        await asking;
        page.document.body.classList.add('mobile-search-open');
        page.call('setMobileSearchExpanded', false);
        assert.equal(page.ui.calls.filter(([name]) => name === 'showPendingAnswer').length, 1);
    } finally {
        page.close();
    }
});

test('an AI search asks in Hebrew when the page is Hebrew, and a follow-up says so', async () => {
    const page = await openAiPage();
    try {
        page.eval(`displayedLanguage = 'he'`);
        await page.call('handleAiSearch', 'למה צמים?', { followUp: true });
        const [, , options, extra] = page.ui.calls[0];
        assert.equal(options.language, 'he');
        assert.deepEqual(plain(extra), { followUp: true, surface: 'panel' });
    } finally {
        page.close();
    }
});

test('an empty question, or one that is only hidden characters, is not asked', async () => {
    const page = await openAiPage();
    try {
        await page.call('handleAiSearch', '   ');
        await page.call('handleAiSearch', '​');
        assert.deepEqual(page.ui.calls, []);
    } finally {
        page.close();
    }
});

test('an answer that was replaced or closed meanwhile is not filed or routed', async () => {
    const replaced = await openAiPage({ ui: fakeConversationUI({ askFromSearch: async () => null }) });
    try {
        await replaced.call('handleAiSearch', 'Why?');
        assert.deepEqual(replaced.router.calls.filter(([name]) => name === 'pushRoute'), []);
    } finally {
        replaced.close();
    }

    const closed = await openAiPage({ ui: fakeConversationUI({ isShowingAnswer: () => false }) });
    try {
        await closed.call('handleAiSearch', 'Why?');
        assert.deepEqual(closed.router.calls.filter(([name, patch]) => name === 'pushRoute' && patch.chat), [], 'a panel closed while loading gets no entry to come back to');
    } finally {
        closed.close();
    }
});

test('a fallback answer is noted in the reliability log', async () => {
    const ui = fakeConversationUI({
        askFromSearch: async () => ({ history_id: 'h-2', meta: { fallback: true, mode: 'fast', source_count: 3 } }),
    });
    const page = await openAiPage({ ui });
    try {
        await page.call('handleAiSearch', 'Why?');
        assert.deepEqual(page.reliability, ['[Reliability] ai-fallback-used {"mode":"fast","source_count":3}']);
    } finally {
        page.close();
    }
});

test('an answer with no history id is shown but not routed or put on the shelf', async () => {
    const ui = fakeConversationUI({ askFromSearch: async () => ({ answer: 'A', meta: {} }) });
    const page = await openAiPage({ ui });
    try {
        await page.call('handleAiSearch', 'Why?');
        assert.deepEqual(page.router.calls.filter(([name, patch]) => name === 'pushRoute' && patch.chat), []);
    } finally {
        page.close();
    }
});

test('each way an AI search can fail leaves the right note, and the page usable', async () => {
    const cases = [
        [{ code: 'turnstile_required' }, ['[Reliability] ai-turnstile-required']],
        [{ code: 'guest_cap_reached', reason: 'daily' }, ['[Reliability] ai-guest-cap {"reason":"daily"}']],
        [{ status: 401 }, ['[Reliability] ai-response-error {"message":"session expired"}']],
        [{ status: 500, message: 'upstream down' }, ['[Reliability] ai-response-error {"message":"upstream down"}']],
        [{ status: 503 }, ['[Reliability] ai-response-error {"message":"request failed"}']],
        [{ name: 'AbortError', message: 'timed out', attempts: 3 }, ['[Reliability] ai-network-error {"message":"timed out","timeout":true,"attempts":3}']],
        [{ message: 'offline' }, ['[Reliability] ai-network-error {"message":"offline","timeout":false,"attempts":1}']],
    ];
    for (const [failure, expected] of cases) {
        const ui = fakeConversationUI({ askFromSearch: async () => { throw Object.assign(new Error(failure.message ?? ''), failure); } });
        const page = await openAiPage({ ui });
        try {
            await page.call('handleAiSearch', 'Why?');
            assert.deepEqual(page.reliability, expected, JSON.stringify(failure));
            assert.equal(page.document.body.classList.contains('search-loading'), false);
            assert.equal(page.eval('suppressSuggestionMenu'), false, 'search works again after a failure');
        } finally {
            page.close();
        }
    }
});

test('a Turnstile challenge that failed is reset for the next try', async () => {
    const resets = [];
    const ui = fakeConversationUI({ askFromSearch: async () => { throw Object.assign(new Error('challenge'), { code: 'turnstile_required' }); } });
    const page = await openPage({
        before: (window) => {
            window.ShelahConversationUI = ui;
            window.turnstile = { reset: (widget) => resets.push(widget.id) };
        },
    });
    try {
        page.document.body.insertAdjacentHTML('beforeend', '<div id="turnstileWidget"></div>');
        page.window.__turnstileToken = 'stale';
        await page.call('handleAiSearch', 'Why?');
        assert.equal(page.window.__turnstileToken, '');
        assert.deepEqual(resets, ['turnstileWidget']);

        page.window.turnstile.reset = () => { throw new Error('widget not ready'); };
        await page.call('handleAiSearch', 'Why?');
        assert.equal(page.window.__turnstileToken, '');
    } finally {
        page.close();
    }
});

test('with no conversation module loaded the search ends cleanly', async () => {
    const page = await openPage();
    try {
        await page.call('handleAiSearch', 'Why?');
        assert.deepEqual(page.reliability, ['[Reliability] ai-network-error {"message":"AI module unavailable","timeout":false,"attempts":1}']);
        assert.equal(page.document.body.classList.contains('search-loading'), false);
    } finally {
        page.close();
    }
});

test('the search bar glows once per search and the glow cleans itself up', async () => {
    const page = await openAiPage();
    try {
        const form = page.$('#searchForm');
        page.call('pulseSearchLiftoff');
        assert.equal(form.classList.contains('search-liftoff'), true);
        page.call('pulseSearchLiftoff');
        assert.equal(form.classList.contains('search-liftoff'), true, 'a second search restarts it');
        await sleep(470);
        assert.equal(form.classList.contains('search-liftoff'), false);
    } finally {
        page.close();
    }
});

// ── Searching zmanim by city ───────────────────────────────────────────────

/** The zmanim module's side of the city search, recorded. */
function fakeZmanimModules(window, log) {
    window.ShelahModules = {
        fetchZmanimAPI: (location) => log.push(['fetchZmanimAPI', location]),
        cacheZmanimLocation: (location) => log.push(['cacheZmanimLocation', location]),
        setCurrentZmanimLocationLabel: (label) => log.push(['label', label]),
    };
}

const cityText = (page, id) => ({ text: page.$(id).textContent, hidden: page.$(id).classList.contains('hidden') });
const citySearch = async (page, city = 'Jerusalem') => {
    page.$('#citySearchInput').value = city;
    await page.window.searchByCity();
};

test('the city button opens the search below it, focuses the box, and a second click closes it', async () => {
    const page = await openPage();
    try {
        page.window.openCitySearch();
        const popover = page.$('#citySearchPopover');
        assert.equal(popover.classList.contains('hidden'), false);
        assert.match(popover.style.top, /px$/);
        await sleep(80);
        assert.equal(page.document.activeElement, page.$('#citySearchInput'));

        page.window.openCitySearch();
        assert.equal(popover.classList.contains('hidden'), true);
    } finally {
        page.close();
    }
});

test('a city search with nothing typed does nothing', async () => {
    const page = await openPage();
    try {
        page.takeCalls();
        await citySearch(page, '   ');
        assert.deepEqual(page.takeCalls(), []);
        assert.deepEqual(cityText(page, '#citySearchStatus'), { text: '', hidden: true });
    } finally {
        page.close();
    }
});

test('a city found sets the zmanim location for this visit and the session', async () => {
    const log = [];
    const page = await openPage({
        fetch: {
            '/api/geocode': { results: [{ lat: '31.7683', lon: '35.2137', display_name: 'Jerusalem, Jerusalem District, Israel' }] },
            '/set_location': { ok: true },
        },
        before: (window) => fakeZmanimModules(window, log),
    });
    try {
        page.window.openCitySearch();
        page.takeCalls();
        await citySearch(page, 'Jerusalem');
        const [geocode, setLocation] = page.takeCalls();
        assert.equal(geocode.url, '/api/geocode?q=Jerusalem&lang=en');
        assert.equal(setLocation.url, '/set_location');
        assert.equal(setLocation.init.method, 'POST');
        assert.deepEqual(JSON.parse(setLocation.init.body), { lat: 31.7683, lon: 35.2137 });
        assert.deepEqual(plain(log.map(([name]) => name)), ['cacheZmanimLocation', 'fetchZmanimAPI', 'label']);
        assert.deepEqual(plain(log[0][1]), { lat: 31.7683, lon: 35.2137 });
        assert.equal(log[2][1], 'Jerusalem, Jerusalem District');
        assert.deepEqual(cityText(page, '#citySearchStatus'), { text: 'Using: Jerusalem, Jerusalem District', hidden: false });
        assert.equal(page.$('#citySearchSubmit').disabled, false);

        await sleep(1300);
        assert.equal(page.$('#citySearchPopover').classList.contains('hidden'), true, 'the popover closes itself');
    } finally {
        page.close();
    }
});

test('the city search asks in Hebrew and answers in Hebrew', async () => {
    const log = [];
    const page = await openPage({
        fetch: { '/api/geocode': { results: [{ lat: 32.08, lon: 34.78, display_name: 'תל אביב, ישראל' }] }, '/set_location': {} },
        before: (window) => fakeZmanimModules(window, log),
    });
    try {
        page.eval(`displayedLanguage = 'he'`);
        page.takeCalls();
        await citySearch(page, 'תל אביב');
        assert.equal(page.takeCalls()[0].url, `/api/geocode?q=${encodeURIComponent('תל אביב')}&lang=he`);
        assert.equal(cityText(page, '#citySearchStatus').text, 'משתמש ב: תל אביב, ישראל');
    } finally {
        page.close();
    }
});

test('a city the geocoder does not know says so, and a failing geocoder says that instead', async () => {
    const page = await openPage({
        fetch: { '/api/geocode': (url) => (url.includes('q=Nowhere') ? { results: [] } : { status: 502, body: { error: 'upstream' } }) },
    });
    try {
        await citySearch(page, 'Nowhere');
        assert.deepEqual(cityText(page, '#citySearchError'), { text: 'City not found. Try a different spelling.', hidden: false });
        assert.equal(cityText(page, '#citySearchStatus').hidden, true);

        await citySearch(page, 'Somewhere');
        assert.deepEqual(cityText(page, '#citySearchError'), { text: 'Search failed. Please try again shortly.', hidden: false });
        assert.equal(page.$('#citySearchSubmit').disabled, false, 'the button works again');

        page.eval(`displayedLanguage = 'he'`);
        await citySearch(page, 'Nowhere');
        assert.equal(cityText(page, '#citySearchError').text, 'העיר לא נמצאה. נסה איות אחר.');
    } finally {
        page.close();
    }
});

test('a city search with no zmanim module, or no network, tells the reader to check their connection', async () => {
    let offline = false;
    const page = await openPage({
        fetch: {
            '/api/geocode': () => {
                if (offline) throw new Error('offline');
                return { results: [{ lat: '1', lon: '2', display_name: 'A, B' }] };
            },
        },
    });
    try {
        await citySearch(page, 'Anywhere');
        assert.equal(cityText(page, '#citySearchError').text, 'Search failed. Check your connection.', 'the zmanim module is not there');
        assert.equal(page.$('#citySearchSubmit').disabled, false);

        offline = true;
        page.$('#citySearchError').textContent = '';
        await citySearch(page, 'Anywhere');
        assert.equal(cityText(page, '#citySearchError').text, 'Search failed. Check your connection.');
    } finally {
        page.close();
    }
});


test('a city whose session update fails is still used for this visit', async () => {
    const log = [];
    const page = await openPage({
        fetch: { '/api/geocode': { results: [{ lat: '1', lon: '2', display_name: 'Haifa, Israel' }] }, '/set_location': () => { throw new Error('server down'); } },
        before: (window) => fakeZmanimModules(window, log),
    });
    try {
        await citySearch(page, 'Haifa');
        await page.settle();
        assert.deepEqual(plain(log.map(([name]) => name)), ['cacheZmanimLocation', 'fetchZmanimAPI', 'label']);
        assert.equal(cityText(page, '#citySearchError').hidden, true);
    } finally {
        page.close();
    }
});

test('Enter in the city box searches; Escape and a click outside close the popover', async () => {
    const log = [];
    const page = await openPage({
        fetch: { '/api/geocode': { results: [{ lat: '1', lon: '2', display_name: 'Haifa, Israel' }] }, '/set_location': {} },
        before: (window) => fakeZmanimModules(window, log),
    });
    try {
        page.window.openCitySearch();
        const input = page.$('#citySearchInput');
        input.value = 'Haifa';
        input.focus();
        page.key(input, 'Enter');
        await page.settle(20);
        assert.equal(log.length, 3, 'Enter ran the search');

        page.key(input, 'Escape');
        assert.equal(page.$('#citySearchPopover').classList.contains('hidden'), true);

        page.window.openCitySearch();
        page.click(page.$('#citySearchPopover'));
        assert.equal(page.$('#citySearchPopover').classList.contains('hidden'), false, 'a click inside stays open');
        page.click(page.document.body);
        assert.equal(page.$('#citySearchPopover').classList.contains('hidden'), true, 'a click elsewhere closes it');

        page.click(page.$('#citySearchBtn'));
        assert.equal(page.$('#citySearchPopover').classList.contains('hidden'), false, 'the button opens it, and is not an outside click');
        page.click(page.$('#citySearchBtn'));
        assert.equal(page.$('#citySearchPopover').classList.contains('hidden'), true, 'and closes it again');
    } finally {
        page.close();
    }
});
