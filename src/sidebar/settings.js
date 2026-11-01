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
const MENU_MIN_WIDTH = 200;
/** 点击触发按钮时，浏览器会先关闭菜单再触发点击，这段时间内不重新打开 */
const MENU_REOPEN_DELAY = 200;
/** 选项超过这个数量时显示搜索框 */
const SEARCH_THRESHOLD = 8;
/** 模型菜单里打开设置的选项 */
const OPEN_SETTINGS = Symbol('open settings');

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
        /** 输入栏选择的模型，只在当前对话有效 */
        this.sessionModel = null;
        this.menuClosedAt = -Infinity;

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
        this.modelTrigger = find('#model-trigger');
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

        this.modelTrigger.addEventListener('click', () => this._openModelMenu());

        this.menu.addEventListener('keydown', (event) => this._moveInMenu(event));
        this.menu.addEventListener('beforetoggle', (event) => {
            if (event.newState === 'closed') this.menuClosedAt = performance.now();
        });

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
            model: this.sessionModel || models[provider] || ''
        };
    }

    _defaultModel() {
        const { provider, models } = this._config;
        return models[provider] || '';
    }

    /**
     * 只为当前对话换模型，新任务回到默认模型
     * @param {string} model - 模型名称
     */
    useSessionModel(model) {
        this.sessionModel = model === this._defaultModel() ? null : model;
        this.onConnectionChange?.();
    }

    /** 回到默认模型 */
    resetSessionModel() {
        this.sessionModel = null;
        this.onConnectionChange?.();
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
        const { key } = this.getConnection();
        const model = this._defaultModel();
        const { keyPage } = PROVIDERS[provider];

        this.providerTrigger.querySelector('span').textContent = this._providerName(provider);
        this.urlField.classList.toggle('hidden', provider !== 'custom');
        if (this.urlInput.value !== customUrl) this.urlInput.value = customUrl;
        if (this.keyInput.value !== key) this.keyInput.value = key;
        const modelLabel = this.modelTrigger.querySelector('span');
        modelLabel.textContent = model || t('settings.chooseModel');
        modelLabel.classList.toggle('is-placeholder', !model);
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

    /** 设置默认模型 */
    async _setModel(model) {
        const { provider, models } = this._config;
        this.sessionModel = null;
        await this.store.updateConfig({ models: { ...models, [provider]: model } });
        this._renderConnection();
        this.onConnectionChange?.();
    }

    /** 读取模型列表，既验证连接，也免去手动填写模型名称 */
    async _checkConnection() {
        this.checkController?.abort();
        const connection = this.getConnection();
        const { provider, modelLists } = this._config;
        this.models = modelLists[provider] || [];
        if (!connection.url || (!connection.key && provider !== 'custom')) {
            this._setStatus(null);
            return;
        }

        const controller = new AbortController();
        this.checkController = controller;
        this._setStatus({ key: 'settings.checking', kind: 'pending' });
        try {
            this.models = await listModels(connection, controller.signal);
            this._cacheModels(provider, this.models);
            this._setStatus({ key: 'settings.connected', args: [this.models.length], kind: 'ok' });
            if (!this._defaultModel()) {
                const { prefer } = PROVIDERS[provider];
                const preferred = this.models.find(id => prefer?.test(id)) || this.models[0];
                if (preferred) this._setModel(preferred);
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

    /** 记住模型列表，打开输入栏的菜单时不用等网络 */
    _cacheModels(provider, models) {
        const { modelLists } = this._config;
        return this.store.updateConfig({ modelLists: { ...modelLists, [provider]: models } });
    }

    /**
     * 输入栏的模型菜单：列出当前服务商的模型，选中后下一次请求生效。
     * 换服务商留在设置里，不同服务商的对话消息格式不完全相同
     * @param {HTMLElement} anchor - 触发按钮
     */
    async openModelSwitcher(anchor) {
        if (this._menuJustClosed()) return;
        if (!this.isReady()) {
            this.open();
            return;
        }

        const { provider } = this._config;
        this._showModelSwitcher(anchor);
        try {
            await this._cacheModels(provider, await listModels(this.getConnection()));
            const isStillOpen = this.menu.matches(':popover-open') && this.menu.parentElement === document.body;
            if (isStillOpen && this._config.provider === provider) this._showModelSwitcher(anchor);
        } catch {
            // 网络失败时继续用记住的列表
        }
    }

    _showModelSwitcher(anchor) {
        const { provider, modelLists } = this._config;
        const { model: current } = this.getConnection();
        const defaultModel = this._defaultModel();
        const ids = [...new Set([...(modelLists[provider] || []), defaultModel, current])].filter(Boolean);
        const options = ids.map(id => ({ value: id, label: id === defaultModel ? `${id} · ${t('model.default')}` : id }));

        this._openMenu(anchor, options, current, (value) => {
            if (value === OPEN_SETTINGS) this.open();
            else this.useSessionModel(value);
        }, {
            searchable: ids.length > SEARCH_THRESHOLD,
            footer: { value: OPEN_SETTINGS, label: t('model.settings'), className: 'is-action' }
        });
    }

    /** 判断这次点击是否刚好由触发按钮关闭了菜单 */
    _menuJustClosed() {
        return performance.now() - this.menuClosedAt < MENU_REOPEN_DELAY;
    }

    _openProviderMenu() {
        if (this._menuJustClosed()) return;
        const options = Object.keys(PROVIDERS).map(id => ({ value: id, label: this._providerName(id) }));
        this._openMenu(this.providerTrigger, options, this._config.provider, (provider) => {
            this.sessionModel = null;
            this._saveConnection({ provider });
        });
    }

    /** 默认模型的下拉菜单：可以搜索，也可以直接填写列表里没有的模型名称 */
    _openModelMenu() {
        if (this._menuJustClosed()) return;
        const current = this._defaultModel();
        const ids = [...new Set([...this.models, current])].filter(Boolean);
        const options = ids.map(id => ({ value: id, label: id }));
        this._openMenu(this.modelTrigger, options, current, model => this._setModel(model), {
            searchable: true,
            allowCustom: true
        });
    }

    /**
     * 打开下拉菜单
     * @private
     * @param {HTMLElement} anchor - 触发元素
     * @param {Array<{value: *, label: string, className: string}>} options - 选项
     * @param {*} current - 当前值
     * @param {Function} onPick - 选中时调用
     * @param {Object} settings - 设置
     * @param {boolean} settings.searchable - 显示搜索框
     * @param {boolean} settings.allowCustom - 允许使用列表外的输入
     * @param {Object} settings.footer - 固定在列表下方、不参与搜索的选项
     */
    _openMenu(anchor, options, current, onPick, { searchable = false, allowCustom = false, footer = null } = {}) {
        const { menu } = this;
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

    _moveInMenu(event) {
        const options = [...this.menu.querySelectorAll('.select-search, .select-option')];
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
