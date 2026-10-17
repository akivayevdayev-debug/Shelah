/**
 * How shell.js prepares AI answer text for the page: the Markdown spacing
 * normaliser, the sanitising renderer (and its no-library fallback), the
 * always-visible disclaimer banner, and the delayed hover tooltips. Boots the
 * real home page in jsdom (tests_js/helpers/shell_page.js).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openShellPage } = require('./helpers/shell_page');

const normalize = (page, text) => page.call('normalizeMarkdownSpacing', text);

test('normalizeMarkdownSpacing: empty input and line endings', async () => {
    const page = await openShellPage();
    try {
        assert.equal(normalize(page, null), '');
        assert.equal(normalize(page, undefined), '');
        assert.equal(normalize(page, ''), '');
        assert.equal(normalize(page, 'a\r\nb\rc'), 'a\nb\nc');
        assert.equal(normalize(page, '  padded  '), 'padded');
    } finally {
        page.close();
    }
});

test('normalizeMarkdownSpacing: headings get their own paragraph, whatever the model glued them to', async () => {
    const page = await openShellPage();
    try {
        assert.equal(normalize(page, 'Intro ## Title\nbody'), 'Intro\n\n\n## Title\n\nbody');
        assert.equal(normalize(page, '##Title\ntext'), '## Title\n\ntext');
        assert.equal(normalize(page, 'a\n## H\nb'), 'a\n\n\n## H\n\nb');
        assert.equal(normalize(page, '## H1\n\n\n\n## H2'), '## H1\n\n\n## H2');
        assert.equal(normalize(page, ' ## indented'), '## indented');
    } finally {
        page.close();
    }
});

test('normalizeMarkdownSpacing: a heading at the very start keeps its level', async () => {
    const page = await openShellPage();
    try {
        assert.equal(normalize(page, '### Sub'), '### Sub');
        assert.equal(normalize(page, '#### Deeper\ntext'), '#### Deeper\n\ntext');
        assert.equal(normalize(page, '\n### After a newline'), '### After a newline');
        assert.equal(normalize(page, '###### Six'), '###### Six');
        assert.equal(normalize(page, '####### seven is not a heading'), '####### seven is not a heading');
    } finally {
        page.close();
    }
});

test('normalizeMarkdownSpacing: horizontal rules are separated from the text around them', async () => {
    const page = await openShellPage();
    try {
        assert.equal(normalize(page, 'text --- more'), 'text\n\n---\n\nmore');
        assert.equal(normalize(page, 'text ---\nnext'), 'text\n\n---\n\nnext');
        assert.equal(normalize(page, '---\nnext'), '---\n\nnext');
        assert.equal(normalize(page, '---\n---'), '---\n\n---');
        assert.equal(normalize(page, 'x\n\n---\n\ny'), 'x\n\n---\n\ny');
    } finally {
        page.close();
    }
});

test('normalizeMarkdownSpacing: long runs of blank lines are capped', async () => {
    const page = await openShellPage();
    try {
        assert.equal(normalize(page, 'one\n\n\n\n\n\n\ntwo'), 'one\n\n\n\ntwo');
        assert.equal(normalize(page, 'one\n\n\ntwo'), 'one\n\n\ntwo');
    } finally {
        page.close();
    }
});

test('renderAnswerMarkdown: marked output goes through DOMPurify with the answer allowlist', async () => {
    const page = await openShellPage();
    try {
        const seen = [];
        page.window.DOMPurify = { sanitize: (html, options) => { seen.push({ html, options }); return `[clean]${html}`; } };
        page.window.marked = { parse: (text) => `<p>${text}</p>` };
        assert.equal(page.call('renderAnswerMarkdown', 'Shalom'), '[clean]<p>Shalom</p>');
        const { options } = seen[0];
        assert.deepEqual(JSON.parse(JSON.stringify(options.USE_PROFILES)), { html: true });
        assert.ok(options.FORBID_ATTR.includes('data-onclick'), 'a model must not be able to carry a data-onclick');
        for (const tag of ['img', 'iframe', 'form', 'svg', 'style']) {
            assert.ok(options.FORBID_TAGS.includes(tag), `${tag} is forbidden in answers`);
        }
    } finally {
        page.close();
    }
});

test('renderAnswerMarkdown: spacing is normalised before parsing, and an empty answer says so', async () => {
    const page = await openShellPage();
    try {
        const parsed = [];
        page.window.marked = { parse: (text) => { parsed.push(text); return text; } };
        page.call('renderAnswerMarkdown', 'Lead ## Heading');
        page.call('renderAnswerMarkdown', '');
        page.call('renderAnswerMarkdown', null);
        assert.deepEqual(parsed, ['Lead\n\n\n## Heading', 'No synthesis available.', 'No synthesis available.']);
    } finally {
        page.close();
    }
});

test('renderAnswerMarkdown: without DOMPurify the parsed HTML is returned as parsed', async () => {
    const page = await openShellPage();
    try {
        page.window.DOMPurify = undefined;
        page.window.marked = { parse: (text) => `<p>${text}</p>` };
        assert.equal(page.call('renderAnswerMarkdown', 'hi'), '<p>hi</p>');
        page.window.DOMPurify = {};
        assert.equal(page.call('renderAnswerMarkdown', 'hi'), '<p>hi</p>', 'a DOMPurify without sanitize() does not count');
    } finally {
        page.close();
    }
});

test('renderAnswerMarkdown: without marked the text is escaped and line breaks survive', async () => {
    const page = await openShellPage();
    try {
        page.window.marked = undefined;
        assert.equal(
            page.call('renderAnswerMarkdown', `Tom & "Jerry" <b>'s\nsecond`),
            'Tom &amp; &quot;Jerry&quot; &lt;b&gt;&#39;s<br>second',
        );
        page.window.marked = {};
        assert.equal(page.call('renderAnswerMarkdown', '<i>x</i>'), '&lt;i&gt;x&lt;/i&gt;', 'a marked without parse() does not count');
    } finally {
        page.close();
    }
});

test('disclaimerBannerText: one message per kind, in the page language', async () => {
    const page = await openShellPage();
    try {
        const texts = ['breaker', 'referral', 'standard', 'anything else'].map((kind) => page.call('disclaimerBannerText', kind));
        assert.match(texts[0], /AI answers are paused for today/);
        assert.match(texts[1], /safety or wellbeing/);
        assert.match(texts[2], /not a binding halachic ruling/);
        assert.equal(texts[3], texts[2], 'unknown kinds read as the standard note');
        page.eval(`t = (en, he) => he`);
        assert.match(page.call('disclaimerBannerText', 'breaker'), /מושהות להיום/);
        assert.match(page.call('disclaimerBannerText', 'referral'), /בטיחות או לרווחה/);
        assert.match(page.call('disclaimerBannerText'), /פסיקה הלכתית מחייבת/);
    } finally {
        page.close();
    }
});

const banner = (page, ...args) => {
    const element = page.document.createElement('div');
    element.className = 'hidden';
    page.window.__banner = element;
    page.eval(`renderDisclaimerBanner(window.__banner, ${args.map((arg) => JSON.stringify(arg)).join(', ')})`);
    return element;
};

test('renderDisclaimerBanner: nowhere to draw is a no-op', async () => {
    const page = await openShellPage();
    try {
        assert.equal(page.eval('renderDisclaimerBanner(null, "medical", false)'), undefined);
    } finally {
        page.close();
    }
});

test('renderDisclaimerBanner: an ordinary answer gets the quiet note', async () => {
    const page = await openShellPage();
    try {
        const element = banner(page, 'ok', false);
        assert.equal(element.classList.contains('hidden'), false);
        assert.equal(element.getAttribute('role'), 'note');
        assert.equal(element.classList.contains('ai-disclaimer-banner--referral'), false);
        assert.equal(element.classList.contains('ai-disclaimer-banner--breaker-paused'), false);
        assert.match(element.querySelector('.ai-disclaimer-banner-text').textContent, /not a binding halachic ruling/);
        assert.ok(element.querySelector('.ai-disclaimer-banner-icon svg path'), 'the icon is drawn');
        assert.equal(element.querySelector('.ai-disclaimer-banner-icon').getAttribute('aria-hidden'), 'true');
        const missing = banner(page);
        assert.equal(missing.getAttribute('role'), 'note', 'no safety class is read as ok');
    } finally {
        page.close();
    }
});

test('renderDisclaimerBanner: safety-referral classes get the prominent alert', async () => {
    const page = await openShellPage();
    try {
        for (const safetyClass of ['medical', 'mental_health_or_self_harm', 'abuse_or_minor_safety', 'dangerous_or_illegal']) {
            const element = banner(page, safetyClass, false);
            assert.equal(element.getAttribute('role'), 'alert', safetyClass);
            assert.equal(element.classList.contains('ai-disclaimer-banner--referral'), true, safetyClass);
            assert.match(element.textContent, /safety or wellbeing/, safetyClass);
        }
        const intimate = banner(page, 'sensitive_intimate', false);
        assert.equal(intimate.getAttribute('role'), 'note', 'answered under the age-appropriate directive, not blocked');
    } finally {
        page.close();
    }
});

test('renderDisclaimerBanner: the paused-budget notice wins over a referral class', async () => {
    const page = await openShellPage();
    try {
        const element = banner(page, 'medical', true);
        assert.equal(element.getAttribute('role'), 'status');
        assert.equal(element.classList.contains('ai-disclaimer-banner--breaker-paused'), true);
        assert.equal(element.classList.contains('ai-disclaimer-banner--referral'), false);
        assert.match(element.textContent, /AI answers are paused for today/);
        const again = banner(page, 'ok', false);
        assert.equal(again.classList.contains('ai-disclaimer-banner--breaker-paused'), false);
    } finally {
        page.close();
    }
});

test('renderDisclaimerBanner: the message is text, never markup', async () => {
    const page = await openShellPage();
    try {
        page.eval(`t = () => '<img src=x onerror=alert(1)> & more'`);
        const element = banner(page, 'ok', false);
        assert.equal(element.querySelector('img'), null);
        assert.equal(element.querySelector('.ai-disclaimer-banner-text').textContent, '<img src=x onerror=alert(1)> & more');
    } finally {
        page.close();
    }
});

// --- delayed tooltips --------------------------------------------------------

/** The page's listeners see isTrusted=false for synthetic events; wrap mouseover so tests can pass as the user. */
async function openTooltipPage() {
    return openShellPage({
        before: (window) => {
            const add = window.document.addEventListener.bind(window.document);
            const asUser = (event) => new Proxy(event, {
                get(target, key) {
                    if (key === 'isTrusted') return true;
                    const value = Reflect.get(target, key);
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });
            window.document.addEventListener = (type, listener, options) => (
                type === 'mouseover' ? add(type, (event) => listener(asUser(event)), options) : add(type, listener, options)
            );
        },
    });
}

const addButton = (page, html) => {
    page.document.body.insertAdjacentHTML('beforeend', html);
    return page.document.body.lastElementChild;
};
const hover = (page, element, type = 'mouseover', init = {}) => {
    element.dispatchEvent(new page.window.MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
};
const tooltip = (page) => page.$('#delayedTooltip');

test('getTooltipText: language data attribute, then data-tooltip, then data-title, then title', async () => {
    const page = await openTooltipPage();
    try {
        const text = (html) => page.call('getTooltipText', addButton(page, html));
        assert.equal(page.call('getTooltipText', null), '');
        assert.equal(text('<button class="x" data-en=" English " data-he="עברית" data-tooltip="tip">b</button>'), 'English');
        assert.equal(text('<button class="x" data-he="עברית" data-tooltip=" tip ">b</button>'), 'tip');
        assert.equal(text('<button class="x" data-title="Genesis%201%3A1" title="plain">b</button>'), 'Genesis 1:1');
        assert.equal(text('<button class="x" title=" plain ">b</button>'), 'plain');
        assert.equal(text('<button class="x">b</button>'), '');
        page.eval(`getCurrentLanguage = () => 'he'`);
        assert.equal(text('<button class="x" data-en="English" data-he="עברית">b</button>'), 'עברית');
    } finally {
        page.close();
    }
});

test('hovering a chapter button for a moment shows its tooltip above it, clamped to the window', async () => {
    const page = await openTooltipPage();
    try {
        const timers = [];
        page.window.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
        const button = addButton(page, '<button class="chapter-grid-item" data-tooltip="Chapter one">1</button>');
        button.getBoundingClientRect = () => ({ left: 100, top: 200, width: 40, height: 30 });
        hover(page, button);
        assert.equal(tooltip(page), null, 'nothing shows at once');
        assert.deepEqual(timers.map((timer) => timer.ms), [1100]);
        timers[0].fn();
        const bubble = tooltip(page);
        assert.equal(bubble.textContent, 'Chapter one');
        assert.equal(bubble.className, 'delayed-tooltip visible');
        assert.deepEqual([bubble.style.left, bubble.style.top], ['120px', '190px']);

        button.getBoundingClientRect = () => ({ left: -50, top: 4, width: 10, height: 30 });
        page.call('showDelayedTooltip', button);
        assert.deepEqual([bubble.style.left, bubble.style.top], ['16px', '16px'], 'kept inside the top-left margin');
        button.getBoundingClientRect = () => ({ left: 5000, top: 300, width: 40, height: 30 });
        page.call('showDelayedTooltip', button);
        assert.equal(bubble.style.left, `${page.window.innerWidth - 16}px`, 'kept inside the right margin');
        assert.equal(page.$$('#delayedTooltip').length, 1, 'the one bubble is reused');
    } finally {
        page.close();
    }
});

test('a title is moved to data-tooltip so the browser\'s own tooltip does not double up', async () => {
    const page = await openTooltipPage();
    try {
        page.window.setTimeout = () => 1;
        const link = addButton(page, '<button class="library-node-open" title="Open Genesis">Genesis</button>');
        hover(page, link);
        assert.equal(link.hasAttribute('title'), false);
        assert.equal(link.dataset.tooltip, 'Open Genesis');
        hover(page, link);
        assert.equal(link.dataset.tooltip, 'Open Genesis', 'a second hover keeps it');
    } finally {
        page.close();
    }
});

test('hovering anything else, or something with no tooltip text, schedules nothing', async () => {
    const page = await openTooltipPage();
    try {
        const timers = [];
        page.window.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
        hover(page, addButton(page, '<button class="plain">x</button>'));
        hover(page, addButton(page, '<button class="chapter-grid-item">2</button>'));
        assert.deepEqual(timers, []);
        hover(page, addButton(page, '<button class="chapter-grid-item" data-tooltip="Has text">3</button>'));
        assert.equal(timers.length, 1, 'the same hover with text does schedule one');
        page.call('showDelayedTooltip', addButton(page, '<button class="chapter-grid-item">no text</button>'));
        assert.equal(tooltip(page), null, 'showing a tooltip with no text draws nothing');
    } finally {
        page.close();
    }
});

test('a script-made hover (not the reader\'s mouse) is ignored', async () => {
    const page = await openShellPage();
    try {
        const timers = [];
        page.window.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
        const button = addButton(page, '<button class="chapter-grid-item" data-tooltip="Tip">1</button>');
        hover(page, button);
        assert.deepEqual(timers, [], 'event.isTrusted is false');
    } finally {
        page.close();
    }
});

test('a touch or pen hover is ignored', async () => {
    const page = await openTooltipPage();
    try {
        const timers = [];
        page.window.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
        const button = addButton(page, '<button class="chapter-grid-item" data-tooltip="Tip">1</button>');
        const touch = new page.window.MouseEvent('mouseover', { bubbles: true });
        Object.defineProperty(touch, 'pointerType', { value: 'touch' });
        button.dispatchEvent(touch);
        assert.deepEqual(timers, []);
        const mouse = new page.window.MouseEvent('mouseover', { bubbles: true });
        Object.defineProperty(mouse, 'pointerType', { value: 'mouse' });
        button.dispatchEvent(mouse);
        assert.equal(timers.length, 1);
    } finally {
        page.close();
    }
});

test('leaving the button, scrolling or pressing the mouse hides the tooltip and cancels a pending one', async () => {
    const page = await openTooltipPage();
    try {
        const timers = [];
        const cleared = [];
        page.window.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
        page.window.clearTimeout = (id) => cleared.push(id);
        const button = addButton(page, '<button class="chapter-grid-item" data-tooltip="Tip"><span class="inner">1</span></button>');
        const outside = addButton(page, '<p>elsewhere</p>');

        hover(page, button);
        hover(page, button, 'mouseout', { relatedTarget: outside });
        assert.deepEqual(cleared, [1], 'the pending tooltip is cancelled');

        timers[0].fn();
        assert.equal(tooltip(page).classList.contains('visible'), true);
        hover(page, button, 'mouseout', { relatedTarget: button.querySelector('.inner') });
        assert.equal(tooltip(page).classList.contains('visible'), true, 'moving onto a child keeps it');
        hover(page, button, 'mouseout', { relatedTarget: null });
        assert.equal(tooltip(page).classList.contains('visible'), false, 'leaving the page hides it');

        timers[0].fn();
        page.document.dispatchEvent(new page.window.Event('scroll'));
        assert.equal(tooltip(page).classList.contains('visible'), false, 'scrolling hides it');
        timers[0].fn();
        page.document.dispatchEvent(new page.window.MouseEvent('mousedown', { bubbles: true }));
        assert.equal(tooltip(page).classList.contains('visible'), false, 'pressing hides it');

        hover(page, outside, 'mouseout');
        assert.equal(tooltip(page).classList.contains('visible'), false, 'leaving a plain element does nothing');
        page.call('hideDelayedTooltip');
    } finally {
        page.close();
    }
});

test('hideDelayedTooltip before any tooltip exists is harmless', async () => {
    const page = await openShellPage();
    try {
        page.eval('delayedTooltipEl = null; delayedTooltipTimer = null');
        assert.equal(page.call('hideDelayedTooltip'), undefined);
        assert.deepEqual(page.errors, []);
    } finally {
        page.close();
    }
});
