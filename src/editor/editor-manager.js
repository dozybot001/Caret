/**
 * @fileoverview 编辑器管理器
 * @description 管理多标签页系统、当前文件的显示和文件保存，Monaco 实例在 EditorViews 里
 *
 * ## 职责
 * - 管理多标签页系统
 * - 处理文件打开、保存、关闭等操作
 *
 * @module EditorManager
 */
import { FS_CONSTANTS } from '../app/constants.js';
import { decodeBytes } from '../file-tree/file-manager.js';
import { t } from '../i18n/index.js';
import { EditorViews } from './editor-views.js';
import { applyMonacoTheme, languageOf, loadMonaco } from './monaco.js';
import { PendingChanges } from './pending-changes.js';
import { TabBar } from './tab-bar.js';
import { TabState } from './tab-state.js';

export class EditorManager {
    constructor(editorContainer, tabsContainer) {
        this.tabs = [];
        this.currentTabId = null;
        this.previewTabId = null; // 当前预览的tab ID（预览tab在切换到其他文件时会被自动关闭）

        this.onChangesUpdated = null; // 未写入改动变化回调
        this.onFileSaved = null; // 文件保存到磁盘后回调
        this.onEmptyChange = null; // 是否没有打开的标签页
        this.onUserNavigate = null; // 用户手动切换标签页

        // 存储实例（用于持久化标签页状态）
        this.store = null;
        // 文件管理器实例（用于通过路径获取文件句柄）
        this.fileManager = null;
        this._changesTimer = null;

        /** 普通编辑器和 Diff 编辑器 */
        this.views = new EditorViews(editorContainer, () => this.saveCurrentTab());
        /** 未写入的改动 */
        this.changes = new PendingChanges(this);
        /** 标签页的保存和恢复 */
        this.tabState = new TabState(this);
        this.tabBar = new TabBar(tabsContainer, {
            onSelect: (id) => {
                this.onUserNavigate?.();
                this.switchTab(id);
            },
            onPin: id => this.convertPreviewToFixed(id),
            onClose: id => this.closeTab(id)
        });
    }

    async init() {
        try {
            await loadMonaco();
            applyMonacoTheme();
            this.views.create();
        } catch (error) {
            window.notify?.alert(t('error.editorLoad'), { type: 'error' });
            const message = document.createElement('div');
            message.className = 'editor-error-container';
            message.textContent = t('error.editorLoad');
            this.views.container.appendChild(message);
        }
    }

    getTab(tabId) {
        return this.tabs.find(tab => tab.id === tabId);
    }

    /**
     * 将预览Tab转为固定Tab
     * @param {string} tabId - Tab ID
     */
    convertPreviewToFixed(tabId) {
        const tab = this.getTab(tabId);
        if (tab && tab.isPreview) {
            tab.isPreview = false;
            if (this.previewTabId === tabId) {
                this.previewTabId = null;
            }
            this.renderTabs();

            // 保存标签页状态
            this.tabState.save();
        }
    }

    async openFile(fileHandle, fullPath, isPreview = false) {
        // Check if Monaco is loaded
        if (!this.views.standard) {
            window.notify?.alert(t('error.editorLoad'), { type: 'error' });
            return;
        }

        const tabId = fullPath || fileHandle.name;

        const existingTab = this.getTab(tabId);
        if (existingTab) {
            // 如果传入 isPreview=false，且当前tab是预览tab，则转为固定tab
            if (!isPreview && existingTab.isPreview) {
                this.convertPreviewToFixed(tabId);
            }
            this.switchTab(tabId);
            return;
        }

        try {
            await this.createTab(fileHandle, tabId, isPreview);
            this.switchTab(tabId);

            // 保存标签页状态
            await this.tabState.save();
        } catch (error) {
            window.notify?.alert(t('error.openFile', fileHandle.name, error.message), { type: 'error' });
        }
    }

    /**
     * 创建标签页。没有句柄时表示尚未写入磁盘的新文件
     * @private
     * @param {FileSystemFileHandle|null} fileHandle - 文件句柄
     * @param {string} tabId - 标签页 ID，即文件路径
     * @param {boolean} isPreview - 是否为预览标签页
     * @returns {Promise<Object>} 标签页
     */
    async createTab(fileHandle, tabId, isPreview) {
        const name = tabId.split('/').pop();
        let decoded = { text: '', bom: false, editable: true };
        let isLargeFile = false;
        if (fileHandle) {
            const file = await fileHandle.getFile();
            isLargeFile = file.size > FS_CONSTANTS.LARGE_FILE_THRESHOLD;
            decoded = decodeBytes(await file.arrayBuffer());
            if (!decoded.editable) {
                window.notify?.alert(t('notice.readOnly', name), { type: 'warning' });
            }
        }

        const model = monaco.editor.createModel(decoded.text, languageOf(name));

        // 如果是预览tab，先关闭之前的预览tab
        if (isPreview && this.previewTabId && this.previewTabId !== tabId) {
            this._closePreviewTab();
        }

        const tab = {
            id: tabId,
            name,
            handle: fileHandle,
            model,
            baseModel: null,
            /** 磁盘上的内容（LF 换行），diff 的基准 */
            original: model.getValue(monaco.editor.EndOfLinePreference.LF),
            savedVersion: model.getAlternativeVersionId(),
            viewState: null,
            bom: decoded.bom,
            readOnly: !decoded.editable,
            isDirty: !fileHandle,
            isNew: !fileHandle,
            showDiff: false,
            isLargeFile,
            isPreview
        };
        this.tabs.push(tab);
        if (isPreview) this.previewTabId = tabId;

        model.onDidChangeContent(() => {
            // 如果编辑了预览tab，将其转为固定tab
            if (tab.isPreview) {
                tab.isPreview = false;
                if (this.previewTabId === tabId) {
                    this.previewTabId = null;
                }
            }
            this.refreshDirty(tab);
            this.notifyChanges();
        });

        this._notifyEmpty();
        return tab;
    }

    /**
     * 重新计算标签页是否有未写入的改动
     * @private
     */
    refreshDirty(tab) {
        const wasDirty = tab.isDirty;
        if (tab.isNew) {
            tab.isDirty = true;
        } else if (tab.model.getAlternativeVersionId() === tab.savedVersion) {
            tab.isDirty = false;
        } else {
            tab.isDirty = tab.isLargeFile || this.modelText(tab) !== tab.original;
        }
        if (wasDirty !== tab.isDirty) {
            this.renderTabs();
            this.tabState.save();
        }
    }

    modelText(tab) {
        return tab.model.getValue(monaco.editor.EndOfLinePreference.LF);
    }

    /** 改动变化后通知界面，连续输入时合并 */
    notifyChanges() {
        clearTimeout(this._changesTimer);
        this._changesTimer = setTimeout(() => this.onChangesUpdated?.(), 80);
    }

    _notifyEmpty() {
        this.onEmptyChange?.(this.tabs.length === 0);
    }

    _disposeTab(tab) {
        if (this.views.diff.getModel()?.modified === tab.model) this.views.diff.setModel(null);
        if (this.views.standard.getModel() === tab.model) this.views.standard.setModel(null);
        tab.model.dispose();
        tab.baseModel?.dispose();
        this.tabs.splice(this.tabs.indexOf(tab), 1);
    }

    /** 关闭未被编辑的预览标签页 */
    _closePreviewTab() {
        const previewTab = this.getTab(this.previewTabId);
        if (previewTab && previewTab.isPreview && !previewTab.isDirty) {
            this._disposeTab(previewTab);
        }
        this.previewTabId = null;
    }

    switchTab(tabId, { focus = true } = {}) {
        // 关闭之前的预览tab（如果存在且不是当前要切换到的tab）
        if (this.previewTabId && this.previewTabId !== tabId) {
            this._closePreviewTab();
        }

        const currentTab = this.getTab(this.currentTabId);
        if (currentTab && !currentTab.showDiff) {
            currentTab.viewState = this.views.standard.saveViewState();
        }

        const targetTab = this.getTab(tabId);
        if (!targetTab) return;

        this.currentTabId = tabId;
        this.present(targetTab, focus);
        this.renderTabs();

        // 保存标签页状态
        this.tabState.save();
    }

    /**
     * 显示标签页：有待审阅的改动时显示 diff，否则显示普通编辑器
     * @private
     */
    present(tab, focus = true) {
        if (tab.showDiff) {
            this.views.standardWrapper.classList.add('hidden');
            this.views.diffWrapper.classList.remove('hidden');
            if (!tab.baseModel) {
                tab.baseModel = monaco.editor.createModel(tab.original, tab.model.getLanguageId());
            }
            this.views.diff.setModel({ original: tab.baseModel, modified: tab.model });
            if (focus) this.views.diff.getModifiedEditor().focus();
            return;
        }

        this.views.diffWrapper.classList.add('hidden');
        this.views.standardWrapper.classList.remove('hidden');
        this.views.standard.setModel(tab.model);
        this.views.standard.updateOptions({ readOnly: tab.readOnly });
        if (tab.viewState) this.views.standard.restoreViewState(tab.viewState);
        if (focus) this.views.standard.focus();
    }

    async closeTab(tabId, { force = false } = {}) {
        const tabToClose = this.getTab(tabId);
        if (!tabToClose) return;
        const index = this.tabs.indexOf(tabToClose);

        if (tabToClose.isDirty && !force && !(await window.notify.confirm(t('editor.closeConfirm', tabToClose.name)))) return;

        this._disposeTab(tabToClose);

        // 如果关闭的是预览tab，清理引用
        if (this.previewTabId === tabId) {
            this.previewTabId = null;
        }

        if (this.currentTabId === tabId) {
            this.currentTabId = null;
            if (this.tabs.length > 0) {
                this.switchTab(this.tabs[Math.max(0, index - 1)].id);
            } else {
                this.views.standardWrapper.classList.add('hidden');
                this.views.diffWrapper.classList.add('hidden');
                this.renderTabs();
            }
        } else {
            this.renderTabs();
        }

        this._notifyEmpty();
        this.notifyChanges();

        // 保存标签页状态
        await this.tabState.save();
    }

    async saveCurrentTab() {
        const tab = this.getTab(this.currentTabId);
        if (!tab || tab.readOnly) return;

        try {
            await this.writeTab(tab);
            this.onFileSaved?.();
            this.tabBar.flashSaved(tab.id);
        } catch (err) {
            window.notify?.alert(t('error.save', err.message), { type: 'error' });
        }
    }

    /**
     * 把标签页内容写入磁盘，并恢复普通编辑状态
     * @private
     */
    async writeTab(tab) {
        await this.fileManager.writeFile(tab.id, `${tab.bom ? '﻿' : ''}${tab.model.getValue()}`);
        tab.handle ||= await this.fileManager.getFileHandleByPath(tab.id);
        tab.isNew = false;
        tab.showDiff = false;
        this.setBase(tab, this.modelText(tab));
        tab.savedVersion = tab.model.getAlternativeVersionId();
        this.refreshDirty(tab);
        this.renderTabs();
        if (this.currentTabId === tab.id) this.present(tab, false);
        this.notifyChanges();
    }

    /**
     * 更新 diff 基准
     * @private
     */
    setBase(tab, text) {
        tab.original = text;
        tab.savedVersion = null;
        tab.baseModel?.setValue(text);
    }

    /** 重新绘制标签栏 */
    renderTabs() {
        this.tabBar.render(this.tabs, this.currentTabId);
    }

    /**
     * 读取已打开文件的内容
     * @param {string} path - 文件路径
     * @returns {string|null} 未打开或不能修改时返回 null
     */
    getTabText(path) {
        const tab = this.getTab(path);
        return tab && !tab.readOnly ? this.modelText(tab) : null;
    }

    /** 关闭所有标签页，用于切换文件夹 */
    async reset() {
        // 关闭过程中不保存，避免留下中间状态
        const wasPaused = this.tabState.isPaused;
        this.tabState.isPaused = true;
        try {
            for (const tab of [...this.tabs]) await this.closeTab(tab.id, { force: true });
            await this.store?.clearTabsState();
        } finally {
            this.tabState.isPaused = wasPaused;
        }
    }
}
