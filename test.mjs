// 工具和 Agent 循环的测试：node --test test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Agent } from './src/agent/agent.js';
import { SessionHistory } from './src/chat/history.js';
import { parseInline, parseMarkdown } from './src/chat/markdown.js';
import { PromptRecall } from './src/chat/prompt-recall.js';
import { countChanges } from './src/agent/diff.js';
import { collectMessage, isContextError, readEvents } from './src/agent/model.js';
import { executeTool, normalizePath, outline, replaceText, TOOL_SCHEMAS } from './src/agent/tools.js';

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
        })
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
