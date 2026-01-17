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

        const contentDiv = msgDiv.querySelector('.message-content');
        if (!contentDiv) return;

        // 显示完成提示文本
        const fileCount = parsedFiles.length;
        const progressDiv = document.createElement('div');
        progressDiv.className = 'file-generation-progress';
        progressDiv.textContent = `Generated Search-Replace Blocks for ${fileCount} file${fileCount > 1 ? 's' : ''}.`;
        contentDiv.appendChild(progressDiv);

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
            fileItem.addEventListener('click', (e) => {
                if (e.target.closest('.file-list-item-action-btn')) {
                    return;
                }
                if (chatUI.onFileClick) {
                    chatUI.onFileClick(fileInfo.path);
                }
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
        applyPatchesButton.addEventListener('click', (e) => {
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
