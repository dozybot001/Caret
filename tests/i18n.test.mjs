import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ARTICLES } from '../src/i18n/articles.js';
import { en } from '../src/i18n/en.js';
import { LEGAL_HISTORY } from '../src/i18n/legal-history.js';
import { zh } from '../src/i18n/zh.js';

test('中英文文案的键一一对应', () => {
    assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
    for (const key of Object.keys(zh)) assert.equal(typeof zh[key], typeof en[key], key);
});

test('说明和法律文本中英文段落数相同', () => {
    assert.deepEqual(Object.keys(ARTICLES.zh), Object.keys(ARTICLES.en));
    for (const page of Object.keys(ARTICLES.zh)) assert.equal(ARTICLES.zh[page].length, ARTICLES.en[page].length, page);
});

test('法律文本的历史版本中英文一一对应', () => {
    for (const page of ['privacy', 'terms']) {
        const outline = lang => LEGAL_HISTORY[lang][page].map(item => [item.version, item.sections.length]);
        assert.deepEqual(outline('zh'), outline('en'), page);
    }
});
