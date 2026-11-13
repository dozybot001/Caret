/**
 * @fileoverview 线上地址和备案号
 * @description 发布脚本从这里读取地址，生成 Caddy 配置；测试检查页面、security.txt 和 README 里的地址与这里一致。
 *
 * ## 从 caret.tenon.asia 迁来（2026-11-13 已切换）
 * 旧地址只做 301 跳转，保留 /migrate.html 给新地址迁移设置和对话。剩下两步，都在 tenon.asia 改到境外（S2）之前做：
 * 1. 安全组定下 S2 日期后，填 LEGACY_UNTIL，欢迎页提醒用户在这之前迁移
 * 2. 截止后清空 LEGACY_DOMAIN 和 LEGACY_UNTIL 再发布一次，服务器上旧地址的站点随之删除。同一次删掉迁移代码：
 *    migrate.html、migration.js、欢迎页的迁移入口和文案、legacy.Caddyfile、发布脚本里旧地址的验收、
 *    security.txt 里旧地址的 Canonical，以及对应的测试
 */

/** 线上地址 */
export const DOMAIN = 'caret.tenonai.cn';

/** 迁走之前的旧地址，只做跳转和迁移数据；迁移期结束后清空 */
export const LEGACY_DOMAIN = 'caret.tenon.asia';

/** 能从旧地址迁移的最后一天，格式 YYYY-MM-DD；还没定时为空 */
export const LEGACY_UNTIL = '';

/** 公司的 ICP 备案号和公安备案号。公安备案在 ICP 备案号下来后 30 日内办，办好之前只显示 ICP 备案号 */
export const FILING = { icp: '湘ICP备2026054319号-1', police: '' };

/** @returns {Date|null} 能从旧地址迁移的最后一天，按本地时间 */
export function legacyDeadline() {
    if (!LEGACY_UNTIL) return null;
    const [year, month, day] = LEGACY_UNTIL.split('-').map(Number);
    return new Date(year, month - 1, day);
}
