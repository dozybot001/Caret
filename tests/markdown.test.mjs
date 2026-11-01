import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseInline, parseMarkdown } from '../src/chat/markdown.js';

test('Markdown 解析块级结构', () => {
    const blocks = parseMarkdown([
        '# 标题', '', '第一段', '第二行', '', '- 一', '  - 嵌套', '- 二', '', '3. 三', '4. 四', '',
        '> 引用', '', '---', '', '```js', 'const a = 1;', '```', '', '| 名称 | 值 |', '| --- | --- |', '| a | 1 |'
    ].join('\n'));

    assert.deepEqual(blocks.map(block => block.type), ['heading', 'paragraph', 'list', 'list', 'quote', 'rule', 'code', 'table']);
    assert.equal(blocks[0].level, 1);
    assert.equal(blocks[1].text, '第一段\n第二行');
    assert.deepEqual(blocks[2].items.map(item => item.text), ['一', '二']);
    assert.equal(blocks[2].items[0].children[0].items[0].text, '嵌套');
    assert.deepEqual([blocks[3].ordered, blocks[3].start], [true, 3]);
    assert.deepEqual([blocks[6].language, blocks[6].text], ['js', 'const a = 1;']);
    assert.deepEqual([blocks[7].header, blocks[7].rows], [['名称', '值'], [['a', '1']]]);
});

test('Markdown 没有写完时也能显示', () => {
    assert.deepEqual(parseMarkdown('```js\nconst a'), [{ type: 'code', language: 'js', text: 'const a' }]);
    assert.deepEqual(parseInline('**还没写完'), [{ type: 'text', text: '**还没写完' }]);
});

test('Markdown 解析行内结构，不误伤代码和普通星号', () => {
    assert.deepEqual(parseInline('改 `a*b*c` 和 **重点**').map(node => node.type), ['text', 'code', 'text', 'strong']);
    assert.deepEqual(parseInline('2*3*4 不是斜体'), [{ type: 'text', text: '2*3*4 不是斜体' }]);
    assert.equal(parseInline('*斜体*')[0].type, 'emphasis');
    assert.equal(parseInline('~~删除~~')[0].type, 'deleted');
    assert.equal(parseInline('__init__.py')[0].text, '__init__.py');
    assert.deepEqual(parseInline('见 https://tenon.asia/。').map(node => node.href ?? node.text), ['见 ', 'https://tenon.asia/', '。']);
});

test('Markdown 链接只允许 http、https 和 mailto', () => {
    assert.equal(parseInline('[官网](https://tenon.asia/)')[0].href, 'https://tenon.asia/');
    assert.equal(parseInline('[邮件](mailto:a@b.c)')[0].href, 'mailto:a@b.c');
    assert.equal(parseInline('[维基](https://a.org/b_(c))')[0].href, 'https://a.org/b_(c)');
    assert.deepEqual(parseInline('[点我](javascript:alert(1))'), [{ type: 'text', text: '点我' }]);
});
