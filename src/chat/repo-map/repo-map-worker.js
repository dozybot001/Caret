/**
 * @fileoverview Repo Map Worker
 * @description Web Worker 用于在后台线程执行 TreeSitter 解析
 * 支持 JavaScript、HTML、CSS 三种语言
 * 
 * @module repo-map-worker
 */

// Language registry (passed from main thread)
let LANGUAGE_REGISTRY = null;
let parser = null;
const LOADED_LANGUAGES = {};
let treeSitterInitialized = false;

/**
 * JSDoc 解析器 - 提取 JSDoc 注释中的文档信息
 * @param {string} text - 文件内容
 * @returns {Array<{index: number, text: string, type: string}>} 提取的文档项数组
 */
function extractJSDocComments(text) {
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
                    continue;
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
                    continue;
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
            const paramPattern = /@param\s+{([^}]+)}\s+(\w+)\s*(.+?)(?=\n\s*@|\n\s*\/\*\/|$)/gs;
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
            const returnsMatch = cleanContent.match(/@returns?\s+{([^}]+)}\s*(.+?)(?=\n\s*@|\n\s*\/\*\/|$)/s);
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
                const name = nameNode.text;
                // 从文本中判断是 const 还是 let
                const textStart = text.trim().toLowerCase();
                const declType = textStart.startsWith('let') ? 'let' : 'const';
                
                // 对于大型对象，直接计数并截断
                const propCount = countObjectProperties(valueNode);
                const textLength = text.length;
                const LARGE_OBJECT_THRESHOLD = 500; // 文本长度阈值
                const LARGE_PROP_COUNT = 5; // 属性数量阈值
                
                if (propCount > LARGE_PROP_COUNT || textLength > LARGE_OBJECT_THRESHOLD) {
                    return `${prefix}${declType} ${name} = { ${propCount} items }`;
                }
                
                // 对于小型对象，尝试提取属性名
                const propertyNames = [];
                const findProperties = (n) => {
                    if (!n || propertyNames.length >= 5) return;
                    if (n.type === 'object') {
                        for (const child of n.children) {
                            if (child.type === 'pair') {
                                const keyNode = child.childForFieldName('key');
                                if (keyNode) {
                                    const keyText = keyNode.text.trim().replace(/^['"]|['"]$/g, '');
                                    propertyNames.push(keyText);
                                    if (propertyNames.length >= 5) break;
                                }
                            } else if (child.type === 'shorthand_property_identifier') {
                                propertyNames.push(child.text.trim());
                                if (propertyNames.length >= 5) break;
                            }
                        }
                    } else {
                        for (const child of n.children) {
                            findProperties(child);
                        }
                    }
                };
                findProperties(valueNode);
                
                if (propertyNames.length > 0) {
                    const propsStr = propertyNames.join(', ');
                    const suffix = propCount > propertyNames.length ? ', ...' : '';
                    return `${prefix}${declType} ${name} = { ${propsStr}${suffix} }`;
                }
                return `${prefix}${declType} ${name} = {}`;
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
                const nameNode = node.childForFieldName('name');
                const name = nameNode ? nameNode.text : '';
                
                // 对于大型对象，直接计数并截断
                const propCount = countObjectProperties(valueNode);
                const textLength = text.length;
                const LARGE_OBJECT_THRESHOLD = 500; // 文本长度阈值
                const LARGE_PROP_COUNT = 5; // 属性数量阈值
                
                if (propCount > LARGE_PROP_COUNT || textLength > LARGE_OBJECT_THRESHOLD) {
                    return `${prefix}const ${name} = { ${propCount} items }`;
                }
                
                // 对于小型对象，尝试提取属性名
                const propertyNames = [];
                const findProperties = (n) => {
                    if (!n || propertyNames.length >= 5) return;
                    if (n.type === 'object') {
                        for (const child of n.children) {
                            if (child.type === 'pair') {
                                const keyNode = child.childForFieldName('key');
                                if (keyNode) {
                                    const keyText = keyNode.text.trim().replace(/^['"]|['"]$/g, '');
                                    propertyNames.push(keyText);
                                    if (propertyNames.length >= 5) break;
                                }
                            } else if (child.type === 'shorthand_property_identifier') {
                                propertyNames.push(child.text.trim());
                                if (propertyNames.length >= 5) break;
                            }
                        }
                    } else {
                        for (const child of n.children) {
                            findProperties(child);
                        }
                    }
                };
                findProperties(valueNode);
                
                if (propertyNames.length > 0) {
                    const propsStr = propertyNames.join(', ');
                    const suffix = propCount > propertyNames.length ? ', ...' : '';
                    return `${prefix}const ${name} = { ${propsStr}${suffix} }`;
                }
                return `${prefix}const ${name} = {}`;
            }
        }
    }

    let signature = cutIndex !== -1 ? text.slice(0, cutIndex) : text;

    signature = signature.trim();
    if (signature.endsWith('=')) signature = signature.slice(0, -1).trim();

    const result = `${prefix}${signature}`;
    return result;
}

/**
 * 提取文件扩展名
 * @param {string} fileName - 文件名
 * @returns {string} 扩展名（如 'js', 'html', 'css'）
 */
function getFileExtension(fileName) {
    const parts = fileName.split('.');
    return parts.pop() || '';
}

/**
 * 初始化 TreeSitter（在 Worker 中）
 */
async function ensureTreeSitterReady() {
    if (parser && treeSitterInitialized) return;
    
    try {
        // Load TreeSitter if not already loaded
        if (typeof self.TreeSitter === 'undefined') {
            // Fetch TreeSitter script and create a blob URL for importScripts
            const response = await fetch('https://unpkg.com/web-tree-sitter@0.20.8/tree-sitter.js');
            if (!response.ok) {
                throw new Error('Failed to fetch TreeSitter: HTTP ' + response.status);
            }
            const code = await response.text();
            if (!code || code.trim().length === 0) {
                throw new Error('TreeSitter script is empty');
            }
            
            // Create a blob URL and use importScripts (works in classic workers)
            const blob = new Blob([code], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            importScripts(blobUrl);
            URL.revokeObjectURL(blobUrl);
            
            // Verify TreeSitter is now available
            if (typeof self.TreeSitter === 'undefined') {
                throw new Error('TreeSitter script loaded but TreeSitter object not found on self');
            }
        }
        
        // Initialize TreeSitter (init can be called multiple times safely)
        const WASM_URL = 'https://cdn.jsdelivr.net/npm/web-tree-sitter@0.20.8/tree-sitter.wasm';
        let wasmBlobUrl = null;
        
        try {
            if (self.caches) {
                const cache = await self.caches.open('caret-wasm-cache-v1');
                let response = await cache.match(WASM_URL);
                if (!response) {
                    response = await fetch(WASM_URL);
                    if (response.ok) await cache.put(WASM_URL, response.clone());
                }
                if (response && response.ok) {
                    const blob = await response.blob();
                    wasmBlobUrl = URL.createObjectURL(blob);
                }
            }
        } catch (e) {
            // Cache error is not critical
        }
        
        if (!treeSitterInitialized) {
            await self.TreeSitter.init({ locateFile: () => wasmBlobUrl || WASM_URL });
            treeSitterInitialized = true;
        }
        
        if (!parser) {
            parser = new self.TreeSitter();
            parser.setTimeoutMicros(1000 * 1000);
        }
    } catch (err) {
        throw new Error('Failed to load TreeSitter in Worker: ' + err.message + (err.stack ? '\n' + err.stack : ''));
    }
}

/**
 * 加载语言解析器
 */
async function loadLanguageParser(ext, langConfig) {
    if (!langConfig) return null;
    
    // Skip WASM load for doc-only languages
    if (langConfig.mode === 'doc-only') {
        return langConfig;
    }
    
    if (LOADED_LANGUAGES[langConfig.id]) {
        return langConfig;
    }
    
    try {
        const langObj = await self.TreeSitter.Language.load(langConfig.wasm);
        LOADED_LANGUAGES[langConfig.id] = langObj;
        return langConfig;
    } catch (err) {
        // Failed to load language, return null silently
        return null;
    }
}

/**
 * 处理单个文件
 */
function processFile(fileData, langConfig) {
    const { name, path, text, dirParts, lastDirParts } = fileData;
    
    try {
        // File validation
        if (text.length > 300 * 1024) return null; // Skip large files
        
        // Check for binary files
        const firstChunk = text.slice(0, 512);
        if (new Uint8Array(new TextEncoder().encode(firstChunk)).some(byte => byte === 0)) {
            return null; // Skip binary files
        }
        
        const isSmallConfigFile = text.length < 10 * 1024;
        const MAX_LINE_LENGTH = 2000;
        const firstChunkText = text.slice(0, 5000);
        
        if (!isSmallConfigFile) {
            if (firstChunkText.length >= 2000 && !firstChunkText.includes('\n')) {
                return null; // Skip minified files
            }
            
            let hasLongLine = false;
            let lastNewlineIndex = -1;
            for (let j = 0; j < text.length; j++) {
                if (text[j] === '\n') {
                    if (j - lastNewlineIndex > MAX_LINE_LENGTH) {
                        hasLongLine = true;
                        break;
                    }
                    lastNewlineIndex = j;
                }
            }
            if (!hasLongLine && (text.length - lastNewlineIndex > MAX_LINE_LENGTH)) {
                hasLongLine = true;
            }
            if (hasLongLine) return null;
        }
        
        // Directory hierarchy
        const fileName = name;
        let commonDepth = 0;
        if (lastDirParts) {
            while (
                commonDepth < dirParts.length &&
                commonDepth < lastDirParts.length &&
                dirParts[commonDepth] === lastDirParts[commonDepth]
            ) {
                commonDepth++;
            }
        }
        
        const directoryLines = [];
        for (let d = commonDepth; d < dirParts.length; d++) {
            const indent = '  '.repeat(d);
            directoryLines.push(`${indent}${dirParts[d]}/`);
        }
        
        const baseIndent = '  '.repeat(dirParts.length);
        
        // Parsing logic
        let uniqueDefs = [];
        
        // Extract comments based on file type
        let docItems = [];
        if (langConfig.mode === 'doc-only') {
            // For CSS/HTML files, use plain comment extraction (not JSDoc)
            docItems = extractCSSHTMLComments(text, langConfig.id);
        } else {
            // For JavaScript files, use JSDoc extraction
            docItems = extractJSDocComments(text);
        }
        
        // Check if language uses TreeSitter (not doc-only)
        if (langConfig.mode !== 'doc-only') {
            // Full TreeSitter processing
            const langInstance = LOADED_LANGUAGES[langConfig.id];
            if (!langInstance || !parser) {
                // If parser not available, still output filename if there are doc items
                if (docItems.length > 0) {
                    uniqueDefs = docItems.map(item => item.text);
                }
            } else {
                parser.setLanguage(langInstance);
                const tree = parser.parse(text);
                
                let query = langConfig._cachedQuery;
                if (!query && langConfig.query) {
                    query = langInstance.query(langConfig.query);
                    langConfig._cachedQuery = query;
                }
                
                if (query) {
                    const captures = query.captures(tree.rootNode);
                    
                    const defItems = captures.map(c => {
                        const formatted = formatCaptureNode(c, c.node.text, langConfig.id);
                        if (!formatted) return null;
                        
                        let indent = '';
                        let parent = c.node.parent;
                        while (parent) {
                            if (parent.type === 'class_body' || parent.type === 'object') {
                                indent += '  ';
                            }
                            parent = parent.parent;
                        }
                        
                        let cleanText = formatted.replace(/\s+/g, ' ').trim();
                        if (cleanText.length > 150) {
                            cleanText = cleanText.substring(0, 147) + '...';
                        }

                        return { index: c.node.startIndex, text: `${indent}${cleanText}`, type: 'def' };
                    }).filter(Boolean);
                    
                    // 合并 JSDoc 信息和代码定义：将 JSDoc 附加到对应的函数签名后
                    const allItems = [...defItems, ...docItems].sort((a, b) => a.index - b.index);
                    const seen = new Set();
                    const matchedDefIndices = new Set(); // 记录已被 JSDoc 匹配的代码定义 index
                    const JSDOC_MAX_DISTANCE = 500; // JSDoc 和代码定义之间的最大距离（字符）
                    
                    // 构建结果：将 JSDoc 匹配到对应的代码定义
                    const mergedItems = [];
                    let i = 0;
                    while (i < allItems.length) {
                        const item = allItems[i];
                        
                        // 如果是 JSDoc（函数/类级别的注释，不是文件级注释）
                        if (item.type === 'description') {
                            // 查找下一个代码定义项（在合理距离内）
                            let matchedDef = null;
                            for (let j = i + 1; j < allItems.length; j++) {
                                const nextItem = allItems[j];
                                if (nextItem.type === 'def') {
                                    const distance = nextItem.index - item.index;
                                    if (distance <= JSDOC_MAX_DISTANCE) {
                                        matchedDef = nextItem;
                                        break;
                                    } else {
                                        // 距离太远，停止查找
                                        break;
                                    }
                                }
                            }
                            
                            if (matchedDef) {
                                // 检查是否是常量对象声明的属性注释
                                // 如果匹配的是常量对象（export const X = {），且 JSDoc 很短且没有参数/返回值标签，
                                // 则很可能是对象属性的注释，应该跳过
                                const isConstObject = /^(export\s+)?const\s+\w+\s*=\s*\{/.test(matchedDef.text);
                                if (isConstObject) {
                                    // 对象属性的注释通常很短（<50字符），且不包含 @param 或 -> 返回值
                                    const isShortComment = item.text.length < 50;
                                    const hasParamsOrReturns = item.text.includes('@param') || item.text.includes('->');
                                    
                                    // 如果注释很短且没有参数/返回值，很可能是属性注释，跳过
                                    if (isShortComment && !hasParamsOrReturns) {
                                        i++;
                                        continue;
                                    }
                                }
                                // 找到匹配的代码定义，将 JSDoc 信息附加到代码定义后
                                matchedDefIndices.add(matchedDef.index);
                                
                                // 限制总长度（函数签名 + JSDoc），如果超过阈值则截断 JSDoc
                                const MAX_LINE_LENGTH = 120;
                                let mergedText = `${matchedDef.text} // ${item.text}`;
                                if (mergedText.length > MAX_LINE_LENGTH) {
                                    const defLength = matchedDef.text.length;
                                    const availableLength = MAX_LINE_LENGTH - defLength - 4; // 4 = " // "
                                    if (availableLength > 20) {
                                        const truncatedDoc = item.text.substring(0, availableLength - 3) + '...';
                                        mergedText = `${matchedDef.text} // ${truncatedDoc}`;
                                    } else {
                                        // 如果函数签名本身就很长，不附加 JSDoc
                                        mergedText = matchedDef.text;
                                    }
                                }
                                
                                mergedItems.push({
                                    index: matchedDef.index,
                                    text: mergedText
                                });
                                // 继续下一个项
                                i++;
                            } else {
                                // 没有找到匹配的代码定义（可能是私有方法的 JSDoc），跳过
                                i++;
                            }
                        } else if (item.type === 'def') {
                            // 代码定义项
                            if (!matchedDefIndices.has(item.index)) {
                                // 没有被 JSDoc 匹配，正常输出
                                const trimmed = item.text.trim();
                                const normalized = trimmed.toLowerCase().replace(/\s+/g, ' ');
                                if (!seen.has(normalized) && trimmed.length > 0) {
                                    seen.add(normalized);
                                    mergedItems.push({ index: item.index, text: item.text });
                                }
                            }
                            i++;
                        } else {
                            // 文件级注释等，直接输出
                            const trimmed = item.text.trim();
                            const normalized = trimmed.toLowerCase().replace(/\s+/g, ' ');
                            if (!seen.has(normalized) && trimmed.length > 0) {
                                seen.add(normalized);
                                mergedItems.push({ index: item.index, text: item.text });
                            }
                            i++;
                        }
                    }
                    
                    // 按 index 排序并提取文本
                    mergedItems.sort((a, b) => a.index - b.index);
                    
                    // 去重：对于常量对象，如果同一对象出现多次（通过文本匹配），只保留第一次
                    const defTextSet = new Set();
                    const finalItems = [];
                    for (const item of mergedItems) {
                        // 提取常量对象名称（如 "export const UI_CONSTANTS"）
                        const constMatch = item.text.match(/^(export\s+)?const\s+(\w+)\s*=/);
                        if (constMatch) {
                            const constName = constMatch[2];
                            const key = `const_${constName}`;
                            if (!defTextSet.has(key)) {
                                defTextSet.add(key);
                                finalItems.push(item.text);
                            }
                            // 如果已经存在，跳过这个重复项
                        } else {
                            finalItems.push(item.text);
                        }
                    }
                    
                    uniqueDefs = finalItems;
                    
                    tree.delete();
                } else {
                    // No query available, use doc items only
                    uniqueDefs = docItems.map(item => item.text);
                }
            }
        } else {
            // Doc-only mode (should not happen now, but keep for compatibility)
            uniqueDefs = docItems.map(item => item.text);
        }
        
        // Build output - always output filename even if no content
        const outputLines = [];
        if (directoryLines.length > 0) {
            outputLines.push(...directoryLines);
        }
        
        // Always output filename, even if uniqueDefs is empty
        outputLines.push(`${baseIndent}${fileName}:`);
        if (uniqueDefs.length > 0) {
            uniqueDefs.forEach(def => {
                outputLines.push(`${baseIndent}  ${def}`);
            });
        }
        
        return {
            output: outputLines,
            dirParts: dirParts
        };
    } catch (err) {
        // Suppress parsing errors
        return null;
    }
}

// Main message handler
self.addEventListener('message', async (e) => {
    const { type, data } = e.data;
    
    try {
        switch (type) {
            case 'init': {
                // Initialize language registry
                LANGUAGE_REGISTRY = data.languageRegistry;
                
                // Initialize TreeSitter
                await ensureTreeSitterReady();
                self.postMessage({ type: 'init-complete' });
                break;
            }
            
            case 'process-files': {
                const { files, lastDirParts } = data;
                const results = [];
                let currentLastDirParts = lastDirParts || [];
                
                for (let i = 0; i < files.length; i++) {
                    const fileData = files[i];
                    const ext = getFileExtension(fileData.name);
                    const langConfig = Object.values(LANGUAGE_REGISTRY).find(
                        conf => conf.extensions.includes(ext)
                    );
                    
                    if (!langConfig) continue;
                    
                    // Ensure TreeSitter is ready
                    await ensureTreeSitterReady();
                    
                    // Load language if needed
                    const loadedConfig = await loadLanguageParser(ext, langConfig);
                    
                    if (!loadedConfig) continue;
                    
                    const result = processFile(
                        { ...fileData, dirParts: fileData.dirParts || [], lastDirParts: currentLastDirParts },
                        loadedConfig
                    );
                    
                    if (result) {
                        results.push(...result.output);
                        currentLastDirParts = result.dirParts;
                    }
                }
                
                self.postMessage({
                    type: 'complete',
                    data: { output: results, lastDirParts: currentLastDirParts }
                });
                break;
            }
            
            default:
                // Unknown message type, ignore silently
        }
    } catch (error) {
        self.postMessage({
            type: 'error',
            data: { message: error.message, stack: error.stack }
        });
    }
});
