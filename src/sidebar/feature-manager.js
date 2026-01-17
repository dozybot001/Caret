/**
 * @fileoverview 功能管理器
 * @description 功能模块（Feature）的注册与执行管理器，负责依赖注入、生命周期管理及统一的错误边界处理
 * 
 * ## 核心功能
 * - 注册功能模块
 * - 执行功能模块
 * - 提供统一的上下文注入
 * 
 * @module FeatureManager
 */

/**
 * 功能管理器
 * @class FeatureManager
 */
export class FeatureManager {
    /**
     * 构造函数
     * @param {Object} context - 功能模块上下文，包含 ui、file、editor、store 等依赖
     */
    constructor(context) {
        /** @type {Object} 功能模块上下文 */
        this.context = context;
        /** @type {Map<string, Object>} 已注册的功能模块映射 */
        this.features = new Map();
    }

    /**
     * 注册功能模块
     * @param {string} name - 功能模块名称
     * @param {Function} featureClass - 功能模块类（构造函数）
     */
    register(name, featureClass) {
        this.features.set(name, new featureClass(this.context));
    }

    /**
     * 执行功能模块
     * @param {string} name - 功能模块名称
     * @param {...*} args - 传递给功能模块的参数
     * @returns {Promise<void>}
     */
    async run(name, ...args) {
        const feature = this.features.get(name);
        if (!feature) {
            if (window.notify) {
                window.notify.alert(`Feature "${name}" not found.`, { type: 'error' });
            }
            return;
        }

        try {
            await feature.execute(...args);
        } catch (error) {
            if (window.notify) {
                window.notify.alert(`Error executing feature "${name}": ${error.message}`, { type: 'error' });
            }
            if (window.notify) {
                window.notify.alert(`Feature execution failed: ${error.message}`, { type: 'error', duration: 5000 });
            }
        }
    }
}
