import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Agent } from '../src/agent/agent.js';
import { connection, scriptedModel, workspace } from './helpers.mjs';

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

test('工具调用被输出上限截断时不重试，也不把残缺的调用留在上下文里', async () => {
    const ws = workspace({ 'a.txt': 'old\n' });
    const requests = scriptedModel([{ tool: 'write', raw: '{"path":"a.txt","content":"long text th', finish: 'length' }]);
    const steps = [];
    const agent = new Agent(ws, connection, { onStepStart: name => steps.push(name) });
    await assert.rejects(agent.send('重写'), { code: 'output-limit' });
    assert.equal(requests.length, 1);
    assert.deepEqual(steps, []);
    assert.equal(ws.state.get('a.txt'), 'old\n');
    assert.deepEqual(agent.messages.map(message => message.role), ['user']);
    assert.equal(agent.running, false);
});

test('内容过滤截断工具调用时交给界面处理', async () => {
    const requests = scriptedModel([{ tool: 'write', raw: '{"path":', finish: 'content_filter' }]);
    await assert.rejects(new Agent(workspace(), connection, {}).send('改'), { code: 'content-filter' });
    assert.equal(requests.length, 1);
});

test('回复被截断时保留已生成的内容，并告诉界面没有正常结束', async () => {
    const requests = scriptedModel([{ text: '前半段', finish: 'length' }, { text: '被拦截', finish: 'content_filter' }, { text: '完整', finish: 'stop' }]);
    const agent = new Agent(workspace(), connection, {});
    assert.equal(await agent.send('解释'), 'truncated');
    assert.equal(agent.messages.at(-1).content, '前半段');
    assert.equal(await agent.send('继续'), 'filtered');
    assert.equal(await agent.send('再来'), 'done');
    assert.equal(requests.length, 3);
});

test('工具调用完整时，即使到达输出上限也照常执行', async () => {
    const ws = workspace({ 'a.txt': 'x\n' });
    const requests = scriptedModel([{ tool: 'read', args: { path: 'a.txt' }, finish: 'length' }, { text: '好' }]);
    assert.equal(await new Agent(ws, connection, {}).send('读'), 'done');
    assert.equal(requests.length, 2);
    assert.equal(requests[1].messages.at(-1).content, 'x\n');
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

test('系统提示词保持极简，不带文件列表', async () => {
    const requests = scriptedModel([{ text: '好' }]);
    const files = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`src/file${index}.js`, 'x']));
    await new Agent(workspace(files), connection, {}).send('改');
    const system = requests[0].messages[0].content;
    assert.ok(system.length < 900, `提示词有 ${system.length} 个字符`);
    assert.doesNotMatch(system, /file0\.js/);
    assert.ok(JSON.stringify(requests[0].tools).length < 1300);
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

test('只有选择了推理强度才发送这个参数', async () => {
    const requests = scriptedModel([{ text: '好' }, { text: '好' }]);
    await new Agent(workspace(), () => ({ ...connection(), effort: 'low' }), {}).send('改');
    await new Agent(workspace(), () => ({ ...connection(), effort: '' }), {}).send('改');
    assert.equal(requests[0].reasoning_effort, 'low');
    assert.ok(!('reasoning_effort' in requests[1]));
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
