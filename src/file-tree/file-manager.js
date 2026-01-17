/**
 * @fileoverview 文件管理器
 * @description 封装文件系统 API，管理目录句柄、文件读写与文件树构建
 * 
 * ## 核心功能
 * - 文件读写操作（带缓存）
 * - 文件树构建
 * - Repo Map 生成
 * - 文件缓存管理（LRU 策略）
 * 
 * @module FileManager
 */

import { initTreeSitter, generateRepoMap } from '../chat/repo-map/repo-map.js';
import { fetchIgnoreRules, parseIgnoreFile, isIgnored } from './ignore-manager.js';
import { FS_CONSTANTS } from '../global/constants.js';

/**
 * LRU 缓存实现
 * @class LRUCache
 * @private
 */
class LRUCache {
    constructor(maxSize = 50) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }
    
    get(key) {
        if (!this.cache.has(key)) return null;
        // Move to end (most recently used)
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }
    
    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Remove least recently used (first item)
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }
    
    delete(key) {
        this.cache.delete(key);
    }
    
    clear() {
        this.cache.clear();
    }
}

export class FileManager {
    /**
     * @param {AppStore} store - 应用状态存储实例
     */
    constructor(store = null) {
        this.rootDirHandle = null;
        this.globalIgnoreRules = [];
        this.store = store;
        
        // File content cache: key = filePath, value = { content, lastModified, timestamp }
        this.fileCache = new LRUCache(50);
    }

    async init() {
        // 延迟加载 TreeSitter（只在需要时加载）
        if (typeof window !== 'undefined' && window.loadTreeSitter) {
            window.loadTreeSitter();
        }
        
        // 延迟初始化 TreeSitter（等待脚本加载完成）
        const initTreeSitterWhenReady = () => {
            if (typeof window.TreeSitter !== 'undefined') {
                initTreeSitter();
            } else {
                // 继续等待脚本加载
                setTimeout(initTreeSitterWhenReady, 100);
            }
        };
        
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => {
                initTreeSitterWhenReady();
            }, { timeout: 500 });
        } else {
            setTimeout(() => {
                initTreeSitterWhenReady();
            }, 500);
        }
        
        this.globalIgnoreRules = await fetchIgnoreRules();
        
        // 尝试恢复之前保存的文件夹句柄
        if (this.store) {
            try {
                const handle = await this.store.restoreDirectoryHandle();
                if (handle) {
                    this.rootDirHandle = handle;
                }
            } catch (err) {
                // 恢复失败时，确保清理状态
                this.rootDirHandle = null;
                if (window.notify) {
                    window.notify.alert(`Failed to restore directory handle: ${err.message}`, { type: 'warning', duration: 3000 });
                }
            }
        }
    }

    async openDirectoryHandle() {
        try {
            this.rootDirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
            // 存储文件夹句柄到IndexedDB
            if (this.store) {
                await this.store.saveDirectoryHandle(this.rootDirHandle);
            }
            return this.rootDirHandle;
        } catch (err) {
            if (err.name !== 'AbortError' && window.notify) {
                window.notify.alert(`Error: ${err.message}`, { type: 'error' });
            }
            return null;
        }
    }

    hasRoot() {
        return !!this.rootDirHandle;
    }

    /**
     * 获取根目录句柄（不触发文件选择对话框）
     * @returns {FileSystemDirectoryHandle|null}
     */
    getRootHandle() {
        return this.rootDirHandle;
    }

    async getDirectoryEntries(dirHandle, currentPath, parentScopeStack) {
        const entries = [];
        for await (const entry of dirHandle.values()) entries.push(entry);

        let currentStack = parentScopeStack;
        const gitIgnoreEntry = entries.find(e => e.name === '.gitignore');
        if (gitIgnoreEntry) {
            try {
                const file = await gitIgnoreEntry.getFile();
                const text = await file.text();
                const newRules = parseIgnoreFile(text);

                currentStack = [...parentScopeStack, { basePath: currentPath, rules: newRules }];
            } catch (e) {
                // Ignore error silently
            }
        }

        const visibleEntries = entries.filter(entry => {
            if (entry.name === '.git') return false;
            const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
            return !isIgnored(entryPath, currentStack);
        });

        visibleEntries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1));

        return { entries: visibleEntries, scopeStack: currentStack };
    }

    async getRepoMap() {
        if (!this.rootDirHandle) throw new Error("No folder opened");
        
        const repoMap = await generateRepoMap(this.rootDirHandle, this.globalIgnoreRules);
        
        return repoMap;
    }

    /**
     * 通过路径获取文件句柄
     * @param {string} filePath - 文件路径
     * @returns {Promise<FileSystemFileHandle>}
     */
    async getFileHandleByPath(filePath) {
        if (!this.rootDirHandle) throw new Error("No folder opened");
        const parts = filePath.split('/').filter(p => p); // 过滤空字符串
        const fileName = parts.pop();
        let currentDir = this.rootDirHandle;

        for (const part of parts) {
            currentDir = await currentDir.getDirectoryHandle(part);
        }
        return await currentDir.getFileHandle(fileName);
    }

    /**
     * 获取文件句柄和文件对象
     * @private
     * @param {string} filePath - 文件路径
     * @returns {Promise<{fileHandle: FileSystemFileHandle, file: File}>}
     */
    async _getFileHandle(filePath) {
        const fileHandle = await this.getFileHandleByPath(filePath);
        const file = await fileHandle.getFile();
        return { fileHandle, file };
    }

    async readFile(filePath) {
        if (!this.rootDirHandle) throw new Error("No folder opened");
        
        try {
            // Check cache first
            const cached = this.fileCache.get(filePath);
            if (cached) {
                // Verify file hasn't been modified
                const { file } = await this._getFileHandle(filePath);
                if (file.lastModified === cached.lastModified) {
                    return cached.content;
                }
                // File was modified, remove from cache
                this.fileCache.delete(filePath);
            }
            
            // Read file from disk
            const { file } = await this._getFileHandle(filePath);
            const content = await file.text();
            
            // Cache the content
            this.fileCache.set(filePath, {
                content,
                lastModified: file.lastModified,
                timestamp: Date.now()
            });
            
            return content;
        } catch (error) {
            // Remove from cache if read fails
            this.fileCache.delete(filePath);
            throw error;
        }
    }

    async writeFile(filePath, content) {
        if (!this.rootDirHandle) throw new Error("No folder opened");
        const parts = filePath.split('/');
        const fileName = parts.pop();
        let currentDir = this.rootDirHandle;

        for (const part of parts) {
            currentDir = await currentDir.getDirectoryHandle(part, { create: true });
        }

        const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
        
        // Invalidate cache for this file
        this.fileCache.delete(filePath);
    }

    async buildFileTree(dirHandle, currentPath = "", parentScopeStack = null) {

        const stack = parentScopeStack || [{ basePath: "", rules: this.globalIgnoreRules }];

        const { entries, scopeStack: nextStack } = await this.getDirectoryEntries(dirHandle, currentPath, stack);

        const treeNodes = [];

        for (const entry of entries) {
            const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
            const node = {
                name: entry.name,
                kind: entry.kind,
                path: entryPath,
                handle: entry
            };

            if (entry.kind === 'directory') {

                node.children = await this.buildFileTree(entry, entryPath, nextStack);
            }

            treeNodes.push(node);
        }

        return treeNodes;
    }

    /**
     * 获取所有文件列表（扁平结构）
     * @returns {Array<{path: string, name: string, handle: FileSystemFileHandle}>} 文件列表
     */
    async getAllFiles() {
        if (!this.rootDirHandle) return [];
        
        const files = [];
        await this._scanFilesRecursive(this.rootDirHandle, "", files, [{ basePath: "", rules: this.globalIgnoreRules }]);
        return files;
    }

    /**
     * 递归扫描文件
     * @private
     * @param {FileSystemDirectoryHandle} dirHandle - 目录句柄
     * @param {string} currentPath - 当前路径
     * @param {Array} files - 文件列表（输出）
     * @param {Array} parentScopeStack - 父作用域栈
     */
    async _scanFilesRecursive(dirHandle, currentPath, files, parentScopeStack) {
        const { entries, scopeStack: nextStack } = await this.getDirectoryEntries(dirHandle, currentPath, parentScopeStack);
        
        for (const entry of entries) {
            const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
            
            if (entry.kind === 'file') {
                files.push({
                    path: entryPath,
                    name: entry.name,
                    handle: entry
                });
            } else if (entry.kind === 'directory') {
                await this._scanFilesRecursive(entry, entryPath, files, nextStack);
            }
        }
    }
}
