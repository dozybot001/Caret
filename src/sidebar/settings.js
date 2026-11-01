/**
 * @fileoverview 设置模块
 * @description 负责设置对话框：左侧导航、模型连接、各项偏好、本地数据和关于页面
 */

import { DEFAULT_PREFERENCES, PROVIDERS, VERSION } from '../global/constants.js';
import { articleText, changeLanguage, getLanguage, onLanguageChange, t } from '../global/i18n.js';
import { getTheme, setTheme } from '../global/preferences.js';
import { listModels } from '../agent/model.js';

/** 设置的页面。有 parent 的是子页面：导航停在上级，可以返回 */
const PAGES = {
    model: { title: 'settings.model', tip: 'settings.modelTip' },
    agent: { title: 'settings.agent' },
    editor: { title: 'settings.editor' },
    files: { title: 'settings.files' },
    appearance: { title: 'settings.appearance' },
    data: { title: 'settings.data', tip: 'settings.dataTip' },
    about: { title: 'settings.about' },
    context: { title: 'context.title', parent: 'agent' },
    privacy: { title: 'about.privacy', parent: 'about' },
    terms: { title: 'about.terms', parent: 'about' }
};

/** 输入停下这么久后再保存或检查连接 */
const INPUT_DELAY = 400;
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
        this.page = 'model';
        this.models = [];
        this.checkTimer = null;
        this.checkController = null;
        this.status = null;
        this.dataStatus = null;
        /** 这次是否拿到了接口返回的模型列表，拿不到时才允许手动填写 */
        this.hasModelList = false;
        /** 输入栏选择的模型和推理强度，只在当前对话有效 */
        this.sessionModel = null;
        this.sessionEffort = null;
        this.menuClosedAt = -Infinity;
        this.menuAnchor = null;

        /** 对话框关闭时调用，用于继续等待模型的任务 */
        this.onClose = null;
        /** 连接信息变化时调用 */
        this.onConnectionChange = null;
        /** 偏好变化时调用，参数是这次改动的设置 */
        this.onPreferencesChange = null;
        /** 返回 Agent 是否在运行，运行时不清除数据 */
        this.isBusy = null;
        /** 确认后清空全部对话 */
        this.onClearConversations = null;
        /** 确认后清除全部本地数据 */
        this.onDeleteAll = null;

        const find = selector => dialog.querySelector(selector);
        this.title = find('#settings-title');
        this.titleInfo = find('#settings-info');
        this.backButton = find('#settings-back');
        this.providerTrigger = find('#provider-trigger');
        this.urlField = find('#field-base-url');
        this.urlInput = find('#input-base-url');
        this.keyInput = find('#input-api-key');
        this.keyLink = find('#key-link');
        this.clearKeyButton = find('#btn-clear-key');
        this.modelTrigger = find('#model-trigger');
        this.effortField = find('#field-effort');
        this.effortTrigger = find('#effort-trigger');
        this.statusText = find('#connection-status');
        this.dataUsage = find('#data-usage');
        this.dataStatusText = find('#data-status');
        this.menu = find('#select-menu');
        this.tooltip = find('#tooltip');
    }

    /** 初始化事件绑定 */
    init() {
        const { dialog } = this;

        dialog.querySelector('#settings-close').addEventListener('click', () => dialog.close());
        this.backButton.addEventListener('click', () => this._showPage(PAGES[this.page].parent));
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
        this.effortTrigger.addEventListener('click', () => this._openEffortMenu());

        this.menu.addEventListener('keydown', (event) => this._moveInMenu(event));
        this.menu.addEventListener('beforetoggle', (event) => {
            if (event.newState === 'closed') this.menuClosedAt = performance.now();
        });

        dialog.querySelectorAll('[data-theme-option]').forEach(button => {
            button.addEventListener('click', () => {
                setTheme(button.dataset.themeOption);
                this._renderPreferences();
            });
        });
        dialog.querySelectorAll('[data-lang-option]').forEach(button => {
            button.addEventListener('click', () => {
                changeLanguage(button.dataset.langOption);
                this._renderPreferences();
            });
        });
        dialog.querySelectorAll('[data-setting]').forEach(control => this._bindPreference(control));
        dialog.querySelector('#send-key-mod').textContent = `${navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl'} Enter`;
        dialog.querySelectorAll('[data-go]').forEach(button => {
            button.addEventListener('click', () => this._showPage(button.dataset.go));
        });
        this._bindDataActions();

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
    open(page = 'model') {
        this.dataStatus = null;
        this._showPage(page);
        this._renderConnection();
        this._renderPreferences();
        if (!this.dialog.open) {
            this.dialog.showModal();
            // 焦点放在对话框本身，打开时不高亮关闭按钮
            this.dialog.focus();
        }
        this._checkConnection();
    }

    /**
     * 当前模型连接
     * @returns {{url: string, key: string, model: string, effort: string}} 没有选择推理强度时 effort 为空，请求里不带这个参数
     */
    getConnection() {
        const { provider, keys, models, customUrl, efforts } = this._config;
        const model = this.sessionModel || models[provider] || '';
        const { levels } = this._effortsOf(model);
        return {
            url: provider === 'custom' ? customUrl : PROVIDERS[provider].url,
            key: keys[provider] || '',
            model,
            effort: [this.sessionEffort, efforts[provider]].find(level => levels.includes(level)) || ''
        };
    }

    _defaultModel() {
        const { provider, models } = this._config;
        return models[provider] || '';
    }

    /** 接口返回的这个模型的推理档位 */
    _effortsOf(model) {
        const { provider, modelEfforts } = this._config;
        return modelEfforts[provider]?.[model] || { levels: [], defaultLevel: '' };
    }

    /** 没有在输入栏切换时使用的强度：设置里保存的值，模型不支持时用模型自己的默认值 */
    _defaultEffort(model) {
        const { provider, efforts } = this._config;
        const { levels, defaultLevel } = this._effortsOf(model);
        return levels.includes(efforts[provider]) ? efforts[provider] : defaultLevel;
    }

    /**
     * 只为当前对话换模型，新任务回到默认模型
     * @param {string} model - 模型名称
     */
    useSessionModel(model) {
        this.sessionModel = model === this._defaultModel() ? null : model;
        this.onConnectionChange?.();
    }

    /**
     * 只为当前对话换推理强度，新任务回到默认值
     * @param {string} level - 接口返回的档位
     */
    useSessionEffort(level) {
        this.sessionEffort = level === this._defaultEffort(this.getConnection().model) ? null : level;
        this.onConnectionChange?.();
    }

    /** 回到默认模型和推理强度 */
    resetSession() {
        this.sessionModel = null;
        this.sessionEffort = null;
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

    /** @returns {string} 显示在输入框下方的推理强度，模型没有档位时为空 */
    getEffortLabel() {
        const { model, effort } = this.getConnection();
        const { levels, defaultLevel } = this._effortsOf(model);
        if (!this.isReady() || levels.length === 0) return '';
        return effort || defaultLevel || t('model.default');
    }

    _providerName(id) {
        return PROVIDERS[id].name || t('settings.custom');
    }

    _showPage(page) {
        const { title, tip, parent } = PAGES[page];
        this.page = page;
        this.dialog.querySelectorAll('[data-page]').forEach(section => {
            section.classList.toggle('hidden', section.dataset.page !== page);
        });
        this.dialog.querySelectorAll('.settings-nav-item').forEach((item) => {
            if (item.dataset.go === (parent || page)) item.setAttribute('aria-current', 'page');
            else item.removeAttribute('aria-current');
        });
        this.title.textContent = t(title);
        this.titleInfo.classList.toggle('hidden', !tip);
        if (tip) this.titleInfo.dataset.tip = tip;
        this.backButton.classList.toggle('hidden', !parent);
        if (articleText(page)) this._renderArticle(page);
        if (page === 'data') this._renderData();
        this.dialog.querySelector('.dialog-body').scrollTop = 0;
    }

    _renderArticle(page) {
        const container = this.dialog.querySelector(`[data-page="${page}"] .article-body`);
        container.replaceChildren();
        for (const [heading, body] of articleText(page)) {
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
        this.effortField.classList.toggle('hidden', this._effortsOf(model).levels.length === 0);
        this.effortTrigger.querySelector('span').textContent = this._defaultEffort(model) || t('model.default');
        this.keyLink.classList.toggle('hidden', !keyPage);
        this.keyLink.href = keyPage || '#';
        this.clearKeyButton.classList.toggle('hidden', !key);
    }

    /**
     * 把控件和同名设置绑定：分段选择、胶囊开关或文本框
     * @private
     * @param {HTMLElement} control - 带 data-setting 的控件
     */
    _bindPreference(control) {
        const key = control.dataset.setting;
        if (control.matches('.segments')) {
            control.addEventListener('click', (event) => {
                const value = event.target.closest('[data-value]')?.dataset.value;
                if (value === undefined) return;
                this._savePreferences({ [key]: typeof DEFAULT_PREFERENCES[key] === 'number' ? Number(value) : value });
            });
        } else if (control.matches('.switch')) {
            control.addEventListener('click', () => this._savePreferences({ [key]: !this._config[key] }));
        } else {
            let timer = null;
            control.addEventListener('input', () => {
                clearTimeout(timer);
                timer = setTimeout(() => this._savePreferences({ [key]: control.value }), INPUT_DELAY);
            });
        }
    }

    _renderPreferences() {
        this.dialog.querySelectorAll('[data-theme-option]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.themeOption === getTheme()));
        });
        this.dialog.querySelectorAll('[data-lang-option]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.langOption === getLanguage()));
        });
        this.dialog.querySelectorAll('[data-setting]').forEach((control) => {
            const value = this._config[control.dataset.setting];
            if (control.matches('.segments')) {
                control.querySelectorAll('[data-value]').forEach((button) => {
                    button.setAttribute('aria-pressed', String(button.dataset.value === String(value)));
                });
            } else if (control.matches('.switch')) {
                control.setAttribute('aria-checked', String(value));
            } else if (document.activeElement !== control) {
                // 保存有延迟，不能覆盖用户正在输入的内容
                control.value = value;
            }
        });
    }

    async _savePreferences(changes) {
        await this.store.updateConfig(changes);
        this._renderPreferences();
        this.onPreferencesChange?.(changes);
    }

    _bindDataActions() {
        const bind = (selector, copy, action) => {
            const button = this.dialog.querySelector(selector);
            button.addEventListener('click', () => this._runDataAction(button, copy, action));
        };
        bind('#btn-clear-conversations', { confirm: 'settings.clearConversationsConfirm', done: 'settings.conversationsCleared' },
            () => this.onClearConversations?.());
        bind('#btn-reset-preferences', { confirm: 'settings.resetPreferencesConfirm', done: 'settings.preferencesReset' },
            () => this._resetPreferences());
        bind('#btn-delete-all', { confirm: 'settings.deleteAllConfirm' }, () => this.onDeleteAll?.());
    }

    /**
     * 执行数据页的操作：确认后立刻显示等待状态，结果写在页面上。
     * 通知条在对话框下层看不到，所以这里不用通知
     * @private
     * @param {HTMLButtonElement} button - 触发按钮
     * @param {{confirm: string, done: string}} copy - 确认和完成时的文案键
     * @param {Function} action - 操作
     */
    async _runDataAction(button, { confirm, done }, action) {
        if (this.isBusy?.()) {
            this.dataStatus = { key: 'settings.dataBusy', kind: 'error' };
            this._renderData();
            return;
        }
        if (!(await window.notify.confirm(t(confirm), button.textContent))) return;

        button.classList.add('is-loading');
        button.disabled = true;
        try {
            await action();
            this.dataStatus = { key: done, kind: 'ok' };
        } catch (error) {
            this.dataStatus = { key: 'error.generic', args: [error.message], kind: 'error' };
        }
        button.classList.remove('is-loading');
        button.disabled = false;
        await this._renderData();
    }

    async _resetPreferences() {
        await this.store.updateConfig(DEFAULT_PREFERENCES);
        setTheme('system');
        this._renderPreferences();
        this.onPreferencesChange?.(DEFAULT_PREFERENCES);
    }

    /** 显示本地数据的用量和上一次操作的结果 */
    async _renderData() {
        this._drawStatus(this.dataStatusText, this.dataStatus);
        const [sessions, storage] = await Promise.all([this.store.listSessions(), navigator.storage?.estimate?.()]);
        const parts = [t('settings.storageCount', sessions.length)];
        if (storage) parts.unshift(t('settings.storageSize', (storage.usage / 1024 / 1024).toFixed(1)));
        this.dataUsage.textContent = parts.join(' · ');
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
        this._drawStatus(this.statusText, this.status);
    }

    _drawStatus(element, status) {
        element.textContent = status ? t(status.key, ...(status.args || [])) : '';
        element.dataset.kind = status?.kind || '';
    }

    async _saveConnection(changes) {
        await this.store.updateConfig(changes);
        this._renderConnection();
        this.onConnectionChange?.();
        clearTimeout(this.checkTimer);
        this.checkTimer = setTimeout(() => this._checkConnection(), INPUT_DELAY);
    }

    /** 设置默认模型 */
    async _setModel(model) {
        const { provider, models } = this._config;
        this.sessionModel = null;
        this.sessionEffort = null;
        await this.store.updateConfig({ models: { ...models, [provider]: model } });
        this._renderConnection();
        this.onConnectionChange?.();
    }

    /** 设置默认推理强度 */
    async _setEffort(level) {
        const { provider, efforts } = this._config;
        this.sessionEffort = null;
        await this.store.updateConfig({ efforts: { ...efforts, [provider]: level } });
        this._renderConnection();
        this.onConnectionChange?.();
    }

    /** 读取模型列表，既验证连接，也免去手动填写模型名称 */
    async _checkConnection() {
        this.checkController?.abort();
        const connection = this.getConnection();
        const { provider, modelLists } = this._config;
        this.models = modelLists[provider] || [];
        this.hasModelList = false;
        if (!connection.url || (!connection.key && provider !== 'custom')) {
            this._setStatus(null);
            return;
        }

        const controller = new AbortController();
        this.checkController = controller;
        this._setStatus({ key: 'settings.checking', kind: 'pending' });
        try {
            const models = await listModels(connection, controller.signal);
            this.models = models.map(model => model.id);
            this.hasModelList = true;
            await this._cacheModels(provider, models);
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

    /** 记住模型列表和推理档位，打开输入栏的菜单时不用等网络 */
    async _cacheModels(provider, models) {
        const { modelLists, modelEfforts } = this._config;
        await this.store.updateConfig({
            modelLists: { ...modelLists, [provider]: models.map(model => model.id) },
            modelEfforts: {
                ...modelEfforts,
                [provider]: Object.fromEntries(models
                    .filter(model => model.levels.length > 0)
                    .map(({ id, levels, defaultLevel }) => [id, { levels, defaultLevel }]))
            }
        });
        this._renderConnection();
        this.onConnectionChange?.();
    }

    /** 从接口更新模型和推理档位，失败时继续用记住的列表 */
    async refreshModels() {
        if (!this.isReady()) return;
        try {
            await this._cacheModels(this._config.provider, await listModels(this.getConnection()));
        } catch {
            // 下次打开菜单时再试
        }
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

        this._openSwitcher(anchor, () => this._showModelSwitcher(anchor));
    }

    /**
     * 输入栏的推理强度菜单：列出接口返回的档位，选中后下一次请求生效
     * @param {HTMLElement} anchor - 触发按钮
     */
    openEffortSwitcher(anchor) {
        if (this._menuJustClosed()) return;
        this._openSwitcher(anchor, () => this._showEffortSwitcher(anchor));
    }

    /** 先用记住的内容打开菜单，接口返回后再更新 */
    async _openSwitcher(anchor, show) {
        const { provider } = this._config;
        show();
        await this.refreshModels();
        const isStillOpen = this.menu.matches(':popover-open') && this.menuAnchor === anchor;
        if (isStillOpen && this._config.provider === provider) show();
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

    _showEffortSwitcher(anchor) {
        const { model, effort } = this.getConnection();
        const { levels, defaultLevel } = this._effortsOf(model);
        const base = this._defaultEffort(model);
        const options = levels.map(level => ({ value: level, label: level === base ? `${level} · ${t('model.default')}` : level }));
        this._openMenu(anchor, options, effort || defaultLevel, level => this.useSessionEffort(level));
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
            this.sessionEffort = null;
            this._saveConnection({ provider });
        });
    }

    /** 默认模型的下拉菜单：可以搜索。接口给不出列表时，才允许直接填写模型名称 */
    _openModelMenu() {
        if (this._menuJustClosed()) return;
        const current = this._defaultModel();
        const ids = [...new Set([...this.models, current])].filter(Boolean);
        const options = ids.map(id => ({ value: id, label: id }));
        this._openMenu(this.modelTrigger, options, current, model => this._setModel(model), {
            searchable: true,
            allowCustom: !this.hasModelList
        });
    }

    /** 默认推理强度的下拉菜单，档位来自接口 */
    _openEffortMenu() {
        if (this._menuJustClosed()) return;
        const model = this._defaultModel();
        const options = this._effortsOf(model).levels.map(level => ({ value: level, label: level }));
        this._openMenu(this.effortTrigger, options, this._defaultEffort(model), level => this._setEffort(level));
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
        this.menuAnchor = anchor;
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
