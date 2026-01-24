/**
 * @fileoverview 文件大小分析功能模块
 * @description 分析项目文件大小并绘制饼图
 * @module sidebar/tools/file-size-chart
 */

// GitHub hard limit for regular file uploads (per file).
// (Git LFS has different limits; this is the common 100 MB limit users hit.)
const GITHUB_MAX_FILE_BYTES = 100 * 1024 * 1024;

/**
 * 文件大小分析功能模块
 * @class FileSizeChartFeature
 */
export class FileSizeChartFeature {
    /**
     * @param {Object} context - 功能模块上下文
     * @param {Object} context.file - 文件管理器实例
     */
    constructor(context) {
        this.context = context;
        this.fileSizes = null;
        this.currentFolderName = '';
        this.chartMode = 'default'; // default | no-outliers
        this.outlierResult = null;
    }

    /**
     * 执行功能
     * @returns {Promise<void>}
     */
    async execute() {
        // 要求用户选择文件夹（独立于 Caret 当前打开的项目）
        let selectedFolder;
        try {
            if (window.notify) {
                window.notify.alert('Please select a folder to analyze (local scan only, no upload).', { type: 'info', duration: 2500 });
            }
            
            selectedFolder = await window.showDirectoryPicker({ mode: 'read' });
        } catch (error) {
            if (error.name === 'AbortError') {
                // 用户取消了选择
                return;
            }
            if (window.notify) {
                window.notify.alert(`Failed to select folder: ${error.message}`, { type: 'error' });
            }
            return;
        }

        if (window.notify) {
            window.notify.alert('Scanning folder (local-only): reading file sizes, no upload, no storage.', { type: 'info', duration: 2500 });
        }

        try {
            // 递归扫描选中的文件夹并仅记录元数据（路径/名称/大小），不保留文件句柄
            const fileSizes = await this._scanFolderAndCollectSizes(selectedFolder);

            if (fileSizes.length === 0) {
                if (window.notify) {
                    window.notify.alert('No files found in the selected folder', { type: 'warning' });
                }
                return;
            }

            // 保存扫描结果用于图表切换
            this.fileSizes = fileSizes;
            this.currentFolderName = selectedFolder.name;
            this.chartMode = 'default';
            this.outlierResult = this._findOutliers(fileSizes);

            // 计算前99%的文件，其余归为OTHER
            const chartData = this._buildChartData(fileSizes, { includeOther: true, percent: 0.99 });
            
            // 显示图表
            this._showChart(chartData, selectedFolder.name);

            if (window.notify) {
                window.notify.alert(`Analyzed ${fileSizes.length} files from "${selectedFolder.name}"`, { type: 'success' });
            }
        } catch (error) {
            const msg = error.message || 'Failed to analyze file sizes';
            if (window.notify) {
                window.notify.alert(msg, { type: 'error', duration: 5000 });
            }
            throw error;
        }
    }

    /**
     * 递归扫描文件夹并收集文件大小（仅元数据，不读取文件内容，不持久化句柄）
     * @private
     * @param {FileSystemDirectoryHandle} dirHandle
     * @param {string} basePath
     * @returns {Promise<Array<{path: string, name: string, size: number}>>}
     */
    async _scanFolderAndCollectSizes(dirHandle, basePath = '') {
        const fileSizes = [];
        const batchSize = 20; // 限制并发，避免对话框/权限或 IO 过载
        let pending = [];

        const flush = async () => {
            if (pending.length === 0) return;
            const results = await Promise.all(pending);
            for (const item of results) {
                if (item) fileSizes.push(item);
            }
            pending = [];
        };

        try {
            for await (const entry of dirHandle.values()) {
                if (entry.name === '.git') {
                    continue;
                }
                const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;

                if (entry.kind === 'file') {
                    // 仅获取 File 对象的 size 元数据；不读取内容，不保存 handle
                    pending.push((async () => {
                        try {
                            const fileObj = await entry.getFile();
                            return { path: entryPath, name: entry.name, size: fileObj.size };
                        } catch (error) {
                            console.warn(`Error getting size for ${entryPath}:`, error);
                            return null;
                        }
                    })());

                    if (pending.length >= batchSize) {
                        await flush();
                    }
                } else if (entry.kind === 'directory') {
                    // 递归扫描子目录（先 flush，避免递归叠加过多 pending）
                    await flush();
                    const sub = await this._scanFolderAndCollectSizes(entry, entryPath);
                    fileSizes.push(...sub);
                }
            }

            await flush();
        } catch (error) {
            console.warn(`Error scanning directory ${basePath}:`, error);
        }

        return fileSizes;
    }

    /**
     * 构建图表数据
     * @private
     * @param {Array<{path: string, name: string, size: number}>} fileSizes
     * @param {{includeOther?: boolean, percent?: number}} options
     * @returns {Array<{label: string, path: string, size: number, isOther: boolean, count?: number}>}
     */
    _buildChartData(fileSizes, { includeOther = true, percent = 0.99 } = {}) {
        if (!includeOther) {
            const sortedAll = [...fileSizes].sort((a, b) => b.size - a.size);
            return sortedAll.map(file => ({
                label: file.name,
                path: file.path,
                size: file.size,
                isOther: false
            }));
        }

        // 按大小降序排序
        const sorted = [...fileSizes].sort((a, b) => b.size - a.size);

        // 计算总大小
        const totalSize = sorted.reduce((sum, file) => sum + file.size, 0);
        const targetSize = totalSize * percent;

        // 找到前N%的文件
        let cumulativeSize = 0;
        const topFiles = [];
        const otherFiles = [];

        for (const file of sorted) {
            if (cumulativeSize < targetSize) {
                topFiles.push(file);
                cumulativeSize += file.size;
            } else {
                otherFiles.push(file);
            }
        }

        // 构建结果：前N%的文件 + OTHER
        const result = topFiles.map(file => ({
            label: file.name,
            path: file.path,
            size: file.size,
            isOther: false
        }));

        // 如果有剩余文件，添加OTHER
        if (otherFiles.length > 0) {
            const otherSize = otherFiles.reduce((sum, file) => sum + file.size, 0);
            result.push({
                label: 'OTHER',
                path: null,
                size: otherSize,
                isOther: true,
                count: otherFiles.length
            });
        }

        return result;
    }

    /**
     * 找出明显过大的文件（异常值）
     * @private
     * @param {Array<{path: string, name: string, size: number}>} fileSizes
     * @returns {{outliers: Array, filtered: Array}}
     */
    _findOutliers(fileSizes) {
        if (!fileSizes || fileSizes.length === 0) {
            return { outliers: [], filtered: fileSizes || [] };
        }

        const totalSize = fileSizes.reduce((sum, file) => sum + file.size, 0);
        if (totalSize === 0) {
            return { outliers: [], filtered: fileSizes };
        }

        // Simple rule: any single file >= 10% of total size is an outlier.
        const threshold = totalSize * 0.1;
        const outliers = fileSizes.filter(f => f.size >= threshold);
        const filtered = outliers.length
            ? fileSizes.filter(f => f.size < threshold)
            : fileSizes;

        return { outliers, filtered };
    }

    /**
     * 计算百分位数
     * @private
     * @param {number[]} sortedValues - 已排序数组
     * @param {number} p - 0~1
     * @returns {number}
     */
    _percentile(sortedValues, p) {
        if (!sortedValues.length) return 0;
        const idx = (sortedValues.length - 1) * p;
        const lower = Math.floor(idx);
        const upper = Math.ceil(idx);
        if (lower === upper) {
            return sortedValues[lower];
        }
        const weight = idx - lower;
        return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * weight;
    }

    /**
     * 显示图表
     * @private
     * @param {Array<{label: string, path: string, size: number, isOther: boolean, count?: number}>} chartData
     * @param {string} folderName
     */
    _showChart(chartData, folderName = '') {
        // 检查 Chart.js 是否已加载
        if (typeof Chart === 'undefined' && typeof window.Chart === 'undefined') {
            if (window.notify) {
                window.notify.alert('Chart.js library is not loaded. Please refresh the page.', { type: 'error' });
            }
            return;
        }

        const ChartLib = window.Chart || Chart;

        // 创建或获取模态框
        let modal = document.getElementById('file-size-chart-modal');
        if (!modal) {
            modal = this._createModal();
            document.body.appendChild(modal);
        }

        // 清空画布容器
        const canvasContainer = modal.querySelector('.chart-canvas-container');
        canvasContainer.innerHTML = `
            <div class="chart-canvas-header">
                <button type="button" class="btn btn-text chart-action-btn" id="chart-outlier-toggle"></button>
            </div>
            <canvas id="file-size-chart"></canvas>
        `;

        // 设置按钮状态
        const outlierBtn = canvasContainer.querySelector('#chart-outlier-toggle');
        const outlierCount = this.outlierResult ? this.outlierResult.outliers.length : 0;
        if (outlierBtn) {
            if (this.chartMode === 'default') {
                outlierBtn.textContent = outlierCount
                    ? `Hide ${outlierCount} outlier${outlierCount > 1 ? 's' : ''} + show all`
                    : 'Hide outliers + show all';
                outlierBtn.disabled = outlierCount === 0;
            } else {
                outlierBtn.textContent = 'Restore outliers + group OTHER';
                outlierBtn.disabled = false;
            }

            outlierBtn.addEventListener('click', () => {
                this._toggleOutlierView(outlierCount);
            });
        }

        // 显示模态框
        modal.classList.remove('hidden');

        // 准备数据
        const data = chartData.map(item => item.size);
        const totalSize = data.reduce((sum, size) => sum + size, 0);

        // 生成颜色（使用注册的颜色）
        const colors = this._generateColors(chartData.length);

        // 创建列表视图
        this._createListView(modal, chartData, colors, totalSize);

        // 创建图表
        const ctx = document.getElementById('file-size-chart').getContext('2d');
        
        // 销毁旧图表（如果存在）
        if (this.chartInstance) {
            this.chartInstance.destroy();
        }

        // 使用 donut chart (更紧凑)
        this.chartInstance = new ChartLib(ctx, {
            type: 'doughnut',
            data: {
                labels: chartData.map(item => item.label),
                datasets: [{
                    data: data,
                    backgroundColor: colors,
                    borderColor: 'var(--bg-2)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '60%',
                color: 'var(--text-1)',
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'var(--bg-3)',
                        titleColor: 'var(--text-1)',
                        bodyColor: 'var(--text-2)',
                        borderColor: 'var(--bg-4)',
                        borderWidth: 1,
                        padding: 8,
                        titleFont: {
                            size: 11,
                            family: 'inherit'
                        },
                        bodyFont: {
                            size: 11,
                            family: 'inherit'
                        },
                        callbacks: {
                            label: (context) => {
                                const value = context.parsed || 0;
                                const percentage = ((value / totalSize) * 100).toFixed(1);
                                const sizeMB = (value / (1024 * 1024)).toFixed(2);
                                return `${context.label}: ${sizeMB} MB (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });

        // 更新总大小显示
        const totalSizeElement = modal.querySelector('.chart-total-size');
        const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
        const folderText = folderName ? `"${folderName}" - ` : '';
        totalSizeElement.textContent = `${folderText}Total: ${totalSizeMB} MB`;
    }

    /**
     * 切换异常值视图：去除过大文件并展示全部文件（取消OTHER）
     * @private
     * @param {number} outlierCount
     */
    _toggleOutlierView(outlierCount) {
        if (!this.fileSizes || this.fileSizes.length === 0) {
            return;
        }

        if (this.chartMode === 'default') {
            if (!outlierCount) {
                if (window.notify) {
                    window.notify.alert('No obvious outliers found', { type: 'info' });
                }
                return;
            }

            const { filtered } = this.outlierResult || this._findOutliers(this.fileSizes);
            this.chartMode = 'no-outliers';
            const chartData = this._buildChartData(filtered, { includeOther: false });
            this._showChart(chartData, this.currentFolderName);
        } else {
            this.chartMode = 'default';
            const chartData = this._buildChartData(this.fileSizes, { includeOther: true, percent: 0.99 });
            this._showChart(chartData, this.currentFolderName);
        }
    }

    /**
     * 创建模态框
     * @private
     * @returns {HTMLElement}
     */
    _createModal() {
        const modal = document.createElement('div');
        modal.id = 'file-size-chart-modal';
        modal.className = 'file-size-chart-modal hidden';
        modal.innerHTML = `
            <div class="file-size-chart-modal-content">
                <div class="file-size-chart-modal-header">
                    <h3>File Size Analysis</h3>
                    <button type="button" class="btn btn-close" id="file-size-chart-close">
                        <i class="codicon codicon-close"></i>
                    </button>
                </div>
                <div class="file-size-chart-modal-body">
                    <div class="chart-total-size"></div>
                    <div class="chart-privacy-note">Local scan only. No files are uploaded or stored.</div>
                    <div class="chart-github-note">GitHub per-file upload limit: 100 MB (highlighted in red below).</div>
                    <div class="chart-canvas-container">
                        <canvas id="file-size-chart"></canvas>
                    </div>
                </div>
            </div>
        `;

        // 绑定关闭按钮
        const closeBtn = modal.querySelector('#file-size-chart-close');
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
            if (this.chartInstance) {
                this.chartInstance.destroy();
                this.chartInstance = null;
            }
        });

        // 点击外部关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
                if (this.chartInstance) {
                    this.chartInstance.destroy();
                    this.chartInstance = null;
                }
            }
        });

        return modal;
    }

    /**
     * 生成颜色数组（使用 theme.css 中注册的颜色）
     * @private
     * @param {number} count
     * @returns {Array<string>}
     */
    _generateColors(count) {
        // 从 CSS 变量获取颜色值
        const getColor = (varName) => {
            return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        };

        const colors = [
            getColor('--color-blue'),
            getColor('--color-red'),
            getColor('--color-green'),
            getColor('--color-yellow'),
            getColor('--color-purple'),
            getColor('--color-cyan'),
            getColor('--color-orange'),
            getColor('--color-pink'),
            getColor('--color-teal'),
            getColor('--color-lime'),
            getColor('--color-magenta'),
            getColor('--color-amber'),
            getColor('--color-blue-variant'),
            getColor('--color-red-variant'),
            getColor('--color-green-variant'),
            getColor('--color-yellow-variant')
        ].filter(c => c); // 过滤空值
        
        const result = [];
        for (let i = 0; i < count; i++) {
            result.push(colors[i % colors.length]);
        }
        return result;
    }

    /**
     * 创建列表视图
     * @private
     * @param {HTMLElement} modal
     * @param {Array<{label: string, path: string, size: number, isOther: boolean, count?: number}>} chartData
     * @param {Array<string>} colors
     * @param {number} totalSize
     */
    _createListView(modal, chartData, colors, totalSize) {
        let listContainer = modal.querySelector('.chart-list-container');
        if (!listContainer) {
            listContainer = document.createElement('div');
            listContainer.className = 'chart-list-container';
            const body = modal.querySelector('.file-size-chart-modal-body');
            body.insertBefore(listContainer, body.querySelector('.chart-canvas-container'));
        }

        listContainer.innerHTML = '';
        
        chartData.forEach((item, index) => {
            const percentage = ((item.size / totalSize) * 100).toFixed(1);
            const sizeMB = (item.size / (1024 * 1024)).toFixed(2);
            const sizeKB = (item.size / 1024).toFixed(0);
            const isOverGithubLimit = !item.isOther && item.size >= GITHUB_MAX_FILE_BYTES;
            
            const row = document.createElement('div');
            row.className = 'chart-list-item';
            if (isOverGithubLimit) {
                row.classList.add('chart-list-item-github-limit');
            }
            
            const colorDot = document.createElement('div');
            colorDot.className = 'chart-list-color';
            colorDot.style.backgroundColor = colors[index];
            
            const label = document.createElement('div');
            label.className = 'chart-list-label';
            label.textContent = item.label;
            label.title = item.path || ''; // 显示完整路径作为提示
            
            const info = document.createElement('div');
            info.className = 'chart-list-info';
            if (item.isOther && item.count) {
                info.textContent = `${item.count} files`;
            } else if (isOverGithubLimit) {
                info.textContent = '>=100MB';
                info.title = 'GitHub per-file upload limit is 100 MB';
            } else {
                info.textContent = '';
            }
            
            const size = document.createElement('div');
            size.className = 'chart-list-size';
            size.textContent = sizeMB < 1 ? `${sizeKB} KB` : `${sizeMB} MB`;
            if (isOverGithubLimit) {
                size.title = 'This file meets/exceeds GitHub 100 MB per-file upload limit';
            }
            
            const percentageText = document.createElement('div');
            percentageText.className = 'chart-list-percentage';
            percentageText.textContent = `${percentage}%`;
            
            row.appendChild(colorDot);
            row.appendChild(label);
            row.appendChild(info);
            row.appendChild(size);
            row.appendChild(percentageText);
            
            // 添加点击事件显示完整路径并复制到剪贴板（仅对非OTHER项）
            if (!item.isOther && item.path) {
                row.classList.add('chart-list-item-clickable');
                row.addEventListener('click', async () => {
                    try {
                        // 复制到剪贴板
                        await navigator.clipboard.writeText(item.path);
                        if (window.notify) {
                            window.notify.alert(`Copied path to clipboard: ${item.path}`, { type: 'success', duration: 3000 });
                        }
                    } catch (error) {
                        // 如果剪贴板API失败，使用fallback方法
                        try {
                            const textArea = document.createElement('textarea');
                            textArea.value = item.path;
                            textArea.style.position = 'fixed';
                            textArea.style.opacity = '0';
                            document.body.appendChild(textArea);
                            textArea.select();
                            document.execCommand('copy');
                            document.body.removeChild(textArea);
                            if (window.notify) {
                                window.notify.alert(`Copied path to clipboard: ${item.path}`, { type: 'success', duration: 3000 });
                            }
                        } catch (fallbackError) {
                            if (window.notify) {
                                window.notify.alert(`Failed to copy path: ${item.path}`, { type: 'error' });
                            }
                        }
                    }
                });
            }
            
            listContainer.appendChild(row);
        });
    }
}
