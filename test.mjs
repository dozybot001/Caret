// 工具和 Agent 循环的测试：node --test test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Agent } from './src/agent/agent.js';
import { countChanges } from './src/agent/diff.js';
import { collectMessage, readEvents } from './src/agent/model.js';
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

    const insensitive = await run(ws, 'read', { grep: 'timeout' });
    assert.equal(insensitive.verb, 'search');
    assert.equal(insensitive.output, 'src/a.js:1: const timeout = 30;\nsrc/b.js:1: TIMEOUT');

    assert.equal((await run(ws, 'read', { grep: 'TIMEOUT' })).output, 'src/b.js:1: TIMEOUT');
    assert.equal((await run(ws, 'read', { path: 'src/a.js', grep: 'Name' })).output, 'src/a.js:2: const Name = 1;');
    assert.equal((await run(ws, 'read', { grep: '(unclosed' })).output, 'No matches.');
});

test('密钥文件不读取、不修改、不进入搜索结果', async () => {
    const ws = workspace({ '.env': 'SECRET=1\n', 'deploy/server.pem': 'SECRET', '.env.example': 'SECRET=\n' });
    const read = await run(ws, 'read', { path: '.env' });
    assert.equal(read.ok, false);
    assert.doesNotMatch(read.output, /SECRET=1/);
    assert.equal((await run(ws, 'edit', { path: '.env', old: '1', new: '2' })).ok, false);
    assert.equal((await run(ws, 'write', { path: 'a.pem', content: 'x' })).ok, false);
    assert.equal((await run(ws, 'read', { grep: 'SECRET' })).output, '.env.example:1: SECRET=');
    assert.equal((await run(ws, 'read', { path: '.env.example' })).ok, true);
});

test('路径限制在项目内', async () => {
    assert.equal(normalizePath('./src//a.js'), 'src/a.js');
    assert.equal(normalizePath('/src/a.js'), 'src/a.js');
    assert.equal(normalizePath('src\\a.js'), 'src/a.js');
    assert.throws(() => normalizePath('../secret'));
    assert.throws(() => normalizePath('.git/config'));
    assert.equal((await run(workspace(), 'read', { path: '../secret' })).ok, false);
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
    assert.match(requests[0].messages[0].content, /Files:\na\.js/);
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
