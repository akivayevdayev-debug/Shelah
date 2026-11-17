// Renders scripts/og/og-image.html to static/og-image.png (1200x630) with
// headless Chrome, so the link preview uses Sh'elah's own fonts.
// Usage: node scripts/build_og_image.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { chromePath } from "./build_critical_css.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ["--allow-file-access-from-files"] });
try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(root, "scripts/og/og-image.html")).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const missing = await page.evaluate(() =>
        ["Newsreader", "Hanken Grotesk", "Frank Ruhl Libre"].filter((f) => !document.fonts.check(`16px "${f}"`, f === "Frank Ruhl Libre" ? "ש" : "a")));
    if (missing.length) throw new Error(`fonts did not load: ${missing.join(", ")}`);
    await page.screenshot({ path: path.join(root, "static/og-image.png"), type: "png" });
    console.log("wrote static/og-image.png");
} finally {
    await browser.close();
}
