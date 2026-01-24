/**
 * @fileoverview Patch流式处理器
 * @description 负责处理patch消息的流式输出，接续Thinking流，流式接收searchReplaceBlocks
 */

import { THINKING_END_MARKER } from './prompts/index.js';

/**
 * 创建Patch流式输出处理回调（接续Thinking流，流式接收searchReplaceBlocks）
 * @param {Function} onThinkingUpdate - Thinking更新回调函数 (thinkingText: string) => void
 * @param {Function} onSRBlocksUpdate - SearchReplaceBlocks更新回调函数 (srBlocksText: string) => void
 * @returns {Function} 用于callStreamingAI的onContentUpdate回调函数 (content: string, fullText: string) => void
 */
export function createPatchStreamHandler(onThinkingUpdate, onSRBlocksUpdate) {
    let thinkingEnded = false;
    let lastThinking = '';
    let lastSRBlocks = '';
    
    return (content, fullText) => {
        // 尝试匹配thinking字段的开始位置
        const thinkingFieldMatch = fullText.match(/"thinking"\s*:\s*"/);
        const thinkingStartIndex = thinkingFieldMatch ? thinkingFieldMatch.index + thinkingFieldMatch[0].length : -1;
        
        // 处理Thinking流
        if (!thinkingEnded && thinkingStartIndex !== -1) {
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
        }
        
        // Thinking结束后，开始处理searchReplaceBlocks流
        if (thinkingEnded) {
            // 尝试匹配searchReplaceBlocks字段的开始位置
            const srBlocksFieldMatch = fullText.match(/"searchReplaceBlocks"\s*:\s*"/);
            if (srBlocksFieldMatch) {
                // 找到searchReplaceBlocks字段值的起始位置（在引号之后）
                const srBlocksStartIndex = srBlocksFieldMatch.index + srBlocksFieldMatch[0].length;
                
                // 从searchReplaceBlocks字段值的开始位置提取内容
                // 查找字段值的结束位置（找到下一个未转义的引号，且不在字符串转义中）
                // 由于是流式输出，可能还未完整，需要实时提取当前内容
                // 使用正则匹配字符串内容（包括转义字符）
                const remainingText = fullText.substring(srBlocksStartIndex);
                const srBlocksMatch = remainingText.match(/^((?:[^"\\]|\\.)*)/);
                if (srBlocksMatch && srBlocksMatch[1]) {
                    let srBlocksText = srBlocksMatch[1];
                    // 处理转义字符：先处理反斜杠转义，再处理其他转义
                    // 注意：顺序很重要，先处理 \\ 再处理其他
                    srBlocksText = srBlocksText
                        .replace(/\\\\/g, '\u0000') // 临时替换双反斜杠
                        .replace(/\\"/g, '"')        // 处理转义的双引号
                        .replace(/\\n/g, '\n')       // 处理转义的换行符
                        .replace(/\\t/g, '\t')       // 处理转义的制表符
                        .replace(/\\r/g, '\r')       // 处理转义的回车符
                        .replace(/\u0000/g, '\\');   // 恢复双反斜杠
                    
                    // 只有当searchReplaceBlocks内容发生变化时才更新（实时流式输出）
                    if (srBlocksText !== lastSRBlocks) {
                        lastSRBlocks = srBlocksText;
                        onSRBlocksUpdate?.(srBlocksText);
                    }
                }
            }
        }
    };
}
