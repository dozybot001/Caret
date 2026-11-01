/**
 * @fileoverview 对话管理
 * @description 新任务、历史记录的打开和删除，以及切换项目时的对话状态
 * @module conversations
 */

import { t } from '../i18n/index.js';
import { HistoryUI } from './history-ui.js';

export class Conversations {
    /**
     * @param {Object} app - 应用控制器
     * @param {Object} elements - chatPanel、chatMessages、historyButton、historyPanel
     */
    constructor(app, { chatPanel, chatMessages, historyButton, historyPanel }) {
        this.app = app;
        this.chatPanel = chatPanel;
        this.chatMessages = chatMessages;
        this.historyButton = historyButton;
        this.sessions = [];

        this.historyUI = new HistoryUI(historyPanel, {
            onOpen: id => this._open(id),
            onDelete: session => this._delete(session),
            onClear: () => this._clearProject()
        });
        historyButton.addEventListener('click', () => this.setHistoryVisible(!this.historyUI.isVisible));
    }

    /**
     * 开始新任务。未写入的改动保留在编辑器里，当前对话留在历史记录里
     */
    async startNew() {
        if (this.app.agent.running) return;
        await this.app.history.close();
        this.reset();
        await this.refresh();
        this.setHistoryVisible(this.sessions.length > 0);
        this.app.composer.input.focus();
    }

    reset() {
        this.app.agent.reset();
        this.app.chatUI.clear();
        this.app.connection.resetSession();
        this.updateUsage();
    }

    updateUsage() {
        this.app.chatUI.setContextUsage(this.app.agent.contextUsage);
    }

    /**
     * 打开文件夹后切换到这个项目的历史记录
     */
    async openProject() {
        await this.app.history.openProject(this.app.file.getRootHandle());
        this.app.promptRecall.load(this.app.history.prompts());
        this.reset();
        await this.refresh();
        this.setHistoryVisible(this.sessions.length > 0);
    }

    /**
     * 安排保存当前对话
     */
    save() {
        this.app.history.schedule(() => ({
            messages: this.app.agent.messages,
            timeline: this.app.chatUI.serialize()
        }));
    }

    async refresh() {
        this.sessions = await this.app.history.list();
        this.historyUI.render(this.sessions, this.app.history.currentId);
    }

    /**
     * 显示或隐藏历史记录，隐藏时回到对话
     * @param {boolean} visible - 是否显示
     */
    setHistoryVisible(visible) {
        this.historyUI.setVisible(visible);
        this.chatMessages.classList.toggle('hidden', visible);
        this.historyButton.setAttribute('aria-pressed', String(visible));
        if (visible) this.chatPanel.classList.remove('collapsed');
    }

    /**
     * 打开历史记录里的对话
     * @private
     * @param {string} id - 会话 ID
     */
    async _open(id) {
        if (this.app.agent.running) return;
        if (id === this.app.history.currentId) {
            this.setHistoryVisible(false);
            return;
        }

        const session = await this.app.history.open(id);
        if (!session) {
            window.notify?.alert(t('history.missing'), { type: 'warning' });
            await this.refresh();
            return;
        }
        this.app.agent.restore(session.messages);
        this.app.chatUI.restore(session.timeline);
        this.app.connection.resetSession();
        this.updateUsage();
        this.historyUI.render(this.sessions, id);
        this.setHistoryVisible(false);
        this.app.composer.input.focus();
    }

    /**
     * 删除一条历史记录
     * @private
     * @param {{id: string, title: string}} session - 会话
     */
    async _delete(session) {
        const confirmed = await window.notify.confirm(t('history.deleteConfirm', session.title), t('confirm.delete'));
        if (!confirmed) return;
        await this._remove([session.id]);
    }

    /** 清空当前项目的历史记录 */
    async _clearProject() {
        const confirmed = await window.notify.confirm(t('history.clearConfirm'), t('confirm.delete'));
        if (!confirmed) return;
        await this._remove(this.sessions.map(session => session.id));
    }

    /** 清空所有项目的对话和提示词 */
    async clearAll() {
        await this.app.history.clearAll();
        this.app.promptRecall.load([]);
        this.reset();
        await this.refresh();
        this.setHistoryVisible(false);
    }

    async _remove(ids) {
        const removesCurrent = ids.includes(this.app.history.currentId);
        if (removesCurrent && this.app.agent.running) return;
        await this.app.history.remove(ids);
        if (removesCurrent) this.reset();
        await this.refresh();
    }
}
