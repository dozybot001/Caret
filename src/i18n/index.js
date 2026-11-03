/**
 * @fileoverview 界面文案
 * @description 取文案和切换语言。静态文案用 data-i18n 属性标记，动态文案调用 t()，文案本身在 zh.js 和 en.js
 */

import { getLang, setLang } from '../app/preferences.js';
import { ARTICLES } from './articles.js';
import { en } from './en.js';
import { zh } from './zh.js';

const MESSAGES = { zh, en };

const languageListeners = new Set();

/** @returns {'zh'|'en'} 当前语言 */
export const getLanguage = getLang;

/**
 * 取文案
 * @param {string} key - 文案键
 * @param {...*} args - 动态文案的参数
 * @returns {string}
 */
export function t(key, ...args) {
    const value = MESSAGES[getLang()][key] ?? key;
    return typeof value === 'function' ? value(...args) : value;
}

/**
 * 显示日期和时刻：中文写成「11 月 3 日 14:05」，英文写成「Nov 3, 02:05 PM」，不是今年的加上年份
 * @param {number|Date} time - 时间
 * @param {'zh'|'en'} lang - 语言
 * @returns {string}
 */
export function formatDateTime(time, lang = getLang()) {
    const date = new Date(time);
    const withYear = date.getFullYear() !== new Date().getFullYear();
    if (lang === 'zh') {
        const clock = [date.getHours(), date.getMinutes()].map(value => String(value).padStart(2, '0')).join(':');
        return `${withYear ? `${date.getFullYear()} 年 ` : ''}${date.getMonth() + 1} 月 ${date.getDate()} 日 ${clock}`;
    }
    return new Intl.DateTimeFormat('en-US', {
        ...(withYear ? { year: 'numeric' } : {}),
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

/**
 * 取法律文本
 * @param {'privacy'|'terms'} page - 页面
 * @returns {Array<[string, string]>} 标题和正文
 */
export const articleText = page => ARTICLES[getLang()][page];

/**
 * 更新页面上的静态文案
 * @param {ParentNode} root - 根节点
 */
export function applyTranslations(root = document) {
    document.documentElement.lang = getLang() === 'zh' ? 'zh-CN' : 'en';
    root.querySelectorAll('[data-i18n]').forEach(element => {
        element.textContent = t(element.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-title]').forEach(element => {
        element.title = t(element.dataset.i18nTitle);
        element.setAttribute('aria-label', element.title);
    });
    root.querySelectorAll('[data-i18n-label]').forEach(element => {
        element.setAttribute('aria-label', t(element.dataset.i18nLabel));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
        element.placeholder = t(element.dataset.i18nPlaceholder);
    });
}

/** @param {Function} listener - 语言变化时调用 */
export function onLanguageChange(listener) {
    languageListeners.add(listener);
}

/**
 * 切换语言，输入内容和运行中的操作不受影响
 * @param {'zh'|'en'} lang - 语言
 */
export function changeLanguage(lang) {
    setLang(lang);
    applyTranslations();
    languageListeners.forEach(listener => listener());
}
