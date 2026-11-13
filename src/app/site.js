/**
 * @fileoverview 线上地址和备案号
 * @description 发布脚本从这里读取地址，生成 Caddy 配置；测试检查页面、security.txt 和 README 里的地址与这里一致。
 *
 * ## 迁到 caret.tenonai.cn
 * 1. 等备案通过、安全组加好 caret.tenonai.cn 的解析。发布脚本会检查解析和未备案拦截，没就绪时不发布
 * 2. 切换前先把 NEXT_DOMAIN 填成 caret.tenonai.cn 发布：两个地址提供同样的页面，新地址先签好证书，交安全组核对。
 *    证书签不下来不要反复发布（同一地址每小时最多失败 5 次），告诉安全组
 * 3. 切换：DOMAIN 改成 caret.tenonai.cn，LEGACY_DOMAIN 填 caret.tenon.asia，NEXT_DOMAIN 清空
 * 4. 同步改各页面的分享图地址、index.html 的分享地址和官网链接、security.txt、README，`node --test` 检查是否一致
 * 5. 发布后旧地址只做 301 跳转，保留 /migrate.html 给新地址迁移设置和对话。然后通知安全组验收
 * 6. 定下 tenon.asia 改到境外的日期后，填 LEGACY_UNTIL，欢迎页提醒用户在这之前迁移
 * 7. tenon.asia 改到境外之前，清空 LEGACY_DOMAIN 和 LEGACY_UNTIL 再发布一次，旧地址的站点随之删除
 */

/** 线上地址 */
export const DOMAIN = 'caret.tenon.asia';

/** 切换前先上线的新地址：页面和线上地址相同，证书先签好；切换时改成 DOMAIN，这里清空 */
export const NEXT_DOMAIN = 'caret.tenonai.cn';

/** 迁走之前的旧地址，只做跳转和迁移数据；不在迁移期间时为空 */
export const LEGACY_DOMAIN = '';

/** 能从旧地址迁移的最后一天，格式 YYYY-MM-DD；还没定时为空 */
export const LEGACY_UNTIL = '';

/**
 * 每个地址的 ICP 备案号和公安备案号。caret.tenonai.cn 用公司的 ICP 备案号；
 * 公安备案在新的 ICP 备案号下来后 30 日内办，办好之前只显示 ICP 备案号
 */
export const FILINGS = {
    'caret.tenon.asia': { icp: '湘ICP备2026031578号-1', police: '43132202001134' },
    'caret.tenonai.cn': { icp: '湘ICP备2026054319号-1', police: '' }
};

/**
 * 页面要显示的备案号，本地开发时按线上地址显示
 * @param {string} hostname - 页面的主机名
 * @returns {{icp: string, police: string}}
 */
export function filingOf(hostname) {
    return FILINGS[hostname] ?? FILINGS[DOMAIN];
}

/** @returns {Date|null} 能从旧地址迁移的最后一天，按本地时间 */
export function legacyDeadline() {
    if (!LEGACY_UNTIL) return null;
    const [year, month, day] = LEGACY_UNTIL.split('-').map(Number);
    return new Date(year, month - 1, day);
}
