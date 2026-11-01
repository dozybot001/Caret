/**
 * @fileoverview 编辑器管理器
 * @description 封装 Monaco Editor 实例，管理多标签页系统、代码编辑及文件保存逻辑
 *
 * ## 职责
 * - 管理 Monaco Editor 实例的创建和销毁
 * - 管理多标签页系统
 * - 处理文件打开、保存、关闭等操作
 * - 管理未写入的改动：改动就是编辑器缓冲区，Agent 和用户改的是同一份内容
 *
 * @module EditorManager
 */
import { FS_CONSTANTS } from '../global/constants.js';
import { decodeBytes } from '../file-tree/file-manager.js';
import { getLanguage, t } from '../global/i18n.js';
import { resolvedTheme } from '../global/preferences.js';

const MONACO_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min';

/** 根据偏移量计算行列，文本使用 LF 换行 */
function positionAt(text, offset) {
    const head = text.slice(0, offset);
    return { lineNumber: head.split('\n').length, column: offset - head.lastIndexOf('\n') };
}

export class EditorManager {
    constructor(editorContainer, tabsContainer) {
        this.container = editorContainer;
        this.tabsContainer = tabsContainer;
        this.editorInstance = null;
        this.diffEditor = null;
        this.stdWrapper = null;
        this.diffWrapper = null;

        this.tabs = [];
        this.currentTabId = null;
        this.previewTabId = null; // 当前预览的tab ID（预览tab在切换到其他文件时会被自动关闭）

        this.onFontSizeChange = null; // 字号变化回调
        this.onChangesUpdated = null; // 未写入改动变化回调
        this.onFileSaved = null; // 文件保存到磁盘后回调
        this.onEmptyChange = null; // 是否没有打开的标签页
        this.onUserNavigate = null; // 用户手动切换标签页

        // 存储实例（用于持久化标签页状态）
        this.store = null;
        // 文件管理器实例（用于通过路径获取文件句柄）
        this.fileManager = null;
        // 是否正在恢复标签页状态（避免在恢复过程中触发保存）
        this._isRestoringTabs = false;
        this._changesTimer = null;

        // 字体大小配置
        this.fontSize = 14;
        this.minFontSize = 8;
        this.maxFontSize = 72;
    }

    async init() {
        try {
            await this._loadMonaco();
            this.applyTheme();
            this._createEditors();
            this._bindTabEvents();

            this.resizeObserver = new ResizeObserver(() => this.layout());
            this.resizeObserver.observe(this.container);
        } catch (error) {
            window.notify?.alert(t('error.editorLoad'), { type: 'error' });
            const message = document.createElement('div');
            message.className = 'editor-error-container';
            message.textContent = t('error.editorLoad');
            this.container.appendChild(message);
        }
    }

    /**
     * 从 CDN 加载 Monaco。Worker 跨域，需要通过 data URL 中转
     * @private
     */
    _loadMonaco() {
        window.MonacoEnvironment = {
            getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(
                `self.MonacoEnvironment={baseUrl:'${MONACO_BASE}/'};importScripts('${MONACO_BASE}/vs/base/worker/workerMain.js');`
            )}`
        };

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `${MONACO_BASE}/vs/loader.min.js`;
            script.onerror = reject;
            script.onload = () => {
                window.require.config({
                    paths: { vs: `${MONACO_BASE}/vs` },
                    'vs/nls': getLanguage() === 'zh' ? { availableLanguages: { '*': 'zh-cn' } } : {}
                });
                window.require(['vs/editor/editor.main'], resolve, reject);
            };
            document.head.appendChild(script);
        });
    }

    dispose() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        this.diffEditor?.dispose();
        this.editorInstance?.dispose();
        this.diffEditor = null;
        this.editorInstance = null;
        // Clear tabs and models
        this.tabs.forEach(tab => {
            tab.model.dispose();
            tab.baseModel?.dispose();
        });
        this.tabs = [];
        this.currentTabId = null;
    }

    /** 根据当前主题的 CSS 变量设置编辑器配色 */
    applyTheme() {
        if (typeof monaco === 'undefined') return;
        const styles = getComputedStyle(document.documentElement);
        const color = name => styles.getPropertyValue(name).trim();
        const themeName = resolvedTheme() === 'dark' ? 'caret-dark' : 'caret-light';

        monaco.editor.defineTheme(themeName, {
            base: resolvedTheme() === 'dark' ? 'vs-dark' : 'vs',
            inherit: true,
            rules: [],
            colors: {
                'editor.background': color('--bg-1'),
                'editor.foreground': color('--text-1'),
                'editor.lineHighlightBackground': color('--bg-2'),
                'editorIndentGuide.background1': color('--bg-4'),
                'editorLineNumber.foreground': color('--text-6'),
                'diffEditor.insertedLineBackground': color('--diff-add-line'),
                'diffEditor.insertedTextBackground': color('--diff-add-text'),
                'diffEditor.removedLineBackground': color('--diff-remove-line'),
                'diffEditor.removedTextBackground': color('--diff-remove-text'),
                'diffEditorGutter.insertedLineBackground': color('--diff-add-line'),
                'diffEditorGutter.removedLineBackground': color('--diff-remove-line')
            }
        });
        monaco.editor.setTheme(themeName);
    }

    _createEditors() {
        this.stdWrapper = document.createElement('div');
        this.stdWrapper.id = 'std-editor-wrapper';
        this.stdWrapper.className = 'editor-instance-wrapper hidden';
        this.container.appendChild(this.stdWrapper);

        this.diffWrapper = document.createElement('div');
        this.diffWrapper.id = 'diff-editor-wrapper';
        this.diffWrapper.className = 'editor-instance-wrapper hidden';
        this.container.appendChild(this.diffWrapper);

        // 从 CSS 变量获取字体
        const fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-family').trim();
        const sharedOptions = {
            fontFamily,
            fontSize: this.fontSize,
            automaticLayout: true,
            wordWrap: 'on',
            minimap: { enabled: false },
            scrollBeyondLastLine: false
        };

        this.editorInstance = monaco.editor.create(this.stdWrapper, { ...sharedOptions, model: null });

        // 审阅改动用行内 diff；右侧内容可以直接编辑，只折叠没有变化的部分
        this.diffEditor = monaco.editor.createDiffEditor(this.diffWrapper, {
            ...sharedOptions,
            diffWordWrap: 'on',
            renderSideBySide: false,
            originalEditable: false,
            ignoreTrimWhitespace: false,
            renderMarginRevertIcon: false,
            renderGutterMenu: false,
            renderOverviewRuler: false,
            hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 3, revealLineCount: 20 }
        });

        this._bindCommands(this.editorInstance);
        this._bindCommands(this.diffEditor.getModifiedEditor());
    }

    /**
     * 绑定保存和字号快捷键
     * @private
     * @param {Object} editor - Monaco 编辑器
     */
    _bindCommands(editor) {
        const { KeyMod, KeyCode } = monaco;
        const shortcut = (key, run) => editor.addCommand(KeyMod.CtrlCmd | key, run);

        shortcut(KeyCode.KeyS, () => this.saveCurrentTab());
        shortcut(KeyCode.Equal, () => this._adjustFontSize(1));
        shortcut(KeyCode.NumpadAdd, () => this._adjustFontSize(1));
        shortcut(KeyCode.Minus, () => this._adjustFontSize(-1));
        shortcut(KeyCode.NumpadSubtract, () => this._adjustFontSize(-1));
        shortcut(KeyCode.Digit0, () => this._resetFontSize());
        shortcut(KeyCode.Numpad0, () => this._resetFontSize());
    }

    /**
     * 设置字体大小
     * @param {number} size - 字体大小
     */
    setFontSize(size) {
        const clampedSize = Math.max(this.minFontSize, Math.min(this.maxFontSize, size));
        if (clampedSize !== this.fontSize) {
            this.fontSize = clampedSize;
            this._updateFontSize();
        }
    }

    /**
     * 调整字体大小
     * @private
     * @param {number} delta - 字体大小变化量（正数增大，负数减小）
     */
    _adjustFontSize(delta) {
        const newSize = Math.max(this.minFontSize, Math.min(this.maxFontSize, this.fontSize + delta));
        if (newSize !== this.fontSize) {
            this.fontSize = newSize;
            this._updateFontSize();
            this.onFontSizeChange?.(this.fontSize);
        }
    }

    /**
     * 重置字体大小
     * @private
     */
    _resetFontSize() {
        this.fontSize = 14;
        this._updateFontSize();
        this.onFontSizeChange?.(this.fontSize);
    }

    /**
     * 更新编辑器字体大小
     * @private
     */
    /**
     * 设置自动换行，审阅改动时同样生效
     * @param {boolean} isOn - 是否换行
     */
    setWordWrap(isOn) {
        const value = isOn ? 'on' : 'off';
        this.editorInstance?.updateOptions({ wordWrap: value });
        this.diffEditor?.updateOptions({ diffWordWrap: value });
    }

    _updateFontSize() {
        this.editorInstance?.updateOptions({ fontSize: this.fontSize });
        this.diffEditor?.updateOptions({ fontSize: this.fontSize });
    }

    _bindTabEvents() {

        this.tabsContainer.addEventListener('wheel', (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                this.tabsContainer.scrollLeft += e.deltaY;
            }
        });
    }

    _getTab(tabId) {
        return this.tabs.find(tab => tab.id === tabId);
    }

    /**
     * 将预览Tab转为固定Tab
     * @param {string} tabId - Tab ID
     */
    convertPreviewToFixed(tabId) {
        const tab = this._getTab(tabId);
        if (tab && tab.isPreview) {
            tab.isPreview = false;
            if (this.previewTabId === tabId) {
                this.previewTabId = null;
            }
            this._renderTabs();

            // 保存标签页状态
            this._saveTabsState();
        }
    }

    async openFile(fileHandle, fullPath, isPreview = false) {
        // Check if Monaco is loaded
        if (!this.editorInstance) {
            window.notify?.alert(t('error.editorLoad'), { type: 'error' });
            return;
        }

        const tabId = fullPath || fileHandle.name;

        const existingTab = this._getTab(tabId);
        if (existingTab) {
            // 如果传入 isPreview=false，且当前tab是预览tab，则转为固定tab
            if (!isPreview && existingTab.isPreview) {
                this.convertPreviewToFixed(tabId);
            }
            this.switchTab(tabId);
            return;
        }

        try {
            await this._createTab(fileHandle, tabId, isPreview);
            this.switchTab(tabId);

            // 保存标签页状态
            await this._saveTabsState();
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
    async _createTab(fileHandle, tabId, isPreview) {
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

        const model = monaco.editor.createModel(decoded.text, EditorManager.getLanguage(name));

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
            this._refreshDirty(tab);
            this._notifyChanges();
        });

        this._notifyEmpty();
        return tab;
    }

    /**
     * 重新计算标签页是否有未写入的改动
     * @private
     */
    _refreshDirty(tab) {
        const wasDirty = tab.isDirty;
        if (tab.isNew) {
            tab.isDirty = true;
        } else if (tab.model.getAlternativeVersionId() === tab.savedVersion) {
            tab.isDirty = false;
        } else {
            tab.isDirty = tab.isLargeFile || this._modelText(tab) !== tab.original;
        }
        if (wasDirty !== tab.isDirty) {
            this._renderTabs();
            this._saveTabsState();
        }
    }

    _modelText(tab) {
        return tab.model.getValue(monaco.editor.EndOfLinePreference.LF);
    }

    /** 改动变化后通知界面，连续输入时合并 */
    _notifyChanges() {
        clearTimeout(this._changesTimer);
        this._changesTimer = setTimeout(() => this.onChangesUpdated?.(), 80);
    }

    _notifyEmpty() {
        this.onEmptyChange?.(this.tabs.length === 0);
    }

    _disposeTab(tab) {
        if (this.diffEditor.getModel()?.modified === tab.model) this.diffEditor.setModel(null);
        if (this.editorInstance.getModel() === tab.model) this.editorInstance.setModel(null);
        tab.model.dispose();
        tab.baseModel?.dispose();
        this.tabs.splice(this.tabs.indexOf(tab), 1);
    }

    /** 关闭未被编辑的预览标签页 */
    _closePreviewTab() {
        const previewTab = this._getTab(this.previewTabId);
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

        const currentTab = this._getTab(this.currentTabId);
        if (currentTab && !currentTab.showDiff) {
            currentTab.viewState = this.editorInstance.saveViewState();
        }

        const targetTab = this._getTab(tabId);
        if (!targetTab) return;

        this.currentTabId = tabId;
        this._present(targetTab, focus);
        this._renderTabs();

        // 保存标签页状态
        this._saveTabsState();
    }

    /**
     * 显示标签页：有待审阅的改动时显示 diff，否则显示普通编辑器
     * @private
     */
    _present(tab, focus = true) {
        if (tab.showDiff) {
            this.stdWrapper.classList.add('hidden');
            this.diffWrapper.classList.remove('hidden');
            if (!tab.baseModel) {
                tab.baseModel = monaco.editor.createModel(tab.original, tab.model.getLanguageId());
            }
            this.diffEditor.setModel({ original: tab.baseModel, modified: tab.model });
            if (focus) this.diffEditor.getModifiedEditor().focus();
            return;
        }

        this.diffWrapper.classList.add('hidden');
        this.stdWrapper.classList.remove('hidden');
        this.editorInstance.setModel(tab.model);
        this.editorInstance.updateOptions({ readOnly: tab.readOnly });
        if (tab.viewState) this.editorInstance.restoreViewState(tab.viewState);
        if (focus) this.editorInstance.focus();
    }

    async closeTab(tabId, { force = false } = {}) {
        const tabToClose = this._getTab(tabId);
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
                this.stdWrapper.classList.add('hidden');
                this.diffWrapper.classList.add('hidden');
                this._renderTabs();
            }
        } else {
            this._renderTabs();
        }

        this._notifyEmpty();
        this._notifyChanges();

        // 保存标签页状态
        await this._saveTabsState();
    }

    async saveCurrentTab() {
        const tab = this._getTab(this.currentTabId);
        if (!tab || tab.readOnly) return;

        try {
            await this._writeTab(tab);
            this.onFileSaved?.();
            const tabEl = this.tabsContainer.querySelector(`.tab[data-id="${CSS.escape(tab.id)}"]`);
            if (tabEl) {
                tabEl.classList.add('save-success');
                setTimeout(() => tabEl.classList.remove('save-success'), 500);
            }
        } catch (err) {
            window.notify?.alert(t('error.save', err.message), { type: 'error' });
        }
    }

    /**
     * 把标签页内容写入磁盘，并恢复普通编辑状态
     * @private
     */
    async _writeTab(tab) {
        await this.fileManager.writeFile(tab.id, `${tab.bom ? '﻿' : ''}${tab.model.getValue()}`);
        tab.handle ||= await this.fileManager.getFileHandleByPath(tab.id);
        tab.isNew = false;
        tab.showDiff = false;
        this._setBase(tab, this._modelText(tab));
        tab.savedVersion = tab.model.getAlternativeVersionId();
        this._refreshDirty(tab);
        this._renderTabs();
        if (this.currentTabId === tab.id) this._present(tab, false);
        this._notifyChanges();
    }

    /**
     * 更新 diff 基准
     * @private
     */
    _setBase(tab, text) {
        tab.original = text;
        tab.savedVersion = null;
        tab.baseModel?.setValue(text);
    }

    // ==================== Agent 改动 ====================

    /**
     * 读取已打开文件的内容
     * @param {string} path - 文件路径
     * @returns {string|null} 未打开或不能修改时返回 null
     */
    getTabText(path) {
        const tab = this._getTab(path);
        return tab && !tab.readOnly ? this._modelText(tab) : null;
    }

    /**
     * 列出未写入的改动
     * @returns {Array<{path: string, name: string, base: string, text: string, isNew: boolean}>}
     */
    getChanges() {
        return this.tabs.filter(tab => tab.isDirty).map(tab => ({
            path: tab.id,
            name: tab.name,
            base: tab.original,
            text: this._modelText(tab),
            isNew: tab.isNew
        }));
    }

    /**
     * 把新内容放进编辑器缓冲区，显示为待审阅的改动，不写入磁盘
     * @param {string} path - 文件路径
     * @param {string} text - 新内容（LF 换行）
     * @param {Object} options - 选项
     * @param {boolean} options.reveal - 是否切换到这个文件，不抢占输入焦点
     */
    async stageText(path, text, { reveal = true } = {}) {
        let tab = this._getTab(path);
        if (!tab) {
            const handle = await this.fileManager.getFileHandleByPath(path).catch(() => null);
            tab = await this._createTab(handle, path, false);
        }

        this._replaceText(tab, text);
        // 新文件全部是新增内容，直接显示文件本身
        tab.showDiff = !tab.isNew && this._modelText(tab) !== tab.original;
        this._refreshDirty(tab);

        if (reveal) this.switchTab(path, { focus: false });
        else if (this.currentTabId === path) this._present(tab, false);
        else this._renderTabs();
        this._notifyChanges();
    }

    /**
     * 只替换变化的部分，保留编辑器的撤销记录
     * @private
     */
    _replaceText(tab, text) {
        const before = this._modelText(tab);
        if (before === text) return;

        let start = 0;
        let endBefore = before.length;
        let endAfter = text.length;
        while (start < endBefore && start < endAfter && before[start] === text[start]) start++;
        while (endBefore > start && endAfter > start && before[endBefore - 1] === text[endAfter - 1]) {
            endBefore--;
            endAfter--;
        }

        const range = monaco.Range.fromPositions(positionAt(before, start), positionAt(before, endBefore));
        tab.model.pushStackElement();
        tab.model.pushEditOperations(null, [{ range, text: text.slice(start, endAfter) }], () => null);
        tab.model.pushStackElement();
    }

    /**
     * 显示某个文件的改动
     * @param {string} path - 文件路径
     * @param {Object} options - 选项
     * @param {boolean} options.focus - 是否把输入焦点移到编辑器
     */
    showChange(path, { focus = true } = {}) {
        const tab = this._getTab(path);
        if (!tab) return;
        tab.showDiff = !tab.isNew;
        this.switchTab(path, { focus });
    }

    /**
     * 放弃某个文件的改动
     * @param {string} path - 文件路径
     */
    async discardChange(path) {
        const tab = this._getTab(path);
        if (!tab) return;
        if (tab.isNew) {
            await this.closeTab(path, { force: true });
            return;
        }
        this._replaceText(tab, tab.original);
        tab.showDiff = false;
        this._refreshDirty(tab);
        if (this.currentTabId === path) this._present(tab, false);
        this._notifyChanges();
    }

    /**
     * 把所有改动写入磁盘。写入前检查磁盘内容，避免覆盖其他程序的修改
     * @param {Object} options - 选项
     * @param {boolean} options.force - 忽略冲突
     * @returns {Promise<{conflicts?: string[], applied?: Array}>}
     */
    async applyChanges({ force = false } = {}) {
        const tabs = this.tabs.filter(tab => tab.isDirty);

        if (!force) {
            const conflicts = [];
            for (const tab of tabs) {
                const disk = await this.fileManager.readText(tab.id);
                const changed = tab.isNew ? disk !== null : disk?.text !== tab.original;
                if (changed) conflicts.push(tab.id);
            }
            if (conflicts.length > 0) return { conflicts };
        }

        const applied = [];
        try {
            for (const tab of tabs) {
                const before = await this.fileManager.readBytes(tab.id);
                const after = this._modelText(tab);
                await this._writeTab(tab);
                applied.push({ path: tab.id, before, after });
            }
        } catch (error) {
            await this.undoApply(applied);
            throw error;
        }
        return { applied };
    }

    /**
     * 撤销一次写入：恢复磁盘内容，改动回到待写入状态
     * @param {Array<{path: string, before: ArrayBuffer|null, after: string}>} applied - 写入记录
     */
    async undoApply(applied) {
        for (const { path, before, after } of [...applied].reverse()) {
            const tab = this._getTab(path);
            if (before === null) {
                await this.fileManager.deleteFile(path);
                if (tab) {
                    tab.handle = null;
                    tab.isNew = true;
                    this._setBase(tab, '');
                }
            } else {
                await this.fileManager.writeFile(path, before);
                if (tab) this._setBase(tab, decodeBytes(before).text.replace(/\r\n/g, '\n'));
            }
            await this.stageText(path, after, { reveal: false });
        }
    }

    _renderTabs() {
        this.tabsContainer.replaceChildren();

        this.tabs.forEach(tab => {
            const tabEl = document.createElement('div');
            tabEl.className = `tab${tab.isDirty ? ' is-dirty' : ''}${tab.id === this.currentTabId ? ' is-active' : ''}${tab.isPreview ? ' is-preview' : ''}`;
            tabEl.dataset.id = tab.id;
            tabEl.title = tab.id;
            tabEl.role = 'tab';
            tabEl.setAttribute('aria-selected', String(tab.id === this.currentTabId));

            const nameEl = document.createElement('div');
            nameEl.className = 'tab-name';
            nameEl.textContent = tab.name;

            const actions = document.createElement('div');
            actions.className = 'tab-actions';
            const dot = document.createElement('div');
            dot.className = 'dirty-dot';
            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'btn btn-close close-icon';
            closeBtn.setAttribute('aria-label', t('settings.close'));
            closeBtn.innerHTML = '<i class="codicon codicon-close"></i>';
            actions.append(dot, closeBtn);
            tabEl.append(nameEl, actions);

            tabEl.addEventListener('click', () => {
                this.onUserNavigate?.();
                this.switchTab(tab.id);
            });
            tabEl.addEventListener('dblclick', () => this.convertPreviewToFixed(tab.id));

            closeBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.closeTab(tab.id);
            });

            this.tabsContainer.appendChild(tabEl);
        });

        this._revealActiveTab();
    }

    /** 让当前标签页在标签栏内可见，只滚动标签栏 */
    _revealActiveTab() {
        const active = this.tabsContainer.querySelector('.tab.is-active');
        if (!active) return;
        const bar = this.tabsContainer;
        const left = active.offsetLeft - bar.offsetLeft;
        if (left < bar.scrollLeft) {
            bar.scrollLeft = left;
        } else if (left + active.offsetWidth > bar.scrollLeft + bar.clientWidth) {
            bar.scrollLeft = left + active.offsetWidth - bar.clientWidth;
        }
    }

    layout() {
        this.editorInstance?.layout();
        this.diffEditor?.layout();
    }

    /** 关闭所有标签页，用于切换文件夹 */
    async reset(clearStoredState = true) {
        // 在重置过程中禁用状态保存，避免覆盖存储的状态
        const wasRestoring = this._isRestoringTabs;
        this._isRestoringTabs = true;

        try {
            for (const tab of [...this.tabs]) {
                await this.closeTab(tab.id, { force: true });
            }

            // 清除标签页状态（仅在明确要求时清除，恢复文件夹时不应清除）
            if (clearStoredState && this.store) {
                await this.store.clearTabsState();
            }
        } finally {
            // 恢复之前的状态保存标志
            this._isRestoringTabs = wasRestoring;
        }
    }

    /**
     * 保存标签页状态到存储
     * @private
     */
    async _saveTabsState() {
        if (!this.store || this._isRestoringTabs) return;

        try {
            await this.store.saveTabsState({
                tabs: this.tabs,
                currentTabId: this.currentTabId,
                previewTabId: this.previewTabId
            });
        } catch (err) {
            window.notify?.alert(t('error.generic', err.message), { type: 'warning', duration: 3000 });
        }
    }

    /**
     * 恢复标签页状态
     * @returns {Promise<void>}
     */
    async restoreTabsState() {
        if (!this.store || !this.fileManager) return;

        try {
            this._isRestoringTabs = true;
            const tabsState = await this.store.restoreTabsState();
            if (!tabsState || !tabsState.tabs || tabsState.tabs.length === 0) {
                return;
            }

            // 检查是否有根目录
            if (!this.fileManager.getRootHandle()) {
                return;
            }

            // 恢复所有标签页
            for (const tabData of tabsState.tabs) {
                // 文件可能已被删除或移动，跳过即可
                const fileHandle = await this.fileManager.getFileHandleByPath(tabData.id).catch(() => null);
                if (fileHandle && !this._getTab(tabData.id)) {
                    await this.openFile(fileHandle, tabData.id, tabData.isPreview || false);
                }
            }

            // 恢复当前活动的标签页
            if (tabsState.currentTabId && this._getTab(tabsState.currentTabId)) {
                this.switchTab(tabsState.currentTabId);
            }

            // 恢复预览标签页ID（应该在恢复所有标签页后设置）
            if (tabsState.previewTabId && this._getTab(tabsState.previewTabId)) {
                this.previewTabId = tabsState.previewTabId;
            }

            // 恢复完成后，重新渲染标签页以确保状态正确
            this._renderTabs();
        } catch (err) {
            window.notify?.alert(t('error.generic', err.message), { type: 'warning', duration: 3000 });
        } finally {
            this._isRestoringTabs = false;
            // 恢复完成后保存最终状态
            await this._saveTabsState();
        }
    }

    static getLanguage(fileName) {
        const ext = fileName.split('.').pop().toLowerCase();
        const map = {
            'js': 'javascript', 'mjs': 'javascript', 'cjs': 'javascript', 'jsx': 'javascript',
            'ts': 'typescript', 'mts': 'typescript', 'cts': 'typescript', 'tsx': 'typescript',
            'html': 'html', 'htm': 'html',
            'css': 'css', 'scss': 'scss', 'less': 'less',
            'json': 'json', 'md': 'markdown', 'py': 'python',
            'java': 'java', 'c': 'c', 'cpp': 'cpp', 'h': 'cpp',
            'cs': 'csharp', 'go': 'go', 'rs': 'rust', 'php': 'php',
            'rb': 'ruby', 'sh': 'shell', 'bash': 'shell', 'zsh': 'shell',
            'yaml': 'yaml', 'yml': 'yaml', 'xml': 'xml', 'sql': 'sql', 'dockerfile': 'dockerfile'
        };
        return map[ext] || 'plaintext';
    }
}
