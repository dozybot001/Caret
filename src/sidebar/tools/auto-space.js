/**
 * @fileoverview Auto Space Feature
 * @description Applies auto-spacing to the currently opened file in the editor
 * 
 * Based on: https://github.com/zizhengwu/daft-auto-spacing
 */

/**
 * Auto Space Feature
 * @class AutoSpaceFeature
 */
export class AutoSpaceFeature {
    /**
     * @param {Object} context - Feature context
     * @param {Object} context.editor - Editor manager instance
     */
    constructor(context) {
        this.editor = context.editor;
    }

    /**
     * Execute auto-space on the current editor file
     * @returns {Promise<void>}
     */
    async execute() {
        if (!this.editor || !this.editor.editorInstance) {
            if (window.notify) {
                window.notify.alert('Editor not available', { type: 'error' });
            }
            return;
        }

        const currentTab = this.editor.tabs.find(t => t.id === this.editor.currentTabId);
        if (!currentTab || !currentTab.model) {
            if (window.notify) {
                window.notify.alert('No file is currently open', { type: 'warning' });
            }
            return;
        }

        // Get current content
        const originalText = currentTab.model.getValue();
        
        // Apply auto-spacing
        const spacedText = this._applyAutoSpace(originalText);
        
        // Update editor content
        currentTab.model.setValue(spacedText);
        
        // Mark as dirty if content changed
        if (originalText !== spacedText) {
            currentTab.isDirty = true;
            this.editor._renderTabs();
            if (window.notify) {
                window.notify.alert('Auto-spacing applied', { type: 'success', duration: 2000 });
            }
        } else {
            if (window.notify) {
                window.notify.alert('No changes needed', { type: 'info', duration: 2000 });
            }
        }
    }

    /**
     * Apply auto-spacing to text
     * Based on: https://github.com/zizhengwu/daft-auto-spacing
     * @private
     * @param {string} text - Original text
     * @returns {string} - Text with auto-spacing applied
     */
    _applyAutoSpace(text) {
        const unicode = {
            latin: ['[A-Za-z0-9\u00C0-\u00FF\u0100-\u017F\u0180-\u024F\u1E00-\u1EFF]'],
            punc: ['[@&=_\\,\\.\\?\\!\\$\\%\\^\\*\\-\\+\\/]', '[\\(\\\\[\\\'"<\u2018\u201C]', '[\\)\\\\]\\\'">\u201D\u2019]'],
            hanzi: ['[\u4E00-\u9FFF]', '[\u3400-\u4DB5\u9FA6-\u9FBB\uFA70-\uFAD9\u9FBC-\u9FC3\u3007\u3040-\u309E\u30A1-\u30FA\u30FD\u30FE\uFA0E-\uFA0F\uFA11\uFA13-\uFA14\uFA1F\uFA21\uFA23-\uFA24\uFA27-\uFA29]', '[\uD840-\uD868][\uDC00-\uDFFF]|\uD869[\uDC00-\uDEDF]', '\uD86D[\uDC00-\uDF3F]|[\uD86A-\uD86C][\uDC00-\uDFFF]|\uD869[\uDF00-\uDFFF]', '\uD86D[\uDF40-\uDFFF]|\uD86E[\uDC00-\uDC1F]', '[\u31C0-\u31E3]'],
            biaodian: ['[·・︰、，。：；？！—ー⋯…．·／]', '[「『（〔【《〈"\u2018\u201C]', '[」』）〕】》〉\u201D\u2019]']
        };

        const unicodeSet = (set) => {
            return set.match(/[hanzi|latin]/) ? unicode[set].join('|') : unicode[set];
        };

        const hanzi = unicodeSet('hanzi');
        const latin = unicodeSet('latin') + '|' + unicode.punc[0];
        const punc = unicode.punc;
        const patterns = [
            new RegExp(`(${hanzi})(${latin}|${punc[1]})`, 'ig'),
            new RegExp(`(${latin}|${punc[2]})(${hanzi})`, 'ig')
        ];

        return patterns.reduce((result, pattern) => result.replace(pattern, '$1 $2'), text);
    }
}
