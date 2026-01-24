/**
 * @fileoverview Plan生成提示词
 * @description 用于生成代码修改计划的系统提示词
 */

/**
 * Thinking结束标识符
 * @constant {string}
 */
export const THINKING_END_MARKER = '<|THINKING_END|>';

/**
 * 生成Plan提示词
 * @param {string} modificationRequest - 修改请求
 * @param {string} repoMap - 仓库地图
 * @returns {string} 完整的提示词
 */
export function generatePlanPrompt(modificationRequest, repoMap) {
    return `You are analyzing a code modification request. Given the modification request and the repository map, identify the relevant files that need to be reviewed or modified.

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
}
