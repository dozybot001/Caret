/**
 * @fileoverview 应用状态管理
 * @description 管理全局应用状态（配置/上下文），负责本地存储持久化与事件驱动的数据同步
 */

import { STORAGE_CONSTANTS, DEFAULT_CONFIG } from './constants.js';

/**
 * 应用状态存储
 * @class AppStore
 * @extends EventTarget
 */
export class AppStore extends EventTarget {
    constructor() {
        super();
        
        this.state = {
            config: {
                apiKey: '',
                baseUrl: '',
                model: '',
                fontSize: DEFAULT_CONFIG.FONT_SIZE,
                tokenBudget: DEFAULT_CONFIG.TOKEN_BUDGET,
                compressionStrategy: DEFAULT_CONFIG.COMPRESSION_STRATEGY
            }
        };
        
        this._initPromise = null;
        this._db = null;
    }

    /**
     * 初始化存储（加载配置）
     * @returns {Promise<void>}
     */
    async init() {
        if (this._initPromise) return this._initPromise;
        
        this._initPromise = (async () => {
            try {
                await this._openDB();
                await this._migrateFromLocalStorage();
                await this._loadConfigFromDB();
            } catch (err) {
                if (window.notify) {
                    window.notify.alert(`Failed to initialize store: ${err.message}`, { type: 'warning', duration: 3000 });
                }
            }
        })();
        
        return this._initPromise;
    }

    /**
     * 更新配置
     * @param {Object} newConfig - 新配置对象
     * @returns {Promise<void>}
     */
    async updateConfig(newConfig) {
        this.state.config = { ...this.state.config, ...newConfig };
        await this._dbOp(STORAGE_CONSTANTS.OBJECT_STORES.CONFIG, 'put', 'appConfig', this.state.config);
        this._emit('config-updated', this.state.config);
    }

    /**
     * 获取配置
     * @returns {Object} 配置对象（深拷贝）
     */
    getConfig() {
        return { ...this.state.config };
    }

    /**
     * 保存文件夹句柄到IndexedDB
     * @param {FileSystemDirectoryHandle} handle - 文件夹句柄
     * @returns {Promise<void>}
     */
    async saveDirectoryHandle(handle) {
        if (!('indexedDB' in window)) return;
        try {
            await this._ensureDB();
            await this._dbOp(STORAGE_CONSTANTS.OBJECT_STORES.FILE_HANDLES, 'put', 'rootDirectory', handle);
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to save directory handle: ${err.message}`, { type: 'warning', duration: 3000 });
            }
        }
    }

    /**
     * 从IndexedDB恢复文件夹句柄
     * @returns {Promise<FileSystemDirectoryHandle|null>}
     */
    async restoreDirectoryHandle() {
        if (!('indexedDB' in window)) return null;
        try {
            await this._ensureDB();
            const handle = await this._dbOp(STORAGE_CONSTANTS.OBJECT_STORES.FILE_HANDLES, 'get', 'rootDirectory');
            if (!handle) return null;
            
            // 检查权限状态
            const permissionStatus = await handle.requestPermission({ mode: 'readwrite' });
            if (permissionStatus !== 'granted') {
                // 权限被拒绝，清除存储的句柄
                await this._dbOp(STORAGE_CONSTANTS.OBJECT_STORES.FILE_HANDLES, 'delete', 'rootDirectory');
                return null;
            }
            
            // 验证句柄是否仍然有效：尝试访问句柄
            try {
                // 尝试读取句柄的迭代器来验证句柄是否仍然有效
                // 如果句柄已失效（例如文件夹被删除），这会抛出异常
                await handle.values().next();
            } catch (verifyErr) {
                // 句柄已失效，清除存储的句柄
                await this._dbOp(STORAGE_CONSTANTS.OBJECT_STORES.FILE_HANDLES, 'delete', 'rootDirectory');
                if (window.notify) {
                    window.notify.alert(`Directory handle is no longer valid: ${verifyErr.message}`, { type: 'warning', duration: 3000 });
                }
                return null;
            }
            
            return handle;
        } catch (err) {
            // 恢复失败，清除存储的句柄以避免下次启动时再次尝试恢复无效句柄
            try {
                await this._ensureDB();
                await this._dbOp(STORAGE_CONSTANTS.OBJECT_STORES.FILE_HANDLES, 'delete', 'rootDirectory');
            } catch (clearErr) {
                // 清除失败不影响主要错误通知
                if (window.notify) {
                    window.notify.alert(`Failed to clear invalid directory handle: ${clearErr.message}`, { type: 'warning', duration: 2000 });
                }
            }
            
            if (window.notify) {
                window.notify.alert(`Failed to restore directory handle: ${err.message}`, { type: 'warning', duration: 3000 });
            }
            return null;
        }
    }

    /**
     * 清除保存的文件夹句柄
     * @returns {Promise<void>}
     */
    async clearDirectoryHandle() {
        if (!('indexedDB' in window)) return;
        try {
            await this._ensureDB();
            await this._dbOp(STORAGE_CONSTANTS.OBJECT_STORES.FILE_HANDLES, 'delete', 'rootDirectory');
            // 清除标签页状态
            await this.clearTabsState();
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to clear directory handle: ${err.message}`, { type: 'warning', duration: 3000 });
            }
        }
    }

    /**
     * 保存标签页状态到IndexedDB
     * @param {Object} tabsState - 标签页状态对象
     * @param {Array} tabsState.tabs - 标签页数组，每个元素包含 { id, isPreview }
     * @param {string} tabsState.currentTabId - 当前活动的标签页ID
     * @param {string|null} tabsState.previewTabId - 预览标签页ID
     * @returns {Promise<void>}
     */
    async saveTabsState(tabsState) {
        if (!('indexedDB' in window)) return;
        try {
            await this._ensureDB();
            // 只保存标签页的ID和isPreview状态，不保存handle和model（这些无法序列化）
            const serializableState = {
                tabs: tabsState.tabs.map(tab => ({
                    id: tab.id,
                    isPreview: tab.isPreview || false
                })),
                currentTabId: tabsState.currentTabId,
                previewTabId: tabsState.previewTabId || null
            };
            await this._dbOp(STORAGE_CONSTANTS.OBJECT_STORES.TABS, 'put', 'tabsState', serializableState);
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to save tabs state: ${err.message}`, { type: 'warning', duration: 3000 });
            }
        }
    }

    /**
     * 从IndexedDB恢复标签页状态
     * @returns {Promise<Object|null>} 标签页状态对象，如果没有则返回null
     */
    async restoreTabsState() {
        if (!('indexedDB' in window)) return null;
        try {
            await this._ensureDB();
            const tabsState = await this._dbOp(STORAGE_CONSTANTS.OBJECT_STORES.TABS, 'get', 'tabsState');
            return tabsState || null;
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to restore tabs state: ${err.message}`, { type: 'warning', duration: 3000 });
            }
            return null;
        }
    }

    /**
     * 清除保存的标签页状态
     * @returns {Promise<void>}
     */
    async clearTabsState() {
        if (!('indexedDB' in window)) return;
        try {
            await this._ensureDB();
            await this._dbOp(STORAGE_CONSTANTS.OBJECT_STORES.TABS, 'delete', 'tabsState');
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to clear tabs state: ${err.message}`, { type: 'warning', duration: 3000 });
            }
        }
    }

    /**
     * 保存chat数据到IndexedDB
     * @param {string} messageId - 消息ID
     * @param {Object} chatData - chat数据对象
     * @param {string} chatData.type - 数据类型：'plan' 或 'patch'
     * @param {Array|string} chatData.data - 数据内容（plan为文件列表数组，patch为search-replace块字符串）
     * @param {Object} [chatData.state] - 状态数据（可选，用于保存交互状态）
     * @param {boolean} [chatData.state.disabled] - 消息是否禁用
     * @param {Array<{path: string, status: string}>} [chatData.state.fileStatuses] - 文件状态列表（patch类型）
     * @returns {Promise<void>}
     */
    async saveChatData(messageId, chatData) {
        if (!('indexedDB' in window)) return;
        try {
            await this._ensureDB();
            await this._dbOp(STORAGE_CONSTANTS.OBJECT_STORES.CHAT_DATA, 'put', messageId, chatData);
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to save chat data: ${err.message}`, { type: 'warning', duration: 3000 });
            }
        }
    }

    /**
     * 从IndexedDB获取chat数据
     * @param {string} messageId - 消息ID
     * @returns {Promise<Object|null>} chat数据对象，如果没有则返回null
     */
    async getChatData(messageId) {
        if (!('indexedDB' in window)) return null;
        try {
            await this._ensureDB();
            const chatData = await this._dbOp(STORAGE_CONSTANTS.OBJECT_STORES.CHAT_DATA, 'get', messageId);
            return chatData || null;
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to get chat data: ${err.message}`, { type: 'warning', duration: 3000 });
            }
            return null;
        }
    }

    /**
     * 从IndexedDB删除chat数据
     * @param {string} messageId - 消息ID
     * @returns {Promise<void>}
     */
    async deleteChatData(messageId) {
        if (!('indexedDB' in window)) return;
        try {
            await this._ensureDB();
            await this._dbOp(STORAGE_CONSTANTS.OBJECT_STORES.CHAT_DATA, 'delete', messageId);
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to delete chat data: ${err.message}`, { type: 'warning', duration: 3000 });
            }
        }
    }

    /**
     * 保存聊天历史消息
     * @param {Object} message - 消息对象
     * @param {string} message.messageId - 消息ID
     * @param {string} message.role - 消息角色：'user' 或 'ai'
     * @param {string} message.text - 消息文本
     * @param {string} [message.type] - AI消息类型：'plan' 或 'patch'（仅AI消息需要）
     * @param {number} [message.timestamp] - 时间戳（可选）
     * @returns {Promise<void>}
     */
    async saveChatHistoryMessage(message) {
        if (!('indexedDB' in window)) return;
        try {
            await this._ensureDB();
            const messageData = {
                messageId: message.messageId,
                role: message.role,
                text: message.text,
                type: message.type || null,
                timestamp: message.timestamp || Date.now()
            };
            await this._dbOp(STORAGE_CONSTANTS.OBJECT_STORES.CHAT_HISTORY, 'put', message.messageId, messageData);
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to save chat history: ${err.message}`, { type: 'warning', duration: 3000 });
            }
        }
    }

    /**
     * 获取所有聊天历史消息（按时间戳排序）
     * @returns {Promise<Array<Object>>} 消息数组
     */
    async getAllChatHistory() {
        if (!('indexedDB' in window)) return [];
        try {
            await this._ensureDB();
            const transaction = this._db.transaction([STORAGE_CONSTANTS.OBJECT_STORES.CHAT_HISTORY], 'readonly');
            const store = transaction.objectStore(STORAGE_CONSTANTS.OBJECT_STORES.CHAT_HISTORY);
            const request = store.getAll();
            
            return new Promise((resolve, reject) => {
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const messages = request.result || [];
                    // 按时间戳排序
                    messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                    resolve(messages);
                };
            });
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to get chat history: ${err.message}`, { type: 'warning', duration: 3000 });
            }
            return [];
        }
    }

    /**
     * 清除所有聊天历史
     * @returns {Promise<void>}
     */
    async clearChatHistory() {
        if (!('indexedDB' in window)) return;
        try {
            await this._ensureDB();
            const transaction = this._db.transaction([STORAGE_CONSTANTS.OBJECT_STORES.CHAT_HISTORY], 'readwrite');
            const store = transaction.objectStore(STORAGE_CONSTANTS.OBJECT_STORES.CHAT_HISTORY);
            await store.clear();
        } catch (err) {
            if (window.notify) {
                window.notify.alert(`Failed to clear chat history: ${err.message}`, { type: 'warning', duration: 3000 });
            }
        }
    }


    /**
     * 打开IndexedDB数据库
     * @private
     * @returns {Promise<IDBDatabase>}
     */
    async _openDB() {
        if (this._db) return this._db;
        if (!('indexedDB' in window)) throw new Error('IndexedDB not supported');
        
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(STORAGE_CONSTANTS.IDB_DB_NAME, STORAGE_CONSTANTS.IDB_VERSION);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this._db = request.result;
                resolve(this._db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const oldVersion = event.oldVersion;
                const newVersion = event.newVersion;
                
                // 确保所有必需的 Object Store 都存在
                Object.values(STORAGE_CONSTANTS.OBJECT_STORES).forEach(storeName => {
                    if (!db.objectStoreNames.contains(storeName)) {
                        db.createObjectStore(storeName);
                    }
                });
            };
        });
    }

    /**
     * 确保数据库已打开
     * @private
     */
    async _ensureDB() {
        if (!this._db) await this._openDB();
    }

    /**
     * 统一的数据库操作方法
     * @private
     * @param {string} storeName - 存储名称
     * @param {string} method - 操作方法 ('get'|'put'|'delete')
     * @param {string} key - 键
     * @param {*} value - 值（仅 put 操作需要）
     * @returns {Promise<*>}
     */
    async _dbOp(storeName, method, key, value) {
        await this._ensureDB();
        const mode = method === 'get' ? 'readonly' : 'readwrite';
        
        return new Promise((resolve, reject) => {
            const transaction = this._db.transaction([storeName], mode);
            const store = transaction.objectStore(storeName);
            const request = method === 'get' ? store.get(key) :
                          method === 'put' ? store.put(value, key) :
                          store.delete(key);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    /**
     * 从 localStorage 迁移数据到 IndexedDB
     * @private
     * @returns {Promise<void>}
     */
    async _migrateFromLocalStorage() {
        const migrationFlag = await this._dbOp(STORAGE_CONSTANTS.OBJECT_STORES.CONFIG, 'get', '_migrated_from_localStorage');
        if (migrationFlag) return;
        
        const configData = {};
        const { STORAGE_KEYS } = STORAGE_CONSTANTS;
        const mappings = [
            { key: STORAGE_KEYS.API_KEY, prop: 'apiKey' },
            { key: STORAGE_KEYS.BASE_URL, prop: 'baseUrl' },
            { key: STORAGE_KEYS.MODEL, prop: 'model' },
            { key: STORAGE_KEYS.COMPRESSION_STRATEGY, prop: 'compressionStrategy' }
        ];
        
        mappings.forEach(({ key, prop }) => {
            const value = localStorage.getItem(key);
            if (value !== null) configData[prop] = value;
        });
        
        // 处理数值类型
        const fontSize = localStorage.getItem(STORAGE_KEYS.FONT_SIZE);
        if (fontSize !== null) {
            const val = parseInt(fontSize, 10);
            if (!isNaN(val) && val > 0) configData.fontSize = val;
        }
        
        const tokenBudget = localStorage.getItem(STORAGE_KEYS.TOKEN_BUDGET);
        if (tokenBudget !== null) {
            const val = parseInt(tokenBudget, 10);
            if (!isNaN(val) && val > 0) configData.tokenBudget = val;
        }
        
        if (Object.keys(configData).length > 0) {
            await this._dbOp(STORAGE_CONSTANTS.OBJECT_STORES.CONFIG, 'put', 'appConfig', configData);
        }
        
        await this._dbOp(STORAGE_CONSTANTS.OBJECT_STORES.CONFIG, 'put', '_migrated_from_localStorage', true);
    }

    /**
     * 从 IndexedDB 加载配置
     * @private
     * @returns {Promise<void>}
     */
    async _loadConfigFromDB() {
        const configData = await this._dbOp(STORAGE_CONSTANTS.OBJECT_STORES.CONFIG, 'get', 'appConfig');
        if (configData) {
            this.state.config = { ...this.state.config, ...configData };
        }
    }

    /**
     * 发送自定义事件
     * @private
     * @param {string} type - 事件类型
     * @param {*} detail - 事件详情
     */
    _emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }
}
