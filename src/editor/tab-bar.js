/**
 * @fileoverview 标签栏
 * @description 显示打开的文件，标出未写入的改动和预览状态
 * @module tab-bar
 */

import { t } from '../i18n/index.js';

const SAVED_FLASH = 500;

export class TabBar {
    /**
     * @param {HTMLElement} container - 标签栏
     * @param {Object} actions - 操作回调：onSelect(id)、onPin(id)、onClose(id)
     */
    constructor(container, actions) {
        this.container = container;
        this.actions = actions;

        container.addEventListener('wheel', (event) => {
            if (event.deltaY !== 0) {
                event.preventDefault();
                container.scrollLeft += event.deltaY;
            }
        });
    }

    /**
     * 绘制标签页
     * @param {Array<Object>} tabs - 标签页
     * @param {string|null} currentId - 当前标签页
     */
    render(tabs, currentId) {
        this.container.replaceChildren(...tabs.map(tab => this._renderTab(tab, tab.id === currentId)));
        this._revealActive();
    }

    _renderTab(tab, isActive) {
        const element = document.createElement('div');
        element.className = `tab${tab.isDirty ? ' is-dirty' : ''}${isActive ? ' is-active' : ''}${tab.isPreview ? ' is-preview' : ''}`;
        element.dataset.id = tab.id;
        element.title = tab.id;
        element.role = 'tab';
        element.setAttribute('aria-selected', String(isActive));

        const name = document.createElement('div');
        name.className = 'tab-name';
        name.textContent = tab.name;

        const actions = document.createElement('div');
        actions.className = 'tab-actions';
        const dot = document.createElement('div');
        dot.className = 'dirty-dot';
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'btn btn-close close-icon';
        close.setAttribute('aria-label', t('settings.close'));
        close.innerHTML = '<i class="codicon codicon-close"></i>';
        actions.append(dot, close);
        element.append(name, actions);

        element.addEventListener('click', () => this.actions.onSelect(tab.id));
        element.addEventListener('dblclick', () => this.actions.onPin(tab.id));
        close.addEventListener('click', (event) => {
            event.stopPropagation();
            this.actions.onClose(tab.id);
        });
        return element;
    }

    /** 让当前标签页在标签栏内可见，只滚动标签栏 */
    _revealActive() {
        const active = this.container.querySelector('.tab.is-active');
        if (!active) return;
        const bar = this.container;
        const left = active.offsetLeft - bar.offsetLeft;
        if (left < bar.scrollLeft) {
            bar.scrollLeft = left;
        } else if (left + active.offsetWidth > bar.scrollLeft + bar.clientWidth) {
            bar.scrollLeft = left + active.offsetWidth - bar.clientWidth;
        }
    }

    /**
     * 短暂标出刚保存的标签页
     * @param {string} id - 标签页
     */
    flashSaved(id) {
        const element = this.container.querySelector(`.tab[data-id="${CSS.escape(id)}"]`);
        if (!element) return;
        element.classList.add('save-success');
        setTimeout(() => element.classList.remove('save-success'), SAVED_FLASH);
    }
}
