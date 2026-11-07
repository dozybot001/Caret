/**
 * @fileoverview 从旧地址迁移数据
 * @description 浏览器按域名隔离存储，换地址后读不到旧地址的设置和对话。新地址在弹出窗口里打开旧地址的
 * /migrate.html，那个页面读出旧数据，用 postMessage 只发给新地址；这里写进新地址的存储，再回一条确认，
 * 旧地址收到确认后删掉自己的数据，免得 API Key 一直留在旧域名下。
 * 文件夹授权不能跨域名转移，项目没有句柄，打开同名文件夹时由 SessionHistory 重新关联
 */

import { HISTORY_CONSTANTS, STORAGE_CONSTANTS } from './constants.js';
import { DOMAIN, LEGACY_DOMAIN } from './site.js';
import { t } from '../i18n/index.js';

/** 等待旧地址发来数据的最长时间（毫秒） */
const TIMEOUT = 30000;
/** 回发确认后，等待旧地址删完数据的最长时间（毫秒） */
const CLEAR_TIMEOUT = 15000;
/** 按服务商分开保存的设置 */
const PER_PROVIDER = ['keys', 'models', 'efforts', 'modelLists', 'modelEfforts'];

/**
 * 是否提供迁移入口：在新地址上，迁移期间，旧地址的数据还没删
 * @param {Object} config - 当前设置
 * @returns {boolean}
 */
export function canMigrate(config) {
    return Boolean(LEGACY_DOMAIN) && location.hostname === DOMAIN && !config.legacyMigrated;
}

/**
 * 打开旧地址的迁移页面，把它发来的数据写进这里，再让它删掉自己的数据。必须在点击事件里调用，否则弹出窗口会被拦截
 * @param {Object} store - AppStore
 * @returns {Promise<{count: number|null, cleared: boolean}>} 迁过来的对话数，旧地址没有数据时为 null；旧地址是否已删掉数据
 */
export function migrateFromLegacy(store) {
    const origin = `https://${LEGACY_DOMAIN}`;
    return new Promise((resolve, reject) => {
        const popup = window.open(`${origin}/migrate.html`, 'caret-migrate', 'popup,width=480,height=360');
        if (!popup) {
            reject(new Error(t('migrate.blocked')));
            return;
        }
        /** 数据已经写进这里 */
        let saved = null;
        let isImporting = false;
        const finish = (error, result) => {
            clearTimeout(timer);
            clearInterval(watcher);
            window.removeEventListener('message', onMessage);
            popup.close();
            if (error) reject(error);
            else resolve(result);
        };
        // 只接受这次打开的窗口从旧地址发来的消息
        const onMessage = async (event) => {
            if (event.origin !== origin || event.source !== popup) return;
            const type = event.data?.type;
            if (type === 'caret-migration' && !isImporting) {
                isImporting = true;
                try {
                    saved = { count: event.data.empty ? null : await importLegacyData(store, event.data) };
                } catch (error) {
                    finish(error);
                    return;
                }
                clearTimeout(timer);
                timer = setTimeout(() => finish(null, { ...saved, cleared: false }), CLEAR_TIMEOUT);
                popup.postMessage({ type: 'caret-migration-saved' }, origin);
            } else if (type === 'caret-migration-cleared' && saved) {
                finish(null, { ...saved, cleared: true });
            }
        };
        let timer = setTimeout(() => finish(new Error(t('migrate.timeout'))), TIMEOUT);
        // 用户手动关掉窗口时不再等待；数据已经写好的话照常算迁移成功
        const watcher = setInterval(() => {
            if (!popup.closed) return;
            if (saved) finish(null, { ...saved, cleared: false });
            else if (!isImporting) finish(new Error(t('migrate.closed')));
        }, 500);
        window.addEventListener('message', onMessage);
    });
}

/**
 * 把旧地址的数据写进这里。这里还没填过 Key 时整体沿用旧地址的设置和显示偏好；填过的话设置不变，
 * 只补上这里还没有 Key 的服务商，免得旧地址删掉数据后丢了 Key。对话只补这里没有的，同名项目合并到这里已有的项目
 * @param {Object} store - AppStore
 * @param {Object} data - 迁移页面发来的数据
 * @returns {Promise<number>} 迁过来的对话数
 */
export async function importLegacyData(store, data) {
    const current = store.getConfig();
    const old = data.config ?? {};
    if (!Object.values(current.keys ?? {}).some(Boolean)) {
        if (data.config) await store.updateConfig(data.config);
        if (typeof data.preferences === 'string') localStorage.setItem(STORAGE_CONSTANTS.PREFERENCES_KEY, data.preferences);
    } else {
        const missing = Object.keys(old.keys ?? {}).filter(provider => old.keys[provider] && !current.keys[provider]);
        if (missing.length) {
            const changes = Object.fromEntries(PER_PROVIDER.map(field => [field, { ...current[field] }]));
            for (const provider of missing) {
                for (const field of PER_PROVIDER) {
                    if (old[field]?.[provider] !== undefined) changes[field][provider] = old[field][provider];
                }
            }
            if (missing.includes('custom') && !current.customUrl) changes.customUrl = old.customUrl ?? '';
            await store.updateConfig(changes);
        }
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
    return count;
}
