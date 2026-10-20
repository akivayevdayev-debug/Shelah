# Frontend architecture

**Status (2026-10-02):** a single-page shell, `templates/index.html` (about 2,800 lines of markup) with its classic main script `static/js/shell.js` (about 12,200 lines), plus 31 ES and classic modules under `static/js/`, 16 stylesheets under `static/css/` (plus the legacy `static/style.css`), and a service worker. Sources are served as written, with content-hashed URLs from an import map, unless the committed build in `static/min/` is current for them (§1, "The minified build"), in which case the page ships that instead. Tests: `npm test` runs `node --test tests_js/*.test.js` (31 test files, one per module family).

The shell is migrating, one feature at a time, from its classic main script, `static/js/shell.js` (a deferred file; it was inline in `index.html` until 2026-10-13, ~600 KB of the HTML parsed ahead of the first paint), to modules. `shell.js` still owns the reader, the library tree, view switching and the settings menus; everything newer (conversations, routing, stored answers, the siddur, the calendar detail card, citations) lives in modules.

---

## 1. How the page loads

`templates/index.html` is a Jinja template rendered by `backend/routes_pages.py`. In `<head>`, in order:

1. **No-flash bootstraps** (tiny inline scripts, run before first paint): theme (`data-theme` and `theme-dark` on `<html>`, from `localStorage["Sh'elahPrefs"].theme`, falling back to `prefers-color-scheme`), view transitions (`shelah.viewTransitions`), language and direction (`?lang=`, then the saved preference, then Hebrew by default for an Asia/Jerusalem time zone), a `auth-likely-in` class from the Clerk `__client_uat` cookie, and a `data-cold-view` flag for deep links to a text, prayer, community or history page so the shell shows a skeleton instead of the home grid.
2. **Third-party scripts, each pinned** (SRI hash where the host allows it). `marked` and `DOMPurify` (jsDelivr) are `defer` tags, the Sentry browser bundle is `defer`red, and Cloudflare Turnstile and Vercel Speed Insights load as before. FullCalendar, Clerk (publishable key from the server) and `motion` are **not** tags: a small inline script defines `window.ShelahLibs.load(name)`, which appends the pinned `<script>` (same URL, same SRI hash) the first time something asks, and resolves `true` once the library's global exists or `false` if it could not be loaded. FullCalendar loads when the calendar is about to open (`openCalendarModal`, and the calendar button's hover, focus or touch). Clerk loads at once for a visit that may be signed in (the `auth-likely-in` class, or a path or query that needs the account) and otherwise from `ensureClerk()` when someone reaches for the account (`shell.js` calls it only from user-initiated entry points). Motion loads on the first pointer, key or scroll event, or three seconds after `load`; `motion.js` falls back to instant state changes until then. The CSP that allows exactly these hosts is in `docs/SECURITY.md` §3.
3. **Classic helper scripts** that expose window globals `shell.js` reads: `sentry-init.js`, `topbar_shared.js`, `hebrew-ref.js`, `community-labels.js`, `load-region.js`, `clerk-appearance.js`. `shell.js` itself is a `defer`red classic script, and `actions.js` is `defer`red **after** it (see "Click handlers" below): deferred scripts run in document order, before `DOMContentLoaded`. Jinja values the old inline script interpolated are now data: the Phosphor icon paths are a `<script type="application/json" id="phosphorPaths">` block `shell.js` reads, and `shell.js` is served as a plain file, so it can be cached by its content hash.
4. **The import map** (`module_import_map`, built by `backend/module_versions.py`): each module's plain URL (`/static/js/router.js`) maps to `/static/js/router.js?v=<12-char sha256 of its bytes>`. A changed module is a new URL and an unchanged one keeps its cached copy, so a CDN or service-worker cache can never hand a new `main.js` an old `router.js`. The entry `<script type="module">` tags (`motion.js`, `calendar-detail.js`, `main.js`) use `module_url(name)` for the same URL, so a module that is both an entry and an import runs once. Classic scripts (no top-level `import`/`export`) are not in the map; they carry a hand-bumped `?v=` query instead.

Stylesheets are concatenated in this order (tokens first, always): `tokens.css`, `style.css`, `typography.css`, `reader.css`, `sidebar.css`, `halacha.css`, `prayer.css`, `siddur.css`, `ai.css`, `conversation.css`, `history.css`, `calendar.css`, `calendar-detail.css`, `loading.css`, `tailwind.css`. The legal pages use `legal.css` through `templates/components/legal_*.html`.

### The minified build: `static/min/`

`npm run build:assets` (`scripts/build_assets.mjs`, esbuild) writes `static/min/`, and `npm run build:critical` (`scripts/build_critical_css.mjs`) writes the critical CSS beside it. Both outputs are committed, like `tailwind.css`: Vercel runs no build, so the repository holds what it serves.

| Output | What it is |
|---|---|
| `css/app.css` | Every stylesheet above, concatenated in that order and minified (about 300 KB, 52 KB gzipped) |
| `css/critical-{home,text,app}.css` | The rules the server-rendered first paint of that kind of page uses (80 to 100 KB, 17 to 19 KB gzipped), extracted with scripts blocked over a viewport, theme and language matrix and checked to compute the same styles as the full CSS |
| `js/<name>.js` | Each classic script minified on its own; top-level names stay, they are window globals |
| `js/main.js`, `motion.js`, `calendar-detail.js` and `js/chunks/` | The module entry points with their imports bundled in, shared code in content-hashed chunks (cached immutable); the import map is empty while these are served |
| `manifest.json` | The SHA-256 of every source each output was built from |

`backend/module_versions.py` serves an output only while the manifest still matches the file on disk. An edit to a stylesheet or script therefore never ships a stale minified copy: the page falls back to the originals (`asset_url`, `module_url`, the fallback `<link>` list in `index.html`) until the build is run again. `SHELAH_SOURCE_ASSETS=1` forces the originals. `tests/test_min_assets.py` and the `npm run check:assets` step in CI fail when an output is out of date, and `build:critical` has to be re-run after a change to the stylesheets **or** to the server-rendered markup of a page the critical CSS covers.

The home page (`/`, `/settings`, `/profile`) and the `/text/<ref>` pages inline their critical CSS in a `<style>` and link the bundle with `media="print"`; a capture-phase `load` listener in `<head>` switches it to `all`, so no stylesheet blocks the first paint (a `<noscript>` link covers scriptless visits). `window.ShelahStyles.ready` settles when the bundle has applied (or failed, or after 4 s); `shell.js` waits on it before building markup the critical CSS never saw (a deep-linked view) and before its background fetches, and the daily-study and popular-text regions wait on it so they do not paint unstyled. Other pages inline `critical-app.css`.

Deferred on purpose, to keep the work after the first paint small: the library index (`/api/library/index`) loads when the library `<details>` opens, or on its summary's hover or focus, else after 1.6 s idle; the daily zmanim prewarm waits for the first pointer, key, touch or scroll (12 s at most); the service worker registers 3 s after `load`; the idle holiday prefetch and the heartbeat are gone.

Every first-party stylesheet and classic script is requested as `{{ asset_url('css/reader.css') }}` (`backend/module_versions.py`), which renders `/static/css/reader.css?v=<12-char sha256 of the file's bytes>`. There is no version string to bump: an edited file is a new URL on the next render. A `/static` URL whose `v` is such a hash is served `Cache-Control: public, max-age=31536000, immutable` (`apply_response_cache_policy` in `app.py`); a hand-written or missing `v` keeps the 5-minute TTL, as do images and HTML. Fonts under `/static/fonts/` are cached for 30 days (they are named in CSS, so they carry no hash: ship a changed font under a new file name). Do not write `?v=` by hand in a template.

### Click handlers

There are no inline event-handler attributes: the Content-Security-Policy forbids them (`script-src-attr 'none'`, `docs/SECURITY.md` §3), and `tests/test_inline_handlers.py` fails the build on one. A button that calls a global function says so with data attributes:

```html
<button type="button" data-onclick="readText" data-onclick-arg="Genesis 1">
<button type="button" data-onclick="goHome">
<input data-oninput="handlePrivacyDeleteConfirmInput">
```

For an argument built from text at runtime, write it with `encodeURIComponent()` and add `data-onclick-encoding="uri"`; the dispatcher decodes it. HTML built in a JS template string follows the same rules. To make a new function callable this way, add its name to `ACTIONS` in `static/js/actions.js` (sorted; the list is a security boundary, and a test fails on a name that is not used or not defined). Code that wants a different target later changes the attribute, as `loadParashaQuickLink` does with `data-onclick-arg`; assigning `el.onclick = ...` on such an element would run both.

`actions.js` loads after `shell.js` on purpose (both `defer`red, so document order decides). Its listener is a capture-phase listener on `document`, and those run in registration order; `shell.js` registers the one that records the clicked control, which `markTriggerPending` reads, and an inline `onclick` always ran after every capture listener. The legal pages load it from `components/legal_scripts.html`.

### Page zones in `index.html`

| Zone | Element | Notes |
|---|---|---|
| Library navigation | `#leftSidebar` | Text tree, siddur contents, community list |
| Main content | `#mainContainer` | `#homeGrid` (home cards), the reader, prayer/community/history pages |
| Commentary panel | `#rightSidebar` | Commentary on the selected passage or, in "reading" mode, the verse in view |
| Ask Sh'elah | `#convPanel` (`data-size` overlay / full / mini, `data-layout` desktop / mobile), `#convSidebar` (the history list: permanent in full, a column beside the chat in the desktop mini widget), `#convResizeBtn` and the two edge strips (mini resize), `#convPip`, `#convHistoryPop`, `#mobileSearchTray`, and `#searchLiveStatus` under the search bar | Owned by `conversation-ui.js` |
| Calendar | FullCalendar overlay, plus one `<dialog id="calDetail">` | Detail card owned by `calendar-detail.js` |

Other templates: `404`, `about`, `acceptable-use`, `accessibility`, `ai-disclosure`, `dmca`, `glossary`, `help`, `licenses`, `privacy`, `terms` (static, server-rendered), and `templates/components/` (`icons.html` Jinja macro, `legal_topbar/footer/scripts`, `site_footer`, `theme_bootstrap`).

---

## 2. Module map: `static/js/`

`main.js` is the one entry point that wires the modules to `shell.js`. It builds explicit `deps` objects from `window.*` in one place (`buildZmanimDeps`, `buildSiddurDeps`) so no module reaches for an undeclared inline global, then assigns the bridge objects in section 3.

### State, routing and bootstrap

| Module | Role |
|---|---|
| `state.js` | Pub/sub store (section 4) |
| `router.js` | Deep-link router: path and query grammar, `readRoute`, `pushRoute`, `pushPath`, `clearRoute`, `closeOverlay`, `installRouter` (popstate). Exposed as `window.ShelahRouter` |
| `main.js` | Imports the modules above, installs the router and conversation UI, exposes the bridges, calls `hydrateRoute(readRoute())` once |
| `load-region.js` (classic) | One loading/failure/retry contract for every async region (section 7). `window.ShelahLoadRegion` |
| `topbar_shared.js`, `hebrew-ref.js`, `community-labels.js` (classic) | Shared topbar helpers (also used by the legal pages), Hebrew numerals and verse-accurate parashah lookup, Hebrew names for the community-customs data |
| `actions.js` (classic) | The click/input dispatcher that replaced inline `onclick=`: reads `data-onclick` / `data-onclick-arg` / `data-onclick-encoding` / `data-oninput`, resolves the name against a closed allowlist, calls the global function. `window.ShelahActions` |
| `sentry-init.js` (classic) | Sentry browser init with the privacy and quota rules (drops ResizeObserver noise, scrubs PII); its `/api/client-errors` companion is in `reader-ui.js` |
| `clerk-appearance.js` (classic) | Builds Clerk's `appearance` from the live tokens for the active theme (Clerk wants concrete colours, not `var(--token)`) |

### Asking questions

| Module | Role |
|---|---|
| `ai-service.js` | `askAi(question, options)`: the canonical `POST /ask` client. 3 attempts, 60 s per attempt, backoff 1200 ms times the attempt number, retrying only 502/503/504 and network `AbortError`/`TypeError`; one auth-header refresh and retry on 401; never retries a 4xx. Asks for `application/x-ndjson` and reports each pipeline step to `options.onProgress`; a server that answers plain JSON is handled the same. Throws an `Error` with `.status`, `.code` (for example `turnstile_required`), `.attempts` |
| `ask-progress.js` | Turns the NDJSON progress lines into a small state object and view; owns no DOM |
| `conversation-entry.js` | Which Ask surface a question opens: signed in uses the multi-turn conversation UI, signed out uses a one-shot `/ask` answer in the same panel, and the composer stays: each follow-up is another `/ask` carrying `history_ids` (see [Guest follow-ups](#guest-follow-ups)) |
| `conversation-api.js` | Network client for `/api/conversations/*`; throws `ConversationApiError` with a `.code` the UI branches on |
| `conversation-store.js` | View-model for one thread: header, transcript, the "sources consulted" disclosure, the sidebar list. Owns no DOM; every surface renders from `getState()` |
| `conversation-ui.js` | Renders the store into `#convPanel` and wires every entry point (topbar Ask button, phone tray, history popover, one-time discovery tip). Exposed as `window.ShelahConversationUI` |
| `conversation-ui-helpers.js` | Pure helpers for the above (no DOM) |
| `conversation-mini.js` | The desktop mini widget's two extras: the history column that opens beside the chat and the resize handles. Created by `conversation-ui.js`, which tells it when the widget is a desktop mini one (`isActive`); see [The mini widget](#the-mini-widget) |
| `source-cards.js` | Pure string builders for source cards, shared by every turn |
| `citation-markers.js`, `citation-popover.js` | The `[n]` chips after a claim, and the card a chip opens (source, one-line note, first lines, open-in-reader or jump to the list row) |
| `answer-link.js`, `answer-share.js` | "Copy link" for a stored answer (owner link `/answer/<id>`) and public share links (`/a/<token>`, `POST …/share`, revoke) |
| `ask-history.js` | The `/history` page (keyset-paged `GET /api/user/history`, searchable) and the shelf's stored-answer entries. `window.ShelahAskHistory` |

#### Guest follow-ups

A signed-out visitor keeps the composer. Their first question is the one-shot `/ask` (`window.handleAiSearch` → `ShelahConversationUI.askFromSearch`); a follow-up is `store.askGuestFollowUp`, another `/ask` that carries `history_ids`, the `history_id` of each earlier answer in the panel (`askAi`'s `historyIds` option). The server owns the limits (`docs/API.md`, "Guest limits"); the client only reflects them:

- Each answer's `meta.guest` (`store.guestUsage`) drives `#convGuestBanner`, the line above the composer. It appears when `GUEST_WARN_AT` (2) questions are left ("2 questions left in this guest conversation. Sign in to keep going."), names the day instead when the day's allowance is what binds, and turns into the limit notice at zero. The wording is `guestBannerText` / `guestCapCopy` in `conversation-ui-helpers.js` (English and Hebrew).
- When the conversation's own allowance is spent, the next send does not reach the network (`guestCapReached`; the day's allowance is left to the server, since it can lift while the panel stays open); if the server refuses anyway (`403` with `code: "guest_cap_reached"`, surfaced by `ai-service.js` as an error carrying `.reason` and `.usage`), the turn is removed from the thread and the typed question goes back into the composer. Either way the native `<dialog id="convGuestCap">` opens (Sign in, Create free account, Not now). Escape and Not now close it and return focus to the composer; the thread stays readable and the question stays typed.
- After signing in mid-thread, `ensureConversation` seeds the account conversation from the latest answer (`fromHistoryId`); the earlier guest turns stay visible above it, but the continued conversation contains only that latest guest answer.
- The dialog is centered by `margin: auto` in `.conv-capdialog`: the page's reset zeroes every margin, which cancels the browser's own centering of a modal dialog, so the rule restates it.

#### Where a question loads

A question's loading cues (the orbiting halo, the status line, the skeleton) appear on the surface it was asked from, and nowhere else. The store records this as `surface` (`"bar"` or `"panel"`, meaningful while `sending`); `conversation-ui.js` renders from it.

- **Asked in the search bar** (`askSurface()` returns `"bar"`: a fresh question, typed in the bar, with the panel shut): the halo around the bar (`body.search-loading`) and the status line under it (`#searchLiveStatus`) carry the wait, and the panel **stays shut** until the answer lands. It then opens on the answer, or on the failed turn with its Retry. Opening the panel meanwhile (or, on a phone, closing the search tray) calls `store.setSurface("panel")` and the cues move with it: the bar's stop, the panel composer's halo and the turn's own status line start.
- **Asked in the panel** (its composer, a retry, a re-ask, a follow-up, or a bar question while the panel is already on screen): the bar is never lit. The panel composer's halo (`.conv-panel[data-sending="true"]`) and the pending turn's status line carry it.
- `conversation-ui.js`'s `render()` is the only code that sets `body.search-loading`; `shell.js` leaves it alone.

The status line says what the AI is doing as the server reports it (`detail` events, `docs/API.md`): "Searching the sources", then "Reading Berakhot 2a and Shabbat 31a", "Checking sunset and nightfall for Shabbat times", "Checking today's Omer count", or the name of a community's customs. A line stays on screen for at least `STATUS_MIN_DWELL_MS` (700 ms) before the next replaces it, so fast steps never flicker. The words, in English and Hebrew, live in `ask-progress.js` (`detailLabel`); a Hebrew page still shows references in their English form.

#### Feedback and the web-search switch

- **Comment control.** `renderFeedbackWidget` (`shell.js`) shows thumbs up, thumbs down and a quiet "Add a comment" button beside them (the `chat-text` Phosphor glyph). A comment on its own is sent as `verdict: "comment"`; a comment after a thumbs-down opens the existing "Send feedback" row; a comment after a thumbs-up keeps the control next to "Thank you". Escape closes the row and returns focus to the button. A rating is fire-and-forget as before; a typed comment is awaited and shows a retryable "Could not send that" line on failure, so the text is never silently lost. The same widget is used under search-bar answers and under conversation-thread replies.
- **Web search switch.** The chat menu (`#convMenu`) has a "Web search" switch (`#convWebSearchSwitch`, `role="switch"`, On/Off text so it never relies on colour). It is the reader's `prefs.webSearch` (default on), saved and synced with the other preferences by `ShelahPrefs.set("webSearch", bool)`. The ask requests carry `web_search: false` only while it is off (`ai-service.js`, `conversation-api.js`); the server's last-resort rules are in [AI_TOOLS.md](AI_TOOLS.md#last-resort-web-lookup). An answer that used the web lists the pages in its sources as `Web: <page>`.

#### The mini widget

On a desktop the mini widget is a small floating chat in one corner (`data-size="mini"`, `data-layout="desktop"`; its corner is `data-corner`, stored physically in `shelah.conv.corner` and mirrored in a right-to-left page). `conversation-mini.js` adds two things to it, **only** at that size and layout: the centred overlay keeps its history popover, the full page keeps its permanent sidebar, and on a phone the history is still the tray popover.

- **History column.** The history button (`aria-expanded`, `aria-controls="convSidebar"`) opens `#convSidebar` as a column on the widget's free side (the side away from its screen corner), so the chat itself never moves. The widget gets wider by `--conv-hist-w`, 0.6 of the chat's width (`MINI_HISTORY_RATIO`), and the column is revealed by a `clip-path` wipe from the chat's edge (220 ms, `--motion-ease-decel`, interruptible: a second press turns it round from where the clip has got to). No width is animated and no content is scaled, so the list text is never squashed. Under reduced motion the column only fades in. Picking a conversation leaves the column open; Escape inside the widget folds it away first (and returns focus to the button); changing size or layout, or closing the panel, folds it away at once.
- **Resize.** A corner handle (`#convResizeBtn`, a real button) and two edge strips on the free edges resize the widget from 300 to 520 px wide and 320 to 720 px tall (`MINI_BOUNDS`), never beyond the window (a 32 px gutter at the sides, 120 px above and below; with the column open the chat plus its column must fit). The widget stays pinned to its corner, so pulling away from the corner grows it, in either direction. Arrow keys on the focused corner handle resize in steps of 24 px, `Home` or a double click puts the default back. The size is written as `--conv-mini-w` / `--conv-mini-h` on the panel (with `data-mini-h="fixed"` once a height is set; before that the height follows the content) and remembered in `shelah.conv.miniSize`. The handles are hidden on touch-first devices (`@media (pointer: coarse)`), where the widget is moved by its header instead.

### Reading

| Module | Role |
|---|---|
| `reader-ui.js` | Global error boundary (posts to `/api/client-errors`), semantic bookmarking (`/api/bookmarks/semantic`), and the reader's small helpers |
| `commentary-preload.js` | Finds the verse at the reading line and preloads its commentary before the reader selects anything. `window.ShelahCommentaryPreload` |
| `siddur.js`, `siddur-reader.js`, `siddur-day.js` | The siddur at `/siddur/<rite>[/<service>[/<section>]]` (section 8) |
| `zmanim.js` | The zman clock and the daily-study prefetch (section 9) |
| `calendar-detail.js` | Apple-style detail card for a calendar day or event: an anchored popover on desktop, a sheet on phones. `window.ShelahCalendarDetail = { open, close, isOpen }` |

### Presentation

| Module | Role |
|---|---|
| `motion.js` | `window.ShelahMotion` (section 6) |
| `icons.js` | Phosphor glyphs for markup built in JS; same set and viewBox as `templates/components/icons.html`. Add a glyph only by copying it from Phosphor, never draw one |

The AI mark (the star, the Ask button, the glow) is custom and is **not** a Phosphor glyph; leave it out of any icon-consistency pass.

---

## 3. Bridges between `shell.js` and the modules

Window globals are the documented seam. Anything `shell.js` needs from a module is exposed in one place:

| Global | Set by | Purpose |
|---|---|---|
| `ShelahModules` | `main.js` | `askAi`, `loadSemanticBookmarks`, `saveSemanticBookmark`, `prewarmDailyStudy`, the zmanim functions, and `getState`/`setState`/`subscribe` |
| `ShelahState` | `state.js` | `getState`, `setState`, `subscribe` (never the raw object) |
| `ShelahRouter` | `router.js` | the router API; `shell.js` calls `pushRoute`/`clearRoute` from its view switches and `main.js` installs `window.hydrateRoute` |
| `ShelahConversationUI` / `ShelahConversationEntry` | `conversation-ui.js` / `conversation-entry.js` | open the panel, choose the Ask surface |
| `ShelahSiddur` | `main.js` (`createSiddur`) | `prepare` / `mount` for the inline `displaySiddur()` |
| `ShelahSourceCards`, `ShelahCommentaryPreload`, `ShelahAskHistory`, `ShelahAnswerLink` | `main.js` | the module APIs `shell.js` calls |
| `ShelahPrefs` | `index.html` | `set('mode' \| 'community', value)`, called by the chat settings menu to save the defaults |
| `ShelahMotion`, `ShelahCalendarDetail`, `ShelahLoadRegion`, `ShelahHebrewRef`, `ShelahClerkAppearance` | their own files | as named |

When the last inline caller of a bridged function is gone, delete its entry rather than leaving it.

---

## 4. State

`state.js` exports `getState()`, `setState(patch)` (deep-merges plain objects, then notifies) and `subscribe(listener)` (returns an unsubscribe function; a throwing listener never breaks the others). The store **is** `window.appState`: `shell.js` builds `appState` first, and `state.js` adopts it when present, otherwise it starts with the small default shape below.

What the modules read and write:

| Key | Description |
|---|---|
| `prefs` | `mode` (`balanced` / `practical` / `sources` / `strict`), `community` (`All` or a community), `readerLayout` (`bilingual` / `bilingual-reverse` / `interleaved` / `english` / `hebrew`), `fontSize`, `lineHeight`, `showLeftSidebar`, `showRightSidebar`, `metadataFilters`, `transliteration`, `showVowels`, `showCantillation`, `compareMode`/`compareRef`, `shulMode` (+ auto-scroll and speed), `theme` (`light` / `dark` / `system`) |
| `ai` | `pending`, `lastResponse`, `lastError` (written by `askAi`) |
| `dailyStudy` | `refs`, `prewarmedAt` |
| `semanticBookmarks` | `items`, `lastUpdatedAt` |
| `currentView`, `shownView` | The page on screen (inline script) |
| `readingState`, `reliability` | Inline-script state |

Preferences persist in `localStorage["Sh'elahPrefs"]` and, when signed in, sync with Supabase through `/api/user/preferences`. Nothing else holds a copy of shared data.

---

## 5. Routing

`router.js` owns the URL. Everything the app writes lives in the **path**; only a shared link's display keys and the history search stay in the query. A path is an optional view followed by tail segments:

```text
view:  /text/<ref>   /prayer/<name>   /community/<name>
       /answer/<uuid>   /a/<share token>   /history
       /siddur/<rite>[/<service>[/<section>]]
tail:  chat/<id|new>          the conversation
       <community>/<mode>     the AI keys, e.g. sefardic/strict
       full | mini            the conversation size (overlay is implicit)
       calendar/<YYYY-MM-DD>  the calendar day
       signin | profile | settings   the account modal
```

For example `/chat/new/all/balanced`, `/answer/<uuid>/sefardic/strict`, `/text/Genesis.1/chat/<uuid>/ashkenaz/sources/mini`.

- **Views** (`VIEW_KEYS`: `text`, `prayer`, `community`, `siddur`, `chat`, `a`, `history`) are mutually exclusive. The **overlay** keys (`date`, `conversation` + `cv`, and the AI keys `minhag` and `mode`) ride on top of whichever view is underneath. **Display keys** (`lang`, `layout`, `vowels`, `taamim`, `translit`, `size`) are modifiers that survive view changes and `clearRoute`. A value outside the allowed set is dropped, never guessed at.
- The server mirrors the grammar in `backend/routes_spa_paths.py`, including the 308 redirects for trailing slashes and legacy query URLs. `docs/API.md` has the route table and the noindex rules.
- `chat`, `a` and `history` are private or per-reader views, so they are never indexed.
- `main.js` calls `installRouter(handler)` (popstate) and then hydrates the URL the page actually loaded with, since `popstate` never fires for it. Back/Forward restores the reader's scroll position per entry.

---

## 6. Theme, tokens and motion

### Theme

The theme is an attribute on `<html>`: `data-theme="light" | "dark"`, with `theme-dark` kept as a class on `<html>` and `<body>` as a migration alias for older selectors. The preference has three values (`light`, `dark`, `system`) and the topbar button cycles them. The inline bootstrap sets the attribute before first paint, and `tokens.css` also carries a `@media (prefers-color-scheme: dark)` block scoped to `:root:not([data-theme="light"])`, so a page with no script still paints in the system theme. Components never hard-code a colour: they reference a token, and the dark values live in one `[data-theme="dark"]` block in `tokens.css`.

### Token layer: `static/css/tokens.css`

The single source of truth, loaded before every other sheet.

| Group | Examples |
|---|---|
| Surfaces | `--surface-0` (page) to `--surface-3` (topbar), `--surface-pill`, `--surface-border`, `--surface-scrim` |
| Ink (text) | `--ink-primary`, `--ink-secondary`, `--ink-heading`, `--ink-on-accent` |
| Accents | `--accent-primary`, `--accent-gold`, `--accent-green`, `--accent-red`, … (gold is for icons and borders, never for body text on light) |
| Controls | `--ctrl-bg`, `--ctrl-border`, `--ctrl-text`, `--ctrl-filled-bg`, … |
| AI | `--ai-surface`, `--ai-border`, `--ai-src-*`, `--ai-warning-*` |
| Loading | `--load-skeleton-base`, `--load-skeleton-highlight`, `--load-skeleton-shimmer` |
| Calendar | `--cal-event-holiday`, `--cal-event-shabbat`, … (kept in step with the backend's Hebcal colour palette) |
| Geometry | `--radius-xs` to `--radius-full`, `--sp-1` to `--sp-12` (a 4 px / 8 px grid), `--shadow-sm/md/lg` |
| Type | `--text-xs` to `--text-3xl` (fluid `clamp()` sizes; these are **sizes**, not colours), `--font-serif` (Cardo), `--font-sans` (Inter), `--font-hebrew` (Ezra SIL) |
| Motion | `--motion-dur-fast/base/slow` (150 / 220 / 400 ms), `--motion-ease-out/spring/decel`, `--motion-stagger` (40 ms), `--motion-dur-view-*`, `--motion-view-shift` |
| Glass | `--glass-bg`, `--glass-edge`, `--glass-shadow` (the translucent surfaces) |

Legacy aliases (`--surface-base`, `--text-main`, `--text-muted`, `--ink`, `--paper`, `--control-*`, …) remain so untouched sheets keep working; new code uses the semantic names above.

Fonts: Ezra SIL is self-hosted (`static/fonts/SILEOT.woff2`, preloaded); Cardo and Inter come from Google Fonts. Size-matched local fallback faces (`Cardo Fallback`, `Ezra SIL Fallback`) keep text from reflowing when the web fonts swap in.

### Motion

Two layers, per `.agents/ENGINEERING_RULES.md`:

1. **CSS keyframes** live in `tokens.css` (`shelah-fade-in`, `-fade-up`, `-scale-in`, `-slide-in-left/right`, `-slide-down-fade`, `-overlay-in`, `-shimmer`, `-spin`, `-dot-bounce`, `-warm-pulse`, `-attention-ping`, `-cite-highlight`, `-view-in`, `-view-out`, `-grow-up`) plus the Ask panel's five (`conv-rise`, `conv-cite-flash`, `conv-citepop-in`, `conv-status-blink`, `conv-status-dot`, which kept their `conv-` names). Feature sheets and inline template styles apply them by name. The rule is no `@keyframes` anywhere but `tokens.css`, and `tests/test_css_keyframes_guard.py` fails the build if one appears elsewhere.
2. **`static/js/motion.js`** (`window.ShelahMotion`) wraps the vanilla motion.dev `animate()` for anything JavaScript mounts, unmounts or moves:

| Helper | Use for |
|---|---|
| `animateIn` / `animateOut` | Mount/unmount fade and slide |
| `staggerIn` | List and grid entrances |
| `springMove`, `springAnimate`, `springValue`, `appleSpring` / `APPLE_SPRING` | Movement with spring physics (velocity hand-off supported) |
| `fadeOpacity`, `crossFade` | Opacity-only tweens, swapping two elements |
| `createPresence` | Manual show/hide lifecycle |
| `slideIn` / `slideOut` / `slideTo` | Drawers and sidebars |
| `present` / `dismiss` | Popovers, cards and sheets that grow from, and fold back into, their trigger |
| `transitionView`, `viewTransitionsOn` | The View Transitions API path for view changes, off unless the `data-view-transitions` flag is on |
| `settleIn` | A 150 ms fade and 3 px rise for text that changes under the reader's eyes (the Ask panel's status line); native WAAPI, restarts instead of stacking |

Spring for movement, tween only for opacity and colour, animate only `transform` and `opacity`. Every helper checks `isMotionReduced()` first. `present` and `dismiss` then keep a 120 ms opacity fade (so something visibly arrived or left) and drop the travel; the others fall back to an instant state change.

`fadeOpacity` starts from the element's computed opacity (`[from, to]`). Motion remembers the last value it animated and would otherwise start a bare target from that, so code that sets `style.opacity` by hand and then fades back in (`swapContent`, `crossFade`) saw "already there" and left the element hidden.

**Reduced motion.** `typography.css` carries the global `prefers-reduced-motion: reduce` fallback (near-zero durations, one iteration, no smooth scroll). Feature sheets (`loading.css`, `ai.css`, …) additionally set `animation: none` so the end state is static, and every skeleton disables its shimmer. The policy is *fewer and gentler, not none*: an entrance that carries meaning (an answer arriving, a section revealed, a dialog opening, the theme changing) keeps a 120 ms linear opacity fade, and travel, scale and looping motion go. `typography.css` is not loaded on the legal pages, so their reduced-motion fades are written as `!important` shorthands with the specificity to win without it.

### Motion spec (the October 2026 pass)

Principles: motion has a named purpose (feedback, spatial consistency, state change, or bridging a jarring swap); entrances run 180–300 ms, feedback 100–200 ms, exits about two thirds of their entrance; ease-out for entrances, springs for movement, tweens only for opacity and colour; nothing scales from 0 (0.95 to 0.98, bars 0.6); 4 to 12 px of travel; transform and opacity only; nothing blocks input; content is visible if the motion layer fails. Hover lifts sit behind `@media (hover: hover) and (pointer: fine)`.

| Surface | What moves | Timing and curve | Reduced motion |
|---|---|---|---|
| Ask panel turns | The user turn and the assistant turn rise 6 px into place (`conv-rise`) | 220 ms, `--motion-ease-decel` | 120 ms opacity |
| Ask panel pending turn | Status line text settles in when the stage changes (`settleIn`); the skeleton shimmers; the status dot blinks | 150 ms; shimmer 1.4 s and blink 2.6 s loop | Text fades only; loops off |
| Ask panel answer | The skeleton is cloned as a ghost (`.conv-ghost`) that cross-fades out over the arriving answer, so the thread does not jump; the answer's parts follow in turn | Ghost 150 ms linear opacity; parts `conv-rise` 220 ms, 40 ms apart (`--motion-stagger`), six steps at most | 120 ms opacity, no stagger |
| Ask panel open / close, menus, dialogs, sheets | `ShelahMotion.present` / `dismiss` presets: `popover` (12 px, 0.98, grows from the trigger), `modal` (18 px, 0.97), `window` (0.985, no travel), `sheet` and `drawer` (slide from the bottom edge on phones) | Springs, 0.14 to 0.42 s settle, exits shorter than entrances | 120 ms opacity |
| Loading halo (search bar and panel composer) | A soft gold-and-blue conic gradient orbits the bar a question was asked from, and only that one (see [Where a question loads](#where-a-question-loads)): `.search-liftoff-underlay` in `#searchForm` while `body.search-loading`, `.conv-halo` in `#convComposer` while `.conv-panel[data-sending="true"]`. One steady opacity (0.6); only the gradient turns (`shelah-halo-orbit`, transform only). It freezes where it is when the answer lands, then fades out | Turn 3 s (`--motion-dur-orbit`), linear; fade 220 ms | No turning: a still ring that fades in and out over 120 ms |
| Mini widget history column | The column is uncovered from the chat's edge by a `clip-path` wipe; its text fades in under it. A second press reverses from the current clip | 220 ms, `--motion-ease-decel`; fade 160 ms | Column fades in over 120 ms, no wipe; closing is immediate |
| Buttons and rows | Press dips to 0.97 (0.985 on wide cards and rows) with the standalone `scale` property, so it composes with any `transform` | `--motion-dur-fast` | No scale |
| Hover lifts (quick links, popular texts, calendar button, sidebar tab, library link, legal accept) | A small lift and its shadow layer's opacity | `--motion-dur-fast` | Not applied on touch (gated) |
| Home, reader, panels | `.view-enter` rises into place when shown | 220 ms decel | Global fallback |
| Theme change | A cross-fade of the whole page through the View Transitions API, scoped by `html[data-vt-theme]` (set by `withThemeFade` in `topbar_shared.js`, so it is separate from the route flag) | 220 ms ease-out | 120 ms opacity |
| Info pages (about, help, accessibility, AI disclosure) | Blocks below the fold rise 8 px and fade in once, on first sight (`data-reveal` on the `<article>`, `reveal.js`); blocks arriving together follow 40 ms apart, three steps at most | 220 ms decel | 120 ms opacity |
| `/admin/feedback` first data | The four tiles fade up 40 ms apart, the split and the grid fade in, the 13 to 30 trend bars grow from their baseline (`shelah-grow-up`, from 0.6) with at most 320 ms of spread; held by `data-enter` for 800 ms | 220 ms | 120 ms opacity, no delay |
| `/admin/feedback` redraws | Rows fade from 0.4 to 1 on a verdict, sort or page-size change; a refresh only dims the content to 0.6 | 150 ms | Row fade only |

**Do not animate.** The Ask button and the AI mark (the star, its hover glow and `shelah-warm-pulse` are deliberately custom). The terms, privacy and licences pages (people search and skim them; text still fading in cannot be read). Text and prayer bodies, the reader's verse rows, anything the user is reading or acting on. Keyboard-initiated focus moves and shortcuts. The route-change View Transition stays behind its flag (`VIEW_TRANSITIONS`) and off. Home keeps its existing mount cascade, with no scroll reveal added on top.

**Checking motion.** In a browser, `document.documentElement.getAnimations({ subtree: true })` lists every running animation with its target, duration and easing (the `::view-transition-*` pseudo-elements appear too). Sample it a few tens of milliseconds after the trigger; a pane that is not in front throttles frames, so a headless run is the reliable one. Check once with 4x CPU throttling at 375 px and once with `prefers-reduced-motion: reduce`.

---

## 7. Loading, failure and recovery

`load-region.js` is the one contract for every async region (audit L-8):

- **Busy:** `aria-busy="true"` on the region plus a separate `role="status"` line ("Loading…" / "Loaded"), because `aria-busy` alone announces nothing.
- **Failed:** a `role="alert"` message with a focusable Retry button, or none when retrying cannot help (a text that does not exist), plus any actions the caller adds ("Back to prayers", "Search for …").
- **Recovery:** automatic retries after 2 s and 6 s, then manual only; one more when the connection returns; aging data can revalidate when the tab becomes visible.
- **Cancellation:** one `AbortController` per region; a new load, or `abortRegion()`, aborts the old one and clears every timer and listener it left.

Skeletons match the final layout's shape so nothing shifts when data arrives. Offline, the service worker answers from cache and falls back to `/static/offline.html` for a navigation it cannot serve.

---

## 8. The siddur

The checked-in Edot HaMizrach siddur (`data/siddur/`, built by `scripts/build_siddur.py`, served by `/api/siddur/v2/*` in `backend/routes_siddur.py`). `main.js` builds `window.ShelahSiddur = createSiddur({ deps })`; the inline `displaySiddur()` calls its `prepare(value)` / `mount(container, prepared)` pair, so a route change that arrives mid-load drops the stale page before anything is drawn.

- **`siddur.js`**: `createSiddur({ fetchImpl, deps, storage, win, nav, doc })` loads the contents and each service (`?v=<data version>`, so a rebuild never serves a stale copy), draws the page, keeps the URL on the section being read (`replaceState`, so Back leaves the service), saves the reading position, and owns the screen wake lock. Also `renderToc(mount)` for the Texts menu and sidebar, and `SiddurNotFound`.
- **`siddur-reader.js`**: pure markup and helpers: typed lines (`prayer` / `instruction` / `conditional` / `heading`, inline rubrics as `<small>`), the contents, section tracking, saved positions, the wake lock, and `keepOffline(toc)`.
- **`siddur-day.js`**: the "Today in the siddur" card: which Hebrew day it is (after sunset it is tomorrow's), Israel or Diaspora (guessed from the zmanim location, then the reader's own choice), and per-service reminders built from `/api/siddur/v2/day` (Tachanun, Hallel, Mashiv/Morid, Barech Alenu, Ya'aleh VeYavo, Al HaNissim, the Ten Days, Aneinu, Musaf, the Omer). Reminders sit beside the text; nothing in the siddur is hidden or rewritten.

**Offline.** The first time a reader opens a siddur page, `keepOffline` posts `PRECACHE_SIDDUR` to the service worker, which keeps the contents and every service (about 600 KB gzipped) in a cache named for the siddur's data version (`shelah-siddur-<rite>@<version>`), not the deploy, so deploys do not discard it. A versioned service is then answered from that cache with no network at all, and the contents fall back to it offline. In the installed app only, it also asks `navigator.storage.persist()` so the browser will not evict it.

---

## 9. Zmanim

`zmanim.js` holds the zman-clock panel (`installZmanim(deps)`, called once from `main.js`) and, for historical reasons, the unrelated daily-study prefetch (`installDailyPrewarm()` / `prewarmDailyStudy()`). `installZmanim(deps)` takes an explicit `deps` object (`t`, `isHebrewMode`, `translateHolidayName`, `formatOmerLabel`, `formatWeeklyShabbatLabel`, `translateShabbatWarning`, `escapeHtml`, `setHebrewDate`); every other export takes the same object, so each can be called or tested without `installZmanim`.

- Location comes from a previously picked city (`localStorage["Sh'elahLastLocation"]`) or the session cookie set by `/set_location`, falling back server-side to IP-based geolocation. There is no `navigator.geolocation` permission prompt.
- It fetches `/api/zmanim` (with `lat`/`lon` for an explicit location), highlights the next upcoming zman and keeps a live countdown, rescheduling itself with `setTimeout` once a second (not a polling interval).
- A language switch re-renders through `refreshZmanimDisplay(deps)` without a re-fetch.

---

## 10. Service worker and PWA

`static/service-worker.js` is registered by `shell.js` three seconds after `load` at `/service-worker.js?swv=3` (`updateViaCache: 'none'`), served from the site root so its scope covers the app. The manifest is `/manifest.webmanifest`; icons are in `static/`. Four caches, all named for `CACHE_VERSION` (bump it whenever the shell asset list changes): shell, runtime, API, and prewarm, plus the siddur's own cache.

| Request | Strategy |
|---|---|
| HTML navigation, scripts, time-sensitive reads (`/api/zmanim*`, `/api/daily-study`, `/api/parasha`, `/api/holidays`) | Network first, cached copy only when offline |
| Static assets and other API reads | Stale-while-revalidate |
| `/api/user/`, `/api/bookmarks/`, `/api/auth/`, `/api/client-errors`, `/api/conversations`, `/api/public/answer` | **Never cached** (per-user or revocable data) |
| Failed navigation with nothing cached | `/static/offline.html` |
| Daily-study refs (Daf Yomi, Rambam, parasha) | Prewarmed by `zmanim.js` through a message to the worker |

`/static/min/js/` scripts count as scripts (network first), and `CORE_ASSETS` precaches the minified files the shell uses. `tests_js/service_worker.test.js` covers the routing rules.

---

## 11. CSS architecture

- **Tokens first.** Colours, spacing, radii, type and motion are tokens in `tokens.css`. No raw hex in a component, no magic-number margins: spacing uses `--sp-*` on the 4 px / 8 px scale.
- **Feature sheets** under `static/css/`:

| File | Owns |
|---|---|
| `tokens.css` | Tokens, keyframes, fallback font faces |
| `typography.css` | Fluid type, Hebrew stack, RTL overrides, the reduced-motion fallback |
| `reader.css` | Text reader, bilingual columns, section navigation |
| `sidebar.css` | Sidebars and tab bar |
| `halacha.css`, `prayer.css` | Halacha sections and community badges; prayer layout |
| `siddur.css` | The siddur reader and its day card |
| `ai.css` | Source cards, AI surfaces |
| `conversation.css` | The Ask panel, turns, citations, mini/full/overlay layouts |
| `history.css` | The `/history` page and the shelf |
| `calendar.css`, `calendar-detail.css` | Calendar overlay; the detail card |
| `loading.css` | Skeletons and the load-region states |
| `legal.css` | Legal, about, help and glossary pages |
| `tailwind.css` | Built output (below) |

- **Adding or reordering a sheet** means editing `CSS_ORDER` in `scripts/build_assets.mjs` **and** the fallback `<link>` list in `index.html` (a test keeps the two equal), then `npm run build:assets` and `npm run build:critical`.
- **`static/style.css`** (about 5,000 lines) is the legacy remainder. Move a selector out by relocating it to the right feature sheet, deleting it from `style.css`, and checking light and dark before committing.
- **Tailwind** (v4) is built, not loaded from a CDN: `npm run build:css` compiles `static/css/tailwind.input.css` into the committed, minified `tailwind.css`. There is no `tailwind.config.js`; the configuration is CSS-first, in the input file (`@source` globs for `templates/**/*.html` and `static/js/**/*.js`, the font, `navy` and `gold` theme values, the typography plugin). Re-run the build when you add a utility class that was not used before.
  The input file deliberately does **not** start with `@import "tailwindcss"`. That form puts preflight and the utilities in cascade layers, and layered rules lose to the un-layered app stylesheets (and, until it was removed, DaisyUI's), so padding, margin and radius utilities would stop applying to selects and buttons. It imports the theme, preflight and utilities pieces separately, without `layer()`, and loads last, as v3 did. It also keeps the v3 look on purpose: `tailwind.palette-v3.css` pins the v3 hex palette (v4's oklch palette shifts several colours), the theme is imported with `reference inline` so no `--color-*`, `--text-*`, `--radius-*` or `--font-*` variables are emitted that would collide with `tokens.css`, and the v3 line-heights, `space-y-*` behaviour and plain `:hover` variant are restored. Read the header comment in `tailwind.input.css` before changing any of it. Tailwind 4 targets Safari 16.4+, Chrome 111+ and Firefox 128+; the build includes its `@supports` fallback for older engines, and the app already needs `color-mix()` (Safari 16.2+, Chrome 111+, Firefox 113+).
- **Touch targets** are at least 44 by 44 px, set with `min-height`/`min-width` or padding, never left to the content size.
- **Native selects** in the settings panels sit in `<span class="select-field">` (`sidebar.css`): the browser arrow is dropped for one drawn in the page's ink at a fixed inset, so it lines up in every browser and in RTL, and the outline takes `--conv-edge` (3:1). Leave the colour to the stylesheet; the `border-slate-200` utility is remapped with `!important` and is 1.2:1 in dark.
- **Disabled controls** are drawn, not dimmed: a neutral fill, `--ink-secondary` and an outline (see `.conv-send:disabled`), so they stay perceivable on both themes. `opacity` over an accent fill left the dark Send button at 1.5:1.
- **Accessibility** is checked in both themes (`npm run test:a11y` runs pa11y-ci for light and `scripts/a11y_dark_scan.js` for dark); see `docs/ACCESSIBILITY_AUDIT.md` for the standing contrast findings.

---

## 12. Adding a module

1. Create `static/js/my-feature.js` with real `import`/`export` (a file with neither is treated as a classic script and is not versioned by the import map).
2. Export an `installMyFeature(deps)` function that attaches listeners and subscribes to state. Take anything it needs from `shell.js` as an explicit `deps` argument.
3. Import and call it from `main.js`; if `shell.js` must call it, add it to the bridge in section 3 and remove the entry when the last caller is gone.
4. Add `tests_js/my_feature.test.js` (the suite is `node --test`; modules that touch `window` are tested through the harness in `tests_js/helpers/`).
5. If it is part of the app shell, add it to `CORE_ASSETS` in `static/service-worker.js` and bump `CACHE_VERSION`.
6. Add its stylesheet to the `index.html` link list after `tokens.css`, and wrap every async region in `ShelahLoadRegion`.
