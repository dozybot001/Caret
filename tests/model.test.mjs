import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectMessage, isContextError, listModels, readEvents, retryDelay } from '../src/agent/model.js';

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
    const { message } = await collectMessage(readEvents(stream), { onText: text => seen.push(text) });
    assert.deepEqual(seen, ['好']);
    assert.equal(message.content, '好');
    assert.equal(message.reasoning_content, '想一想');
    assert.deepEqual(message.tool_calls, [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"a"}' } }]);
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

test('重试按退避时间等待，服务商要求更久时按 Retry-After，太久时不再自动重试', () => {
    assert.equal(retryDelay(null, 1500), 1500);
    assert.equal(retryDelay('1', 1500), 1500);
    assert.equal(retryDelay('10', 1500), 10000);
    assert.equal(retryDelay('120', 1500), null);
    assert.equal(retryDelay('Tue, 03 Nov 2026 08:00:05 GMT', 1500, Date.parse('2026-11-03T08:00:00Z')), 5000);
    assert.equal(retryDelay('soon', 4000), 4000);
});
