/**
 * @fileoverview 拖入文件夹
 * @description 支持把文件夹拖进页面打开
 * @module folder-drop
 */

import { t } from '../i18n/index.js';

/**
 * 监听拖入的文件夹
 * @param {Object} options - 选项
 * @param {Function} options.isBusy - 返回现在是否不能切换文件夹
 * @param {Function} options.onFolder - 拖入文件夹时调用，参数是文件夹句柄
 */
export function bindFolderDrop({ isBusy, onFolder }) {
    const root = document.documentElement;
    const hasFiles = event => [...event.dataTransfer.types].includes('Files');

    window.addEventListener('dragover', (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        root.classList.add('is-dropping');
    });
    window.addEventListener('dragleave', (event) => {
        if (!event.relatedTarget) root.classList.remove('is-dropping');
    });
    window.addEventListener('drop', async (event) => {
        event.preventDefault();
        root.classList.remove('is-dropping');
        const item = [...event.dataTransfer.items].find(entry => entry.kind === 'file');
        const handle = await item?.getAsFileSystemHandle?.();
        if (!handle) return;
        if (handle.kind !== 'directory') window.notify?.alert(t('error.dropFile'), { type: 'warning' });
        else if (!isBusy()) await onFolder(handle);
    });
}
