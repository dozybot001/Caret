/**
 * @fileoverview Patch生成处理器
 * @description 处理Generate Patch的API调用和文件处理逻辑
 */

import { AIMessageManager } from './ai-message-manager.js';

/**
 * Patch生成处理器
 * @class PatchHandler
 */
export class PatchHandler {
    /**
     * 构造函数
     * @param {Object} context - 上下文对象，包含所有需要的依赖
     * @param {Object} context.file - 文件管理器实例
     * @param {Object} context.store - 状态存储实例
     * @param {Object} context.chatUI - 聊天 UI 实例
     */
    constructor(context) {
        this.context = context;
        this.currentAbortController = null;
        // 创建AI消息管理器
        this.amm = new AIMessageManager({
            store: context.store,
            chatUI: context.chatUI
        });
    }

    /**
     * 处理Generate Patch请求
     * @param {Array<{path: string, name: string, handle: FileSystemFileHandle}>} files - 选中的文件列表
     * @param {string} userQuery - 用户的查询/修改请求
     * @param {Function} onThinkingUpdate - thinking更新回调函数 (thinkingText) => void
     * @param {Function} onSRBlocksUpdate - searchReplaceBlocks更新回调函数 (srBlocksText) => void
     * @returns {Promise<string>} messageId，数据已由amm保存到db
     */
    async handleGeneratePatch(files, userQuery, onThinkingUpdate = null, onSRBlocksUpdate = null) {
        const { file } = this.context;

        // 创建AbortController用于取消请求
        this.currentAbortController = new AbortController();
        const signal = this.currentAbortController.signal;

        try {
            // 读取所有文件内容
            const fileContents = await this._readFileContents(files);
            
            // 使用amm发送Patch消息，amm会处理prompt构建、流式输出thinking和数据存储
            const messageId = await this.amm.sendPatchMessage({
                fileContents: fileContents,
                userQuery: userQuery,
                signal: signal,
                onThinkingUpdate: onThinkingUpdate,
                onSRBlocksUpdate: onSRBlocksUpdate
            });
            
            return messageId;
        } finally {
            this.currentAbortController = null;
        }
    }

    /**
     * 读取文件内容
     * @private
     * @param {Array<{path: string, name: string, handle: FileSystemFileHandle}>} files - 文件列表
     * @returns {Promise<Array<{path: string, content: string}>>} 文件内容数组
     */
    async _readFileContents(files) {
        const { file } = this.context;
        const fileContents = [];
        
        for (const fileInfo of files) {
            try {
                const content = await file.readFile(fileInfo.path);
                fileContents.push({
                    path: fileInfo.path,
                    content: content
                });
            } catch (err) {
                // 继续处理其他文件，即使某个文件读取失败
                if (window.notify) {
                    window.notify.alert(`Failed to read file ${fileInfo.path}: ${err.message}`, { type: 'warning' });
                }
                fileContents.push({
                    path: fileInfo.path,
                    content: `[Error: Failed to read file - ${err.message}]`
                });
            }
        }
        
        return fileContents;
    }

    /**
     * 取消当前请求
     * @param {Function} onUICleanup - UI清理回调函数（可选），用于恢复UI状态
     */
    async cancelCurrentRequest(onUICleanup = null) {
        if (this.currentAbortController) {
            await this.amm.cancelRequest({
                abortController: this.currentAbortController,
                onButtonReset: () => {
                    // 重置按钮状态（通过chatUI的回调）
                    const { chatUI } = this.context;
                    if (chatUI && chatUI.onGeneratePatchCancel) {
                        chatUI.onGeneratePatchCancel();
                    }
                },
                onUICleanup: onUICleanup,
                onCancel: async () => {
                    // 重置请求状态
                    this.currentAbortController = null;
                }
            });
        }
    }

    /**
     * 从数据库读取patch数据并生成文件列表（私有方法）
     * @private
     * @param {HTMLElement} msgDiv - 消息元素
     * @param {Object} store - 状态存储实例
     * @returns {Promise<void>}
     */
    async _loadPatchFileListFromDB(msgDiv, store) {
        const { chatUI } = this.context;
        const messageId = msgDiv.dataset.messageId;
        if (!messageId || !store) return;

        const chatData = await store.getChatData(messageId);
        if (!chatData || chatData.type !== 'patch' || typeof chatData.data !== 'string') {
            return;
        }

        const searchReplaceBlocks = chatData.data;
        if (!searchReplaceBlocks || !searchReplaceBlocks.trim()) return;

        // 从search replace块中解析文件信息
        const parsedFiles = this._parseSearchReplaceBlocks(searchReplaceBlocks);
        if (parsedFiles.length === 0) return;

        // 存储SR块数据到消息元素，供文件点击时使用
        msgDiv.dataset.searchReplaceBlocks = searchReplaceBlocks;

        const contentDiv = msgDiv.querySelector('.message-content');
        if (!contentDiv) return;

        // 在消息上添加文件列表
        this._appendPatchFileListToMessage(msgDiv, parsedFiles);

        // 恢复状态（如果存在）
        await this._restorePatchState(msgDiv);

        // 滚动到底部
        chatUI.scrollToBottom();
    }

    /**
     * 从search replace块中解析文件信息和统计
     * @private
     * @param {string} searchReplaceBlocks - search replace块内容
     * @returns {Array<{path: string, added: number, removed: number}>} 文件信息数组
     */
    _parseSearchReplaceBlocks(searchReplaceBlocks) {
        const files = [];
        
        if (!searchReplaceBlocks || !searchReplaceBlocks.trim()) {
            return files;
        }
        
        // 按文件分割：=== FILE: path ===
        const fileRegex = /=== FILE:\s*(.+?)\s*===\s*\n(.*?)(?=\n=== FILE:|$)/gs;
        let match;
        
        while ((match = fileRegex.exec(searchReplaceBlocks)) !== null) {
            const filePath = match[1].trim();
            const fileContent = match[2];
            
            // 计算每个文件的添加和删除行数
            let added = 0;
            let removed = 0;
            
            // 查找所有SEARCH和REPLACE块
            const blockRegex = /<<<<<<< SEARCH\s*\n(.*?)\n=======\s*\n(.*?)\n>>>>>>> REPLACE/gs;
            let blockMatch;
            
            while ((blockMatch = blockRegex.exec(fileContent)) !== null) {
                const searchText = blockMatch[1];
                const replaceText = blockMatch[2];
                
                // 计算行数（空行也算一行）
                const searchLines = searchText.split('\n').length;
                const replaceLines = replaceText.split('\n').length;
                
                // 如果search为空，只计算added
                if (searchLines === 1 && searchText.trim() === '') {
                    added += replaceLines;
                } else {
                    removed += searchLines;
                    added += replaceLines;
                }
            }
            
            if (added > 0 || removed > 0) {
                files.push({
                    path: filePath,
                    added: added,
                    removed: removed
                });
            }
        }
        
        return files;
    }

    /**
     * 在patch消息上添加文件列表
     * @private
     * @param {HTMLElement} msgDiv - 消息元素
     * @param {Array<{path: string, added: number, removed: number}>} files - 文件信息数组（包含统计信息）
     */
    _appendPatchFileListToMessage(msgDiv, files) {
        const { chatUI } = this.context;
        const contentDiv = msgDiv.querySelector('.message-content');
        if (!contentDiv) return;

        // 检查是否已经添加了文件列表（避免重复添加）
        if (contentDiv.querySelector('.file-list-title')) {
            return;
        }

        // 添加标题
        const titleDiv = document.createElement('div');
        titleDiv.className = 'file-list-title';
        titleDiv.textContent = 'Files to Patch:';
        contentDiv.appendChild(titleDiv);

        // 创建文件列表容器
        const fileListContainer = document.createElement('div');
        fileListContainer.className = 'file-list';

        // 使用真实的统计信息创建文件列表项
        files.forEach((fileInfo) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-list-item file-list-item-patch';
            fileItem.dataset.filePath = fileInfo.path;

            // 文件路径
            const fileName = document.createElement('span');
            fileName.className = 'file-list-item-name';
            fileName.textContent = fileInfo.path;

            // 使用真实的统计信息
            const stats = document.createElement('span');
            stats.className = 'file-list-item-stats';
            
            const added = fileInfo.added || 0;
            const removed = fileInfo.removed || 0;
            
            const addedSpan = document.createElement('span');
            addedSpan.className = 'file-list-item-stats-added';
            addedSpan.textContent = `+${added}`;
            
            const removedSpan = document.createElement('span');
            removedSpan.className = 'file-list-item-stats-removed';
            removedSpan.textContent = `-${removed}`;
            
            stats.appendChild(addedSpan);
            stats.appendChild(removedSpan);

            // Accept 和 Reject 按钮容器
            const actionButtons = document.createElement('div');
            actionButtons.className = 'file-list-item-actions';
            
            const acceptBtn = document.createElement('button');
            acceptBtn.type = 'button';
            acceptBtn.className = 'btn btn-close file-list-item-action-btn file-list-item-accept-btn';
            acceptBtn.setAttribute('aria-label', 'Accept');
            acceptBtn.innerHTML = '<i class="codicon codicon-check"></i>';
            
            const rejectBtn = document.createElement('button');
            rejectBtn.type = 'button';
            rejectBtn.className = 'btn btn-close file-list-item-action-btn file-list-item-reject-btn';
            rejectBtn.setAttribute('aria-label', 'Reject');
            rejectBtn.innerHTML = '<i class="codicon codicon-close"></i>';
            
            // 回退按钮
            const revertBtn = document.createElement('button');
            revertBtn.type = 'button';
            revertBtn.className = 'btn btn-close file-list-item-action-btn file-list-item-revert-btn';
            revertBtn.setAttribute('aria-label', 'Revert');
            revertBtn.innerHTML = '<i class="codicon codicon-arrow-left"></i>';
            
            // 更新文件项状态的辅助方法
            const updateFileItemState = (status) => {
                if (status) {
                    fileItem.classList.add('file-list-item-processed');
                    fileItem.dataset.fileStatus = status;
                    actionButtons.classList.add('file-list-item-actions-processed');
                } else {
                    fileItem.classList.remove('file-list-item-processed');
                    delete fileItem.dataset.fileStatus;
                    actionButtons.classList.remove('file-list-item-actions-processed');
                }
                if (fileListContainer._updateButtonTexts) {
                    fileListContainer._updateButtonTexts();
                }
                this._savePatchState(msgDiv);
            };

            acceptBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                updateFileItemState('accepted');
            });
            
            rejectBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                updateFileItemState('rejected');
            });
            
            revertBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                updateFileItemState(null);
            });
            
            actionButtons.appendChild(acceptBtn);
            actionButtons.appendChild(rejectBtn);
            actionButtons.appendChild(revertBtn);

            fileItem.appendChild(fileName);
            fileItem.appendChild(stats);
            fileItem.appendChild(actionButtons);
            
            // 添加文件点击事件（排除按钮区域）
            fileItem.addEventListener('click', async (e) => {
                if (e.target.closest('.file-list-item-action-btn')) {
                    return;
                }
                // 打开文件并显示SR块预览
                await this._openFileWithSRPreview(msgDiv, fileInfo.path);
            });
            
            fileListContainer.appendChild(fileItem);
        });

        contentDiv.appendChild(fileListContainer);

        // 添加 Accept All 和 Reject All 按钮容器
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'file-list-button-container';
        
        // 第一行：Accept All 和 Reject All
        const buttonRow = document.createElement('div');
        buttonRow.className = 'file-list-button-row';
        
        const acceptAllButton = document.createElement('button');
        acceptAllButton.type = 'button';
        acceptAllButton.className = 'btn btn-text btn-text-chat file-list-accept-all-btn';
        acceptAllButton.textContent = 'Accept All';
        
        const rejectAllButton = document.createElement('button');
        rejectAllButton.type = 'button';
        rejectAllButton.className = 'btn btn-text btn-text-chat file-list-reject-all-btn';
        rejectAllButton.textContent = 'Reject All';

        // 更新按钮文本的函数
        const updateButtonTexts = () => {
            const allFileItems = fileListContainer.querySelectorAll('.file-list-item-patch');
            let hasAccepted = false;
            let hasRejected = false;
            
            allFileItems.forEach((fileItem) => {
                const status = fileItem.dataset.fileStatus;
                if (status === 'accepted') {
                    hasAccepted = true;
                } else if (status === 'rejected') {
                    hasRejected = true;
                }
            });
            
            if (hasRejected) {
                acceptAllButton.textContent = 'Accept Rest';
            } else {
                acceptAllButton.textContent = 'Accept All';
            }
            
            if (hasAccepted) {
                rejectAllButton.textContent = 'Reject Rest';
            } else {
                rejectAllButton.textContent = 'Reject All';
            }
        };
        
        fileListContainer._updateButtonTexts = updateButtonTexts;
        
        // 批量更新文件项状态的辅助方法
        const toggleAllFileItems = (status) => {
            const allFileItems = fileListContainer.querySelectorAll('.file-list-item-patch');
            const statusItems = fileListContainer.querySelectorAll(`.file-list-item-patch[data-file-status="${status}"]`);
            
            // 如果所有项都已设置为此状态，则清除所有状态；否则设置所有未处理的项为此状态
            const shouldClear = allFileItems.length > 0 && statusItems.length === allFileItems.length;
            
            if (shouldClear) {
                allFileItems.forEach((fileItem) => {
                    const actionButtons = fileItem.querySelector('.file-list-item-actions');
                    if (actionButtons) {
                        fileItem.classList.remove('file-list-item-processed');
                        delete fileItem.dataset.fileStatus;
                        actionButtons.classList.remove('file-list-item-actions-processed');
                    }
                });
            } else {
                const fileItems = fileListContainer.querySelectorAll('.file-list-item-patch:not(.file-list-item-processed)');
                fileItems.forEach((fileItem) => {
                    const actionButtons = fileItem.querySelector('.file-list-item-actions');
                    if (actionButtons && !actionButtons.classList.contains('file-list-item-actions-processed')) {
                        fileItem.classList.add('file-list-item-processed');
                        fileItem.dataset.fileStatus = status;
                        actionButtons.classList.add('file-list-item-actions-processed');
                    }
                });
            }
            updateButtonTexts();
            this._savePatchState(msgDiv);
        };
        
        acceptAllButton.addEventListener('click', () => toggleAllFileItems('accepted'));
        rejectAllButton.addEventListener('click', () => toggleAllFileItems('rejected'));
        
        buttonRow.appendChild(acceptAllButton);
        buttonRow.appendChild(rejectAllButton);
        buttonContainer.appendChild(buttonRow);
        
        // 第二行：Apply Patches
        const applyPatchesButton = document.createElement('button');
        applyPatchesButton.type = 'button';
        applyPatchesButton.className = 'btn btn-text btn-text-chat file-list-apply-patches-btn';
        applyPatchesButton.textContent = 'Apply Patches';
        applyPatchesButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const allFileItems = fileListContainer.querySelectorAll('.file-list-item-patch');
            const unprocessedItems = fileListContainer.querySelectorAll('.file-list-item-patch:not(.file-list-item-processed)');
            
            if (unprocessedItems.length > 0) {
                if (window.notify) {
                    window.notify.alert('Please accept or reject all files before applying patches', { type: 'error' });
                }
                return;
            }
            
            // 禁用所有按钮（统一通过 _disableButtons 处理）
            const { chatUI } = this.context;
            if (chatUI && chatUI._disableButtons) {
                chatUI._disableButtons([applyPatchesButton, acceptAllButton, rejectAllButton]);
            }
            
            // 应用补丁
            await this._applyPatches(msgDiv);
            
            msgDiv.classList.add('disabled');
            // 保存状态到数据库
            this._savePatchState(msgDiv);
        });
        
        buttonContainer.appendChild(applyPatchesButton);
        contentDiv.appendChild(buttonContainer);

        // 滚动到底部
        chatUI.scrollToBottom();
    }

    /**
     * 保存patch消息的状态（文件状态和禁用状态）
     * @private
     * @param {HTMLElement} msgDiv - 消息元素
     */
    async _savePatchState(msgDiv) {
        const { store } = this.context;
        const messageId = msgDiv.dataset.messageId;
        if (!messageId || !store) return;

        try {
            // 获取当前的chatData
            const chatData = await store.getChatData(messageId);
            if (!chatData || chatData.type !== 'patch') return;

            // 收集文件状态
            const fileStatuses = [];
            const fileItems = msgDiv.querySelectorAll('.file-list-item-patch');
            fileItems.forEach((fileItem) => {
                const path = fileItem.dataset.filePath;
                const status = fileItem.dataset.fileStatus;
                if (path && status) {
                    fileStatuses.push({ path, status });
                }
            });

            // 检查消息是否禁用
            const isDisabled = msgDiv.classList.contains('disabled');

            // 更新chatData的状态
            chatData.state = {
                disabled: isDisabled,
                fileStatuses: fileStatuses
            };

            // 保存到数据库
            await store.saveChatData(messageId, chatData);
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to save patch state: ${err.message}`, { type: 'warning', duration: 3000 });
            }
        }
    }

    /**
     * 应用补丁到文件
     * @private
     * @param {HTMLElement} msgDiv - 消息元素
     */
    async _applyPatches(msgDiv) {
        const { store, file } = this.context;
        const messageId = msgDiv.dataset.messageId;
        if (!messageId || !store || !file) return;

        try {
            // 获取patch数据
            const chatData = await store.getChatData(messageId);
            if (!chatData || chatData.type !== 'patch' || typeof chatData.data !== 'string') {
                if (window.notify) {
                    window.notify.alert('Failed to load patch data', { type: 'error' });
                }
                return;
            }

            const searchReplaceBlocks = chatData.data;
            if (!searchReplaceBlocks || !searchReplaceBlocks.trim()) {
                if (window.notify) {
                    window.notify.alert('No patch data found', { type: 'error' });
                }
                return;
            }

            // 解析search-replace块
            const parsedFiles = this._parseSearchReplaceBlocksForApply(searchReplaceBlocks);
            if (parsedFiles.length === 0) {
                if (window.notify) {
                    window.notify.alert('No valid patches found', { type: 'error' });
                }
                return;
            }

            // 获取已接受的文件列表
            const acceptedFiles = [];
            const fileItems = msgDiv.querySelectorAll('.file-list-item-patch');
            fileItems.forEach((fileItem) => {
                const path = fileItem.dataset.filePath;
                const status = fileItem.dataset.fileStatus;
                if (path && status === 'accepted') {
                    acceptedFiles.push(path);
                }
            });

            if (acceptedFiles.length === 0) {
                if (window.notify) {
                    window.notify.alert('No files accepted for patching', { type: 'warning' });
                }
                return;
            }

            let successCount = 0;
            let errorCount = 0;
            const patchedFiles = []; // 存储成功应用补丁的文件路径

            // 应用每个文件的补丁
            for (const filePath of acceptedFiles) {
                const fileData = parsedFiles.find(f => f.path === filePath);
                if (!fileData || fileData.blocks.length === 0) {
                    continue;
                }

                try {
                    // 读取当前文件内容
                    const currentContent = await file.readFile(filePath);
                    
                    // 应用所有search-replace块
                    let modifiedContent = currentContent;
                    for (const block of fileData.blocks) {
                        modifiedContent = this._applySearchReplace(modifiedContent, block.search, block.replace);
                    }
                    
                    // 写入文件
                    await file.writeFile(filePath, modifiedContent);
                    
                    successCount++;
                    patchedFiles.push(filePath);
                } catch (err) {
                    errorCount++;
                    if (window.notify) {
                        window.notify.alert(`Failed to apply patches to ${filePath}: ${err.message}`, { type: 'error', duration: 5000 });
                    }
                }
            }

            // 重新加载已应用补丁的文件
            if (patchedFiles.length > 0) {
                await this._reloadPatchedFiles(patchedFiles);
            }

            // 显示成功通知
            if (errorCount === 0 && successCount > 0) {
                if (window.notify) {
                    window.notify.alert(`Successfully applied patches to ${successCount} file${successCount > 1 ? 's' : ''}`, { type: 'success' });
                }
            }

            // 滚动到底部
            const { chatUI } = this.context;
            if (chatUI) {
                chatUI.scrollToBottom();
            }
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to apply patches: ${err.message}`, { type: 'error' });
            }
        }
    }

    /**
     * 解析search-replace块用于应用补丁
     * @private
     * @param {string} searchReplaceBlocks - search replace块内容
     * @returns {Array<{path: string, blocks: Array<{search: string, replace: string}>}>} 文件信息数组
     */
    _parseSearchReplaceBlocksForApply(searchReplaceBlocks) {
        const files = [];
        
        if (!searchReplaceBlocks || !searchReplaceBlocks.trim()) {
            return files;
        }
        
        // 按文件分割：=== FILE: path ===
        const fileRegex = /=== FILE:\s*(.+?)\s*===\s*\n(.*?)(?=\n=== FILE:|$)/gs;
        let match;
        
        while ((match = fileRegex.exec(searchReplaceBlocks)) !== null) {
            const filePath = match[1].trim();
            const fileContent = match[2];
            
            const blocks = [];
            
            // 查找所有SEARCH和REPLACE块
            const blockRegex = /<<<<<<< SEARCH\s*\n(.*?)\n=======\s*\n(.*?)\n>>>>>>> REPLACE/gs;
            let blockMatch;
            
            while ((blockMatch = blockRegex.exec(fileContent)) !== null) {
                const searchText = blockMatch[1];
                const replaceText = blockMatch[2];
                
                blocks.push({
                    search: searchText,
                    replace: replaceText
                });
            }
            
            if (blocks.length > 0) {
                files.push({
                    path: filePath,
                    blocks: blocks
                });
            }
        }
        
        return files;
    }

    /**
     * 打开文件并显示SR块预览
     * @private
     * @param {HTMLElement} msgDiv - 消息元素
     * @param {string} filePath - 文件路径
     */
    async _openFileWithSRPreview(msgDiv, filePath) {
        const { file, editor } = this.context;
        if (!file || !editor) return;

        try {
            // 获取SR块数据
            const searchReplaceBlocks = msgDiv.dataset.searchReplaceBlocks;
            if (!searchReplaceBlocks) return;

            // 解析该文件的SR块
            const fileSRBlocks = this._parseSRBlocksForFile(searchReplaceBlocks, filePath);
            if (fileSRBlocks.length === 0) {
                // 如果没有SR块，直接打开文件
                const fileHandle = await file.getFileHandleByPath(filePath);
                if (fileHandle) {
                    await editor.openFile(fileHandle, filePath, false);
                }
                return;
            }

            // 打开文件
            const fileHandle = await file.getFileHandleByPath(filePath);
            if (!fileHandle) return;

            await editor.openFile(fileHandle, filePath, false);

            // 等待编辑器切换完成并确保tab是活动的
            let retries = 0;
            while (retries < 10) {
                await new Promise(resolve => setTimeout(resolve, 50));
                const tab = editor.tabs.find(t => t.id === filePath);
                if (tab && editor.currentTabId === filePath && editor.editorInstance) {
                    // 确保模型已设置
                    const currentModel = editor.editorInstance.getModel();
                    if (currentModel && currentModel === tab.model) {
                        break;
                    }
                }
                retries++;
            }

            // 检查是否已经插入过SR块
            const tab = editor.tabs.find(t => t.id === filePath);
            if (tab && tab.hasSRPreview) {
                // 已经处理过，直接切换tab
                editor.switchTab(filePath);
                return;
            }

            // 显示SR块预览（只处理一次）
            await this._showSRBlocksPreview(editor, filePath, fileSRBlocks);
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to open file with preview: ${err.message}`, { type: 'error' });
            }
        }
    }

    /**
     * 解析指定文件的SR块
     * @private
     * @param {string} searchReplaceBlocks - SR块文本
     * @param {string} filePath - 文件路径
     * @returns {Array<{search: string, replace: string, searchStart: number, searchEnd: number}>} SR块数组
     */
    _parseSRBlocksForFile(searchReplaceBlocks, filePath) {
        const blocks = [];
        
        if (!searchReplaceBlocks || !searchReplaceBlocks.trim()) {
            return blocks;
        }
        
        // 按文件分割：=== FILE: path ===
        const fileRegex = /=== FILE:\s*(.+?)\s*===\s*\n(.*?)(?=\n=== FILE:|$)/gs;
        let match;
        
        while ((match = fileRegex.exec(searchReplaceBlocks)) !== null) {
            const matchedPath = match[1].trim();
            if (matchedPath !== filePath) continue;
            
            const fileContent = match[2];
            
            // 查找所有SEARCH和REPLACE块
            const blockRegex = /<<<<<<< SEARCH\s*\n(.*?)\n=======\s*\n(.*?)\n>>>>>>> REPLACE/gs;
            let blockMatch;
            
            while ((blockMatch = blockRegex.exec(fileContent)) !== null) {
                const searchText = blockMatch[1];
                const replaceText = blockMatch[2];
                
                blocks.push({
                    search: searchText,
                    replace: replaceText
                });
            }
            
            break; // 找到目标文件后退出
        }
        
        return blocks;
    }

    /**
     * 在编辑器中显示SR块预览
     * @private
     * @param {Object} editor - 编辑器管理器实例
     * @param {string} filePath - 文件路径
     * @param {Array<{search: string, replace: string}>} srBlocks - SR块数组
     */
    async _showSRBlocksPreview(editor, filePath, srBlocks) {
        if (!editor.editorInstance || typeof window.monaco === 'undefined') {
            console.warn('Editor instance or Monaco not available');
            return;
        }

        const tab = editor.tabs.find(t => t.id === filePath);
        if (!tab || !tab.model) {
            console.warn('Tab or model not found for file:', filePath);
            return;
        }

        // 确保当前显示的模型是正确的
        const currentModel = editor.editorInstance.getModel();
        if (currentModel !== tab.model) {
            editor.switchTab(filePath);
            await new Promise(resolve => setTimeout(resolve, 150));
            const newModel = editor.editorInstance.getModel();
            if (newModel !== tab.model) {
                console.error('Failed to switch to correct model');
                return;
            }
        }
        
        editor.editorInstance.focus();

        // 保存原始内容（如果还没有保存）
        if (!tab.originalContent) {
            tab.originalContent = tab.model.getValue();
        }

        let content = tab.model.getValue();
        if (!content) {
            console.warn('File content is empty');
            return;
        }

        // 如果已经插入过SR块，不再重复处理
        if (tab.hasSRPreview) {
            return;
        }

        const monaco = window.monaco;
        const decorations = [];
        let firstPatchLine = null;
        
        // 从后往前处理SR块，避免位置偏移问题
        const sortedBlocks = [...srBlocks].reverse();
        const replacements = []; // 存储所有替换位置和内容
        
        // 第一步：收集所有替换位置
        for (const block of sortedBlocks) {
            const blockSearchText = block.search;
            const blockReplaceText = block.replace;
            
            if (!blockSearchText || blockSearchText.trim() === '') {
                // 空搜索表示在文件末尾添加
                replacements.push({
                    start: content.length,
                    end: content.length,
                    searchText: '',
                    replaceText: blockReplaceText,
                    isAppend: true
                });
                continue;
            }

            // 查找search文本的位置（从后往前找最后一个匹配）
            let index = content.lastIndexOf(blockSearchText);
            if (index === -1) {
                // 尝试忽略末尾空白
                const searchTrimmed = blockSearchText.trimEnd();
                index = content.lastIndexOf(searchTrimmed);
                if (index === -1) {
                    console.warn('Search text not found:', blockSearchText.substring(0, 50));
                    continue;
                }
                
                const afterMatch = content.substring(index + searchTrimmed.length);
                if (!afterMatch.startsWith('\n') && afterMatch !== '') {
                    continue;
                }
                replacements.push({
                    start: index,
                    end: index + searchTrimmed.length,
                    searchText: searchTrimmed,
                    replaceText: blockReplaceText,
                    isAppend: false
                });
            } else {
                replacements.push({
                    start: index,
                    end: index + blockSearchText.length,
                    searchText: blockSearchText,
                    replaceText: blockReplaceText,
                    isAppend: false
                });
            }
        }
        
        // 第二步：从后往前替换search文本为代码块（不显示标记）
        for (const replacement of replacements) {
            const { searchText, replaceText, start, end, isAppend } = replacement;
            
            if (isAppend) {
                // 在文件末尾添加替换代码
                const srBlockText = `\n${replaceText}\n`;
                content = content + srBlockText;
            } else {
                // 替换search文本为：search代码 + replace代码（不显示标记）
                const srBlockText = `${searchText}\n${replaceText}`;
                content = content.substring(0, start) + srBlockText + content.substring(end);
            }
        }
        
        // 第三步：计算装饰位置（基于最终内容）
        const finalLines = content.split('\n');
        let processedLines = 0;
        
        // 从后往前处理替换，计算装饰位置
        for (const replacement of replacements.reverse()) {
            const { searchText: blockSearchText, replaceText: blockReplaceText, isAppend } = replacement;
            
            const searchLines = blockSearchText ? blockSearchText.split('\n').length : 0;
            const replaceLines = blockReplaceText.split('\n').length;
            
            if (isAppend) {
                // 追加操作：在文件末尾
                const replaceStartLine = finalLines.length - replaceLines + 1;
                const replaceEndLine = finalLines.length;
                
                if (firstPatchLine === null) {
                    firstPatchLine = replaceStartLine;
                }
                
                // 装饰REPLACE内容（绿色背景，整行）
                for (let line = replaceStartLine; line <= replaceEndLine; line++) {
                    decorations.push({
                        range: new monaco.Range(line, 1, line, 1000),
                        options: {
                            className: 'sr-block-replace',
                            isWholeLine: true
                        }
                    });
                }
            } else {
                // 替换操作：在最终内容中查找search文本的位置
                // 从文件末尾往前找，找到最后一个匹配的位置
                let foundIndex = -1;
                for (let i = finalLines.length - 1; i >= 0; i--) {
                    const line = finalLines[i];
                    if (blockSearchText && line.trim() === blockSearchText.split('\n')[0].trim()) {
                        // 验证后续行是否匹配
                        let matches = true;
                        const searchLineArray = blockSearchText.split('\n');
                        for (let j = 0; j < searchLineArray.length && i + j < finalLines.length; j++) {
                            if (finalLines[i + j].trim() !== searchLineArray[j].trim()) {
                                matches = false;
                                break;
                            }
                        }
                        if (matches) {
                            foundIndex = i;
                            break;
                        }
                    }
                }
                
                if (foundIndex !== -1) {
                    const searchStartLine = foundIndex + 1;
                    const searchEndLine = searchStartLine + searchLines - 1;
                    const replaceStartLine = searchEndLine + 1;
                    const replaceEndLine = replaceStartLine + replaceLines - 1;
                    
                    if (firstPatchLine === null) {
                        firstPatchLine = searchStartLine;
                    }
                    
                    // 装饰SEARCH内容（红色背景，整行）
                    for (let line = searchStartLine; line <= searchEndLine; line++) {
                        decorations.push({
                            range: new monaco.Range(line, 1, line, 1000),
                            options: {
                                className: 'sr-block-search',
                                isWholeLine: true
                            }
                        });
                    }
                    
                    // 装饰REPLACE内容（绿色背景，整行）
                    for (let line = replaceStartLine; line <= replaceEndLine; line++) {
                        decorations.push({
                            range: new monaco.Range(line, 1, line, 1000),
                            options: {
                                className: 'sr-block-replace',
                                isWholeLine: true
                            }
                        });
                    }
                }
            }
        }

        // 更新文件内容（这只是预览，不修改原文件）
        tab.model.setValue(content);
        
        // 标记tab为已插入SR块预览
        tab.hasSRPreview = true;
        tab.isPendingChange = true; // 标记为pending change状态
        
        // 更新tab显示（显示pending change指示器）
        editor._renderTabs();

        // 等待内容更新
        await new Promise(resolve => requestAnimationFrame(resolve));

        // 应用装饰
        if (decorations.length > 0) {
            try {
                const decorationIds = editor.editorInstance.deltaDecorations([], decorations);
                
                // 存储装饰ID
                if (!tab.srBlockDecorations) {
                    tab.srBlockDecorations = [];
                }
                tab.srBlockDecorations = decorationIds;
            } catch (err) {
                console.error('Failed to apply decorations:', err);
                if (window.notify) {
                    window.notify.alert(`Failed to show patch preview: ${err.message}`, { type: 'error' });
                }
            }
        }

        // 导航到第一个补丁位置
        if (firstPatchLine !== null) {
            try {
                editor.editorInstance.revealLineInCenter(firstPatchLine);
                editor.editorInstance.setPosition({ lineNumber: firstPatchLine, column: 1 });
            } catch (err) {
                console.error('Failed to navigate to patch:', err);
            }
        }
    }

    /**
     * 重新加载已应用补丁的文件
     * @private
     * @param {Array<string>} filePaths - 文件路径数组
     */
    async _reloadPatchedFiles(filePaths) {
        const { file, editor } = this.context;
        if (!file || !editor) return;

        for (const filePath of filePaths) {
            try {
                // 读取文件内容（这会更新缓存）
                const newContent = await file.readFile(filePath);
                
                // 如果文件在编辑器中打开，更新模型内容
                const existingTab = editor.tabs.find(t => t.id === filePath);
                if (existingTab) {
                    // 保存当前视图状态（如果这是当前活动的标签页）
                    let viewState = null;
                    if (editor.currentTabId === filePath && editor.editorInstance) {
                        viewState = editor.editorInstance.saveViewState();
                    }
                    
                    // 更新模型内容为实际文件内容（补丁已应用）
                    existingTab.model.setValue(newContent);
                    
                    // 清除SR预览状态，tab变为正常文件tab
                    existingTab.hasSRPreview = false;
                    existingTab.isPendingChange = false;
                    existingTab.originalContent = undefined;
                    
                    // 清除SR块装饰
                    if (existingTab.srBlockDecorations && existingTab.srBlockDecorations.length > 0) {
                        editor.editorInstance.deltaDecorations(existingTab.srBlockDecorations, []);
                        existingTab.srBlockDecorations = [];
                    }
                    
                    // 恢复视图状态（滚动位置等）
                    if (viewState && editor.currentTabId === filePath && editor.editorInstance) {
                        editor.editorInstance.restoreViewState(viewState);
                    }
                    
                    // 清除dirty状态（因为文件已保存）
                    existingTab.isDirty = false;
                    editor._renderTabs();
                }
            } catch (err) {
                // 如果重新加载失败，不影响其他文件
                console.warn(`Failed to reload file ${filePath}:`, err);
            }
        }
    }

    /**
     * 应用单个search-replace操作
     * @private
     * @param {string} content - 原始内容
     * @param {string} search - 要搜索的文本
     * @param {string} replace - 替换的文本
     * @returns {string} 修改后的内容
     */
    _applySearchReplace(content, search, replace) {
        // 如果search为空，在文件末尾添加replace
        if (!search || search.trim() === '') {
            return content + (content.endsWith('\n') ? '' : '\n') + replace;
        }

        // 查找search文本的位置
        const index = content.indexOf(search);
        if (index === -1) {
            // 如果找不到精确匹配，尝试查找（忽略末尾空白）
            const searchTrimmed = search.trimEnd();
            const indexTrimmed = content.indexOf(searchTrimmed);
            if (indexTrimmed !== -1) {
                // 找到匹配，但需要检查后面是否有换行符
                const afterMatch = content.substring(indexTrimmed + searchTrimmed.length);
                if (afterMatch.startsWith('\n') || afterMatch === '') {
                    // 替换（保留search末尾的空白）
                    const beforeMatch = content.substring(0, indexTrimmed);
                    const afterMatchFull = content.substring(indexTrimmed + searchTrimmed.length);
                    return beforeMatch + replace + afterMatchFull;
                }
            }
            // 如果还是找不到，抛出错误
            throw new Error(`Search text not found: "${search.substring(0, 50)}${search.length > 50 ? '...' : ''}"`);
        }

        // 执行替换
        return content.substring(0, index) + replace + content.substring(index + search.length);
    }

    /**
     * 恢复patch消息的状态（文件状态和禁用状态）
     * @private
     * @param {HTMLElement} msgDiv - 消息元素
     */
    async _restorePatchState(msgDiv) {
        const { store } = this.context;
        const messageId = msgDiv.dataset.messageId;
        if (!messageId || !store) return;

        try {
            // 获取chatData
            const chatData = await store.getChatData(messageId);
            if (!chatData || chatData.type !== 'patch' || !chatData.state) return;

            const state = chatData.state;

            // 恢复文件状态
            if (state.fileStatuses && Array.isArray(state.fileStatuses)) {
                state.fileStatuses.forEach(({ path, status }) => {
                    const fileItem = msgDiv.querySelector(`.file-list-item-patch[data-file-path="${path}"]`);
                    if (fileItem && status) {
                        fileItem.classList.add('file-list-item-processed');
                        fileItem.dataset.fileStatus = status;
                        const actionButtons = fileItem.querySelector('.file-list-item-actions');
                        if (actionButtons) {
                            actionButtons.classList.add('file-list-item-actions-processed');
                        }
                    }
                });

                // 更新按钮文本
                const fileListContainer = msgDiv.querySelector('.file-list');
                if (fileListContainer && fileListContainer._updateButtonTexts) {
                    fileListContainer._updateButtonTexts();
                }
            }

            // 恢复消息禁用状态
            if (state.disabled) {
                msgDiv.classList.add('disabled');
                // 禁用所有按钮
                const buttonSelectors = [
                    '.file-list-apply-patches-btn',
                    '.file-list-accept-all-btn',
                    '.file-list-reject-all-btn'
                ];
                const buttons = buttonSelectors
                    .map(selector => msgDiv.querySelector(selector))
                    .filter(btn => btn !== null);
                
                const { chatUI } = this.context;
                if (chatUI && chatUI._disableButtons) {
                    chatUI._disableButtons(buttons);
                }
            }
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to restore patch state: ${err.message}`, { type: 'warning', duration: 3000 });
            }
        }
    }
}
