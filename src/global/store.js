/**
 * @fileoverview 应用状态管理
 * @description 管理全局应用状态（配置/上下文），负责本地存储持久化与事件驱动的数据同步
 */

import { STORAGE_CONSTANTS, DEFAULT_CONFIG } from './constants.js';
import { t } from './i18n.js';

const { OBJECT_STORES } = STORAGE_CONSTANTS;

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
                provider: DEFAULT_CONFIG.PROVIDER,
                /** 每个服务商各自的 Key 和模型 */
                keys: {},
                models: {},
                /** 每个服务商的默认推理强度 */
                efforts: {},
                /** 每个服务商的模型列表 */
                modelLists: {},
                /** 接口返回的推理档位：{ 服务商: { 模型: { levels, defaultLevel } } } */
                modelEfforts: {},
                customUrl: '',
                fontSize: DEFAULT_CONFIG.FONT_SIZE
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
                const configData = await this._dbOp(OBJECT_STORES.CONFIG, 'get', 'appConfig');
                if (configData) {
                    this.state.config = { ...this.state.config, ...configData };
                }
            } catch (err) {
                window.notify?.alert(t('error.generic', err.message), { type: 'warning', duration: 3000 });
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
        await this._dbOp(OBJECT_STORES.CONFIG, 'put', 'appConfig', this.state.config);
        this.dispatchEvent(new CustomEvent('config-updated', { detail: this.state.config }));
    }

    /**
     * 获取配置
     * @returns {Object} 配置对象
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
        await this._dbOp(OBJECT_STORES.FILE_HANDLES, 'put', 'rootDirectory', handle);
    }

    /**
     * 从IndexedDB读取文件夹句柄
     * @returns {Promise<FileSystemDirectoryHandle|null>}
     */
    async getDirectoryHandle() {
        return (await this._dbOp(OBJECT_STORES.FILE_HANDLES, 'get', 'rootDirectory')) || null;
    }

    /**
     * 清除保存的文件夹句柄和标签页状态
     * @returns {Promise<void>}
     */
    async clearDirectoryHandle() {
        await this._dbOp(OBJECT_STORES.FILE_HANDLES, 'delete', 'rootDirectory');
        await this.clearTabsState();
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
        // 只保存标签页的ID和isPreview状态，不保存handle和model（这些无法序列化）
        const serializableState = {
            tabs: tabsState.tabs.filter(tab => !tab.isNew).map(tab => ({
                id: tab.id,
                isPreview: tab.isPreview || false
            })),
            currentTabId: tabsState.currentTabId,
            previewTabId: tabsState.previewTabId || null
        };
        await this._dbOp(OBJECT_STORES.TABS, 'put', 'tabsState', serializableState);
    }

    /**
     * 从IndexedDB恢复标签页状态
     * @returns {Promise<Object|null>} 标签页状态对象，如果没有则返回null
     */
    async restoreTabsState() {
        return (await this._dbOp(OBJECT_STORES.TABS, 'get', 'tabsState')) || null;
    }

    /**
     * 清除保存的标签页状态
     * @returns {Promise<void>}
     */
    async clearTabsState() {
        await this._dbOp(OBJECT_STORES.TABS, 'delete', 'tabsState');
    }

    /**
     * 列出记录过的项目
     * @returns {Promise<Array<{id: string, name: string, handle: FileSystemDirectoryHandle}>>}
     */
    listProjects() {
        return this._getAll(OBJECT_STORES.PROJECTS);
    }

    /**
     * 保存项目
     * @param {{id: string, name: string, handle: FileSystemDirectoryHandle}} project - 项目
     * @returns {Promise<void>}
     */
    async saveProject(project) {
        await this._dbOp(OBJECT_STORES.PROJECTS, 'put', project.id, project);
    }

    /**
     * 列出所有会话的基本信息，不含对话内容
     * @returns {Promise<Array<Object>>}
     */
    listSessions() {
        return this._getAll(OBJECT_STORES.SESSIONS);
    }

    /**
     * 读取会话内容
     * @param {string} id - 会话 ID
     * @returns {Promise<{messages: Array, timeline: Array}|undefined>}
     */
    getSessionData(id) {
        return this._dbOp(OBJECT_STORES.SESSION_DATA, 'get', id);
    }

    /**
     * 保存会话。基本信息和内容分开存放，列表不用读取完整对话
     * @param {Object} session - 基本信息
     * @param {{messages: Array, timeline: Array}} data - 内容
     * @returns {Promise<void>}
     */
    saveSession(session, data) {
        return this._transaction(transaction => {
            transaction.objectStore(OBJECT_STORES.SESSIONS).put(session, session.id);
            transaction.objectStore(OBJECT_STORES.SESSION_DATA).put(data, session.id);
        });
    }

    /**
     * 删除会话
     * @param {string[]} ids - 会话 ID
     * @returns {Promise<void>}
     */
    deleteSessions(ids) {
        return this._transaction(transaction => {
            for (const id of ids) {
                transaction.objectStore(OBJECT_STORES.SESSIONS).delete(id);
                transaction.objectStore(OBJECT_STORES.SESSION_DATA).delete(id);
            }
        });
    }

    /**
     * 读取存储里的全部值
     * @private
     * @param {string} storeName - 存储名称
     * @returns {Promise<Array>}
     */
    async _getAll(storeName) {
        await this._openDB();
        return new Promise((resolve, reject) => {
            const request = this._db.transaction([storeName], 'readonly').objectStore(storeName).getAll();
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    /**
     * 在一个事务里写入会话的基本信息和内容
     * @private
     * @param {Function} write - 写入函数
     * @returns {Promise<void>}
     */
    async _transaction(write) {
        await this._openDB();
        return new Promise((resolve, reject) => {
            const transaction = this._db.transaction([OBJECT_STORES.SESSIONS, OBJECT_STORES.SESSION_DATA], 'readwrite');
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
            write(transaction);
        });
    }

    /**
     * 打开IndexedDB数据库
     * @private
     * @returns {Promise<IDBDatabase>}
     */
    async _openDB() {
        if (this._db) return this._db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(STORAGE_CONSTANTS.IDB_DB_NAME, STORAGE_CONSTANTS.IDB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this._db = request.result;
                // 新版本在其他标签页打开时让出连接
                this._db.onversionchange = () => {
                    this._db.close();
                    this._db = null;
                };
                resolve(this._db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                Object.values(OBJECT_STORES).forEach(storeName => {
                    if (!db.objectStoreNames.contains(storeName)) {
                        db.createObjectStore(storeName);
                    }
                });
            };
        });
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
        await this._openDB();
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
}
