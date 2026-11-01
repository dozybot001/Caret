/**
 * @fileoverview 改动列表
 * @description 显示未写入的文件和增删行数，提供写入、放弃和冲突处理
 */

import { countChanges } from '../agent/diff.js';
import { t, onLanguageChange } from '../i18n/index.js';

/**
 * 改动列表 UI
 * @class ChangesUI
 */
export class ChangesUI {
    /**
     * @param {HTMLElement} panel - 面板
     * @param {Object} actions - 操作回调：onOpen(path)、onDiscard(path)、onDiscardAll()、onApply(force)
     */
    constructor(panel, actions) {
        this.panel = panel;
        this.actions = actions;
        this.changes = [];
        this.locked = false;
        this.conflicts = null;

        this.summary = panel.querySelector('#changes-summary');
        this.list = panel.querySelector('#changes-list');
        this.conflictBox = panel.querySelector('#changes-conflict');
        this.conflictText = panel.querySelector('#changes-conflict-text');
        this.applyButton = panel.querySelector('#btn-apply');
        this.discardAllButton = panel.querySelector('#btn-discard-all');

        this.applyButton.title = `${navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'}Enter`;
        this.applyButton.addEventListener('click', () => this.actions.onApply(false));
        this.discardAllButton.addEventListener('click', () => this.actions.onDiscardAll());
        panel.querySelector('#btn-overwrite').addEventListener('click', () => this.actions.onApply(true));
        panel.querySelector('#btn-conflict-cancel').addEventListener('click', () => this.showConflict(null));

        onLanguageChange(() => this.render(this.changes));
    }

    /**
     * 渲染改动列表
     * @param {Array} changes - 改动
     */
    render(changes) {
        this.changes = changes;
        this.panel.classList.toggle('hidden', changes.length === 0);
        if (changes.length === 0) {
            this.list.replaceChildren();
            this.showConflict(null);
            return;
        }

        const rows = [];
        let added = 0;
        let removed = 0;
        for (const change of changes) {
            const stats = countChanges(change.base, change.text);
            added += stats.added;
            removed += stats.removed;
            rows.push(this._renderRow(change, stats));
        }
        this.list.replaceChildren(...rows);

        this.summary.replaceChildren(
            t('changes.files', changes.length),
            this._renderStats({ added, removed })
        );
    }

    _renderStats({ added, removed }) {
        const stats = document.createElement('span');
        stats.className = 'change-stats';
        if (added > 0) {
            const plus = document.createElement('span');
            plus.className = 'change-added';
            plus.textContent = `+${added}`;
            stats.appendChild(plus);
        }
        if (removed > 0) {
            const minus = document.createElement('span');
            minus.className = 'change-removed';
            minus.textContent = `−${removed}`;
            stats.appendChild(minus);
        }
        return stats;
    }

    _renderRow(change, stats) {
        const row = document.createElement('div');
        row.className = 'change-row';
        row.title = change.path;

        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'change-open';
        const separator = change.path.lastIndexOf('/');
        const name = document.createElement('span');
        name.className = 'change-name';
        name.textContent = change.path.slice(separator + 1);
        const directory = document.createElement('span');
        directory.className = 'change-directory';
        directory.textContent = change.path.slice(0, separator + 1);
        open.append(name, directory);
        if (change.isNew) {
            const tag = document.createElement('span');
            tag.className = 'change-tag';
            tag.textContent = t('changes.new');
            open.appendChild(tag);
        }
        open.addEventListener('click', () => this.actions.onOpen(change.path));

        const discard = document.createElement('button');
        discard.type = 'button';
        discard.className = 'btn btn-close change-discard';
        discard.title = t('changes.discard');
        discard.setAttribute('aria-label', discard.title);
        discard.disabled = this.locked;
        discard.innerHTML = '<i class="codicon codicon-discard"></i>';
        discard.addEventListener('click', () => this.actions.onDiscard(change.path));

        row.append(open, this._renderStats(stats), discard);
        return row;
    }

    /**
     * 运行中或写入中禁用操作
     * @param {boolean} locked - 是否禁用
     */
    setLocked(locked) {
        this.locked = locked;
        this.applyButton.disabled = locked;
        this.discardAllButton.disabled = locked;
        this.list.querySelectorAll('.change-discard').forEach(button => {
            button.disabled = locked;
        });
    }

    /**
     * 显示写入中的状态
     * @param {boolean} busy - 是否正在写入
     */
    setBusy(busy) {
        this.applyButton.classList.toggle('is-loading', busy);
        this.setLocked(busy);
    }

    /**
     * 显示写入冲突
     * @param {string[]|null} paths - 冲突文件，null 表示清除
     */
    showConflict(paths) {
        this.conflicts = paths;
        this.conflictBox.classList.toggle('hidden', !paths);
        if (paths) this.conflictText.textContent = t('changes.conflict', paths.join(', '));
    }
}
