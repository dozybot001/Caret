// 工具和 Agent 循环的测试：node --test test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { Agent } from './src/agent/agent.js';
import { SessionHistory } from './src/chat/history.js';
import { parseInline, parseMarkdown } from './src/chat/markdown.js';
import { PromptRecall } from './src/chat/prompt-recall.js';
import { countChanges } from './src/agent/diff.js';
import { collectMessage, isContextError, listModels, readEvents } from './src/agent/model.js';
import { executeTool, normalizePath, outline, replaceText, TOOL_SCHEMAS } from './src/agent/tools.js';
import { FileManager } from './src/file-tree/file-manager.js';
import { parseGitHead, parseGitIndex, readGitStatus } from './src/file-tree/git-status.js';

/** 内存工作区 */
function workspace(files = {}) {
    const state = new Map(Object.entries(files));
    return {
        name: 'demo',
        state,
        async refresh() {},
        paths: () => [...state.keys()],
        isDirectory: path => [...state.keys()].some(file => file.startsWith(`${path}/`)),
        getText: async path => (state.has(path) ? { text: state.get(path) } : null),
        setText: async (path, text) => void state.set(path, text)
    };
}

const run = (ws, name, args) => executeTool(ws, name, args);

test('只提供 read、write、edit 三个工具', () => {
    assert.deepEqual(TOOL_SCHEMAS.map(tool => tool.function.name), ['read', 'write', 'edit']);
});

test('edit 要求唯一匹配，多处命中时不修改文件', async () => {
    const source = 'function a() {\n  return 1;\n}\nfunction b() {\n  return 1;\n}\n';
    const ws = workspace({ 'a.js': source });
    const result = await run(ws, 'edit', { path: 'a.js', old: '  return 1;', new: '  return 2;' });
    assert.equal(result.ok, false);
    assert.match(result.output, /matches 2 places \(lines 2, 5\)/);
    assert.equal(ws.state.get('a.js'), source);
});

test('edit 不会改到子串：短文本同时命中两处时被拒绝', () => {
    const result = replaceText('const total_count = 1;\nconst count = 2;\n', 'count', 'n');
    assert.match(result.error, /matches 2 places/);
});

test('edit 没有匹配时告诉模型相近的位置', () => {
    const result = replaceText('    foo();\n    bar();\n', 'foo();\n  bar();', 'baz();');
    assert.match(result.error, /first line appears at:\n1:     foo\(\);/);
});

test('edit 用 all 替换全部，并接受 CRLF 输入', async () => {
    assert.equal(replaceText('a a a', 'a', 'b', true).text, 'b b b');
    assert.equal(replaceText('x\ny\n', 'x\r\ny', 'z').text, 'z\n');
});

test('read 能读取文件、分页、列目录和搜索', async () => {
    const ws = workspace({ 'src/a.js': 'const timeout = 30;\nconst Name = 1;\n', 'src/b.js': 'TIMEOUT\n', 'README.md': '# Demo\n' });

    assert.equal((await run(ws, 'read', { path: 'README.md' })).output, '# Demo\n');
    assert.match((await run(ws, 'read', { path: 'src/a.js', offset: 2, limit: 1 })).output, /^const Name = 1;\n\n\[Showing lines 2-2 of 3/);
    assert.equal((await run(ws, 'read', { path: 'src' })).output, 'a.js\nb.js');
    assert.equal((await run(ws, 'read', {})).verb, 'list');

    const insensitive = await run(ws, 'read', { pattern: 'timeout' });
    assert.equal(insensitive.verb, 'search');
    assert.equal(insensitive.output, 'src/a.js:1: const timeout = 30;\nsrc/b.js:1: TIMEOUT');

    assert.equal((await run(ws, 'read', { pattern: 'TIMEOUT' })).output, 'src/b.js:1: TIMEOUT');
    assert.equal((await run(ws, 'read', { path: 'src/a.js', pattern: 'Name' })).output, 'src/a.js:2: const Name = 1;');
    assert.equal((await run(ws, 'read', { pattern: '(unclosed' })).output, 'No matches.');
});

test('密钥文件不读取、不修改、不进入搜索结果', async () => {
    const ws = workspace({ '.env': 'SECRET=1\n', 'deploy/server.pem': 'SECRET', '.env.example': 'SECRET=\n' });
    const read = await run(ws, 'read', { path: '.env' });
    assert.equal(read.ok, false);
    assert.doesNotMatch(read.output, /SECRET=1/);
    assert.equal((await run(ws, 'edit', { path: '.env', old: '1', new: '2' })).ok, false);
    assert.equal((await run(ws, 'write', { path: 'a.pem', content: 'x' })).ok, false);
    assert.equal((await run(ws, 'read', { pattern: 'SECRET' })).output, '.env.example:1: SECRET=');
    assert.equal((await run(ws, 'read', { path: '.env.example' })).ok, true);
});

test('路径限制在项目内', async () => {
    assert.equal(normalizePath('./src//a.js'), 'src/a.js');
    assert.equal(normalizePath('/src/a.js'), 'src/a.js');
    assert.equal(normalizePath('src\\a.js'), 'src/a.js');
    assert.throws(() => normalizePath('../secret'));
    assert.throws(() => normalizePath('.git/config'));
    assert.throws(() => normalizePath('.intent/snaps/a.json'));
    assert.equal((await run(workspace(), 'read', { path: '../secret' })).ok, false);
    assert.equal((await run(workspace(), 'write', { path: '.intent/intents/a.json', content: '{}' })).ok, false);
});

test('write 新建文件，并保留原文件末尾换行的习惯', async () => {
    const ws = workspace({ 'a.txt': 'old\n' });
    assert.equal((await run(ws, 'write', { path: 'b/c.txt', content: 'new' })).verb, 'create');
    assert.equal(ws.state.get('b/c.txt'), 'new');
    assert.equal((await run(ws, 'write', { path: 'a.txt', content: 'changed' })).verb, 'rewrite');
    assert.equal(ws.state.get('a.txt'), 'changed\n');
    assert.equal((await run(ws, 'write', { path: 'b', content: 'x' })).ok, false);
});

test('未知工具的错误交回模型', async () => {
    assert.match((await run(workspace(), 'bash', { command: 'ls' })).output, /Available tools: read, write, edit/);
});

test('目录概览在文件太多时折叠深层目录', () => {
    const paths = Array.from({ length: 500 }, (_, index) => `src/deep/file${index}.js`).concat('README.md');
    assert.equal(outline(paths, '', 5), 'README.md\nsrc/deep/ (500 files)');
    assert.equal(outline(['src/a.js', 'README.md'], 'src'), 'a.js');
    assert.equal(outline([], ''), 'Empty directory.');
});

test('countChanges 精确统计多处改动', () => {
    const before = Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n');
    const lines = before.split('\n');
    lines[3] = 'changed';
    lines[90] = 'changed too';
    lines.splice(50, 0, 'inserted');
    assert.deepEqual(countChanges(before, lines.join('\n')), { added: 3, removed: 2 });
    assert.deepEqual(countChanges('', 'a\nb\n'), { added: 2, removed: 0 });
    assert.deepEqual(countChanges('a\n', 'a\n'), { added: 0, removed: 0 });
});

test('流式响应合并文本、分片的工具调用和 reasoning_content', async () => {
    const lines = [
        { choices: [{ delta: { reasoning_content: '想' } }] },
        { choices: [{ delta: { reasoning_content: '一想' } }] },
        { choices: [{ delta: { content: '好' } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read', arguments: '{"pa' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a"}' } }] } }] }
    ];
    const raw = `${lines.map(line => `data: ${JSON.stringify(line)}\n\n`).join('')}data: [DONE]\n\n`;
    // 按任意位置切开，模拟网络分片
    const bytes = new TextEncoder().encode(raw);
    const stream = new ReadableStream({
        start(controller) {
            for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.slice(index, index + 7));
            controller.close();
        }
    });

    const seen = [];
    const message = await collectMessage(readEvents(stream), { onText: text => seen.push(text) });
    assert.deepEqual(seen, ['好']);
    assert.equal(message.content, '好');
    assert.equal(message.reasoning_content, '想一想');
    assert.deepEqual(message.tool_calls, [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"a"}' } }]);
});

/** 按脚本回复的模型服务 */
function scriptedModel(replies) {
    const requests = [];
    globalThis.fetch = async (url, options) => {
        requests.push(JSON.parse(options.body));
        const reply = replies.shift();
        if (reply.status) return new Response(JSON.stringify({ error: { message: reply.message } }), { status: reply.status });
        const delta = reply.tool
            ? { tool_calls: [{ index: 0, id: `call_${requests.length}`, function: { name: reply.tool, arguments: JSON.stringify(reply.args) } }] }
            : { content: reply.text };
        return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    };
    return requests;
}

const connection = () => ({ url: 'https://model.test/v1', key: 'test', model: 'm' });

test('Agent 循环：读、改、失败后重试，直到模型不再调用工具', async () => {
    const ws = workspace({ 'a.js': 'const a = 1;\n' });
    const requests = scriptedModel([
        { tool: 'read', args: { path: 'a.js' } },
        { tool: 'edit', args: { path: 'a.js', old: 'const b', new: 'const c' } },
        { tool: 'edit', args: { path: 'a.js', old: 'a = 1', new: 'a = 2' } },
        { text: '改好了' }
    ]);

    const steps = [];
    const agent = new Agent(ws, connection, { onStepEnd: (_, result) => steps.push([result.verb, result.ok]) });
    assert.equal(await agent.send('把 a 改成 2'), 'done');

    assert.equal(ws.state.get('a.js'), 'const a = 2;\n');
    assert.deepEqual(steps, [['read', true], ['edit', false], ['edit', true]]);
    assert.equal(requests.length, 4);
    assert.doesNotMatch(requests[0].messages[0].content, /a\.js/);
    assert.deepEqual(requests[0].tools.map(tool => tool.function.name), ['read', 'write', 'edit']);
    assert.equal(requests[3].messages.at(-1).role, 'tool');
    assert.equal(requests[3].messages.at(-1).content, 'Edited a.js');
});

test('用户在编辑器里的决定随下一条消息告诉模型', async () => {
    const requests = scriptedModel([{ text: '好' }]);
    const agent = new Agent(workspace(), connection, {});
    agent.addNote('[The user discarded the changes to: a.js.]');
    await agent.send('继续');
    assert.equal(requests[0].messages.at(-1).content, '[The user discarded the changes to: a.js.]\n\n继续');
    assert.deepEqual(agent.pendingNotes, []);
});

test('停止后补齐工具结果，下一次请求仍然合法', async () => {
    const ws = workspace({ 'a.js': 'x\n', 'b.js': 'y\n' });
    let agent;
    globalThis.fetch = async () => {
        const delta = { tool_calls: [
            { index: 0, id: 'one', function: { name: 'read', arguments: '{"path":"a.js"}' } },
            { index: 1, id: 'two', function: { name: 'read', arguments: '{"path":"b.js"}' } }
        ] };
        return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    };
    agent = new Agent(ws, connection, { onStepEnd: () => agent.stop() });
    assert.equal(await agent.send('读'), 'stopped');

    const results = agent.messages.filter(message => message.role === 'tool');
    assert.deepEqual(results.map(message => message.tool_call_id), ['one', 'two']);
    assert.equal(results[1].content, 'Stopped by the user.');
});

test('模型服务报错时保留上下文，可以重试', async () => {
    const ws = workspace();
    scriptedModel([{ status: 401, message: 'bad key' }, { text: '好' }]);
    const agent = new Agent(ws, connection, {});
    await assert.rejects(agent.send('改'), error => error.status === 401 && error.message === 'bad key');
    assert.equal(agent.running, false);
    assert.equal(await agent.resume(), 'done');
});

test('系统提示词带上项目规则，并要求长期规则写进同一个文件', async () => {
    const requests = scriptedModel([{ text: '好' }, { text: '好' }]);
    await new Agent(workspace({ 'AGENTS.md': '- 用中文注释\n' }), connection, {}).send('改');
    const withRules = requests[0].messages[0].content;
    assert.match(withRules, /Project instructions from AGENTS\.md:\n- 用中文注释/);
    assert.match(withRules, /add one short line to AGENTS\.md\./);

    await new Agent(workspace({ 'CLAUDE.md': 'x'.repeat(9000) }), connection, {}).send('改');
    const truncated = requests[1].messages[0].content;
    assert.match(truncated, /add one short line to CLAUDE\.md\./);
    assert.match(truncated, /\[Truncated\. Read CLAUDE\.md for the rest\.\]/);
});

test('恢复对话时补齐工具结果，并提醒模型重新读取文件', async () => {
    const requests = scriptedModel([{ text: '好' }]);
    const agent = new Agent(workspace(), connection, {});
    agent.restore([
        { role: 'user', content: '改' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'one', type: 'function', function: { name: 'read', arguments: '{}' } }] }
    ]);
    await agent.send('继续');
    const { messages } = requests[0];
    assert.equal(messages.find(message => message.tool_call_id === 'one').content, 'Stopped by the user.');
    assert.match(messages.at(-1).content, /^\[This conversation was resumed from history/);
    assert.match(messages.at(-1).content, /继续$/);
});

/** 内存存储 */
function memoryStore() {
    const projects = new Map();
    const sessions = new Map();
    const data = new Map();
    return {
        data,
        listProjects: async () => [...projects.values()],
        saveProject: async project => void projects.set(project.id, project),
        listSessions: async () => [...sessions.values()],
        getSessionData: async id => data.get(id),
        saveSession: async (session, content) => {
            sessions.set(session.id, session);
            data.set(session.id, structuredClone(content));
        },
        deleteSessions: async ids => ids.forEach(id => {
            sessions.delete(id);
            data.delete(id);
        }),
        clearConversations: async () => {
            sessions.clear();
            data.clear();
            projects.forEach((project, id) => projects.set(id, { ...project, prompts: [] }));
        }
    };
}

const folder = (name, id = name) => ({ name, id, isSameEntry: async other => other.id === id });

test('历史记录按文件夹隔离，同名的不同文件夹互不影响', async () => {
    const history = new SessionHistory(memoryStore());
    const a = folder('app', 'a');
    const b = folder('app', 'b');

    await history.openProject(a);
    history.begin('第一个  项目\n的任务');
    history.schedule(() => ({ messages: [1], timeline: [] }));
    await history.flush();

    await history.openProject(b);
    assert.deepEqual(await history.list(), []);
    assert.equal(history.currentId, null);

    await history.openProject(a);
    const [session] = await history.list();
    assert.equal(session.title, '第一个 项目 的任务');
    assert.deepEqual((await history.open(session.id)).messages, [1]);
    assert.equal(history.currentId, session.id);
});

test('历史记录合并连续保存，继续对话时更新同一条记录', async () => {
    const store = memoryStore();
    const history = new SessionHistory(store);
    await history.openProject(folder('app'));
    history.begin('任务');

    for (const step of [1, 2, 3]) history.schedule(() => ({ messages: [step], timeline: [] }));
    await history.flush();
    assert.equal(store.data.size, 1);
    assert.deepEqual([...store.data.values()][0].messages, [3]);

    history.begin('不会覆盖标题');
    history.schedule(() => ({ messages: [4], timeline: [] }));
    await history.flush();
    assert.equal(store.data.size, 1);
    assert.equal((await history.list())[0].title, '任务');
});

test('历史记录只保留最新的 100 条，删除当前会话后不再写入', async () => {
    const store = memoryStore();
    const history = new SessionHistory(store);
    await history.openProject(folder('app'));

    for (let index = 0; index < 103; index++) {
        await history.close();
        history.begin(`任务 ${index}`);
        history.schedule(() => ({ messages: [], timeline: [] }));
        await history.flush();
    }
    const sessions = await history.list();
    assert.equal(sessions.length, 100);
    assert.ok(sessions.some(session => session.title === '任务 102'));

    const { currentId } = history;
    history.schedule(() => ({ messages: ['late'], timeline: [] }));
    await history.remove([currentId]);
    await history.flush();
    assert.equal(store.data.has(currentId), false);
    assert.equal(history.currentId, null);
});

test('保存失败不影响任务，错误交给界面提示', async () => {
    const store = memoryStore();
    store.saveSession = async () => { throw new Error('quota'); };
    const history = new SessionHistory(store);
    const errors = [];
    history.onError = error => errors.push(error.message);
    await history.openProject(folder('app'));
    history.begin('任务');
    history.schedule(() => ({ messages: [], timeline: [] }));
    await history.flush();
    assert.deepEqual(errors, ['quota']);
});

test('系统提示词保持极简，不带文件列表', async () => {
    const requests = scriptedModel([{ text: '好' }]);
    const files = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`src/file${index}.js`, 'x']));
    await new Agent(workspace(files), connection, {}).send('改');
    const system = requests[0].messages[0].content;
    assert.ok(system.length < 900, `提示词有 ${system.length} 个字符`);
    assert.doesNotMatch(system, /file0\.js/);
    assert.ok(JSON.stringify(requests[0].tools).length < 1300);
});

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

test('提示词按项目保存，重复的只留最新一条', async () => {
    const store = memoryStore();
    const history = new SessionHistory(store);
    const a = folder('a');
    await history.openProject(a);
    for (const text of ['一', '二', '一']) history.rememberPrompt(text);
    assert.deepEqual(history.prompts(), ['二', '一']);

    await history.openProject(folder('b'));
    assert.deepEqual(history.prompts(), []);
    await history.openProject(a);
    assert.deepEqual(history.prompts(), ['二', '一']);
});

/** 每个文件约 56k 字符，接近 read 单次返回的上限 */
const bigFiles = count => Object.fromEntries(Array.from({ length: count }, (_, index) => [`${index}.txt`, `${'x'.repeat(79)}\n`.repeat(700)]));
const readFiles = count => Array.from({ length: count }, (_, index) => ({ tool: 'read', args: { path: `${index}.txt` } }));
const CLEARED = /^\[Output removed/;

test('上下文到压缩线时清理较早的工具结果，只保留最近的', async () => {
    const requests = scriptedModel([...readFiles(9), { text: '好' }]);
    let compactions = 0;
    const agent = new Agent(workspace(bigFiles(9)), connection, { onCompact: () => compactions++ });
    await agent.send('读');

    assert.equal(compactions, 1);
    const results = requests[8].messages.filter(message => message.role === 'tool');
    assert.equal(results.length, 8);
    assert.ok(results.slice(0, 7).every(message => CLEARED.test(message.content)));
    assert.ok(results[7].content.length > 50000);
    assert.deepEqual(results.map(message => message.tool_call_id), [1, 2, 3, 4, 5, 6, 7, 8].map(index => `call_${index}`));
    assert.ok(agent.contextUsage < 50);
});

test('清理时不动短结果，上下文没到压缩线时不清理', async () => {
    const short = { role: 'tool', tool_call_id: 'call_1', content: 'Edited a.js' };
    const agent = new Agent(workspace(bigFiles(1)), connection, {});
    agent.messages = [short, ...Array.from({ length: 8 }, (_, index) => ({ role: 'tool', tool_call_id: `call_${index + 2}`, content: 'x'.repeat(56000) }))];
    const requests = scriptedModel([{ text: '好' }]);
    await agent.resume();
    assert.equal(requests[0].messages[1].content, 'Edited a.js');

    const small = new Agent(workspace(), connection, {});
    small.messages = [{ role: 'user', content: '改' }, { role: 'tool', tool_call_id: 'call_1', content: 'x'.repeat(90000) }];
    const untouched = scriptedModel([{ text: '好' }]);
    await small.resume();
    assert.equal(untouched[0].messages[2].content.length, 90000);
});

test('模型报上下文超限时清理后重试一次', async () => {
    const overflow = { status: 400, message: "This model's maximum context length is 8192 tokens." };
    const requests = scriptedModel([...readFiles(2), overflow, { text: '好' }]);
    let compactions = 0;
    const agent = new Agent(workspace(bigFiles(2)), connection, { onCompact: () => compactions++ });

    assert.equal(await agent.send('读'), 'done');
    assert.equal(compactions, 1);
    assert.equal(requests.length, 4);
    assert.match(requests[3].messages.find(message => message.role === 'tool').content, CLEARED);
});

test('没有内容可以清理时，超限错误交给界面', async () => {
    const requests = scriptedModel([{ status: 400, message: 'maximum context length exceeded' }]);
    const agent = new Agent(workspace(), connection, {});
    await assert.rejects(agent.send('改'), { status: 400 });
    assert.equal(requests.length, 1);
});

test('上下文用量从 0 到 99，新任务后清零', () => {
    const agent = new Agent(workspace(), connection, {});
    agent.messages = [];
    assert.equal(agent.contextUsage, 0);
    agent.messages = [{ role: 'user', content: 'x'.repeat(200000) }];
    assert.equal(agent.contextUsage, 50);
    agent.messages = [{ role: 'user', content: 'x'.repeat(900000) }];
    assert.equal(agent.contextUsage, 99);
    agent.reset();
    assert.equal(agent.contextUsage, 0);
});

test('识别上下文超限错误', () => {
    assert.ok(isContextError({ status: 400, message: "This model's maximum context length is 8192 tokens" }));
    assert.ok(isContextError({ status: 400, message: 'Your request exceeded model token limit' }));
    assert.ok(isContextError({ status: 413, message: 'Payload Too Large' }));
    assert.ok(!isContextError({ status: 400, message: 'Invalid model' }));
    assert.ok(!isContextError({ status: 429, message: 'token rate limit' }));
    assert.ok(!isContextError(new Error('network')));
});

test('模型列表和推理档位都来自接口', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [
        { id: 'plain' },
        { id: 'deepseek-flash', effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' } },
        { id: 'openai/gpt-5.4', reasoning: { supported_efforts: ['xhigh', 'high', 'none'], default_effort: 'medium' } },
        { id: 'moonshotai/kimi-k2.6', reasoning: { mandatory: false } },
        { id: 'text-embedding-3' }
    ] }));

    const models = await listModels({ url: 'https://model.test/v1', key: 'test' });
    assert.deepEqual(models, [
        { id: 'deepseek-flash', levels: ['low', 'high', 'max'], defaultLevel: 'high' },
        { id: 'moonshotai/kimi-k2.6', levels: [], defaultLevel: '' },
        { id: 'openai/gpt-5.4', levels: ['xhigh', 'high', 'none'], defaultLevel: 'medium' },
        { id: 'plain', levels: [], defaultLevel: '' }
    ]);
});

test('只有选择了推理强度才发送这个参数', async () => {
    const requests = scriptedModel([{ text: '好' }, { text: '好' }]);
    await new Agent(workspace(), () => ({ ...connection(), effort: 'low' }), {}).send('改');
    await new Agent(workspace(), () => ({ ...connection(), effort: '' }), {}).send('改');
    assert.equal(requests[0].reasoning_effort, 'low');
    assert.ok(!('reasoning_effort' in requests[1]));
});

test('取消授权后不再保存句柄，对话记录保留，同名文件夹可以接上', async () => {
    const store = memoryStore();
    const history = new SessionHistory(store);
    await history.openProject(folder('app', 'a'));
    history.begin('任务');
    history.schedule(() => ({ messages: [1], timeline: [] }));
    await history.flush();
    history.rememberPrompt('任务');

    await history.releaseProject();
    assert.equal(history.projectId, null);
    assert.equal(history.currentId, null);
    assert.deepEqual(await history.list(), []);
    assert.equal((await store.listProjects())[0].handle, null);

    await history.openProject(folder('other', 'b'));
    assert.deepEqual(await history.list(), []);

    const reopened = folder('app', 'c');
    await history.openProject(reopened);
    assert.equal((await history.list()).length, 1);
    assert.deepEqual(history.prompts(), ['任务']);
    assert.equal((await store.listProjects()).find(project => project.name === 'app').handle, reopened);
});

test('全局指令发给模型，排在项目规则之前', async () => {
    const requests = scriptedModel([{ text: '好' }, { text: '好' }]);
    const rules = { 'AGENTS.md': '- 用中文注释\n' };
    await new Agent(workspace(rules), connection, {}, () => ({ instructions: '  回复用中文\n' })).send('改');
    const system = requests[0].messages[0].content;
    assert.match(system, /The user's instructions for all projects:\n回复用中文\n\nProject: demo/);
    assert.ok(system.indexOf('回复用中文') < system.indexOf('用中文注释'));

    await new Agent(workspace(rules), connection, {}, () => ({ instructions: '   ' })).send('改');
    assert.doesNotMatch(requests[1].messages[0].content, /for all projects/);
});

test('关闭记录项目规则后不再要求写入，已有规则仍然读取', async () => {
    const requests = scriptedModel([{ text: '好' }]);
    await new Agent(workspace({ 'AGENTS.md': '- 用中文注释\n' }), connection, {}, () => ({ rememberRules: false })).send('改');
    const system = requests[0].messages[0].content;
    assert.doesNotMatch(system, /add one short line/);
    assert.match(system, /Project instructions from AGENTS\.md:\n- 用中文注释/);
});

test('步数上限按设置生效，到上限时停止', async () => {
    const requests = scriptedModel(Array.from({ length: 3 }, () => ({ tool: 'read', args: {} })));
    const agent = new Agent(workspace(), connection, {}, () => ({ maxSteps: 2 }));
    await assert.rejects(agent.send('改'), { code: 'too-many-steps' });
    assert.equal(requests.length, 2);
    assert.equal(agent.running, false);
});

test('压缩线按设置生效，小圈的分母跟着变化', async () => {
    const agent = new Agent(workspace(bigFiles(3)), connection, {}, () => ({ contextLimit: 50000 }));
    agent.messages = [{ role: 'user', content: 'x'.repeat(100000) }];
    assert.equal(agent.contextUsage, 50);

    const requests = scriptedModel([...readFiles(3), { text: '好' }]);
    let compactions = 0;
    const small = new Agent(workspace(bigFiles(3)), connection, { onCompact: () => compactions++ }, () => ({ contextLimit: 30000 }));
    await small.send('读');
    assert.equal(compactions, 1);
    assert.match(requests[3].messages.find(message => message.role === 'tool').content, CLEARED);
});

test('关闭保存后不写入新的对话和提示词，已有记录保留', async () => {
    const store = memoryStore();
    const history = new SessionHistory(store);
    await history.openProject(folder('app'));
    history.begin('保留的任务');
    history.schedule(() => ({ messages: [1], timeline: [] }));
    await history.flush();
    history.rememberPrompt('保留的任务');

    history.isEnabled = false;
    await history.close();
    history.begin('不保存的任务');
    history.schedule(() => ({ messages: [2], timeline: [] }));
    await history.flush();
    history.rememberPrompt('不保存的任务');

    assert.deepEqual((await history.list()).map(session => session.title), ['保留的任务']);
    assert.deepEqual(history.prompts(), ['保留的任务']);
});

test('清空全部对话时包括所有项目的提示词，当前对话不再写入', async () => {
    const store = memoryStore();
    const history = new SessionHistory(store);
    const other = folder('other');
    await history.openProject(other);
    history.rememberPrompt('另一个项目');
    await history.openProject(folder('app'));
    history.begin('任务');
    history.rememberPrompt('任务');
    history.schedule(() => ({ messages: [1], timeline: [] }));

    await history.clearAll();
    await history.flush();
    assert.equal(history.currentId, null);
    assert.equal(store.data.size, 0);
    assert.deepEqual(history.prompts(), []);
    await history.openProject(other);
    assert.deepEqual(history.prompts(), []);
});

/** 内存文件夹，支持 values() */
function directory(entries) {
    const handles = Object.entries(entries).map(([name, value]) => (typeof value === 'string'
        ? { name, kind: 'file', getFile: async () => new File([value], name) }
        : { ...directory(value), name, kind: 'directory' }));
    return { async *values() { yield* handles; } };
}

test('忽略规则优先于内置规则和 .gitignore，但放不开 .git 和 .intent', async () => {
    const manager = new FileManager();
    await manager.init();
    manager.rootDirHandle = directory({
        '.git': { config: 'x' },
        '.intent': { 'a.json': '{}' },
        '.gitignore': 'notes.md\n',
        'a.js': 'x',
        'notes.md': 'x',
        'logo.svg': '<svg/>',
        dist: { 'app.js': 'x' }
    });
    const paths = async () => (await manager.getAllFiles()).map(file => file.path).sort();

    assert.deepEqual(await paths(), ['.gitignore', 'a.js']);
    manager.setUserIgnoreRules('# 注释\na.js\n!*.svg\n!notes.md\n!dist\n!.git\n!.intent\n');
    assert.deepEqual(await paths(), ['.gitignore', 'dist/app.js', 'logo.svg', 'notes.md']);
    manager.setUserIgnoreRules('');
    assert.deepEqual(await paths(), ['.gitignore', 'a.js']);
});

const REGULAR = 0o100644;
const gitSha = text => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex');

/** 生成索引文件，字段顺序和 git 一致 */
function gitIndexBytes(items, version = 2) {
    const entries = items.map(({ path, time = 1000, size = 0, sha = '0'.repeat(40), mode = REGULAR, flags = 0, skipWorktree = false }) => {
        const name = Buffer.from(path);
        const isExtended = version === 3 && skipWorktree;
        const head = Buffer.alloc(isExtended ? 64 : 62);
        head.writeUInt32BE(Math.floor(time / 1000), 8);
        head.writeUInt32BE((time % 1000) * 1e6, 12);
        head.writeUInt32BE(mode, 24);
        head.writeUInt32BE(size, 36);
        Buffer.from(sha, 'hex').copy(head, 40);
        head.writeUInt16BE(flags | Math.min(name.length, 0xfff) | (isExtended ? 0x4000 : 0), 60);
        if (isExtended) head.writeUInt16BE(0x4000, 62);
        const length = head.length + name.length + 1;
        return Buffer.concat([head, name, Buffer.alloc(Math.ceil(length / 8) * 8 - length + 1)]);
    });
    const header = Buffer.alloc(12);
    header.write('DIRC');
    header.writeUInt32BE(version, 4);
    header.writeUInt32BE(items.length, 8);
    return new Uint8Array(Buffer.concat([header, ...entries]));
}

/** 内存文件夹，支持 getDirectoryHandle 和 getFileHandle */
function memoryFolder(tree) {
    return {
        async getDirectoryHandle(name) {
            if (typeof tree[name] !== 'object' || tree[name] instanceof Uint8Array || tree[name].text !== undefined) throw new Error('not a directory');
            return memoryFolder(tree[name]);
        },
        async getFileHandle(name) {
            if (!(name in tree)) throw new Error('missing');
            return fileHandle(tree[name]);
        }
    };
}

const fileHandle = entry => ({ getFile: async () => (entry instanceof Uint8Array || typeof entry === 'string'
    ? new File([entry], 'file')
    : new File([entry.text], 'file', { lastModified: entry.time })) });

test('解析 Git 索引，只保留能比较的普通文件', () => {
    const longPath = `${'a/'.repeat(2100)}b.js`;
    const entries = parseGitIndex(gitIndexBytes([
        { path: 'a.js', time: 5123, size: 3, sha: 'ab'.repeat(20) },
        { path: longPath },
        { path: 'c.js' },
        { path: 'submodule', mode: 0o160000 },
        { path: 'link', mode: 0o120000 },
        { path: 'same.js', flags: 0x8000 }
    ]));
    assert.deepEqual([...entries.keys()], ['a.js', longPath, 'c.js']);
    assert.deepEqual(entries.get('a.js'), { time: 5123, size: 3, sha: 'ab'.repeat(20) });
});

test('Git 索引版本 3 跳过稀疏检出之外的文件，版本 4 不解析', () => {
    const entries = parseGitIndex(gitIndexBytes([{ path: 'a.js' }, { path: 'sparse.js', skipWorktree: true }, { path: 'c.js' }], 3));
    assert.deepEqual([...entries.keys()], ['a.js', 'c.js']);
    assert.equal(parseGitIndex(gitIndexBytes([], 4)), null);
    assert.equal(parseGitIndex(new TextEncoder().encode('not an index')), null);
});

test('从 HEAD 读出分支名', () => {
    assert.equal(parseGitHead('ref: refs/heads/feature/login\n'), 'feature/login');
    assert.equal(parseGitHead('2b5c04f32b5f52eace57583acd92035e9a8b201c\n'), '2b5c04f');
});

test('比较工作区和索引，得到修改、未跟踪和删除', async () => {
    const entry = (path, text, time) => ({ path, time, size: Buffer.byteLength(text), sha: gitSha(text) });
    const index = gitIndexBytes([
        entry('same.js', 'same', 1000),
        entry('touched.js', 'touched', 1000),
        entry('grown.js', 'old', 1000),
        entry('edited.js', 'aaa', 1000),
        entry('racy.js', 'kept', 1000),
        { path: 'smudged.js', time: 1000, size: 0, sha: gitSha('kept') },
        entry('removed.js', 'gone', 1000),
        entry('dist/app.js', 'hidden', 1000),
        entry('generated.js', 'ignored by a nested rule', 1000)
    ]);
    const root = memoryFolder({
        '.git': { HEAD: 'ref: refs/heads/main\n', index, info: { exclude: 'local-note.txt\n' } },
        'generated.js': { text: 'ignored by a nested rule', time: 1000 }
    });
    const file = (path, text, time = 1000) => ({ path, handle: fileHandle({ text, time }) });
    const files = [
        file('same.js', 'same', 1001),
        file('touched.js', 'touched', 9000),
        file('grown.js', 'longer'),
        file('edited.js', 'bbb', 9000),
        file('racy.js', 'kept'),
        file('smudged.js', 'kept'),
        file('new.js', 'new'),
        file('local-note.txt', 'skip')
    ];

    const git = await readGitStatus(root, files, ['dist']);
    assert.equal(git.branch, 'main');
    assert.deepEqual([...git.changes].sort(), [['edited.js', 'M'], ['grown.js', 'M'], ['new.js', 'U']]);
    assert.deepEqual(git.deleted, ['removed.js']);
});

test('不是 Git 仓库或无法读取时不显示 Git 状态', async () => {
    assert.equal(await readGitStatus(memoryFolder({}), [], []), null);
    assert.equal(await readGitStatus(memoryFolder({ '.git': 'gitdir: ../elsewhere' }), [], []), null);
    const version4 = memoryFolder({ '.git': { HEAD: 'ref: refs/heads/main', index: gitIndexBytes([], 4) } });
    assert.equal(await readGitStatus(version4, [], []), null);

    const fresh = memoryFolder({ '.git': { HEAD: 'ref: refs/heads/main' } });
    const git = await readGitStatus(fresh, [{ path: 'a.js', handle: fileHandle('x') }], []);
    assert.deepEqual([...git.changes], [['a.js', 'U']]);
});
