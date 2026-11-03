/**
 * @fileoverview 设置对话框
 * @description 左侧导航和页面切换，把各页的控件和设置绑定起来。模型页和数据页在各自的模块里
 */

import { BUILD } from '../app/build.js';
import { DEFAULT_PREFERENCES, VERSION } from '../app/constants.js';
import { getTheme, setTheme } from '../app/preferences.js';
import { articleText, changeLanguage, getLanguage, onLanguageChange, t } from '../i18n/index.js';
import { DataPage } from './data-page.js';
import { ModelConnection } from './model-connection.js';
import { placePopup, SelectMenu } from './select-menu.js';

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

/** 输入停下这么久后再保存 */
const INPUT_DELAY = 400;
/** 页面打开时的语言。Monaco 自带的菜单和查找框按它加载，换语言后要刷新才变 */
const START_LANGUAGE = getLanguage();

/** 鼠标离开说明按钮后，提示保留这么久，方便移进提示 */
const TOOLTIP_HIDE_DELAY = 300;

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

        /** 下拉菜单，输入栏也用它 */
        this.menu = new SelectMenu(dialog.querySelector('#select-menu'));
        /** 模型连接，输入栏和 Agent 都从这里读取 */
        this.connection = new ModelConnection(dialog, store, this.menu, () => this.open());
        this.data = new DataPage(dialog, store, () => this._resetPreferences());

        /** 对话框关闭时调用，用于继续等待模型的任务 */
        this.onClose = null;
        /** 偏好变化时调用，参数是这次改动的设置 */
        this.onPreferencesChange = null;

        const find = selector => dialog.querySelector(selector);
        this.title = find('#settings-title');
        this.titleInfo = find('#settings-info');
        this.backButton = find('#settings-back');
        this.tooltip = find('#tooltip');
        /** 当前提示对应的说明按钮 */
        this.tooltipOwner = null;
        this.tooltipTimer = null;
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

        // Esc 先关闭说明提示，再关闭对话框。在按键阶段拦下：没有用户激活时浏览器不允许取消 cancel 事件
        dialog.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || !this.tooltip.matches(':popover-open')) return;
            event.preventDefault();
            event.stopPropagation();
            this._hideTooltip();
        }, true);
        dialog.addEventListener('cancel', (event) => {
            if (this.tooltip.matches(':popover-open')) {
                event.preventDefault();
                this._hideTooltip();
            }
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

        dialog.querySelectorAll('.info').forEach(button => this._bindTooltip(button));
        this.tooltip.addEventListener('mouseenter', () => clearTimeout(this.tooltipTimer));
        this.tooltip.addEventListener('mouseleave', () => this._hideTooltipSoon());
        document.addEventListener('click', (event) => {
            if (!event.target.closest('.info, #tooltip')) this._hideTooltip();
        });

        dialog.querySelector('#about-version').textContent = VERSION;
        dialog.querySelector('#about-build-id').textContent = BUILD;
        dialog.querySelector('#about-build').hidden = !BUILD;
        onLanguageChange(() => {
            dialog.querySelector('#language-note').hidden = getLanguage() === START_LANGUAGE;
            this._showPage(this.page);
            this.connection.render();
            this.connection.renderStatus();
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
        this.data.status = null;
        this._showPage(page);
        this.connection.render();
        this._renderPreferences();
        if (!this.dialog.open) {
            this.dialog.showModal();
            // 焦点放在对话框本身，打开时不高亮关闭按钮
            this.dialog.focus();
        }
        this.connection.check();
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
        if (page === 'data') this.data.render();
        this.dialog.querySelector('.dialog-body').scrollTop = 0;
    }

    /**
     * 显示说明或法律文本。法律文本可以切换到历史版本
     * @param {string} page - 页面
     * @param {string|null} version - 历史版本号，null 表示当前版本
     */
    async _renderArticle(page, version = null) {
        const section = this.dialog.querySelector(`[data-page="${page}"]`);
        const container = section.querySelector('.article-body');
        const versionList = section.querySelector('.legal-versions');
        let sections = articleText(page);
        if (versionList) {
            const { LEGAL_HISTORY } = await import('../i18n/legal-history.js');
            const history = LEGAL_HISTORY[getLanguage()][page];
            const old = history.find(item => item.version === version);
            if (old) sections = old.sections;
            section.querySelector('.legal-meta').textContent = old ? t('legal.oldMeta', old.version, old.date) : t(`legal.${page}Meta`);
            versionList.replaceChildren(...[null, ...history].map((item) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'settings-link';
                button.textContent = item ? `${item.version} · ${item.date}` : t('legal.current');
                if ((item?.version ?? null) === (old?.version ?? null)) button.setAttribute('aria-current', 'true');
                button.addEventListener('click', () => {
                    this._renderArticle(page, item?.version ?? null);
                    this.dialog.querySelector('.dialog-body').scrollTop = 0;
                });
                return button;
            }));
        }
        container.replaceChildren();
        for (const [heading, body] of sections) {
            const title = document.createElement('h3');
            title.textContent = heading;
            const paragraph = document.createElement('p');
            paragraph.textContent = body;
            container.append(title, paragraph);
        }
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

    async _resetPreferences() {
        await this.store.updateConfig(DEFAULT_PREFERENCES);
        setTheme('system');
        this._renderPreferences();
        this.onPreferencesChange?.(DEFAULT_PREFERENCES);
    }

    _bindTooltip(button) {
        button.setAttribute('aria-expanded', 'false');
        const show = () => {
            clearTimeout(this.tooltipTimer);
            if (this.tooltipOwner !== button) this._hideTooltip();
            this.tooltip.textContent = t(button.dataset.tip);
            if (!this.tooltip.matches(':popover-open')) this.tooltip.showPopover();
            placePopup(this.tooltip, button);
            this.tooltipOwner = button;
            button.setAttribute('aria-expanded', 'true');
            button.setAttribute('aria-describedby', this.tooltip.id);
        };
        button.addEventListener('mouseenter', show);
        button.addEventListener('focus', show);
        button.addEventListener('mouseleave', () => this._hideTooltipSoon());
        button.addEventListener('blur', () => this._hideTooltip());
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            show();
        });
    }

    /** 鼠标离开按钮后留一点时间移进提示；按钮还有焦点时不关闭 */
    _hideTooltipSoon() {
        clearTimeout(this.tooltipTimer);
        if (document.activeElement === this.tooltipOwner) return;
        this.tooltipTimer = setTimeout(() => this._hideTooltip(), TOOLTIP_HIDE_DELAY);
    }

    _hideTooltip() {
        clearTimeout(this.tooltipTimer);
        if (this.tooltip.matches(':popover-open')) this.tooltip.hidePopover();
        this.tooltipOwner?.setAttribute('aria-expanded', 'false');
        this.tooltipOwner?.removeAttribute('aria-describedby');
        this.tooltipOwner = null;
    }
}
