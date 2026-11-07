import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { DOMAIN, FILINGS, LEGACY_DOMAIN, LEGACY_UNTIL, filingOf, legacyDeadline } from '../src/app/site.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ORIGIN = `https://${DOMAIN}`;

test('页面、security.txt 和 README 里的地址与 site.js 一致', () => {
    const html = read('index.html');
    assert.ok(html.includes(`<meta property="og:url" content="${ORIGIN}/">`));
    assert.ok(html.includes(`<meta property="og:image" content="${ORIGIN}/assets/og.png">`));
    const security = read('.well-known/security.txt').split('\n');
    assert.ok(security.includes(`Canonical: ${ORIGIN}/.well-known/security.txt`));
    // 迁移期间新旧地址都列
    if (LEGACY_DOMAIN) assert.ok(security.includes(`Canonical: https://${LEGACY_DOMAIN}/.well-known/security.txt`));
    for (const readme of ['README.md', 'README.en.md']) assert.ok(read(readme).includes(`<${ORIGIN}/>`), readme);
    assert.doesNotMatch(read('deploy/caret.Caddyfile'), /tenon/);

    // 迁到 tenonai.cn 后，官网链接和安全策略也换成新域名
    if (DOMAIN.endsWith('.tenonai.cn')) {
        assert.doesNotMatch(html, /tenon\.asia/);
        assert.doesNotMatch(security.filter(line => !line.startsWith('Canonical:')).join('\n'), /tenon\.asia/);
    }
});

test('线上地址有备案号，本地开发时按线上地址显示', () => {
    assert.ok(FILINGS[DOMAIN]?.icp);
    assert.equal(filingOf('localhost'), FILINGS[DOMAIN]);
    assert.equal(filingOf('caret.tenonai.cn'), FILINGS['caret.tenonai.cn']);
});

test('迁移页面只把数据发给 Caret 自己的地址，迁移期间就是线上地址', () => {
    const target = new URL(read('migrate.html').match(/const TARGET = '([^']+)'/)[1]);
    assert.equal(target.protocol, 'https:');
    assert.ok(target.hostname in FILINGS);
    if (LEGACY_DOMAIN) assert.equal(target.origin, ORIGIN);
});

test('迁移截止日期只在迁移期间填写，按本地日期提醒', () => {
    if (!LEGACY_UNTIL) {
        assert.equal(legacyDeadline(), null);
        return;
    }
    assert.ok(LEGACY_DOMAIN);
    assert.match(LEGACY_UNTIL, /^\d{4}-\d{2}-\d{2}$/);
    const date = legacyDeadline();
    assert.equal([date.getFullYear(), date.getMonth() + 1, date.getDate()].map(n => String(n).padStart(2, '0')).join('-'), LEGACY_UNTIL);
});
