import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { parseGitHead, parseGitIndex, readGitStatus } from '../src/file-tree/git-status.js';

const REGULAR = 0o100644;
const gitSha = text => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex');

/** 生成索引文件，字段顺序和 git 一致 */
function gitIndexBytes(items, version = 2) {
    const entries = items.map(({ path, time = 1000, size = 0, sha = '0'.repeat(40), mode = REGULAR, flags = 0, skipWorktree = false }) => {
        const name = Buffer.from(path);
        const isExtended = version === 3 && skipWorktree;
        const head = Buffer.alloc(isExtended ? 64 : 62);
        head.writeUInt32BE(Math.floor(time / 1000), 8);
        head.writeUInt32BE((time % 1000) * 1e6, 12);
        head.writeUInt32BE(mode, 24);
        head.writeUInt32BE(size, 36);
        Buffer.from(sha, 'hex').copy(head, 40);
        head.writeUInt16BE(flags | Math.min(name.length, 0xfff) | (isExtended ? 0x4000 : 0), 60);
        if (isExtended) head.writeUInt16BE(0x4000, 62);
        const length = head.length + name.length + 1;
        return Buffer.concat([head, name, Buffer.alloc(Math.ceil(length / 8) * 8 - length + 1)]);
    });
    const header = Buffer.alloc(12);
    header.write('DIRC');
    header.writeUInt32BE(version, 4);
    header.writeUInt32BE(items.length, 8);
    return new Uint8Array(Buffer.concat([header, ...entries]));
}

/** 内存文件夹，支持 getDirectoryHandle 和 getFileHandle */
function memoryFolder(tree) {
    return {
        async getDirectoryHandle(name) {
            if (typeof tree[name] !== 'object' || tree[name] instanceof Uint8Array || tree[name].text !== undefined) throw new Error('not a directory');
            return memoryFolder(tree[name]);
        },
        async getFileHandle(name) {
            if (!(name in tree)) throw new Error('missing');
            return fileHandle(tree[name]);
        }
    };
}

const fileHandle = entry => ({ getFile: async () => (entry instanceof Uint8Array || typeof entry === 'string'
    ? new File([entry], 'file')
    : new File([entry.text], 'file', { lastModified: entry.time })) });

test('解析 Git 索引，只保留能比较的普通文件', () => {
    const longPath = `${'a/'.repeat(2100)}b.js`;
    const entries = parseGitIndex(gitIndexBytes([
        { path: 'a.js', time: 5123, size: 3, sha: 'ab'.repeat(20) },
        { path: longPath },
        { path: 'c.js' },
        { path: 'submodule', mode: 0o160000 },
        { path: 'link', mode: 0o120000 },
        { path: 'same.js', flags: 0x8000 }
    ]));
    assert.deepEqual([...entries.keys()], ['a.js', longPath, 'c.js']);
    assert.deepEqual(entries.get('a.js'), { time: 5123, size: 3, sha: 'ab'.repeat(20) });
});

test('Git 索引版本 3 跳过稀疏检出之外的文件，版本 4 不解析', () => {
    const entries = parseGitIndex(gitIndexBytes([{ path: 'a.js' }, { path: 'sparse.js', skipWorktree: true }, { path: 'c.js' }], 3));
    assert.deepEqual([...entries.keys()], ['a.js', 'c.js']);
    assert.equal(parseGitIndex(gitIndexBytes([], 4)), null);
    assert.equal(parseGitIndex(new TextEncoder().encode('not an index')), null);
});

test('从 HEAD 读出分支名', () => {
    assert.equal(parseGitHead('ref: refs/heads/feature/login\n'), 'feature/login');
    assert.equal(parseGitHead('2b5c04f32b5f52eace57583acd92035e9a8b201c\n'), '2b5c04f');
});

test('比较工作区和索引，得到修改、未跟踪和删除', async () => {
    const entry = (path, text, time) => ({ path, time, size: Buffer.byteLength(text), sha: gitSha(text) });
    const index = gitIndexBytes([
        entry('same.js', 'same', 1000),
        entry('touched.js', 'touched', 1000),
        entry('grown.js', 'old', 1000),
        entry('edited.js', 'aaa', 1000),
        entry('racy.js', 'kept', 1000),
        { path: 'smudged.js', time: 1000, size: 0, sha: gitSha('kept') },
        entry('removed.js', 'gone', 1000),
        entry('dist/app.js', 'hidden', 1000),
        entry('generated.js', 'ignored by a nested rule', 1000)
    ]);
    const root = memoryFolder({
        '.git': { HEAD: 'ref: refs/heads/main\n', index, info: { exclude: 'local-note.txt\n' } },
        'generated.js': { text: 'ignored by a nested rule', time: 1000 }
    });
    const file = (path, text, time = 1000) => ({ path, handle: fileHandle({ text, time }) });
    const files = [
        file('same.js', 'same', 1001),
        file('touched.js', 'touched', 9000),
        file('grown.js', 'longer'),
        file('edited.js', 'bbb', 9000),
        file('racy.js', 'kept'),
        file('smudged.js', 'kept'),
        file('new.js', 'new'),
        file('local-note.txt', 'skip')
    ];

    const git = await readGitStatus(root, files, ['dist']);
    assert.equal(git.branch, 'main');
    assert.deepEqual([...git.changes].sort(), [['edited.js', 'M'], ['grown.js', 'M'], ['new.js', 'U']]);
    assert.deepEqual(git.deleted, ['removed.js']);
});

test('不是 Git 仓库或无法读取时不显示 Git 状态', async () => {
    assert.equal(await readGitStatus(memoryFolder({}), [], []), null);
    assert.equal(await readGitStatus(memoryFolder({ '.git': 'gitdir: ../elsewhere' }), [], []), null);
    const version4 = memoryFolder({ '.git': { HEAD: 'ref: refs/heads/main', index: gitIndexBytes([], 4) } });
    assert.equal(await readGitStatus(version4, [], []), null);

    const fresh = memoryFolder({ '.git': { HEAD: 'ref: refs/heads/main' } });
    const git = await readGitStatus(fresh, [{ path: 'a.js', handle: fileHandle('x') }], []);
    assert.deepEqual([...git.changes], [['a.js', 'U']]);
});
