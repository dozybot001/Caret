/**
 * @fileoverview 构建号
 * @description 发布脚本用 git archive 打包，.gitattributes 让它把占位符换成提交号；本地运行时保持占位符
 */

/** 发布的提交号，本地运行时是占位符 */
const COMMIT = '$Format:%H$';

/** 关于页显示的构建号：提交号的前 7 位，本地运行时为空 */
export const BUILD = /^[0-9a-f]{40}$/.test(COMMIT) ? COMMIT.slice(0, 7) : '';
