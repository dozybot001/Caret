/**
 * @fileoverview SR块UI管理器
 * @description 负责处理searchReplaceBlocks的UI显示和更新
 */

/**
 * SR块UI管理器
 * @class SRBlocksUI
 */
export class SRBlocksUI {
    /**
     * 更新流式消息的searchReplaceBlocks内容
     * @param {HTMLElement} msgDiv - 消息元素
     * @param {string} srBlocksText - searchReplaceBlocks文本
     * @param {Function} scrollToBottom - 滚动到底部的回调函数
     */
    static updateStreamingSRBlocks(msgDiv, srBlocksText, scrollToBottom) {
        const contentDiv = msgDiv.querySelector('.message-content');
        if (!contentDiv) return;

        // 查找或创建SR块容器
        let srBlocksDiv = contentDiv.querySelector('.file-list-sr-blocks');
        if (!srBlocksDiv) {
            srBlocksDiv = this._createSRBlocksContainer();
            contentDiv.appendChild(srBlocksDiv);
        }

        // 解析并渲染SR块
        this._renderSRBlocks(srBlocksDiv, srBlocksText);
        
        if (scrollToBottom) {
            scrollToBottom();
        }
    }

    /**
     * 创建SR块容器元素
     * @private
     * @returns {HTMLElement} SR块容器元素
     */
    static _createSRBlocksContainer() {
        const srBlocksDiv = document.createElement('div');
        srBlocksDiv.className = 'file-list-sr-blocks';
        srBlocksDiv.style.marginTop = '12px';
        return srBlocksDiv;
    }

    /**
     * 解析searchReplaceBlocks文本并渲染
     * @private
     * @param {HTMLElement} container - 容器元素
     * @param {string} srBlocksText - searchReplaceBlocks文本
     */
    static _renderSRBlocks(container, srBlocksText) {
        if (!srBlocksText || !srBlocksText.trim()) {
            container.innerHTML = '';
            return;
        }

        // 解析SR块
        const files = this._parseSRBlocks(srBlocksText);
        
        // 清空容器
        container.innerHTML = '';

        // 渲染每个文件
        files.forEach((file) => {
            const fileSection = this._createFileSection(file);
            container.appendChild(fileSection);
        });
    }

    /**
     * 解析searchReplaceBlocks文本
     * @private
     * @param {string} srBlocksText - searchReplaceBlocks文本
     * @returns {Array<{path: string, blocks: Array<{search: string, replace: string}>}>} 解析后的文件数组
     */
    static _parseSRBlocks(srBlocksText) {
        const files = [];
        
        if (!srBlocksText || !srBlocksText.trim()) {
            return files;
        }
        
        // 按文件分割：=== FILE: path ===
        const fileRegex = /=== FILE:\s*(.+?)\s*===\s*\n(.*?)(?=\n=== FILE:|$)/gs;
        let match;
        
        while ((match = fileRegex.exec(srBlocksText)) !== null) {
            const filePath = match[1].trim();
            const fileContent = match[2];
            
            const blocks = [];
            
            // 查找所有SEARCH和REPLACE块
            const blockRegex = /<<<<<<< SEARCH\s*\n(.*?)\n=======\s*\n(.*?)\n>>>>>>> REPLACE/gs;
            let blockMatch;
            
            while ((blockMatch = blockRegex.exec(fileContent)) !== null) {
                const searchText = blockMatch[1];
                const replaceText = blockMatch[2];
                
                blocks.push({
                    search: searchText,
                    replace: replaceText
                });
            }
            
            if (blocks.length > 0) {
                files.push({
                    path: filePath,
                    blocks: blocks
                });
            }
        }
        
        return files;
    }

    /**
     * 创建文件区块元素
     * @private
     * @param {Object} file - 文件对象 {path: string, blocks: Array<{search: string, replace: string}>}
     * @returns {HTMLElement} 文件区块元素
     */
    static _createFileSection(file) {
        const fileSection = document.createElement('div');
        fileSection.className = 'sr-blocks-file-section';
        fileSection.style.marginBottom = '16px';

        // 文件名
        const fileName = document.createElement('div');
        fileName.className = 'sr-blocks-file-name';
        fileName.textContent = file.path;
        fileName.style.fontFamily = "'Maple Mono', monospace";
        fileName.style.fontSize = '12px';
        fileName.style.color = 'var(--text-2)';
        fileName.style.marginBottom = '8px';
        fileName.style.fontWeight = 'bold';
        fileSection.appendChild(fileName);

        // 渲染每个SEARCH/REPLACE块
        file.blocks.forEach((block) => {
            // SEARCH块（删除的内容，红色背景）
            // 即使为空也显示（可能是删除空行的情况）
            const searchBlock = this._createCodeBlock(block.search, 'search');
            fileSection.appendChild(searchBlock);

            // REPLACE块（添加的内容，绿色背景）
            // 即使为空也显示（可能是添加空行的情况）
            const replaceBlock = this._createCodeBlock(block.replace, 'replace');
            fileSection.appendChild(replaceBlock);
        });

        return fileSection;
    }

    /**
     * 创建代码块元素
     * @private
     * @param {string} content - 代码内容
     * @param {string} type - 类型：'search' 或 'replace'
     * @returns {HTMLElement} 代码块元素
     */
    static _createCodeBlock(content, type) {
        const codeBlock = document.createElement('div');
        codeBlock.className = `sr-blocks-code-block sr-blocks-code-block-${type}`;
        
        // 基础样式
        codeBlock.style.fontFamily = "'Maple Mono', monospace";
        codeBlock.style.fontSize = '12px';
        codeBlock.style.padding = '8px';
        codeBlock.style.whiteSpace = 'pre-wrap';
        codeBlock.style.wordBreak = 'break-word';
        codeBlock.style.marginBottom = '4px';
        
        // 根据类型设置背景色
        if (type === 'search') {
            codeBlock.style.backgroundColor = 'var(--bg-red-dim)';
        } else {
            codeBlock.style.backgroundColor = 'var(--bg-green-dim)';
        }
        
        codeBlock.textContent = content;
        
        return codeBlock;
    }
}
