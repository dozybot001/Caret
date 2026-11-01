/**
 * @fileoverview 模型连接
 * @description 设置里的模型页和输入栏的模型、推理强度菜单：管理服务商、Key、默认值和当前对话的临时选择
 * @module model-connection
 */

import { listModels } from '../agent/model.js';
import { PROVIDERS } from '../app/constants.js';
import { t } from '../i18n/index.js';

/** 输入停下这么久后再检查连接 */
const CHECK_DELAY = 400;
/** 选项超过这个数量时显示搜索框 */
const SEARCH_THRESHOLD = 8;
/** 模型菜单里打开设置的选项 */
const OPEN_SETTINGS = Symbol('open settings');

export class ModelConnection {
    /**
     * @param {HTMLDialogElement} dialog - 设置对话框
     * @param {AppStore} store - 应用状态存储
     * @param {SelectMenu} menu - 下拉菜单
     * @param {Function} openSettings - 打开设置
     */
    constructor(dialog, store, menu, openSettings) {
        this.store = store;
        this.menu = menu;
        this.openSettings = openSettings;
        this.models = [];
        this.checkTimer = null;
        this.checkController = null;
        this.status = null;
        /** 这次是否拿到了接口返回的模型列表，拿不到时才允许手动填写 */
        this.hasModelList = false;
        /** 输入栏选择的模型和推理强度，只在当前对话有效 */
        this.sessionModel = null;
        this.sessionEffort = null;

        /** 连接信息变化时调用 */
        this.onChange = null;

        const find = selector => dialog.querySelector(selector);
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
    }

    get _config() {
        return this.store.getConfig();
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
        this.onChange?.();
    }

    /**
     * 只为当前对话换推理强度，新任务回到默认值
     * @param {string} level - 接口返回的档位
     */
    useSessionEffort(level) {
        this.sessionEffort = level === this._defaultEffort(this.getConnection().model) ? null : level;
        this.onChange?.();
    }

    /** 回到默认模型和推理强度 */
    resetSession() {
        this.sessionModel = null;
        this.sessionEffort = null;
        this.onChange?.();
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

    render() {
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
     * 显示连接状态
     * @param {Object|null} status - { key, args, kind }
     */
    _setStatus(status) {
        this.status = status;
        this.renderStatus();
    }

    renderStatus() {
        this.statusText.textContent = this.status ? t(this.status.key, ...(this.status.args || [])) : '';
        this.statusText.dataset.kind = this.status?.kind || '';
    }

    async _saveConnection(changes) {
        await this.store.updateConfig(changes);
        this.render();
        this.onChange?.();
        clearTimeout(this.checkTimer);
        this.checkTimer = setTimeout(() => this.check(), CHECK_DELAY);
    }

    /** 设置默认模型 */
    async _setModel(model) {
        const { provider, models } = this._config;
        this.sessionModel = null;
        this.sessionEffort = null;
        await this.store.updateConfig({ models: { ...models, [provider]: model } });
        this.render();
        this.onChange?.();
    }

    /** 设置默认推理强度 */
    async _setEffort(level) {
        const { provider, efforts } = this._config;
        this.sessionEffort = null;
        await this.store.updateConfig({ efforts: { ...efforts, [provider]: level } });
        this.render();
        this.onChange?.();
    }

    /** 读取模型列表，既验证连接，也免去手动填写模型名称 */
    async check() {
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
        this.render();
        this.onChange?.();
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
        if (this.menu.justClosed()) return;
        if (!this.isReady()) {
            this.openSettings();
            return;
        }

        this._openSwitcher(anchor, () => this._showModelSwitcher(anchor));
    }

    /**
     * 输入栏的推理强度菜单：列出接口返回的档位，选中后下一次请求生效
     * @param {HTMLElement} anchor - 触发按钮
     */
    openEffortSwitcher(anchor) {
        if (this.menu.justClosed()) return;
        this._openSwitcher(anchor, () => this._showEffortSwitcher(anchor));
    }

    /** 先用记住的内容打开菜单，接口返回后再更新 */
    async _openSwitcher(anchor, show) {
        const { provider } = this._config;
        show();
        await this.refreshModels();
        const isStillOpen = this.menu.isOpen && this.menu.anchor === anchor;
        if (isStillOpen && this._config.provider === provider) show();
    }

    _showModelSwitcher(anchor) {
        const { provider, modelLists } = this._config;
        const { model: current } = this.getConnection();
        const defaultModel = this._defaultModel();
        const ids = [...new Set([...(modelLists[provider] || []), defaultModel, current])].filter(Boolean);
        const options = ids.map(id => ({ value: id, label: id === defaultModel ? `${id} · ${t('model.default')}` : id }));

        this.menu.open(anchor, options, current, (value) => {
            if (value === OPEN_SETTINGS) this.openSettings();
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
        this.menu.open(anchor, options, effort || defaultLevel, level => this.useSessionEffort(level));
    }

    _openProviderMenu() {
        if (this.menu.justClosed()) return;
        const options = Object.keys(PROVIDERS).map(id => ({ value: id, label: this._providerName(id) }));
        this.menu.open(this.providerTrigger, options, this._config.provider, (provider) => {
            this.sessionModel = null;
            this.sessionEffort = null;
            this._saveConnection({ provider });
        });
    }

    /** 默认模型的下拉菜单：可以搜索。接口给不出列表时，才允许直接填写模型名称 */
    _openModelMenu() {
        if (this.menu.justClosed()) return;
        const current = this._defaultModel();
        const ids = [...new Set([...this.models, current])].filter(Boolean);
        const options = ids.map(id => ({ value: id, label: id }));
        this.menu.open(this.modelTrigger, options, current, model => this._setModel(model), {
            searchable: true,
            allowCustom: !this.hasModelList
        });
    }

    /** 默认推理强度的下拉菜单，档位来自接口 */
    _openEffortMenu() {
        if (this.menu.justClosed()) return;
        const model = this._defaultModel();
        const options = this._effortsOf(model).levels.map(level => ({ value: level, label: level }));
        this.menu.open(this.effortTrigger, options, this._defaultEffort(model), level => this._setEffort(level));
    }
}
