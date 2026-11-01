/**
 * @fileoverview 对话 UI 模块
 * @description 显示用户消息、Agent 回复和工具步骤，所有文本都用 textContent 渲染
 *
 * 每一行由一条可保存的记录生成，会话历史保存这些记录，恢复时重新渲染。
 */

import { t, onLanguageChange } from '../i18n/index.js';
import { renderMarkdown } from './markdown.js';

/** 离底部小于这个距离时继续跟随最新内容 */
const STICK_DISTANCE = 8;
const COPIED_DURATION = 1500;

const ROW_CLASS = {
    user: 'message user',
    reply: 'message ai',
    step: 'step',
    note: 'chat-note',
    applied: 'chat-applied',
    error: 'chat-error'
};

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

/**
 * 对话 UI 管理器
 * @class ChatUI
 */
export class ChatUI {
    /**
     * @param {HTMLElement} chatPanel - 对话面板容器
     * @param {HTMLElement} chatMessagesContainer - 消息容器
     * @param {HTMLElement} chatInput - 输入框
     * @param {HTMLElement} contextRing - 上下文用量小圈
     */
    constructor(chatPanel, chatMessagesContainer, chatInput, contextRing) {
        this.chatPanel = chatPanel;
        this.chatMessagesContainer = chatMessagesContainer;
        this.chatInput = chatInput;
        this.contextRing = contextRing;
        this.contextUsage = 0;
        this.onFileClick = null; // 点击改动步骤时调用 (filePath) => void

        this.rows = [];
        this.status = null;
        this.stickToBottom = true;

        this.statusRow = createElement('div', 'chat-status hidden');
        this.chatMessagesContainer.appendChild(this.statusRow);

        // 用户往上滑时立刻停止跟随，再滑回底部时恢复
        this.lastScrollTop = 0;
        this.chatMessagesContainer.addEventListener('wheel', (event) => {
            if (event.deltaY < 0 && this.chatMessagesContainer.scrollTop > 0) this.stickToBottom = false;
        }, { passive: true });
        this.chatMessagesContainer.addEventListener('scroll', () => {
            const { scrollHeight, scrollTop, clientHeight } = this.chatMessagesContainer;
            const isAtBottom = scrollHeight - scrollTop - clientHeight < STICK_DISTANCE;
            // 内容变短时位置也会变小，这时仍在底部，不算用户上滑
            if (scrollTop >= this.lastScrollTop) {
                if (isAtBottom) this.stickToBottom = true;
            } else if (!isAtBottom) {
                this.stickToBottom = false;
            }
            this.lastScrollTop = scrollTop;
        });

        onLanguageChange(() => {
            this.rows.forEach(row => this._draw(row));
            this.setStatus(this.status);
            this.setContextUsage(this.contextUsage);
            this.updatePlaceholder();
        });
        this.updatePlaceholder();
        this.setContextUsage(0);
    }

    /** 根据对话状态更新输入提示 */
    updatePlaceholder() {
        this.chatInput.placeholder = t(this.rows.length > 0 ? 'chat.placeholderNext' : 'chat.placeholder');
    }

    /**
     * 添加一行
     * @private
     * @param {Object} data - 可保存的记录
     * @param {Object} actions - 不保存的回调
     * @returns {Object} 行
     */
    _addRow(data, actions = {}) {
        const row = { data, actions, element: createElement('div', ROW_CLASS[data.type]) };
        this._draw(row);
        this.rows.push(row);
        this.chatMessagesContainer.insertBefore(row.element, this.statusRow);
        this.chatPanel.classList.remove('collapsed');
        this.updatePlaceholder();
        this._follow();
        return row;
    }

    /**
     * 根据记录绘制一行，语言切换时重新调用
     * @private
     * @param {Object} row - 行
     */
    _draw(row) {
        const { data, element } = row;
        switch (data.type) {
            case 'user':
                this._drawMessage(row, content => { content.textContent = data.text; });
                break;
            case 'reply':
                this._drawMessage(row, content => renderMarkdown(content, data.text));
                break;
            case 'step':
                this._drawStep(element, data);
                break;
            case 'note':
                element.textContent = t(data.key, ...data.args);
                break;
            case 'applied':
                this._drawApplied(row);
                break;
            case 'error':
                this._drawError(row);
                break;
        }
    }

    /**
     * 绘制消息。复制按钮只创建一次，流式更新时不会打断点击
     * @private
     * @param {Object} row - 行
     * @param {Function} fill - 填充消息内容
     */
    _drawMessage(row, fill) {
        if (!row.copyButton) {
            row.content = createElement('div', 'message-content');
            row.copyButton = createElement('button', 'btn btn-close message-copy');
            row.copyButton.type = 'button';
            row.copyButton.appendChild(createElement('i'));
            row.copyButton.addEventListener('click', () => this._copy(row));
            row.element.append(row.content, row.copyButton);
        }
        this._drawCopyButton(row);
        fill(row.content);
    }

    _drawCopyButton({ copyButton, isCopied }) {
        const label = t(isCopied ? 'chat.copied' : 'chat.copy');
        copyButton.title = label;
        copyButton.setAttribute('aria-label', label);
        copyButton.firstChild.className = `codicon codicon-${isCopied ? 'check' : 'copy'}`;
    }

    /**
     * 复制消息的原始文本
     * @private
     * @param {Object} row - 行
     */
    async _copy(row) {
        try {
            await navigator.clipboard.writeText(row.data.text);
        } catch {
            window.notify?.alert(t('chat.copyFailed'), { type: 'error' });
            return;
        }
        row.isCopied = true;
        this._drawCopyButton(row);
        clearTimeout(row.copiedTimer);
        row.copiedTimer = setTimeout(() => {
            row.isCopied = false;
            this._drawCopyButton(row);
        }, COPIED_DURATION);
    }

    _drawStep(element, step) {
        element.classList.toggle('is-failed', step.state === 'failed');
        element.classList.toggle('is-link', Boolean(step.path));
        const icon = step.state === 'running' ? 'loading codicon-modifier-spin' : step.state === 'failed' ? 'warning' : 'check';
        element.replaceChildren(
            createElement('i', `codicon codicon-${icon}`),
            createElement('span', 'step-verb', t(`step.${step.verb}`)),
            createElement('span', 'step-target', step.target)
        );
        element.title = step.state === 'failed' ? t('step.retrying') : step.target;
        element.onclick = step.path ? () => this.onFileClick?.(step.path) : null;
    }

    _drawApplied(row) {
        const { data, actions, element } = row;
        element.replaceChildren();
        if (data.undone) {
            element.textContent = t('changes.undone');
            return;
        }
        element.append(createElement('i', 'codicon codicon-check'), createElement('span', '', t('changes.applied', data.count)));
        if (!actions.onUndo) return;

        const button = createElement('button', 'btn btn-text btn-text-chat btn-inline', t('changes.undo'));
        button.type = 'button';
        button.addEventListener('click', async () => {
            button.classList.add('is-loading');
            button.disabled = true;
            await actions.onUndo();
            button.classList.remove('is-loading');
            button.disabled = false;
        });
        element.appendChild(button);
    }

    _drawError(row) {
        const { actions, element } = row;
        element.replaceChildren(createElement('span', '', actions.getText()));
        if (!actions.onRetry) return;

        const button = createElement('button', 'btn btn-text btn-text-chat btn-inline', t('chat.retry'));
        button.type = 'button';
        button.addEventListener('click', () => {
            element.remove();
            this.rows.splice(this.rows.indexOf(row), 1);
            actions.onRetry();
        });
        element.appendChild(button);
    }

    /** 贴近底部时跟随最新内容，只滚动消息容器 */
    _follow() {
        if (this.stickToBottom) {
            this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
        }
    }

    /**
     * 添加用户消息
     * @param {string} text - 消息内容
     */
    addUserMessage(text) {
        this.stickToBottom = true;
        this._addRow({ type: 'user', text });
    }

    /**
     * 添加 Agent 回复
     * @returns {Object} 行，用 updateReply 更新内容
     */
    addReply() {
        return this._addRow({ type: 'reply', text: '' });
    }

    /**
     * 更新 Agent 回复
     * @param {Object} row - 行
     * @param {string} text - 完整内容
     */
    updateReply(row, text) {
        row.data.text = text;
        this._draw(row);
        this._follow();
    }

    /**
     * 添加工具步骤
     * @param {string} verb - 动作
     * @param {string} target - 对象
     * @returns {Object} 行，用 finishStep 更新结果
     */
    addStep(verb, target) {
        return this._addRow({ type: 'step', verb, target, state: 'running', path: null });
    }

    /**
     * 更新工具步骤结果
     * @param {Object} row - 行
     * @param {{ok: boolean, verb: string, target: string}} result - 结果
     */
    finishStep(row, result) {
        Object.assign(row.data, {
            verb: result.verb,
            target: result.target,
            state: result.ok ? 'done' : 'failed',
            path: result.ok && ['edit', 'create', 'rewrite'].includes(result.verb) ? result.target : null
        });
        this._draw(row);
    }

    /**
     * 添加说明文字
     * @param {string} key - 文案键
     * @param {...*} args - 文案参数
     */
    addNote(key, ...args) {
        this._addRow({ type: 'note', key, args });
    }

    /**
     * 添加写入结果
     * @param {number} count - 写入的文件数
     * @param {Function} onUndo - 点击撤销时调用
     * @returns {Object} 行，撤销后调用 markUndone
     */
    addApplied(count, onUndo) {
        return this._addRow({ type: 'applied', count, undone: false }, { onUndo });
    }

    /**
     * 标记写入已撤销
     * @param {Object} row - 行
     */
    markUndone(row) {
        row.data.undone = true;
        this._draw(row);
    }

    /**
     * 添加错误。错误只在当前页面显示，不进入历史记录
     * @param {Function} getText - 返回当前语言的错误说明
     * @param {Function|null} onRetry - 点击重试时调用
     */
    addError(getText, onRetry) {
        this._addRow({ type: 'error' }, { getText, onRetry });
    }

    /**
     * 设置运行状态
     * @param {string|null} key - 状态文案键，null 表示没有状态
     */
    setStatus(key) {
        this.status = key;
        this.statusRow.classList.toggle('hidden', !key);
        this.statusRow.textContent = key ? t(key) : '';
        this._follow();
    }

    /**
     * 显示上下文用量
     * @param {number} percent - 已用比例，0 到 99
     */
    setContextUsage(percent) {
        const { contextRing } = this;
        this.contextUsage = percent;
        const label = t('chat.context', percent);
        contextRing.title = label;
        contextRing.setAttribute('aria-label', label);
        contextRing.querySelector('span').textContent = String(percent).padStart(2, '0');
        contextRing.querySelector('.context-arc').style.strokeDasharray = `${percent} 100`;
    }

    /**
     * 导出可保存的记录
     * @returns {Array<Object>}
     */
    serialize() {
        return this.rows.filter(row => row.data.type !== 'error').map(row => ({ ...row.data }));
    }

    /**
     * 从记录恢复对话。写入记录不再提供撤销，磁盘内容可能已经变化
     * @param {Array<Object>} records - 记录
     */
    restore(records) {
        this.clear();
        for (const record of records) {
            this._addRow(record.state === 'running' ? { ...record, state: 'done' } : record);
        }
    }

    /** 清空对话 */
    clear() {
        this.rows.forEach(row => row.element.remove());
        this.rows = [];
        this.stickToBottom = true;
        this.setStatus(null);
        this.updatePlaceholder();
    }
}
