// Real-browser checks of the running app, in headless Chrome. The in-app
// browser pane is often hidden, which throttles its timers and freezes
// transitions, so timing and loading checks go here instead.
//
//   npm run probe                      smoke check of the home page
//   npm run probe -- smoke /calendar   smoke check of another path
//   npm run probe -- stall /api/zmanim the first matching request never
//                                      answers; the page must recover by itself
//   npm run probe -- targets / --mobile  tap areas under 44x44 px
//   ... targets / --open .home-calendar-btn  click a control first, then
//                                      measure only what it opened
//   npm run probe -- shot / --out /tmp/home.png [--dark] [--he] [--full]
//                                      a screenshot (returning visitor)
//   ... --url http://localhost:5002    use a server that is already running
//   ... --mobile                       375x812 phone viewport
//   ... --size 1440x900                any other viewport (default 800x600)
//
// Without --url it starts its own uvicorn (asgi:fastapi_app) on a free port
// from this checkout and stops it afterwards, so it never reads a stale dev
// server.
//
// smoke: fails on console errors, failed /api requests, or a region still
//   aria-busy="true" after 30 s.
// stall: fails if the stalled region is still busy after 40 s.
// targets: fails on a visible control whose real tap area (measured with
//   elementFromPoint, so ::before/::after extensions count) is under 44 px
//   in either direction. Links inside running text (p, li) are exempt, as in
//   WCAG 2.5.8.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SYSTEM_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : null;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--url', '--open', '--out'].includes(args[i - 1])));
const mode = positional[0] || 'smoke';
const target = positional[1] || (mode === 'stall' ? '/api/zmanim' : '/');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (t0) => ((Date.now() - t0) / 1000).toFixed(1);

function freePort() {
    return new Promise((resolve) => {
        const server = createServer();
        server.listen(0, () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function startServer() {
    const port = await freePort();
    const child = spawn(path.join(ROOT, '.venv/bin/python'),
        ['-m', 'uvicorn', 'asgi:fastapi_app', '--port', String(port), '--log-level', 'warning'],
        { cwd: ROOT, stdio: 'ignore' });
    const base = `http://localhost:${port}`;
    for (let i = 0; i < 60; i += 1) {
        try {
            // Time-boxed: if another process took the port, uvicorn exits and an
            // unbounded fetch could hang on that listener.
            if ((await fetch(base + '/', { signal: AbortSignal.timeout(5000) })).ok) return { base, stop: () => child.kill() };
        } catch { /* not up yet */ }
        await sleep(500);
    }
    child.kill();
    throw new Error('uvicorn did not start within 30 s');
}

const busyRegions = () => [...document.querySelectorAll('[aria-busy="true"]')]
    .filter((el) => el.offsetParent !== null)
    .map((el) => el.id || el.className || el.tagName);

async function smoke(page, base) {
    const problems = [];
    // /_vercel/* (Speed Insights) exists only on Vercel. "Failed to load
    // resource" lines carry no URL, so missing files are caught from the
    // responses below instead.
    const localOnly = (text) => text.includes('/_vercel/') || text.startsWith('Failed to load resource');
    page.on('console', (msg) => {
        if (msg.type() === 'error' && !localOnly(msg.text())) problems.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
    page.on('requestfailed', (req) => {
        if (req.url().includes('/api/')) problems.push(`failed: ${req.url().replace(base, '')} ${req.failure()?.errorText}`);
    });
    page.on('response', (res) => {
        const url = res.url();
        if (!url.startsWith(base) || url.includes('/_vercel/')) return;
        if (res.status() >= 500 || (res.status() === 404 && !url.includes('/api/'))) {
            problems.push(`HTTP ${res.status()}: ${url.replace(base, '')}`);
        }
    });
    const t0 = Date.now();
    await page.goto(base + target, { waitUntil: 'load', timeout: 60000 });
    console.log(`loaded ${target} in ${seconds(t0)}s`);
    let busy = [];
    for (let i = 0; i < 30; i += 1) {
        busy = await page.evaluate(busyRegions);
        if (!busy.length) break;
        await sleep(1000);
    }
    if (busy.length) problems.push(`still loading after 30 s: ${busy.join(', ')}`);
    else console.log(`every region finished loading by ${seconds(t0)}s`);
    return problems;
}

async function stall(page, base) {
    await page.setRequestInterception(true);
    let stalled = false;
    page.on('request', (req) => {
        if (!stalled && req.url().includes(target)) {
            stalled = true;
            console.log(`stalling the first ${target} request`);
            return; // never answered
        }
        req.continue();
    });
    const t0 = Date.now();
    await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    for (let i = 0; i < 40; i += 1) {
        await sleep(1000);
        if (stalled && !(await page.evaluate(busyRegions)).length) {
            console.log(`recovered without a reload after ${seconds(t0)}s`);
            return [];
        }
    }
    if (!stalled) return [`no request matched ${target}`];
    return [`still loading 40 s after stalling ${target}: ${(await page.evaluate(busyRegions)).join(', ')}`];
}

// Runs in the page: how far a tap still lands on each control, scanning out
// from its centre along both axes (capped at 22 px each way).
function measureTargets(min, onlyOpened) {
    const half = min / 2;
    let controls = [...document.querySelectorAll('a[href], button, summary, [role="button"], input:not([type="hidden"]), select')];
    // After --open: only controls inside a dialog, drawer or panel on top.
    if (onlyOpened) controls = controls.filter((el) => el.closest('dialog[open], [role="dialog"], [aria-modal="true"], aside, .modal'));
    const hits = (el, x, y) => {
        const at = document.elementFromPoint(x, y);
        return Boolean(at) && (at === el || el.contains(at));
    };
    const reach = (el, cx, cy, dx, dy) => {
        let d = 0;
        while (d < half && hits(el, cx + dx * (d + 1), cy + dy * (d + 1))) d += 1;
        return d;
    };
    const small = [];
    for (const el of controls) {
        if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
        if (el.closest('p, li:not([role]), dd') && el.localName === 'a' && el.closest('p, li, dd').textContent.trim().length > el.textContent.trim().length + 20) continue;
        const cx = Math.round(r.left + r.width / 2);
        const cy = Math.round(r.top + r.height / 2);
        if (!hits(el, cx, cy)) continue; // covered by something else right now
        const w = 1 + reach(el, cx, cy, -1, 0) + reach(el, cx, cy, 1, 0);
        const h = 1 + reach(el, cx, cy, 0, -1) + reach(el, cx, cy, 0, 1);
        if (w < min - 1 || h < min - 1) {
            const name = el.id ? `#${el.id}` : `${el.localName}.${[...el.classList].slice(0, 2).join('.')}`;
            small.push(`${name} "${(el.getAttribute('aria-label') || el.textContent).trim().replace(/\s+/g, ' ').slice(0, 30)}" ${w}x${h}`);
        }
    }
    return small;
}

async function targets(page, base) {
    // A returning visitor: the consent banner and the AI discovery tip would
    // otherwise sit over the controls being measured.
    await page.evaluateOnNewDocument(() => {
        try {
            localStorage.setItem("Sh'elahAnalyticsConsent", 'denied');
            localStorage.setItem('shelah.ai.tipDismissed', '1');
        } catch { /* storage blocked */ }
    });
    await page.goto(base + target, { waitUntil: 'load', timeout: 60000 });
    for (let i = 0; i < 30 && (await page.evaluate(busyRegions)).length; i += 1) await sleep(1000);
    const opener = option('--open');
    if (opener) {
        await page.click(opener);
    }
    // Let entrance motion settle before measuring.
    await sleep(1500);
    const small = [...new Set(await page.evaluate(measureTargets, 44, opener ? 'opened' : null))];
    console.log(`${small.length} control(s) under 44 px on ${target}`);
    return small.map((line) => `small target: ${line}`);
}

async function shot(page, base) {
    const out = option('--out');
    if (!out) return ['shot needs --out <file.png>'];
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: flag('--dark') ? 'dark' : 'light' }]);
    // --dark stores the theme too: the saved preference, not the system
    // setting, decides the theme once the app has loaded.
    await page.evaluateOnNewDocument((he, dark) => {
        try {
            localStorage.setItem("Sh'elahAnalyticsConsent", 'denied');
            localStorage.setItem('shelah.ai.tipDismissed', '1');
            if (he) localStorage.setItem('preferredLanguage', 'he');
            if (dark) localStorage.setItem("Sh'elahPrefs", JSON.stringify({ theme: 'dark' }));
        } catch { /* storage blocked */ }
    }, flag('--he'), flag('--dark'));
    await page.goto(base + target, { waitUntil: 'load', timeout: 60000 });
    for (let i = 0; i < 30 && (await page.evaluate(busyRegions)).length; i += 1) await sleep(1000);
    const opener = option('--open');
    if (opener) await page.click(opener);
    await sleep(1500);
    await page.screenshot({ path: out, fullPage: flag('--full') });
    console.log(`saved ${out}`);
    return [];
}

const checks = { smoke, stall, targets, shot };
if (!checks[mode]) {
    console.error(`unknown check "${mode}" (smoke | stall | targets | shot)`);
    process.exit(2);
}

const server = option('--url') ? { base: option('--url').replace(/\/$/, ''), stop: () => {} } : await startServer();
const browser = await puppeteer.launch({
    headless: true,
    ...(existsSync(SYSTEM_CHROME) ? { executablePath: SYSTEM_CHROME } : {}),
});
let problems = [];
try {
    const page = await browser.newPage();
    if (flag('--mobile')) await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    else if (/^\d+x\d+$/.test(option('--size') || '')) {
        const [width, height] = option('--size').split('x').map(Number);
        await page.setViewport({ width, height });
    }
    problems = await checks[mode](page, server.base);
} finally {
    await Promise.race([browser.close(), sleep(3000)]);
    server.stop();
}
if (problems.length) {
    console.log(`FAILED (${problems.length}):\n  ${problems.join('\n  ')}`);
    process.exit(1);
}
console.log('OK');
process.exit(0);
