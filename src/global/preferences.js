/**
 * @fileoverview 显示偏好
 * @description 管理主题和语言，保存在 localStorage，并接收从 Tenon 官网带来的显示参数
 */

import { STORAGE_CONSTANTS } from './constants.js';

const { PREFERENCES_KEY } = STORAGE_CONSTANTS;
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function read() {
    try {
        return JSON.parse(localStorage.getItem(PREFERENCES_KEY)) || {};
    } catch {
        return {};
    }
}

function defaults() {
    const params = new URLSearchParams(location.search);
    const theme = params.get('theme');
    const lang = params.get('lang');
    return {
        theme: theme === 'light' || theme === 'dark' ? theme : read().theme || 'system',
        lang: lang === 'zh' || lang === 'en' ? lang : read().lang || (navigator.language.startsWith('zh') ? 'zh' : 'en'),
        panels: read().panels || {}
    };
}

const state = defaults();
const themeListeners = new Set();

function save() {
    try {
        localStorage.setItem(PREFERENCES_KEY, JSON.stringify(state));
    } catch {
        // 无法保存时只在本次访问生效
    }
}

save();

/** @returns {'light'|'dark'} 实际使用的主题 */
export function resolvedTheme() {
    if (state.theme === 'system') return systemDark.matches ? 'dark' : 'light';
    return state.theme;
}

function applyTheme() {
    document.documentElement.dataset.theme = resolvedTheme();
    themeListeners.forEach(listener => listener());
}

export const getTheme = () => state.theme;
export const getLang = () => state.lang;

/** @param {'system'|'light'|'dark'} theme - 主题 */
export function setTheme(theme) {
    state.theme = theme;
    save();
    applyTheme();
}

/** @param {'zh'|'en'} lang - 语言 */
export function setLang(lang) {
    state.lang = lang;
    save();
}

/**
 * @param {'tree'|'chat'} name - 侧栏
 * @returns {number|undefined} 保存的宽度
 */
export const getPanelWidth = name => state.panels[name];

/**
 * @param {'tree'|'chat'} name - 侧栏
 * @param {number} width - 宽度
 */
export function setPanelWidth(name, width) {
    state.panels[name] = width;
    save();
}

/** @param {Function} listener - 主题变化时调用 */
export function onThemeChange(listener) {
    themeListeners.add(listener);
}

systemDark.addEventListener('change', applyTheme);
applyTheme();
