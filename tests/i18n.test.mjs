import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ARTICLES } from '../src/i18n/articles.js';
import { en } from '../src/i18n/en.js';
import { zh } from '../src/i18n/zh.js';

test('中英文文案的键一一对应', () => {
    assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
    for (const key of Object.keys(zh)) assert.equal(typeof zh[key], typeof en[key], key);
});

test('说明和法律文本中英文段落数相同', () => {
    assert.deepEqual(Object.keys(ARTICLES.zh), Object.keys(ARTICLES.en));
    for (const page of Object.keys(ARTICLES.zh)) assert.equal(ARTICLES.zh[page].length, ARTICLES.en[page].length, page);
});
