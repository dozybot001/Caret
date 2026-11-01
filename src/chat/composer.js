/**
 * @fileoverview 输入栏
 * @description 发送消息、翻看提示词、发送按钮和模型菜单的状态
 * @module composer
 */

import { t } from '../i18n/index.js';

export class Composer {
    /**
     * @param {Object} app - 应用控制器
     * @param {Object} elements - input、sendButton、modelButton、effortButton
     */
    constructor(app, { input, sendButton, modelButton, effortButton }) {
        this.app = app;
        this.input = input;
        this.sendButton = sendButton;
        this.modelButton = modelButton;
        this.effortButton = effortButton;

        modelButton.addEventListener('click', () => app.connection.openModelSwitcher(modelButton));
        effortButton.addEventListener('click', () => app.connection.openEffortSwitcher(effortButton));
        this._bind();
    }

    _bind() {
        const { app, input, sendButton } = this;

        sendButton.closest('form').addEventListener('submit', (event) => {
            event.preventDefault();
            if (app.agent.running) app.agent.stop();
            else this.submit();
        });

        input.addEventListener('input', () => {
            app.promptRecall.reset();
            this.updateSendButton();
        });
        input.addEventListener('keydown', (event) => {
            // 输入法组字时的按键不处理
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                this._recallPrompt(event);
                return;
            }
            if (event.key !== 'Enter' || event.shiftKey) return;
            const hasModifier = event.metaKey || event.ctrlKey;
            if (!hasModifier && app.store.getConfig().sendKey === 'mod') return;
            event.preventDefault();
            if (hasModifier && !input.value.trim()) app.review.apply(false);
            else this.submit();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && app.agent.running && !app.settings.dialog.open) app.agent.stop();
        });
        this.updateSendButton();
    }

    /**
     * 用上下键翻看发过的提示词
     * @private
     * @param {KeyboardEvent} event - 按键事件
     */
    _recallPrompt(event) {
        if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
        const { input } = this;
        const { promptRecall } = this.app;
        const value = event.key === 'ArrowUp' ? promptRecall.previous(input) : promptRecall.next(input);
        if (value === null) return;

        event.preventDefault();
        input.value = value;
        input.setSelectionRange(value.length, value.length);
        this.updateSendButton();
    }

    /**
     * 发送输入框里的内容。缺少文件夹或模型时先补齐，内容保留在输入框里
     */
    async submit() {
        const text = this.input.value.trim();
        if (!text || this.app.agent.running) return;

        if (!this.app.file.hasRoot()) {
            const opened = this.app.file.pendingHandle
                ? await this.app.fileHandlers.handleResumeFolder()
                : await this.app.fileHandlers.handleOpenFolder();
            if (!opened) return;
        }
        if (!this.app.connection.isReady()) {
            this.app.waitingToSend = true;
            this.app.settings.open();
            this.app.connection.keyInput.focus();
            return;
        }

        this.input.value = '';
        this.app.history.rememberPrompt(text);
        this.app.promptRecall.load(this.app.history.prompts());
        this.app.conversations.setHistoryVisible(false);
        this.app.history.begin(text);
        this.app.chatUI.addUserMessage(text);
        this.app.run(() => this.app.agent.send(text));
    }

    updateSendButton() {
        const running = this.app.agent?.running;
        const icon = this.sendButton.querySelector('i');
        icon.className = `codicon codicon-${running ? 'debug-stop' : 'arrow-up'}`;
        this.sendButton.dataset.running = String(Boolean(running));
        this.sendButton.title = t(running ? 'chat.stop' : 'chat.send');
        this.sendButton.setAttribute('aria-label', this.sendButton.title);
        this.sendButton.disabled = !running && !this.input.value.trim();
    }

    updateModelButton() {
        this.modelButton.querySelector('span').textContent = this.app.connection.getModelLabel();
        this.modelButton.classList.toggle('is-unset', !this.app.connection.isReady());
        this.modelButton.title = t(this.app.connection.isReady() ? 'model.switch' : 'model.connect');

        const effort = this.app.connection.getEffortLabel();
        this.effortButton.classList.toggle('hidden', !effort);
        this.effortButton.querySelector('span').textContent = effort;
        this.effortButton.title = t('model.switchEffort');
    }
}
