/**
 * @fileoverview 下拉菜单
 * @description 设置和输入栏共用的弹出列表，支持搜索、键盘移动和手动输入
 * @module select-menu
 */

import { t } from '../i18n/index.js';

const VIEWPORT_MARGIN = 16;
const POPUP_GAP = 8;
const MENU_MIN_WIDTH = 200;
/** 点击触发按钮时，浏览器会先关闭菜单再触发点击，这段时间内不重新打开 */
const MENU_REOPEN_DELAY = 200;

/**
 * 把浮层放在触发元素下方，空间不足时翻转到上方
 * @param {HTMLElement} popup - 浮层
 * @param {HTMLElement} anchor - 触发元素
 */
export function placePopup(popup, anchor) {
    const anchorRect = anchor.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const left = Math.max(VIEWPORT_MARGIN, Math.min(anchorRect.left, innerWidth - popupRect.width - VIEWPORT_MARGIN));
    let top = anchorRect.bottom + POPUP_GAP;
    if (top + popupRect.height > innerHeight - VIEWPORT_MARGIN) {
        top = Math.max(VIEWPORT_MARGIN, anchorRect.top - popupRect.height - POPUP_GAP);
    }
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
}

export class SelectMenu {
    /** @param {HTMLElement} element - 带 popover 属性的菜单元素 */
    constructor(element) {
        this.element = element;
        this.anchor = null;
        this.closedAt = -Infinity;

        element.addEventListener('keydown', event => this._move(event));
        element.addEventListener('beforetoggle', (event) => {
            if (event.newState === 'closed') this.closedAt = performance.now();
        });
    }

    get isOpen() {
        return this.element.matches(':popover-open');
    }

    /** 判断这次点击是否刚好由触发按钮关闭了菜单 */
    justClosed() {
        return performance.now() - this.closedAt < MENU_REOPEN_DELAY;
    }

    /**
     * 打开下拉菜单
     * @param {HTMLElement} anchor - 触发元素
     * @param {Array<{value: *, label: string, className: string}>} options - 选项
     * @param {*} current - 当前值
     * @param {Function} onPick - 选中时调用
     * @param {Object} settings - 设置
     * @param {boolean} settings.searchable - 显示搜索框
     * @param {boolean} settings.allowCustom - 允许使用列表外的输入
     * @param {Object} settings.footer - 固定在列表下方、不参与搜索的选项
     */
    open(anchor, options, current, onPick, { searchable = false, allowCustom = false, footer = null } = {}) {
        const menu = this.element;
        this.anchor = anchor;
        // 对话框打开时外部内容不可操作，关闭时里面的内容不显示，所以菜单跟着触发元素走
        const container = anchor.closest('dialog') || document.body;
        if (menu.parentElement !== container) container.appendChild(menu);

        const createOption = ({ value, label, className = '' }) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = `select-option ${className}`.trim();
            option.role = 'option';
            option.textContent = label;
            option.setAttribute('aria-selected', String(value === current));
            option.addEventListener('click', () => {
                onPick(value);
                menu.hidePopover();
                anchor.focus({ preventScroll: true });
            });
            return option;
        };

        const list = document.createElement('div');
        list.className = 'select-options';

        const renderOptions = (query = '') => {
            const text = query.trim();
            const matches = options.filter(option => option.label.toLowerCase().includes(text.toLowerCase()));
            const rows = matches.map(createOption);
            if (allowCustom && text && !options.some(option => option.value === text)) {
                rows.push(createOption({ value: text, label: t('settings.useModel', text) }));
            }
            if (rows.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'select-empty';
                empty.textContent = t(allowCustom ? 'settings.typeModel' : 'settings.noModels');
                rows.push(empty);
            }
            list.replaceChildren(...rows);
            if (menu.matches(':popover-open')) placePopup(menu, anchor);
        };

        const sections = [list];
        let search = null;
        if (searchable) {
            search = document.createElement('input');
            search.type = 'text';
            search.className = 'select-search';
            search.placeholder = t(allowCustom ? 'settings.searchOrTypeModel' : 'settings.searchModel');
            search.autocomplete = 'off';
            search.spellcheck = false;
            search.setAttribute('aria-label', search.placeholder);
            search.addEventListener('input', () => renderOptions(search.value));
            search.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' || event.isComposing) return;
                event.preventDefault();
                list.querySelector('.select-option')?.click();
            });
            sections.unshift(search);
        }
        if (footer) sections.push(createOption(footer));

        menu.replaceChildren(...sections);
        renderOptions();
        menu.style.minWidth = `${Math.max(anchor.offsetWidth, MENU_MIN_WIDTH)}px`;
        if (!menu.matches(':popover-open')) menu.showPopover();
        placePopup(menu, anchor);
        (search || list.querySelector('[aria-selected="true"]') || list.querySelector('.select-option'))?.focus();
        list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    }

    _move(event) {
        const options = [...this.element.querySelectorAll('.select-search, .select-option')];
        const index = options.indexOf(document.activeElement);
        const target = {
            ArrowDown: options[Math.min(index + 1, options.length - 1)],
            ArrowUp: options[Math.max(index - 1, 0)],
            Home: options[0],
            End: options[options.length - 1]
        }[event.key];
        if (target) {
            event.preventDefault();
            target.focus();
        }
    }
}
