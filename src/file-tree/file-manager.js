/**
 * @fileoverview 文件管理器
 * @description 封装文件系统 API，管理目录句柄、文件读写与文件树构建
 *
 * ## 核心功能
 * - 文件读写操作（带缓存）
 * - 文件树构建
 * - 文件缓存管理（LRU 策略）
 *
 * @module FileManager
 */

import { fetchIgnoreRules, parseIgnoreFile, isIgnored } from './ignore-manager.js';
import { readGitStatus } from './git-status.js';
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

/**
 * 按 UTF-8 解码文件内容。无法解码的文件不能修改，否则保存时会损坏
 * @param {ArrayBuffer} buffer - 文件内容
 * @returns {{text: string, bom: boolean, editable: boolean}}
 */
export function decodeBytes(buffer) {
    const bytes = new Uint8Array(buffer);
    if (!bytes.subarray(0, 8000).includes(0)) {
        try {
            const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
            const bom = raw.charCodeAt(0) === 0xFEFF;
            return { text: bom ? raw.slice(1) : raw, bom, editable: true };
        } catch {
            // 不是 UTF-8，下面按只读处理
        }
    }
    return { text: new TextDecoder().decode(bytes), bom: false, editable: false };
}

const isMissing = error => error.name === 'NotFoundError' || error.name === 'TypeMismatchError';

/** 这些目录不显示，也不交给 Agent，任何规则都不能放开 */
const PROTECTED_DIRECTORIES = ['.git', '.intent'];

export class FileManager {
    /**
     * @param {AppStore} store - 应用状态存储实例
     */
    constructor(store = null) {
        this.rootDirHandle = null;
        /** 上次打开的文件夹，需要用户点击后才能恢复访问 */
        this.pendingHandle = null;
        this.globalIgnoreRules = [];
        /** 设置里的忽略规则，优先于内置规则和 .gitignore */
        this.userIgnoreRules = [];
        this.store = store;

        // File content cache: key = filePath, value = { result, lastModified, size }
        this.fileCache = new LRUCache(FS_CONSTANTS.FILE_CACHE_MAX_SIZE);
    }

    async init() {
        this.globalIgnoreRules = await fetchIgnoreRules();

        // 尝试恢复之前保存的文件夹句柄。浏览器要求用户点击后才能重新授权，这里只查询状态
        if (this.store) {
            try {
                const handle = await this.store.getDirectoryHandle();
                if (handle) {
                    const permission = await handle.queryPermission({ mode: 'readwrite' });
                    if (permission === 'granted') this.rootDirHandle = handle;
                    else this.pendingHandle = handle;
                }
            } catch {
                this.rootDirHandle = null;
            }
        }
    }

    /** @param {string} text - 设置里的忽略规则，写法和 .gitignore 相同 */
    setUserIgnoreRules(text) {
        this.userIgnoreRules = parseIgnoreFile(text);
    }

    /**
     * 打开文件夹选择器
     * @returns {Promise<FileSystemDirectoryHandle|null>}
     */
    async openDirectoryHandle() {
        try {
            const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'caret' });
            return await this.useDirectory(handle);
        } catch (err) {
            if (err.name === 'AbortError') return null;
            throw err;
        }
    }

    /**
     * 使用指定的文件夹作为项目根目录，需要在用户操作中调用
     * @param {FileSystemDirectoryHandle} handle - 文件夹句柄
     * @returns {Promise<FileSystemDirectoryHandle|null>} 未授权时返回 null
     */
    async useDirectory(handle) {
        const permission = await handle.requestPermission({ mode: 'readwrite' });
        if (permission !== 'granted') return null;
        this.rootDirHandle = handle;
        this.pendingHandle = null;
        this.fileCache.clear();
        if (this.store) await this.store.saveDirectoryHandle(handle);
        return handle;
    }

    /**
     * 放弃文件夹句柄。网页不能撤销浏览器的授权，没有句柄后就无法再访问这个文件夹
     */
    async release() {
        this.rootDirHandle = null;
        this.pendingHandle = null;
        this.fileCache.clear();
        await this.store?.clearDirectoryHandle();
    }

    /**
     * 读取 Git 状态
     * @returns {Promise<Object|null>} 没有打开文件夹或不是 Git 仓库时返回 null
     */
    async getGitStatus() {
        if (!this.rootDirHandle) return null;
        return readGitStatus(this.rootDirHandle, await this.getAllFiles(), [...this.globalIgnoreRules, ...this.userIgnoreRules]);
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

        const scopes = [...currentStack, { basePath: '', rules: this.userIgnoreRules }];
        const visibleEntries = entries.filter(entry => {
            if (PROTECTED_DIRECTORIES.includes(entry.name)) return false;
            const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
            return !isIgnored(entryPath, scopes);
        });

        visibleEntries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1));

        return { entries: visibleEntries, scopeStack: currentStack };
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
     * 读取文本，换行符统一为 LF
     * @param {string} filePath - 文件路径
     * @returns {Promise<{text?: string, error?: string}|null>} 文件不存在时返回 null
     */
    async readText(filePath) {
        let file;
        try {
            file = await (await this.getFileHandleByPath(filePath)).getFile();
        } catch (error) {
            if (isMissing(error)) return null;
            throw error;
        }
        if (file.size > FS_CONSTANTS.AGENT_FILE_LIMIT) return { error: 'the file is too large' };

        const cached = this.fileCache.get(filePath);
        if (cached && cached.lastModified === file.lastModified && cached.size === file.size) {
            return cached.result;
        }

        const decoded = decodeBytes(await file.arrayBuffer());
        const result = decoded.editable
            ? { text: decoded.text.replace(/\r\n/g, '\n') }
            : { error: 'it is not UTF-8 text' };
        this.fileCache.set(filePath, { result, lastModified: file.lastModified, size: file.size });
        return result;
    }

    /**
     * 读取文件的原始内容，用于撤销写入
     * @param {string} filePath - 文件路径
     * @returns {Promise<ArrayBuffer|null>} 文件不存在时返回 null
     */
    async readBytes(filePath) {
        try {
            const file = await (await this.getFileHandleByPath(filePath)).getFile();
            return await file.arrayBuffer();
        } catch (error) {
            if (isMissing(error)) return null;
            throw error;
        }
    }

    /**
     * 写入文件，目录不存在时自动创建
     * @param {string} filePath - 文件路径
     * @param {string|ArrayBuffer} content - 内容
     */
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

    /**
     * 删除文件，用于撤销新建。同时清理因此变空的目录
     * @param {string} filePath - 文件路径
     */
    async deleteFile(filePath) {
        const parts = filePath.split('/');
        const fileName = parts.pop();
        const directories = [this.rootDirHandle];
        for (const part of parts) {
            directories.push(await directories[directories.length - 1].getDirectoryHandle(part));
        }
        await directories[directories.length - 1].removeEntry(fileName);
        this.fileCache.delete(filePath);

        for (let depth = parts.length; depth > 0; depth--) {
            try {
                await directories[depth - 1].removeEntry(parts[depth - 1]);
            } catch {
                return; // 目录里还有其他内容
            }
        }
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
