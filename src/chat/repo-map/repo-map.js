/**
 * @fileoverview Repo Map 生成器
 * @description 基于 TreeSitter 解析生成项目代码骨架与结构映射
 * 支持 JavaScript、HTML、CSS 三种语言
 * 
 * @module repo-map
 */

import { LANGUAGE_REGISTRY } from './language-config.js';
import { isIgnored, parseIgnoreFile } from '../../file-tree/ignore-manager.js';

// Worker-based implementation
let worker = null;
let workerReady = false;

/**
 * 代码结构提取辅助函数（仅用于 JavaScript）
 */

/**
 * 检查节点是否在函数/方法内部（需要过滤的噪音）
 * @param {Object} node - TreeSitter 节点
 * @returns {boolean} 如果在函数/方法内部返回 true
 */
function isInsideFunction(node) {
    let parent = node.parent;
    while (parent) {
        const type = parent.type;
        // 如果在 statement_block 或 block 内部，检查是否在函数中
        if (type === 'statement_block' || type === 'block') {
            // 继续向上查找，看是否在函数中
            let funcParent = parent.parent;
            while (funcParent) {
                const funcType = funcParent.type;
                if (funcType === 'function_declaration' || funcType === 'function_expression' || 
                    funcType === 'arrow_function') {
                    return true;
                }
                // 如果在类体中，不是函数内部（类方法是正常的）
                if (funcType === 'class_body') {
                    return false;
                }
                funcParent = funcParent.parent;
            }
        }
        // 如果在函数表达式或箭头函数中（但不是类方法）
        if (type === 'function_declaration' || type === 'function_expression' || type === 'arrow_function') {
            // 检查是否在类体中
            let classParent = parent.parent;
            while (classParent) {
                if (classParent.type === 'class_body') {
                    // 在类体中，不是函数内部
                    return false;
                }
                classParent = classParent.parent;
            }
            return true;
        }
        parent = parent.parent;
    }
    return false;
}

/**
 * 检查是否是顶级声明（文件级别）
 * @param {Object} node - TreeSitter 节点
 * @returns {boolean} 如果是顶级声明返回 true
 */
function isTopLevel(node) {
    let parent = node.parent;
    while (parent) {
        const type = parent.type;
        if (type === 'program' || type === 'module') {
            return true;
        }
        // 如果在函数/类/接口内部，不是顶级
        if (
            type === 'function_declaration' ||
            type === 'function_expression' ||
            type === 'arrow_function' ||
            type === 'method_definition' ||
            type === 'class_body' ||
            type === 'statement_block' ||
            type === 'block'
        ) {
            return false;
        }
        parent = parent.parent;
    }
    return false;
}

/**
 * 计算对象属性的数量
 * @param {Object} node - TreeSitter 节点
 * @returns {number} 属性数量
 */
function countObjectProperties(node) {
    if (!node) return 0;
    
    let count = 0;
    const countProperties = (n) => {
        if (!n) return;
        
        if (n.type === 'object') {
            for (const child of n.children) {
                if (child.type === 'pair' || child.type === 'shorthand_property_identifier') {
                    count++;
                }
            }
        } else {
            for (const child of n.children) {
                countProperties(child);
            }
        }
    };
    
    countProperties(node);
    return count;
}

/**
 * 格式化捕获节点，提取代码签名
 * @param {Object} capture - TreeSitter 捕获对象
 * @param {string} text - 节点对应的文本
 * @param {string} langId - 语言 ID（用于特殊处理）
 * @returns {string|null} 格式化后的签名，如果应跳过则返回 null
 */
function formatCaptureNode(capture, text, langId = '') {
    if (capture.name === 'name') return null;
    const node = capture.node;

    // JavaScript 处理
    // 过滤：如果是函数/方法内部的变量声明，跳过
    if (node.type === 'lexical_declaration' || node.type === 'variable_declarator') {
        // 检查是否在函数内部
        if (isInsideFunction(node)) {
            return null;
        }
    }

    // 过滤：如果不是顶级声明，跳过内部函数和变量
    if (!isTopLevel(node)) {
        // 允许类/方法定义
        const allowedTypes = ['class_declaration', 'method_definition'];
        if (!allowedTypes.includes(node.type)) {
            return null;
        }
    }
    
    // 过滤：顶级函数声明，跳过（只显示类和方法）
    if (node.type === 'function_declaration') {
        return null;
    }

    // 过滤私有方法（以 _ 开头的约定私有方法）
    if (node.type === 'method_definition') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
            const methodName = nameNode.text;
            // 过滤约定私有方法（以 _ 开头，但不包括 __ 开头的特殊方法）
            if (methodName.startsWith('_') && !methodName.startsWith('__')) {
                return null;
            }
        }
    }

    const prefix = '';
    let cutIndex = -1;

    const bodyNode = node.children.find(c =>
        c.type === 'statement_block' ||
        c.type === 'class_body' ||
        c.type === 'block'
    );

    if (bodyNode) {
        cutIndex = bodyNode.startIndex - node.startIndex;
    }
    else if (node.type === 'lexical_declaration') {
        // 处理 const/let 声明，特别是对象常量
        const declarator = node.children.find(c => c.type === 'variable_declarator');
        if (declarator) {
            const nameNode = declarator.childForFieldName('name');
            const valueNode = declarator.childForFieldName('value');
            if (nameNode && valueNode && valueNode.type === 'object') {
                // 跳过对象常量
                return null;
            }
        }
    }
    else if (node.type === 'variable_declarator') {
        const valueNode = node.childForFieldName('value');
        if (valueNode) {
            if (valueNode.type === 'arrow_function') {
                // 简化箭头函数：只显示签名，不包含完整实现
                const nameNode = node.childForFieldName('name');
                const name = nameNode ? nameNode.text : '';
                // 检查是否是方法属性（类方法）
                if (node.parent && (node.parent.type === 'method_definition' || node.parent.type === 'class_body')) {
                    // 类方法，保留完整处理
                    const arrow = valueNode.children.find(c => c.type === '=>');
                    if (arrow) {
                        cutIndex = arrow.endIndex - node.startIndex;
                    }
                } else {
                    // 普通箭头函数，只显示签名
                    const arrow = valueNode.children.find(c => c.type === '=>');
                    if (arrow) {
                        // 提取参数部分（从箭头函数的开始到 => 符号）
                        const paramNode = valueNode.childForFieldName('parameters') || valueNode.children.find(c => c.type === 'formal_parameters');
                        if (paramNode) {
                            const paramText = paramNode.text.trim();
                            return `${prefix}const ${name} = ${paramText} =>`;
                        }
                        // 如果没有参数节点，尝试从文本中提取
                        const arrowIndex = text.indexOf('=>');
                        if (arrowIndex > 0) {
                            const paramText = text.substring(0, arrowIndex).trim();
                            return `${prefix}const ${name} = ${paramText} =>`;
                        }
                    }
                }
            } else if (valueNode.type === 'object') {
                // 跳过对象字面量
                return null;
            }
        }
    }

    let signature = cutIndex !== -1 ? text.slice(0, cutIndex) : text;

    signature = signature.trim();
    if (signature.endsWith('=')) signature = signature.slice(0, -1).trim();

    const result = `${prefix}${signature}`;
    return result;
}

// JSDoc parsing cache: key = content hash, value = parsed results
const jsdocCache = new Map();
const JSDOC_CACHE_MAX_SIZE = 100;

/**
 * Simple hash function for content caching
 * @param {string} text - Content to hash
 * @returns {string} Hash string
 */
function hashContent(text) {
    let hash = 0;
    const len = Math.min(text.length, 1000); // Only hash first 1000 chars for performance
    for (let i = 0; i < len; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
}

/**
 * JSDoc 解析器 - 提取 JSDoc 注释中的文档信息
 * @param {string} text - 文件内容
 * @returns {Array<{index: number, text: string, type: string}>} 提取的文档项数组
 */
function extractJSDocComments(text) {
    // Check cache first
    const contentHash = hashContent(text);
    if (jsdocCache.has(contentHash)) {
        return jsdocCache.get(contentHash);
    }
    
    const results = [];
    
    // 匹配 JSDoc 注释块: /** ... */
    const jsdocBlockPattern = /\/\*\*([\s\S]*?)\*\//g;
    let blockMatch;
    let isFirstBlock = true;
    
    while ((blockMatch = jsdocBlockPattern.exec(text)) !== null) {
        const blockContent = blockMatch[1];
        const blockIndex = blockMatch.index;
        
        // 清理注释内容：移除每行的 * 前缀和首尾空白
        const cleanLines = blockContent.split('\n').map(line => {
            // 移除行首的空白和 * 符号
            return line.replace(/^\s*\*\s?/, '').trimEnd();
        });
        const cleanContent = cleanLines.join('\n');
        
        // 对于文件级注释（第一个块），优先提取 @fileoverview，否则提取 @description
        if (isFirstBlock) {
            isFirstBlock = false;
            
            // 提取 @fileoverview（单行，到换行或下一个标签为止）
            const fileOverviewMatch = cleanContent.match(/^@fileoverview\s+(.+?)(?=\n|$)/);
            if (fileOverviewMatch) {
                const description = fileOverviewMatch[1].trim();
                if (description) {
                    results.push({
                        index: blockIndex,
                        text: description,
                        type: 'fileoverview'
                    });
                    continue; // 文件级注释只提取 @fileoverview，不继续提取其他内容
                }
            }
            
            // 如果没有 @fileoverview，提取 @description（第一行，到换行、空行或下一个标签为止）
            const descMatch = cleanContent.match(/^@description\s+(.+?)(?=\n\s*\n|\n\s*##|\n\s*@|\n\s*$|$)/);
            if (descMatch) {
                const description = descMatch[1].trim();
                if (description) {
                    results.push({
                        index: blockIndex,
                        text: description,
                        type: 'description'
                    });
                    continue; // 文件级注释只提取 @description，不继续提取其他内容
                }
            }
            
            // 如果都没有，提取第一段文本（在第一个 @tag 或空行之前）
            const firstTextMatch = cleanContent.match(/^([^*@\n]+(?:\n(?!\s*\n|\s*@|\s*##)[^*@\n]+)*)/);
            if (firstTextMatch) {
                const description = firstTextMatch[1].trim();
                if (description && description.length > 0) {
                    results.push({
                        index: blockIndex,
                        text: description,
                        type: 'description'
                    });
                    continue;
                }
            }
        } else {
            // 对于函数/类级别的注释，合并所有信息为一行紧凑格式
            const parts = [];
            
            // 提取 @description 或第一段文本
            let description = '';
            const descMatch = cleanContent.match(/^@description\s+(.+?)(?=\n|$)/);
            if (descMatch) {
                description = descMatch[1].trim();
            } else {
                // 如果没有 @description，提取第一段文本
                const firstTextMatch = cleanContent.match(/^([^*@\n]+(?:\n(?!\s*@)[^*@\n]+)*)/);
                if (firstTextMatch) {
                    description = firstTextMatch[1].trim();
                }
            }
            
            // 提取所有 @param，合并为紧凑格式
            const params = [];
            const paramPattern = /@param\s+{([^}]+)}\s+(\w+)\s*(.+?)(?=\n\s*@|\n\s*\*\/|$)/gs;
            let paramMatch;
            while ((paramMatch = paramPattern.exec(cleanContent)) !== null) {
                const paramName = paramMatch[2];
                let paramDesc = paramMatch[3].trim();
                // 移除开头的 "- " 前缀
                paramDesc = paramDesc.replace(/^-\s*/, '');
                // 截断参数描述到合理长度（最多25字符）
                const shortDesc = paramDesc.length > 25 ? paramDesc.substring(0, 22).trim() + '...' : paramDesc;
                params.push(`${paramName}: ${shortDesc}`);
            }
            
            // 提取 @returns
            let returns = '';
            const returnsMatch = cleanContent.match(/@returns?\s+{([^}]+)}\s*(.+?)(?=\n\s*@|\n\s*\*\/|$)/s);
            if (returnsMatch && returnsMatch[2]) {
                const returnsDesc = returnsMatch[2].trim();
                if (returnsDesc) {
                    // 截断返回值描述到合理长度（最多35字符）
                    returns = returnsDesc.length > 35 ? returnsDesc.substring(0, 32).trim() + '...' : returnsDesc;
                }
            }
            
            // 构建合并后的文本：描述 + (参数) + -> 返回值
            if (description) parts.push(description);
            if (params.length > 0) {
                parts.push(`(${params.join(', ')})`);
            }
            if (returns) parts.push(`-> ${returns}`);
            
            // 只有当有内容时才添加
            if (parts.length > 0) {
                results.push({
                    index: blockIndex,
                    text: parts.join(' '),
                    type: 'description'
                });
            }
        }
    }
    
    // Cache results (with size limit)
    if (jsdocCache.size >= JSDOC_CACHE_MAX_SIZE) {
        // Remove oldest entry (first key)
        const firstKey = jsdocCache.keys().next().value;
        jsdocCache.delete(firstKey);
    }
    jsdocCache.set(contentHash, results);
    
    return results;
}

/**
 * 提取 CSS/HTML 文件的普通注释（非 JSDoc 格式）
 * @param {string} text - 文件内容
 * @param {string} fileType - 文件类型（'css' 或 'html'）
 * @returns {Array<{index: number, text: string, type: string}>} 提取的文档项数组
 */
function extractCSSHTMLComments(text, fileType) {
    const results = [];
    
    if (fileType === 'css') {
        // 匹配 CSS 注释块: /* ... */
        const cssCommentPattern = /\/\*([\s\S]*?)\*\//g;
        let blockMatch;
        let isFirstBlock = true;
        
        while ((blockMatch = cssCommentPattern.exec(text)) !== null) {
            const blockContent = blockMatch[1];
            const blockIndex = blockMatch.index;
            
            // 清理注释内容：移除每行的 * 前缀和首尾空白
            const cleanLines = blockContent.split('\n').map(line => {
                return line.replace(/^\s*\*\s?/, '').trimEnd();
            });
            const cleanContent = cleanLines.join('\n').trim();
            
            // 对于文件级注释（第一个块），提取第一段文本
            if (isFirstBlock && cleanContent.length > 0) {
                isFirstBlock = false;
                // 提取第一段文本（到第一个空行或结束）
                const firstParagraph = cleanContent.split(/\n\s*\n/)[0].trim();
                if (firstParagraph.length > 0) {
                    results.push({
                        index: blockIndex,
                        text: firstParagraph,
                        type: 'fileoverview'
                    });
                }
            }
        }
    } else if (fileType === 'html') {
        // 匹配 HTML 注释块: <!-- ... -->
        const htmlCommentPattern = /<!--([\s\S]*?)-->/g;
        let blockMatch;
        let isFirstBlock = true;
        
        while ((blockMatch = htmlCommentPattern.exec(text)) !== null) {
            const blockContent = blockMatch[1];
            const blockIndex = blockMatch.index;
            const cleanContent = blockContent.trim();
            
            // 对于文件级注释（第一个块），提取第一段文本
            if (isFirstBlock && cleanContent.length > 0) {
                isFirstBlock = false;
                // 提取第一段文本（到第一个空行或结束）
                const firstParagraph = cleanContent.split(/\n\s*\n/)[0].trim();
                if (firstParagraph.length > 0) {
                    results.push({
                        index: blockIndex,
                        text: firstParagraph,
                        type: 'fileoverview'
                    });
                }
            }
        }
    }
    
    return results;
}

let parser = null;
const LOADED_LANGUAGES = {};

/**
 * 提取文件扩展名
 * @param {string} fileName - 文件名
 * @returns {string} 扩展名（如 'js', 'html', 'css'）
 */
function getFileExtension(fileName) {
    const parts = fileName.split('.');
    return parts.pop() || '';
}

const ALLOWED_EXTENSIONS = new Set(
    Object.values(LANGUAGE_REGISTRY).flatMap(conf => conf.extensions)
);

export async function initTreeSitter() {
    try {

        const TS = window.TreeSitter;
        if (!TS) throw new Error("TreeSitter global not found. Script load failed?");

        const WASM_URL = 'https://cdn.jsdelivr.net/npm/web-tree-sitter@0.20.8/tree-sitter.wasm';
        let wasmBlobUrl = null;

        // Optimization: Try to load from Cache API first
        try {
            if (window.caches) {
                const cache = await window.caches.open('caret-wasm-cache-v1');
                let response = await cache.match(WASM_URL);
                
                if (!response) {
                    response = await fetch(WASM_URL);
                    if (response.ok) {
                        await cache.put(WASM_URL, response.clone());
                    }
                }
                
                if (response && response.ok) {
                    const blob = await response.blob();
                    wasmBlobUrl = URL.createObjectURL(blob);
                }
            }
        } catch (cacheErr) {
            // WASM Cache strategy failed, falling back to network silently
        }

        await TS.init({
            locateFile: () => wasmBlobUrl || WASM_URL
        });
        parser = new TS();

        parser.setTimeoutMicros(1000 * 1000);
    } catch (e) {
        // TreeSitter init warning, ignore silently
    }
}

async function loadLanguageParser(ext) {
    const langConfig = Object.values(LANGUAGE_REGISTRY).find(conf => conf.extensions.includes(ext));
    if (!langConfig) return null;

    // Optimization: Skip WASM load for doc-only languages
    if (langConfig.mode === 'doc-only') {
        return langConfig;
    }

    if (LOADED_LANGUAGES[langConfig.id]) {
        return langConfig;
    }

    try {
        const langObj = await window.TreeSitter.Language.load(langConfig.wasm);
        LOADED_LANGUAGES[langConfig.id] = langObj;
        return langConfig;
    } catch (err) {
        return null;
    }
}

let lastScanYieldTime = 0;

async function scanDirectoryForMap(dirHandle, prefix, parentScopes, results) {

    if (dirHandle.name === '.git') return;

    const now = performance.now();
    if (now - lastScanYieldTime > 16) {
        await new Promise(resolve => setTimeout(resolve, 0));
        lastScanYieldTime = performance.now();
    }

    let currentRules = [];
    try {
        const gitIgnoreHandle = await dirHandle.getFileHandle('.gitignore', { create: false }).catch(() => null);
        if (gitIgnoreHandle) {
            const file = await gitIgnoreHandle.getFile();
            const text = await file.text();
            currentRules = parseIgnoreFile(text);
        }
    } catch (e) {
        // Ignore .gitignore read errors
    }

    const currentScope = { basePath: prefix, rules: currentRules };
    const currentScopesStack = [...parentScopes, currentScope];

    try {
        for await (const entry of dirHandle.values()) {

            if (entry.name === '.git') continue;

            const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;

            if (isIgnored(fullPath, currentScopesStack)) continue;

            if (entry.kind === 'file') {
                const ext = getFileExtension(entry.name);

                if (ALLOWED_EXTENSIONS.has(ext)) {
                    results.push({ name: entry.name, path: fullPath, handle: entry });
                }
            } else {
                await scanDirectoryForMap(entry, fullPath, currentScopesStack, results);
            }
        }
    } catch (e) {
        // Ignore directory scan errors
    }
}

/**
 * Serialize LANGUAGE_REGISTRY by removing functions (formatter) that can't be cloned
 * @param {Object} registry - The language registry
 * @returns {Object} Serialized registry without functions
 */
function serializeLanguageRegistry(registry) {
    const serialized = {};
    for (const [key, config] of Object.entries(registry)) {
        serialized[key] = {
            id: config.id,
            wasm: config.wasm,
            extensions: config.extensions,
            query: config.query,
            mode: config.mode
        };
    }
    return serialized;
}

// Initialize Worker for parallel processing
async function initWorker() {
    if (worker && workerReady) return worker;
    
    return new Promise((resolve, reject) => {
        try {
            // Use relative path to worker file (relative to this module's location)
            worker = new Worker(new URL('./repo-map-worker.js', import.meta.url));
            
            const initTimeout = setTimeout(() => {
                reject(new Error('Worker initialization timeout'));
            }, 30000);
            
            worker.addEventListener('message', (e) => {
                const { type } = e.data;
                if (type === 'init-complete') {
                    clearTimeout(initTimeout);
                    workerReady = true;
                    resolve(worker);
                } else if (type === 'error') {
                    clearTimeout(initTimeout);
                    reject(new Error(e.data.data.message));
                }
            });
            
            worker.addEventListener('error', (error) => {
                clearTimeout(initTimeout);
                if (window.notify) {
                    window.notify.alert(`RepoMap Worker error: ${error.message}`, { type: 'error' });
                }
                reject(error);
            });
            
            // Initialize worker with serialized language registry (without functions)
            const serializedRegistry = serializeLanguageRegistry(LANGUAGE_REGISTRY);
            worker.postMessage({
                type: 'init',
                data: { languageRegistry: serializedRegistry }
            });
        } catch (error) {
            if (window.notify) {
                window.notify.alert(`Failed to create RepoMap worker: ${error.message}`, { type: 'error' });
            }
            reject(error);
        }
    });
}

// Generate Repo Map using Worker (preferred method)
async function generateRepoMapWithWorker(dirHandle, globalIgnoreRules = []) {
    // Scan files in main thread
    const files = [];
    const rootScope = { basePath: '', rules: globalIgnoreRules };
    await scanDirectoryForMap(dirHandle, "", [rootScope], files);
    
    if (files.length === 0) {
        return '';
    }
    
    // Sort by path
    files.sort((a, b) => a.path.localeCompare(b.path));
    
    // Initialize worker
    await initWorker();
    
    // Read file contents and prepare for worker
    const BATCH_SIZE = 50;
    const fileBatches = [];
    
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        const fileDataBatch = [];
        
        for (const file of batch) {
            try {
                const fileObj = await file.handle.getFile();
                const text = await fileObj.text();
                
                const fileParts = file.path.split('/');
                const fileName = fileParts.pop();
                const dirParts = fileParts;
                
                fileDataBatch.push({
                    name: fileName,
                    path: file.path,
                    text: text,
                    dirParts: dirParts
                });
            } catch (err) {
                // Failed to read file, continue silently
            }
        }
        
        if (fileDataBatch.length > 0) {
            fileBatches.push(fileDataBatch);
        }
    }
    
    // Process batches in worker
    const allOutput = [];
    let lastDirParts = [];
    
    for (let i = 0; i < fileBatches.length; i++) {
        const batch = fileBatches[i];
        
        const result = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Worker timeout'));
            }, 60000);
            
            const messageHandler = (e) => {
                const { type, data } = e.data;
                
                if (type === 'complete') {
                    clearTimeout(timeout);
                    worker.removeEventListener('message', messageHandler);
                    resolve(data);
                } else if (type === 'error') {
                    clearTimeout(timeout);
                    worker.removeEventListener('message', messageHandler);
                    reject(new Error(data.message));
                }
            };
            
            worker.addEventListener('message', messageHandler);
            
            worker.postMessage({
                type: 'process-files',
                data: {
                    files: batch,
                    lastDirParts: lastDirParts
                }
            });
        });
        
        allOutput.push(...result.output);
        lastDirParts = result.lastDirParts;
    }
    
    return allOutput.join('\n');
}

// Main export - uses Worker only
export async function generateRepoMap(dirHandle, globalIgnoreRules = []) {
    return await generateRepoMapWithWorker(dirHandle, globalIgnoreRules);
}

// Cleanup worker
export function cleanupRepoMapWorker() {
    if (worker) {
        worker.terminate();
        worker = null;
        workerReady = false;
    }
}
