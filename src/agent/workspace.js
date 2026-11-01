/**
 * @fileoverview 工作区
 * @description 把文件系统和编辑器合成 Agent 看到的项目：打开的文件以编辑器内容为准，改动只进入编辑器
 * @module workspace
 */

export class Workspace {
    /**
     * @param {Object} file - 文件管理器
     * @param {Object} editor - 编辑器管理器
     */
    constructor(file, editor) {
        this.file = file;
        this.editor = editor;
        this.files = [];
        /** 运行时是否让编辑器跟随 Agent 显示最新改动 */
        this.follow = true;
    }

    get name() {
        return this.file.getRootHandle()?.name || '';
    }

    /** 重新扫描项目文件 */
    async refresh() {
        this.files = (await this.file.getAllFiles()).map(file => file.path);
    }

    /**
     * 所有文件路径，包含尚未写入磁盘的新文件
     * @returns {string[]}
     */
    paths() {
        const newFiles = this.editor.getChanges().filter(change => change.isNew).map(change => change.path);
        return [...new Set([...this.files, ...newFiles])];
    }

    /**
     * 判断路径是否为目录
     * @param {string} path - 路径
     * @returns {boolean}
     */
    isDirectory(path) {
        return this.paths().some(file => file.startsWith(`${path}/`));
    }

    /**
     * 读取文本，换行符统一为 LF
     * @param {string} path - 路径
     * @returns {Promise<{text?: string, error?: string}|null>} 文件不存在时返回 null
     */
    async getText(path) {
        const text = this.editor.getTabText(path);
        if (text !== null) return { text };
        return this.file.readText(path);
    }

    /**
     * 把新内容放进编辑器，等待用户确认
     * @param {string} path - 路径
     * @param {string} text - 新内容
     */
    async setText(path, text) {
        await this.editor.stageText(path, text, { reveal: this.follow });
    }
}
