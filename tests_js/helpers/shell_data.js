/**
 * Payload builders for the shell.js page tests: the JSON the app's own API
 * answers, as small as the page's code needs.
 */
'use strict';

/** `GET /api/text/<ref>`: one chapter, `lines` of {segment, he, en}. */
function textPayload(ref, lines, extra = {}) {
    return {
        ref,
        title: ref,
        heTitle: ref,
        categories: ['Tanakh', 'Torah'],
        lines: lines.map(([segment, he, en]) => ({ segment, he, en })),
        next: '',
        prev: '',
        ...extra,
    };
}

const GENESIS_1 = textPayload('Genesis 1', [
    ['1', 'בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים', 'In the beginning God created'],
    ['2', 'וְהָאָ֗רֶץ הָיְתָ֥ה תֹ֙הוּ֙', 'and the earth was unformed'],
    ['3', 'וַיֹּ֥אמֶר אֱלֹהִ֖ים יְהִ֣י א֑וֹר', 'God said, “Let there be light”'],
]);

module.exports = { textPayload, GENESIS_1 };
