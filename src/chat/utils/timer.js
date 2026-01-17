/**
 * @fileoverview 计时器管理器
 * @description 负责计时器的开始、停止和显示
 */

/**
 * 计时器管理器
 * @class TimerManager
 */
export class TimerManager {
    /**
     * 构造函数
     * @param {HTMLElement|null} timerElement - 计时器显示元素
     */
    constructor(timerElement) {
        this.timerElement = timerElement;
        this.timerInterval = null;
        this.timerStartTime = null;
    }

    /**
     * 开始计时器
     */
    startTimer() {
        if (!this.timerElement) return;
        
        // 重置计时器
        this.resetTimer();
        
        // 显示计时器
        this.timerElement.classList.remove('hidden');
        
        // 记录开始时间
        this.timerStartTime = Date.now();
        
        // 立即更新一次
        this._updateTimer();
        
        // 每秒更新一次
        this.timerInterval = setInterval(() => {
            this._updateTimer();
        }, 1000);
    }

    /**
     * 停止计时器
     */
    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        
        if (this.timerElement) {
            this.timerElement.classList.add('hidden');
        }
        
        this.timerStartTime = null;
    }

    /**
     * 重置计时器
     */
    resetTimer() {
        this.stopTimer();
    }

    /**
     * 更新计时器显示（内部方法）
     * @private
     */
    _updateTimer() {
        if (!this.timerElement || !this.timerStartTime) return;
        
        const elapsed = Math.floor((Date.now() - this.timerStartTime) / 1000);
        this.timerElement.textContent = `${elapsed}s`;
    }
}
