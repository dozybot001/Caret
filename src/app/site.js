/**
 * @fileoverview 线上地址和备案号
 * @description 发布脚本从这里读取地址，生成 Caddy 配置；测试检查页面、security.txt 和 README 里的地址与这里一致。
 */

/** 线上地址 */
export const DOMAIN = 'caret.tenonai.cn';

/** 公司的 ICP 备案号和公安备案号。公安备案号只写数字，页脚显示成「湘公网安备…号」并链接到公安备案查询 */
export const FILING = { icp: '湘ICP备2026054319号-1', police: '43010202002408' };
