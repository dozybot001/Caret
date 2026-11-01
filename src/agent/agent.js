/**
 * @fileoverview Agent 循环
 * @description 调用模型、执行工具、把结果交回模型，直到模型不再调用工具
 * @module agent
 */

import { AGENT_CONSTANTS } from '../global/constants.js';
import { isContextError, requestCompletion } from './model.js';
import { executeTool } from './tools.js';

const SYSTEM_PROMPT = `You are Caret, a small coding agent in a web page. You change files in the user's local project with three tools: read, write and edit. You cannot run commands, tests or builds.

Your changes stay in the editor until the user reviews the diff and applies them, so keep each change small and easy to judge by reading it.

- Read before you edit. Keep the surrounding style and leave unrelated code alone.
- Never claim you tested anything. If something has to be run to be sure, say what the user should check.
- Finish with one or two sentences on what changed, in the language the user writes in.`;

/**
 * 项目记忆就是说明文件：Agent 用普通的工具修改，用户像审阅其他改动一样审阅
 * @param {string} name - 说明文件名
 * @returns {string}
 */
const memoryRule = name => `- When the user states a lasting rule for this project, add one short line to ${name}. Record only what the user said.`;

/** 清理后留在工具结果里的文字 */
const CLEARED_OUTPUT = '[Output removed to save space. Read the file again if you need it.]';

/** 项目说明文件，按顺序取第一个存在的 */
const PROJECT_RULES = ['AGENTS.md', 'CLAUDE.md'];

/**
 * 判断错误是否由用户取消引起
 * @param {Error} error - 错误
 * @returns {boolean}
 */
const isAbort = error => error?.name === 'AbortError';

export class Agent {
    /**
     * @param {Object} workspace - 工作区
     * @param {Function} getConnection - 返回当前模型连接
     * @param {Object} events - 过程回调：onThinking、onToolCall、onText、onStepStart、onStepEnd、onCompact
     */
    constructor(workspace, getConnection, events) {
        this.workspace = workspace;
        this.getConnection = getConnection;
        this.events = events;
        this.messages = [];
        this.pendingNotes = [];
        this.controller = null;
    }

    get running() {
        return this.controller !== null;
    }

    /** @returns {number} 上下文占压缩线的比例，0 到 99 */
    get contextUsage() {
        return Math.min(99, Math.floor(this._contextTokens() / AGENT_CONSTANTS.CONTEXT_TOKENS * 100));
    }

    /** 开始新任务，清空上下文 */
    reset() {
        this.messages = [];
        this.pendingNotes = [];
    }

    /**
     * 从历史记录恢复对话。这段时间文件可能变了，提醒模型重新读取
     * @param {Array<Object>} messages - 保存的消息
     */
    restore(messages) {
        this.messages = messages;
        this.pendingNotes = ['[This conversation was resumed from history. Files may have changed since then, so read them again before editing.]'];
        this._closeOpenCalls();
    }

    /**
     * 记录用户在编辑器里做的决定，随下一条消息告诉模型
     * @param {string} note - 说明
     */
    addNote(note) {
        this.pendingNotes.push(note);
    }

    /** 停止当前运行，已经产生的改动保留在编辑器里 */
    stop() {
        this.controller?.abort();
    }

    /**
     * 发送一条用户消息并运行
     * @param {string} text - 用户消息
     * @returns {Promise<'done'|'stopped'>}
     */
    send(text) {
        const notes = this.pendingNotes.splice(0);
        this.messages.push({ role: 'user', content: notes.length > 0 ? `${notes.join('\n')}\n\n${text}` : text });
        return this.resume();
    }

    /**
     * 从当前上下文继续运行，也用于出错后的重试
     * @returns {Promise<'done'|'stopped'>}
     */
    async resume() {
        this.controller = new AbortController();
        const { signal } = this.controller;
        try {
            await this.workspace.refresh();
            const system = await this._systemPrompt();
            for (let step = 0; step < AGENT_CONSTANTS.MAX_STEPS; step++) {
                const message = await this._nextMessage(system, signal);
                this.messages.push(message);
                if (!message.tool_calls) return 'done';
                await this._runTools(message.tool_calls, signal);
            }
            throw Object.assign(new Error('Too many steps'), { code: 'too-many-steps' });
        } catch (error) {
            if (isAbort(error)) return 'stopped';
            throw error;
        } finally {
            this.controller = null;
            this._closeOpenCalls();
        }
    }

    /**
     * 读取项目说明文件
     * @private
     * @returns {Promise<{name: string, text: string}>} 没有说明文件时 text 为空
     */
    async _projectRules() {
        const { workspace } = this;
        for (const name of PROJECT_RULES) {
            const file = workspace.paths().includes(name) ? await workspace.getText(name) : null;
            if (file?.text) return { name, text: file.text };
        }
        return { name: PROJECT_RULES[0], text: '' };
    }

    async _systemPrompt() {
        const { workspace } = this;
        const { name, text } = await this._projectRules();
        const { RULES_CHARS } = AGENT_CONSTANTS;
        const truncated = text.length > RULES_CHARS ? `\n[Truncated. Read ${name} for the rest.]` : '';
        const rules = text ? `\n\nProject instructions from ${name}:\n${text.slice(0, RULES_CHARS)}${truncated}` : '';
        return `${SYSTEM_PROMPT}\n${memoryRule(name)}\n\nProject: ${workspace.name}${rules}`;
    }

    _contextTokens() {
        return JSON.stringify(this.messages).length / AGENT_CONSTANTS.CHARS_PER_TOKEN;
    }

    /**
     * 清理较早的工具结果。这些内容都能重新读取，所以不丢失项目状态，也不用让模型写摘要
     * @private
     * @returns {boolean} 是否清理了内容
     */
    _compact() {
        let kept = 0;
        let isCleared = false;
        for (const message of [...this.messages].reverse()) {
            if (message.role !== 'tool' || message.content.length <= CLEARED_OUTPUT.length) continue;
            kept += message.content.length;
            if (kept > AGENT_CONSTANTS.CONTEXT_KEEP_CHARS) {
                message.content = CLEARED_OUTPUT;
                isCleared = true;
            }
        }
        if (isCleared) this.events.onCompact?.();
        return isCleared;
    }

    /**
     * 请求下一条消息。上下文到压缩线时先清理；上限比压缩线还小的模型会报错，这时清理后再试一次
     * @private
     */
    async _nextMessage(system, signal) {
        if (this._contextTokens() >= AGENT_CONSTANTS.CONTEXT_TOKENS) this._compact();
        try {
            return await this._request(system, signal);
        } catch (error) {
            if (!isContextError(error) || !this._compact()) throw error;
            return this._request(system, signal);
        }
    }

    _request(system, signal) {
        const messages = [{ role: 'system', content: system }, ...this.messages];
        this.events.onThinking?.();
        return requestCompletion(this.getConnection(), messages, signal, {
            onText: text => this.events.onText?.(text),
            onThinking: () => this.events.onThinking?.(),
            onToolCall: () => this.events.onToolCall?.()
        });
    }

    async _runTools(calls, signal) {
        for (const call of calls) {
            signal.throwIfAborted();
            let args = null;
            try {
                args = JSON.parse(call.function.arguments || '{}');
            } catch {
                // 下面把错误交回模型，让它重新调用
            }
            const step = this.events.onStepStart?.(call.function.name, args);
            const result = args
                ? await executeTool(this.workspace, call.function.name, args)
                : { ok: false, verb: 'read', target: call.function.name, output: 'Tool arguments were not valid JSON.' };
            this.messages.push({ role: 'tool', tool_call_id: call.id, content: result.output });
            this.events.onStepEnd?.(step, result);
        }
    }

    /** 中途停止时补齐工具结果，否则下一次请求会被模型服务拒绝 */
    _closeOpenCalls() {
        const lastCalls = [...this.messages].reverse().find(message => message.role === 'assistant')?.tool_calls || [];
        for (const call of lastCalls) {
            if (!this.messages.some(message => message.tool_call_id === call.id)) {
                this.messages.push({ role: 'tool', tool_call_id: call.id, content: 'Stopped by the user.' });
            }
        }
    }
}
