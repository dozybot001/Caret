/**
 * @fileoverview 编辑器视图
 * @description 创建普通编辑器和 Diff 编辑器，统一管理字号和设置里的显示选项
 * @module editor-views
 */

/** 折叠未改动的代码时，改动前后保留的行数 */
const FOLD_OPTIONS = { contextLineCount: 3, minimumLineCount: 3, revealLineCount: 20 };
/** 编辑器比这个宽度窄时，并排 Diff 显示为行内 */
const SIDE_BY_SIDE_MIN_WIDTH = 600;

const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 72;
const RESET_FONT_SIZE = 14;

export class EditorViews {
    /**
     * @param {HTMLElement} container - 编辑器区域
     * @param {Function} onSave - 按下保存快捷键时调用
     */
    constructor(container, onSave) {
        this.container = container;
        this.onSave = onSave;
        /** 普通编辑器和 Diff 编辑器，Monaco 加载失败时为 null */
        this.standard = null;
        this.diff = null;
        this.standardWrapper = null;
        this.diffWrapper = null;
        this.fontSize = RESET_FONT_SIZE;
        this.defaultFontFamily = '';

        this.onFontSizeChange = null; // 快捷键改变字号时调用
    }

    /** 创建编辑器，随容器大小调整布局 */
    create() {
        this.standardWrapper = this._createWrapper('std-editor-wrapper');
        this.diffWrapper = this._createWrapper('diff-editor-wrapper');

        // 从 CSS 变量获取字体
        this.defaultFontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-family').trim();
        const sharedOptions = {
            fontFamily: this.defaultFontFamily,
            fontSize: this.fontSize,
            automaticLayout: true,
            wordWrap: 'on',
            minimap: { enabled: false },
            scrollBeyondLastLine: false
        };

        this.standard = monaco.editor.create(this.standardWrapper, { ...sharedOptions, model: null });

        // 审阅改动默认用行内 diff；右侧内容可以直接编辑，只折叠没有变化的部分
        this.diff = monaco.editor.createDiffEditor(this.diffWrapper, {
            ...sharedOptions,
            diffWordWrap: 'on',
            renderSideBySide: false,
            renderSideBySideInlineBreakpoint: SIDE_BY_SIDE_MIN_WIDTH,
            originalEditable: false,
            ignoreTrimWhitespace: false,
            renderMarginRevertIcon: false,
            renderGutterMenu: false,
            renderOverviewRuler: false,
            hideUnchangedRegions: { enabled: true, ...FOLD_OPTIONS }
        });

        this._bindCommands(this.standard);
        this._bindCommands(this.diff.getModifiedEditor());

        new ResizeObserver(() => {
            this.standard.layout();
            this.diff.layout();
        }).observe(this.container);
    }

    _createWrapper(id) {
        const wrapper = document.createElement('div');
        wrapper.id = id;
        wrapper.className = 'editor-instance-wrapper hidden';
        this.container.appendChild(wrapper);
        return wrapper;
    }

    /**
     * 绑定保存和字号快捷键
     * @private
     * @param {Object} editor - Monaco 编辑器
     */
    _bindCommands(editor) {
        const { KeyMod, KeyCode } = monaco;
        const shortcut = (key, run) => editor.addCommand(KeyMod.CtrlCmd | key, run);

        shortcut(KeyCode.KeyS, () => this.onSave());
        shortcut(KeyCode.Equal, () => this._changeFontSize(this.fontSize + 1));
        shortcut(KeyCode.NumpadAdd, () => this._changeFontSize(this.fontSize + 1));
        shortcut(KeyCode.Minus, () => this._changeFontSize(this.fontSize - 1));
        shortcut(KeyCode.NumpadSubtract, () => this._changeFontSize(this.fontSize - 1));
        shortcut(KeyCode.Digit0, () => this._changeFontSize(RESET_FONT_SIZE));
        shortcut(KeyCode.Numpad0, () => this._changeFontSize(RESET_FONT_SIZE));
    }

    /**
     * 设置字体大小
     * @param {number} size - 字体大小
     * @returns {boolean} 字号是否变化
     */
    setFontSize(size) {
        const clamped = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size));
        if (clamped === this.fontSize) return false;
        this.fontSize = clamped;
        this.standard?.updateOptions({ fontSize: clamped });
        this.diff?.updateOptions({ fontSize: clamped });
        return true;
    }

    _changeFontSize(size) {
        if (this.setFontSize(size)) this.onFontSizeChange?.(this.fontSize);
    }

    /**
     * 应用设置里的编辑器选项，审阅改动时同样生效
     * @param {Object} preferences - 设置，字段见 DEFAULT_PREFERENCES
     */
    setPreferences({ fontFamily, tabSize, cursorStyle, wordWrap, lineNumbers, minimap, showWhitespace, diffView, foldUnchanged }) {
        const family = fontFamily.trim();
        const options = {
            fontFamily: family ? `${family}, ${this.defaultFontFamily}` : this.defaultFontFamily,
            detectIndentation: tabSize === 0,
            ...(tabSize === 0 ? {} : { tabSize }),
            cursorStyle,
            lineNumbers: lineNumbers ? 'on' : 'off',
            minimap: { enabled: minimap },
            renderWhitespace: showWhitespace ? 'all' : 'selection'
        };
        const wrap = wordWrap ? 'on' : 'off';
        this.standard?.updateOptions({ ...options, wordWrap: wrap });
        this.diff?.updateOptions({
            ...options,
            diffWordWrap: wrap,
            renderSideBySide: diffView === 'sideBySide',
            hideUnchangedRegions: { enabled: foldUnchanged, ...FOLD_OPTIONS }
        });
    }
}
