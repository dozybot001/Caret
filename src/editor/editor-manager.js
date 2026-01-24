/**
 * @fileoverview 编辑器管理器
 * @description 封装 Monaco Editor 实例，管理多标签页系统、代码编辑及文件保存逻辑
 * 
 * ## 职责
 * - 管理 Monaco Editor 实例的创建和销毁
 * - 管理多标签页系统
 * - 处理文件打开、保存、关闭等操作
 * 
 * @module EditorManager
 */
import { FS_CONSTANTS } from '../global/constants.js';

export class EditorManager {
    constructor(editorContainer, tabsContainer) {
        this.container = editorContainer;
        this.tabsContainer = tabsContainer;
        this.editorInstance = null;
        this.stdWrapper = null;

        this.tabs = [];
        this.currentTabId = null;
        this.previewTabId = null; // 当前预览的tab ID（预览tab在切换到其他文件时会被自动关闭）

        this.onSaveRequest = null;
        this.onFontSizeChange = null; // 字号变化回调
        
        // 存储实例（用于持久化标签页状态）
        this.store = null;
        // 文件管理器实例（用于通过路径获取文件句柄）
        this.fileManager = null;
        // 是否正在恢复标签页状态（避免在恢复过程中触发保存）
        this._isRestoringTabs = false;
        
        // 字体大小配置
        this.fontSize = 14;
        this.minFontSize = 8;
        this.maxFontSize = 72;
        
        // 欢迎页面模型
        this.welcomeModel = null;
    }

    async init() {
        // 动态加载 Monaco Editor loader
        if (typeof window !== 'undefined' && window.loadMonacoEditor) {
            window.loadMonacoEditor();
        }
        
        return new Promise((resolve) => {
            // 等待 Monaco loader 加载完成
            const checkMonaco = () => {
                if (typeof require !== 'undefined') {
                    // 配置 Monaco Editor 路径
                    const MONACO_CDN_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min';
                    require.config({ paths: { 'vs': `${MONACO_CDN_BASE}/vs` } });
                    
                    require(['vs/editor/editor.main'], () => {
                        this._defineTheme();
                        this._createEditors();
                        this._bindTabEvents();

                        this.resizeObserver = new ResizeObserver(() => this.layout());
                        this.resizeObserver.observe(this.container);

                        resolve();
                    }, (error) => {
                        if (window.notify) {
                            window.notify.alert(`Failed to load Monaco Editor: ${error.message}`, { type: 'error' });
                        }
                        // Provide fallback: show error message in container
                        this.container.innerHTML = `
                            <div class="editor-error-container">
                                <div class="editor-error-content">
                                    <i class="codicon codicon-warning editor-error-icon"></i>
                                    <h3>Editor Failed to Load</h3>
                                    <p>Unable to load Monaco Editor. Please check your network connection or refresh the page.</p>
                                </div>
                            </div>
                        `;
                        resolve(); // Resolve anyway to prevent hanging
                    });
                } else {
                    setTimeout(checkMonaco, 50);
                }
            };
            checkMonaco();
        });
    }

    dispose() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.editorInstance) {
            this.editorInstance.dispose();
            this.editorInstance = null;
        }
        // Clear tabs and models
        this.tabs.forEach(tab => {
            if (tab.model) tab.model.dispose();
        });
        this.tabs = [];
        this.currentTabId = null;
        
        // Dispose welcome model
        if (this.welcomeModel) {
            this.welcomeModel.dispose();
            this.welcomeModel = null;
        }
    }

    _defineTheme() {
        const getStyle = (varName, fallback = '') => {
            const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
            return value || fallback;
        };

        monaco.editor.defineTheme('gemini-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [],
            colors: {
                'editor.background': getStyle('--bg-1', '#000000'),
                'editor.foreground': getStyle('--text-1', '#e8e8e8'),
                'editor.lineHighlightBackground': getStyle('--bg-2', '#0f0f0f'),
                'editorIndentGuide.background': getStyle('--bg-4', '#2d2d2d'),
                'editorLineNumber.foreground': getStyle('--text-4', '#a0a0a0')
            }
        });
    }

    _createEditors() {

        this.stdWrapper = document.createElement('div');
        this.stdWrapper.id = 'std-editor-wrapper';
        this.stdWrapper.className = 'editor-instance-wrapper';
        this.container.appendChild(this.stdWrapper);

        // 创建欢迎页面模型
        this.welcomeModel = monaco.editor.createModel(this._getWelcomeContent(), 'plaintext');
        
        // 从 CSS 变量获取字体
        const fontFamily = getComputedStyle(document.documentElement)
            .getPropertyValue('--font-family')
            .trim() || "'Maple Mono', monospace";
        
        this.editorInstance = monaco.editor.create(this.stdWrapper, {
            value: this._getWelcomeContent(),
            language: 'plaintext',
            theme: 'gemini-dark',
            fontFamily: fontFamily,
            fontSize: this.fontSize,
            automaticLayout: true,
            wordWrap: 'on',
            minimap: { enabled: false },
            readOnly: true,
        });

        // 保存快捷键
        this.editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            this.saveCurrentTab();
        });

        // 字体大小调整快捷键
        this._setupFontSizeShortcuts();
    }


    /**
     * 显示欢迎页面
     * @private
     */
    _showWelcomePage() {
        if (this.welcomeModel && this.editorInstance) {
            this.showStandardMode(this.welcomeModel);
        }
    }

    /**
     * 获取欢迎页面内容
     * @private
     * @returns {string}
     */
    _getWelcomeContent() {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const modKey = isMac ? 'Cmd' : 'Ctrl';
        
        return `Welcome to Caret

Basic Operations:

• Open Folder: Click the folder icon on the left
• Open File: Click file in tree (preview) or double-click (pin)
• Pin Tab: Double-click a preview tab to pin it
• Save File: ${modKey} + S
• Find Text: ${modKey} + F

Font Size:

• Increase Font: ${modKey} + =
• Decrease Font: ${modKey} + -
• Reset Font: ${modKey} + 0

Tips:

• Clicking a file opens it in preview mode, which closes automatically when switching to another file
• Double-clicking a file or tab pin it, pinned files won't close automatically
• Modified files show a marker on the tab indicating unsaved changes`;
    }

    /**
     * 设置字体大小调整快捷键
     * @private
     */
    _setupFontSizeShortcuts() {
        // Ctrl/Cmd + Plus (或 =) 增大字体
        this.editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Equal, () => {
            this._adjustFontSize(1);
        });
        this.editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.NumpadAdd, () => {
            this._adjustFontSize(1);
        });

        // Ctrl/Cmd + Minus 减小字体
        this.editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Minus, () => {
            this._adjustFontSize(-1);
        });
        this.editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.NumpadSubtract, () => {
            this._adjustFontSize(-1);
        });

        // Ctrl/Cmd + 0 重置字体大小
        this.editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Digit0, () => {
            this._resetFontSize();
        });
        this.editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Numpad0, () => {
            this._resetFontSize();
        });
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
            // 通知字号变化
            if (this.onFontSizeChange) {
                this.onFontSizeChange(this.fontSize);
            }
        }
    }

    /**
     * 重置字体大小
     * @private
     */
    _resetFontSize() {
        this.fontSize = 14;
        this._updateFontSize();
        // 通知字号变化
        if (this.onFontSizeChange) {
            this.onFontSizeChange(this.fontSize);
        }
    }

    /**
     * 更新编辑器字体大小
     * @private
     */
    _updateFontSize() {
        if (this.editorInstance) {
            this.editorInstance.updateOptions({ fontSize: this.fontSize });
        }
    }

    _bindTabEvents() {

        this.tabsContainer.addEventListener('wheel', (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                this.tabsContainer.scrollLeft += e.deltaY;
            }
        });
    }

    /**
     * 将预览Tab转为固定Tab
     * @param {string} tabId - Tab ID
     */
    convertPreviewToFixed(tabId) {
        const tab = this.tabs.find(t => t.id === tabId);
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
            if (window.notify) {
                window.notify.alert('Editor not initialized. Unable to open file. Please refresh the page.', { type: 'error' });
            }
            return;
        }

        const fileName = fileHandle.name;
        const tabId = fullPath || fileName;

        const existingTab = this.tabs.find(t => t.id === tabId);
        if (existingTab) {
            // 如果传入 isPreview=false，且当前tab是预览tab，则转为固定tab
            if (!isPreview && existingTab.isPreview) {
                this.convertPreviewToFixed(tabId);
            }
            this.switchTab(tabId);
            return;
        }

        try {
            const file = await fileHandle.getFile();
            const fileSize = file.size;
            
            // Check if file is large
            const isLargeFile = fileSize > FS_CONSTANTS.LARGE_FILE_THRESHOLD;
            
            let text;
            if (isLargeFile) {
                // For large files, load in chunks
                text = await this._loadLargeFile(file);
            } else {
                text = await file.text();
            }
            
            const language = EditorManager.getLanguage(fileName);
            
            const model = monaco.editor.createModel(text, language);
            
            // Configure editor for large files using Monaco's built-in optimizations
            if (isLargeFile) {
                // Monaco Editor automatically handles large files with optimizations
                // We just need to disable some expensive features
                this.editorInstance.updateOptions({
                    wordWrap: 'on',
                    minimap: { enabled: false },
                    renderWhitespace: 'none',
                    renderLineHighlight: 'none',
                    renderIndentGuides: false,
                    occurrencesHighlight: false,
                    selectionHighlight: false,
                    codeLens: false
                });
            } else {
                // Reset options for normal files (in case they were changed)
                this.editorInstance.updateOptions({
                    wordWrap: 'on',
                    minimap: { enabled: false }
                });
            }

            model.onDidChangeContent(() => {
                const tab = this.tabs.find(t => t.id === tabId);
                if (tab) {
                    // 如果编辑了预览tab，将其转为固定tab
                    if (tab.isPreview) {
                        tab.isPreview = false;
                        if (this.previewTabId === tabId) {
                            this.previewTabId = null;
                        }
                    }
                    // Pending change tabs (SR preview) don't show dirty indicator
                    // They are preview copies, not actual file modifications
                    if (!tab.isDirty && !tab.isPendingChange) {
                        tab.isDirty = true;
                        this._renderTabs();
                        // 保存标签页状态（编辑时转为固定标签页）
                        this._saveTabsState();
                    }
                }
            });

            // 如果是预览tab，先关闭之前的预览tab
            if (isPreview && this.previewTabId && this.previewTabId !== tabId) {
                const prevPreviewTab = this.tabs.find(t => t.id === this.previewTabId);
                if (prevPreviewTab && prevPreviewTab.isPreview && !prevPreviewTab.isDirty) {
                    const prevIndex = this.tabs.findIndex(t => t.id === this.previewTabId);
                    if (prevIndex !== -1) {
                        prevPreviewTab.model.dispose();
                        this.tabs.splice(prevIndex, 1);
                    }
                }
                this.previewTabId = null;
            }

            const newTab = {
                id: tabId,
                name: fileName,
                handle: fileHandle,
                model: model,
                viewState: null,
                isDirty: false,
                isLargeFile: isLargeFile,
                isPreview: isPreview
            };
            this.tabs.push(newTab);

            if (isPreview) {
                this.previewTabId = tabId;
            }

            this.switchTab(tabId);
            
            // 保存标签页状态
            await this._saveTabsState();
        } catch (error) {
            if (window.notify) {
                window.notify.alert(`Failed to open file ${fileName}: ${error.message}`, { type: 'error' });
            }
        }
    }
    
    /**
     * 分块加载大文件
     * @private
     * @param {File} file - 文件对象
     * @returns {Promise<string>} 文件内容
     */
    async _loadLargeFile(file) {
        const chunkSize = FS_CONSTANTS.LARGE_FILE_CHUNK_SIZE;
        const chunks = [];
        let offset = 0;
        
        while (offset < file.size) {
            const chunk = await file.slice(offset, offset + chunkSize).text();
            chunks.push(chunk);
            offset += chunkSize;
            
            // Yield to prevent blocking
            if (offset % (chunkSize * 10) === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        return chunks.join('');
    }


    switchTab(tabId) {
        // 关闭之前的预览tab（如果存在且不是当前要切换到的tab）
        if (this.previewTabId && this.previewTabId !== tabId) {
            const previewTab = this.tabs.find(t => t.id === this.previewTabId);
            if (previewTab && previewTab.isPreview && !previewTab.isDirty) {
                // 预览tab未被编辑，可以安全关闭
                const previewIndex = this.tabs.findIndex(t => t.id === this.previewTabId);
                if (previewIndex !== -1) {
                    previewTab.model.dispose();
                    this.tabs.splice(previewIndex, 1);
                }
            }
            this.previewTabId = null;
        }

        if (this.currentTabId) {
            const currentTab = this.tabs.find(t => t.id === this.currentTabId);
            if (currentTab) {
                currentTab.viewState = this.editorInstance.saveViewState();
            }
        }

        const targetTab = this.tabs.find(t => t.id === tabId);
        if (!targetTab) return;

        this.showStandardMode(targetTab.model, targetTab.viewState);

        this.currentTabId = tabId;
        this._renderTabs();
        
        // 保存标签页状态
        this._saveTabsState();
    }

    async closeTab(tabId) {
        const index = this.tabs.findIndex(t => t.id === tabId);
        if (index === -1) return;

        const tabToClose = this.tabs[index];

        // 如果是pending change（SR预览），直接关闭，不警告（原文件未修改）
        // 只有真正的dirty（用户编辑）才需要警告
        if (tabToClose.isDirty && !tabToClose.isPendingChange) {
            if (!confirm(`${tabToClose.name} has unsaved changes. Close anyway?`)) return;
        }

        // SR预览只是编辑器中的副本，关闭时直接丢弃，原文件安全
        tabToClose.model.dispose();

        // 如果关闭的是预览tab，清理引用
        if (this.previewTabId === tabId) {
            this.previewTabId = null;
        }

        this.tabs.splice(index, 1);

        if (this.currentTabId === tabId) {
            if (this.tabs.length > 0) {
                const newIndex = Math.max(0, index - 1);
                this.switchTab(this.tabs[newIndex].id);
            } else {
                this.currentTabId = null;
                this._showWelcomePage();
                this._renderTabs();
            }
        } else {
            this._renderTabs();
        }
        
        // 保存标签页状态
        await this._saveTabsState();
    }

    async saveCurrentTab() {
        if (!this.currentTabId) return;

        const tab = this.tabs.find(t => t.id === this.currentTabId);
        if (!tab) return;

        try {
            const content = tab.model.getValue();

            if (this.onSaveRequest) {
                await this.onSaveRequest(tab.handle, content);
            }

            tab.isDirty = false;
            this._renderTabs();
            
            // 保存标签页状态
            await this._saveTabsState();

            const tabEl = document.querySelector(`.tab[data-id="${tab.id}"]`);
            if (tabEl) {
                tabEl.classList.add('save-success');
                setTimeout(() => tabEl.classList.remove('save-success'), 500);
            }
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Save failed or cancelled: ${err.message}`, { type: 'error' });
            }

        }
    }

    _renderTabs() {
        this.tabsContainer.innerHTML = '';

        this.tabs.forEach(tab => {
            const tabEl = document.createElement('div');
            let className = 'tab';
            // Pending change tabs don't show dirty indicator (they're preview copies)
            if (tab.isDirty && !tab.isPendingChange) {
                className += ' is-dirty';
            }
            if (tab.isPendingChange) {
                className += ' is-pending-change';
            }
            tabEl.className = className;
            tabEl.setAttribute('data-id', tab.id);

            tabEl.innerHTML = `
                <div class="tab-name">${tab.name}</div>
                <div class="tab-actions">
                    <div class="dirty-dot"></div>
                    <div class="pending-indicator"></div>
                    <button type="button" class="btn btn-close close-icon">
                        <i class="codicon codicon-close"></i>
                    </button>
                </div>
            `;

            tabEl.addEventListener('click', () => this.switchTab(tab.id));

            const closeBtn = tabEl.querySelector('.close-icon');
            closeBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.closeTab(tab.id);
            });

            this.tabsContainer.appendChild(tabEl);
        });
    }

    layout() {
        if (this.editorInstance) this.editorInstance.layout();
    }

    showStandardMode(model, viewState = null) {
        this.stdWrapper.classList.remove('hidden');

        this.editorInstance.setModel(model);
        // 如果是欢迎页面，设置为只读；否则设置为可编辑
        const isWelcomePage = model === this.welcomeModel;
        this.editorInstance.updateOptions({ readOnly: isWelcomePage });
        
        if (viewState) {
            this.editorInstance.restoreViewState(viewState);
        }
        this.editorInstance.focus();
    }

    async reset(clearStoredState = true) {
        // 在重置过程中禁用状态保存，避免覆盖存储的状态
        const wasRestoring = this._isRestoringTabs;
        this._isRestoringTabs = true;
        
        try {
            // Close all tabs and clean up
            await Promise.all([...this.tabs].map(t => this.closeTab(t.id)));
            
            // 清除标签页状态（仅在明确要求时清除，恢复文件夹时不应清除）
            if (clearStoredState && this.store) {
                await this.store.clearTabsState();
            }
        } finally {
            // 恢复之前的状态保存标志
            this._isRestoringTabs = wasRestoring;
        }
        
        // Force garbage collection hint (if available)
        if (window.gc) {
            window.gc();
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
            if (window.notify) {
                window.notify.alert(`Failed to save tabs state: ${err.message}`, { type: 'warning', duration: 3000 });
            }
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
                try {
                    // 检查是否已存在（避免重复打开）
                    if (this.tabs.find(t => t.id === tabData.id)) continue;
                    
                    const fileHandle = await this.fileManager.getFileHandleByPath(tabData.id);
                    if (fileHandle) {
                        await this.openFile(fileHandle, tabData.id, tabData.isPreview || false);
                    }
                } catch (err) {
                    if (window.notify) {
                        window.notify.alert(`Failed to restore tab ${tabData.id}: ${err.message}`, { type: 'warning', duration: 3000 });
                    }
                }
            }

            // 恢复当前活动的标签页
            if (tabsState.currentTabId) {
                const targetTab = this.tabs.find(t => t.id === tabsState.currentTabId);
                if (targetTab) {
                    this.switchTab(tabsState.currentTabId);
                }
            }

            // 恢复预览标签页ID（应该在恢复所有标签页后设置）
            if (tabsState.previewTabId) {
                const previewTab = this.tabs.find(t => t.id === tabsState.previewTabId);
                if (previewTab) {
                    this.previewTabId = tabsState.previewTabId;
                }
            }
            
            // 恢复完成后，重新渲染标签页以确保状态正确
            this._renderTabs();
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to restore tabs state: ${err.message}`, { type: 'warning', duration: 3000 });
            }
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

