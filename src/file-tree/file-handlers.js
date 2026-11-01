/**
 * @fileoverview 文件操作业务逻辑处理器
 * @description 处理打开文件夹、恢复访问、刷新文件树
 *
 * @module FileHandlers
 */

import { t } from '../i18n/index.js';

/**
 * 文件操作业务逻辑处理器
 * @class FileHandlers
 */
export class FileHandlers {
    /**
     * 构造函数
     * @param {Object} context - 上下文对象，包含所有需要的依赖
     * @param {Object} context.file - 文件管理器实例
     * @param {Object} context.editor - 编辑器管理器实例
     * @param {Object} context.fileTreeUI - 文件树 UI 实例
     * @param {Function} context.onFolderOpened - 打开新文件夹后调用
     */
    constructor(context) {
        this.context = context;
        this.gitRequest = 0;
        /** 关闭后不读取 .git */
        this.showGit = true;
    }

    /**
     * 切换文件夹前确认未写入的改动
     * @private
     * @returns {Promise<boolean>} 是否继续
     */
    async _confirmSwitch() {
        return this.context.editor.changes.list().length === 0 || window.notify.confirm(t('changes.switchFolder'));
    }

    /**
     * 处理打开文件夹
     * @returns {Promise<boolean>} 是否打开了文件夹
     */
    async handleOpenFolder() {
        if (!('showDirectoryPicker' in window)) {
            window.notify?.alert(t('error.unsupported'), { type: 'error', duration: 6000 });
            return false;
        }
        if (!(await this._confirmSwitch())) return false;

        try {
            const rootHandle = await this.context.file.openDirectoryHandle();
            if (!rootHandle) return false;
            await this._load(rootHandle);
            return true;
        } catch (error) {
            window.notify?.alert(t('error.generic', error.message), { type: 'error', duration: 5000 });
            return false;
        }
    }

    /**
     * 打开拖入的文件夹
     * @param {FileSystemDirectoryHandle} handle - 文件夹句柄
     * @returns {Promise<boolean>} 是否打开了文件夹
     */
    async handleDroppedFolder(handle) {
        if (!(await this._confirmSwitch())) return false;
        try {
            if (!(await this.context.file.useDirectory(handle))) return false;
            await this._load(handle);
            return true;
        } catch (error) {
            window.notify?.alert(t('error.generic', error.message), { type: 'error', duration: 5000 });
            return false;
        }
    }

    /**
     * 恢复上次打开的文件夹，需要用户点击后调用
     * @returns {Promise<boolean>} 是否恢复成功
     */
    async handleResumeFolder() {
        const { file, editor } = this.context;
        const handle = file.pendingHandle;
        if (!handle) return false;

        try {
            if (!(await file.useDirectory(handle))) return false;
            await this.refreshTree();
            this.context.fileTreeUI.setFileTreeVisible(true);
            await editor.tabState.restore();
            await this.context.onFolderOpened();
            return true;
        } catch (error) {
            // 文件夹可能已被删除或移动
            file.pendingHandle = null;
            await file.store?.clearDirectoryHandle();
            this.context.fileTreeUI.renderEmpty();
            window.notify?.alert(t('error.generic', error.message), { type: 'warning' });
            return false;
        }
    }

    /** 放弃当前文件夹，回到没有打开文件夹时的样子 */
    async handleReleaseFolder() {
        const { file, editor, fileTreeUI } = this.context;
        await editor.reset();
        await file.release();
        await this.refreshGit();
        fileTreeUI.clearExpanded();
        fileTreeUI.renderEmpty();
        fileTreeUI.setFileTreeVisible(false);
    }

    /**
     * 显示已打开的文件夹
     * @private
     */
    async _load(rootHandle) {
        await this.context.editor.reset();
        this.context.fileTreeUI.clearExpanded();
        await this.refreshTree();
        this.context.fileTreeUI.setFileTreeVisible(true);
        document.getElementById('chat-panel').classList.remove('collapsed');
        await this.context.onFolderOpened();
        window.notify?.alert(t('folder.loaded', rootHandle.name), { type: 'success' });
    }

    /**
     * 重新读取文件树，保留展开状态
     */
    async refreshTree() {
        const { file, fileTreeUI } = this.context;
        const rootHandle = file.getRootHandle();
        if (!rootHandle) return;
        fileTreeUI.renderFileTree(rootHandle.name, await file.buildFileTree(rootHandle));
        this.refreshGit();
    }

    /** 重新读取 Git 状态，连续触发时只显示最新的结果。读取失败时不显示 */
    async refreshGit() {
        const { file, fileTreeUI } = this.context;
        const request = ++this.gitRequest;
        const git = this.showGit ? await file.getGitStatus().catch(() => null) : null;
        if (request === this.gitRequest) fileTreeUI.setGitStatus(git);
    }
}
