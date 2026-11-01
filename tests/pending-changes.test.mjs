import assert from 'node:assert/strict';
import { test } from 'node:test';

const bytes = text => new TextEncoder().encode(text).buffer;

/** 编辑器管理器和内存磁盘。这里只替换撤销用到的浏览器对象，不创建 Monaco */
async function undoFixture(files) {
    Object.assign(globalThis, {
        window: { matchMedia: () => ({ matches: false, addEventListener() {} }) },
        location: { search: '' },
        document: { documentElement: { dataset: {} } },
        monaco: { editor: { EndOfLinePreference: { LF: 1 } } }
    });
    const { EditorManager } = await import('../src/editor/editor-manager.js');

    const disk = new Map(Object.entries(files));
    const editor = new EditorManager(null, { addEventListener() {} });
    Object.assign(editor, { renderTabs() {}, notifyChanges() {}, present() {} });
    editor.tabState.save = async () => {};
    editor.fileManager = {
        readBytes: async path => (disk.has(path) ? bytes(disk.get(path)) : null),
        writeFile: async (path, content) => void disk.set(path, new TextDecoder().decode(content)),
        deleteFile: async path => void disk.delete(path)
    };
    const open = (path, text, original = text) => {
        const tab = {
            id: path, name: path, original, savedVersion: 1, isDirty: text !== original, isNew: false, showDiff: false, handle: {},
            model: { getValue: () => text, getAlternativeVersionId: () => 2 }
        };
        editor.tabs.push(tab);
        return tab;
    };
    return { editor, disk, open };
}

test('撤销前核对磁盘，同一文件之后又写入过时不动文件', async () => {
    const { editor, disk, open } = await undoFixture({ 'a.txt': 'three\n' });
    open('a.txt', 'three\n');
    const applied = [{ path: 'a.txt', before: bytes('one\n'), after: 'two\n' }];

    assert.deepEqual(await editor.changes.undo(applied), { conflicts: ['a.txt'] });
    assert.equal(disk.get('a.txt'), 'three\n');
    assert.deepEqual(editor.changes.list(), []);
});

test('确认撤销后恢复磁盘，后来的内容留在待写入的改动里', async () => {
    const { editor, disk, open } = await undoFixture({ 'a.txt': 'three\n' });
    open('a.txt', 'three\n');
    await editor.changes.undo([{ path: 'a.txt', before: bytes('one\n'), after: 'two\n' }], { force: true });

    assert.equal(disk.get('a.txt'), 'one\n');
    const [change] = editor.changes.list();
    assert.deepEqual([change.base, change.text], ['one\n', 'three\n']);
});

test('撤销不替换标签页里没写入的修改', async () => {
    const { editor, disk, open } = await undoFixture({ 'a.txt': 'two\r\n' });
    open('a.txt', 'two\nmine\n', 'two\n');
    assert.deepEqual(await editor.changes.undo([{ path: 'a.txt', before: bytes('one\n'), after: 'two\n' }]), {});

    assert.equal(disk.get('a.txt'), 'one\n');
    const [change] = editor.changes.list();
    assert.deepEqual([change.base, change.text], ['one\n', 'two\nmine\n']);
});

test('撤销新建的文件时删除它，内容回到待写入，文件已经不在时也不报错', async () => {
    const { editor, disk, open } = await undoFixture({ 'new.txt': 'new\n' });
    const tab = open('new.txt', 'new\n');
    const applied = [{ path: 'new.txt', before: null, after: 'new\n' }];

    assert.deepEqual(await editor.changes.undo(applied), {});
    assert.equal(disk.has('new.txt'), false);
    assert.deepEqual(editor.changes.list().map(change => [change.path, change.isNew]), [['new.txt', true]]);

    assert.deepEqual(await editor.changes.undo(applied), { conflicts: ['new.txt'] });
    assert.deepEqual(await editor.changes.undo(applied, { force: true }), {});
    assert.equal(tab.isNew, true);
});
