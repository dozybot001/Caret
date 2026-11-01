/**
 * @fileoverview Markdown 渲染
 * @description 把 Agent 的回复解析成结构，再用 DOM 接口生成节点，全程不拼接 HTML
 */

const FENCE = /^\s*(`{3,}|~{3,})\s*(\S*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const SAFE_LINK = /^(https?:|mailto:)/i;

const INLINE = new RegExp([
    '(`+)([\\s\\S]+?)\\1(?!`)',
    '\\*\\*([\\s\\S]+?)\\*\\*',
    '(?<![\\w*])\\*(?![\\s*])([\\s\\S]*?[^\\s*])\\*(?![\\w*])',
    '~~([\\s\\S]+?)~~',
    '\\[([^\\]\\n]+)\\]\\(((?:[^()\\s]|\\([^()\\s]*\\))+)\\)',
    '(https?:\\/\\/[^\\s<>()]+[^\\s<>().,;:!?，。；：！？])'
].join('|'), 'g');

const isTable = (lines, index) => lines[index].includes('|')
    && lines[index + 1]?.includes('|')
    && TABLE_DIVIDER.test(lines[index + 1]);

const isBlockStart = (lines, index) => [FENCE, HEADING, RULE, QUOTE, LIST_ITEM].some(pattern => pattern.test(lines[index]))
    || isTable(lines, index);

const splitRow = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

function parseList(lines, start) {
    const [, indent, marker] = lines[start].match(LIST_ITEM);
    const ordered = /\d/.test(marker);
    const block = { type: 'list', ordered, start: ordered ? parseInt(marker, 10) : 1, items: [] };

    let index = start;
    while (index < lines.length) {
        const line = lines[index];
        const match = line.match(LIST_ITEM);

        if (!line.trim()) {
            // 空行后还是这个列表的项时继续
            const next = lines[index + 1]?.match(LIST_ITEM);
            if (!next || next[1].length < indent.length) break;
            index++;
        } else if (match && match[1].length > indent.length) {
            const nested = parseList(lines, index);
            block.items.at(-1).children.push(nested.block);
            index = nested.next;
        } else if (match) {
            if (match[1].length < indent.length || /\d/.test(match[2]) !== ordered) break;
            block.items.push({ text: match[3], children: [] });
            index++;
        } else if (line.search(/\S/) > indent.length) {
            block.items.at(-1).text += `\n${line.trim()}`;
            index++;
        } else {
            break;
        }
    }
    return { block, next: index };
}

function parseBlocks(lines) {
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];
        const fence = line.match(FENCE);
        const heading = line.match(HEADING);

        if (!line.trim()) {
            index++;
        } else if (fence) {
            const code = [];
            index++;
            while (index < lines.length && !lines[index].trim().startsWith(fence[1])) code.push(lines[index++]);
            index++;
            blocks.push({ type: 'code', language: fence[2], text: code.join('\n') });
        } else if (heading) {
            blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
            index++;
        } else if (RULE.test(line)) {
            blocks.push({ type: 'rule' });
            index++;
        } else if (QUOTE.test(line)) {
            const quoted = [];
            while (index < lines.length && QUOTE.test(lines[index])) quoted.push(lines[index++].replace(QUOTE, ''));
            blocks.push({ type: 'quote', blocks: parseBlocks(quoted) });
        } else if (LIST_ITEM.test(line)) {
            const { block, next } = parseList(lines, index);
            blocks.push(block);
            index = next;
        } else if (isTable(lines, index)) {
            const header = splitRow(line);
            const rows = [];
            index += 2;
            while (index < lines.length && lines[index].includes('|')) rows.push(splitRow(lines[index++]));
            blocks.push({ type: 'table', header, rows });
        } else {
            const text = [line];
            index++;
            while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) text.push(lines[index++]);
            blocks.push({ type: 'paragraph', text: text.join('\n') });
        }
    }
    return blocks;
}

/**
 * 解析块级结构
 * @param {string} text - Markdown 文本
 * @returns {Array<Object>}
 */
export function parseMarkdown(text) {
    return parseBlocks(text.replace(/\r\n/g, '\n').split('\n'));
}

/**
 * 解析行内结构。只有 http、https 和 mailto 链接会成为链接
 * @param {string} text - 文本
 * @returns {Array<Object>}
 */
export function parseInline(text) {
    const nodes = [];
    let last = 0;

    for (const match of text.matchAll(INLINE)) {
        const [all, , code, strong, emphasis, deleted, label, href, url] = match;
        if (match.index > last) nodes.push({ type: 'text', text: text.slice(last, match.index) });

        if (code !== undefined) nodes.push({ type: 'code', text: code.replace(/^ | $/g, '') });
        else if (strong !== undefined) nodes.push({ type: 'strong', children: parseInline(strong) });
        else if (emphasis !== undefined) nodes.push({ type: 'emphasis', children: parseInline(emphasis) });
        else if (deleted !== undefined) nodes.push({ type: 'deleted', children: parseInline(deleted) });
        else if (url !== undefined) nodes.push({ type: 'link', href: url, children: [{ type: 'text', text: url }] });
        else if (SAFE_LINK.test(href)) nodes.push({ type: 'link', href, children: parseInline(label) });
        else nodes.push({ type: 'text', text: label });

        last = match.index + all.length;
    }

    if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) });
    return nodes;
}

function createInline(node) {
    if (node.type === 'text') return document.createTextNode(node.text);

    if (node.type === 'code') {
        const code = document.createElement('code');
        code.className = 'inline-code';
        code.textContent = node.text;
        return code;
    }

    const tag = { strong: 'strong', emphasis: 'em', deleted: 'del', link: 'a' }[node.type];
    const element = document.createElement(tag);
    if (node.type === 'link') {
        element.href = node.href;
        element.target = '_blank';
        element.rel = 'noopener noreferrer';
    }
    element.append(...node.children.map(createInline));
    return element;
}

function createText(tag, text) {
    const element = document.createElement(tag);
    element.append(...parseInline(text).map(createInline));
    return element;
}

function createTable({ header, rows }) {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrap';
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    head.append(...header.map(cell => createText('th', cell)));
    const body = table.createTBody();
    for (const row of rows) {
        body.insertRow().append(...row.map(cell => createText('td', cell)));
    }
    wrapper.appendChild(table);
    return wrapper;
}

function createList({ ordered, start, items }) {
    const list = document.createElement(ordered ? 'ol' : 'ul');
    if (ordered && start !== 1) list.start = start;
    for (const item of items) {
        const row = createText('li', item.text);
        row.append(...item.children.map(createBlock));
        list.appendChild(row);
    }
    return list;
}

function createBlock(block) {
    switch (block.type) {
        case 'heading':
            return createText(`h${block.level}`, block.text);
        case 'code': {
            const pre = document.createElement('pre');
            pre.className = 'code-block';
            pre.textContent = block.text;
            return pre;
        }
        case 'quote': {
            const quote = document.createElement('blockquote');
            quote.append(...block.blocks.map(createBlock));
            return quote;
        }
        case 'rule':
            return document.createElement('hr');
        case 'list':
            return createList(block);
        case 'table':
            return createTable(block);
        default:
            return createText('p', block.text);
    }
}

/**
 * 把 Markdown 渲染到容器里
 * @param {HTMLElement} container - 容器
 * @param {string} text - Markdown 文本
 */
export function renderMarkdown(container, text) {
    container.replaceChildren(...parseMarkdown(text).map(createBlock));
}
