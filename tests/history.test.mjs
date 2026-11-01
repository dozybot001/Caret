import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SessionHistory } from '../src/chat/history.js';
import { folder, memoryStore } from './helpers.mjs';

test('历史记录按文件夹隔离，同名的不同文件夹互不影响', async () => {
    const history = new SessionHistory(memoryStore());
    const a = folder('app', 'a');
    const b = folder('app', 'b');

    await history.openProject(a);
    history.begin('第一个  项目\n的任务');
    history.schedule(() => ({ messages: [1], timeline: [] }));
    await history.flush();

    await history.openProject(b);
    assert.deepEqual(await history.list(), []);
    assert.equal(history.currentId, null);

    await history.openProject(a);
    const [session] = await history.list();
    assert.equal(session.title, '第一个 项目 的任务');
    assert.deepEqual((await history.open(session.id)).messages, [1]);
    assert.equal(history.currentId, session.id);
});

test('历史记录合并连续保存，继续对话时更新同一条记录', async () => {
    const store = memoryStore();
    const history = new SessionHistory(store);
    await history.openProject(folder('app'));
    history.begin('任务');

    for (const step of [1, 2, 3]) history.schedule(() => ({ messages: [step], timeline: [] }));
    await history.flush();
    assert.equal(store.data.size, 1);
    assert.deepEqual([...store.data.values()][0].messages, [3]);

    history.begin('不会覆盖标题');
    history.schedule(() => ({ messages: [4], timeline: [] }));
    await history.flush();
    assert.equal(store.data.size, 1);
    assert.equal((await history.list())[0].title, '任务');
});

test('历史记录只保留最新的 100 条，删除当前会话后不再写入', async () => {
    const store = memoryStore();
    const history = new SessionHistory(store);
    await history.openProject(folder('app'));

    for (let index = 0; index < 103; index++) {
        await history.close();
        history.begin(`任务 ${index}`);
        history.schedule(() => ({ messages: [], timeline: [] }));
        await history.flush();
    }
    const sessions = await history.list();
    assert.equal(sessions.length, 100);
    assert.ok(sessions.some(session => session.title === '任务 102'));

    const { currentId } = history;
    history.schedule(() => ({ messages: ['late'], timeline: [] }));
    await history.remove([currentId]);
    await history.flush();
    assert.equal(store.data.has(currentId), false);
    assert.equal(history.currentId, null);
});

test('保存失败不影响任务，错误交给界面提示', async () => {
    const store = memoryStore();
    store.saveSession = async () => { throw new Error('quota'); };
    const history = new SessionHistory(store);
    const errors = [];
    history.onError = error => errors.push(error.message);
    await history.openProject(folder('app'));
    history.begin('任务');
    history.schedule(() => ({ messages: [], timeline: [] }));
    await history.flush();
    assert.deepEqual(errors, ['quota']);
});

test('提示词按项目保存，重复的只留最新一条', async () => {
    const store = memoryStore();
    const history = new SessionHistory(store);
    const a = folder('a');
    await history.openProject(a);
    for (const text of ['一', '二', '一']) history.rememberPrompt(text);
    assert.deepEqual(history.prompts(), ['二', '一']);

    await history.openProject(folder('b'));
    assert.deepEqual(history.prompts(), []);
    await history.openProject(a);
    assert.deepEqual(history.prompts(), ['二', '一']);
});

test('取消授权后不再保存句柄，对话记录保留，同名文件夹可以接上', async () => {
    const store = memoryStore();
    const history = new SessionHistory(store);
    await history.openProject(folder('app', 'a'));
    history.begin('任务');
    history.schedule(() => ({ messages: [1], timeline: [] }));
    await history.flush();
    history.rememberPrompt('任务');

    await history.releaseProject();
    assert.equal(history.projectId, null);
    assert.equal(history.currentId, null);
    assert.deepEqual(await history.list(), []);
    assert.equal((await store.listProjects())[0].handle, null);

    await history.openProject(folder('other', 'b'));
    assert.deepEqual(await history.list(), []);

    const reopened = folder('app', 'c');
    await history.openProject(reopened);
    assert.equal((await history.list()).length, 1);
    assert.deepEqual(history.prompts(), ['任务']);
    assert.equal((await store.listProjects()).find(project => project.name === 'app').handle, reopened);
});

test('关闭保存后不写入新的对话和提示词，已有记录保留', async () => {
    const store = memoryStore();
    const history = new SessionHistory(store);
    await history.openProject(folder('app'));
    history.begin('保留的任务');
    history.schedule(() => ({ messages: [1], timeline: [] }));
    await history.flush();
    history.rememberPrompt('保留的任务');

    history.isEnabled = false;
    await history.close();
    history.begin('不保存的任务');
    history.schedule(() => ({ messages: [2], timeline: [] }));
    await history.flush();
    history.rememberPrompt('不保存的任务');

    assert.deepEqual((await history.list()).map(session => session.title), ['保留的任务']);
    assert.deepEqual(history.prompts(), ['保留的任务']);
});

test('清空全部对话时包括所有项目的提示词，当前对话不再写入', async () => {
    const store = memoryStore();
    const history = new SessionHistory(store);
    const other = folder('other');
    await history.openProject(other);
    history.rememberPrompt('另一个项目');
    await history.openProject(folder('app'));
    history.begin('任务');
    history.rememberPrompt('任务');
    history.schedule(() => ({ messages: [1], timeline: [] }));

    await history.clearAll();
    await history.flush();
    assert.equal(history.currentId, null);
    assert.equal(store.data.size, 0);
    assert.deepEqual(history.prompts(), []);
    await history.openProject(other);
    assert.deepEqual(history.prompts(), []);
});
