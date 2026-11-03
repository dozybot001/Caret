/**
 * @fileoverview 历史记录列表
 * @description 显示当前项目的对话，支持打开、删除和清空
 */

import { formatDateTime, onLanguageChange, t } from '../i18n/index.js';

/**
 * 历史记录列表 UI
 * @class HistoryUI
 */
export class HistoryUI {
    /**
     * @param {HTMLElement} panel - 面板
     * @param {Object} actions - 操作回调：onOpen(id)、onDelete(session)、onClear()
     */
    constructor(panel, actions) {
        this.panel = panel;
        this.actions = actions;
        this.sessions = [];
        this.currentId = null;

        this.list = panel.querySelector('#history-list');
        this.empty = panel.querySelector('#history-empty');
        this.clearButton = panel.querySelector('#btn-clear-history');
        this.clearButton.addEventListener('click', () => this.actions.onClear());

        onLanguageChange(() => this.render(this.sessions, this.currentId));
    }

    get isVisible() {
        return !this.panel.classList.contains('hidden');
    }

    /**
     * 显示或隐藏列表
     * @param {boolean} visible - 是否显示
     */
    setVisible(visible) {
        this.panel.classList.toggle('hidden', !visible);
    }

    /**
     * 渲染列表
     * @param {Array} sessions - 会话，最新的在前
     * @param {string|null} currentId - 当前会话
     */
    render(sessions, currentId) {
        this.sessions = sessions;
        this.currentId = currentId;
        this.list.replaceChildren(...sessions.map(session => this._renderRow(session)));
        this.empty.classList.toggle('hidden', sessions.length > 0);
        this.clearButton.classList.toggle('hidden', sessions.length === 0);
    }

    _renderRow(session) {
        const row = document.createElement('div');
        row.className = `history-row${session.id === this.currentId ? ' is-current' : ''}`;

        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'history-open';
        open.title = session.title;
        const title = document.createElement('span');
        title.className = 'history-title';
        title.textContent = session.title;
        const time = document.createElement('span');
        time.className = 'history-time';
        time.textContent = formatDateTime(session.updatedAt);
        open.append(title, time);
        open.addEventListener('click', () => this.actions.onOpen(session.id));

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-close history-delete';
        remove.title = t('history.delete');
        remove.setAttribute('aria-label', remove.title);
        remove.innerHTML = '<i class="codicon codicon-trash"></i>';
        remove.addEventListener('click', () => this.actions.onDelete(session));

        row.append(open, remove);
        return row;
    }
}
