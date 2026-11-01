/**
 * @fileoverview Git 状态
 * @description 只读取 .git，不运行 git，也不写入。解析索引后和工作区比较，得到文件树上的标记
 *
 * 比较的是工作区和索引，已暂存未提交的改动要读取提交对象才能发现，这里不处理。
 */

import { isIgnored, parseIgnoreFile } from './ignore-manager.js';

/** 索引文件开头的 DIRC */
const INDEX_SIGNATURE = 0x44495243;
const TYPE_MASK = 0o170000;
const REGULAR_FILE = 0o100000;
const FLAG_ASSUME_UNCHANGED = 0x8000;
const FLAG_EXTENDED = 0x4000;
const FLAG_SKIP_WORKTREE = 0x4000;
const NAME_LENGTH_MASK = 0xfff;
/** 同时读取的文件数 */
const CONCURRENCY = 16;
/** 文件接口的修改时间只到毫秒，允许取整误差 */
const TIME_TOLERANCE = 1;
/** 超过这个大小不算哈希，大小相同而时间不同时直接算作修改 */
const HASH_LIMIT = 20 * 1000 * 1000;

const toHex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');

/**
 * 解析索引。只支持版本 2 和 3，版本 4 压缩了路径。
 * 子模块、符号链接、标记为不变的文件和稀疏检出之外的文件不参与比较
 * @param {Uint8Array} bytes - .git/index 的内容
 * @returns {Map<string, {time: number, size: number, sha: string}>|null} 无法解析时返回 null
 */
export function parseGitIndex(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 12 || view.getUint32(0) !== INDEX_SIGNATURE) return null;
    const version = view.getUint32(4);
    if (version !== 2 && version !== 3) return null;

    const decoder = new TextDecoder();
    const entries = new Map();
    let offset = 12;
    for (let remaining = view.getUint32(8); remaining > 0; remaining--) {
        const flags = view.getUint16(offset + 60);
        const isExtended = version === 3 && Boolean(flags & FLAG_EXTENDED);
        const extendedFlags = isExtended ? view.getUint16(offset + 62) : 0;
        const nameStart = offset + (isExtended ? 64 : 62);
        const nameLength = flags & NAME_LENGTH_MASK;
        const nameEnd = nameLength === NAME_LENGTH_MASK ? bytes.indexOf(0, nameStart) : nameStart + nameLength;

        const isRegular = (view.getUint32(offset + 24) & TYPE_MASK) === REGULAR_FILE;
        if (isRegular && !(flags & FLAG_ASSUME_UNCHANGED) && !(extendedFlags & FLAG_SKIP_WORKTREE)) {
            entries.set(decoder.decode(bytes.subarray(nameStart, nameEnd)).normalize('NFC'), {
                time: view.getUint32(offset + 8) * 1000 + Math.floor(view.getUint32(offset + 12) / 1e6),
                size: view.getUint32(offset + 36),
                sha: toHex(bytes.subarray(offset + 40, offset + 60))
            });
        }
        // 每一项用 NUL 补齐到 8 字节的倍数，至少补一个
        offset += Math.ceil((nameEnd - offset + 1) / 8) * 8;
    }
    return entries;
}

/**
 * 从 HEAD 读出分支名，分离状态时显示提交的前 7 位
 * @param {string} text - .git/HEAD 的内容
 * @returns {string}
 */
export function parseGitHead(text) {
    const value = text.trim();
    return value.match(/^ref: refs\/heads\/(.+)$/)?.[1] || value.slice(0, 7);
}

async function blobSha(file) {
    const header = new TextEncoder().encode(`blob ${file.size}\0`);
    const content = await new Blob([header, await file.arrayBuffer()]).arrayBuffer();
    return toHex(new Uint8Array(await crypto.subtle.digest('SHA-1', content)));
}

/**
 * 判断文件是否和索引不同。git 重写索引时可能把大小记成 0，这时要算哈希
 * @param {{time: number, size: number, sha: string}} entry - 索引项
 * @param {File} file - 工作区文件
 * @returns {Promise<boolean>}
 */
async function isModified(entry, file) {
    if (file.size !== entry.size && entry.size !== 0) return true;
    if (file.size === entry.size && Math.abs(file.lastModified - entry.time) <= TIME_TOLERANCE) return false;
    return file.size > HASH_LIMIT || await blobSha(file) !== entry.sha;
}

async function readBytes(directory, name) {
    try {
        const file = await (await directory.getFileHandle(name)).getFile();
        return new Uint8Array(await file.arrayBuffer());
    } catch {
        return null;
    }
}

async function readExcludeRules(git) {
    try {
        const bytes = await readBytes(await git.getDirectoryHandle('info'), 'exclude');
        return parseIgnoreFile(new TextDecoder().decode(bytes));
    } catch {
        return [];
    }
}

async function fileExists(root, path) {
    const parts = path.split('/');
    const name = parts.pop();
    try {
        let directory = root;
        for (const part of parts) directory = await directory.getDirectoryHandle(part);
        await directory.getFileHandle(name);
        return true;
    } catch {
        return false;
    }
}

async function forEachLimited(items, task) {
    let next = 0;
    const worker = async () => {
        while (next < items.length) await task(items[next++]);
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

/**
 * 读取 Git 状态
 * @param {FileSystemDirectoryHandle} root - 项目文件夹
 * @param {Array<{path: string, handle: FileSystemFileHandle}>} files - 文件树里的文件
 * @param {string[]} hiddenRules - 文件树默认隐藏的规则，被隐藏的已跟踪文件不算删除
 * @returns {Promise<{branch: string, changes: Map<string, string>, deleted: string[]}|null>}
 *   没有 .git、.git 是文件（worktree 和子模块的真实目录不在授权范围内）或索引无法解析时返回 null
 */
export async function readGitStatus(root, files, hiddenRules) {
    let git;
    try {
        git = await root.getDirectoryHandle('.git');
    } catch {
        return null;
    }

    const head = await readBytes(git, 'HEAD');
    const indexBytes = await readBytes(git, 'index');
    // 刚执行过 git init 的仓库还没有索引
    const index = indexBytes ? parseGitIndex(indexBytes) : new Map();
    if (!head || !index) return null;

    const excluded = [{ basePath: '', rules: await readExcludeRules(git) }];
    const changes = new Map();
    await forEachLimited(files, async ({ path, handle }) => {
        const entry = index.get(path.normalize('NFC'));
        if (!entry) {
            if (!isIgnored(path, excluded)) changes.set(path, 'U');
        } else if (await isModified(entry, await handle.getFile())) {
            changes.set(path, 'M');
        }
    });

    const visible = new Set(files.map(({ path }) => path.normalize('NFC')));
    const hidden = [{ basePath: '', rules: hiddenRules }];
    const missing = [...index.keys()].filter(path => !visible.has(path) && !isIgnored(path, hidden));
    const deleted = [];
    await forEachLimited(missing, async (path) => {
        if (!(await fileExists(root, path))) deleted.push(path);
    });

    return { branch: parseGitHead(new TextDecoder().decode(head)), changes, deleted: deleted.sort() };
}
