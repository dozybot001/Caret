/**
 * @fileoverview 文件树 UI 模块
 * @description 负责文件树的渲染、交互
 */

import { UI_CONSTANTS } from '../app/constants.js';
import { t } from '../i18n/index.js';

/** 目录里有改动时的标记 */
const GIT_FOLDER_MARK = '•';

/** 路径和它的所有上级目录 */
function withParents(path) {
    const parts = path.split('/');
    return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

/**
 * 文件树 UI 管理器
 * @class FileTreeUI
 */
export class FileTreeUI {
    /**
     * @param {HTMLElement} fileTreeContainer - 文件树容器
     * @param {HTMLElement} fileTreePanel - 文件树面板
     */
    constructor(fileTreeContainer, fileTreePanel) {
        this.fileTreeContainer = fileTreeContainer;
        this.fileTreePanel = fileTreePanel;
        this.onFileClick = null;
        this.onOpenFolder = null;
        this.onResumeFolder = null;
        this.onReleaseFolder = null;

        /** @type {Array|null} 当前文件树数据 */
        this.currentTreeData = null;

        /** @type {Map<string, number>} 文件路径到定时器ID的映射，用于双击检测 */
        this.clickTimers = new Map();

        /** @type {Set<string>} 展开的目录，刷新文件树时保留 */
        this.expandedPaths = new Set();

        /** @type {string[]} 有未写入改动的文件 */
        this.changedPaths = [];

        /** @type {{branch: string, changes: Map<string, string>, deleted: string[]}|null} Git 状态 */
        this.git = null;
        this.branchLabel = null;
        this.deletedList = null;
    }

    /**
     * 设置文件树可见性
     * @param {boolean} isVisible - 是否可见
     */
    setFileTreeVisible(isVisible) {
        if (isVisible && !this.isOverlay()) {
            this.fileTreePanel.classList.remove('collapsed');
        } else {
            this.fileTreePanel.classList.add('collapsed');
        }
    }

    /** 窄屏时文件树覆盖在编辑器上方，由用户手动打开 */
    isOverlay() {
        return window.matchMedia('(max-width: 900px)').matches;
    }

    /** 清除展开状态，用于切换文件夹 */
    clearExpanded() {
        this.expandedPaths.clear();
    }

    /** 显示空状态：说明没有文件夹，并给出打开入口 */
    renderEmpty() {
        this._renderNotice(t('tree.empty'), [[t('tree.open'), () => this.onOpenFolder?.()]]);
    }

    /**
     * 显示恢复入口：浏览器要求用户点击后才能再次访问上次的文件夹
     * @param {string} name - 文件夹名称
     */
    renderResume(name) {
        this._renderNotice(name, [
            [t('tree.resume', name), () => this.onResumeFolder?.()],
            [t('folder.release'), () => this.onReleaseFolder?.()]
        ]);
    }

    _renderNotice(message, actions) {
        const notice = document.createElement('div');
        notice.className = 'tree-notice';
        const text = document.createElement('p');
        text.textContent = message;
        notice.appendChild(text);
        for (const [label, onClick] of actions) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-text btn-text-chat';
            button.textContent = label;
            button.addEventListener('click', onClick);
            notice.appendChild(button);
        }
        this.fileTreeContainer.replaceChildren(notice);
    }

    /**
     * 渲染文件树
     * @param {string} rootName - 根目录名称
     * @param {Array} treeData - 树形数据
     */
    renderFileTree(rootName, treeData) {
        this.currentTreeData = treeData;
        this.fileTreeContainer.innerHTML = '';

        const fragment = document.createDocumentFragment();
        const rootLabel = document.createElement('div');
        rootLabel.className = 'tree-node is-root';

        const rootNameSpan = document.createElement('span');
        rootNameSpan.className = 'tree-name';
        rootNameSpan.textContent = `${rootName}/`;
        rootLabel.appendChild(rootNameSpan);

        this.branchLabel = document.createElement('span');
        this.branchLabel.className = 'tree-branch hidden';
        this.branchLabel.innerHTML = '<i class="codicon codicon-git-branch"></i><span></span>';
        rootLabel.appendChild(this.branchLabel);

        const release = document.createElement('button');
        release.type = 'button';
        release.className = 'btn btn-close tree-release';
        release.title = t('folder.release');
        release.setAttribute('aria-label', release.title);
        release.innerHTML = '<i class="codicon codicon-debug-disconnect"></i>';
        release.addEventListener('click', () => this.onReleaseFolder?.());
        rootLabel.appendChild(release);

        fragment.appendChild(rootLabel);

        this._renderTreeNodes(treeData, fragment, "");

        this.deletedList = document.createElement('div');
        fragment.appendChild(this.deletedList);

        // 批量追加
        this.fileTreeContainer.appendChild(fragment);
        this._renderGit();
    }

    /**
     * 显示 Git 状态
     * @param {Object|null} git - Git 状态，不是 Git 仓库时为 null
     */
    setGitStatus(git) {
        this.git = git;
        this._renderGit();
    }

    _renderGit() {
        const { git, branchLabel, deletedList } = this;
        if (!branchLabel) return;

        branchLabel.classList.toggle('hidden', !git);
        branchLabel.lastChild.textContent = git?.branch || '';
        branchLabel.title = git ? t('git.branch', git.branch) : '';
        deletedList.replaceChildren(...(git?.deleted || []).map((path) => {
            const row = document.createElement('div');
            row.className = 'tree-node is-deleted';
            row.dataset.git = 'D';
            row.title = t('git.D');
            const name = document.createElement('span');
            name.className = 'tree-name';
            name.textContent = path;
            row.appendChild(name);
            return row;
        }));
        this._markChanged();
    }

    /**
     * 标记有未写入改动的文件及其上级目录
     * @param {string[]} paths - 文件路径
     */
    setChangedPaths(paths) {
        this.changedPaths = paths;
        this._markChanged();
    }

    _markChanged() {
        const marked = new Set(this.changedPaths.flatMap(withParents));
        const changes = this.git?.changes || new Map();
        const deleted = this.git?.deleted || [];
        const gitMarks = new Map();
        for (const path of [...changes.keys(), ...deleted]) {
            withParents(path).forEach(item => gitMarks.set(item, GIT_FOLDER_MARK));
        }
        changes.forEach((code, path) => gitMarks.set(path, code));

        this.fileTreeContainer.querySelectorAll('.tree-node[data-path]').forEach(row => {
            const code = gitMarks.get(row.dataset.path);
            row.classList.toggle('is-changed', marked.has(row.dataset.path));
            if (code) row.dataset.git = code;
            else delete row.dataset.git;
            row.title = code && code !== GIT_FOLDER_MARK ? t(`git.${code}`) : '';
        });
    }

    /**
     * 清除所有点击定时器
     * @private
     */
    _clearAllClickTimers() {
        this.clickTimers.forEach((timerId) => {
            clearTimeout(timerId);
        });
        this.clickTimers.clear();
    }

    /**
     * 切换目录展开状态
     * @private
     * @param {string} path - 目录路径
     * @param {HTMLElement} childContainer - 子项容器
     * @returns {boolean} 是否已展开
     */
    _toggleDirectory(path, childContainer) {
        const isOpen = childContainer.classList.toggle('hidden') === false;
        if (isOpen) this.expandedPaths.add(path);
        else this.expandedPaths.delete(path);
        return isOpen;
    }

    /**
     * 渲染树节点
     * @private
     * @param {Array} nodes - 节点数组
     * @param {HTMLElement} parent - 父元素
     * @param {string} prefix - 前缀字符串（用于树形显示）
     * @param {Object} options - 渲染选项
     * @param {number} options.maxDepth - 最大深度
     * @param {number} options.currentDepth - 当前深度
     * @param {number} options.maxNodes - 最大节点数
     */
    _renderTreeNodes(nodes, parent, prefix, options = {}) {
        const {
            maxDepth = Infinity,
            currentDepth = 0,
            maxNodes = UI_CONSTANTS.FILE_TREE_MAX_NODES
        } = options;
        let renderedCount = 0;

        // 对于大型树，实现懒加载渲染
        const shouldLazyRender = nodes.length > UI_CONSTANTS.FILE_TREE_LAZY_LOAD_THRESHOLD;

        nodes.forEach((node, index) => {
            if (renderedCount >= maxNodes) return;

            const isLast = index === nodes.length - 1;

            const row = document.createElement('div');
            row.className = `tree-node ${node.kind === 'directory' ? 'is-folder' : 'is-file'}`;
            row.setAttribute('data-path', node.path);

            // 将连接线和文件名分开，以便使用不同颜色
            const connector = document.createElement('span');
            connector.className = 'tree-connector';
            connector.textContent = `${prefix}${isLast ? '└ ' : '├ '}`;

            const fileName = document.createElement('span');
            fileName.className = 'tree-name';
            fileName.textContent = node.name;

            row.appendChild(connector);
            row.appendChild(fileName);

            if (node.kind === 'file') {
                // 文件节点：实现单击延迟检测机制
                // 单击立刻显示文件（预览Tab），在固定时间内再次点击同一文件则转为固定Tab
                row.addEventListener('click', () => {
                    const filePath = node.path;

                    // 检查是否已有定时器（说明是第二次点击）
                    if (this.clickTimers.has(filePath)) {
                        // 第二次点击：清除定时器，将预览Tab转为固定Tab
                        clearTimeout(this.clickTimers.get(filePath));
                        this.clickTimers.delete(filePath);

                        if (this.onFileClick) {
                            this.onFileClick(node.handle, filePath, false); // false 表示固定Tab
                        }
                    } else {
                        // 第一次点击：立即打开预览Tab
                        // 清除其他文件的定时器（切换文件时）
                        this._clearAllClickTimers();

                        if (this.onFileClick) {
                            this.onFileClick(node.handle, filePath, true); // true 表示预览Tab
                        }

                        // 设置定时器，如果在时间窗口内没有第二次点击，定时器会自动清除
                        const timerId = setTimeout(() => {
                            this.clickTimers.delete(filePath);
                        }, UI_CONSTANTS.FILE_TREE_DOUBLE_CLICK_TIMEOUT);

                        this.clickTimers.set(filePath, timerId);
                    }
                });

                parent.appendChild(row);
                renderedCount++;
            } else {
                // 目录节点：创建子容器（默认关闭）
                const childContainer = document.createElement('div');
                childContainer.classList.add('tree-children');
                if (!this.expandedPaths.has(node.path)) childContainer.classList.add('hidden');

                // 对于大型目录，实现懒加载
                if (shouldLazyRender && node.children && node.children.length > 20) {
                    childContainer.classList.add('lazy-loaded');
                    // 初始只渲染前几个项
                    const initialChildren = node.children.slice(0, UI_CONSTANTS.FILE_TREE_INITIAL_RENDER_COUNT);
                    const remainingCount = node.children.length - initialChildren.length;
                    let moreIndicator = null;

                    const renderRemaining = () => {
                        moreIndicator?.remove();
                        moreIndicator = null;
                        const nextPrefix = prefix + (isLast ? ' ' : '│');
                        this._renderTreeNodes(
                            node.children.slice(UI_CONSTANTS.FILE_TREE_INITIAL_RENDER_COUNT),
                            childContainer,
                            nextPrefix,
                            { ...options, currentDepth: currentDepth + 1 }
                        );
                        this._markChanged();
                    };

                    row.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // 展开时懒加载剩余子项
                        if (this._toggleDirectory(node.path, childContainer) && moreIndicator) {
                            renderRemaining();
                        }
                    });

                    if (currentDepth < maxDepth) {
                        const nextPrefix = prefix + (isLast ? ' ' : '│');
                        this._renderTreeNodes(initialChildren, childContainer, nextPrefix, {
                            ...options,
                            currentDepth: currentDepth + 1
                        });
                        if (remainingCount > 0) {
                            moreIndicator = document.createElement('div');
                            moreIndicator.className = 'tree-node tree-more';
                            moreIndicator.textContent = `${prefix}${isLast ? ' ' : '│'}... (${remainingCount})`;
                            childContainer.appendChild(moreIndicator);
                            if (this.expandedPaths.has(node.path)) renderRemaining();
                        }
                    }
                } else {
                    // 普通目录：直接渲染所有子项
                    row.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this._toggleDirectory(node.path, childContainer);
                    });

                    if (node.children && node.children.length > 0 && currentDepth < maxDepth) {
                        const nextPrefix = prefix + (isLast ? ' ' : '│');
                        this._renderTreeNodes(node.children, childContainer, nextPrefix, {
                            ...options,
                            currentDepth: currentDepth + 1
                        });
                    }
                }

                parent.appendChild(row);
                parent.appendChild(childContainer);
                renderedCount++;
            }
        });
    }

}
