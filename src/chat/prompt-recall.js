/**
 * @fileoverview 提示词回填
 * @description 在输入框用上下键翻看发过的提示词，多行内容里先移动光标，到边界才切换
 */

const isFirstLine = ({ value, selectionStart }) => !value.slice(0, selectionStart).includes('\n');
const isLastLine = ({ value, selectionEnd }) => !value.slice(selectionEnd).includes('\n');

export class PromptRecall {
    constructor() {
        /** 发过的提示词，旧的在前 */
        this.entries = [];
        /** 正在查看的位置，null 表示没有在翻看 */
        this.index = null;
        /** 开始翻看前输入框里的内容 */
        this.draft = '';
    }

    /**
     * 载入提示词
     * @param {string[]} entries - 提示词，旧的在前
     */
    load(entries) {
        this.entries = entries;
        this.reset();
    }

    /** 结束翻看。用户编辑输入框时调用 */
    reset() {
        this.index = null;
        this.draft = '';
    }

    /**
     * 上键：看上一条。输入框有内容时，只有光标在最前面才开始翻看，避免打断编辑
     * @param {HTMLTextAreaElement} input - 输入框
     * @returns {string|null} 要填入的内容，null 表示交给输入框自己处理
     */
    previous(input) {
        if (this.entries.length === 0) return null;
        if (this.index === null) {
            if (input.value && input.selectionEnd !== 0) return null;
            this.index = this.entries.length;
            this.draft = input.value;
        } else if (!isFirstLine(input)) {
            return null;
        }
        this.index = Math.max(0, this.index - 1);
        return this.entries[this.index];
    }

    /**
     * 下键：看下一条，翻过最新一条后回到原来的内容
     * @param {HTMLTextAreaElement} input - 输入框
     * @returns {string|null} 要填入的内容，null 表示交给输入框自己处理
     */
    next(input) {
        if (this.index === null || !isLastLine(input)) return null;
        this.index++;
        if (this.index < this.entries.length) return this.entries[this.index];

        const { draft } = this;
        this.reset();
        return draft;
    }
}
