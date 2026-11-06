/**
 * @fileoverview 线上地址和备案号
 * @description 发布脚本从这里读取地址，生成 Caddy 配置；测试检查页面、security.txt 和 README 里的地址与这里一致。
 *
 * ## 迁到 caret.tenonai.cn
 * 1. 等备案通过、安全组加好 caret.tenonai.cn 的解析。发布脚本会检查解析和未备案拦截，没就绪时不发布
 * 2. 这里把 DOMAIN 改成 caret.tenonai.cn，LEGACY_DOMAIN 填 caret.tenon.asia，填上新地址的备案号
 * 3. 同步改 index.html 的分享地址和官网链接、security.txt、README，`node --test` 检查是否一致
 * 4. 发布后新地址上线，旧地址只做 301 跳转，保留 /migrate.html 给新地址迁移设置和对话。然后通知安全组验收
 * 5. tenon.asia 改到境外之前，清空 LEGACY_DOMAIN 再发布一次，旧地址的站点随之删除
 */

/** 线上地址 */
export const DOMAIN = 'caret.tenon.asia';

/** 迁走之前的旧地址，只做跳转和迁移数据；不在迁移期间时为空 */
export const LEGACY_DOMAIN = '';

/**
 * 每个地址的 ICP 备案号和公安备案号。caret.tenonai.cn 用公司的备案号，备案通过后填写；
 * 公安备案在新的 ICP 备案号下来后 30 日内办，办好之前只显示 ICP 备案号
 */
export const FILINGS = {
    'caret.tenon.asia': { icp: '湘ICP备2026031578号-1', police: '43132202001134' },
    'caret.tenonai.cn': { icp: '', police: '' }
};

/**
 * 页面要显示的备案号，本地开发时按线上地址显示
 * @param {string} hostname - 页面的主机名
 * @returns {{icp: string, police: string}}
 */
export function filingOf(hostname) {
    return FILINGS[hostname] ?? FILINGS[DOMAIN];
}
