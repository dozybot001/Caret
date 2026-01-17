/**
 * @fileoverview 计划生成处理器（第一阶段）
 * @description 处理第一阶段：生成相关文件列表的逻辑
 */

import { AIMessageManager } from './ai-message-manager.js';

/**
 * 计划生成处理器
 * @class PlanHandler
 */
export class PlanHandler {
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
        this.currentStreamingMsg = null; // 当前流式消息
        this.onRequestComplete = null;
        this.onRequestCancel = null;
        // 创建AI消息管理器
        this.amm = new AIMessageManager({
            store: context.store,
            chatUI: context.chatUI
        });
    }

    /**
     * 处理聊天提交（第一阶段：生成相关文件列表）
     * @returns {Promise<void>}
     */
    async handleChatSubmit() {
        const { chatUI, file, store } = this.context;
        
        let modificationRequest = chatUI.getChatInput();
        if (!modificationRequest) {
            // 输入为空的情况已在app-controller中处理，这里直接返回
            return;
        }

        // 添加用户消息到 UI
        const userMessageId = `msg-${Date.now()}-${Math.random()}`;
        await chatUI.addMessage('user', modificationRequest, userMessageId);

        // 保存用户消息到聊天历史
        await store.saveChatHistoryMessage({
            messageId: userMessageId,
            role: 'user',
            text: modificationRequest
        });

        // 检查是否有打开的项目
        if (!file.hasRoot()) {
            await chatUI.addMessage('ai', 'Please open a folder first.');
            return;
        }

        // API配置检查由amm处理

        // 创建AbortController用于取消请求
        this.currentAbortController = new AbortController();
        const signal = this.currentAbortController.signal;
        
        try {
            // 开始计时器
            chatUI.startTimer();
            
            // 生成repo-map
            const repoMap = await file.getRepoMap();
            
            // 检查是否已取消（在流式输出之前取消）
            if (signal.aborted) {
                this._resetRequestState();
                return;
            }
            
            // 获取所有文件列表（用于后续匹配文件handle）
            const allFiles = await file.getAllFiles();
            const filePathMap = new Map();
            allFiles.forEach(file => {
                filePathMap.set(file.path, file);
            });
            
            // 流式消息相关变量
            let streamingMsg = null;
            
            // 使用amm发送Plan消息，amm会处理prompt构建、流式输出thinking和数据存储
            const messageId = await this.amm.sendPlanMessage({
                modificationRequest: modificationRequest,
                repoMap: repoMap,
                signal: signal,
                onThinkingUpdate: (thinking) => {
                    // 第一次更新thinking内容时，创建流式消息
                    if (!streamingMsg) {
                        streamingMsg = chatUI.createStreamingThinkingMessage();
                        this.currentStreamingMsg = streamingMsg;
                    }
                    
                    // 更新thinking内容
                    if (streamingMsg) {
                        chatUI.updateStreamingThinking(streamingMsg, thinking);
                    }
                }
            });
            
            // amm处理完成后，从db读取数据并渲染
            if (streamingMsg) {
                streamingMsg.dataset.messageId = messageId;
                await this._processPlanDataFromDB(streamingMsg, store, filePathMap);
            } else {
                // 如果没有流式消息，检查是否有数据
                const chatData = await store.getChatData(messageId);
                if (!chatData || chatData.type !== 'plan' || !Array.isArray(chatData.data) || chatData.data.length === 0) {
                    await chatUI.addMessage('ai', 'No relevant files found based on the analysis.');
                }
            }
            
            // 检查是否已取消
            if (signal.aborted) {
                this._resetRequestState();
                return;
            }
        } catch (error) {
            // 如果是取消错误，不显示错误提示
            if (error.name !== 'AbortError' && !this.currentAbortController?.signal.aborted) {
                if (window.notify) {
                    window.notify.alert(`Error processing modification request: ${error.message}`, { type: 'error' });
                }
                await chatUI.addMessage('ai', 'Error: ' + error.message);
            }
        } finally {
            // 确保停止计时器和重置状态
            chatUI.stopTimer();
            this._resetRequestState();
            // 通知请求完成，重置按钮状态
            if (this.onRequestComplete) {
                this.onRequestComplete();
            }
        }
    }

    /**
     * 重置请求状态（私有方法）
     * @private
     */
    _resetRequestState() {
        this.currentAbortController = null;
        this.currentStreamingMsg = null;
    }


    /**
     * 取消当前请求
     */
    async cancelCurrentRequest() {
        if (this.currentAbortController) {
            await this.amm.cancelRequest({
                abortController: this.currentAbortController,
                onButtonReset: () => {
                    // 重置按钮状态
                    if (this.onRequestCancel) {
                        this.onRequestCancel();
                    }
                },
                onCancel: async () => {
                    // 重置请求状态
                    this._resetRequestState();
                }
            });
        }
    }

    /**
     * 从数据库读取plan数据，匹配文件handle，保存完整数据并渲染（私有方法）
     * @private
     * @param {HTMLElement} msgDiv - 消息元素
     * @param {Object} store - 状态存储实例
     * @param {Map<string, Object>} filePathMap - 文件路径到文件信息的映射
     * @returns {Promise<void>}
     */
    async _processPlanDataFromDB(msgDiv, store, filePathMap) {
        const { chatUI } = this.context;
        const messageId = msgDiv.dataset.messageId;
        if (!messageId || !store) return;

        const chatData = await store.getChatData(messageId);
        if (!chatData || chatData.type !== 'plan' || !Array.isArray(chatData.data)) {
            return;
        }

        // 匹配文件handle（统一处理逻辑）
        const matchFileInfo = (path) => {
            const normalizedPath = path.trim().replace(/\\/g, '/');
            const fileInfo = filePathMap.get(normalizedPath);
            if (fileInfo) {
                return {
                    path: fileInfo.path,
                    name: fileInfo.name,
                    handle: fileInfo.handle
                };
            }
            // 尝试不区分大小写匹配
            for (const [filePath, info] of filePathMap.entries()) {
                if (filePath.toLowerCase() === normalizedPath.toLowerCase()) {
                    return {
                        path: info.path,
                        name: info.name,
                        handle: info.handle
                    };
                }
            }
            return null;
        };
        
        // 提取文件路径并匹配handle
        const filePaths = chatData.data.map(item => item.path || item).filter(path => path);
        const fileList = filePaths.map(matchFileInfo).filter(item => item !== null);

        if (fileList.length === 0) return;

        // 保存完整的文件列表（包含handle）到db，保留已有的状态数据
        const existingChatData = await store.getChatData(messageId);
        await store.saveChatData(messageId, {
            type: 'plan',
            data: fileList,
            state: existingChatData?.state || null
        });

        const contentDiv = msgDiv.querySelector('.message-content');
        if (!contentDiv) return;

        // 获取thinking文本
        const thinkingDiv = msgDiv.querySelector('.file-list-thinking');
        const thinking = thinkingDiv ? thinkingDiv.textContent : null;

        // 使用共享方法创建文件列表UI
        chatUI._appendFileListUI(contentDiv, msgDiv, fileList, thinking);

        // 恢复状态（如果存在）
        await this._restorePlanState(msgDiv, store);

        // 滚动到底部
        chatUI.scrollToBottom();
    }

    /**
     * 保存plan消息的状态（禁用状态）
     * @private
     * @param {HTMLElement} msgDiv - 消息元素
     * @param {Object} store - 状态存储实例
     */
    async _savePlanState(msgDiv, store) {
        const messageId = msgDiv.dataset.messageId;
        if (!messageId || !store) return;

        try {
            // 获取当前的chatData
            const chatData = await store.getChatData(messageId);
            if (!chatData || chatData.type !== 'plan') return;

            // 更新chatData的状态
            chatData.state = chatData.state || {};
            chatData.state.disabled = msgDiv.classList.contains('disabled');

            // 保存到数据库
            await store.saveChatData(messageId, chatData);
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to save plan state: ${err.message}`, { type: 'warning', duration: 3000 });
            }
        }
    }

    /**
     * 恢复plan消息的状态（禁用状态）
     * @private
     * @param {HTMLElement} msgDiv - 消息元素
     * @param {Object} store - 状态存储实例
     */
    async _restorePlanState(msgDiv, store) {
        const messageId = msgDiv.dataset.messageId;
        if (!messageId || !store) return;

        try {
            // 获取chatData
            const chatData = await store.getChatData(messageId);
            if (!chatData || chatData.type !== 'plan' || !chatData.state) return;

            const state = chatData.state;

            // 恢复消息禁用状态
            if (state.disabled) {
                msgDiv.classList.add('disabled');
                // _appendFileListUI是同步的，按钮应该已经创建
                const generateButton = msgDiv.querySelector('.file-list-generate-btn');
                if (generateButton) {
                    const { chatUI } = this.context;
                    if (chatUI && chatUI._disableButtons) {
                        chatUI._disableButtons(generateButton);
                    }
                }
            }
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to restore plan state: ${err.message}`, { type: 'warning', duration: 3000 });
            }
        }
    }

}
