/**
 * @fileoverview 文件操作业务逻辑处理器
 * @description 处理文件相关的所有业务逻辑，包括打开文件夹、生成仓库地图、文件审查、接受/拒绝变更等
 * 
 * @module FileHandlers
 */

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
     * @param {Object} context.chatUI - 聊天 UI 实例
     * @param {Object} context.fileTreeUI - 文件树 UI 实例
     */
    constructor(context) {
        this.context = context;
    }

    /**
     * 处理打开文件夹
     * @returns {Promise<void>}
     */
    async handleOpenFolder() {
        const { file, editor, chatUI, fileTreeUI } = this.context;
        
        window.notify?.alert("Waiting for folder selection...", { type: 'info' });

        try {
            const rootHandle = await file.openDirectoryHandle();

            if (!rootHandle) {
                window.notify?.alert("Folder selection cancelled.", { type: 'info' });
                return;
            }

            await chatUI.runTask(
                'Scanning project structure...',
                async () => {
                    await editor.reset();
                    const treeData = await file.buildFileTree(rootHandle);
                    fileTreeUI.renderFileTree(rootHandle.name, treeData);
                    fileTreeUI.setFileTreeVisible(true);
                },
                `Project "${rootHandle.name}" loaded successfully.`
            );

        } catch (e) {
            if (e.name === 'AbortError') {
                return;
            }
            if (window.notify) {
                window.notify.alert(`Open folder error: ${e.message}`, { type: 'error' });
            }
            const message = `Failed to open folder.\n${e.message || 'Please try again.'}`;
            window.notify?.alert(message, { type: 'error', duration: 5000 });
        }
    }

    /**
     * 处理显示仓库地图
     * @returns {Promise<void>}
     */
    async handleShowMap() {
        const { file, chatUI, editor } = this.context;
        
        if (!file.hasRoot()) {
            window.notify?.alert("Please open a folder first.", { type: 'error', duration: 5000 });
            return;
        }

        try {
            await chatUI.runTask(
                'Generating Repository Map...',
                async () => {
                    const mapContent = await file.getRepoMap();
                    await file.writeFile('repo-map.txt', mapContent);
                },
                'Repository map saved to repo-map.txt'
            );
        } catch (e) {
            // Error already shown by runTask
            if (window.notify) {
                window.notify.alert(`Repo map generation error: ${e.message}`, { type: 'error' });
            }
        }
    }

}
