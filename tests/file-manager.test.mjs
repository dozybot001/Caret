import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FileManager } from '../src/file-tree/file-manager.js';

/** 内存文件夹，支持 values() */
function directory(entries) {
    const handles = Object.entries(entries).map(([name, value]) => (typeof value === 'string'
        ? { name, kind: 'file', getFile: async () => new File([value], name) }
        : { ...directory(value), name, kind: 'directory' }));
    return { async *values() { yield* handles; } };
}

test('忽略规则优先于内置规则和 .gitignore，但放不开 .git 和 .intent', async () => {
    const manager = new FileManager();
    await manager.init();
    manager.rootDirHandle = directory({
        '.git': { config: 'x' },
        '.intent': { 'a.json': '{}' },
        '.gitignore': 'notes.md\n',
        'a.js': 'x',
        'notes.md': 'x',
        'logo.svg': '<svg/>',
        dist: { 'app.js': 'x' }
    });
    const paths = async () => (await manager.getAllFiles()).map(file => file.path).sort();

    assert.deepEqual(await paths(), ['.gitignore', 'a.js']);
    manager.setUserIgnoreRules('# 注释\na.js\n!*.svg\n!notes.md\n!dist\n!.git\n!.intent\n');
    assert.deepEqual(await paths(), ['.gitignore', 'dist/app.js', 'logo.svg', 'notes.md']);
    manager.setUserIgnoreRules('');
    assert.deepEqual(await paths(), ['.gitignore', 'a.js']);
});
