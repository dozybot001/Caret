import assert from 'node:assert/strict';
import { test } from 'node:test';

import { countChanges } from '../src/agent/diff.js';
import { normalizePath, outline, replaceText, TOOL_SCHEMAS } from '../src/agent/tools.js';
import { run, workspace } from './helpers.mjs';

test('只提供 read、write、edit 三个工具', () => {
    assert.deepEqual(TOOL_SCHEMAS.map(tool => tool.function.name), ['read', 'write', 'edit']);
});

test('edit 要求唯一匹配，多处命中时不修改文件', async () => {
    const source = 'function a() {\n  return 1;\n}\nfunction b() {\n  return 1;\n}\n';
    const ws = workspace({ 'a.js': source });
    const result = await run(ws, 'edit', { path: 'a.js', old: '  return 1;', new: '  return 2;' });
    assert.equal(result.ok, false);
    assert.match(result.output, /matches 2 places \(lines 2, 5\)/);
    assert.equal(ws.state.get('a.js'), source);
});

test('edit 不会改到子串：短文本同时命中两处时被拒绝', () => {
    const result = replaceText('const total_count = 1;\nconst count = 2;\n', 'count', 'n');
    assert.match(result.error, /matches 2 places/);
});

test('edit 没有匹配时告诉模型相近的位置', () => {
    const result = replaceText('    foo();\n    bar();\n', 'foo();\n  bar();', 'baz();');
    assert.match(result.error, /first line appears at:\n1:     foo\(\);/);
});

test('edit 用 all 替换全部，并接受 CRLF 输入', async () => {
    assert.equal(replaceText('a a a', 'a', 'b', true).text, 'b b b');
    assert.equal(replaceText('x\ny\n', 'x\r\ny', 'z').text, 'z\n');
});

test('read 能读取文件、分页、列目录和搜索', async () => {
    const ws = workspace({ 'src/a.js': 'const timeout = 30;\nconst Name = 1;\n', 'src/b.js': 'TIMEOUT\n', 'README.md': '# Demo\n' });

    assert.equal((await run(ws, 'read', { path: 'README.md' })).output, '# Demo\n');
    assert.match((await run(ws, 'read', { path: 'src/a.js', offset: 2, limit: 1 })).output, /^const Name = 1;\n\n\[Showing lines 2-2 of 3/);
    assert.equal((await run(ws, 'read', { path: 'src' })).output, 'a.js\nb.js');
    assert.equal((await run(ws, 'read', {})).verb, 'list');

    const insensitive = await run(ws, 'read', { pattern: 'timeout' });
    assert.equal(insensitive.verb, 'search');
    assert.equal(insensitive.output, 'src/a.js:1: const timeout = 30;\nsrc/b.js:1: TIMEOUT');

    assert.equal((await run(ws, 'read', { pattern: 'TIMEOUT' })).output, 'src/b.js:1: TIMEOUT');
    assert.equal((await run(ws, 'read', { path: 'src/a.js', pattern: 'Name' })).output, 'src/a.js:2: const Name = 1;');
    assert.equal((await run(ws, 'read', { pattern: '(unclosed' })).output, 'No matches.');
});

test('密钥文件不读取、不修改、不进入搜索结果', async () => {
    const ws = workspace({ '.env': 'SECRET=1\n', 'deploy/server.pem': 'SECRET', '.env.example': 'SECRET=\n' });
    const read = await run(ws, 'read', { path: '.env' });
    assert.equal(read.ok, false);
    assert.doesNotMatch(read.output, /SECRET=1/);
    assert.equal((await run(ws, 'edit', { path: '.env', old: '1', new: '2' })).ok, false);
    assert.equal((await run(ws, 'write', { path: 'a.pem', content: 'x' })).ok, false);
    assert.equal((await run(ws, 'read', { pattern: 'SECRET' })).output, '.env.example:1: SECRET=');
    assert.equal((await run(ws, 'read', { path: '.env.example' })).ok, true);
});

test('更多密钥文件不读取，示例文件和公钥不受影响', async () => {
    const secrets = [
        '.git-credentials', '.envrc', '.dev.vars', '.pgpass', '.htpasswd', 'terraform.tfvars', 'prod.auto.tfvars', 'terraform.tfstate',
        'secrets.yaml', 'secrets.json', 'config/secrets.yml', 'service-account.json', 'deploy/my-service_account-key.json',
        '.docker/config.json', '.kube/config', 'keystore.jks', 'vault.kdbx', 'AuthKey_ABC.p8', 'HOME/.NETRC', '_netrc'
    ];
    const ws = workspace(Object.fromEntries(secrets.map(path => [path, 'SECRET'])));
    for (const path of secrets) {
        assert.equal((await run(ws, 'read', { path })).ok, false, path);
        assert.equal((await run(ws, 'edit', { path, old: 'SECRET', new: 'x' })).ok, false, path);
    }
    assert.equal((await run(ws, 'read', { pattern: 'SECRET' })).output, 'No matches.');

    const safe = ['.env.example', '.dev.vars.example', 'id_ed25519.pub', 'secrets.example.yaml', 'docker/config.json', 'src/config.json', 'kube/config'];
    const open = workspace(Object.fromEntries(safe.map(path => [path, 'text'])));
    for (const path of safe) assert.equal((await run(open, 'read', { path })).ok, true, path);
});

test('任意层级的 .git 和 .intent 都不开放，不区分大小写', async () => {
    for (const path of ['.GIT/config', '.Git/hooks/pre-commit', 'packages/app/.git/config', 'vendor/lib/.git/hooks/pre-commit', 'a/.intent/x', 'a/.INTENT/x']) {
        assert.throws(() => normalizePath(path), /directory is not available/, path);
    }
    assert.equal(normalizePath('.gitignore'), '.gitignore');
    assert.equal(normalizePath('.github/workflows/ci.yml'), '.github/workflows/ci.yml');
    assert.equal((await run(workspace({ 'a/.git/config': 'x' }), 'read', { path: 'a/.git/config' })).ok, false);
});

test('路径限制在项目内', async () => {
    assert.equal(normalizePath('./src//a.js'), 'src/a.js');
    assert.equal(normalizePath('/src/a.js'), 'src/a.js');
    assert.equal(normalizePath('src\\a.js'), 'src/a.js');
    assert.throws(() => normalizePath('../secret'));
    assert.throws(() => normalizePath('.git/config'));
    assert.throws(() => normalizePath('.intent/snaps/a.json'));
    assert.equal((await run(workspace(), 'read', { path: '../secret' })).ok, false);
    assert.equal((await run(workspace(), 'write', { path: '.intent/intents/a.json', content: '{}' })).ok, false);
});

test('write 新建文件，并保留原文件末尾换行的习惯', async () => {
    const ws = workspace({ 'a.txt': 'old\n' });
    assert.equal((await run(ws, 'write', { path: 'b/c.txt', content: 'new' })).verb, 'create');
    assert.equal(ws.state.get('b/c.txt'), 'new');
    assert.equal((await run(ws, 'write', { path: 'a.txt', content: 'changed' })).verb, 'rewrite');
    assert.equal(ws.state.get('a.txt'), 'changed\n');
    assert.equal((await run(ws, 'write', { path: 'b', content: 'x' })).ok, false);
});

test('未知工具的错误交回模型', async () => {
    assert.match((await run(workspace(), 'bash', { command: 'ls' })).output, /Available tools: read, write, edit/);
});

test('目录概览在文件太多时折叠深层目录', () => {
    const paths = Array.from({ length: 500 }, (_, index) => `src/deep/file${index}.js`).concat('README.md');
    assert.equal(outline(paths, '', 5), 'README.md\nsrc/deep/ (500 files)');
    assert.equal(outline(['src/a.js', 'README.md'], 'src'), 'a.js');
    assert.equal(outline([], ''), 'Empty directory.');
});

test('countChanges 精确统计多处改动', () => {
    const before = Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n');
    const lines = before.split('\n');
    lines[3] = 'changed';
    lines[90] = 'changed too';
    lines.splice(50, 0, 'inserted');
    assert.deepEqual(countChanges(before, lines.join('\n')), { added: 3, removed: 2 });
    assert.deepEqual(countChanges('', 'a\nb\n'), { added: 2, removed: 0 });
    assert.deepEqual(countChanges('a\n', 'a\n'), { added: 0, removed: 0 });
});
