import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { test } from 'node:test';

import { VERSION } from '../src/app/constants.js';
import { DOMAIN, FILING, LEGACY_DOMAIN, LEGACY_UNTIL, legacyDeadline } from '../src/app/site.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ORIGIN = `https://${DOMAIN}`;
/** 英文 README 是默认页，中文的在 README.zh-CN.md */
const READMES = { 'README.md': 'en', 'README.zh-CN.md': 'zh' };

test('页面、security.txt 和 README 里的地址与 site.js 一致', () => {
    const html = read('index.html');
    assert.ok(html.includes(`<meta property="og:url" content="${ORIGIN}/">`));
    const security = read('.well-known/security.txt').split('\n');
    assert.ok(security.includes(`Canonical: ${ORIGIN}/.well-known/security.txt`));
    // 迁移期间新旧地址都列
    if (LEGACY_DOMAIN) assert.ok(security.includes(`Canonical: https://${LEGACY_DOMAIN}/.well-known/security.txt`));
    for (const readme in READMES) assert.ok(read(readme).includes(`<${ORIGIN}/>`), readme);
    assert.doesNotMatch(read('deploy/caret.Caddyfile'), /tenon/);
    assert.match(read('deploy/caret.Caddyfile'), /^__DOMAIN__ \{$/m);

    // 迁到 tenonai.cn 后，官网链接和安全策略也换成新域名
    if (DOMAIN.endsWith('.tenonai.cn')) {
        assert.doesNotMatch(html, /tenon\.asia/);
        assert.doesNotMatch(security.filter(line => !line.startsWith('Canonical:')).join('\n'), /tenon\.asia/);
    }
});

test('每个页面都声明手机桌面图标和分享图', () => {
    const pages = readdirSync(new URL('..', import.meta.url)).filter(name => name.endsWith('.html'));
    assert.ok(pages.includes('index.html') && pages.includes('404.html'));
    for (const page of pages) {
        const html = read(page);
        assert.ok(html.includes('<link rel="apple-touch-icon" href="/apple-touch-icon.png">'), page);
        assert.ok(html.includes(`<meta property="og:image" content="${ORIGIN}/assets/share.png">`), page);
        assert.ok(html.includes('<meta name="twitter:card" content="summary">'), page);
    }
});

test('页面上的 Tenon 标志只用在关于页的出品方', () => {
    // 官方 Tenon 标志里白色 T 的路径。产品标志、侧栏、加载页和图标都不放，出品方是 T 加文字的横版组合
    const T = 'M13 16H51V28H38V48H26V28H13Z';
    const pages = readdirSync(new URL('..', import.meta.url)).filter(name => name.endsWith('.html'));
    for (const page of pages) {
        const html = read(page);
        const count = html.split(T).length - 1;
        if (page !== 'index.html') {
            assert.equal(count, 0, page);
            continue;
        }
        assert.equal(count, 1);
        const row = html.slice(html.indexOf('<div class="about-publisher">'));
        assert.ok(row.startsWith('<div class="about-publisher">'));
        assert.ok(row.indexOf(T) < row.indexOf('</div>'));
        assert.ok(row.indexOf('data-i18n="about.publisherName"') < row.indexOf('</div>'));
    }
});

test('手机桌面图标和分享图是不透明的 PNG，尺寸合规', () => {
    const header = path => {
        const png = readFileSync(new URL(`../${path}`, import.meta.url));
        assert.equal(png.toString('latin1', 12, 16), 'IHDR', path);
        // 颜色类型 2 是没有透明通道的 RGB
        return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), colorType: png[25] };
    };
    assert.deepEqual(header('apple-touch-icon.png'), { width: 180, height: 180, colorType: 2 });
    const share = header('assets/share.png');
    assert.equal(share.width, share.height);
    assert.ok(share.width >= 512);
    assert.equal(share.colorType, 2);
});

test('页脚显示公司的 ICP 备案号和公安备案号', () => {
    assert.match(FILING.icp, /^湘ICP备\d+号-\d+$/);
    // 只写数字，前后的「湘公网安备」「号」由页面加上
    assert.match(FILING.police, /^\d{14}$/);
    const html = read('index.html');
    assert.equal(html.match(/data-filing="icp"/g).length, html.match(/data-filing="police"/g).length);
});

test('两份 README 顶部互相链接，版本徽章和 VERSION 一致', () => {
    for (const readme in READMES) {
        const text = read(readme);
        const other = Object.keys(READMES).find(name => name !== readme);
        assert.ok(text.slice(0, text.indexOf('<picture>')).includes(`<a href="${other}">`), readme);
        assert.ok(text.includes(`https://img.shields.io/badge/version-${VERSION}-`), readme);
    }
});

test('README 配图都在 docs/assets 里，有替代文字，不超过 500 KB，中文 README 用中文界面的图', () => {
    const used = new Set();
    for (const [readme, lang] of Object.entries(READMES)) {
        const text = read(readme);
        const markdown = [...text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
        for (const [, alt, path] of markdown) assert.ok(alt, `${readme}: ${path} 没有替代文字`);
        for (const tag of text.match(/<img [^>]*>/g)) assert.match(tag, / alt="[^"]+"/, tag);
        const images = [
            ...markdown.map(match => match[2]),
            ...[...text.matchAll(/<img [^>]*src="([^"]+)"/g)].map(match => match[1]),
            ...[...text.matchAll(/srcset="([^"]+)"/g)].map(match => match[1])
        ].filter(path => !path.startsWith('https://') && path !== 'apple-touch-icon.png');
        for (const path of images) {
            // 截图分语言和主题；结尾出品方用的 Tenon 标志两份共用
            if (path !== 'docs/assets/tenon-mark.svg') {
                assert.match(path, new RegExp(`^docs/assets/[a-z]+-${lang}-(dark|light)\\.webp$`), `${readme}: ${path}`);
            }
            used.add(path.slice('docs/assets/'.length));
        }
    }
    // 目录里的图都要被引用，换图时清掉旧的
    for (const name of readdirSync(new URL('../docs/assets', import.meta.url))) {
        assert.ok(used.has(name), `docs/assets/${name} 没有用到`);
        assert.ok(statSync(new URL(`../docs/assets/${name}`, import.meta.url)).size <= 500_000, name);
    }
});

test('README、CONTRIBUTING 和数据清单里的相对链接都指向仓库里的文件', () => {
    const docs = ['README.md', 'README.zh-CN.md', 'CONTRIBUTING.md', 'docs/en/data-inventory.md', 'docs/zh/data-inventory.md'];
    for (const doc of docs) {
        const text = read(doc);
        const links = [...text.matchAll(/\]\(([^)\s]+)\)|(?:href|src|srcset)="([^"]+)"/g)].map(match => match[1] || match[2]);
        for (const link of links) {
            if (/^(https?:|mailto:|#)/.test(link)) continue;
            const target = new URL(link.split('#')[0], new URL(`../${doc}`, import.meta.url));
            assert.ok(existsSync(target), `${doc}: ${link}`);
        }
    }
});

test('README 写公司的著作权行，结尾是出品方的横版组合', () => {
    // 著作权行照抄 LICENSE 第 3 行，中文版括注公司中文名
    const copyright = read('LICENSE').split('\n')[2];
    assert.match(copyright, /^Copyright \(c\) \d{4}(-\d{4})? Tenon Artificial Intelligence Technology Co\., Ltd\.$/);
    assert.ok(read('README.md').includes(copyright));
    assert.ok(read('README.zh-CN.md').includes(`${copyright}（长沙榫卯人工智能科技有限公司）`));

    // 出品方是 Tenon 标志加名字，不写成纯文字，链接官网产品页
    const lockups = {
        'README.md': ['Publisher', 'https://tenonai.cn/products/caret/', 'Tenon AI'],
        'README.zh-CN.md': ['出品方', 'https://tenonai.cn/zh/products/caret/', '榫卯 Tenon AI']
    };
    for (const [readme, [label, page, name]] of Object.entries(lockups)) {
        const last = read(readme).trimEnd().split('\n').slice(-3).join('\n');
        assert.ok(last.startsWith('<p align="center">'), readme);
        assert.ok(last.includes(`${label}`) && last.includes(`<a href="${page}"><img src="docs/assets/tenon-mark.svg"`), readme);
        assert.ok(last.includes(`> <b>${name}</b></a>`), readme);
    }
});

test('迁移页面只把数据发给线上地址', () => {
    const target = new URL(read('migrate.html').match(/const TARGET = '([^']+)'/)[1]);
    assert.equal(target.origin, ORIGIN);
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
