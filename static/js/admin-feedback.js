// Feedback digest (/admin/feedback). Signs in with Clerk, reads
// GET /api/devtools/feedback-digest with the session token as a Bearer header
// (a plain address-bar visit to that URL cannot send one) and draws the
// summary tiles, two charts and the table from it.
//
// The page ships no data and this script keeps none beyond the tab: a reload
// asks the API again, and the API decides who may read (ADMIN_USER_IDS).
// Everything that reaches the page from the API goes in through
// textContent / createTextNode / DOM properties -- never innerHTML -- because
// a comment is free text written by a reader. A test pins that.
//
// The pure helpers (rows, buckets, filters, CSV) are exported for
// tests_js/admin_feedback.test.js; the DOM part only runs in a browser.
(function (root) {
    'use strict';

    const LIMIT = 200; // backend/routes_devtools.py _FEEDBACK_DIGEST_MAX_LIMIT
    const DEFAULT_PAGE_SIZE = 25;
    const TREND_DAYS = [14, 30];
    const MINUTE = 60 * 1000;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    const FETCH_TIMEOUT_MS = 20000;
    const CLERK_WAIT_MS = 10000;

    const VERDICT_LABEL = { helpful: 'Helpful', not_helpful: 'Not helpful', unknown: 'Unrated' };

    // ── Rows ─────────────────────────────────────────────────────────────

    const text = (value) => (typeof value === 'string' ? value : '');

    function toMillis(value) {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function byNewest(a, b) {
        if (a.ts == null && b.ts == null) return a.index - b.index;
        if (a.ts == null) return 1;
        if (b.ts == null) return -1;
        return b.ts - a.ts || a.index - b.index;
    }

    /** API rows -> the fields the page uses, newest first. Identifiers
     *  (user_id, question_hash, ids) are dropped on purpose: nothing here
     *  needs them, and the CSV should not carry them. */
    function normalizeRows(raw) {
        const list = Array.isArray(raw) ? raw : [];
        return list
            .map((entry, index) => {
                const row = entry && typeof entry === 'object' ? entry : {};
                const ts = toMillis(row.created_at);
                return {
                    index,
                    ts,
                    iso: ts == null ? '' : new Date(ts).toISOString(),
                    verdict: row.verdict === 'helpful' || row.verdict === 'not_helpful' ? row.verdict : 'unknown',
                    comment: text(row.comment).trim(),
                    mode: text(row.mode),
                    language: text(row.language).toLowerCase(),
                    fallback: row.fallback === true,
                    safety: text(row.safety_class),
                    signedIn: Boolean(row.user_id),
                    shared: row.shared_view === true,
                };
            })
            .sort(byNewest);
    }

    function summarize(rows) {
        let helpful = 0;
        let notHelpful = 0;
        let withComment = 0;
        for (const row of rows) {
            if (row.verdict === 'helpful') helpful += 1;
            else if (row.verdict === 'not_helpful') notHelpful += 1;
            if (row.comment) withComment += 1;
        }
        const rated = helpful + notHelpful;
        return {
            total: rows.length,
            helpful,
            notHelpful,
            withComment,
            helpfulPct: rated ? (helpful / rated) * 100 : null,
        };
    }

    function filterRows(rows, { verdict = 'all', query = '' } = {}) {
        const needle = query.trim().toLowerCase();
        return rows.filter((row) => {
            if (verdict !== 'all' && row.verdict !== verdict) return false;
            return !needle || row.comment.toLowerCase().includes(needle);
        });
    }

    /** `rows` arrive newest first; undated rows stay last either way. */
    function sortRows(rows, order) {
        if (order !== 'oldest') return rows.slice();
        return rows.slice().sort((a, b) => {
            if (a.ts == null && b.ts == null) return a.index - b.index;
            if (a.ts == null) return 1;
            if (b.ts == null) return -1;
            return a.ts - b.ts || b.index - a.index;
        });
    }

    // ── Dates ────────────────────────────────────────────────────────────

    const pad = (n) => String(n).padStart(2, '0');

    function localDayKey(ms) {
        const d = new Date(ms);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function formatDay(ms, withYear) {
        const options = withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' };
        return new Intl.DateTimeFormat('en', options).format(ms);
    }

    function formatFull(ms) {
        return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
    }

    /** "just now", "5 min ago", "3 hr ago", "yesterday", "4 days ago", then the date. */
    function relativeTime(ts, now) {
        if (ts == null) return '—';
        const diff = now - ts;
        if (diff < 45 * 1000) return 'just now';
        if (diff < HOUR) return `${Math.max(1, Math.floor(diff / MINUTE))} min ago`;
        if (diff < DAY) return `${Math.floor(diff / HOUR)} hr ago`;
        const days = Math.floor(diff / DAY);
        if (days === 1) return 'yesterday';
        if (days < 7) return `${days} days ago`;
        const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
        return formatDay(ts, !sameYear);
    }

    // ── Charts ───────────────────────────────────────────────────────────

    /** One bucket per local calendar day, oldest first, ending today. */
    function dailyBuckets(rows, days, now) {
        const today = new Date(now);
        const buckets = [];
        const byKey = new Map();
        for (let back = days - 1; back >= 0; back -= 1) {
            const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
            const bucket = { key: localDayKey(date.getTime()), ts: date.getTime(), helpful: 0, notHelpful: 0, total: 0 };
            buckets.push(bucket);
            byKey.set(bucket.key, bucket);
        }
        for (const row of rows) {
            if (row.ts == null) continue;
            const bucket = byKey.get(localDayKey(row.ts));
            if (!bucket) continue;
            if (row.verdict === 'helpful') bucket.helpful += 1;
            else if (row.verdict === 'not_helpful') bucket.notHelpful += 1;
            bucket.total = bucket.helpful + bucket.notHelpful;
        }
        return buckets;
    }

    /** A round axis maximum and step for counts up to `max` (three or four gridlines). */
    function niceScale(max) {
        if (!(max > 0)) return { max: 2, step: 1 };
        const rough = max / 3;
        const magnitude = 10 ** Math.floor(Math.log10(rough));
        const norm = rough / magnitude;
        const factor = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
        const step = Math.max(1, factor * magnitude);
        return { max: Math.ceil(max / step) * step, step };
    }

    /** When the API's row cap hides part of the chart window, say so. */
    function truncationNote(rows, buckets, limit) {
        if (!buckets.length || rows.length < limit) return '';
        const dated = rows.filter((row) => row.ts != null);
        if (!dated.length) return '';
        const oldest = dated[dated.length - 1].ts;
        if (oldest <= buckets[0].ts) return '';
        return `${formatDay(oldest, false)} and earlier days may be incomplete: the digest returns only the latest ${limit} ratings.`;
    }

    // ── CSV ──────────────────────────────────────────────────────────────

    const CSV_COLUMNS = [
        ['Date (UTC)', (row) => row.iso],
        ['Verdict', (row) => row.verdict],
        ['Comment', (row) => row.comment],
        ['Mode', (row) => row.mode],
        ['Language', (row) => row.language],
        ['Source fallback', (row) => (row.fallback ? 'yes' : 'no')],
        ['Safety class', (row) => row.safety],
        ['Reader', (row) => (row.signedIn ? 'signed in' : 'guest')],
        ['Shared link', (row) => (row.shared ? 'yes' : 'no')],
    ];

    /** One quoted CSV field. A value a spreadsheet would run as a formula
     *  (leading = + - @, tab or CR) gets a leading apostrophe, the OWASP
     *  CSV-injection guidance; the comment text is otherwise unchanged. */
    function csvCell(value) {
        let cell = value == null ? '' : String(value);
        if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
        return `"${cell.replace(/"/g, '""')}"`;
    }

    function toCsv(rows) {
        const lines = [CSV_COLUMNS.map(([name]) => csvCell(name)).join(',')];
        for (const row of rows) lines.push(CSV_COLUMNS.map(([, pick]) => csvCell(pick(row))).join(','));
        return lines.join('\r\n') + '\r\n';
    }

    // ── DOM helpers ──────────────────────────────────────────────────────

    function make(doc, tag, className, content) {
        const node = doc.createElement(tag);
        if (className) node.className = className;
        if (content != null) node.textContent = content;
        return node;
    }

    const formatCount = (n) => new Intl.NumberFormat('en').format(n);
    const formatPct = (pct) => `${Math.round(pct)}%`;

    function verdictPill(doc, verdict) {
        const pill = make(doc, 'span', `admin-pill admin-pill--${verdict.replace('_', '-')}`);
        pill.append(make(doc, 'span', 'admin-ico'), doc.createTextNode(VERDICT_LABEL[verdict]));
        pill.firstChild.setAttribute('aria-hidden', 'true');
        return pill;
    }

    function chipList(doc, row) {
        const wrap = make(doc, 'div', 'admin-chips');
        const add = (label) => wrap.append(make(doc, 'span', 'admin-chip', label));
        add(row.signedIn ? 'Signed in' : 'Guest');
        if (row.language) add(row.language.toUpperCase());
        if (row.mode) add(row.mode);
        if (row.fallback) add('Source fallback');
        if (row.safety && row.safety !== 'ok') add(`Safety: ${row.safety}`);
        if (row.shared) add('Shared link');
        return wrap;
    }

    function rowElement(doc, row, now) {
        const tr = doc.createElement('tr');
        tr.setAttribute('role', 'row');

        const dateCell = make(doc, 'td', 'admin-cell-date');
        const time = make(doc, 'time', null, relativeTime(row.ts, now));
        if (row.ts != null) {
            time.dateTime = row.iso;
            time.title = formatFull(row.ts);
            time.dataset.ts = String(row.ts);
        }
        dateCell.append(time);

        const verdictCell = make(doc, 'td', 'admin-cell-verdict');
        verdictCell.append(verdictPill(doc, row.verdict));

        const commentCell = make(doc, 'td', 'admin-cell-comment');
        if (row.comment) {
            const id = `fbComment${row.index}`;
            const body = make(doc, 'p', 'admin-comment', row.comment);
            body.id = id;
            // Readers write in Hebrew too; let each comment set its own direction.
            body.setAttribute('dir', 'auto');
            const toggle = make(doc, 'button', 'admin-link-btn', 'Show more');
            toggle.type = 'button';
            toggle.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-controls', id);
            commentCell.append(body, toggle);
        } else {
            commentCell.append(make(doc, 'span', 'admin-muted', 'No comment'));
        }

        const detailCell = make(doc, 'td', 'admin-cell-details');
        detailCell.append(chipList(doc, row));

        // The phone layout turns rows into grids; explicit roles keep them rows and
        // cells for assistive tech whatever `display` says.
        for (const cell of [dateCell, verdictCell, commentCell, detailCell]) cell.setAttribute('role', 'cell');
        tr.append(dateCell, verdictCell, commentCell, detailCell);
        return tr;
    }

    function renderRows(tbody, rows, now) {
        const doc = tbody.ownerDocument;
        const fragment = doc.createDocumentFragment();
        for (const row of rows) fragment.append(rowElement(doc, row, now));
        tbody.replaceChildren(fragment);
    }

    /** Show "Show more" only on comments the 3-line clamp actually cuts off.
     *  An expanded comment keeps its toggle (it no longer overflows, but the
     *  reader needs the way back). */
    function measureComments(tbody) {
        for (const body of tbody.querySelectorAll('.admin-comment')) {
            const toggle = body.nextElementSibling;
            if (!toggle) continue;
            if (body.classList.contains('is-expanded')) continue;
            toggle.hidden = !(body.scrollHeight > body.clientHeight + 1);
        }
    }

    function toggleComment(toggle) {
        const body = toggle.previousElementSibling;
        if (!body) return;
        const open = body.classList.toggle('is-expanded');
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? 'Show less' : 'Show more';
    }

    function updateRelativeTimes(container, now) {
        for (const time of container.querySelectorAll('time[data-ts]')) {
            time.textContent = relativeTime(Number(time.dataset.ts), now);
        }
    }

    // Verdict split: one 100% bar, two segments, legend that doubles as the direct labels.
    function renderSplit(refs, summary) {
        const doc = refs.bar.ownerDocument;
        const { helpful, notHelpful } = summary;
        const rated = helpful + notHelpful;
        const parts = [
            { seg: refs.segHelpful, count: helpful },
            { seg: refs.segNotHelpful, count: notHelpful },
        ];
        for (const { seg, count } of parts) {
            seg.hidden = count === 0;
            seg.style.flexGrow = String(count);
        }
        const share = (count) => (rated ? formatPct((count / rated) * 100) : '0%');
        refs.bar.setAttribute(
            'aria-label',
            `Verdict split: ${helpful} helpful (${share(helpful)}), ${notHelpful} not helpful (${share(notHelpful)}).`,
        );

        const legend = [
            ['helpful', 'Helpful', helpful],
            ['not-helpful', 'Not helpful', notHelpful],
        ].map(([key, label, count]) => {
            const item = make(doc, 'li', 'admin-legend-item');
            const swatch = make(doc, 'span', `admin-key admin-key--${key}`);
            swatch.setAttribute('aria-hidden', 'true');
            item.append(
                swatch,
                make(doc, 'span', 'admin-legend-label', label),
                make(doc, 'strong', 'admin-legend-value', formatCount(count)),
                make(doc, 'span', 'admin-legend-share', share(count)),
            );
            return item;
        });
        refs.legend.replaceChildren(...legend);

        const rowsFor = [
            ['Helpful', helpful],
            ['Not helpful', notHelpful],
        ].map(([label, count]) => {
            const tr = doc.createElement('tr');
            tr.append(make(doc, 'th', null, label), make(doc, 'td', null, formatCount(count)), make(doc, 'td', null, share(count)));
            tr.firstChild.scope = 'row';
            return tr;
        });
        refs.splitTable.replaceChildren(...rowsFor);
    }

    // Daily trend: stacked columns (helpful at the baseline), a y axis with round
    // ticks and a sparse x axis. Reading values is by pointer/arrow key (one tooltip
    // for the day) or the "View as table" twin -- never by colour alone.
    function renderTrend(refs, buckets, note) {
        const doc = refs.plot.ownerDocument;
        const scale = niceScale(Math.max(0, ...buckets.map((b) => b.total)));

        const ticks = [];
        for (let value = 0; value <= scale.max; value += scale.step) ticks.push(value);
        refs.grid.replaceChildren(
            ...ticks.map((value) => {
                const line = make(doc, 'div', 'admin-gridline');
                line.style.setProperty('--at', `${(value / scale.max) * 100}%`);
                return line;
            }),
        );
        refs.yAxis.replaceChildren(
            ...ticks.map((value) => {
                const label = make(doc, 'span', 'admin-ytick', formatCount(value));
                label.style.setProperty('--at', `${(value / scale.max) * 100}%`);
                return label;
            }),
        );

        const columns = buckets.map((bucket, index) => {
            const col = make(doc, 'div', 'admin-col');
            col.dataset.index = String(index);
            if (bucket.total) {
                const stack = make(doc, 'div', 'admin-stack');
                stack.style.setProperty('--h', `${(bucket.total / scale.max) * 100}%`);
                const segs = [
                    ['helpful', bucket.helpful],
                    ['not-helpful', bucket.notHelpful],
                ].filter(([, count]) => count > 0);
                segs.forEach(([key, count], i) => {
                    const seg = make(doc, 'div', `admin-bar admin-bar--${key}${i === segs.length - 1 ? ' is-top' : ''}`);
                    seg.style.flexGrow = String(count);
                    stack.append(seg);
                });
                col.append(stack);
            }
            return col;
        });
        refs.cols.replaceChildren(...columns);
        renderXAxis(refs, buckets);

        refs.plot.setAttribute(
            'aria-label',
            `Ratings per day for the last ${buckets.length} days, helpful and not helpful stacked. ` +
                'Use the left and right arrow keys to read each day; the table below has the same numbers.',
        );
        refs.note.textContent = note;
        refs.note.hidden = !note;

        const tableRows = buckets
            .slice()
            .reverse()
            .map((bucket) => {
                const tr = doc.createElement('tr');
                const th = make(doc, 'th', null, formatDay(bucket.ts, false));
                th.scope = 'row';
                tr.append(th, make(doc, 'td', null, String(bucket.helpful)), make(doc, 'td', null, String(bucket.notHelpful)), make(doc, 'td', null, String(bucket.total)));
                return tr;
            });
        refs.trendTable.replaceChildren(...tableRows);
    }

    /** Label as many days as fit in ~48px each (first and last always get one). */
    function renderXAxis(refs, buckets) {
        const doc = refs.plot.ownerDocument;
        const width = refs.cols.clientWidth || 320;
        const slot = width / Math.max(1, buckets.length);
        const every = Math.max(1, Math.ceil(52 / slot));
        const last = buckets.length - 1;
        refs.xAxis.replaceChildren(
            ...buckets.map((bucket, index) => {
                const show = (last - index) % every === 0;
                return make(doc, 'span', 'admin-xtick', show ? formatDay(bucket.ts, false) : '');
            }),
        );
    }

    function describeDay(bucket) {
        return `${formatDay(bucket.ts, false)}: ${bucket.helpful} helpful, ${bucket.notHelpful} not helpful`;
    }

    function fillTooltip(refs, bucket) {
        const doc = refs.tip.ownerDocument;
        const row = (key, label, value) => {
            const line = make(doc, 'div', 'admin-tip-row');
            const swatch = make(doc, 'span', `admin-key admin-key--${key}`);
            line.append(swatch, make(doc, 'strong', 'admin-tip-value', String(value)), make(doc, 'span', 'admin-tip-label', label));
            return line;
        };
        refs.tip.replaceChildren(
            make(doc, 'div', 'admin-tip-title', new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(bucket.ts)),
            row('helpful', 'Helpful', bucket.helpful),
            row('not-helpful', 'Not helpful', bucket.notHelpful),
        );
    }

    // ── Page ─────────────────────────────────────────────────────────────

    function init(doc) {
        const $ = (id) => doc.getElementById(id);
        const refs = {
            shell: $('adminShell'),
            status: $('adminStatus'),
            state: $('adminState'),
            stateIcon: $('adminStateIcon'),
            stateTitle: $('adminStateTitle'),
            stateBody: $('adminStateBody'),
            stateActions: $('adminStateActions'),
            content: $('adminContent'),
            loadedAt: $('adminLoadedAt'),
            refresh: $('adminRefresh'),
            download: $('adminDownload'),
            tiles: {
                total: [$('tileTotal'), $('tileTotalNote')],
                helpful: [$('tileHelpful'), $('tileHelpfulNote')],
                notHelpful: [$('tileNotHelpful'), $('tileNotHelpfulNote')],
                rate: [$('tileRate'), $('tileRateNote')],
            },
            split: {
                bar: $('splitBar'),
                segHelpful: $('splitHelpful'),
                segNotHelpful: $('splitNotHelpful'),
                legend: $('splitLegend'),
                splitTable: $('splitTableBody'),
            },
            trend: {
                plot: $('trendPlot'),
                grid: $('trendGrid'),
                cols: $('trendCols'),
                yAxis: $('trendYAxis'),
                xAxis: $('trendXAxis'),
                tip: $('trendTip'),
                live: $('trendLive'),
                note: $('trendNote'),
                trendTable: $('trendTableBody'),
            },
            controls: $('adminControls'),
            tbody: $('adminRows'),
            count: $('adminCount'),
            more: $('adminMore'),
            search: $('adminSearch'),
            pageSize: $('adminPageSize'),
            sortDate: $('adminSortDate'),
            sortHead: $('adminDateHead'),
            tableEmpty: $('adminTableEmpty'),
            tableWrap: $('adminTableWrap'),
        };

        const ui = {
            all: [],
            verdict: 'all',
            query: '',
            order: 'newest',
            pageSize: DEFAULT_PAGE_SIZE,
            visible: DEFAULT_PAGE_SIZE,
            days: 14,
            filtered: [],
            activeDay: -1,
            loading: false,
            loaded: false,
            loadedLabel: '',
        };
        let clock = Date.now();

        const say = (message) => {
            refs.status.textContent = message;
        };

        // ── States ──
        function setView(view) {
            refs.shell.dataset.view = view; // loading | ready | state
            refs.content.hidden = view === 'state';
            refs.state.hidden = view !== 'state';
            refs.content.setAttribute('aria-busy', String(view === 'loading'));
            refs.refresh.disabled = view === 'loading';
            // Filters act on loaded rows; until then they would only blank the skeleton.
            refs.controls.disabled = view !== 'ready';
        }

        function stateAction(label, handler, href) {
            const control = href ? make(doc, 'a', 'admin-btn admin-btn--primary', label) : make(doc, 'button', 'admin-btn admin-btn--primary', label);
            if (href) control.href = href;
            else control.type = 'button';
            if (handler) control.addEventListener('click', handler);
            return control;
        }

        function showState(kind, detail) {
            const copy = {
                'signed-out': ['lock', 'Sign in to see the feedback digest', 'This page is for the Sh’elah operator. Sign in with the operator account and the digest loads right here.'],
                expired: ['lock', 'Your session needs a fresh sign-in', 'The server did not accept the sign-in token. Sign in again to continue.'],
                forbidden: ['lock', 'This account is not on the operator list', 'You are signed in, but this account cannot read feedback. Use the profile menu to sign out and try the operator account. Operator accounts are listed in the ADMIN_USER_IDS setting.'],
                unavailable: ['warning', 'Sign-in is unavailable right now', 'The sign-in service did not load, so the page cannot check who you are. Check your connection and try again.'],
                error: ['warning', 'The digest did not load', detail || 'The request failed. Check your connection and try again.'],
                empty: ['chat', 'No feedback yet', 'When readers tap the thumbs up or thumbs down under an AI answer, their rating and comment will show up here.'],
            }[kind];
            refs.stateIcon.className = `admin-state-icon admin-state-icon--${copy[0]}`;
            refs.stateTitle.textContent = copy[1];
            refs.stateBody.textContent = copy[2];
            const actions = [];
            if (kind === 'signed-out' || kind === 'expired') actions.push(stateAction('Sign in', rememberReturn, '/signin'));
            if (kind === 'unavailable' || kind === 'error') actions.push(stateAction('Try again', retry, null));
            refs.stateActions.replaceChildren(...actions);
            setView('state');
            refs.download.disabled = true;
            say(copy[1]);
        }

        // Retrying from a state card keeps that card (button disabled) until the
        // answer arrives, so keyboard focus is not dropped on <body>; it then moves
        // to the new content or the new card.
        function retry(event) {
            const button = event.currentTarget;
            button.disabled = true;
            button.textContent = 'Trying again\u2026';
            ui.restoreFocus = true;
            load();
        }

        // A failed refresh keeps the page it already drew; only a first load (or a
        // sign-in/permission change) replaces it with a state card.
        function fail(kind, detail) {
            if (ui.loaded && (kind === 'error' || kind === 'unavailable')) {
                refs.loadedAt.textContent = `Could not refresh. Showing ${ui.loadedLabel}`;
                say(detail || 'The digest could not be refreshed.');
                return;
            }
            showState(kind, detail);
        }

        // Same hand-off as the topbar's Sign In (legal_scripts.html): /signin
        // opens the sign-in window over the app and comes back to this page.
        function rememberReturn(event) {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            try {
                root.sessionStorage.setItem('shelah:authReturn', JSON.stringify({ path: root.location.pathname, at: Date.now() }));
            } catch (_) {
                // Storage blocked: closing the window lands on the home page.
            }
            root.location.assign('/signin');
        }

        // ── Data ──
        async function waitForClerk() {
            if (!root.Clerk) return null;
            const deadline = Date.now() + CLERK_WAIT_MS;
            // legal_scripts.html calls Clerk.load() once the page is parsed; wait for
            // it rather than loading a second time.
            while (!root.Clerk.loaded && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            return root.Clerk.loaded ? root.Clerk : null;
        }

        async function fetchDigest(token) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
            try {
                return await root.fetch(`/api/devtools/feedback-digest?limit=${LIMIT}`, {
                    headers: { Authorization: 'Bearer ' + token },
                    cache: 'no-store',
                    signal: controller.signal,
                });
            } finally {
                clearTimeout(timer);
            }
        }

        async function load() {
            if (ui.loading) return;
            ui.loading = true;
            const restoreFocus = ui.restoreFocus;
            ui.restoreFocus = false;
            // A refresh keeps the drawn page in view (dimmed) instead of flashing a skeleton.
            if (ui.loaded) refs.shell.dataset.refreshing = 'true';
            else if (!restoreFocus) setView('loading');
            refs.refresh.disabled = true;
            say('Loading the latest ratings\u2026');
            try {
                const clerk = await waitForClerk();
                if (!clerk) return fail('unavailable');
                if (!clerk.session) return showState('signed-out');
                const token = await clerk.session.getToken();
                if (!token) return showState('signed-out');
                const response = await fetchDigest(token);
                if (response.status === 401) return showState('expired');
                if (response.status === 403) return showState('forbidden');
                if (!response.ok) {
                    const hint = response.status === 503 ? ' The database is not configured on this deployment.' : ' This is usually temporary.';
                    return fail('error', `The server answered with HTTP ${response.status}.${hint}`);
                }
                const data = await response.json();
                ui.all = normalizeRows(data && data.rows);
                ui.loaded = ui.all.length > 0;
                clock = Date.now();
                if (!ui.all.length) return showState('empty');
                setView('ready');
                renderAll();
                refs.download.disabled = false;
                ui.loadedLabel = new Intl.DateTimeFormat('en', { timeStyle: 'short' }).format(clock);
                refs.loadedAt.textContent = `Loaded ${ui.loadedLabel}`;
                say(`Loaded ${ui.all.length} ratings.`);
                if (restoreFocus) refs.content.focus({ preventScroll: true });
            } catch (error) {
                fail('error', error && error.name === 'AbortError' ? 'The request took too long.' : undefined);
            } finally {
                ui.loading = false;
                delete refs.shell.dataset.refreshing;
                refs.refresh.disabled = false;
                const next = refs.stateActions.firstElementChild;
                if (restoreFocus && !refs.state.hidden && next) next.focus();
            }
        }

        // ── Render ──
        function renderTiles(summary) {
            const set = (pair, value, note) => {
                pair[0].textContent = value;
                pair[1].textContent = note;
            };
            set(refs.tiles.total, formatCount(summary.total), `${formatCount(summary.withComment)} with a comment`);
            set(refs.tiles.helpful, formatCount(summary.helpful), 'thumbs up');
            set(refs.tiles.notHelpful, formatCount(summary.notHelpful), 'thumbs down');
            set(
                refs.tiles.rate,
                summary.helpfulPct == null ? '—' : `${summary.helpfulPct.toFixed(1)}%`,
                summary.helpfulPct == null ? 'no ratings yet' : 'of rated answers were helpful',
            );
        }

        function renderCharts() {
            renderSplit(refs.split, summarize(ui.all));
            const buckets = dailyBuckets(ui.all, ui.days, clock);
            ui.buckets = buckets;
            renderTrend(refs.trend, buckets, truncationNote(ui.all, buckets, LIMIT));
            setActiveDay(-1);
        }

        function renderTable() {
            ui.filtered = sortRows(filterRows(ui.all, { verdict: ui.verdict, query: ui.query }), ui.order);
            const shown = ui.filtered.slice(0, ui.visible);
            renderRows(refs.tbody, shown, clock);
            const total = ui.filtered.length;
            refs.tableEmpty.hidden = total > 0;
            refs.count.textContent = total
                ? `Showing ${formatCount(shown.length)} of ${formatCount(total)}${total === ui.all.length ? '' : ` matching (${formatCount(ui.all.length)} loaded)`}`
                : `No ratings match (${formatCount(ui.all.length)} loaded)`;
            const rest = total - shown.length;
            refs.more.hidden = rest <= 0;
            refs.more.textContent = `Show ${formatCount(Math.min(rest, ui.pageSize))} more`;
            refs.sortHead.setAttribute('aria-sort', ui.order === 'newest' ? 'descending' : 'ascending');
            refs.sortDate.dataset.order = ui.order;
            refs.sortDate.setAttribute('aria-label', ui.order === 'newest' ? 'Date, newest first. Sort oldest first.' : 'Date, oldest first. Sort newest first.');
            refs.download.title = `Download the ${formatCount(total)} ${total === 1 ? 'row' : 'rows'} shown by the filters as CSV`;
            measureSoon();
        }

        function renderAll() {
            const summary = summarize(ui.all);
            renderTiles(summary);
            renderFilterCounts(summary);
            renderCharts();
            renderTable();
        }

        function renderFilterCounts(summary) {
            const counts = { all: summary.total, helpful: summary.helpful, not_helpful: summary.notHelpful };
            for (const input of doc.querySelectorAll('input[name="adminVerdict"]')) {
                const badge = input.parentElement.querySelector('.admin-seg-count');
                if (badge) badge.textContent = formatCount(counts[input.value] || 0);
            }
        }

        let measureFrame = 0;
        function measureSoon() {
            if (measureFrame) return;
            measureFrame = root.requestAnimationFrame(() => {
                measureFrame = 0;
                measureComments(refs.tbody);
            });
        }

        // ── Chart interaction ──
        function setActiveDay(index, announce) {
            const { plot, cols, tip, live } = refs.trend;
            const previous = cols.children[ui.activeDay];
            if (previous) previous.classList.remove('is-active');
            ui.activeDay = index;
            const col = cols.children[index];
            if (!col || !ui.buckets || !ui.buckets[index]) {
                tip.hidden = true;
                plot.removeAttribute('aria-activedescendant');
                return;
            }
            col.classList.add('is-active');
            fillTooltip(refs.trend, ui.buckets[index]);
            tip.hidden = false;
            const plotRect = plot.getBoundingClientRect();
            const colRect = col.getBoundingClientRect();
            // Beside the column, not above the plot: above would sit on the card's own
            // controls. Right of the column when it fits, otherwise left.
            const gap = 8;
            const width = tip.offsetWidth;
            const colLeft = colRect.left - plotRect.left;
            const right = colLeft + colRect.width + gap;
            const left = right + width <= plotRect.width ? right : colLeft - gap - width;
            tip.style.setProperty('--tip-x', `${Math.max(0, left)}px`);
            if (announce) live.textContent = describeDay(ui.buckets[index]);
        }

        function dayAt(clientX) {
            const rect = refs.trend.cols.getBoundingClientRect();
            const n = refs.trend.cols.children.length;
            if (!n || !rect.width) return -1;
            return Math.min(n - 1, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * n)));
        }

        const plot = refs.trend.plot;
        plot.addEventListener('pointermove', (event) => setActiveDay(dayAt(event.clientX)));
        plot.addEventListener('pointerdown', (event) => setActiveDay(dayAt(event.clientX)));
        plot.addEventListener('pointerleave', (event) => {
            if (event.pointerType === 'mouse' && doc.activeElement !== plot) setActiveDay(-1);
        });
        plot.addEventListener('focus', () => {
            if (ui.buckets && ui.activeDay < 0) setActiveDay(ui.buckets.length - 1, true);
        });
        plot.addEventListener('blur', () => setActiveDay(-1));
        plot.addEventListener('keydown', (event) => {
            if (!ui.buckets) return;
            const last = ui.buckets.length - 1;
            const from = ui.activeDay < 0 ? last : ui.activeDay;
            const next = { ArrowLeft: from - 1, ArrowRight: from + 1, Home: 0, End: last }[event.key];
            if (next == null) return;
            event.preventDefault();
            setActiveDay(Math.min(last, Math.max(0, next)), true);
        });
        doc.addEventListener('pointerdown', (event) => {
            if (event.pointerType !== 'mouse' && !plot.contains(event.target)) setActiveDay(-1);
        });

        for (const radio of doc.querySelectorAll('input[name="adminTrendDays"]')) {
            radio.addEventListener('change', () => {
                if (!radio.checked) return;
                ui.days = Number(radio.value);
                if (ui.loaded && !refs.content.hidden) renderCharts();
            });
        }
        if (root.ResizeObserver) {
            let resizeFrame = 0;
            new root.ResizeObserver(() => {
                if (resizeFrame || !ui.buckets) return;
                resizeFrame = root.requestAnimationFrame(() => {
                    resizeFrame = 0;
                    renderXAxis(refs.trend, ui.buckets);
                    measureComments(refs.tbody);
                });
            }).observe(plot);
        }

        // ── Table controls ──
        for (const radio of doc.querySelectorAll('input[name="adminVerdict"]')) {
            radio.addEventListener('change', () => {
                if (!radio.checked) return;
                ui.verdict = radio.value;
                ui.visible = ui.pageSize;
                renderTable();
            });
        }
        let searchTimer = 0;
        refs.search.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                ui.query = refs.search.value;
                ui.visible = ui.pageSize;
                renderTable();
            }, 150);
        });
        refs.pageSize.addEventListener('change', () => {
            ui.pageSize = Number(refs.pageSize.value) || DEFAULT_PAGE_SIZE;
            ui.visible = ui.pageSize;
            renderTable();
        });
        refs.sortDate.addEventListener('click', () => {
            ui.order = ui.order === 'newest' ? 'oldest' : 'newest';
            ui.visible = ui.pageSize;
            renderTable();
        });
        refs.more.addEventListener('click', () => {
            ui.visible += ui.pageSize;
            renderTable();
        });
        refs.tbody.addEventListener('click', (event) => {
            const toggle = event.target.closest('.admin-link-btn');
            if (toggle) toggleComment(toggle);
        });
        refs.refresh.addEventListener('click', () => load());

        refs.download.addEventListener('click', () => {
            if (!ui.filtered.length) return;
            const blob = new root.Blob(['\ufeff', toCsv(ui.filtered)], { type: 'text/csv;charset=utf-8' });
            const url = root.URL.createObjectURL(blob);
            const link = make(doc, 'a');
            link.href = url;
            link.download = `shelah-feedback-${localDayKey(Date.now())}.csv`;
            doc.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => root.URL.revokeObjectURL(url), 1000);
            say(`Downloaded ${ui.filtered.length} ${ui.filtered.length === 1 ? 'row' : 'rows'} as CSV.`);
        });

        // Relative times drift while the tab sits open.
        setInterval(() => {
            if (doc.hidden || !ui.loaded) return;
            updateRelativeTimes(refs.tbody, Date.now());
        }, MINUTE);

        load();
    }

    const api = {
        LIMIT,
        TREND_DAYS,
        normalizeRows,
        summarize,
        filterRows,
        sortRows,
        dailyBuckets,
        niceScale,
        truncationNote,
        relativeTime,
        csvCell,
        toCsv,
        renderRows,
        renderSplit,
        renderTrend,
        measureComments,
        toggleComment,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.ShelahAdminFeedback = api;
        if (root.document.readyState === 'loading') {
            root.document.addEventListener('DOMContentLoaded', () => init(root.document));
        } else {
            init(root.document);
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
