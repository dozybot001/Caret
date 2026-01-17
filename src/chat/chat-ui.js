/**
 * @fileoverview 聊天 UI 模块
 * @description 负责聊天面板的消息显示和输入处理
 */

import { TimerManager } from './utils/timer.js';
import { SRBlocksUI } from './sr-blocks-ui.js';

/**
 * 聊天 UI 管理器
 * @class ChatUI
 */
export class ChatUI {
    /**
     * @param {HTMLElement} chatPanel - 聊天面板容器
     * @param {HTMLElement} chatMessagesContainer - 消息容器
     * @param {HTMLElement} chatInput - 聊天输入框
     */
    constructor(chatPanel, chatMessagesContainer, chatInput) {
        this.chatPanel = chatPanel;
        this.chatMessagesContainer = chatMessagesContainer;
        this.chatInput = chatInput;
        this.onGeneratePatchStart = null; // 开始Generate Patch时的回调（用于切换Send按钮为Cancel）
        this.onGeneratePatchCancel = null; // 取消Generate Patch时的回调（用于切换Cancel按钮为Send）
        this.currentPatchCancelHandler = null; // 当前patch取消处理器
        this.currentPatchMessage = null; // 当前patch文件列表消息元素
        this.onFileClick = null; // 文件点击回调 (filePath) => void
        this.patchHandler = null; // Patch生成处理器
        this.planHandler = null; // Plan生成处理器
        
        // 计时器管理器
        const timerElement = document.getElementById('chat-timer');
        this.timerManager = new TimerManager(timerElement);
    }

    /**
     * 获取并清空聊天输入
     * @returns {string} 输入内容
     */
    getChatInput() {
        const val = this.chatInput.value.trim();
        if (val) {
            this.chatInput.value = '';
        }
        return val;
    }

    /**
     * 开始计时器
     */
    startTimer() {
        this.timerManager.startTimer();
    }

    /**
     * 停止计时器
     */
    stopTimer() {
        this.timerManager.stopTimer();
    }

    /**
     * 重置计时器
     */
    resetTimer() {
        this.timerManager.resetTimer();
    }

    /**
     * 添加消息到聊天面板
     * @param {string} role - 消息角色：'user' 或 'ai'
     * @param {string} text - 消息文本
     * @param {string|null} messageId - 消息ID（可选）
     * @returns {HTMLElement} 消息元素
     */
    async addMessage(role, text, messageId = null) {
        const finalMessageId = messageId || `msg-${Date.now()}-${Math.random()}`;
        
        const msgDiv = this._createMessageElement(role, text, finalMessageId);
        this.chatMessagesContainer.appendChild(msgDiv);
        this.scrollToBottom();
        
        return msgDiv;
    }

    /**
     * 创建消息 DOM 元素（内部方法）
     * @private
     * @param {string} role - 消息角色
     * @param {string} text - 消息文本
     * @param {string} messageId - 消息ID
     * @returns {HTMLElement} 消息元素
     */
    _createMessageElement(role, text, messageId) {
        if (this.chatPanel.classList.contains('collapsed')) {
            this.chatPanel.classList.remove('collapsed');
        }

        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}`;
        msgDiv.dataset.messageId = messageId;
        msgDiv.dataset.originalText = text;
        
        
        // 长消息自动折叠
        const shouldCollapse = text.length > 500;
        if (shouldCollapse) {
            msgDiv.classList.add('collapsible-message');
            msgDiv.dataset.collapsed = 'true';
        }
        
        // 创建消息内容容器
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = text;
        
        msgDiv.appendChild(contentDiv);
        
        // 添加复制按钮
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'btn btn-close message-copy-btn';
        copyBtn.setAttribute('aria-label', 'Copy message');
        copyBtn.innerHTML = '<i class="codicon codicon-copy"></i>';
        copyBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                // 从DOM元素获取当前文本内容，而不是使用闭包的text变量
                const currentText = contentDiv.textContent;
                await navigator.clipboard.writeText(currentText);
                if (window.notify) {
                    window.notify.alert('Copied to clipboard', { type: 'success' });
                }
            } catch (err) {
                if (window.notify) {
                    window.notify.alert(`Failed to copy text: ${err.message}`, { type: 'error' });
                }
            }
        });
        msgDiv.appendChild(copyBtn);
        
        // 添加折叠/展开按钮（如果是长消息）
        if (shouldCollapse) {
            contentDiv.classList.add('collapsed');
            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'btn btn-text message-toggle-btn';
            toggleBtn.textContent = 'Expand';
            toggleBtn.addEventListener('click', () => {
                const isCollapsed = contentDiv.classList.contains('collapsed');
                if (isCollapsed) {
                    contentDiv.classList.remove('collapsed');
                    toggleBtn.textContent = 'Collapse';
                    msgDiv.dataset.collapsed = 'false';
                } else {
                    contentDiv.classList.add('collapsed');
                    toggleBtn.textContent = 'Expand';
                    msgDiv.dataset.collapsed = 'true';
                }
            });
            msgDiv.appendChild(toggleBtn);
        }
        
        return msgDiv;
    }

    /**
     * 运行异步任务
     * @param {string} startMsg - 开始消息
     * @param {Function} taskFn - 任务函数，可接收 updateStatus 回调函数
     * @param {string|null} successMsg - 成功消息
     * @returns {Promise<any>} 任务结果
     */
    async runTask(startMsg, taskFn, successMsg = null) {
        try {
            // 创建 updateStatus 函数，用于在任务中更新状态
            let currentStatus = startMsg;
            const updateStatus = (text) => {
                currentStatus = text;
            };

            // 执行任务函数
            const result = await taskFn(updateStatus);

            // 如果提供了成功消息，显示成功通知
            if (successMsg) {
                if (window.notify) {
                    await window.notify.alert(successMsg, { type: 'success' });
                }
            }

            return result;
        } catch (error) {
            // 显示错误通知
            const errorMessage = error.message || 'Task failed';
            if (window.notify) {
                await window.notify.alert(errorMessage, { type: 'error', duration: 5000 });
            }
            throw error;
        }
    }

    /**
     * 清空所有消息
     */
    async clearMessages() {
        // 清空UI显示
        this.chatMessagesContainer.innerHTML = '';
        
        if (window.notify) {
            window.notify.alert('Messages cleared', { type: 'success' });
        }
    }


    /**
     * 创建流式thinking消息（仅thinking部分，文件列表或search replace块稍后添加）
     * @param {string|null} messageId - 消息ID（可选）
     * @returns {HTMLElement} 消息元素
     */
    createStreamingThinkingMessage(messageId = null) {
        const finalMessageId = messageId || `msg-${Date.now()}-${Math.random()}`;
        
        if (this.chatPanel.classList.contains('collapsed')) {
            this.chatPanel.classList.remove('collapsed');
        }

        const msgDiv = document.createElement('div');
        msgDiv.className = 'message ai';
        msgDiv.dataset.messageId = finalMessageId;

        // 创建消息内容容器
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        // 创建thinking容器（初始为空）
        const thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'file-list-thinking';
        thinkingDiv.textContent = '';
        contentDiv.appendChild(thinkingDiv);

        msgDiv.appendChild(contentDiv);

        // 添加到容器并滚动到底部
        this.chatMessagesContainer.appendChild(msgDiv);
        this.scrollToBottom();

        return msgDiv;
    }

    /**
     * 更新流式消息的thinking内容
     * @param {HTMLElement} msgDiv - 消息元素
     * @param {string} thinkingText - thinking文本
     */
    updateStreamingThinking(msgDiv, thinkingText) {
        const thinkingDiv = msgDiv.querySelector('.file-list-thinking');
        if (thinkingDiv) {
            thinkingDiv.textContent = thinkingText;
            this.scrollToBottom();
        }
    }

    /**
     * 更新流式消息的searchReplaceBlocks内容
     * @param {HTMLElement} msgDiv - 消息元素
     * @param {string} srBlocksText - searchReplaceBlocks文本
     */
    updateStreamingSRBlocks(msgDiv, srBlocksText) {
        SRBlocksUI.updateStreamingSRBlocks(msgDiv, srBlocksText, () => this.scrollToBottom());
    }

    /**
     * 滚动到底部（统一方法）
     * @private
     */
    scrollToBottom() {
        this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
    }

    /**
     * 向内容容器追加文件列表UI（共享方法）
     * @private
     * @param {HTMLElement} contentDiv - 消息内容容器
     * @param {HTMLElement} msgDiv - 消息元素
     * @param {Array<{path: string, name: string}>} files - 文件列表
     * @param {string|null} thinking - thinking文本（可选）
     */
    _appendFileListUI(contentDiv, msgDiv, files, thinking = null) {
        // 添加标题
        const titleDiv = document.createElement('div');
        titleDiv.className = 'file-list-title';
        titleDiv.textContent = 'Relevant Files:';
        contentDiv.appendChild(titleDiv);

        // 创建文件列表容器
        const fileListContainer = document.createElement('div');
        fileListContainer.className = 'file-list';

        // 存储选中的文件路径
        const selectedFiles = new Set();

        files.forEach((fileInfo) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-list-item';
            fileItem.dataset.filePath = fileInfo.path;

            const fileName = document.createElement('span');
            fileName.className = 'file-list-item-name';
            fileName.textContent = fileInfo.path;

            fileItem.appendChild(fileName);

            // 点击事件：切换选中状态
            fileItem.addEventListener('click', () => {
                if (msgDiv.classList.contains('disabled')) return;
                if (selectedFiles.has(fileInfo.path)) {
                    // 取消选中
                    selectedFiles.delete(fileInfo.path);
                    fileItem.classList.remove('selected');
                } else {
                    // 选中
                    selectedFiles.add(fileInfo.path);
                    fileItem.classList.add('selected');
                }
            });

            fileListContainer.appendChild(fileItem);
        });

        contentDiv.appendChild(fileListContainer);

        // 添加Generate Patch按钮
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'file-list-button-container';
        
        const generateButton = document.createElement('button');
        generateButton.type = 'button';
        generateButton.className = 'btn btn-text btn-text-chat file-list-generate-btn';
        generateButton.textContent = 'Generate Patch';
        
        generateButton.addEventListener('click', async () => {
            if (msgDiv.classList.contains('disabled')) return;
            
            // 收集未选中的文件（即未标记为删除的文件）
            const fileListItems = fileListContainer.querySelectorAll('.file-list-item');
            const unselectedFiles = [];
            fileListItems.forEach((item) => {
                if (!item.classList.contains('selected')) {
                    const filePath = item.dataset.filePath;
                    const fileInfo = files.find(f => f.path === filePath);
                    if (fileInfo) {
                        unselectedFiles.push(fileInfo);
                    }
                }
            });
            
            if (unselectedFiles.length === 0) {
                if (window.notify) {
                    window.notify.alert('No files to generate patch', { type: 'error' });
                }
                return;
            }
            
            // 禁用整个消息
            msgDiv.classList.add('disabled');
            this._disableButtons(generateButton);
            
            // 保存plan消息的状态
            this._savePlanStateIfNeeded(msgDiv);
            
            // 切换Send按钮为Cancel按钮
            if (this.onGeneratePatchStart) {
                this.onGeneratePatchStart();
            }
            
            // 声明变量（在try外部，以便catch中可以访问）
            let streamingThinkingMsg = null;
            let thinkingText = '';
            
            try {
                // 获取用户查询
                const userQuery = this._getLastUserQuery();
                if (!userQuery) {
                    throw new Error('No user query found');
                }
                
                // 开始计时器
                this.startTimer();
                
                // 调用patch handler生成search replace块（流式）
                let messageId = null;
                if (this.patchHandler) {
                    messageId = await this.patchHandler.handleGeneratePatch(
                        unselectedFiles, 
                        userQuery, 
                        (thinking) => {
                            // 第一次更新thinking内容时，创建流式消息
                            if (!streamingThinkingMsg && thinking && thinking.length > 0) {
                                streamingThinkingMsg = this.createStreamingThinkingMessage();
                            }
                            
                            // 更新thinking内容
                            if (streamingThinkingMsg) {
                                thinkingText = thinking;
                                this.updateStreamingThinking(streamingThinkingMsg, thinking);
                            }
                        },
                        (srBlocksText) => {
                            // 更新searchReplaceBlocks内容（流式）
                            if (streamingThinkingMsg && srBlocksText) {
                                this.updateStreamingSRBlocks(streamingThinkingMsg, srBlocksText);
                            }
                        }
                    );
                }
                
                // 流式输出完成后，在消息上添加文件列表
                // 如果没有创建流式消息，创建一个（理论上不应该发生，但作为保护措施）
                if (!streamingThinkingMsg || !streamingThinkingMsg.parentNode) {
                    streamingThinkingMsg = this.createStreamingThinkingMessage();
                }
                
                // amm已经将数据存进db，从db读取数据并生成文件列表UI
                if (messageId && streamingThinkingMsg && this.patchHandler && this.patchHandler.context && this.patchHandler.context.store) {
                    streamingThinkingMsg.dataset.messageId = messageId;
                    const store = this.patchHandler.context.store;
                    await this.patchHandler._loadPatchFileListFromDB(streamingThinkingMsg, store);
                }
                
                this.currentPatchMessage = streamingThinkingMsg;
                
                // 成功生成后，将Cancel按钮恢复为Send按钮
                if (this.onGeneratePatchCancel) {
                    this.onGeneratePatchCancel();
                }
                
                // 停止计时器
                this.stopTimer();
            } catch (error) {
                // 如果是取消错误，不显示错误提示（cancelHandler已经显示了警告提示）
                if (error.name === 'AbortError' || (this.patchHandler && this.patchHandler.currentAbortController?.signal.aborted)) {
                    // 恢复按钮状态
                    this._restorePlanButtonState(msgDiv, generateButton);
                    if (this.onGeneratePatchCancel) {
                        this.onGeneratePatchCancel();
                    }
                    // 停止计时器
                    this.stopTimer();
                    return;
                }
                
                // 其他错误才显示错误提示
                if (window.notify) {
                    window.notify.alert(`Error generating patch: ${error.message}`, { type: 'error' });
                }
                // 恢复按钮状态
                this._restorePlanButtonState(msgDiv, generateButton);
                if (this.onGeneratePatchCancel) {
                    this.onGeneratePatchCancel();
                }
                // 停止计时器
                this.stopTimer();
                return;
            }
            
            // 创建取消处理器
            const cancelHandler = async () => {
                if (this.patchHandler) {
                    // 调用patchHandler的cancelCurrentRequest（它会使用amm.cancelRequest并显示警告通知、重置按钮和执行UI清理）
                    await this.patchHandler.cancelCurrentRequest(async () => {
                        // UI清理逻辑
                        this.currentPatchMessage = null;
                        // 恢复按钮状态
                        this._restorePlanButtonState(msgDiv, generateButton);
                        // 清除当前的取消处理器
                        this.currentPatchCancelHandler = null;
                    });
                }
            };
            this.currentPatchCancelHandler = cancelHandler;
        });
        
        buttonContainer.appendChild(generateButton);
        contentDiv.appendChild(buttonContainer);

        // 添加复制按钮（复制时排除按钮文本）
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'btn btn-close message-copy-btn';
        copyBtn.setAttribute('aria-label', 'Copy message');
        copyBtn.innerHTML = '<i class="codicon codicon-copy"></i>';
        copyBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                // 构建要复制的文本：thinking + 标题 + 文件列表（只包含文件名，不包括按钮）
                let textToCopy = '';
                if (thinking) {
                    textToCopy += thinking + '\n\n';
                }
                textToCopy += 'Relevant Files:\n';
                files.forEach((fileInfo) => {
                    textToCopy += fileInfo.path + '\n';
                });
                await navigator.clipboard.writeText(textToCopy.trim());
                if (window.notify) {
                    window.notify.alert('Copied to clipboard', { type: 'success' });
                }
            } catch (err) {
                if (window.notify) {
                    window.notify.alert(`Failed to copy text: ${err.message}`, { type: 'error' });
                }
            }
        });
        msgDiv.appendChild(copyBtn);
    }



    /**
     * 取消当前的Generate Patch操作
     */
    cancelGeneratePatch() {
        if (this.currentPatchCancelHandler) {
            this.currentPatchCancelHandler();
            this.currentPatchCancelHandler = null;
        }
    }

    /**
     * 获取最后一个用户查询
     * @private
     * @returns {string|null} 用户查询文本
     */
    _getLastUserQuery() {
        // 从DOM中找到最后一个用户消息
        const userMessages = this.chatMessagesContainer.querySelectorAll('.message.user');
        if (userMessages.length > 0) {
            const lastUserMsg = userMessages[userMessages.length - 1];
            const contentDiv = lastUserMsg.querySelector('.message-content');
            if (contentDiv) {
                return contentDiv.textContent;
            }
        }
        return null;
    }

    /**
     * 保存plan消息的状态（如果消息是plan类型）
     * @private
     * @param {HTMLElement} msgDiv - 消息元素
     */
    _savePlanStateIfNeeded(msgDiv) {
        if (this.planHandler) {
            const messageId = msgDiv.dataset.messageId;
            if (messageId) {
                // 检查是否是plan消息（通过检查是否有Generate Patch按钮）
                const generateButton = msgDiv.querySelector('.file-list-generate-btn');
                if (generateButton) {
                    this.planHandler._savePlanState(msgDiv, this.planHandler.context.store);
                }
            }
        }
    }

    /**
     * 禁用按钮并清除 hover 状态（统一方法）
     * @private
     * @param {HTMLElement|HTMLElement[]} buttons - 要禁用的按钮或按钮数组
     */
    _disableButtons(buttons) {
        const buttonArray = Array.isArray(buttons) ? buttons : [buttons];
        buttonArray.forEach(button => {
            if (button) {
                button.disabled = true;
                // 添加 no-hover 类来覆盖 hover 状态
                button.classList.add('no-hover');
            }
        });
    }

    /**
     * 恢复plan消息的按钮和禁用状态
     * @private
     * @param {HTMLElement} msgDiv - 消息元素
     * @param {HTMLElement} generateButton - Generate Patch按钮
     */
    _restorePlanButtonState(msgDiv, generateButton) {
        generateButton.disabled = false;
        generateButton.classList.remove('no-hover');
        msgDiv.classList.remove('disabled');
        this._savePlanStateIfNeeded(msgDiv);
    }
}

