import assert from 'node:assert/strict';
import { test } from 'node:test';

import { memoryStore } from './helpers.mjs';

const saved = new Map();
Object.assign(globalThis, {
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }) },
    location: { search: '', hostname: 'localhost' },
    document: { documentElement: { dataset: {} } },
    localStorage: {
        getItem: key => saved.get(key) ?? null,
        setItem: (key, value) => void saved.set(key, String(value)),
        removeItem: key => void saved.delete(key)
    }
});
const { importLegacyData } = await import('../src/app/migration.js');

/** 新地址的存储：带设置的内存存储 */
function newSite(config = {}) {
    const store = memoryStore();
    store.config = { keys: {}, ...config };
    store.getConfig = () => ({ ...store.config });
    store.updateConfig = async changes => void Object.assign(store.config, changes);
    return store;
}

/** 旧地址发来的数据：一个项目，两个对话 */
const legacy = () => ({
    config: { provider: 'kimi', keys: { kimi: 'old-key', deepseek: 'old-deepseek' }, models: { kimi: 'kimi-k2', deepseek: 'deepseek-chat' }, fontSize: 16 },
    projects: [{ id: 'project-old', name: 'app', handle: null, prompts: ['修标题', '加测试'] }],
    sessions: [
        { id: 'session-1', projectId: 'project-old', title: '修标题' },
        { id: 'session-2', projectId: 'project-old', title: '加测试' }
    ],
    sessionData: [['session-1', { messages: [1] }], ['session-2', { messages: [2] }]],
    preferences: '{"theme":"light"}'
});

test('新地址还没填 Key 时，设置、显示偏好和对话都迁过来', async () => {
    saved.clear();
    const store = newSite();
    assert.equal(await importLegacyData(store, legacy()), 2);
    assert.deepEqual([store.config.provider, store.config.keys.kimi, store.config.fontSize], ['kimi', 'old-key', 16]);
    assert.equal(saved.get('caret_preferences'), '{"theme":"light"}');
    const [project] = await store.listProjects();
    assert.deepEqual([project.id, project.handle], ['project-old', null]);
    assert.deepEqual((await store.getSessionData('session-2')).messages, [2]);
});

test('新地址已经填过 Key 时，设置不变，只补上这里没有 Key 的服务商，对话合并到同名项目', async () => {
    saved.clear();
    const store = newSite({ provider: 'deepseek', keys: { deepseek: 'new-key' } });
    await store.saveProject({ id: 'project-new', name: 'app', handle: {}, prompts: ['加测试', '改配色'] });
    await store.saveSession({ id: 'session-1', projectId: 'project-new', title: '新地址里的对话' }, { messages: ['new'] });

    assert.equal(await importLegacyData(store, legacy()), 1);
    assert.deepEqual([store.config.provider, store.config.fontSize], ['deepseek', undefined]);
    assert.deepEqual(store.config.keys, { deepseek: 'new-key', kimi: 'old-key' });
    assert.deepEqual(store.config.models, { kimi: 'kimi-k2' });
    assert.equal(saved.has('caret_preferences'), false);
    const projects = await store.listProjects();
    assert.equal(projects.length, 1);
    assert.deepEqual(projects[0].prompts, ['修标题', '加测试', '改配色']);
    const sessions = await store.listSessions();
    assert.deepEqual(sessions.map(session => [session.id, session.projectId]), [['session-1', 'project-new'], ['session-2', 'project-new']]);
    assert.deepEqual((await store.getSessionData('session-1')).messages, ['new']);
});
