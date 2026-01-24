/**
 * @fileoverview Sidebar 工具功能模块
 * @description 唯一入口：注册、运行工具功能，与 AppController 解耦
 * @module sidebar/tools
 */

import { FetchReadmeFeature } from './features/fetch-readme.js';
import { FileSizeChartFeature } from './features/file-size-chart.js';

/** 功能名称常量 */
export const FEATURE_NAMES = {
    FETCH_README: 'fetch-readme',
    FILE_SIZE_CHART: 'file-size-chart'
};

const REGISTRY = [
    [FEATURE_NAMES.FETCH_README, FetchReadmeFeature],
    [FEATURE_NAMES.FILE_SIZE_CHART, FileSizeChartFeature]
];

/**
 * 创建工具功能入口（注册所有功能并返回 run）
 * @param {Object} context - { ui, file, editor, store }
 * @returns {{ run: (name: string, ...args: any[]) => Promise<void> }}
 */
export function createFeatures(context) {
    const map = new Map();
    for (const [name, FeatureClass] of REGISTRY) {
        map.set(name, new FeatureClass(context));
    }

    return {
        async run(name, ...args) {
            const feature = map.get(name);
            if (!feature) {
                if (window.notify) {
                    window.notify.alert(`Feature "${name}" not found.`, { type: 'error' });
                }
                return;
            }
            await feature.execute(...args);
        }
    };
}
