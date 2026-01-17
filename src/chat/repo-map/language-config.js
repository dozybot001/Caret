/**
 * @fileoverview 语言配置
 * @description 定义 JavaScript、HTML、CSS 的 TreeSitter 配置及代码提取查询规则
 * 
 * @module language-config
 */

export const TS_BASE_URL = 'https://cdn.jsdelivr.net/npm/tree-sitter-wasms@latest/out';
const getWasmPath = (lang) => `${TS_BASE_URL}/tree-sitter-${lang}.wasm`;

/**
 * 语言配置注册表
 * 仅支持 JavaScript、HTML、CSS 三种语言
 */
export const LANGUAGE_REGISTRY = {
    javascript: {
        id: 'javascript',
        wasm: getWasmPath('javascript'),
        extensions: ['js', 'jsx', 'mjs', 'cjs'],
        query: `
            (function_declaration name: (identifier) @name) @def
            (class_declaration name: (identifier) @name) @def
            (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression) (object)]) @def
            (lexical_declaration (variable_declarator name: (identifier) @name value: (object))) @def
            (method_definition name: (property_identifier) @name) @def
        `
    },
    html: {
        id: 'html',
        extensions: ['html', 'htm'],
        mode: 'doc-only'
    },
    css: {
        id: 'css',
        extensions: ['css'],
        mode: 'doc-only'
    }
};
