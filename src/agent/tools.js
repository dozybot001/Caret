/**
 * @fileoverview Agent 的三个基本工具
 * @description read、write、edit 的定义与实现。Caret 不提供其他工具：没有 bash，不执行命令
 *
 * 工具只通过 workspace 接触文件，改动进入编辑器缓冲区，用户确认后才写入磁盘。
 * workspace 需要提供：paths()、isDirectory(path)、getText(path)、setText(path, text)
 *
 * @module tools
 */

import { AGENT_CONSTANTS, FS_CONSTANTS } from '../app/constants.js';

const { READ_LINES, READ_CHARS, GREP_HITS, GREP_LINE_CHARS, OUTLINE_LINES, GREP_CONCURRENCY } = AGENT_CONSTANTS;

/** 常见密钥文件：不读取，不修改，不发给模型 */
const SECRET_FILE = new RegExp(`(^|/)(${[
    // 环境变量
    '\\.env(?!\\.(example|sample|template)$)(\\..+)?',
    '\\.envrc',
    '\\.dev\\.vars',
    // 私钥、证书和密码库
    '[^/]+\\.(pem|key|p8|p12|pfx|ppk|jks|keystore|kdbx?)',
    'id_(rsa|dsa|ecdsa|ed25519)',
    // 各种工具保存的登录信息
    '\\.npmrc',
    '\\.pypirc',
    '[._]netrc',
    '\\.git-credentials',
    '\\.pgpass',
    '\\.my\\.cnf',
    '\\.htpasswd',
    '\\.vault-token',
    '\\.docker/config\\.json',
    '\\.kube/config',
    'kubeconfig',
    // 配置里的密钥
    'credentials(\\.json)?',
    'secrets?\\.(ya?ml|json|toml)',
    '[^/]*service[-_]?account[^/]*\\.json',
    '[^/]+\\.tfvars',
    '[^/]+\\.tfstate(\\.backup)?'
].join('|')})$`, 'i');

/** 提供给模型的工具定义（OpenAI 兼容格式） */
export const TOOL_SCHEMAS = [
    {
        type: 'function',
        function: {
            name: 'read',
            description: 'Read a file, list a directory, or search file contents with pattern.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File or directory. Defaults to the project root.' },
                    pattern: { type: 'string', description: 'Regular expression to search for. Case-insensitive unless it contains capitals.' },
                    offset: { type: 'integer', description: 'First line, starting at 1.' },
                    limit: { type: 'integer', description: 'Number of lines.' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'write',
            description: 'Create a file, or replace a whole file. Prefer edit for existing files.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                    content: { type: 'string' }
                },
                required: ['path', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'edit',
            description: 'Replace exact text in a file. old must match exactly one place unless all is true.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                    old: { type: 'string', description: 'Exact text to replace, including whitespace.' },
                    new: { type: 'string' },
                    all: { type: 'boolean', description: 'Replace every match.' }
                },
                required: ['path', 'old', 'new']
            }
        }
    }
];

/**
 * 规范化模型给出的路径，只允许项目内的相对路径
 * @param {string} path - 路径
 * @returns {string} 规范化后的路径，根目录为 '.'
 */
export function normalizePath(path) {
    const parts = String(path ?? '.').replace(/\\/g, '/').split('/').filter(part => part && part !== '.');
    if (parts.includes('..')) throw new Error(`Path must stay inside the project: ${path}`);
    const blocked = parts.find(part => FS_CONSTANTS.PROTECTED_DIRECTORIES.includes(part.toLowerCase()));
    if (blocked) throw new Error(`The ${blocked} directory is not available.`);
    return parts.join('/') || '.';
}

/**
 * 在文本中替换一段内容。默认要求唯一匹配，避免改错位置
 * @param {string} text - 原文（LF 换行）
 * @param {string} oldText - 要替换的内容
 * @param {string} newText - 替换后的内容
 * @param {boolean} all - 是否替换全部匹配
 * @returns {{text?: string, count?: number, error?: string}}
 */
export function replaceText(text, oldText, newText, all = false) {
    const target = oldText.replace(/\r\n/g, '\n');
    const replacement = newText.replace(/\r\n/g, '\n');
    if (!target) return { error: 'old is empty. Use write to create a file.' };
    if (target === replacement) return { error: 'old and new are identical.' };

    const hits = [];
    for (let index = text.indexOf(target); index !== -1; index = text.indexOf(target, index + 1)) {
        hits.push(index);
    }
    if (hits.length === 0) return { error: describeMiss(text, target) };
    if (hits.length > 1 && !all) {
        const lines = hits.slice(0, 5).map(index => text.slice(0, index).split('\n').length);
        return { error: `old matches ${hits.length} places (lines ${lines.join(', ')}). Add surrounding lines so it matches one place, or set all to true.` };
    }
    const parts = text.split(target);
    return { text: parts.join(replacement), count: parts.length - 1 };
}

/**
 * 说明为什么没有匹配，帮助模型自行修正
 * @private
 */
function describeMiss(text, target) {
    const firstLine = target.split('\n').map(line => line.trim()).find(Boolean);
    const near = [];
    if (firstLine) {
        text.split('\n').forEach((line, index) => {
            if (near.length < 3 && line.trim() === firstLine) near.push(`${index + 1}: ${line}`);
        });
    }
    if (near.length === 0) return 'old was not found. Read the file again and copy the exact text.';
    return `old was not found. Its first line appears at:\n${near.join('\n')}\nCheck the whitespace and the lines that follow.`;
}

/**
 * 生成紧凑的目录概览，文件太多时自动折叠深层目录
 * @param {string[]} paths - 文件路径
 * @param {string} base - 只看这个目录下的内容
 * @param {number} maxLines - 最多输出行数
 * @returns {string}
 */
export function outline(paths, base = '', maxLines = OUTLINE_LINES) {
    const prefix = base ? `${base}/` : '';
    const relative = paths.filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length));
    if (relative.length === 0) return 'Empty directory.';

    for (let depth = 8; depth >= 1; depth--) {
        const entries = new Map();
        for (const path of relative) {
            const parts = path.split('/');
            const key = parts.length > depth ? `${parts.slice(0, depth).join('/')}/` : path;
            entries.set(key, (entries.get(key) || 0) + 1);
        }
        if (entries.size <= maxLines || depth === 1) {
            const lines = [...entries]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, count]) => (key.endsWith('/') ? `${key} (${count} files)` : key));
            const shown = lines.slice(0, maxLines);
            if (lines.length > maxLines) shown.push(`... ${lines.length - maxLines} more`);
            return shown.join('\n');
        }
    }
    return '';
}

/**
 * 截取文件的部分行
 * @private
 */
function sliceLines(text, offset, limit) {
    const lines = text.split('\n');
    const start = Math.max(1, offset || 1) - 1;
    if (start >= lines.length) return `The file has ${lines.length} lines.`;

    let end = Math.min(lines.length, start + (limit || READ_LINES));
    let body = lines.slice(start, end).join('\n');
    if (body.length > READ_CHARS) {
        body = body.slice(0, READ_CHARS);
        end = start + body.split('\n').length;
    }
    if (end >= lines.length) return body;
    return `${body}\n\n[Showing lines ${start + 1}-${end} of ${lines.length}. Use offset to read more.]`;
}

/**
 * 编译搜索表达式：含大写字母时区分大小写，非法正则按字面量处理
 * @private
 */
function compilePattern(pattern) {
    const flags = /[A-Z]/.test(pattern) ? '' : 'i';
    try {
        return new RegExp(pattern, flags);
    } catch {
        return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    }
}

/**
 * 搜索文件内容
 * @private
 */
async function search(workspace, target, pattern, isDirectory) {
    const matcher = compilePattern(pattern);
    const prefix = target === '.' ? '' : `${target}/`;
    const queue = isDirectory ? workspace.paths().filter(path => path.startsWith(prefix)) : [target];
    const hits = [];

    const worker = async () => {
        while (queue.length > 0) {
            const path = queue.pop();
            if (SECRET_FILE.test(path)) continue;
            const file = await workspace.getText(path);
            if (!file?.text) continue;
            file.text.split('\n').forEach((line, index) => {
                if (matcher.test(line)) hits.push({ path, line: index + 1, text: line.trim().slice(0, GREP_LINE_CHARS) });
            });
        }
    };
    await Promise.all(Array.from({ length: GREP_CONCURRENCY }, worker));

    if (hits.length === 0) return 'No matches.';
    hits.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    const lines = hits.slice(0, GREP_HITS).map(hit => `${hit.path}:${hit.line}: ${hit.text}`);
    if (hits.length > GREP_HITS) lines.push(`[Showing ${GREP_HITS} of ${hits.length} matches. Narrow the pattern or the path.]`);
    return lines.join('\n');
}

const failure = (verb, target, output) => ({ ok: false, verb, target, output });

/**
 * 确认文件可以交给模型
 * @private
 */
function fileProblem(path, file) {
    if (SECRET_FILE.test(path)) return `${path} may contain secrets, so Caret does not open it. Ask the user to change it by hand.`;
    if (file?.error) return `${path} cannot be used: ${file.error}.`;
    return null;
}

async function read(workspace, { path, pattern, offset, limit }) {
    const target = normalizePath(path);
    const isDirectory = target === '.' || workspace.isDirectory(target);
    if (pattern) {
        return { ok: true, verb: 'search', target: pattern, output: await search(workspace, target, pattern, isDirectory) };
    }
    if (isDirectory) {
        return { ok: true, verb: 'list', target, output: outline(workspace.paths(), target === '.' ? '' : target) };
    }
    const file = SECRET_FILE.test(target) ? null : await workspace.getText(target);
    const problem = fileProblem(target, file);
    if (problem) return failure('read', target, problem);
    if (!file) return failure('read', target, `File not found: ${target}`);
    return { ok: true, verb: 'read', target, output: sliceLines(file.text, offset, limit) || '(empty file)' };
}

async function write(workspace, { path, content }) {
    const target = normalizePath(path);
    if (typeof content !== 'string') return failure('write', target, 'content must be a string.');
    if (target === '.' || workspace.isDirectory(target)) return failure('write', target, `${target} is a directory.`);
    const file = SECRET_FILE.test(target) ? null : await workspace.getText(target);
    const problem = fileProblem(target, file);
    if (problem) return failure('write', target, problem);

    // 保持原文件末尾换行的习惯，避免无意义的改动
    let text = content.replace(/\r\n/g, '\n');
    if (file?.text.endsWith('\n') && !text.endsWith('\n')) text += '\n';
    await workspace.setText(target, text);
    const verb = file ? 'rewrite' : 'create';
    return { ok: true, verb, target, output: `${file ? 'Replaced' : 'Created'} ${target}` };
}

async function edit(workspace, { path, old: oldText, new: newText, all }) {
    const target = normalizePath(path);
    if (typeof oldText !== 'string' || typeof newText !== 'string') return failure('edit', target, 'old and new must be strings.');
    const file = SECRET_FILE.test(target) ? null : await workspace.getText(target);
    const problem = fileProblem(target, file);
    if (problem) return failure('edit', target, problem);
    if (!file) return failure('edit', target, `File not found: ${target}`);

    const result = replaceText(file.text, oldText, newText, Boolean(all));
    if (result.error) return failure('edit', target, result.error);
    await workspace.setText(target, result.text);
    return { ok: true, verb: 'edit', target, output: `Edited ${target}${result.count > 1 ? ` (${result.count} replacements)` : ''}` };
}

const HANDLERS = { read, write, edit };

/**
 * 执行工具
 * @param {Object} workspace - 工作区
 * @param {string} name - 工具名
 * @param {Object} args - 工具参数
 * @returns {Promise<{ok: boolean, verb: string, target: string, output: string}>}
 */
export async function executeTool(workspace, name, args) {
    const handler = HANDLERS[name];
    if (!handler) return failure('read', String(name), `Unknown tool: ${name}. Available tools: read, write, edit.`);
    try {
        return await handler(workspace, args || {});
    } catch (error) {
        return failure(name === 'edit' ? 'edit' : name === 'write' ? 'rewrite' : 'read', String(args?.path ?? '.'), `Error: ${error.message}`);
    }
}
