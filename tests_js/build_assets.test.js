/**
 * scripts/build_assets.mjs: what it builds into static/min/ and how `--check`
 * tells that the committed output has gone stale. Builds a tiny tree in a
 * temp directory (SHELAH_ASSETS_ROOT) rather than the real one, so the test
 * passes whatever state static/min/ is in; CI's `npm run check:assets` is
 * what holds the real output to the sources.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'build_assets.mjs');

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** Writes a file (creating folders) under a tree's static/ directory. */
function put(root, rel, text) {
    const target = path.join(root, 'static', rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
}

const SOURCES = {
    'js/classic.js': "const greeting = 'hello';\nfunction sayHello() { return greeting; }\nwindow.sayHello = sayHello;\n",
    'js/shared.js': "export const shared = () => 'shared ' + 'x'.repeat(4);\n",
    'js/main.js': "import { shared } from './shared.js';\nwindow.mainValue = shared();\n",
    'js/motion.js': "import { shared } from './shared.js';\nwindow.motionValue = shared();\n",
    'js/calendar-detail.js': 'window.calendarDetail = true;\nexport {};\n',
    'js/orphan.js': 'export const orphan = 1;\n',
    'js/notes.txt': 'not a script',
    'js/bad name.js': 'not matched by the name filter',
};

/** A tree with every file the build reads; `cssOrder` is the build's own list. */
function makeTree(cssOrder) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelah-assets-'));
    cssOrder.forEach((rel, index) => put(root, rel, `/* ${rel} */\n.rule-${index} {\n    order: ${index};\n}\n`));
    for (const [rel, text] of Object.entries(SOURCES)) put(root, rel, text);
    return root;
}

const minPath = (root, rel = '') => path.join(root, 'static', 'min', rel);
const readMin = (root, rel) => fs.readFileSync(minPath(root, rel), 'utf8');
const listMin = (root, dir = minPath(root)) => (fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? listMin(root, full) : [path.relative(minPath(root), full).split(path.sep).join('/')];
    })
    : []);

function run(root, ...args) {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
        env: { ...process.env, SHELAH_ASSETS_ROOT: root },
        encoding: 'utf8',
    });
    return { code: result.status, out: result.stdout, err: result.stderr };
}

/** The module, loaded once for this process against one tree (the root is read at load). */
let ROOT;
let build;
const cleanup = [];

test.before(async () => {
    // The tree needs the build's own CSS list, which only the module can say; read it textually.
    const source = fs.readFileSync(SCRIPT, 'utf8');
    const list = /export const CSS_ORDER = \[([^\]]*)\]/.exec(source)[1];
    const cssOrder = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    ROOT = makeTree(cssOrder);
    cleanup.push(ROOT);
    process.env.SHELAH_ASSETS_ROOT = ROOT;
    build = await import(pathToFileURL(SCRIPT).href);
    assert.deepEqual(build.CSS_ORDER, cssOrder);
});

test.after(() => {
    for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
});

const serialize = (manifest) => `${JSON.stringify(manifest, null, 2)}\n`;

// ─── compute ─────────────────────────────────────────────────────────────────

test('the stylesheets are concatenated in the cascade order and minified', async () => {
    const { files, manifest } = await build.compute();
    const css = files.get('css/app.css').toString('utf8');
    const positions = build.CSS_ORDER.map((_, index) => css.indexOf(`.rule-${index}{order:${index}}`));
    assert.ok(positions.every((position) => position >= 0), css);
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
    assert.equal(css.includes('/*'), false);

    const bare = {};
    for (const rel of build.CSS_ORDER) {
        const data = fs.readFileSync(path.join(ROOT, 'static', rel));
        assert.equal(manifest.css.sources[rel], `sha256:${sha256(data)}`, rel);
        bare[rel] = sha256(data);
    }
    assert.equal(manifest.css.sourcesHash, sha256(JSON.stringify(bare)));
    assert.equal(manifest.css.bundle, 'css/app.css');
    assert.deepEqual(manifest.css.critical, {});
});

test('a classic script is minified on its own and keeps its top-level names', async () => {
    const { files, manifest } = await build.compute();
    const out = files.get('js/classic.js').toString('utf8');
    assert.ok(out.length < SOURCES['js/classic.js'].length);
    assert.match(out, /function sayHello\(\)/);
    assert.deepEqual(manifest.js.classic, { 'classic.js': { source: `sha256:${sha256(SOURCES['js/classic.js'])}` } });
    // Names that are not scripts, or that are modules, are not classic scripts.
    assert.equal(files.has('js/notes.txt'), false);
    assert.equal(files.has('js/bad name.js'), false);
    assert.equal(files.has('js/shared.js'), false);
});

test('the module entries are bundled, shared code goes to a hashed chunk, and an unused module is listed', async () => {
    const { files, manifest } = await build.compute();
    const modules = manifest.js.modules;
    assert.deepEqual(modules.entries, { 'main.js': 'js/main.js', 'motion.js': 'js/motion.js', 'calendar-detail.js': 'js/calendar-detail.js' });
    assert.deepEqual(Object.keys(modules.sources), ['shared.js', 'orphan.js', 'calendar-detail.js', 'main.js', 'motion.js'].sort());
    assert.deepEqual(modules.unreached, ['orphan.js']);

    const chunks = [...files.keys()].filter((rel) => rel.startsWith('js/chunks/'));
    assert.equal(chunks.length, 1, [...files.keys()].join(', '));
    assert.match(chunks[0], /^js\/chunks\/[\w-]+-[\w]+\.js$/);
    assert.match(files.get('js/main.js').toString('utf8'), /chunks\//);

    // Every output is recorded by a 12-character digest, in sorted order.
    assert.deepEqual(Object.keys(modules.outputs), [...Object.keys(modules.outputs)].sort());
    for (const [rel, digest] of Object.entries(modules.outputs)) {
        assert.equal(digest, sha256(files.get(rel)).slice(0, 12), rel);
    }
});

test('the critical-CSS entries of the previous manifest are carried over', async () => {
    const critical = { home: { file: 'css/critical-home.css', sourcesHash: 'abc', routes: ['/'] } };
    const { manifest } = await build.compute({ css: { critical } });
    assert.deepEqual(manifest.css.critical, critical);
    const { manifest: without } = await build.compute({ css: {} });
    assert.deepEqual(without.css.critical, {});
});

test('a stylesheet that could break out of an inline <style> stops the build', async () => {
    const target = path.join(ROOT, 'static', build.CSS_ORDER[0]);
    const original = fs.readFileSync(target, 'utf8');
    // esbuild escapes the sequence inside strings and url(); a custom property value is kept as written.
    fs.writeFileSync(target, '.x { --v: </style>; }\n');
    try {
        await assert.rejects(build.compute(), /could not be inlined/);
    } finally {
        fs.writeFileSync(target, original);
    }
});

// ─── findDrift ───────────────────────────────────────────────────────────────

test('findDrift reports what is stale, missing, or not produced by the build', async () => {
    // Build with the CLI, then compare the same build computed here.
    const first = run(ROOT);
    assert.equal(first.code, 0, first.err);

    const previous = JSON.parse(readMin(ROOT, 'manifest.json'));
    const { files, manifest } = await build.compute(previous);
    const text = serialize(manifest);
    assert.deepEqual(build.findDrift(files, manifest, text), { stale: [], extra: [] });

    // The critical CSS belongs to the other script: never extra.
    fs.writeFileSync(minPath(ROOT, 'css/critical-home.css'), 'body{}');
    assert.deepEqual(build.findDrift(files, manifest, text).extra, []);

    fs.writeFileSync(minPath(ROOT, 'css/other.css'), 'body{}');
    fs.writeFileSync(minPath(ROOT, 'js/classic.js'), 'changed');
    fs.rmSync(minPath(ROOT, 'css/app.css'));
    const drift = build.findDrift(files, manifest, text);
    assert.deepEqual(drift.stale.sort(), ['css/app.css', 'js/classic.js']);
    assert.deepEqual(drift.extra, ['css/other.css']);

    assert.deepEqual(build.findDrift(files, manifest, `${text} `).stale.includes('manifest.json'), true);

    fs.rmSync(minPath(ROOT, 'css/other.css'));
    fs.rmSync(minPath(ROOT, 'css/critical-home.css'));
    assert.equal(run(ROOT).code, 0);
});

// ─── The command line ────────────────────────────────────────────────────────

function freshTree() {
    const source = fs.readFileSync(SCRIPT, 'utf8');
    const list = /export const CSS_ORDER = \[([^\]]*)\]/.exec(source)[1];
    const root = makeTree([...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]));
    cleanup.push(root);
    return root;
}

test('--check says what to run when nothing has been built', () => {
    const root = freshTree();
    const result = run(root, '--check');
    assert.equal(result.code, 1);
    assert.match(result.err, /static\/min\/ does not match the sources\. Run: npm run build:assets/);
    assert.match(result.err, /stale or missing: css\/app\.css/);
    assert.match(result.err, /stale or missing: manifest\.json/);
});

test('a build writes static/min/, reports it, and --check then passes', () => {
    const root = freshTree();
    const built = run(root);
    assert.equal(built.code, 0, built.err);
    assert.match(built.out, /^static\/min\/: \d+ files, \d+ KB \(css \d+ KB\)/m);
    assert.match(built.out, /modules no entry imports: orphan\.js/);
    assert.deepEqual(
        listMin(root).filter((rel) => !rel.startsWith('js/chunks/')),
        ['css/app.css', 'js/calendar-detail.js', 'js/classic.js', 'js/main.js', 'js/motion.js', 'manifest.json'],
    );

    const checked = run(root, '--check');
    assert.equal(checked.code, 0, checked.err);
    assert.match(checked.out, /static\/min\/ is up to date \(\d+ files\)\./);

    // Running it again changes nothing.
    const stamp = fs.statSync(minPath(root, 'css/app.css')).mtimeMs;
    assert.equal(run(root).code, 0);
    assert.equal(fs.statSync(minPath(root, 'css/app.css')).mtimeMs, stamp);
});

test('--check names a source that changed since the build, and a rebuild clears it', () => {
    const root = freshTree();
    assert.equal(run(root).code, 0);
    put(root, 'js/classic.js', `${SOURCES['js/classic.js']}window.more = 1;\n`);
    const stale = run(root, '--check');
    assert.equal(stale.code, 1);
    assert.match(stale.err, /stale or missing: js\/classic\.js/);
    assert.match(stale.err, /stale or missing: manifest\.json/);

    assert.equal(run(root).code, 0);
    assert.equal(run(root, '--check').code, 0);
});

test('--check names a file in static/min/ the build does not produce', () => {
    const root = freshTree();
    assert.equal(run(root).code, 0);
    fs.writeFileSync(minPath(root, 'js/stray.js'), 'x');
    fs.writeFileSync(minPath(root, 'css/critical-app.css'), 'x');
    const result = run(root, '--check');
    assert.equal(result.code, 1);
    assert.match(result.err, /not produced by the build: js\/stray\.js/);
    assert.doesNotMatch(result.err, /critical-app/);
});

test('a chunk the new build no longer produces is removed; the critical CSS is left alone', () => {
    const root = freshTree();
    assert.equal(run(root).code, 0);
    const before = listMin(root).filter((rel) => rel.startsWith('js/chunks/'));
    assert.equal(before.length, 1);

    fs.writeFileSync(minPath(root, 'css/critical-home.css'), 'body{}');
    put(root, 'js/shared.js', "export const shared = () => 'a different shared module';\n");
    assert.equal(run(root).code, 0);
    const after = listMin(root).filter((rel) => rel.startsWith('js/chunks/'));
    assert.equal(after.length, 1);
    assert.notEqual(after[0], before[0]);
    assert.equal(fs.existsSync(minPath(root, 'css/critical-home.css')), true);
    assert.equal(run(root, '--check').code, 0);
});

test('a rebuild keeps the critical-CSS entries the other script recorded in the manifest', () => {
    const root = freshTree();
    assert.equal(run(root).code, 0);
    const manifest = JSON.parse(readMin(root, 'manifest.json'));
    manifest.css.critical = { home: { file: 'css/critical-home.css', sourcesHash: manifest.css.sourcesHash, routes: ['/'] } };
    fs.writeFileSync(minPath(root, 'manifest.json'), serialize(manifest));
    fs.writeFileSync(minPath(root, 'css/critical-home.css'), 'body{}');

    put(root, 'js/classic.js', `${SOURCES['js/classic.js']}window.more = 1;\n`);
    assert.equal(run(root).code, 0);
    assert.deepEqual(JSON.parse(readMin(root, 'manifest.json')).css.critical, manifest.css.critical);
});

test('a manifest that cannot be read is rebuilt rather than fatal', () => {
    const root = freshTree();
    assert.equal(run(root).code, 0);
    fs.writeFileSync(minPath(root, 'manifest.json'), '{ not json');
    assert.equal(run(root).code, 0);
    assert.equal(run(root, '--check').code, 0);
});

test('a source that cannot be bundled fails the build with the reason', () => {
    const root = freshTree();
    put(root, 'js/main.js', "import { gone } from './missing.js';\nwindow.x = gone;\n");
    const result = run(root);
    assert.equal(result.code, 1);
    assert.match(result.err, /missing\.js/);
});

test('esbuild\'s warnings about a source are printed, not hidden', () => {
    const root = freshTree();
    put(root, 'js/classic.js', 'if (window.a == NaN) { window.y = 1; }\n');
    const result = run(root);
    assert.equal(result.code, 0, result.err);
    assert.match(result.err, /warning \(.+:1\): Comparison with NaN/);
});
