/**
 * @fileoverview 运行结果的说明
 * @description 把 Agent 的运行结果和错误转成用户能看懂的文案
 * @module run-messages
 */

import { isContextError } from '../agent/model.js';
import { t } from '../i18n/index.js';

/** 运行没有正常完成时显示的说明 */
export const RUN_NOTES = { stopped: 'chat.stopped', truncated: 'chat.truncated', filtered: 'chat.filtered' };

/**
 * 把错误转成用户能处理的说明
 * @param {Error} error - 错误
 * @returns {Function} 返回当前语言的文案
 */
export function describeError(error) {
    const { status, code, name, message } = error;
    if (code === 'too-many-steps') return () => t('error.steps');
    if (code === 'output-limit') return () => t('error.outputLimit');
    if (code === 'content-filter') return () => t('error.contentFilter');
    if (status === 401 || status === 403) return () => t('error.auth');
    if (status === 402 || status === 429) return () => t('error.rate');
    if (isContextError(error)) return () => t('error.long');
    if (status) return () => t('error.http', status, message);
    if (name === 'NotAllowedError') return () => t('error.permission');
    if (name === 'TypeError') return () => t('error.network');
    return () => t('error.generic', message);
}
