/**
 * @fileoverview Patch生成提示词
 * @description 用于生成代码修改补丁的系统提示词
 */

import { THINKING_END_MARKER } from './plan-prompt.js';

/**
 * 生成Patch提示词
 * @param {string} userQuery - 用户查询/修改请求
 * @param {Array<{path: string, content: string}>} fileContents - 文件内容数组
 * @returns {string} 完整的提示词
 */
export function generatePatchPrompt(userQuery, fileContents) {
    // 构建上下文
    let context = `User Request:\n${userQuery}\n\nFiles to Modify:\n`;
    fileContents.forEach(({ path, content }) => {
        context += `\n=== ${path} ===\n${content}\n`;
    });

    return `You are a code modification assistant. Given the user's request and the file contents, generate search-replace blocks to implement the requested changes.

${context}

Please analyze the request and generate search-replace blocks. Return your response in the following JSON format:
{
  "thinking": "A brief explanation of your analysis and reasoning${THINKING_END_MARKER}",
  "searchReplaceBlocks": "=== FILE: file/path/to/file.js ===\\n<<<<<<< SEARCH\\ncode to search for\\n=======\\ncode to replace with\\n>>>>>>> REPLACE\\n\\n=== FILE: another/file.js ===\\n<<<<<<< SEARCH\\n...\\n=======\\n...\\n>>>>>>> REPLACE"
}

Important: After the thinking content, you MUST include the marker "${THINKING_END_MARKER}" before the closing quote of the thinking field. This marker signals the end of the thinking content.

Return ONLY valid JSON, no additional text or markdown formatting. The searchReplaceBlocks field should contain the search-replace blocks in the format shown above.`;
}
