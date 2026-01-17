/**
 * @fileoverview 忽略规则管理器
 * @description 处理文件过滤逻辑，解析 .gitignore 规则与默认忽略项
 * 
 * ## 核心功能
 * - 解析 .gitignore 文件
 * - 提供默认忽略规则
 * - 判断文件是否应该被忽略
 * 
 * @module ignore-manager
 */

const DEFAULT_IGNORE_CONTENT = `
# --- Version Control & IDEs ---
.git
.svn
.hg
.idea
.vscode
.vs
.history
*.swp

# --- Operating System Files ---
.DS_Store
Thumbs.db
desktop.ini
$RECYCLE.BIN
*.lnk

# --- Dependencies & Packages ---
node_modules
bower_components
jspm_packages
web_modules
venv
.venv
__pycache__
.mvn
vendor
.bundle

# --- Build Outputs & Dist ---
dist
build
out
target
coverage
.nuxt
.next
.astro
.svelte-kit
.vercel
.output
.cache
.parcel-cache
.turbo
.wrangler
public/build
storybook-static
.docusaurus

# --- Package Manager Cache ---
.npm
.yarn
.pnpm-store
.bun

# --- Testing & Coverage ---
coverage
.nyc_output
.pytest_cache
test-results
playwright-report
blob-report

# --- Modern Build Tools ---
.turbo
.gradle
.terraform
.serverless

# --- Logs & Debug ---
*.log
npm-debug.log*
yarn-error.log*
yarn-debug.log*
pnpm-debug.log*
lerna-debug.log*
hs_err_pid*

# --- Environment & Secrets (Security) ---
.env
.env.local
.env.*.local
*.pem
*.key
*.cert
*.pfx
id_rsa
id_rsa.pub
secrets.yaml

# --- Binary / Media Assets ---
*.png
*.jpg
*.jpeg
*.gif
*.webp
*.ico
*.svg
*.bmp
*.tiff
*.raw
*.psd
*.ai
*.mp4
*.m4v
*.mov
*.avi
*.mkv
*.webm
*.mp3
*.wav
*.flac
*.aac
*.ogg

# --- Binary / Documents & Fonts ---
*.pdf
*.doc
*.docx
*.xls
*.xlsx
*.ppt
*.pptx
*.zip
*.tar
*.tar.gz
*.rar
*.7z
*.gz
*.iso
*.exe
*.dll
*.so
*.dylib
*.bin
*.dmg
*.woff
*.woff2
*.ttf
*.eot
*.otf
*.wasm

# --- Lock Files (Token Saving) ---
package-lock.json
yarn.lock
pnpm-lock.yaml
bun.lockb
poetry.lock
Gemfile.lock
composer.lock
uv.lock

# --- Minified & Source Maps ---
*.min.js
*.min.css
*.map
`;

export async function fetchIgnoreRules() {
    return parseIgnoreFile(DEFAULT_IGNORE_CONTENT);
}

export function parseIgnoreFile(text) {
    if (!text) return [];
    return text.split(/\r?\n/)
        .map(line => line.trim())

        .filter(line => line && !line.startsWith('#'));
}

export function isIgnored(fullPath, scopes) {
    const normPath = fullPath.replace(/\\/g, '/');
    let ignored = false;

    for (const scope of scopes) {
        if (scope.basePath && !normPath.startsWith(scope.basePath + '/')) continue;

        const relativePath = scope.basePath
            ? normPath.slice(scope.basePath.length + 1)
            : normPath;

        if (!relativePath) continue;

        for (const rule of scope.rules) {
            const isNegative = rule.startsWith('!');
            const pattern = isNegative ? rule.slice(1) : rule;

            if (checkRule(relativePath, pattern)) {
                ignored = !isNegative;
            }
        }
    }
    return ignored;
}

const REGEX_CACHE = new Map();

function checkRule(path, pattern) {
    if (!pattern) return false;

    let cleanPattern = pattern;
    if (cleanPattern.endsWith('/')) cleanPattern = cleanPattern.slice(0, -1);

    const isRooted = cleanPattern.startsWith('/') || cleanPattern.indexOf('/') > -1;

    if (isRooted) {
        if (cleanPattern.startsWith('/')) cleanPattern = cleanPattern.slice(1);

        const regex = getOrCompileRegex(cleanPattern, true);

        return regex.test(path);
    } else {

        const filename = path.split('/').pop();
        if (cleanPattern === filename) return true;

        const parts = path.split('/');
        if (parts.includes(cleanPattern)) return true;

        if (cleanPattern.includes('*') || cleanPattern.includes('?')) {
            const regex = getOrCompileRegex(cleanPattern, false);
            return regex.test(filename);
        }

        return false;
    }
}

function getOrCompileRegex(pattern, allowPathTraversal) {
    const key = `${pattern}::${allowPathTraversal}`;
    if (REGEX_CACHE.has(key)) {
        return REGEX_CACHE.get(key);
    }

    const regex = makeGlobRegex(pattern, allowPathTraversal);
    REGEX_CACHE.set(key, regex);
    return regex;
}

function makeGlobRegex(pattern, allowPathTraversal) {
    const DOUBLE_STAR_PLACEHOLDER = '___DOUBLE_STAR___';

    let src = pattern.replace(/\*\*/g, DOUBLE_STAR_PLACEHOLDER);

    src = src.replace(/[.+^${}()|\\*?]/g, '\\$&');

    src = src.split(DOUBLE_STAR_PLACEHOLDER).join('.*');

    src = src.replace(/\\\*/g, '[^/]*');

    src = src.replace(/\\\?/g, '[^/]');

    if (allowPathTraversal) {

        return new RegExp(`^${src}(?:/.*)?$`);
    } else {

        return new RegExp(`^${src}$`);
    }
}
