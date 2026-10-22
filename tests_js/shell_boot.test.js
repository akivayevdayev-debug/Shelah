'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');

test('the page boots: shell.js defines its globals and the home page fetches its three lists', async () => {
    const page = await openShellPage();
    try {
        assert.equal(page.eval('typeof toggleLanguage'), 'function');
        const urls = page.calls.map((call) => call.url);
        assert.ok(urls.includes('/api/daily-study'));
        assert.ok(urls.includes('/api/parasha?minhag=sephardi'), 'the week\'s parasha is asked for by the reader\'s community');
        assert.ok(urls.includes('/api/library/popular'));
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});
