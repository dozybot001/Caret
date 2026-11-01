/**
 * @fileoverview 标签页状态
 * @description 保存打开的标签页，下次打开同一个文件夹时恢复
 * @module tab-state
 */

import { t } from '../i18n/index.js';

export class TabState {
    /** @param {Object} editor - 编辑器管理器 */
    constructor(editor) {
        this.editor = editor;
        /** 恢复或重置时不保存，避免覆盖存储的状态 */
        this.isPaused = false;
    }

    /** 保存标签页状态 */
    async save() {
        const { store, tabs, currentTabId, previewTabId } = this.editor;
        if (!store || this.isPaused) return;

        try {
            await store.saveTabsState({ tabs, currentTabId, previewTabId });
        } catch (error) {
            window.notify?.alert(t('error.generic', error.message), { type: 'warning', duration: 3000 });
        }
    }

    /**
     * 恢复标签页状态
     * @returns {Promise<void>}
     */
    async restore() {
        const { editor } = this;
        if (!editor.store || !editor.fileManager) return;

        try {
            this.isPaused = true;
            const saved = await editor.store.restoreTabsState();
            if (!saved?.tabs?.length || !editor.fileManager.getRootHandle()) return;

            for (const tab of saved.tabs) {
                // 文件可能已被删除或移动，跳过即可
                const handle = await editor.fileManager.getFileHandleByPath(tab.id).catch(() => null);
                if (handle && !editor.getTab(tab.id)) {
                    await editor.openFile(handle, tab.id, tab.isPreview || false);
                }
            }

            if (saved.currentTabId && editor.getTab(saved.currentTabId)) editor.switchTab(saved.currentTabId);
            // 预览标签页要在全部标签页恢复后设置
            if (saved.previewTabId && editor.getTab(saved.previewTabId)) editor.previewTabId = saved.previewTabId;
            editor.renderTabs();
        } catch (error) {
            window.notify?.alert(t('error.generic', error.message), { type: 'warning', duration: 3000 });
        } finally {
            this.isPaused = false;
            await this.save();
        }
    }
}
