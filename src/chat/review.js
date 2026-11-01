/**
 * @fileoverview 审阅改动
 * @description 改动列表的操作：查看、写入、撤销和放弃，并把用户的决定告诉 Agent
 * @module review
 */

import { t } from '../i18n/index.js';
import { ChangesUI } from './changes-ui.js';
import { describeError } from './run-messages.js';

export class Review {
    /**
     * @param {Object} app - 应用控制器
     * @param {HTMLElement} panel - 改动列表
     */
    constructor(app, panel) {
        this.app = app;
        this.ui = new ChangesUI(panel, {
            onOpen: path => this.open(path),
            onDiscard: path => this._discard([path]),
            onDiscardAll: () => this._discard(app.editor.changes.list().map(change => change.path)),
            onApply: force => this.apply(force)
        });
    }

    /**
     * 查看某个文件的改动。用户开始自己看之后，编辑器不再跟随 Agent
     * @param {string} path - 文件路径
     */
    open(path) {
        const { app } = this;
        app.workspace.follow = false;
        app.editor.changes.show(path);
        if (app.isNarrow()) app.chatPanel.classList.add('collapsed');
    }

    /**
     * 写入改动
     * @param {boolean} force - 忽略冲突
     */
    async apply(force) {
        const { app } = this;
        const changes = app.editor.changes.list();
        if (changes.length === 0 || app.agent.running) return;

        this.ui.showConflict(null);
        this.ui.setBusy(true);
        try {
            const { conflicts, applied } = await app.editor.changes.apply({ force });
            if (conflicts) {
                this.ui.showConflict(conflicts);
                return;
            }
            app.agent.addNote('[The user applied the pending changes to disk.]');
            const row = app.chatUI.addApplied(applied.length, () => this._undo(applied, row));
            app.conversations.save();
            if (changes.some(change => change.isNew)) await app.fileHandlers.refreshTree();
            else app.fileHandlers.refreshGit();
        } catch (error) {
            app.chatUI.addError(describeError(error), null);
        } finally {
            this.ui.setBusy(false);
        }
    }

    /**
     * 撤销一次写入
     * @private
     */
    async _undo(applied, row) {
        const { app } = this;
        if (app.agent.running) {
            window.notify?.alert(t('folder.releaseBusy'), { type: 'warning' });
            return;
        }
        try {
            const { conflicts } = await app.editor.changes.undo(applied);
            if (conflicts) {
                const confirmed = await window.notify.confirm(t('changes.undoConflict', conflicts.join(', ')), t('changes.undoAnyway'));
                if (!confirmed) return;
                await app.editor.changes.undo(applied, { force: true });
            }
            app.agent.addNote('[The user undid the last apply. Those changes are pending again.]');
            app.chatUI.markUndone(row);
            app.conversations.save();
            await app.fileHandlers.refreshTree();
        } catch (error) {
            app.chatUI.addError(describeError(error), null);
        }
    }

    /**
     * 放弃改动
     * @private
     * @param {string[]} paths - 文件路径
     */
    async _discard(paths) {
        const { app } = this;
        for (const path of paths) {
            await app.editor.changes.discard(path);
        }
        app.agent.addNote(`[The user discarded the changes to: ${paths.join(', ')}.]`);
    }
}
