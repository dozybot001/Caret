/**
 * @fileoverview 会话历史
 * @description 按项目保存对话，只存在这个浏览器里，隔离由浏览器用户和站点提供
 */

import { HISTORY_CONSTANTS } from '../global/constants.js';

const { MAX_SESSIONS, TITLE_CHARS, SAVE_DELAY } = HISTORY_CONSTANTS;

const createId = prefix => `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;

/**
 * 会话历史
 * @class SessionHistory
 */
export class SessionHistory {
    /**
     * @param {Object} store - 需要提供 listProjects、saveProject、listSessions、getSessionData、saveSession、deleteSessions
     */
    constructor(store) {
        this.store = store;
        this.projectId = null;
        /** 当前会话的基本信息，还没有发送消息时为 null */
        this.current = null;
        this.pendingSnapshot = null;
        this.timer = null;
        this.isUnsaved = false;
        this.onError = null;
    }

    get currentId() {
        return this.current?.id ?? null;
    }

    /**
     * 打开项目。同一个文件夹用 isSameEntry 判断，名字相同的不同文件夹互不影响
     * @param {FileSystemDirectoryHandle} handle - 项目文件夹
     */
    async openProject(handle) {
        await this.flush();
        this.current = null;
        for (const project of await this.store.listProjects()) {
            const isSame = await project.handle.isSameEntry(handle).catch(() => false);
            if (isSame) {
                this.projectId = project.id;
                return;
            }
        }
        this.projectId = createId('project');
        await this.store.saveProject({ id: this.projectId, name: handle.name, handle });
    }

    /**
     * 列出当前项目的会话，最新的在前
     * @returns {Promise<Array<Object>>}
     */
    async list() {
        if (!this.projectId) return [];
        const sessions = await this.store.listSessions();
        return sessions
            .filter(session => session.projectId === this.projectId)
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    /**
     * 第一条消息发送时创建会话，标题取自这条消息
     * @param {string} text - 用户消息
     */
    begin(text) {
        if (this.current) return;
        const now = Date.now();
        this.current = {
            id: createId('session'),
            projectId: this.projectId,
            title: text.replace(/\s+/g, ' ').trim().slice(0, TITLE_CHARS),
            createdAt: now,
            updatedAt: now
        };
        this.isUnsaved = true;
    }

    /**
     * 安排保存，连续变化时合并
     * @param {Function} getSnapshot - 返回 { messages, timeline }
     */
    schedule(getSnapshot) {
        if (!this.current) return;
        this.pendingSnapshot = getSnapshot;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), SAVE_DELAY);
    }

    /** 立刻保存待写入的内容。保存失败不影响正在进行的任务 */
    async flush() {
        clearTimeout(this.timer);
        const getSnapshot = this.pendingSnapshot;
        this.pendingSnapshot = null;
        if (!getSnapshot || !this.current) return;

        const isFirstSave = this.isUnsaved;
        try {
            this.current.updatedAt = Date.now();
            await this.store.saveSession({ ...this.current }, getSnapshot());
            this.isUnsaved = false;
            if (isFirstSave) await this._prune();
        } catch (error) {
            this.onError?.(error);
        }
    }

    /**
     * 打开一个会话
     * @param {string} id - 会话 ID
     * @returns {Promise<{messages: Array, timeline: Array}|null>}
     */
    async open(id) {
        await this.flush();
        const sessions = await this.list();
        const session = sessions.find(item => item.id === id);
        const data = session ? await this.store.getSessionData(id) : null;
        if (!data) return null;
        this.current = session;
        return data;
    }

    /** 结束当前会话，下一条消息开始新的会话 */
    async close() {
        await this.flush();
        this.current = null;
    }

    /**
     * 删除会话
     * @param {string[]} ids - 会话 ID
     */
    async remove(ids) {
        if (ids.includes(this.currentId)) {
            clearTimeout(this.timer);
            this.pendingSnapshot = null;
            this.current = null;
        }
        await this.store.deleteSessions(ids);
    }

    /** 申请持久存储，并删除超出数量的旧会话 */
    async _prune() {
        navigator.storage?.persist?.();
        const sessions = await this.list();
        const outdated = sessions.slice(MAX_SESSIONS).map(session => session.id);
        if (outdated.length > 0) await this.store.deleteSessions(outdated);
    }
}
