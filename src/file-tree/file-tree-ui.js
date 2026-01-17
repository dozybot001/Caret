/**
 * @fileoverview 文件树 UI 模块
 * @description 负责文件树的渲染、交互
 */

import { UI_CONSTANTS } from '../global/constants.js';

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
        
        /** @type {Array|null} 当前文件树数据 */
        this.currentTreeData = null;
        
        /** @type {Map<string, number>} 文件路径到定时器ID的映射，用于双击检测 */
        this.clickTimers = new Map();
    }

    /**
     * 设置文件树可见性
     * @param {boolean} isVisible - 是否可见
     */
    setFileTreeVisible(isVisible) {
        if (isVisible) {
            this.fileTreePanel.classList.remove('collapsed');
        } else {
            this.fileTreePanel.classList.add('collapsed');
        }
    }

    /**
     * 渲染文件树
     * @param {string} rootName - 根目录名称
     * @param {Array} treeData - 树形数据
     */
    renderFileTree(rootName, treeData) {
        // 存储树数据以便后续使用（例如 autocomplete）
        this.currentTreeData = treeData;
        
        // 使用 requestIdleCallback 进行非关键渲染
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => {
                this._renderFileTreeSync(rootName, treeData);
            }, { timeout: 100 });
        } else {
            // 不支持 requestIdleCallback 的浏览器回退方案
            setTimeout(() => {
                this._renderFileTreeSync(rootName, treeData);
            }, 0);
        }
    }
    
    /**
     * 同步渲染文件树
     * @private
     * @param {string} rootName - 根目录名称
     * @param {Array} treeData - 树形数据
     */
    _renderFileTreeSync(rootName, treeData) {
        this.fileTreeContainer.innerHTML = '';

        const fragment = document.createDocumentFragment();
        const rootLabel = document.createElement('div');
        rootLabel.className = 'tree-node is-root';
        
        const rootNameSpan = document.createElement('span');
        rootNameSpan.className = 'tree-name';
        rootNameSpan.textContent = `${rootName}/`;
        rootLabel.appendChild(rootNameSpan);
        
        fragment.appendChild(rootLabel);

        this._renderTreeNodes(treeData, fragment, "");
        
        // 批量追加
        this.fileTreeContainer.appendChild(fragment);
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
                childContainer.classList.add('tree-children', 'hidden');
                
                // 对于大型目录，实现懒加载
                if (shouldLazyRender && node.children && node.children.length > 20) {
                    childContainer.classList.add('lazy-loaded');
                    // 初始只渲染前几个项
                    const initialChildren = node.children.slice(0, UI_CONSTANTS.FILE_TREE_INITIAL_RENDER_COUNT);
                    const remainingCount = node.children.length - initialChildren.length;
                    
                    row.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const isHidden = childContainer.classList.contains('hidden');
                        childContainer.classList.toggle('hidden');
                        
                        // 展开时懒加载剩余子项
                        if (!isHidden && remainingCount > 0 && 
                            childContainer.querySelectorAll('.tree-node').length <= initialChildren.length) {
                            const renderRemaining = () => {
                                const nextPrefix = prefix + (isLast ? ' ' : '│');
                                this._renderTreeNodes(
                                    node.children.slice(UI_CONSTANTS.FILE_TREE_INITIAL_RENDER_COUNT), 
                                    childContainer, 
                                    nextPrefix,
                                    { ...options, currentDepth: currentDepth + 1 }
                                );
                            };
                            if ('requestIdleCallback' in window) {
                                requestIdleCallback(renderRemaining);
                            } else {
                                setTimeout(renderRemaining, 0);
                            }
                        }
                    });
                    
                    if (currentDepth < maxDepth) {
                        const nextPrefix = prefix + (isLast ? ' ' : '│');
                        this._renderTreeNodes(initialChildren, childContainer, nextPrefix, { 
                            ...options, 
                            currentDepth: currentDepth + 1 
                        });
                        if (remainingCount > 0) {
                            const moreIndicator = document.createElement('div');
                            moreIndicator.className = 'tree-node tree-more';
                            moreIndicator.textContent = `${prefix}${isLast ? ' ' : '│'}... (${remainingCount} more)`;
                            childContainer.appendChild(moreIndicator);
                        }
                    }
                } else {
                    // 普通目录：直接渲染所有子项
                    row.addEventListener('click', (e) => {
                        e.stopPropagation();
                        childContainer.classList.toggle('hidden');
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

