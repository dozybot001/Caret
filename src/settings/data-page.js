/**
 * @fileoverview 数据页
 * @description 显示本地数据的用量，清空对话、恢复默认设置和清除全部本地数据
 * @module data-page
 */

import { t } from '../i18n/index.js';

export class DataPage {
    /**
     * @param {HTMLDialogElement} dialog - 设置对话框
     * @param {AppStore} store - 应用状态存储
     * @param {Function} resetPreferences - 恢复默认设置
     */
    constructor(dialog, store, resetPreferences) {
        this.store = store;
        this.status = null;
        this.usage = dialog.querySelector('#data-usage');
        this.statusText = dialog.querySelector('#data-status');

        /** 返回 Agent 是否在运行，运行时不清除数据 */
        this.isBusy = null;
        /** 确认后清空全部对话 */
        this.onClearConversations = null;
        /** 确认后清除全部本地数据 */
        this.onDeleteAll = null;

        const bind = (selector, copy, action) => {
            const button = dialog.querySelector(selector);
            button.addEventListener('click', () => this._run(button, copy, action));
        };
        bind('#btn-clear-conversations', { confirm: 'settings.clearConversationsConfirm', done: 'settings.conversationsCleared' },
            () => this.onClearConversations?.());
        bind('#btn-reset-preferences', { confirm: 'settings.resetPreferencesConfirm', done: 'settings.preferencesReset' }, resetPreferences);
        bind('#btn-delete-all', { confirm: 'settings.deleteAllConfirm' }, () => this.onDeleteAll?.());
    }

    /**
     * 执行操作：确认后立刻显示等待状态，结果写在页面上。
     * 通知条在对话框下层看不到，所以这里不用通知
     * @private
     * @param {HTMLButtonElement} button - 触发按钮
     * @param {{confirm: string, done: string}} copy - 确认和完成时的文案键
     * @param {Function} action - 操作
     */
    async _run(button, { confirm, done }, action) {
        if (this.isBusy?.()) {
            this.status = { key: 'settings.dataBusy', kind: 'error' };
            this.render();
            return;
        }
        if (!(await window.notify.confirm(t(confirm), button.textContent))) return;

        button.classList.add('is-loading');
        button.disabled = true;
        try {
            await action();
            this.status = { key: done, kind: 'ok' };
        } catch (error) {
            this.status = { key: 'error.generic', args: [error.message], kind: 'error' };
        }
        button.classList.remove('is-loading');
        button.disabled = false;
        await this.render();
    }

    /** 显示本地数据的用量和上一次操作的结果 */
    async render() {
        const { status } = this;
        this.statusText.textContent = status ? t(status.key, ...(status.args || [])) : '';
        this.statusText.dataset.kind = status?.kind || '';

        const [sessions, storage] = await Promise.all([this.store.listSessions(), navigator.storage?.estimate?.()]);
        const parts = [t('settings.storageCount', sessions.length)];
        if (storage) parts.unshift(t('settings.storageSize', (storage.usage / 1024 / 1024).toFixed(1)));
        this.usage.textContent = parts.join(' · ');
    }
}
