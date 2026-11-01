import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Agent } from '../src/agent/agent.js';
import { connection, scriptedModel, workspace } from './helpers.mjs';

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
