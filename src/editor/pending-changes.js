/**
 * @fileoverview 未写入的改动
 * @description 改动就是编辑器缓冲区：Agent 和用户改的是同一份内容，用户确认后才写入磁盘
 * @module pending-changes
 */

import { decodeBytes } from '../file-tree/file-manager.js';

/** 根据偏移量计算行列，文本使用 LF 换行 */
function positionAt(text, offset) {
    const head = text.slice(0, offset);
    return { lineNumber: head.split('\n').length, column: offset - head.lastIndexOf('\n') };
}

/** 把文件内容转成编辑器使用的文本 */
const toEditorText = bytes => decodeBytes(bytes).text.replace(/\r\n/g, '\n');

/**
 * 磁盘上的文件是否已经不是 Caret 读到的样子：新文件被其他程序建了出来，或者已有的文件被改过、删掉
 * @param {Object} fileManager - 文件管理器
 * @param {Object} tab - 标签页
 * @returns {Promise<boolean>}
 */
export async function changedOnDisk(fileManager, tab) {
    const disk = await fileManager.readBytes(tab.id);
    return tab.isNew ? disk !== null : disk === null || toEditorText(disk) !== tab.original;
}

export class PendingChanges {
    /** @param {Object} editor - 编辑器管理器 */
    constructor(editor) {
        this.editor = editor;
    }

    /**
     * 列出未写入的改动
     * @returns {Array<{path: string, name: string, base: string, text: string, isNew: boolean}>}
     */
    list() {
        const { editor } = this;
        return editor.tabs.filter(tab => tab.isDirty).map(tab => ({
            path: tab.id,
            name: tab.name,
            base: tab.original,
            text: editor.modelText(tab),
            isNew: tab.isNew
        }));
    }

    /**
     * 把新内容放进编辑器缓冲区，显示为待审阅的改动，不写入磁盘
     * @param {string} path - 文件路径
     * @param {string} text - 新内容（LF 换行）
     * @param {Object} options - 选项
     * @param {boolean} options.reveal - 是否切换到这个文件，不抢占输入焦点
     */
    async stage(path, text, { reveal = true } = {}) {
        const { editor } = this;
        let tab = editor.getTab(path);
        if (!tab) {
            const handle = await editor.fileManager.getFileHandleByPath(path).catch(() => null);
            tab = await editor.createTab(handle, path, false);
        }

        this._replaceText(tab, text);
        // 新文件全部是新增内容，直接显示文件本身
        tab.showDiff = !tab.isNew && editor.modelText(tab) !== tab.original;
        editor.refreshDirty(tab);

        if (reveal) editor.switchTab(path, { focus: false });
        else if (editor.currentTabId === path) editor.present(tab, false);
        else editor.renderTabs();
        editor.notifyChanges();
    }

    /**
     * 只替换变化的部分，保留编辑器的撤销记录
     * @private
     */
    _replaceText(tab, text) {
        const before = this.editor.modelText(tab);
        if (before === text) return;

        let start = 0;
        let endBefore = before.length;
        let endAfter = text.length;
        while (start < endBefore && start < endAfter && before[start] === text[start]) start++;
        while (endBefore > start && endAfter > start && before[endBefore - 1] === text[endAfter - 1]) {
            endBefore--;
            endAfter--;
        }

        const range = monaco.Range.fromPositions(positionAt(before, start), positionAt(before, endBefore));
        tab.model.pushStackElement();
        tab.model.pushEditOperations(null, [{ range, text: text.slice(start, endAfter) }], () => null);
        tab.model.pushStackElement();
    }

    /**
     * 显示某个文件的改动
     * @param {string} path - 文件路径
     * @param {Object} options - 选项
     * @param {boolean} options.focus - 是否把输入焦点移到编辑器
     */
    show(path, { focus = true } = {}) {
        const tab = this.editor.getTab(path);
        if (!tab) return;
        tab.showDiff = !tab.isNew;
        this.editor.switchTab(path, { focus });
    }

    /**
     * 放弃某个文件的改动
     * @param {string} path - 文件路径
     */
    async discard(path) {
        const { editor } = this;
        const tab = editor.getTab(path);
        if (!tab) return;
        if (tab.isNew) {
            await editor.closeTab(path, { force: true });
            return;
        }
        this._replaceText(tab, tab.original);
        tab.showDiff = false;
        editor.refreshDirty(tab);
        if (editor.currentTabId === path) editor.present(tab, false);
        editor.notifyChanges();
    }

    /**
     * 把所有改动写入磁盘。写入前检查磁盘内容，避免覆盖其他程序的修改
     * @param {Object} options - 选项
     * @param {boolean} options.force - 忽略冲突
     * @returns {Promise<{conflicts?: string[], applied?: Array}>}
     */
    async apply({ force = false } = {}) {
        const { editor } = this;
        const { fileManager } = editor;
        const tabs = editor.tabs.filter(tab => tab.isDirty);

        if (!force) {
            const conflicts = [];
            for (const tab of tabs) {
                if (await changedOnDisk(fileManager, tab)) conflicts.push(tab.id);
            }
            if (conflicts.length > 0) return { conflicts };
        }

        const applied = [];
        try {
            for (const tab of tabs) {
                const before = await fileManager.readBytes(tab.id);
                const after = editor.modelText(tab);
                await editor.writeTab(tab);
                applied.push({ path: tab.id, before, after });
            }
        } catch (error) {
            await this.undo(applied, { force: true });
            throw error;
        }
        return { applied };
    }

    /**
     * 撤销一次写入：恢复磁盘内容，改动回到待写入状态。
     * 编辑器里的内容不动，所以写入之后的修改留在待写入的改动里，不会丢失
     * @param {Array<{path: string, before: ArrayBuffer|null, after: string}>} applied - 写入记录
     * @param {Object} options - 选项
     * @param {boolean} options.force - 磁盘内容和这次写入不同时仍然恢复
     * @returns {Promise<{conflicts?: string[]}>} 没有恢复时返回磁盘内容不同的文件
     */
    async undo(applied, { force = false } = {}) {
        const { editor } = this;
        const { fileManager } = editor;
        if (!force) {
            const conflicts = [];
            for (const { path, after } of applied) {
                const disk = await fileManager.readBytes(path);
                if (disk === null || toEditorText(disk) !== after) conflicts.push(path);
            }
            if (conflicts.length > 0) return { conflicts };
        }

        for (const { path, before, after } of [...applied].reverse()) {
            const tab = editor.getTab(path);
            if (before === null) {
                if (await fileManager.readBytes(path) !== null) await fileManager.deleteFile(path);
                if (tab) {
                    tab.handle = null;
                    tab.isNew = true;
                    editor.setBase(tab, '');
                }
            } else {
                await fileManager.writeFile(path, before);
                if (tab) editor.setBase(tab, toEditorText(before));
            }
            await this.stage(path, tab ? editor.modelText(tab) : after, { reveal: false });
        }
        return {};
    }
}
