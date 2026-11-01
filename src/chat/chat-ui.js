/**
 * @fileoverview 对话 UI 模块
 * @description 显示用户消息、Agent 回复和工具步骤，所有文本都用 textContent 渲染
 */

import { t, onLanguageChange } from '../global/i18n.js';

/** 判断是否贴近底部的距离 */
const STICK_DISTANCE = 80;

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

/**
 * 渲染 Agent 回复：支持段落、代码块、行内代码和粗体
 * @param {HTMLElement} container - 容器
 * @param {string} text - 回复文本
 */
function renderReply(container, text) {
    container.replaceChildren();
    text.split(/(```[^\n]*\n[\s\S]*?(?:```|$))/).forEach(part => {
        if (part.startsWith('```')) {
            const body = part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '');
            container.appendChild(createElement('pre', 'code-block', body));
            return;
        }
        if (!part.trim()) return;
        const paragraph = createElement('p');
        part.trim().split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/).forEach(segment => {
            if (/^`[^`\n]+`$/.test(segment)) paragraph.appendChild(createElement('code', 'inline-code', segment.slice(1, -1)));
            else if (/^\*\*[^*\n]+\*\*$/.test(segment)) paragraph.appendChild(createElement('strong', '', segment.slice(2, -2)));
            else if (segment) paragraph.append(segment);
        });
        container.appendChild(paragraph);
    });
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
     */
    constructor(chatPanel, chatMessagesContainer, chatInput) {
        this.chatPanel = chatPanel;
        this.chatMessagesContainer = chatMessagesContainer;
        this.chatInput = chatInput;
        this.onFileClick = null; // 点击改动步骤时调用 (filePath) => void

        this.rows = [];
        this.status = null;
        this.stickToBottom = true;

        this.statusRow = createElement('div', 'chat-status hidden');
        this.chatMessagesContainer.appendChild(this.statusRow);

        this.chatMessagesContainer.addEventListener('scroll', () => {
            const { scrollHeight, scrollTop, clientHeight } = this.chatMessagesContainer;
            this.stickToBottom = scrollHeight - scrollTop - clientHeight < STICK_DISTANCE;
        });

        onLanguageChange(() => {
            this.rows.forEach(row => row.render());
            this.setStatus(this.status);
            this.updatePlaceholder();
        });
        this.updatePlaceholder();
    }

    /** 根据对话状态更新输入提示 */
    updatePlaceholder() {
        this.chatInput.placeholder = t(this.rows.length > 0 ? 'chat.placeholderNext' : 'chat.placeholder');
    }

    /**
     * 添加一行，语言切换时重新渲染
     * @private
     * @param {string} className - 样式类
     * @param {Function} draw - 绘制函数
     * @returns {Object} 行
     */
    _addRow(className, draw) {
        const element = createElement('div', className);
        const row = { element, render: () => draw(element, row) };
        row.render();
        this.rows.push(row);
        this.chatMessagesContainer.insertBefore(element, this.statusRow);
        this.chatPanel.classList.remove('collapsed');
        this.updatePlaceholder();
        this._follow();
        return row;
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
        this._addRow('message user', element => {
            element.textContent = text;
        });
    }

    /**
     * 添加 Agent 回复
     * @returns {Object} 行，用 updateReply 更新内容
     */
    addReply() {
        return this._addRow('message ai', (element, row) => {
            renderReply(element, row?.text || '');
        });
    }

    /**
     * 更新 Agent 回复
     * @param {Object} row - 行
     * @param {string} text - 完整内容
     */
    updateReply(row, text) {
        row.text = text;
        row.render();
        this._follow();
    }

    /**
     * 添加工具步骤
     * @param {string} verb - 动作
     * @param {string} target - 对象
     * @returns {Object} 行，用 finishStep 更新结果
     */
    addStep(verb, target) {
        const step = { verb, target, state: 'running', path: null };
        const row = this._addRow('step', element => {
            element.classList.toggle('is-failed', step.state === 'failed');
            element.classList.toggle('is-link', Boolean(step.path));
            const icon = step.state === 'running' ? 'loading codicon-modifier-spin' : step.state === 'failed' ? 'warning' : 'check';
            const iconElement = createElement('i', `codicon codicon-${icon}`);
            const verbElement = createElement('span', 'step-verb', t(`step.${step.verb}`));
            const targetElement = createElement('span', 'step-target', step.target);
            element.replaceChildren(iconElement, verbElement, targetElement);
            element.title = step.state === 'failed' ? t('step.retrying') : step.target;
        });
        row.step = step;
        row.element.addEventListener('click', () => {
            if (step.path) this.onFileClick?.(step.path);
        });
        return row;
    }

    /**
     * 更新工具步骤结果
     * @param {Object} row - 行
     * @param {{ok: boolean, verb: string, target: string}} result - 结果
     */
    finishStep(row, result) {
        Object.assign(row.step, {
            verb: result.verb,
            target: result.target,
            state: result.ok ? 'done' : 'failed',
            path: result.ok && ['edit', 'create', 'rewrite'].includes(result.verb) ? result.target : null
        });
        row.render();
    }

    /**
     * 添加说明文字
     * @param {Function} getText - 返回当前语言的文字
     */
    addNote(getText) {
        return this._addRow('chat-note', element => {
            element.textContent = getText();
        });
    }

    /**
     * 添加写入结果
     * @param {number} count - 写入的文件数
     * @param {Function} onUndo - 点击撤销时调用
     * @returns {Object} 行，撤销后调用 row.markUndone()
     */
    addApplied(count, onUndo) {
        let undone = false;
        const row = this._addRow('chat-applied', element => {
            element.replaceChildren();
            if (undone) {
                element.textContent = t('changes.undone');
                return;
            }
            const icon = createElement('i', 'codicon codicon-check');
            const label = createElement('span', '', t('changes.applied', count));
            const button = createElement('button', 'btn btn-text btn-text-chat btn-inline', t('changes.undo'));
            button.type = 'button';
            button.addEventListener('click', async () => {
                button.classList.add('is-loading');
                button.disabled = true;
                await onUndo();
                button.classList.remove('is-loading');
                button.disabled = false;
            });
            element.append(icon, label, button);
        });
        row.markUndone = () => {
            undone = true;
            row.render();
        };
        return row;
    }

    /**
     * 添加错误
     * @param {Function} getText - 返回当前语言的错误说明
     * @param {Function|null} onRetry - 点击重试时调用
     */
    addError(getText, onRetry) {
        const row = this._addRow('chat-error', element => {
            element.replaceChildren(createElement('span', '', getText()));
            if (!onRetry) return;
            const button = createElement('button', 'btn btn-text btn-text-chat btn-inline', t('chat.retry'));
            button.type = 'button';
            button.addEventListener('click', () => {
                row.element.remove();
                this.rows.splice(this.rows.indexOf(row), 1);
                onRetry();
            });
            element.appendChild(button);
        });
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

    /** 清空对话 */
    clear() {
        this.rows.forEach(row => row.element.remove());
        this.rows = [];
        this.stickToBottom = true;
        this.setStatus(null);
        this.updatePlaceholder();
    }
}
