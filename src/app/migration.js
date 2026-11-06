/**
 * @fileoverview 从旧地址迁移数据
 * @description 浏览器按域名隔离存储，换地址后读不到旧地址的设置和对话。新地址在弹出窗口里打开旧地址的
 * /migrate.html，那个页面读出旧数据，用 postMessage 只发给新地址，这里再写进新地址的存储。
 * 文件夹授权不能跨域名转移，项目没有句柄，打开同名文件夹时由 SessionHistory 重新关联
 */

import { HISTORY_CONSTANTS, STORAGE_CONSTANTS } from './constants.js';
import { DOMAIN, LEGACY_DOMAIN } from './site.js';
import { t } from '../i18n/index.js';

/** 等待旧地址回应的最长时间（毫秒） */
const TIMEOUT = 30000;

/**
 * 是否提供迁移入口：在新地址上，迁移期间，还没有迁移过
 * @param {Object} config - 当前设置
 * @returns {boolean}
 */
export function canMigrate(config) {
    return Boolean(LEGACY_DOMAIN) && location.hostname === DOMAIN && !config.legacyMigrated;
}

/**
 * 打开旧地址的迁移页面，等它发回数据。必须在点击事件里调用，否则弹出窗口会被拦截
 * @returns {Promise<Object|null>} 旧地址的数据，没有数据时为 null
 */
export function fetchLegacyData() {
    const origin = `https://${LEGACY_DOMAIN}`;
    return new Promise((resolve, reject) => {
        const popup = window.open(`${origin}/migrate.html`, 'caret-migrate', 'popup,width=480,height=360');
        if (!popup) {
            reject(new Error(t('migrate.blocked')));
            return;
        }
        const finish = (error, data = null) => {
            clearTimeout(timer);
            clearInterval(watcher);
            window.removeEventListener('message', onMessage);
            popup.close();
            if (error) reject(error);
            else resolve(data);
        };
        // 只接受这次打开的窗口从旧地址发来的消息
        const onMessage = (event) => {
            if (event.origin !== origin || event.source !== popup || event.data?.type !== 'caret-migration') return;
            finish(null, event.data.empty ? null : event.data);
        };
        const timer = setTimeout(() => finish(new Error(t('migrate.timeout'))), TIMEOUT);
        const watcher = setInterval(() => {
            if (popup.closed) finish(new Error(t('migrate.closed')));
        }, 500);
        window.addEventListener('message', onMessage);
    });
}

/**
 * 把旧地址的数据写进这里。这里还没填过 Key 时整体沿用旧地址的设置和显示偏好，填过的话设置不变；
 * 对话只补这里没有的，同名项目合并到这里已有的项目
 * @param {Object} store - AppStore
 * @param {Object} data - 迁移页面发来的数据
 * @returns {Promise<number>} 迁过来的对话数
 */
export async function importLegacyData(store, data) {
    const hasKey = Object.values(store.getConfig().keys ?? {}).some(Boolean);
    if (!hasKey) {
        if (data.config) await store.updateConfig(data.config);
        if (typeof data.preferences === 'string') localStorage.setItem(STORAGE_CONSTANTS.PREFERENCES_KEY, data.preferences);
    }

    const projects = await store.listProjects();
    /** 旧项目 ID → 这里同名项目的 ID */
    const merged = new Map();
    for (const project of data.projects ?? []) {
        const index = projects.findIndex(item => item.name === project.name);
        if (index < 0) {
            await store.saveProject({ ...project, handle: null });
            continue;
        }
        const same = projects[index];
        const prompts = [...(project.prompts ?? []), ...(same.prompts ?? [])];
        projects[index] = {
            ...same,
            prompts: prompts.filter((text, at) => prompts.lastIndexOf(text) === at).slice(-HISTORY_CONSTANTS.MAX_PROMPTS)
        };
        merged.set(project.id, same.id);
        await store.saveProject(projects[index]);
    }

    const existing = new Set((await store.listSessions()).map(session => session.id));
    const contents = new Map(data.sessionData ?? []);
    let count = 0;
    for (const session of data.sessions ?? []) {
        if (existing.has(session.id) || !contents.has(session.id)) continue;
        await store.saveSession({ ...session, projectId: merged.get(session.projectId) ?? session.projectId }, contents.get(session.id));
        count++;
    }

    await store.updateConfig({ legacyMigrated: true });
    return count;
}
