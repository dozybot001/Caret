import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SCRIPT = fileURLToPath(new URL('../deploy/retain.sh', import.meta.url));
/** 从新到旧的 7 个版本 */
const COMMITS = Array.from({ length: 7 }, (_, n) => n.toString(16).repeat(40));

/** 按服务器的目录结构建一个站点：每个版本有目录、发布包校验值、站点配置、指向共用 Monaco 的链接，以及残留的发布包 */
function site(t, current, previous) {
    const root = mkdtempSync(join(tmpdir(), 'caret-retain-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const name of ['releases', 'incoming', 'state', 'vendor']) mkdirSync(join(root, name));
    writeFileSync(join(root, 'vendor', 'loader.js'), '');
    COMMITS.forEach((commit, age) => {
        const release = join(root, 'releases', commit);
        mkdirSync(join(release, 'src'), { recursive: true });
        symlinkSync(join(root, 'vendor'), join(release, 'vendor'));
        writeFileSync(`${release}.sha256`, 'digest\n');
        writeFileSync(`${release}.Caddyfile`, 'site\n');
        writeFileSync(join(root, 'incoming', `${commit}.tar.gz`), 'bundle');
        utimesSync(release, 1e9 - age * 60, 1e9 - age * 60);
    });
    // 不是发布脚本建立的目录，时间最新，也不算版本
    mkdirSync(join(root, 'releases', 'notes'));
    writeFileSync(join(root, 'state', 'current'), `${current}\n`);
    if (previous) writeFileSync(join(root, 'state', 'previous'), `${previous}\n`);
    return root;
}

const list = path => readdirSync(path).sort();

test('保留当前、上一个和最新的 3 个版本，其余连同发布包和站点配置删除', t => {
    const root = site(t, COMMITS[5], COMMITS[6]);
    assert.match(execFileSync('bash', [SCRIPT, root], { encoding: 'utf8' }), /已清理 2 个旧版本，保留 5 个/);
    const kept = [...COMMITS.slice(0, 3), ...COMMITS.slice(5)];
    const files = kept.flatMap(commit => [commit, `${commit}.sha256`, `${commit}.Caddyfile`]);
    assert.deepEqual(list(join(root, 'releases')), [...files, 'notes'].sort());
    assert.deepEqual(list(join(root, 'incoming')), kept.map(commit => `${commit}.tar.gz`).sort());
    assert.ok(existsSync(join(root, 'vendor', 'loader.js')));
});

test('找不到上一个版本时不清理', t => {
    const root = site(t, COMMITS[0], null);
    const result = spawnSync('bash', [SCRIPT, root], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /不清理/);
    assert.equal(readdirSync(join(root, 'releases')).length, COMMITS.length * 3 + 1);
});
