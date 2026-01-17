/**
 * @fileoverview 统一通知系统
 * @description 提供统一的通知消息显示功能
 * @module Notify
 */

/** 图标类型映射 */
const ICON_MAP = {
    info: 'codicon-info',
    success: 'codicon-check',
    warning: 'codicon-warning',
    error: 'codicon-error'
};

/**
 * 通知系统
 * @class Notify
 */
export class Notify {
    /**
     * 初始化通知系统
     * @param {HTMLElement} container - 通知容器元素
     */
    constructor(container) {
        this.container = container;
    }

    /**
     * 显示通知消息（替代 alert）
     * @param {string} message - 消息内容
     * @param {Object} options - 选项
     * @param {string} options.type - 类型：'info' | 'success' | 'warning' | 'error'
     * @param {number} options.duration - 自动关闭时间（毫秒）
     * @returns {Promise<void>}
     */
    async alert(message, options = {}) {
        const {
            type = 'info',
            duration = 3000
        } = options;

        return new Promise((resolve) => {
            const notification = this._createNotification(message, type);
            this.container.appendChild(notification);

            const handleClose = () => {
                notification.remove();
                resolve();
            };

            if (duration > 0) {
                setTimeout(handleClose, duration);
            }
        });
    }

    /**
     * 创建通知元素
     * @private
     * @param {string} message - 消息内容
     * @param {string} type - 类型
     * @returns {HTMLElement}
     */
    _createNotification(message, type) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;

        const icon = ICON_MAP[type] || ICON_MAP.info;
        
        // 创建内容容器
        const content = document.createElement('div');
        content.className = 'notification-content';
        
        // 创建图标
        const iconEl = document.createElement('i');
        iconEl.className = `codicon ${icon}`;
        content.appendChild(iconEl);
        
        // 创建消息文本（使用 textContent 自动转义 HTML）
        const messageEl = document.createElement('span');
        messageEl.className = 'notification-message';
        messageEl.textContent = message;
        content.appendChild(messageEl);
        
        notification.appendChild(content);

        return notification;
    }

}
