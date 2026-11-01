/**
 * @fileoverview Monaco 加载和配色
 * @description 加载 vendor 目录里的 Monaco，按当前主题设置配色，按文件名判断语言
 * @module monaco
 */

import { resolvedTheme } from '../app/preferences.js';
import { getLanguage } from '../i18n/index.js';

const MONACO_BASE = new URL('../../vendor/monaco-0.52.2/', import.meta.url).href;

const LANGUAGES = {
    'js': 'javascript', 'mjs': 'javascript', 'cjs': 'javascript', 'jsx': 'javascript',
    'ts': 'typescript', 'mts': 'typescript', 'cts': 'typescript', 'tsx': 'typescript',
    'html': 'html', 'htm': 'html',
    'css': 'css', 'scss': 'scss', 'less': 'less',
    'json': 'json', 'md': 'markdown', 'py': 'python',
    'java': 'java', 'c': 'c', 'cpp': 'cpp', 'h': 'cpp',
    'cs': 'csharp', 'go': 'go', 'rs': 'rust', 'php': 'php',
    'rb': 'ruby', 'sh': 'shell', 'bash': 'shell', 'zsh': 'shell',
    'yaml': 'yaml', 'yml': 'yaml', 'xml': 'xml', 'sql': 'sql', 'dockerfile': 'dockerfile'
};

/**
 * 加载 Monaco
 * @returns {Promise<void>}
 */
export function loadMonaco() {
    window.MonacoEnvironment = { getWorkerUrl: () => `${MONACO_BASE}vs/base/worker/workerMain.js` };

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${MONACO_BASE}vs/loader.js`;
        script.onerror = reject;
        script.onload = () => {
            window.require.config({
                paths: { vs: `${MONACO_BASE}vs` },
                'vs/nls': getLanguage() === 'zh' ? { availableLanguages: { '*': 'zh-cn' } } : {}
            });
            window.require(['vs/editor/editor.main'], resolve, reject);
        };
        document.head.appendChild(script);
    });
}

/** 根据当前主题的 CSS 变量设置编辑器配色 */
export function applyMonacoTheme() {
    if (typeof monaco === 'undefined') return;
    const styles = getComputedStyle(document.documentElement);
    const color = name => styles.getPropertyValue(name).trim();
    const themeName = resolvedTheme() === 'dark' ? 'caret-dark' : 'caret-light';

    monaco.editor.defineTheme(themeName, {
        base: resolvedTheme() === 'dark' ? 'vs-dark' : 'vs',
        inherit: true,
        rules: [],
        colors: {
            'editor.background': color('--bg-1'),
            'editor.foreground': color('--text-1'),
            'editor.lineHighlightBackground': color('--bg-2'),
            'editorIndentGuide.background1': color('--bg-4'),
            'editorLineNumber.foreground': color('--text-6'),
            'diffEditor.insertedLineBackground': color('--diff-add-line'),
            'diffEditor.insertedTextBackground': color('--diff-add-text'),
            'diffEditor.removedLineBackground': color('--diff-remove-line'),
            'diffEditor.removedTextBackground': color('--diff-remove-text'),
            'diffEditorGutter.insertedLineBackground': color('--diff-add-line'),
            'diffEditorGutter.removedLineBackground': color('--diff-remove-line')
        }
    });
    monaco.editor.setTheme(themeName);
}

/**
 * 根据文件名判断语言
 * @param {string} fileName - 文件名
 * @returns {string} Monaco 的语言名称
 */
export function languageOf(fileName) {
    return LANGUAGES[fileName.split('.').pop().toLowerCase()] || 'plaintext';
}
