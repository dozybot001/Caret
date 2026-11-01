import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PromptRecall } from '../src/chat/prompt-recall.js';

const textarea = (value, caret = value.length) => ({ value, selectionStart: caret, selectionEnd: caret });

test('上下键翻看提示词，最后回到原来的内容', () => {
    const recall = new PromptRecall();
    recall.load(['第一条', '第二条']);
    assert.equal(recall.previous(textarea('')), '第二条');
    assert.equal(recall.previous(textarea('第二条')), '第一条');
    assert.equal(recall.previous(textarea('第一条')), '第一条');
    assert.equal(recall.next(textarea('第一条')), '第二条');
    assert.equal(recall.next(textarea('第二条')), '');
    assert.equal(recall.next(textarea('')), null);
});

test('上键不打断正在编辑的内容', () => {
    const recall = new PromptRecall();
    recall.load(['第一条']);
    assert.equal(recall.previous(textarea('写到一半')), null);
    assert.equal(recall.previous(textarea('写到一半', 0)), '第一条');
    assert.equal(recall.next(textarea('第一条')), '写到一半');
    assert.equal(new PromptRecall().previous(textarea('')), null);
});

test('多行提示词里上下键先移动光标', () => {
    const recall = new PromptRecall();
    recall.load(['第一条', '一\n二']);
    assert.equal(recall.previous(textarea('')), '一\n二');
    assert.equal(recall.previous(textarea('一\n二')), null);
    assert.equal(recall.previous(textarea('一\n二', 1)), '第一条');
    assert.equal(recall.next(textarea('第一条')), '一\n二');
    assert.equal(recall.next(textarea('一\n二', 1)), null);
    assert.equal(recall.next(textarea('一\n二')), '');
});
