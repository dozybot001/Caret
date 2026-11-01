/**
 * @fileoverview 设置模块
 * @description 负责设置对话框：连接模型、主题、语言、关于页面
 */

import { PROVIDERS, VERSION } from '../global/constants.js';
import { changeLanguage, getLanguage, legalText, onLanguageChange, t } from '../global/i18n.js';
import { getTheme, setTheme } from '../global/preferences.js';
import { listModels } from '../agent/model.js';

const CHECK_DELAY = 400;
const VIEWPORT_MARGIN = 16;
const POPUP_GAP = 8;

/**
 * 把浮层放在触发元素下方，空间不足时翻转到上方
 * @param {HTMLElement} popup - 浮层
 * @param {HTMLElement} anchor - 触发元素
 */
function placePopup(popup, anchor) {
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

/**
 * 设置管理器
 * @class Settings
 */
export class Settings {
    /**
     * @param {HTMLDialogElement} dialog - 设置对话框
     * @param {AppStore} store - 应用状态存储
     */
    constructor(dialog, store) {
        this.dialog = dialog;
        this.store = store;
        this.page = 'main';
        this.models = [];
        this.checkTimer = null;
        this.checkController = null;
        this.status = null;

        /** 对话框关闭时调用，用于继续等待模型的任务 */
        this.onClose = null;
        /** 连接信息变化时调用 */
        this.onConnectionChange = null;
        /** 清除 Key 后调用 */

        const find = selector => dialog.querySelector(selector);
        this.title = find('#settings-title');
        this.backButton = find('#settings-back');
        this.footer = find('.dialog-foot');
        this.providerTrigger = find('#provider-trigger');
        this.urlField = find('#field-base-url');
        this.urlInput = find('#input-base-url');
        this.keyInput = find('#input-api-key');
        this.keyLink = find('#key-link');
        this.clearKeyButton = find('#btn-clear-key');
        this.modelInput = find('#input-model-name');
        this.statusText = find('#connection-status');
        this.menu = find('#select-menu');
        this.tooltip = find('#tooltip');
    }

    /** 初始化事件绑定 */
    init() {
        const { dialog } = this;

        dialog.querySelector('#settings-close').addEventListener('click', () => dialog.close());
        dialog.querySelector('#settings-done').addEventListener('click', () => dialog.close());
        this.backButton.addEventListener('click', () => this._showPage(this.page === 'about' ? 'main' : 'about'));
        dialog.addEventListener('close', () => {
            this._hideTooltip();
            this.onClose?.();
        });

        // Esc 先关闭说明提示，再关闭对话框
        dialog.addEventListener('cancel', (event) => {
            if (this.tooltip.matches(':popover-open')) {
                event.preventDefault();
                this._hideTooltip();
            }
        });

        this.providerTrigger.addEventListener('click', () => this._openProviderMenu());
        this.urlInput.addEventListener('input', () => this._saveConnection({ customUrl: this.urlInput.value.trim() }));
        this.keyInput.addEventListener('input', () => {
            this._saveConnection({ keys: { ...this._config.keys, [this._config.provider]: this.keyInput.value.trim() } });
        });
        this.clearKeyButton.addEventListener('click', () => {
            this.keyInput.value = '';
            this._saveConnection({ keys: { ...this._config.keys, [this._config.provider]: '' } });
            this.keyInput.focus();
        });

        this.modelInput.addEventListener('input', () => {
            this._setModel(this.modelInput.value.trim());
            this._openModelMenu();
        });
        this.modelInput.addEventListener('focus', () => this._openModelMenu());
        this.modelInput.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown' && this.menu.firstChild) {
                event.preventDefault();
                this.menu.firstChild.focus();
            } else if (event.key === 'Tab' && this.menu.matches(':popover-open')) {
                this.menu.hidePopover();
            }
        });

        this.menu.addEventListener('keydown', (event) => this._moveInMenu(event));

        dialog.querySelectorAll('[data-theme-option]').forEach(button => {
            button.addEventListener('click', () => {
                setTheme(button.dataset.themeOption);
                this._renderChoices();
            });
        });
        dialog.querySelectorAll('[data-lang-option]').forEach(button => {
            button.addEventListener('click', () => {
                changeLanguage(button.dataset.langOption);
                this._renderChoices();
            });
        });
        dialog.querySelectorAll('[data-go]').forEach(button => {
            button.addEventListener('click', () => this._showPage(button.dataset.go));
        });

        dialog.querySelectorAll('.info').forEach(button => this._bindTooltip(button));
        document.addEventListener('click', (event) => {
            if (!event.target.closest('.info')) this._hideTooltip();
        });

        dialog.querySelector('#about-version').textContent = VERSION;
        onLanguageChange(() => {
            this._showPage(this.page);
            this._renderConnection();
            this._renderStatus();
        });
    }

    get _config() {
        return this.store.getConfig();
    }

    /**
     * 打开设置
     * @param {string} page - 页面
     */
    open(page = 'main') {
        this._showPage(page);
        this._renderConnection();
        this._renderChoices();
        if (!this.dialog.open) this.dialog.showModal();
        this._checkConnection();
    }

    /**
     * 当前模型连接
     * @returns {{url: string, key: string, model: string}}
     */
    getConnection() {
        const { provider, keys, models, customUrl } = this._config;
        return {
            url: provider === 'custom' ? customUrl : PROVIDERS[provider].url,
            key: keys[provider] || '',
            model: models[provider] || ''
        };
    }

    /** @returns {boolean} 模型连接是否完整。自定义服务可以不需要 Key，例如本地模型 */
    isReady() {
        const { url, key, model } = this.getConnection();
        return Boolean(url && model && (key || this._config.provider === 'custom'));
    }

    /** @returns {string} 显示在输入框下方的模型名称 */
    getModelLabel() {
        return this.isReady() ? this.getConnection().model : t('model.connect');
    }

    _providerName(id) {
        return PROVIDERS[id].name || t('settings.custom');
    }

    _showPage(page) {
        this.page = page;
        this.dialog.querySelectorAll('[data-page]').forEach(section => {
            section.classList.toggle('hidden', section.dataset.page !== page);
        });
        const titles = { main: 'settings.title', about: 'settings.about', privacy: 'about.privacy', terms: 'about.terms' };
        this.title.textContent = t(titles[page]);
        this.backButton.classList.toggle('hidden', page === 'main');
        this.footer.classList.toggle('hidden', page !== 'main');
        if (page === 'privacy' || page === 'terms') this._renderLegal(page);
        this.dialog.querySelector('.dialog-body').scrollTop = 0;
    }

    _renderLegal(page) {
        const container = this.dialog.querySelector(`[data-page="${page}"] .legal-body`);
        container.replaceChildren();
        for (const [heading, body] of legalText(page)) {
            const title = document.createElement('h3');
            title.textContent = heading;
            const paragraph = document.createElement('p');
            paragraph.textContent = body;
            container.append(title, paragraph);
        }
    }

    _renderConnection() {
        const { provider, customUrl } = this._config;
        const { key, model } = this.getConnection();
        const { keyPage } = PROVIDERS[provider];

        this.providerTrigger.querySelector('span').textContent = this._providerName(provider);
        this.urlField.classList.toggle('hidden', provider !== 'custom');
        if (this.urlInput.value !== customUrl) this.urlInput.value = customUrl;
        if (this.keyInput.value !== key) this.keyInput.value = key;
        if (document.activeElement !== this.modelInput) this.modelInput.value = model;
        this.keyLink.classList.toggle('hidden', !keyPage);
        this.keyLink.href = keyPage || '#';
        this.clearKeyButton.classList.toggle('hidden', !key);
    }

    _renderChoices() {
        this.dialog.querySelectorAll('[data-theme-option]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.themeOption === getTheme()));
        });
        this.dialog.querySelectorAll('[data-lang-option]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.langOption === getLanguage()));
        });
    }

    /**
     * 显示连接状态
     * @param {Object|null} status - { key, args, kind }
     */
    _setStatus(status) {
        this.status = status;
        this._renderStatus();
    }

    _renderStatus() {
        this.statusText.textContent = this.status ? t(this.status.key, ...(this.status.args || [])) : '';
        this.statusText.dataset.kind = this.status?.kind || '';
    }

    async _saveConnection(changes) {
        await this.store.updateConfig(changes);
        this._renderConnection();
        this.onConnectionChange?.();
        clearTimeout(this.checkTimer);
        this.checkTimer = setTimeout(() => this._checkConnection(), CHECK_DELAY);
    }

    _setModel(model) {
        const { provider, models } = this._config;
        this.store.updateConfig({ models: { ...models, [provider]: model } }).then(() => {
            this.onConnectionChange?.();
        });
    }

    /** 读取模型列表，既验证连接，也免去手动填写模型名称 */
    async _checkConnection() {
        this.checkController?.abort();
        const connection = this.getConnection();
        const { provider } = this._config;
        this.models = [];
        if (!connection.url || (!connection.key && provider !== 'custom')) {
            this._setStatus(null);
            return;
        }

        const controller = new AbortController();
        this.checkController = controller;
        this._setStatus({ key: 'settings.checking', kind: 'pending' });
        try {
            this.models = await listModels(connection, controller.signal);
            this._setStatus({ key: 'settings.connected', args: [this.models.length], kind: 'ok' });
            if (!this.models.includes(connection.model)) {
                const { prefer } = PROVIDERS[provider];
                const preferred = this.models.find(id => prefer?.test(id)) || this.models[0];
                if (preferred) {
                    this._setModel(preferred);
                    this.modelInput.value = preferred;
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') return;
            if (error.status === 401 || error.status === 403) {
                this._setStatus({ key: 'error.auth', kind: 'error' });
            } else if (error.status) {
                this._setStatus({ key: 'settings.noList', kind: 'pending' });
            } else {
                this._setStatus({ key: 'error.network', kind: 'error' });
            }
        }
    }

    _openProviderMenu() {
        const options = Object.keys(PROVIDERS).map(id => ({ value: id, label: this._providerName(id) }));
        this._openMenu(this.providerTrigger, options, this._config.provider, (provider) => {
            this._saveConnection({ provider });
            this.modelInput.value = '';
        });
        this.menu.querySelector('[aria-selected="true"]')?.focus();
    }

    _openModelMenu() {
        const query = this.modelInput.value.trim().toLowerCase();
        const current = this.getConnection().model;
        const matches = this.models.filter(id => id === current || id.toLowerCase().includes(query));
        const options = (matches.length > 0 ? matches : this.models).map(id => ({ value: id, label: id }));
        if (options.length === 0) {
            if (this.menu.matches(':popover-open')) this.menu.hidePopover();
            return;
        }
        this._openMenu(this.modelInput, options, current, (model) => {
            this.modelInput.value = model;
            this._setModel(model);
        });
    }

    _openMenu(anchor, options, current, onPick) {
        const { menu } = this;
        menu.replaceChildren(...options.map(({ value, label }) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'select-option';
            option.role = 'option';
            option.textContent = label;
            option.setAttribute('aria-selected', String(value === current));
            option.addEventListener('click', () => {
                onPick(value);
                menu.hidePopover();
                anchor.focus({ preventScroll: true });
            });
            return option;
        }));
        menu.style.minWidth = `${anchor.offsetWidth}px`;
        if (!menu.matches(':popover-open')) menu.showPopover();
        placePopup(menu, anchor);
    }

    _moveInMenu(event) {
        const options = [...this.menu.children];
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

    _bindTooltip(button) {
        const show = () => {
            this.tooltip.textContent = t(button.dataset.tip);
            if (!this.tooltip.matches(':popover-open')) this.tooltip.showPopover();
            placePopup(this.tooltip, button);
        };
        button.addEventListener('mouseenter', show);
        button.addEventListener('focus', show);
        button.addEventListener('mouseleave', () => this._hideTooltip());
        button.addEventListener('blur', () => this._hideTooltip());
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            show();
        });
    }

    _hideTooltip() {
        if (this.tooltip.matches(':popover-open')) this.tooltip.hidePopover();
    }
}
