#!/usr/bin/env node
/**
 * Extracts the critical CSS the shell inlines in its <head>
 * (backend/module_versions.page_css, templates/index.html).
 *
 *   npm run build:critical             extract, write static/min/css/critical-*.css, verify
 *   npm run build:critical -- --no-verify
 *   npm run build:critical -- --verify-only
 *   npm run build:critical -- --base-url http://127.0.0.1:5000
 *       use a running server (it must run with SHELAH_SOURCE_ASSETS=1)
 *
 * For each kind of page (home, a server-rendered /text/ page, any other deep
 * link) the page is loaded with its scripts blocked -- the server-rendered
 * first paint -- over a matrix of viewport widths, light/dark, English/Hebrew
 * and signed-out/signed-in (the head scripts set classes for the last three),
 * and every rule of the page's own stylesheets (static/style.css, static/css/*)
 * whose selector matches a rendered element is kept, in its original place.
 * The result is what the first paint needs; the whole bundle
 * (static/min/css/app.css) follows asynchronously, and because the kept rules
 * are in the original order and the bundle repeats them, the cascade after it
 * has loaded is the original one.
 *
 * Verification loads each kind of page with the bundle blocked, then with it
 * applied, at widths the extraction did not use, and compares the computed
 * style of every rendered element: they must be identical. Run
 * `npm run build:assets` first (the manifest says which sources this was
 * extracted from; when a stylesheet changes, the critical CSS is stale and the
 * page links the bundle as an ordinary stylesheet until this is run again).
 */
import { transform } from "esbuild";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// SHELAH_ASSETS_ROOT builds another tree (tests_js/build_critical_css.test.js uses a temp one).
const ROOT = process.env.SHELAH_ASSETS_ROOT
    ? path.resolve(process.env.SHELAH_ASSETS_ROOT)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIN = path.join(ROOT, "static", "min");

// kind -> [route, matrix] pairs. Every route is the server-rendered shell; the
// ones after the first differ from it only by the class/attribute the head
// scripts put on <html> for that kind of URL (data-cold-view and so on).
const FULL = { widths: [320, 375, 412, 600, 768, 900, 1024, 1280, 1536, 1920] };
const LITE = { widths: [375, 1280] };
export const KINDS = {
    home: [["/", FULL]],
    text: [
        ["/text/Genesis.1", FULL],
        ["/text/Berakhot.2a", LITE],
    ],
    app: [
        ["/?text=Genesis.1", LITE],
        ["/prayer/Shacharit", LITE],
        ["/community/Chabad", LITE],
        ["/history", LITE],
        ["/chat/new", LITE],
        ["/signin", LITE],
    ],
};
// How long a loaded page gets to settle before it is measured (a test sets it to 0).
const SETTLE_MS = Number(process.env.SHELAH_SETTLE_MS ?? 400);
export const VERIFY_WIDTHS = [340, 540, 700, 820, 1100, 1700];

export const arg = (name, argv = process.argv) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
};

export function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
        server.on("error", reject);
    });
}

export async function startServer(env, { attempts = 120, waitMs = 500 } = {}) {
    const port = await freePort();
    const python = fs.existsSync(path.join(ROOT, ".venv/bin/python")) ? path.join(ROOT, ".venv/bin/python") : "python3";
    const child = spawn(python, ["-m", "uvicorn", "asgi:app", "--port", String(port), "--log-level", "warning"], {
        cwd: ROOT,
        env: { ...process.env, RATELIMIT_ENABLED: "false", ...env },
        stdio: "ignore",
    });
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < attempts; i += 1) {
        try {
            const res = await fetch(`${base}/`);
            if (res.ok) return { base, stop: () => child.kill("SIGTERM") };
        } catch {
            /* not up yet */
        }
        await new Promise((r) => setTimeout(r, waitMs));
    }
    child.kill("SIGTERM");
    throw new Error("the server did not start");
}

export function chromePath() {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    return fs.existsSync(mac) ? mac : undefined;
}

export function cellsFor(matrix, authToo = true) {
    const cells = [];
    for (const w of matrix.widths) {
        for (const theme of ["light", "dark"]) {
            for (const lang of ["en", "he"]) {
                for (const auth of authToo ? [false, true] : [false]) cells.push({ w, theme, lang, auth });
            }
        }
    }
    return cells;
}

export async function openPage(browser, base, route, cell, { blockScripts, onRequest }) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: cell.w, height: cell.w < 768 ? 800 : 900, deviceScaleFactor: 1, isMobile: cell.w < 768, hasTouch: cell.w < 768 });
    await page.evaluateOnNewDocument(
        (theme, lang, auth) => {
            localStorage.setItem("Sh'elahPrefs", JSON.stringify({ theme }));
            localStorage.setItem("preferredLanguage", lang);
            localStorage.setItem("Sh'elahLanguageManuallySet", "1");
            if (auth) document.cookie = "__client_uat=1700000000; path=/";
        },
        cell.theme,
        cell.lang,
        cell.auth,
    );
    await page.setRequestInterception(true);
    page.on("request", (req) => {
        const url = req.url();
        if (/cdn\.jsdelivr|sentry|clerk|_vercel|googleapis|gstatic|challenges\.cloudflare/.test(url)) return req.abort();
        if (blockScripts && /\/static\/(?:min\/)?js\//.test(url)) return req.abort();
        if (onRequest?.(req)) return undefined;
        return req.continue();
    });
    await page.goto(base + route, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    return { page, close: () => ctx.close() };
}

/** Runs async tasks n at a time. */
export async function pool(tasks, n) {
    const out = new Array(tasks.length);
    let next = 0;
    await Promise.all(
        Array.from({ length: n }, async () => {
            while (next < tasks.length) {
                const i = next;
                next += 1;
                out[i] = await tasks[i]();
            }
        }),
    );
    return out;
}

// ── in-page: which rules of the page's own stylesheets match the first paint ──
export function pageKeepRules() {
    // The elements the first paint needs rules for: those that are drawn, and the
    // roots of the subtrees that are not (an element hidden by display:none
    // under a drawn parent -- the rule that hides it is as critical as one that
    // styles it). What a hidden subtree holds below that root is not drawn.
    const all = [...document.querySelectorAll("html, html *")];
    const drawn = new Set(
        all.filter((el) => el === document.documentElement || el.getClientRects().length > 0 || getComputedStyle(el).display === "contents"),
    );
    const rendered = all.filter((el) => drawn.has(el) || (el.parentElement && drawn.has(el.parentElement) && getComputedStyle(el).display === "none"));
    const PSEUDO_EL =
        /::?(before|after|first-line|first-letter|marker|placeholder|selection|backdrop|-webkit-[a-z-]+(\([^)]*\))?|-moz-[a-z-]+|-ms-[a-z-]+|file-selector-button|cue|part\([^)]*\)|slotted\([^)]*\)|view-transition[a-z-]*(\([^)]*\))?|scroll-marker[a-z-]*|details-content|target-text|picker[a-z-]*(\([^)]*\))?)/g;
    // States a visitor cannot be in at first paint (a hover or a focus ring can
    // wait for the bundle): such a selector is not critical.
    const STATE =
        /:(hover|active|focus|focus-visible|focus-within|visited|target|checked|indeterminate|autofill|open|popover-open|modal|fullscreen|user-invalid|user-valid|-webkit-[a-z-]+)(?![\w-])/;
    const splitTop = (sel) => {
        const out = [];
        let depth = 0;
        let cur = "";
        for (const ch of sel) {
            if (ch === "(" || ch === "[") depth += 1;
            if (ch === ")" || ch === "]") depth -= 1;
            if (ch === "," && depth === 0) {
                out.push(cur);
                cur = "";
            } else cur += ch;
        }
        out.push(cur);
        return out;
    };
    const cache = new Map();
    const partUsed = (part) => {
        if (STATE.test(part)) return false;
        let q = part.replace(PSEUDO_EL, "").trim();
        if (!q) q = "*";
        let hit = cache.get(q);
        if (hit === undefined) {
            hit = false;
            try {
                for (const el of rendered) {
                    if (el.matches(q)) {
                        hit = true;
                        break;
                    }
                }
            } catch {
                hit = true; // a selector this browser cannot test: keep it
            }
            cache.set(q, hit);
        }
        return hit;
    };
    const used = (sel) => splitTop(sel).some(partUsed);
    const KEEP_ALWAYS = new Set(["CSSFontFaceRule", "CSSPropertyRule", "CSSLayerStatementRule", "CSSImportRule", "CSSCharsetRule", "CSSNamespaceRule"]);
    const kept = {};
    const walk = (rules, base, bag) => {
        let any = false;
        for (let i = 0; i < rules.length; i += 1) {
            const rule = rules[i];
            const name = rule.constructor.name;
            const here = `${base}/${i}`;
            if (name === "CSSStyleRule") {
                if (used(rule.selectorText)) {
                    bag.push(here);
                    any = true;
                }
            } else if (KEEP_ALWAYS.has(name)) {
                bag.push(here);
                any = true;
            } else if (name === "CSSKeyframesRule") {
                // kept afterwards, by whether a kept rule names it
            } else if (name === "CSSMediaRule" && /^print$/.test(rule.conditionText)) {
                // a print-only block cannot be part of a screen paint
            } else if (rule.cssRules) {
                if (walk(rule.cssRules, here, bag)) {
                    bag.push(here);
                    any = true;
                }
            }
        }
        return any;
    };
    for (const sheet of document.styleSheets) {
        if (!sheet.href) continue;
        const key = new URL(sheet.href).pathname;
        if (!/^\/static\/(?:css\/[\w-]+|style)\.css$/.test(key)) continue;
        let rules;
        try {
            rules = sheet.cssRules;
        } catch {
            continue;
        }
        kept[key] = [];
        walk(rules, "", kept[key]);
    }
    return kept;
}

// ── in-page: serialize the kept rules, sheet by sheet, in document order ──────
export function pageSerialize(keepByHref) {
    const keyframes = [];
    // The at-rule head a grouping rule is written with; any other keeps just its body.
    const heads = {
        CSSMediaRule: (rule) => `@media ${rule.conditionText}`,
        CSSSupportsRule: (rule) => `@supports ${rule.conditionText}`,
        CSSLayerBlockRule: (rule) => `@layer ${rule.name}`,
        CSSContainerRule: (rule) => `@container ${rule.containerName} ${rule.containerQuery}`,
    };
    const ser = (rules, base, set) => {
        let out = "";
        for (let i = 0; i < rules.length; i += 1) {
            const rule = rules[i];
            const name = rule.constructor.name;
            const here = `${base}/${i}`;
            if (name === "CSSKeyframesRule") {
                keyframes.push([rule.name, rule.cssText]);
                continue;
            }
            if (!set.has(here)) continue;
            if (rule.cssRules && name !== "CSSStyleRule") {
                const inner = ser(rule.cssRules, here, set);
                out += heads[name] ? `${heads[name](rule)}{${inner}}` : inner;
            } else out += rule.cssText;
        }
        return out;
    };
    let text = "";
    const order = [];
    for (const sheet of document.styleSheets) {
        const key = sheet.href ? new URL(sheet.href).pathname : "";
        if (!keepByHref[key]) continue;
        order.push(key);
        let rules;
        try {
            rules = sheet.cssRules;
        } catch {
            continue;
        }
        text += `\n/* ${key} */\n${ser(rules, "", new Set(keepByHref[key]))}`;
    }
    return { text, keyframes, order };
}

// The rule paths each stylesheet keeps, over every route and matrix cell of a kind.
export async function collectKept(browser, base, kind) {
    const union = {}; // href -> Set(rule paths)
    for (const [route, matrix] of KINDS[kind]) {
        const cells = cellsFor(matrix);
        const results = await pool(
            cells.map((cell) => async () => {
                const { page, close } = await openPage(browser, base, route, cell, { blockScripts: true });
                const kept = await page.evaluate(pageKeepRules);
                await close();
                return kept;
            }),
            4,
        );
        for (const kept of results) {
            for (const [key, paths] of Object.entries(kept)) {
                if (!union[key]) union[key] = new Set();
                for (const p of paths) union[key].add(p);
            }
        }
    }
    return union;
}

// A keyframes block is kept when something kept names it.
export function withKeyframes(text, keyframes) {
    let css = text;
    const seen = new Set();
    for (const [name, body] of keyframes) {
        if (!seen.has(name) && text.includes(name)) {
            seen.add(name);
            css += body;
        }
    }
    return css;
}

export async function extractKind(browser, base, kind) {
    const union = await collectKept(browser, base, kind);
    const { page, close } = await openPage(browser, base, KINDS[kind][0][0], { w: 1280, theme: "light", lang: "en", auth: false }, { blockScripts: true });
    const keepObj = Object.fromEntries(Object.entries(union).map(([k, v]) => [k, [...v]]));
    const { text, keyframes, order } = await page.evaluate(pageSerialize, keepObj);
    await close();
    const min = await transform(withKeyframes(text, keyframes), { loader: "css", minify: true, charset: "utf8", legalComments: "none" });
    if (/<\/style/i.test(min.code)) throw new Error("critical CSS contains '</style'");
    return { code: min.code, order, routes: KINDS[kind].map(([route]) => route) };
}

// ── verification: first paint with the bundle blocked == with it applied ──────
export const COMPARED = [
    "display", "position", "visibility", "opacity", "color", "background-color", "background-image", "font-family", "font-size",
    "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-transform", "text-decoration-line",
    "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-top-color", "border-top-style",
    "border-top-left-radius", "box-shadow", "width", "height", "min-height", "max-width", "flex-direction", "flex-wrap", "flex-grow",
    "flex-shrink", "justify-content", "align-items", "align-self", "gap", "overflow-x", "overflow-y", "z-index", "transform",
    "grid-template-columns", "cursor", "content", "direction", "white-space", "top", "left", "right", "bottom", "object-fit",
    "aspect-ratio", "filter", "backdrop-filter", "list-style-type", "vertical-align",
];

export function pageSignature(props) {
    // Animations are paused at their start so two loads compare the same frame.
    document.getAnimations().forEach((a) => {
        try {
            a.pause();
            a.currentTime = 0;
        } catch {
            /* not pausable */
        }
    });
    const out = {};
    const where = (el) => {
        const parts = [];
        for (let node = el; node && node !== document.documentElement; node = node.parentNode) {
            const i = [...node.parentNode.children].indexOf(node);
            const idPart = node.id ? `#${node.id}` : "";
            parts.unshift(`${node.tagName.toLowerCase()}${idPart}:${i}`);
        }
        return parts.join(">");
    };
    for (const el of document.querySelectorAll("html, html *")) {
        if (el !== document.documentElement && el.getClientRects().length === 0) continue;
        const style = getComputedStyle(el);
        out[where(el)] = props.map((p) => style.getPropertyValue(p)).join("|");
        for (const pseudo of ["::before", "::after"]) {
            const ps = getComputedStyle(el, pseudo);
            if (ps.content && ps.content !== "none" && ps.content !== "normal") out[where(el) + pseudo] = props.map((p) => ps.getPropertyValue(p)).join("|");
        }
    }
    return out;
}

export async function verifyKind(browser, base, kind) {
    const [route] = KINDS[kind][0];
    const cells = cellsFor({ widths: VERIFY_WIDTHS }, false).concat(cellsFor({ widths: [412, 1280] }).filter((c) => c.auth));
    const signature = async (cell, bundle) => {
        const { page, close } = await openPage(browser, base, route, cell, {
            blockScripts: true,
            onRequest: (req) => {
                if (!bundle && /\/static\/min\/css\/app\.css/.test(req.url())) {
                    req.respond({ status: 200, contentType: "text/css", body: "" });
                    return true;
                }
                return false;
            },
        });
        const sig = await page.evaluate(pageSignature, COMPARED);
        await close();
        return sig;
    };
    const full = await pool(cells.map((cell) => () => signature(cell, true)), 4);
    const crit = await pool(cells.map((cell) => () => signature(cell, false)), 4);
    let bad = 0;
    cells.forEach((cell, i) => {
        const keys = new Set([...Object.keys(full[i]), ...Object.keys(crit[i])]);
        const diffs = [...keys].filter((k) => full[i][k] !== crit[i][k]);
        if (!diffs.length) return;
        bad += 1;
        console.error(`  DIFF ${kind} ${route} ${cell.w}px ${cell.theme}/${cell.lang}${cell.auth ? "/in" : ""}: ${diffs.length} of ${keys.size} elements`);
        for (const k of diffs.slice(0, 3)) {
            const a = (full[i][k] || "").split("|");
            const b = (crit[i][k] || "").split("|");
            const props = COMPARED.map((p, j) => (a[j] !== b[j] ? `${p}: ${a[j]} -> ${b[j]}` : null)).filter(Boolean).slice(0, 3);
            console.error(`    ${k.slice(-70)}  ${props.join(" ; ")}`);
        }
    });
    return { bad, cells: cells.length };
}

/**
 * The whole run. Resolves to the number of verification cells that differ (0
 * when there was nothing to verify). `puppeteer` and `serve` are the browser
 * library and the server starter, passed in so a test can supply fakes.
 */
export async function main({ argv = process.argv, puppeteer = require("puppeteer"), serve = startServer } = {}) {
    const verify = !argv.includes("--no-verify");
    const verifyOnly = argv.includes("--verify-only");
    const manifestPath = path.join(MIN, "manifest.json");
    if (!fs.existsSync(manifestPath)) throw new Error("static/min/manifest.json is missing: run npm run build:assets first");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const given = arg("--base-url", argv);
    const source = given || verifyOnly ? { base: given, stop: () => {} } : await serve({ SHELAH_SOURCE_ASSETS: "1" });
    const browser = verifyOnly ? null : await puppeteer.launch({ executablePath: chromePath(), headless: true });
    try {
        if (!verifyOnly) {
            const critical = {};
            for (const kind of Object.keys(KINDS)) {
                const started = Date.now();
                const { code, order, routes } = await extractKind(browser, source.base, kind);
                const file = `css/critical-${kind}.css`;
                fs.mkdirSync(path.join(MIN, "css"), { recursive: true });
                fs.writeFileSync(path.join(MIN, file), code);
                critical[kind] = { file, sourcesHash: manifest.css.sourcesHash, routes };
                console.log(`${kind.padEnd(5)} ${(code.length / 1024).toFixed(1)} KB from ${order.length} sheets, ${routes.length} route(s) (${((Date.now() - started) / 1000).toFixed(0)} s)`);
            }
            manifest.css.critical = critical;
            fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        }
    } finally {
        await browser?.close();
        source.stop();
    }
    if (!verify) return 0;
    // The verification page is the shipped one: static/min/ current, bundle and critical CSS in the head.
    const shipped = given ? { base: given, stop: () => {} } : await serve({ SHELAH_SOURCE_ASSETS: "" });
    const browser2 = await puppeteer.launch({ executablePath: chromePath(), headless: true });
    let failed = 0;
    try {
        for (const kind of Object.keys(KINDS)) {
            const { bad, cells } = await verifyKind(browser2, shipped.base, kind);
            const outcome = bad ? `${bad} of ${cells} cells differ` : `all ${cells} cells identical`;
            console.log(`verify ${kind.padEnd(5)} ${outcome}`);
            failed += bad;
        }
    } finally {
        await browser2.close();
        shipped.stop();
    }
    return failed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (await main()) process.exit(1);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
