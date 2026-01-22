/**
 * @fileoverview AI消息管理器
 * @description 负责处理AI消息的发送、流式输出thinking和数据存储
 */

import { createPatchStreamHandler } from './sr-blocks-stream.js';

/**
 * Thinking结束标识符
 * @constant {string}
 */
const THINKING_END_MARKER = '<|THINKING_END|>';

/**
 * 从文本中提取JSON（处理markdown代码块）
 * @private
 * @param {string} text - 文本内容
 * @returns {string} 提取的JSON文本
 */
function extractJSONFromText(text) {
    let jsonText = text.trim();
    
    // 移除可能的markdown代码块标记
    if (jsonText.startsWith('```')) {
        // 处理 ```json 或 ``` 开头的代码块
        jsonText = jsonText.replace(/^```(?:json)?\s*/, '');
        jsonText = jsonText.replace(/\s*```$/, '');
    }
    
    return jsonText;
}

/**
 * 解析JSON响应（处理可能的markdown代码块和解析错误）
 * @private
 * @param {string} responseText - 响应文本
 * @returns {Object} 解析后的JSON对象
 * @throws {Error} 如果解析失败
 */
function parseJSONResponse(responseText) {
    try {
        const jsonText = extractJSONFromText(responseText);
        return JSON.parse(jsonText);
    } catch (error) {
        if (window.notify) {
            window.notify.alert(`Error parsing JSON response: ${error.message}`, { type: 'error' });
        }
        throw error;
    }
}

/**
 * 创建Thinking流式输出处理回调（支持实时流式输出和结束标识符检测）
 * @param {Function} onThinkingUpdate - Thinking更新回调函数 (thinkingText: string) => void
 * @returns {Function} 用于callStreamingAI的onContentUpdate回调函数 (content: string, fullText: string) => void
 */
function createThinkingStreamHandler(onThinkingUpdate) {
    let thinkingEnded = false;
    let lastThinking = '';
    
    return (content, fullText) => {
        // 如果thinking已经结束，不再处理
        if (thinkingEnded) return;
        
        // 尝试匹配thinking字段的开始位置
        const thinkingFieldMatch = fullText.match(/"thinking"\s*:\s*"/);
        if (!thinkingFieldMatch) return;
        
        // 找到thinking字段值的起始位置（在引号之后）
        const thinkingStartIndex = thinkingFieldMatch.index + thinkingFieldMatch[0].length;
        
        // 从thinking字段值的开始位置提取内容，直到遇到结束标识符或字符串结束
        let thinkingEndIndex = fullText.indexOf(THINKING_END_MARKER, thinkingStartIndex);
        
        if (thinkingEndIndex !== -1) {
            // 找到结束标识符，提取标识符之前的内容
            thinkingEnded = true;
            let thinkingText = fullText.substring(thinkingStartIndex, thinkingEndIndex);
            // 处理转义字符
            thinkingText = thinkingText.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
            
            if (thinkingText !== lastThinking) {
                lastThinking = thinkingText;
                onThinkingUpdate?.(thinkingText);
            }
        } else {
            // 未找到标识符，实时提取当前thinking内容（可能还未完整）
            // 使用正则匹配到当前位置的thinking内容（可能不完整）
            const thinkingMatch = fullText.substring(thinkingStartIndex).match(/^((?:[^"\\]|\\.)*)/);
            if (thinkingMatch && thinkingMatch[1]) {
                let thinkingText = thinkingMatch[1];
                // 处理转义字符
                thinkingText = thinkingText.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
                
                // 只有当thinking内容发生变化时才更新（实时流式输出）
                if (thinkingText !== lastThinking) {
                    lastThinking = thinkingText;
                    onThinkingUpdate?.(thinkingText);
                }
            }
        }
    };
}

/**
 * 调用流式AI API
 * @private
 * @param {Object} config - API配置
 * @param {Array<Object>} messages - 消息数组
 * @param {AbortSignal} signal - 取消信号
 * @param {Function} onContentUpdate - 内容更新回调函数 (content: string, fullText: string) => void
 * @param {Object} options - 额外选项
 * @param {number} options.temperature - 温度参数，默认0.3
 * @returns {Promise<string>} AI返回的完整响应文本
 */
async function callStreamingAI(config, messages, signal, onContentUpdate = null, options = {}) {
    const temperature = options.temperature ?? 0.3;
    // Remove trailing slash and any existing /chat/completions path
    let baseUrl = config.baseUrl.replace(/\/$/, '');
    baseUrl = baseUrl.replace(/\/chat\/completions\/?$/, '');
    const url = `${baseUrl}/chat/completions`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
            model: config.model,
            messages: messages,
            temperature: temperature,
            stream: true
        }),
        signal: signal
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} ${response.statusText}. ${errorText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    try {
        while (!signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                
                const data = line.slice(6);
                if (data === '[DONE]') continue;

                try {
                    const json = JSON.parse(data);
                    const content = json.choices?.[0]?.delta?.content;
                    if (content) {
                        fullText += content;
                        onContentUpdate?.(content, fullText);
                    }
                } catch {
                    // 忽略JSON解析错误（可能是部分数据）
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    return fullText;
}

/**
 * AI消息管理器
 * @class AIMessageManager
 */
export class AIMessageManager {
    /**
     * 构造函数
     * @param {Object} context - 上下文对象
     * @param {Object} context.store - 状态存储实例
     * @param {Object} context.chatUI - 聊天 UI 实例
     */
    constructor(context) {
        this.context = context;
    }

    /**
     * 检查API配置
     * @private
     * @param {Object} store - 状态存储实例
     * @returns {Object} API配置
     * @throws {Error} 如果配置无效
     */
    _validateConfig(store) {
        const config = store.getConfig();
        if (!config.apiKey || !config.baseUrl || !config.model) {
            throw new Error('Please configure API settings first.');
        }
        return config;
    }

    /**
     * 处理错误（统一错误处理逻辑）
     * @private
     * @param {Error} error - 错误对象
     * @param {AbortSignal} signal - 取消信号
     * @param {string} messagePrefix - 错误消息前缀
     */
    _handleError(error, signal, messagePrefix) {
        // 如果是取消错误，直接抛出
        if (error.name === 'AbortError' || signal?.aborted) {
            throw error;
        }
        if (window.notify) {
            window.notify.alert(`${messagePrefix}: ${error.message}`, { type: 'error' });
        }
        throw error;
    }

    /**
     * 发送Plan消息并处理响应
     * @param {Object} options - 选项
     * @param {string} options.modificationRequest - 修改请求
     * @param {string} options.repoMap - 仓库地图
     * @param {AbortSignal} options.signal - 取消信号
     * @param {Function} options.onThinkingUpdate - thinking更新回调函数 (thinkingText: string) => void，用于创建和更新流式消息
     * @returns {Promise<string>} 消息ID
     */
    async sendPlanMessage(options) {
        const { modificationRequest, repoMap, signal, onThinkingUpdate } = options;
        const { store } = this.context;

        const config = this._validateConfig(store);
        const messageId = `msg-${Date.now()}-${Math.random()}`;

        const prompt = `You are analyzing a code modification request. Given the modification request and the repository map, identify the relevant files that need to be reviewed or modified.

Modification Request:
${modificationRequest}

Repository Map:
${repoMap}

Please analyze the modification request and identify the relevant files. Return your response in the following JSON format:
{
  "thinking": "A brief explanation of your analysis and reasoning${THINKING_END_MARKER}",
  "relevantFiles": [
    {
      "path": "file/path/to/file.js"
    }
  ]
}

Important: After the thinking content, you MUST include the marker "${THINKING_END_MARKER}" before the closing quote of the thinking field. This marker signals the end of the thinking content.

Return ONLY valid JSON, no additional text or markdown formatting.`;

        try {
            const aiResponse = await callStreamingAI(
                config,
                [{ role: 'user', content: prompt }],
                signal,
                createThinkingStreamHandler(onThinkingUpdate)
            );

            await this._handlePlanResponse(messageId, aiResponse, store);
            return messageId;
        } catch (error) {
            this._handleError(error, signal, 'Error sending plan message');
        }
    }

    /**
     * 发送Patch消息并处理响应
     * @param {Object} options - 选项
     * @param {Array<{path: string, content: string}>} options.fileContents - 文件内容数组
     * @param {string} options.userQuery - 用户查询/修改请求
     * @param {AbortSignal} options.signal - 取消信号
     * @param {Function} options.onThinkingUpdate - thinking更新回调函数 (thinkingText: string) => void，用于创建和更新流式消息
     * @param {Function} options.onSRBlocksUpdate - searchReplaceBlocks更新回调函数 (srBlocksText: string) => void，用于流式更新SR块
     * @returns {Promise<string>} 消息ID
     */
    async sendPatchMessage(options) {
        const { fileContents, userQuery, signal, onThinkingUpdate, onSRBlocksUpdate } = options;
        const { store } = this.context;

        const config = this._validateConfig(store);
        const messageId = `msg-${Date.now()}-${Math.random()}`;

        // 构建上下文
        let context = `User Request:\n${userQuery}\n\nFiles to Modify:\n`;
        fileContents.forEach(({ path, content }) => {
            context += `\n=== ${path} ===\n${content}\n`;
        });

        const prompt = `You are a code modification assistant. Given the user's request and the file contents, generate search-replace blocks to implement the requested changes.

${context}

Please analyze the request and generate search-replace blocks. Return your response in the following JSON format:
{
  "thinking": "A brief explanation of your analysis and reasoning${THINKING_END_MARKER}",
  "searchReplaceBlocks": "=== FILE: file/path/to/file.js ===\\n<<<<<<< SEARCH\\ncode to search for\\n=======\\ncode to replace with\\n>>>>>>> REPLACE\\n\\n=== FILE: another/file.js ===\\n<<<<<<< SEARCH\\n...\\n=======\\n...\\n>>>>>>> REPLACE"
}

Important: After the thinking content, you MUST include the marker "${THINKING_END_MARKER}" before the closing quote of the thinking field. This marker signals the end of the thinking content.

Return ONLY valid JSON, no additional text or markdown formatting. The searchReplaceBlocks field should contain the search-replace blocks in the format shown above.`;

        try {
            const aiResponse = await callStreamingAI(
                config,
                [{ role: 'user', content: prompt }],
                signal,
                createPatchStreamHandler(onThinkingUpdate, onSRBlocksUpdate)
            );

            await this._handlePatchResponse(messageId, aiResponse, store);
            return messageId;
        } catch (error) {
            this._handleError(error, signal, 'Error sending patch message');
        }
    }

    /**
     * 提取thinking文本（统一方法）
     * @private
     * @param {Object} parsed - 解析后的JSON对象
     * @returns {string} thinking文本
     */
    _extractThinking(parsed) {
        if (parsed.thinking && typeof parsed.thinking === 'string') {
            return parsed.thinking.replace(THINKING_END_MARKER, '').trim();
        }
        return '';
    }

    /**
     * 处理plan类型的响应
     * @private
     * @param {string} messageId - 消息ID
     * @param {string} aiResponse - AI响应文本
     * @param {Object} store - 状态存储实例
     * @returns {Promise<void>}
     */
    async _handlePlanResponse(messageId, aiResponse, store) {
        let filePaths = [];
        let thinking = '';
        
        try {
            const parsed = parseJSONResponse(aiResponse);
            if (parsed.relevantFiles && Array.isArray(parsed.relevantFiles)) {
                filePaths = parsed.relevantFiles.map(item => item.path).filter(path => path);
            }
            thinking = this._extractThinking(parsed);
        } catch (error) {
            if (window.notify) {
                window.notify.alert(`Error parsing plan response: ${error.message}`, { type: 'error' });
            }
            // 如果解析失败，尝试从文本中提取文件路径（简单的fallback）
            filePaths = this._extractFilePathsFromText(aiResponse);
        }

        // 保存到数据库（只保存文件路径，不保存thinking，thinking已经在UI中显示）
        await store.saveChatData(messageId, {
            type: 'plan',
            data: filePaths.map(path => ({ path }))
        });

        // 保存thinking文本到聊天历史
        if (thinking) {
            await store.saveChatHistoryMessage({
                messageId: messageId,
                role: 'ai',
                text: thinking,
                type: 'plan'
            });
        }
    }

    /**
     * 处理patch类型的响应
     * @private
     * @param {string} messageId - 消息ID
     * @param {string} aiResponse - AI响应文本
     * @param {Object} store - 状态存储实例
     * @returns {Promise<void>}
     */
    async _handlePatchResponse(messageId, aiResponse, store) {
        let searchReplaceBlocks = '';
        let thinking = '';
        
        try {
            const parsed = parseJSONResponse(aiResponse);
            searchReplaceBlocks = parsed.searchReplaceBlocks || '';
            thinking = this._extractThinking(parsed);
        } catch (error) {
            if (window.notify) {
                window.notify.alert(`Error parsing patch response: ${error.message}`, { type: 'error' });
            }
        }

        // 保存到数据库（只保存searchReplaceBlocks，不保存thinking，thinking已经在UI中显示）
        await store.saveChatData(messageId, {
            type: 'patch',
            data: searchReplaceBlocks
        });

        // 保存thinking文本到聊天历史
        if (thinking) {
            await store.saveChatHistoryMessage({
                messageId: messageId,
                role: 'ai',
                text: thinking,
                type: 'patch'
            });
        }
    }

    /**
     * 从文本中提取文件路径（fallback方法）
     * @private
     * @param {string} text - 文本内容
     * @returns {Array<string>} 文件路径列表
     */
    _extractFilePathsFromText(text) {
        // 简单的正则表达式匹配文件路径模式
        const pathPattern = /["']([^"']+\.[a-zA-Z0-9]+)["']/g;
        const paths = [];
        let match;
        
        while ((match = pathPattern.exec(text)) !== null) {
            paths.push(match[1]);
        }
        
        return [...new Set(paths)]; // 去重
    }

    /**
     * 取消AI消息请求
     * @param {Object} options - 选项
     * @param {AbortController} options.abortController - AbortController实例
     * @param {Function} options.onCancel - 取消回调函数（可选），用于执行额外的清理工作
     * @param {Function} options.onButtonReset - 按钮重置回调函数（可选），用于重置按钮状态
     * @param {Function} options.onUICleanup - UI清理回调函数（可选），用于恢复UI状态（如按钮disabled状态等）
     * @returns {Promise<void>}
     */
    async cancelRequest(options) {
        const { abortController, onCancel, onButtonReset, onUICleanup } = options;
        const { chatUI } = this.context;
        
        if (!abortController || abortController.signal.aborted) {
            return;
        }
        
        // 取消请求
        abortController.abort();
        
        // 停止计时器
        if (chatUI) {
            chatUI.stopTimer();
        }
        
        // 显示警告通知
        if (window.notify) {
            window.notify.alert('Operation canceled', { type: 'warning' });
        }
        
        // 重置按钮状态（优先使用传入的回调，否则使用chatUI的回调）
        if (onButtonReset) {
            onButtonReset();
        } else if (chatUI && chatUI.onGeneratePatchCancel) {
            chatUI.onGeneratePatchCancel();
        }
        
        // 执行UI清理逻辑（恢复按钮disabled状态等）
        if (onUICleanup) {
            await onUICleanup();
        }
        
        // 执行额外的清理工作（如果有）
        if (onCancel) {
            await onCancel();
        }
    }
}
