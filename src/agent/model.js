/**
 * @fileoverview 模型调用
 * @description 通过 OpenAI 兼容接口从浏览器直连模型服务，解析流式响应
 * @module model
 */

import { TOOL_SCHEMAS } from './tools.js';

/** 模型列表里不能用于对话的模型 */
const NON_CHAT_MODEL = /embed|tts|whisper|audio|image|dall-e|moderation|realtime|transcribe|rerank|sora/i;

/** 这些状态码可以稍后重试 */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);
const RETRY_DELAYS = [1500, 4000];

/**
 * 判断错误是否因为上下文超出了模型上限
 * @param {{status?: number, message?: string}} error - 错误
 * @returns {boolean}
 */
export function isContextError({ status, message }) {
    return status === 413 || (status === 400 && /context|token|length|too long/i.test(message));
}

function endpoint(url, path) {
    return `${url.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')}${path}`;
}

function headers(key) {
    return {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {})
    };
}

async function responseError(response) {
    const body = await response.text();
    let message = body;
    try {
        const parsed = JSON.parse(body);
        message = parsed.error?.message || parsed.message || body;
    } catch {
        // 响应不是 JSON，保留原文
    }
    return Object.assign(new Error(String(message).slice(0, 300)), { status: response.status });
}

function wait(ms, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    });
}

/**
 * 读取 SSE 响应流
 * @param {ReadableStream} body - 响应体
 * @yields {Object} 解析后的数据块
 */
export async function* readEvents(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, index).trim();
            buffer = buffer.slice(index + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') return;
            try {
                yield JSON.parse(data);
            } catch {
                // 跳过不完整的数据块
            }
        }
    }
}

/**
 * 合并一轮流式响应，得到完整的 assistant 消息
 * @param {AsyncIterable<Object>} events - 数据块
 * @param {Object} handlers - 进度回调：onText(fullText)、onThinking()、onToolCall()
 * @returns {Promise<Object>} assistant 消息
 */
export async function collectMessage(events, { onText, onThinking, onToolCall } = {}) {
    const message = { role: 'assistant', content: '' };
    const calls = [];
    let reasoning = '';

    for await (const event of events) {
        if (event.error) throw new Error(event.error.message || 'Model error');
        const delta = event.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.reasoning_content) {
            reasoning += delta.reasoning_content;
            onThinking?.();
        }
        if (delta.content) {
            message.content += delta.content;
            onText?.(message.content);
        }
        for (const part of delta.tool_calls || []) {
            const index = part.index ?? calls.length;
            const call = calls[index] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (part.id) call.id = part.id;
            if (part.function?.name) call.function.name += part.function.name;
            if (part.function?.arguments) call.function.arguments += part.function.arguments;
            onToolCall?.();
        }
    }

    const toolCalls = calls.filter(Boolean);
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    // DeepSeek 要求在后续请求里带回 reasoning_content
    if (reasoning) message.reasoning_content = reasoning;
    return message;
}

/**
 * 请求模型生成下一条消息，临时错误时自动重试
 * @param {{url: string, key: string, model: string}} connection - 模型连接
 * @param {Array<Object>} messages - 消息列表
 * @param {AbortSignal} signal - 取消信号
 * @param {Object} handlers - 进度回调
 * @returns {Promise<Object>} assistant 消息
 */
export async function requestCompletion(connection, messages, signal, handlers) {
    for (let attempt = 0; ; attempt++) {
        const response = await fetch(endpoint(connection.url, '/chat/completions'), {
            method: 'POST',
            headers: headers(connection.key),
            body: JSON.stringify({ model: connection.model, messages, tools: TOOL_SCHEMAS, stream: true }),
            signal
        });
        if (response.ok) return collectMessage(readEvents(response.body), handlers);

        const error = await responseError(response);
        if (!RETRYABLE_STATUS.has(response.status) || attempt >= RETRY_DELAYS.length) throw error;
        await wait(RETRY_DELAYS[attempt], signal);
    }
}

/**
 * 获取可用模型列表，同时用来验证连接
 * @param {{url: string, key: string}} connection - 模型连接
 * @param {AbortSignal} signal - 取消信号
 * @returns {Promise<string[]>} 模型名
 */
export async function listModels(connection, signal) {
    const response = await fetch(endpoint(connection.url, '/models'), { headers: headers(connection.key), signal });
    if (!response.ok) throw await responseError(response);
    const payload = await response.json();
    return (payload.data || payload.models || [])
        .map(model => model.id || model.name)
        .filter(id => id && !NON_CHAT_MODEL.test(id))
        .sort();
}
