/**
 * /admin/feedback (static/js/admin-feedback.js).
 *
 * Two layers. The pure helpers (rows, filters, day buckets, axis scale, CSV) are
 * required straight from the file. The page itself runs in jsdom against the
 * markup of templates/admin_feedback.html -- read from the template, with its
 * two Jinja constructs (icon macro calls, the skeleton-row loop) taken out -- so
 * the ids the script reaches for are the real ones and a renamed id fails here.
 *
 * Faked: `fetch` (the digest endpoint) and `window.Clerk`. Nothing leaves the
 * process; no credentials are involved.
 */
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { JSDOM, VirtualConsole } = require('jsdom');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'static', 'js', 'admin-feedback.js');
const TEMPLATE_PATH = path.join(REPO_ROOT, 'templates', 'admin_feedback.html');
const api = require(SCRIPT_PATH);

const NOW = Date.UTC(2026, 9, 17, 15, 30);
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const row = (over = {}) => ({
    created_at: new Date(NOW - HOUR).toISOString(),
    verdict: 'helpful',
    comment: '',
    mode: 'ask',
    language: 'en',
    fallback: false,
    safety_class: 'ok',
    user_id: 'user_x',
    shared_view: false,
    ...over,
});

// ── Pure helpers ───────────────────────────────────────────────────────

test('normalizeRows drops identifiers, sorts newest first and keeps undated rows last', () => {
    const rows = api.normalizeRows([
        row({ created_at: new Date(NOW - 2 * DAY).toISOString(), comment: 'older' }),
        row({ created_at: 'not a date', comment: 'undated' }),
        row({ created_at: new Date(NOW - HOUR).toISOString(), comment: 'newer', user_id: null }),
        null,
        'junk',
    ]);
    assert.deepEqual(rows.map((r) => r.comment).slice(0, 3), ['newer', 'older', 'undated']);
    assert.equal(rows.at(-1).ts, null);
    assert.equal(rows[0].signedIn, false);
    assert.equal(rows[1].signedIn, true);
    for (const r of rows) {
        assert.equal('user_id' in r, false);
        assert.equal('question_hash' in r, false);
    }
    assert.deepEqual(api.normalizeRows(undefined), []);
    assert.deepEqual(api.normalizeRows({ rows: [] }), []);
});

test('an unknown verdict is kept as unrated, not counted as either side', () => {
    const rows = api.normalizeRows([row({ verdict: 'helpful' }), row({ verdict: 'maybe' }), row({ verdict: 'not_helpful' })]);
    const summary = api.summarize(rows);
    assert.equal(summary.total, 3);
    assert.equal(summary.helpful, 1);
    assert.equal(summary.notHelpful, 1);
    assert.equal(summary.helpfulPct, 50);
    assert.equal(api.summarize([]).helpfulPct, null);
    assert.equal(api.summarize(api.normalizeRows([row({ verdict: 'maybe' })])).helpfulPct, null);
});

test('filterRows matches the verdict and the comment text, case-insensitively', () => {
    const rows = api.normalizeRows([
        row({ verdict: 'helpful', comment: 'Great sources' }),
        row({ verdict: 'not_helpful', comment: 'Wrong SOURCE cited' }),
        row({ verdict: 'not_helpful', comment: '' }),
    ]);
    assert.equal(api.filterRows(rows, { verdict: 'all', query: '' }).length, 3);
    assert.equal(api.filterRows(rows, { verdict: 'not_helpful' }).length, 2);
    assert.equal(api.filterRows(rows, { verdict: 'all', query: '  source ' }).length, 2);
    assert.equal(api.filterRows(rows, { verdict: 'helpful', query: 'wrong' }).length, 0);
});

test('sortRows reverses the order without mutating its input and keeps undated rows last', () => {
    const rows = api.normalizeRows([
        row({ created_at: new Date(NOW - 3 * DAY).toISOString(), comment: 'c' }),
        row({ created_at: new Date(NOW - DAY).toISOString(), comment: 'a' }),
        row({ created_at: 'x', comment: 'z' }),
    ]);
    const before = rows.map((r) => r.comment);
    assert.deepEqual(api.sortRows(rows, 'oldest').map((r) => r.comment), ['c', 'a', 'z']);
    assert.deepEqual(api.sortRows(rows, 'newest').map((r) => r.comment), ['a', 'c', 'z']);
    assert.deepEqual(rows.map((r) => r.comment), before);
});

test('relativeTime rounds down and falls back to a date after a week', () => {
    const t = (ms) => api.relativeTime(NOW - ms, NOW);
    assert.equal(t(10 * 1000), 'just now');
    assert.equal(t(59 * 60 * 1000), '59 min ago');
    assert.equal(t(60 * 60 * 1000 + 1), '1 hr ago');
    assert.equal(t(23.9 * HOUR), '23 hr ago');
    assert.equal(t(DAY + HOUR), 'yesterday');
    assert.equal(t(3 * DAY), '3 days ago');
    assert.match(t(20 * DAY), /^[A-Z][a-z]{2} \d{1,2}$/);
    assert.match(t(400 * DAY), /\d{4}$/);
    assert.equal(api.relativeTime(null, NOW), '—');
});

test('dailyBuckets covers N local days ending today and counts each side', () => {
    const rows = api.normalizeRows([
        row({ created_at: new Date(NOW - HOUR).toISOString(), verdict: 'helpful' }),
        row({ created_at: new Date(NOW - HOUR).toISOString(), verdict: 'not_helpful' }),
        row({ created_at: new Date(NOW - 2 * DAY).toISOString(), verdict: 'helpful' }),
        row({ created_at: new Date(NOW - 40 * DAY).toISOString(), verdict: 'helpful' }),
        row({ created_at: 'bad' }),
    ]);
    const buckets = api.dailyBuckets(rows, 14, NOW);
    assert.equal(buckets.length, 14);
    assert.ok(buckets[0].ts < buckets[13].ts);
    assert.equal(buckets.reduce((sum, b) => sum + b.total, 0), 3);
    assert.equal(buckets.at(-1).helpful, 1);
    assert.equal(buckets.at(-1).notHelpful, 1);
    assert.equal(buckets.at(-1).total, 2);
    assert.equal(api.dailyBuckets(rows, 30, NOW).reduce((sum, b) => sum + b.total, 0), 3);
});

test('niceScale picks round maxima that always contain the data', () => {
    assert.deepEqual(api.niceScale(0), { max: 2, step: 1 });
    for (const max of [1, 2, 3, 7, 9, 10, 11, 23, 48, 99, 130, 1234]) {
        const scale = api.niceScale(max);
        assert.ok(scale.max >= max, `${max} fits under ${scale.max}`);
        assert.equal(scale.max % scale.step, 0);
        assert.ok(scale.max / scale.step <= 6, `${max}: few gridlines`);
    }
    assert.deepEqual(api.niceScale(9), { max: 10, step: 5 });
    assert.deepEqual(api.niceScale(12), { max: 15, step: 5 });
});

test('truncationNote only speaks when the row cap hides part of the window', () => {
    const rows = api.normalizeRows(Array.from({ length: 200 }, (_, i) => row({ created_at: new Date(NOW - i * HOUR).toISOString() })));
    const buckets = api.dailyBuckets(rows, 30, NOW);
    assert.match(api.truncationNote(rows, buckets, 200), /may be incomplete.*latest 200 ratings/);
    assert.equal(api.truncationNote(rows.slice(0, 50), buckets, 200), '');
    const wide = api.normalizeRows(Array.from({ length: 200 }, (_, i) => row({ created_at: new Date(NOW - i * 30 * DAY).toISOString() })));
    assert.equal(api.truncationNote(wide, api.dailyBuckets(wide, 14, NOW), 200), '');
    assert.equal(api.truncationNote([], buckets, 200), '');
});

test('csvCell quotes, doubles quotes and neutralises spreadsheet formulas', () => {
    assert.equal(api.csvCell('plain'), '"plain"');
    assert.equal(api.csvCell('say "hi", ok'), '"say ""hi"", ok"');
    assert.equal(api.csvCell('line\nbreak'), '"line\nbreak"');
    for (const danger of ['=1+1', '+SUM(A1)', '-2', '@cmd', '\tx', '\rx']) {
        assert.ok(api.csvCell(danger).startsWith('"\''), `${JSON.stringify(danger)} gets a leading apostrophe`);
    }
    assert.equal(api.csvCell('a=b'), '"a=b"');
    assert.equal(api.csvCell(null), '""');
    assert.equal(api.csvCell(12), '"12"');
});

test('toCsv writes a header, CRLF line ends and one line per row', () => {
    const rows = api.normalizeRows([row({ comment: '=HYPERLINK("x")', verdict: 'not_helpful', fallback: true, shared_view: true, user_id: null })]);
    const csv = api.toCsv(rows);
    const lines = csv.split('\r\n');
    assert.equal(lines.length, 3); // header, one row, trailing newline
    assert.equal(lines[0], '"Date (UTC)","Verdict","Comment","Mode","Language","Source fallback","Safety class","Reader","Shared link"');
    assert.ok(lines[1].includes('"\'=HYPERLINK(""x"")"'));
    assert.ok(lines[1].includes('"not_helpful"'));
    assert.ok(lines[1].endsWith('"yes","ok","guest","yes"'));
    assert.ok(!csv.includes('user_x'));
});

// ── The page, in jsdom ─────────────────────────────────────────────────

function pageMarkup() {
    const html = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>') + '</main>'.length);
    return main.replace(/\{\{[^}]*\}\}/g, '').replace(/\{%[^%]*%\}/g, '');
}

function response(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function settle(window, times = 6) {
    for (let i = 0; i < times; i += 1) await new Promise((resolve) => window.setTimeout(resolve, 0));
}

// A failing assertion must not leave a window (and its minute-long interval)
// open: the test process would then never exit.
const openWindows = new Set();
afterEach(() => {
    for (const window of openWindows) window.close();
    openWindows.clear();
});

/** `digest` is what each successive fetch returns: a Response-like, or a function (url, init) -> one. */
async function openAdmin({ clerk = 'signed-in', digest = [], token = 'tok_test' } = {}) {
    const virtualConsole = new VirtualConsole();
    const dom = new JSDOM(`<!doctype html><html lang="en"><body>${pageMarkup()}</body></html>`, {
        url: 'https://shelah.test/admin/feedback',
        runScripts: 'outside-only',
        pretendToBeVisual: true,
        virtualConsole,
    });
    const { window } = dom;
    openWindows.add(window);
    const calls = [];
    const queue = Array.isArray(digest) ? digest.slice() : [digest];
    window.fetch = async (url, init) => {
        calls.push({ url, init });
        const next = queue.length > 1 ? queue.shift() : queue[0];
        return typeof next === 'function' ? next(url, init) : next;
    };
    if (clerk !== 'absent') {
        window.Clerk = {
            loaded: true,
            session: clerk === 'signed-in' ? { getToken: async () => token } : null,
        };
    }
    const blobs = [];
    const downloads = [];
    window.URL.createObjectURL = (blob) => {
        blobs.push(blob);
        return 'blob:test';
    };
    window.URL.revokeObjectURL = () => {};
    // The page clicks a throwaway <a download> and removes it; keep what it asked for.
    window.HTMLAnchorElement.prototype.click = function click() {
        downloads.push(this.download);
    };
    new vm.Script(fs.readFileSync(SCRIPT_PATH, 'utf8'), { filename: pathToFileURL(SCRIPT_PATH).href }).runInContext(
        dom.getInternalVMContext(),
    );
    await settle(window);
    const doc = window.document;
    const page = {
        window,
        doc,
        calls,
        blobs,
        downloads,
        $: (id) => doc.getElementById(id),
        shell: doc.getElementById('adminShell'),
        text: (id) => doc.getElementById(id).textContent,
        rows: () => [...doc.querySelectorAll('#adminRows tr')],
        async check(selector) {
            const input = doc.querySelector(selector);
            input.checked = true;
            input.dispatchEvent(new window.Event('change', { bubbles: true }));
            await settle(window);
        },
        async click(selector) {
            doc.querySelector(selector).click();
            await settle(window);
        },
        close: () => window.close(),
    };
    return page;
}

const many = (count, make) => Array.from({ length: count }, (_, i) => make(i));

test('without Clerk the page says sign-in is unavailable and offers a retry', async () => {
    const page = await openAdmin({ clerk: 'absent' });
    assert.equal(page.shell.dataset.view, 'state');
    assert.equal(page.text('adminStateTitle'), 'Sign-in is unavailable right now');
    assert.equal(page.$('adminState').hidden, false);
    assert.equal(page.$('adminContent').hidden, true);
    assert.equal(page.$('adminStateActions').querySelector('button').textContent, 'Try again');
    assert.equal(page.$('adminDownload').disabled, true);
    assert.equal(page.calls.length, 0, 'no request without a token');
    page.close();
});

test('signed out: a Sign in link to /signin, and the API is never called', async () => {
    const page = await openAdmin({ clerk: 'signed-out' });
    assert.equal(page.text('adminStateTitle'), 'Sign in to see the feedback digest');
    const link = page.$('adminStateActions').querySelector('a');
    assert.equal(link.getAttribute('href'), '/signin');
    assert.equal(page.calls.length, 0);
    assert.match(page.text('adminStatus'), /Sign in to see/);
    page.close();
});

test('the digest is requested with the Clerk token as a Bearer header, never in the URL', async () => {
    const page = await openAdmin({ digest: response(200, { rows: [row()] }), token: 'tok_secret' });
    assert.equal(page.calls.length, 1);
    const { url, init } = page.calls[0];
    assert.equal(url, '/api/devtools/feedback-digest?limit=200');
    assert.ok(!url.includes('tok_secret'));
    assert.equal(init.headers.Authorization, 'Bearer tok_secret');
    assert.equal(init.cache, 'no-store');
    page.close();
});

test('403 says the account is not on the operator list; 401 asks for a fresh sign-in', async () => {
    let page = await openAdmin({ digest: response(403, { error: 'Forbidden' }) });
    assert.equal(page.text('adminStateTitle'), 'This account is not on the operator list');
    assert.equal(page.$('adminStateActions').children.length, 0, 'nothing to retry');
    assert.equal(page.$('adminContent').hidden, true);
    page.close();
    page = await openAdmin({ digest: response(401, {}) });
    assert.equal(page.text('adminStateTitle'), 'Your session needs a fresh sign-in');
    assert.equal(page.$('adminStateActions').querySelector('a').getAttribute('href'), '/signin');
    page.close();
});

test('a server error explains itself, and Try again recovers into the page with focus on the content', async () => {
    const page = await openAdmin({ digest: [response(503, {}), response(200, { rows: [row({ comment: 'fine' })] })] });
    assert.equal(page.text('adminStateTitle'), 'The digest did not load');
    assert.match(page.text('adminStateBody'), /HTTP 503.*database is not configured/);
    page.doc.querySelector('#adminStateActions button').focus();
    await page.click('#adminStateActions button');
    assert.equal(page.shell.dataset.view, 'ready');
    assert.equal(page.$('adminState').hidden, true);
    assert.equal(page.doc.activeElement, page.$('adminContent'), 'focus moves to the loaded content');
    assert.equal(page.rows().length, 1);
    page.close();
});

test('a network failure and a timeout are reported, not left spinning', async () => {
    const page = await openAdmin({
        digest: () => {
            throw new Error('offline');
        },
    });
    assert.equal(page.text('adminStateTitle'), 'The digest did not load');
    assert.equal(page.$('adminRefresh').disabled, false);
    page.close();
});

test('no ratings yet is a calm empty state, not an error', async () => {
    const page = await openAdmin({ digest: response(200, { count: 0, rows: [] }) });
    assert.equal(page.text('adminStateTitle'), 'No feedback yet');
    assert.match(page.text('adminStateBody'), /thumbs up or thumbs down/);
    assert.equal(page.$('adminStateActions').children.length, 0);
    page.close();
});

test('loaded rows fill the tiles, the split, the trend and the table', async () => {
    const rows = [
        ...many(6, (i) => row({ created_at: new Date(NOW - (i + 1) * HOUR).toISOString(), verdict: 'helpful', comment: `up ${i}` })),
        ...many(2, (i) => row({ created_at: new Date(Date.now() - (i + 1) * HOUR).toISOString(), verdict: 'not_helpful', comment: `down ${i}`, user_id: null })),
    ];
    const page = await openAdmin({ digest: response(200, { rows }) });
    assert.equal(page.shell.dataset.view, 'ready');
    assert.equal(page.$('adminContent').getAttribute('aria-busy'), 'false');
    assert.equal(page.text('tileTotal'), '8');
    assert.equal(page.text('tileHelpful'), '6');
    assert.equal(page.text('tileNotHelpful'), '2');
    assert.equal(page.text('tileRate'), '75.0%');
    assert.match(page.text('tileTotalNote'), /8 with a comment/);
    assert.match(page.$('splitBar').getAttribute('aria-label'), /6 helpful \(75%\), 2 not helpful \(25%\)/);
    assert.equal(page.$('splitLegend').children.length, 2);
    assert.equal(page.$('trendCols').children.length, 14);
    assert.ok(page.$('trendCols').querySelector('.admin-bar--helpful'));
    assert.ok(page.$('trendPlot').getAttribute('aria-label').startsWith('Ratings per day for the last 14 days'));
    assert.equal(page.$('trendTableBody').children.length, 14);
    assert.equal(page.$('splitTableBody').children.length, 2);
    assert.equal(page.rows().length, 8);
    assert.equal(page.text('adminCount'), 'Showing 8 of 8');
    assert.equal(page.$('adminMore').hidden, true);
    assert.equal(page.$('adminControls').disabled, false);
    assert.equal(page.$('adminDownload').disabled, false);
    assert.match(page.text('adminLoadedAt'), /^Loaded /);
    const counts = [...page.doc.querySelectorAll('.admin-seg-count')].map((n) => n.textContent);
    assert.deepEqual(counts, ['8', '6', '2']);
    page.close();
});

test('the filters are disabled while the first load is in flight', async () => {
    let release;
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    const page = await openAdmin({ digest: async () => (await gate, response(200, { rows: [row()] })) });
    assert.equal(page.shell.dataset.view, 'loading');
    assert.equal(page.$('adminControls').disabled, true);
    assert.equal(page.$('adminRefresh').disabled, true);
    assert.ok(page.doc.querySelector('.admin-skel-row'), 'skeleton rows are still there');
    release();
    await settle(page.window);
    assert.equal(page.shell.dataset.view, 'ready');
    assert.equal(page.$('adminControls').disabled, false);
    assert.equal(page.doc.querySelector('.admin-skel-row'), null, 'real rows replace the skeleton');
    page.close();
});

test('a comment is shown as text: markup in it never becomes elements', async () => {
    const evil = '<img src=x onerror="window.pwned=1"><script>window.pwned=2</script><b>bold</b>';
    const page = await openAdmin({ digest: response(200, { rows: [row({ comment: evil })] }) });
    const cell = page.doc.querySelector('#adminRows .admin-comment');
    assert.equal(cell.textContent, evil);
    assert.equal(page.doc.querySelector('#adminRows img, #adminRows script, #adminRows b'), null);
    assert.equal(page.window.pwned, undefined);
    page.close();
});

test('each comment sets its own direction so Hebrew reads right to left', async () => {
    const page = await openAdmin({ digest: response(200, { rows: [row({ comment: 'התשובה הייתה ברורה' })] }) });
    assert.equal(page.doc.querySelector('#adminRows .admin-comment').getAttribute('dir'), 'auto');
    page.close();
});

test('filtering, searching, sorting and paging change the table and the count, not the totals', async () => {
    const rows = [
        ...many(30, (i) => row({ created_at: new Date(NOW - (i + 1) * HOUR).toISOString(), verdict: 'helpful', comment: `ok ${i}` })),
        row({ created_at: new Date(NOW - 40 * HOUR).toISOString(), verdict: 'not_helpful', comment: 'Missing the Rambam source' }),
        row({ created_at: new Date(NOW - 41 * HOUR).toISOString(), verdict: 'not_helpful', comment: '' }),
    ];
    const page = await openAdmin({ digest: response(200, { rows }) });
    assert.equal(page.rows().length, 25);
    assert.equal(page.text('adminCount'), 'Showing 25 of 32');
    assert.equal(page.$('adminMore').hidden, false);
    assert.equal(page.$('adminMore').textContent, 'Show 7 more');

    await page.click('#adminMore');
    assert.equal(page.rows().length, 32);
    assert.equal(page.$('adminMore').hidden, true);

    await page.check('input[name="adminVerdict"][value="not_helpful"]');
    assert.equal(page.rows().length, 2);
    assert.equal(page.text('adminCount'), 'Showing 2 of 2 matching (32 loaded)');
    assert.equal(page.text('tileTotal'), '32', 'the tiles ignore the table filters');
    assert.equal(page.$('trendCols').children.length, 14);

    const search = page.$('adminSearch');
    search.value = 'rambam';
    search.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    await new Promise((resolve) => page.window.setTimeout(resolve, 200));
    assert.equal(page.rows().length, 1);
    assert.equal(page.doc.querySelector('#adminRows .admin-comment').textContent, 'Missing the Rambam source');

    search.value = 'nothing like this';
    search.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    await new Promise((resolve) => page.window.setTimeout(resolve, 200));
    assert.equal(page.rows().length, 0);
    assert.equal(page.$('adminTableEmpty').hidden, false);
    assert.equal(page.text('adminCount'), 'No ratings match (32 loaded)');

    search.value = '';
    search.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    await new Promise((resolve) => page.window.setTimeout(resolve, 200));
    await page.check('input[name="adminVerdict"][value="all"]');
    assert.equal(page.$('adminTableEmpty').hidden, true);

    const firstNewest = page.doc.querySelector('#adminRows time').getAttribute('datetime');
    await page.click('#adminSortDate');
    assert.equal(page.$('adminDateHead').getAttribute('aria-sort'), 'ascending');
    assert.match(page.$('adminSortDate').getAttribute('aria-label'), /oldest first/);
    assert.notEqual(page.doc.querySelector('#adminRows time').getAttribute('datetime'), firstNewest);

    page.$('adminPageSize').value = '50';
    page.$('adminPageSize').dispatchEvent(new page.window.Event('change'));
    await settle(page.window);
    assert.equal(page.rows().length, 32);
    page.close();
});

test('the 14/30 day switch redraws the trend', async () => {
    const page = await openAdmin({ digest: response(200, { rows: [row()] }) });
    assert.equal(page.$('trendCols').children.length, 14);
    await page.check('input[name="adminTrendDays"][value="30"]');
    assert.equal(page.$('trendCols').children.length, 30);
    assert.equal(page.$('trendTableBody').children.length, 30);
    page.close();
});

test('Download CSV hands over exactly the rows the filters show', async () => {
    const rows = [
        row({ verdict: 'helpful', comment: 'good' }),
        row({ verdict: 'not_helpful', comment: '=cmd|"x"' }),
    ];
    const page = await openAdmin({ digest: response(200, { rows }) });
    await page.check('input[name="adminVerdict"][value="not_helpful"]');
    await page.click('#adminDownload');
    assert.equal(page.blobs.length, 1);
    const bytes = new Uint8Array(await page.blobs[0].arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'a UTF-8 byte-order mark, so Excel reads Hebrew right');
    const text = await page.blobs[0].text(); // text() drops the mark
    assert.ok(text.startsWith('"Date (UTC)"'));
    assert.equal(text.trim().split('\r\n').length, 2);
    assert.ok(text.includes(`"'=cmd|""x"""`));
    assert.ok(!text.includes('good'));
    assert.equal(page.downloads.length, 1);
    assert.match(page.downloads[0], /^shelah-feedback-\d{4}-\d{2}-\d{2}\.csv$/);
    assert.equal(page.doc.querySelector('a[download]'), null, 'the throwaway link is removed');
    assert.match(page.text('adminStatus'), /Downloaded 1 row as CSV/);
    page.close();
});

test('a failed refresh keeps the page that is already drawn and says so', async () => {
    const page = await openAdmin({ digest: [response(200, { rows: [row({ comment: 'kept' })] }), response(500, {})] });
    assert.match(page.text('adminLoadedAt'), /^Loaded /);
    await page.click('#adminRefresh');
    assert.equal(page.shell.dataset.view, 'ready');
    assert.equal(page.$('adminState').hidden, true);
    assert.equal(page.rows().length, 1);
    assert.match(page.text('adminLoadedAt'), /^Could not refresh\. Showing \d/);
    assert.match(page.text('adminStatus'), /HTTP 500/);
    assert.equal(page.$('adminRefresh').disabled, false);
    page.close();
});

test('a refresh that finds the account no longer allowed replaces the page with the card', async () => {
    const page = await openAdmin({ digest: [response(200, { rows: [row()] }), response(403, {})] });
    await page.click('#adminRefresh');
    assert.equal(page.shell.dataset.view, 'state');
    assert.equal(page.text('adminStateTitle'), 'This account is not on the operator list');
    assert.equal(page.$('adminDownload').disabled, true);
    page.close();
});

test('a long comment gets a Show more toggle that expands and collapses it', async () => {
    const page = await openAdmin({ digest: response(200, { rows: [row({ comment: 'word '.repeat(80) })] }) });
    const body = page.doc.querySelector('#adminRows .admin-comment');
    const toggle = body.nextElementSibling;
    assert.equal(toggle.getAttribute('aria-controls'), body.id);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    toggle.hidden = false; // jsdom has no layout, so measureComments cannot decide this; the page does in a browser
    toggle.click();
    assert.equal(body.classList.contains('is-expanded'), true);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(toggle.textContent, 'Show less');
    toggle.click();
    assert.equal(body.classList.contains('is-expanded'), false);
    assert.equal(toggle.textContent, 'Show more');
    page.close();
});

test('the trend can be read with the keyboard, one day at a time', async () => {
    const page = await openAdmin({ digest: response(200, { rows: [row({ created_at: new Date(Date.now() - 2 * HOUR).toISOString() })] }) });
    const plot = page.$('trendPlot');
    plot.focus();
    plot.dispatchEvent(new page.window.FocusEvent('focus'));
    assert.equal(page.$('trendTip').hidden, false);
    assert.match(page.text('trendLive'), /: \d+ helpful, \d+ not helpful$/);
    const before = page.text('trendLive');
    plot.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    assert.notEqual(page.text('trendLive'), before);
    plot.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    assert.ok(page.$('trendCols').children[0].classList.contains('is-active'));
    plot.dispatchEvent(new page.window.FocusEvent('blur'));
    assert.equal(page.$('trendTip').hidden, true);
    page.close();
});
