/**
 * How the reader gets its text: the spellings it retries a reference with,
 * the cache and the Sefaria fallback behind the server, a page the server
 * already rendered, and the infinite scroll that appends the next chapter and
 * prepends the previous one. Boots the real home page in jsdom
 * (tests_js/helpers/shell_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');
const { textPayload } = require('./helpers/shell_data');

const plain = (value) => JSON.parse(JSON.stringify(value));
const chapter = (n, extra = {}) => textPayload(`Genesis ${n}`, [['1', 'א', `verse ${n}.1`], ['2', 'ב', `verse ${n}.2`]], extra);
const textUrl = (ref) => `/api/text/${encodeURIComponent(ref)}`;
const fetched = (page) => page.takeCalls().map((call) => call.url).filter((url) => url.startsWith('/api/text/') || url.startsWith('https://www.sefaria.org'));

/** A page with the Reliability log captured instead of printed. */
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
    return page;
}

const call = (page, name, ...args) => page.call(name, ...args);

// ── The spellings a reference is retried with ──────────────────────────────

test('buildFallbackTextRefs suggests the spellings a slipped reference may have meant', async () => {
    const page = await openPage();
    try {
        const refs = (ref) => plain(call(page, 'buildFallbackTextRefs', ref));
        assert.deepEqual(refs(''), []);
        assert.deepEqual(refs(null), []);
        assert.deepEqual(refs('Genesis 1'), []);
        assert.deepEqual(refs('  Genesis   1 '), ['Genesis 1']);
        assert.deepEqual(refs('Ha’azinu 1'), ["Ha'azinu 1"]);
        assert.deepEqual(refs('text Genesis 1'), ['Genesis 1']);
        assert.deepEqual(refs('Genesis 1.'), ['Genesis 1']);
        assert.deepEqual(refs('Genesis 1; Exodus 2'), ['Genesis 1']);
        assert.deepEqual(refs('Mishnah Yom Tov 3'), ['Mishnah Beitzah 3']);
        assert.deepEqual(refs('Mishnah Yom Tov'), [
            'Mishnah Beitzah 1',
            'Mishnah Yom Tov 1',
            'Mishnah Yom Tov, Genesis 1',
            'Mishnah Yom Tov, Genesis 1:1',
        ]);
    } finally {
        page.close();
    }
});

test('a bare book or commentary name falls back to its first section', async () => {
    const page = await openPage();
    try {
        const refs = (ref) => plain(call(page, 'buildFallbackTextRefs', ref));
        assert.deepEqual(refs('Exodus'), ['Exodus 1', 'Exodus, Genesis 1', 'Exodus, Genesis 1:1']);
        assert.deepEqual(refs('Rashi'), ['Rashi 1', 'Rashi, Genesis 1', 'Rashi, Genesis 1:1', 'Rashi on Torah, Genesis 1:1']);
        assert.deepEqual(refs('Exodus 2'), []);
        assert.deepEqual(refs('Berakhot 2a'), []);
        assert.deepEqual(refs('Kli Yakar, Shemot'), ['Kli Yakar, Shemot on Torah, Genesis 1:1'], 'a commentary name is also tried under the Torah');
    } finally {
        page.close();
    }
});

test('"X on Torah" is also tried the way Sefaria files it, under the book', async () => {
    const page = await openPage();
    try {
        const refs = (ref) => plain(call(page, 'buildFallbackTextRefs', ref));
        assert.deepEqual(refs('Rashi on Torah, Genesis 2'), [
            'Rashi on Genesis 2',
            'Rashi on Genesis 2:1',
            'Rashi on Torah, Genesis 2, Genesis 1:1',
            'Rashi on Torah, Genesis 2:1',
        ]);
        assert.deepEqual(refs('Ramban on Torah'), [
            'Ramban on Torah 1',
            'Ramban on Torah, Genesis 1',
            'Ramban on Torah, Genesis 1:1',
            'Ramban on Genesis',
            'Ramban on Genesis 1:1',
        ]);
        assert.deepEqual(refs('Midrash on Torah, Genesis 1:1'), []);
        assert.deepEqual(refs('Midrash on Torah Genesis 5'), [
            'Midrash on Torah Genesis 5, Genesis 1:1',
            'Midrash on Torah Genesis 5:1',
        ]);
    } finally {
        page.close();
    }
});

// ── Fetching a text ─────────────────────────────────────────────────────────

test('an empty reference is not fetched at all', async () => {
    const page = await openPage();
    try {
        page.takeCalls();
        assert.deepEqual(plain(await call(page, 'fetchTextPayloadWithFallback', '  ')), { payload: { error: 'Text not found' }, resolvedRef: '' });
        assert.deepEqual(fetched(page), []);
    } finally {
        page.close();
    }
});

test('a text is fetched once; the second read comes from the cache', async () => {
    const page = await openPage({ fetch: { [textUrl('Genesis 1')]: chapter(1) } });
    try {
        page.takeCalls();
        const first = await call(page, 'fetchTextPayloadWithFallback', 'Genesis 1');
        assert.equal(first.resolvedRef, 'Genesis 1');
        assert.equal(first.payload.ref, 'Genesis 1');
        const second = await call(page, 'fetchTextPayloadWithFallback', 'Genesis 1');
        assert.equal(second.payload, first.payload);
        assert.deepEqual(fetched(page), [`${textUrl('Genesis 1')}?autotranslate=0`]);
    } finally {
        page.close();
    }
});

test('a misspelt reference loads under the first spelling the server knows, and is cached under both', async () => {
    const page = await openPage({
        fetch: {
            [textUrl('text Genesis 1')]: { error: 'Text not found', error_type: 'not_found' },
            [textUrl('Genesis 1')]: chapter(1),
        },
    });
    try {
        page.takeCalls();
        const found = plain(await call(page, 'fetchTextPayloadWithFallback', 'text Genesis 1'));
        assert.equal(found.resolvedRef, 'Genesis 1');
        assert.deepEqual(fetched(page), [
            `${textUrl('text Genesis 1')}?autotranslate=0`,
            `${textUrl('Genesis 1')}?autotranslate=0`,
        ]);
        await call(page, 'fetchTextPayloadWithFallback', 'text Genesis 1');
        assert.deepEqual(fetched(page), [], 'the misspelling itself is cached now');
    } finally {
        page.close();
    }
});

test('a text the server says does not exist is never looked up at Sefaria', async () => {
    const page = await openPage({ fetch: { '/api/text/': { error: 'Text not found', error_type: 'not_found' } } });
    try {
        page.takeCalls();
        const missing = plain(await call(page, 'fetchTextPayloadWithFallback', 'Nowhere 9'));
        assert.equal(missing.payload.error_type, 'not_found');
        assert.equal(fetched(page).some((url) => url.startsWith('https://www.sefaria.org')), false);
    } finally {
        page.close();
    }
});

test('when our server fails, Sefaria is asked directly and its answer is reshaped into the app\'s own payload', async () => {
    const sefaria = {
        ref: 'Genesis 1',
        heTitle: 'בראשית',
        he: [['א', 'ב'], ['ג']],
        text: [['one', 'two'], ['three']],
        next: 'Genesis 2',
        categories: ['Tanakh'],
    };
    const page = await openPage({
        fetch: { '/api/text/': { error: 'upstream exploded' }, 'https://www.sefaria.org/api/texts/Genesis_1': sefaria },
    });
    try {
        page.takeCalls();
        const { payload, resolvedRef } = plain(await call(page, 'fetchTextPayloadWithFallback', 'Genesis 1'));
        assert.equal(resolvedRef, 'Genesis 1');
        assert.equal(payload.ref, 'Genesis 1');
        assert.equal(payload.title, 'Genesis 1', 'no title in the reply: the book part of the reference');
        assert.equal(payload.heTitle, 'בראשית');
        assert.deepEqual(payload.lines.map((line) => [line.segment, line.he, line.en]), [
            ['1.1', 'א', 'one'],
            ['1.2', 'ב', 'two'],
            ['2.1', 'ג', 'three'],
        ]);
        assert.deepEqual(payload.en, ['one', 'two', 'three']);
        assert.deepEqual(payload.he, ['א', 'ב', 'ג']);
        assert.equal(payload.next, 'Genesis 2');
        assert.equal(payload.prev, null);
        assert.deepEqual(payload.categories, ['Tanakh']);
        const second = await call(page, 'fetchTextPayloadWithFallback', 'Genesis 1');
        assert.equal(second.payload.ref, 'Genesis 1');
        assert.equal(fetched(page).filter((url) => url.startsWith('https://www.sefaria.org')).length, 1, 'cached after');
    } finally {
        page.close();
    }
});

test('Sefaria replies that carry no text, or an error, are not used', async () => {
    for (const reply of [{ error: 'No such text' }, { status: 404, body: {} }, { status: 500, body: 'oops' }]) {
        const page = await openPage({
            fetch: { '/api/text/': { error: 'upstream exploded' }, 'https://www.sefaria.org': reply },
        });
        try {
            const { payload } = plain(await call(page, 'fetchTextPayloadWithFallback', 'Genesis 1'));
            assert.equal(payload.error, 'upstream exploded', JSON.stringify(reply));
        } finally {
            page.close();
        }
    }
});

test('Sefaria blocking the browser (403, or CORS) is reported as that, not as a missing text', async () => {
    const blocked = await openPage({
        fetch: { '/api/text/': { error: 'upstream exploded' }, 'https://www.sefaria.org': { status: 403, body: {} } },
    });
    try {
        const { payload } = plain(await call(blocked, 'fetchTextPayloadWithFallback', 'Genesis 1'));
        assert.equal(payload.error_type, 'sefaria_blocked');
    } finally {
        blocked.close();
    }

    let corsWindow;
    const cors = await openPage({
        before: (window) => { corsWindow = window; },
        fetch: {
            '/api/text/': { error: 'upstream exploded' },
            'https://www.sefaria.org': () => { throw new corsWindow.TypeError('Failed to fetch'); },
        },
    });
    try {
        const { payload } = plain(await call(cors, 'fetchTextPayloadWithFallback', 'Genesis 1'));
        assert.equal(payload.error_type, 'cors_blocked');
    } finally {
        cors.close();
    }
});

test('with no connection at all the answer is a network error', async () => {
    const page = await openPage({
        fetch: {
            '/api/text/': () => { throw new Error('offline'); },
            'https://www.sefaria.org': () => { throw new Error('offline'); },
        },
    });
    try {
        const { payload, resolvedRef } = plain(await call(page, 'fetchTextPayloadWithFallback', 'Genesis 1'));
        assert.equal(payload.error_type, 'network');
        assert.equal(resolvedRef, 'Genesis 1');
    } finally {
        page.close();
    }
});

// ── A stale service worker ──────────────────────────────────────────────────

function installFakeServiceWorker(page, { cacheKeys = ['shelah-cache-v2', 'other-cache', 'shelah-cache-v3'], failUnregister = false } = {}) {
    const state = { unregistered: 0, deleted: [] };
    Object.defineProperty(page.window.navigator, 'serviceWorker', {
        configurable: true,
        value: {
            getRegistrations: async () => [{
                unregister: async () => {
                    if (failUnregister) throw new Error('nope');
                    state.unregistered += 1;
                },
            }, { unregister: async () => { state.unregistered += 1; } }],
        },
    });
    page.window.caches = {
        keys: async () => cacheKeys,
        delete: async (key) => { state.deleted.push(key); return true; },
    };
    return state;
}

test('a failed load that looks like a stale service worker clears it and tries once more', async () => {
    let attempts = 0;
    const page = await openPage({
        fetch: {
            [textUrl('Genesis 1')]: () => {
                attempts += 1;
                return attempts === 1 ? { error: 'Request failed (offline cache)' } : chapter(1);
            },
        },
        storage: { 'shelah-sw-v3-migrated': 'true' },
    });
    try {
        const worker = installFakeServiceWorker(page);
        const { payload } = plain(await call(page, 'fetchTextPayloadWithFallback', 'Genesis 1'));
        assert.equal(payload.ref, 'Genesis 1');
        assert.equal(worker.unregistered, 2);
        assert.deepEqual(worker.deleted, ['shelah-cache-v2', 'shelah-cache-v3']);
        assert.equal(page.window.localStorage.getItem('shelah-sw-v3-migrated'), null, 'migration flag cleared');
        assert.ok(page.reliability.some((line) => line.includes('service-worker-recovered-for-text-load')));
    } finally {
        page.close();
    }
});

test('the service worker is only reset once per page, and a reset that throws is logged and ignored', async () => {
    const page = await openPage();
    try {
        installFakeServiceWorker(page, { failUnregister: true });
        assert.equal(await call(page, 'recoverFromStaleServiceWorker'), false);
        assert.ok(page.reliability.some((line) => line.includes('service-worker-recovery-failed')));
        assert.equal(await call(page, 'recoverFromStaleServiceWorker'), false, 'not attempted a second time');
    } finally {
        page.close();
    }

    const bare = await openPage();
    try {
        assert.equal(await call(bare, 'recoverFromStaleServiceWorker'), false, 'a browser without service workers');
    } finally {
        bare.close();
    }
});

// ── A chapter the server already rendered ──────────────────────────────────

function ssrHolder(page, body) {
    const holder = page.document.createElement('script');
    holder.id = 'ssrTextPayload';
    holder.type = 'application/json';
    holder.textContent = typeof body === 'string' ? body : JSON.stringify(body);
    page.document.body.appendChild(holder);
    return holder;
}

test('the server-rendered chapter is handed over once, rebuilt like /api/text and cached', async () => {
    const page = await openPage();
    try {
        assert.equal(call(page, 'takeServerRenderedText', 'Genesis 1'), null, 'no holder: nothing to take');
        ssrHolder(page, { requestedRef: 'Genesis 1', payload: chapter(1) });
        const taken = plain(call(page, 'takeServerRenderedText', 'Genesis 1'));
        assert.deepEqual(taken.he, ['א', 'ב']);
        assert.deepEqual(taken.en, ['verse 1.1', 'verse 1.2']);
        assert.equal(page.$('#ssrTextPayload'), null, 'the holder is consumed');
        page.takeCalls();
        const again = await call(page, 'fetchTextPayloadWithFallback', 'Genesis 1');
        assert.equal(again.payload.ref, 'Genesis 1');
        assert.deepEqual(fetched(page), [], 'served from the cache it seeded');
    } finally {
        page.close();
    }
});

test('a server-rendered payload for another reference, or a broken one, is dropped', async () => {
    const page = await openPage();
    try {
        const cases = [
            { requestedRef: 'Genesis 2', payload: chapter(2) },
            { requestedRef: 'Genesis 1', payload: chapter(1, { lines: [] }) },
            { requestedRef: 'Genesis 1' },
            '{not json',
            '{}',
        ];
        for (const body of cases) {
            ssrHolder(page, body);
            assert.equal(call(page, 'takeServerRenderedText', 'Genesis 1'), null, JSON.stringify(body));
            assert.equal(page.$('#ssrTextPayload'), null);
        }
    } finally {
        page.close();
    }
});

// ── Neighbouring chapters ───────────────────────────────────────────────────

test('a chapter the server did not link to its neighbours gets them from the book\'s list of chapters', async () => {
    const page = await openPage({
        fetch: {
            '/api/library/leaf-refs': { refs: ['Genesis 1:1', 'Genesis 1:2', 'Genesis 2:1', 'Genesis 2', 'Genesis 3'] },
        },
    });
    try {
        const linked = await call(page, 'ensurePayloadAdjacentRefs', { ref: 'Genesis 2', title: 'Genesis', prev: 'Genesis 1', next: 'Genesis 3' });
        assert.equal(page.takeCalls().some((entry) => entry.url.startsWith('/api/library/leaf-refs')), false, 'already linked');
        assert.equal(linked.next, 'Genesis 3');

        const middle = plain(await call(page, 'ensurePayloadAdjacentRefs', { ref: 'Genesis 2:1', title: 'Genesis' }));
        assert.equal(middle.prev, 'Genesis 1');
        assert.equal(middle.next, 'Genesis 3');

        const first = plain(await call(page, 'ensurePayloadAdjacentRefs', { ref: 'Genesis 1', title: 'Genesis' }));
        assert.equal(first.prev, undefined);
        assert.equal(first.next, 'Genesis 2');

        const last = plain(await call(page, 'ensurePayloadAdjacentRefs', { ref: 'Genesis 3', title: 'Genesis', prev: 'Genesis 2' }));
        assert.equal(last.next, undefined);
        assert.equal(last.prev, 'Genesis 2');
    } finally {
        page.close();
    }
});

test('neighbours stay unknown when the list is missing, too short, or does not contain the chapter', async () => {
    const cases = [
        ['no list at all', { status: 500, body: {} }, { ref: 'Genesis 2', title: 'Genesis' }],
        ['a single chapter', { refs: ['Genesis 2'] }, { ref: 'Genesis 2', title: 'Genesis' }],
        ['the same chapter listed twice', { refs: ['Genesis 2:1', 'Genesis 2:2'] }, { ref: 'Genesis 2', title: 'Genesis' }],
        ['a chapter not in the list', { refs: ['Exodus 1', 'Exodus 2'] }, { ref: 'Genesis 2', title: 'Genesis' }],
        ['a payload with no reference', { refs: ['Genesis 1', 'Genesis 2'] }, { title: 'Genesis' }],
        ['a payload with no title or book', { refs: ['Genesis 1', 'Genesis 2'] }, { ref: '2' }],
    ];
    for (const [name, leafRefs, payload] of cases) {
        const page = await openPage({ fetch: { '/api/library/leaf-refs': leafRefs } });
        try {
            const result = plain(await call(page, 'ensurePayloadAdjacentRefs', { ...payload }));
            assert.equal(result.prev, undefined, name);
            assert.equal(result.next, undefined, name);
        } finally {
            page.close();
        }
    }
    const page = await openPage();
    try {
        assert.equal(await call(page, 'ensurePayloadAdjacentRefs', null), null);
        assert.equal(await call(page, 'ensurePayloadAdjacentRefs', 'text'), 'text');
    } finally {
        page.close();
    }
});

test('with no title the book is taken from the reference', async () => {
    const page = await openPage({ fetch: { '/api/library/leaf-refs': { refs: ['Genesis 1', 'Genesis 2', 'Genesis 3'] } } });
    try {
        const result = plain(await call(page, 'ensurePayloadAdjacentRefs', { ref: 'Genesis 2' }));
        assert.deepEqual([result.prev, result.next], ['Genesis 1', 'Genesis 3']);
        const sent = page.takeCalls().find((entry) => entry.url.startsWith('/api/library/leaf-refs'));
        assert.match(sent.url, /title=Genesis&/);
    } finally {
        page.close();
    }
});

// ── Infinite scroll ─────────────────────────────────────────────────────────

const stateOf = (page) => plain(page.eval(`({
    chain: (window.currentTextPayloadChain || []).map((chunk) => chunk.ref),
    next: infiniteReaderState.nextRef,
    prev: infiniteReaderState.prevRef,
    seen: [...infiniteReaderState.seenRefs],
    visible: infiniteReaderState.currentVisibleChunkIndex,
    loading: infiniteReaderState.loading,
    loadingPrev: infiniteReaderState.loadingPrev,
})`));
const chunkCount = (page) => page.$$('.reader-source-clean[data-text-chunk-index]').length;

async function readFrom(first, routes, options = {}) {
    const page = await openPage({ fetch: routes, ...options });
    // Far from the bottom, so reading does not itself pull in the next chapter.
    Object.defineProperty(page.document.documentElement, 'scrollHeight', { configurable: true, value: 100000 });
    await page.eval(`readText(${JSON.stringify(first)}, { skipNavigationGrid: true })`);
    await page.settle();
    page.takeCalls();
    return page;
}

const scrollHeightOf = (page, value) => Object.defineProperty(page.document.documentElement, 'scrollHeight', { configurable: true, value });
const NEAR_BOTTOM = (page) => scrollHeightOf(page, 0);

/** Loads the next chapter once: near the bottom while it starts, far again by the time it lands. */
async function loadNextOnce(page) {
    NEAR_BOTTOM(page);
    const pending = page.eval('loadNextTextChunk()');
    scrollHeightOf(page, 100000);
    await pending;
}

test('near the bottom the next chapter is appended, and the one after it is queued', async () => {
    const page = await readFrom('Genesis 2', {
        [textUrl('Genesis 2')]: chapter(2, { prev: 'Genesis 1', next: 'Genesis 3' }),
        [textUrl('Genesis 3')]: chapter(3, { prev: 'Genesis 2', next: 'Genesis 4' }),
    });
    try {
        assert.deepEqual(stateOf(page).chain, ['Genesis 2']);
        assert.equal(stateOf(page).next, 'Genesis 3');
        assert.equal(call(page, 'shouldLoadNextTextChunk'), false, 'far from the bottom: not yet');

        NEAR_BOTTOM(page);
        assert.equal(call(page, 'shouldLoadNextTextChunk'), true);
        const pending = page.eval('loadNextTextChunk()');
        assert.match(page.$('#infiniteReaderStatus').innerHTML, /sk-reader-para/, 'a skeleton shows while it loads');
        assert.equal(stateOf(page).loading, true);
        assert.equal(call(page, 'shouldLoadNextTextChunk'), false, 'one load at a time');
        scrollHeightOf(page, 100000);
        await pending;

        const state = stateOf(page);
        assert.deepEqual(state.chain, ['Genesis 2', 'Genesis 3']);
        assert.equal(state.next, 'Genesis 4');
        assert.deepEqual(state.seen, ['genesis2', 'genesis3']);
        assert.equal(state.loading, false);
        assert.equal(chunkCount(page), 2);
        assert.match(page.$('#readerSources').textContent, /verse 3\.2/);
    } finally {
        page.close();
    }
});

test('the last chapter ends the reader with a note instead of another request', async () => {
    const page = await readFrom('Genesis 3', {
        [textUrl('Genesis 3')]: chapter(3, { prev: 'Genesis 2', next: '' }),
    });
    try {
        NEAR_BOTTOM(page);
        assert.equal(call(page, 'shouldLoadNextTextChunk'), false);
        await call(page, 'loadNextTextChunk');
        assert.deepEqual(fetched(page), []);
        assert.equal(call(page, 'infiniteReaderStatusMarkup').includes('End of available sections.'), true);
    } finally {
        page.close();
    }
});

test('the status line under the text names the section that comes next', async () => {
    const page = await readFrom('Genesis 2', {
        [textUrl('Genesis 2')]: chapter(2, { next: 'Genesis 3' }),
    });
    try {
        assert.match(call(page, 'infiniteReaderStatusMarkup'), /Genesis 3<\/span>/);
        page.eval(`appState.currentView = { type: 'home' }`);
        assert.equal(call(page, 'infiniteReaderStatusMarkup'), '');
        assert.equal(call(page, 'shouldLoadNextTextChunk'), false, 'only a text is read on and on');
    } finally {
        page.close();
    }
});

test('a next chapter that fails to load stops the scroll there and says why in the log', async () => {
    const page = await readFrom('Genesis 2', {
        [textUrl('Genesis 2')]: chapter(2, { next: 'Genesis 3' }),
        [textUrl('Genesis 3')]: { error: 'Text not found', error_type: 'not_found' },
    });
    try {
        NEAR_BOTTOM(page);
        await call(page, 'loadNextTextChunk');
        assert.equal(stateOf(page).next, '');
        assert.deepEqual(stateOf(page).chain, ['Genesis 2']);
        assert.ok(page.reliability.some((line) => line.includes('text-next-load-error') && line.includes('Genesis 3')));
    } finally {
        page.close();
    }
});

test('a next chapter that throws is logged, and the reader keeps what it has', async () => {
    const page = await readFrom('Genesis 2', {
        [textUrl('Genesis 2')]: chapter(2, { next: 'Genesis 3' }),
    });
    try {
        NEAR_BOTTOM(page);
        page.eval(`fetchTextPayloadWithFallback = async () => { throw new Error('boom'); }`);
        await call(page, 'loadNextTextChunk');
        assert.equal(stateOf(page).next, '');
        assert.equal(stateOf(page).loading, false);
        assert.ok(page.reliability.some((line) => line.includes('text-next-load-network-error') && line.includes('boom')));
        assert.deepEqual(stateOf(page).chain, ['Genesis 2']);
    } finally {
        page.close();
    }
});

test('a chapter that resolves to one already on the page is not added twice', async () => {
    const page = await readFrom('Genesis 2', {
        [textUrl('Genesis 2')]: chapter(2, { next: 'Genesis 3' }),
        [textUrl('Genesis 3')]: chapter(2, { next: '' }),
    });
    try {
        NEAR_BOTTOM(page);
        await call(page, 'loadNextTextChunk');
        assert.deepEqual(stateOf(page).chain, ['Genesis 2']);
        assert.equal(stateOf(page).next, '');
    } finally {
        page.close();
    }
});

test('the next chapter is taken from the server\'s own answer or looked up in the book\'s chapter list', async () => {
    const page = await readFrom('Genesis 2', {
        [textUrl('Genesis 2')]: chapter(2, { next: 'Genesis 3' }),
        [textUrl('Genesis 3')]: chapter(3),
        '/api/library/leaf-refs': { refs: ['Genesis 1', 'Genesis 2', 'Genesis 3', 'Genesis 4'] },
    });
    try {
        await loadNextOnce(page);
        assert.deepEqual(stateOf(page).chain, ['Genesis 2', 'Genesis 3']);
        assert.equal(stateOf(page).next, 'Genesis 4', 'the server named none; the list of chapters did');
    } finally {
        page.close();
    }
});

test('scrolling up near the top prepends the previous chapter and keeps the reader on what they were reading', async () => {
    const page = await readFrom('Genesis 2', {
        [textUrl('Genesis 2')]: chapter(2, { prev: 'Genesis 1', next: '' }),
        [textUrl('Genesis 1')]: chapter(1, { prev: '', next: 'Genesis 2' }),
    });
    try {
        assert.equal(stateOf(page).prev, 'Genesis 1');
        await call(page, 'loadPreviousTextChunk');
        const state = stateOf(page);
        assert.deepEqual(state.chain, ['Genesis 1', 'Genesis 2']);
        assert.equal(state.visible, 1, 'the chapter being read is now the second one');
        assert.equal(state.prev, '');
        assert.equal(chunkCount(page), 2);
        assert.deepEqual(plain(page.$$('.reader-source-clean[data-text-chunk-index]').map((el) => el.dataset.textChunkIndex)), ['0', '1']);
    } finally {
        page.close();
    }
});

test('a previous chapter that is already on the page, fails, or throws is dropped quietly', async () => {
    const seen = await readFrom('Genesis 2', { [textUrl('Genesis 2')]: chapter(2, { prev: 'Genesis 1', next: '' }) });
    try {
        seen.eval(`infiniteReaderState.seenRefs.add(getRefTrackingKey('Genesis 1'))`);
        await call(seen, 'loadPreviousTextChunk');
        assert.equal(stateOf(seen).prev, '');
        assert.deepEqual(fetched(seen), []);
    } finally {
        seen.close();
    }

    const failing = await readFrom('Genesis 2', {
        [textUrl('Genesis 2')]: chapter(2, { prev: 'Genesis 1', next: '' }),
        [textUrl('Genesis 1')]: { error: 'Text not found', error_type: 'not_found' },
    });
    try {
        await call(failing, 'loadPreviousTextChunk');
        assert.equal(stateOf(failing).prev, '');
        assert.deepEqual(stateOf(failing).chain, ['Genesis 2']);
        assert.ok(failing.reliability.some((line) => line.includes('text-prev-load-error')));
    } finally {
        failing.close();
    }

    const throwing = await readFrom('Genesis 2', { [textUrl('Genesis 2')]: chapter(2, { prev: 'Genesis 1', next: '' }) });
    try {
        throwing.eval(`fetchTextPayloadWithFallback = async () => { throw new Error('boom'); }`);
        await call(throwing, 'loadPreviousTextChunk');
        assert.equal(stateOf(throwing).prev, '');
        assert.equal(stateOf(throwing).loadingPrev, false);
        assert.ok(throwing.reliability.some((line) => line.includes('text-prev-load-network-error')));
    } finally {
        throwing.close();
    }

    const none = await readFrom('Genesis 2', { [textUrl('Genesis 2')]: chapter(2, { prev: '', next: '' }) });
    try {
        await call(none, 'loadPreviousTextChunk');
        none.eval(`infiniteReaderState.loadingPrev = true; infiniteReaderState.prevRef = 'Genesis 1'`);
        await call(none, 'loadPreviousTextChunk');
        assert.deepEqual(fetched(none), [], 'no previous chapter, or one already loading: nothing asked');
    } finally {
        none.close();
    }
});

test('only an upward scroll near the top asks for the previous chapter', async () => {
    const page = await readFrom('Genesis 2', { [textUrl('Genesis 2')]: chapter(2, { prev: 'Genesis 1', next: '' }) });
    try {
        page.eval(`window.__prevLoads = 0; loadPreviousTextChunk = () => { window.__prevLoads += 1; return Promise.resolve(); }`);
        page.eval(`window.__scroll = 800; Object.defineProperty(window, 'pageYOffset', { configurable: true, get: () => window.__scroll })`);
        page.eval('setupScrollUpListener()');
        const scrollTo = (value) => {
            page.window.__scroll = value;
            page.window.readerScrollUpListenerEl.dispatchEvent(new page.window.Event('scroll'));
        };
        scrollTo(900); // down
        scrollTo(700); // up, but far from the top
        scrollTo(300); // up and near the top
        assert.equal(page.eval('window.__prevLoads'), 1);
        scrollTo(300); // not moving
        scrollTo(350); // down
        assert.equal(page.eval('window.__prevLoads'), 1);
        scrollTo(100); // up again
        assert.equal(page.eval('window.__prevLoads'), 2);

        page.eval(`infiniteReaderState.prevRef = ''`);
        scrollTo(400);
        scrollTo(100);
        assert.equal(page.eval('window.__prevLoads'), 2, 'nothing earlier to load');

        page.eval(`infiniteReaderState.prevRef = 'Genesis 1'; appState.currentView = { type: 'home' }`);
        scrollTo(400);
        scrollTo(100);
        assert.equal(page.eval('window.__prevLoads'), 2, 'not in a text');

        // Rebinding replaces the old listener rather than stacking another.
        page.eval(`appState.currentView = { type: 'text', value: 'Genesis 2' }`);
        page.eval('setupScrollUpListener()');
        scrollTo(500);
        scrollTo(100);
        assert.equal(page.eval('window.__prevLoads'), 3);
    } finally {
        page.close();
    }
});

test('the chapter being read is the first one whose end is still below the reading line', async () => {
    const page = await readFrom('Genesis 2', {
        [textUrl('Genesis 2')]: chapter(2, { prev: 'Genesis 1', next: 'Genesis 3' }),
        [textUrl('Genesis 3')]: chapter(3, { prev: 'Genesis 2', next: '' }),
    });
    try {
        await loadNextOnce(page);
        await page.settle();
        const chunks = page.$$('.reader-source-clean[data-text-chunk-index]');
        assert.equal(chunks.length, 2);
        const place = (bottoms) => chunks.forEach((chunk, i) => { chunk.getBoundingClientRect = () => ({ top: bottoms[i] - 400, bottom: bottoms[i], height: 400 }); });

        place([-20, 700]); // the first has scrolled past; the reader is in the second
        call(page, 'pickVisibleReaderChunk');
        assert.equal(stateOf(page).visible, 1);

        place([300, 700]);
        call(page, 'pickVisibleReaderChunk');
        assert.equal(stateOf(page).visible, 0);

        place([-500, -100]); // everything above: the last one
        call(page, 'pickVisibleReaderChunk');
        assert.equal(stateOf(page).visible, 1);
    } finally {
        page.close();
    }
});

test('the section observer re-measures every chapter whichever one it reports', async () => {
    const page = await readFrom('Genesis 2', {
        [textUrl('Genesis 2')]: chapter(2, { prev: 'Genesis 1', next: 'Genesis 3' }),
        [textUrl('Genesis 3')]: chapter(3, { prev: 'Genesis 2', next: '' }),
    });
    try {
        await loadNextOnce(page);
        await page.settle();
        const chunks = page.$$('.reader-source-clean[data-text-chunk-index]');
        chunks[0].getBoundingClientRect = () => ({ top: -500, bottom: -20, height: 480 });
        chunks[1].getBoundingClientRect = () => ({ top: -20, bottom: 600, height: 620 });

        call(page, 'setupSectionScrollObserver');
        const observer = page.observers.filter((candidate) => candidate.options?.rootMargin === '-8% 0px -35% 0px').at(-1);
        assert.ok(observer, 'an observer was created');
        assert.equal(observer.targets.size, 2);
        observer.callback([]);
        assert.equal(stateOf(page).visible, 1);

        page.$$('.reader-source-clean[data-text-chunk-index]').forEach((chunk) => chunk.remove());
        call(page, 'setupSectionScrollObserver');
        assert.equal(observer.targets.size, 0, 'the old observer is released');
    } finally {
        page.close();
    }
});

test('the reader\'s previous and next buttons step through the chapters on the page, then on to the neighbouring text', async () => {
    const page = await readFrom('Genesis 2', {
        [textUrl('Genesis 2')]: chapter(2, { prev: 'Genesis 1', next: 'Genesis 3' }),
        [textUrl('Genesis 3')]: chapter(3, { prev: 'Genesis 2', next: 'Genesis 4' }),
    });
    try {
        await loadNextOnce(page);
        await page.settle();
        const prev = page.$('#readerPrevTopBarBtn');
        const next = page.$('#readerNextTopBarBtn');

        page.eval('updateReaderButtonsForChunk(0)');
        assert.equal(prev.disabled, false, 'the text before this one is still available');
        assert.equal(prev.style.visibility, 'visible');
        assert.equal(next.disabled, false);

        page.scrolls.length = 0;
        next.onclick();
        const scrolled = page.scrolls.find((entry) => entry[0] === 'scrollIntoView');
        assert.equal(scrolled[1].dataset.textChunkIndex, '1', 'the next chapter on the page');

        page.eval('window.__read = []; readText = (ref, opts) => { window.__read.push([ref, opts]); }');
        page.eval('updateReaderButtonsForChunk(0)');
        prev.onclick();
        assert.deepEqual(plain(page.eval('window.__read')), [['Genesis 1', { skipNavigationGrid: true }]]);

        page.eval('updateReaderButtonsForChunk(1)');
        next.onclick();
        assert.deepEqual(plain(page.eval('window.__read')).at(-1), ['Genesis 4', { skipNavigationGrid: true }]);

        page.eval(`infiniteReaderState.nextRef = ''; updateReaderButtonsForChunk(1)`);
        assert.equal(next.disabled, true);
        assert.equal(next.style.visibility, 'hidden');
        assert.equal(next.onclick, null);
    } finally {
        page.close();
    }
});

test('starting a text seeds the scroll state from it, dropping a previous chapter that is already loaded', async () => {
    const page = await readFrom('Genesis 2', { [textUrl('Genesis 2')]: chapter(2, { prev: 'Genesis 1', next: 'Genesis 3' }) });
    try {
        page.eval(`window.currentTextPayloadChain = [{ ref: 'Genesis 1' }, { ref: 'Genesis 2' }]`);
        page.eval(`resetInfiniteReaderState({ ref: 'Genesis 2', prev: 'Genesis 1', next: 'Genesis 3' })`);
        const state = stateOf(page);
        assert.equal(state.prev, '', 'Genesis 1 is already above');
        assert.equal(state.next, 'Genesis 3');
        assert.deepEqual(state.seen, ['genesis1', 'genesis2']);

        page.eval(`window.currentTextPayloadChain = null`);
        page.eval(`resetInfiniteReaderState({ ref: 'Genesis 5', prev: 'Genesis 4', next: '' })`);
        assert.deepEqual(stateOf(page).seen, ['genesis5']);
        assert.equal(stateOf(page).prev, 'Genesis 4');

        page.eval(`resetInfiniteReaderState(null)`);
        assert.deepEqual(stateOf(page).seen, []);
    } finally {
        page.close();
    }
});
