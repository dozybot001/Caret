/**
 * @fileoverview 应用控制器
 * @description 核心协调者，负责初始化所有组件并协调它们之间的交互
 * 
 * ## 职责
 * - 初始化所有 UI 组件（ChatUI, FileTreeUI, Settings）
 * - 初始化所有管理器和服务
 * - 协调各个模块之间的交互
 * - 绑定全局事件和回调
 * 
 * ## 数据流
 * 用户输入 → AppController → 各模块协调 → 业务逻辑执行
 * 
 * @module AppController
 */

import { ChatUI } from '../chat/chat-ui.js';
import { FileTreeUI } from '../file-tree/file-tree-ui.js';
import { Settings } from '../sidebar/settings.js';
import { PlanHandler } from '../chat/plan.js';
import { FileHandlers } from '../file-tree/file-handlers.js';
import { PatchHandler } from '../chat/patch.js';

/**
 * 应用控制器
 * @class AppController
 */
export class AppController {
    /**
     * 构造函数
     * @param {Object} fileManager - 文件管理器实例
     * @param {Object} editorManager - 编辑器管理器实例
     * @param {Object} store - 状态存储实例
     */
    constructor(fileManager, editorManager, store) {
        this.file = fileManager;
        this.editor = editorManager;
        this.store = store;
        
        // 初始化 UI 组件（需要在 store 赋值之后）
        this._initUI();

        // 初始化 handlers
        this.planHandler = null;
        this.fileHandlers = null;
    }

    /**
     * 初始化 UI 组件
     * @private
     */
    _initUI() {
        // DOM 元素引用
        const fileTreeContainer = document.getElementById('file-tree');
        const fileTreePanel = document.getElementById('file-tree-panel');
        const chatPanel = document.getElementById('chat-panel');
        const chatMessagesContainer = document.getElementById('chat-messages');
        const chatInput = document.getElementById('chat-input');
        const settingsMenu = document.getElementById('settings-menu');
        this.btnSend = document.getElementById('btn-send-chat');

        // 初始化各个 UI 模块
        this.chatUI = new ChatUI(chatPanel, chatMessagesContainer, chatInput);
        this.fileTreeUI = new FileTreeUI(fileTreeContainer, fileTreePanel);
        this.settingsUI = new Settings(settingsMenu);

        // 初始化 UI 事件监听器
        this._initUIListeners();
    }

    /**
     * 初始化 UI 事件监听器
     * @private
     */
    _initUIListeners() {
        // 文件树切换按钮
        const btnToggleTree = document.getElementById('btn-toggle-tree');
        if (btnToggleTree) {
            btnToggleTree.addEventListener('click', () => {
                this.fileTreeUI.fileTreePanel.classList.toggle('collapsed');
            });
        }

        // 聊天面板切换按钮
        const btnToggleChat = document.getElementById('btn-toggle-chat');
        if (btnToggleChat) {
            btnToggleChat.addEventListener('click', () => {
                this.chatUI.chatPanel.classList.toggle('collapsed');
            });
        }

        // 初始化设置 UI
        this.settingsUI.init();
    }

    /**
     * 绑定全局操作按钮
     * @private
     */
    _bindGlobalActions() {
        const btnOpenFolder = document.getElementById('btn-open-folder');
        if (btnOpenFolder) {
            btnOpenFolder.addEventListener('click', () => this.fileHandlers.handleOpenFolder());
        }

        const btnShowMap = document.getElementById('btn-show-map');
        if (btnShowMap) {
            btnShowMap.addEventListener('click', () => this.fileHandlers.handleShowMap());
        }

        const btnClearChat = document.getElementById('btn-clear-chat');
        if (btnClearChat) {
            btnClearChat.addEventListener('click', async () => {
                await this.chatUI.clearMessages();
                // 清除聊天历史
                if (this.store) {
                    await this.store.clearChatHistory();
                }
            });
        }

        const chatInput = this.chatUI.chatInput;

        if (this.btnSend) {
            this.btnSend.addEventListener('click', () => {
                const isCancel = this.btnSend.dataset.isCancel === 'true';
                if (isCancel) {
                    // Cancel模式：取消所有正在进行的操作
                    this._cancelAllOperations().catch(err => {
                        if (window.notify) {
                            window.notify.alert(`Error canceling operations: ${err.message}`, { type: 'error' });
                        }
                    });
                } else {
                    // Send模式：检查输入是否为空
                    const inputValue = chatInput?.value?.trim();
                    if (!inputValue) {
                        if (window.notify) {
                            window.notify.alert('Please enter a message', { type: 'warning' });
                        }
                        return;
                    }
                    this.planHandler.handleChatSubmit();
                    this._setSendButtonState(true);
                }
            });
        }
        if (chatInput) {
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const isCancel = this.btnSend?.dataset.isCancel === 'true';
                    // Cancel状态下，Enter键不触发
                    if (!isCancel) {
                        // 检查输入是否为空
                        const inputValue = chatInput?.value?.trim();
                        if (!inputValue) {
                            if (window.notify) {
                                window.notify.alert('Please enter a message', { type: 'warning' });
                            }
                            return;
                        }
                        this.planHandler.handleChatSubmit();
                        this._setSendButtonState(true);
                    }
                }
            });
        }
    }


    /**
     * 初始化应用
     * @returns {Promise<void>}
     */
    async init() {
        const initialConfig = this.store.getConfig();

        this.settingsUI.updateSettingsView(initialConfig);
        
        // 初始化 handlers
        this._initHandlers();
        
        // 初始化编辑器字号设置
        if (initialConfig.fontSize !== undefined) {
            this.editor.setFontSize(initialConfig.fontSize);
        }
        
        // 监听字号变化并保存到store
        this.editor.onFontSizeChange = async (fontSize) => {
            await this.store.updateConfig({ fontSize });
        };

        // 绑定配置更新事件
        this.store.addEventListener('config-updated', (e) => {
            const { fontSize } = e.detail;

            this.settingsUI.updateSettingsView(e.detail);
            
            // 更新编辑器字号（如果从外部更改，避免循环更新）
            if (fontSize !== undefined && fontSize !== this.editor.fontSize) {
                this.editor.onFontSizeChange = null; // 临时禁用回调
                this.editor.setFontSize(fontSize);
                this.editor.onFontSizeChange = async (size) => {
                    await this.store.updateConfig({ fontSize: size });
                };
            }
        });

        // 绑定设置 UI 回调
        this.settingsUI.onConfigSave = async (apiKey, baseUrl, model) => {
            await this.store.updateConfig({ apiKey, baseUrl, model });
        };

        // 绑定文件树 UI 回调
        this.fileTreeUI.onFileClick = (handle, path, isPreview) => {
            this.editor.openFile(handle, path, isPreview);
        };
        
        // 绑定ChatUI文件点击回调
        this.chatUI.onFileClick = async (filePath) => {
            try {
                const fileHandle = await this.file.getFileHandleByPath(filePath);
                if (fileHandle) {
                    await this.editor.openFile(fileHandle, filePath, false);
                }
            } catch (err) {
                if (window.notify) {
                    window.notify.alert(`Failed to open file: ${filePath}`, { type: 'error' });
                }
            }
        };

        // 绑定全局操作按钮（handlers 已在 _initHandlers 中创建）
        this._bindGlobalActions();

        // 设置编辑器的store和fileManager引用（用于标签页状态持久化）
        this.editor.store = this.store;
        this.editor.fileManager = this.file;
        
        // 尝试恢复之前打开的文件夹
        await this._restoreFolder();
        
        // 恢复标签页状态（在恢复文件夹之后）
        await this.editor.restoreTabsState();

        // 恢复聊天历史（在恢复文件夹之后，因为需要文件管理器）
        await this._restoreChatHistory();

        this.editor.onSaveRequest = async (fileHandle, content) => {
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
        };
    }

    /**
     * 初始化 handlers
     * @private
     */
    _initHandlers() {
        // 创建共享的上下文对象
        const context = {
            file: this.file,
            editor: this.editor,
            store: this.store,
            chatUI: this.chatUI,
            fileTreeUI: this.fileTreeUI
        };

        // 先创建 fileHandlers（因为它不依赖其他handlers）
        this.fileHandlers = new FileHandlers(context);

        // 创建 planHandler
        this.planHandler = new PlanHandler(context);
        
        // 创建 patchHandler 并设置到 chatUI
        this.patchHandler = new PatchHandler(context);
        this.chatUI.patchHandler = this.patchHandler;
        this.chatUI.planHandler = this.planHandler;
        
        // 设置请求完成回调
        this._setupRequestCompletionListener();
    }

    /**
     * 取消所有正在进行的操作（Chat请求、Generate Patch等）
     * @private
     */
    async _cancelAllOperations() {
        // 取消Chat请求
        if (this.planHandler) {
            await this.planHandler.cancelCurrentRequest();
        }
        // 取消Generate Patch
        if (this.chatUI) {
            this.chatUI.cancelGeneratePatch();
        }
        if (this.patchHandler) {
            this.patchHandler.cancelCurrentRequest();
        }
        // 重置Send按钮
        this._setSendButtonState(false);
    }

    /**
     * 设置发送按钮状态（Send或Cancel）
     * @private
     * @param {boolean} isCancel - true为Cancel状态，false为Send状态
     */
    _setSendButtonState(isCancel) {
        if (!this.btnSend) return;
        this.btnSend.dataset.isCancel = isCancel ? 'true' : 'false';
        this.btnSend.innerHTML = isCancel 
            ? '<i class="codicon codicon-close"></i>'
            : '<i class="codicon codicon-arrow-up"></i>';
    }

    /**
     * 设置请求完成监听器
     * @private
     */
    _setupRequestCompletionListener() {
        // 设置回调，在请求完成时重置按钮
        if (this.planHandler) {
            this.planHandler.onRequestComplete = () => {
                this._setSendButtonState(false);
            };
            this.planHandler.onRequestCancel = () => {
                this._setSendButtonState(false);
            };
        }
        
        // 设置ChatUI的Generate Patch回调
        if (this.chatUI) {
            this.chatUI.onGeneratePatchStart = () => {
                this._setSendButtonState(true);
            };
            this.chatUI.onGeneratePatchCancel = () => {
                this._setSendButtonState(false);
            };
        }
    }

    /**
     * 恢复之前打开的文件夹
     * @private
     */
    async _restoreFolder() {
        try {
            const rootHandle = this.file.getRootHandle();
            if (!rootHandle) return;

            // 渲染文件树（不清除存储的标签页状态，因为后面要恢复）
            await this.editor.reset(false);
            const treeData = await this.file.buildFileTree(rootHandle);
            this.fileTreeUI.renderFileTree(rootHandle.name, treeData);
            this.fileTreeUI.setFileTreeVisible(true);
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to restore folder: ${err.message}`, { type: 'warning' });
            }
            // 如果恢复失败，清除存储的句柄和内存中的句柄
            if (this.file) {
                this.file.rootDirHandle = null;
            }
            if (this.store) {
                await this.store.clearDirectoryHandle();
            }
        }
    }

    /**
     * 恢复聊天历史
     * @private
     */
    async _restoreChatHistory() {
        if (!this.chatUI || !this.store) return;
        
        try {
            const messages = await this.store.getAllChatHistory();
            if (!messages || messages.length === 0) return;

            // 获取所有文件列表（用于plan消息的文件匹配）
            let filePathMap = new Map();
            if (this.file && this.file.hasRoot()) {
                const allFiles = await this.file.getAllFiles();
                allFiles.forEach(file => {
                    filePathMap.set(file.path, file);
                });
            }

            // 按顺序恢复消息
            for (const msg of messages) {
                if (msg.role === 'user') {
                    // 恢复用户消息
                    await this.chatUI.addMessage('user', msg.text, msg.messageId);
                } else if (msg.role === 'ai') {
                    // 恢复AI消息（thinking）
                    const msgDiv = this.chatUI.createStreamingThinkingMessage(msg.messageId);
                    const thinkingDiv = msgDiv.querySelector('.file-list-thinking');
                    if (thinkingDiv) {
                        thinkingDiv.textContent = msg.text;
                    }

                    // 根据类型重新渲染
                    if (msg.type === 'plan' && this.planHandler) {
                        // 恢复plan类型的消息
                        // 检查是否已有文件列表UI，如果有则先清除
                        const contentDiv = msgDiv.querySelector('.message-content');
                        if (contentDiv) {
                            const existingFileList = contentDiv.querySelector('.file-list-title');
                            if (existingFileList) {
                                // 清除已有的文件列表UI（保留thinking）
                                existingFileList.nextElementSibling?.remove(); // file-list
                                existingFileList.nextElementSibling?.remove(); // button-container
                                existingFileList.remove();
                            }
                        }
                        await this.planHandler._processPlanDataFromDB(msgDiv, this.store, filePathMap);
                    } else if (msg.type === 'patch' && this.patchHandler) {
                        // 恢复patch类型的消息
                        // _loadPatchFileListFromDB 内部会检查是否已存在文件列表，所以不需要手动清除
                        await this.patchHandler._loadPatchFileListFromDB(msgDiv, this.store);
                    }
                }
            }

            // 滚动到底部
            if (this.chatUI.chatMessagesContainer) {
                this.chatUI.chatMessagesContainer.scrollTop = this.chatUI.chatMessagesContainer.scrollHeight;
            }
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to restore chat history: ${err.message}`, { type: 'warning' });
            }
        }
    }


}
