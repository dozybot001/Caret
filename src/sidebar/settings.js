/**
 * @fileoverview 设置模块
 * @description 负责设置菜单、API 配置和工具菜单的 UI 管理
 */

/**
 * 设置管理器
 * @class Settings
 */
export class Settings {
    /**
     * @param {HTMLElement} settingsMenu - 设置菜单
     * @param {HTMLElement} toolsMenu - 工具菜单
     */
    constructor(settingsMenu, toolsMenu) {
        this.settingsMenu = settingsMenu;
        this.toolsMenu = toolsMenu;
        this._settingsInputs = null;
        this.onConfigSave = null;
        this.onFetchReadme = null; // (githubUrl: string) => Promise<void>
        this.onFileSizeChart = null; // () => Promise<void>
        this.onAutoSpace = null; // () => Promise<void>
        this.onPureColor = null; // () => Promise<void>
    }

    /**
     * 初始化设置逻辑和事件绑定
     */
    init() {
        this._initializeSettingsInputs();

        // 绑定菜单按钮事件（hover 打开）
        this._bindMenuButton('btn-settings', this.settingsMenu);
        this._bindMenuButton('btn-tools', this.toolsMenu);

        // 绑定输入框事件
        this._bindSettingsInputs();

        // 绑定 Fetch README 按钮事件
        this._bindFetchReadmeButton();

        // 绑定 File Size Chart 按钮事件
        this._bindFileSizeChartButton();

        // 绑定 Auto Space 按钮事件
        this._bindAutoSpaceButton();

        // 绑定 Pure Color 按钮事件
        this._bindPureColorButton();

        // 绑定可编辑菜单项点击事件：点击整个区域时聚焦并全选输入框内容
        const editableItems = document.querySelectorAll('.menu-item-editable');
        editableItems.forEach(item => {
            const input = item.querySelector('.menu-item-input');
            if (input) {
                item.addEventListener('click', (e) => {
                    // 如果点击的不是输入框本身，则聚焦并全选输入框
                    if (e.target !== input) {
                        e.preventDefault();
                        input.focus();
                        input.select();
                    }
                });
            }
        });
        
        // 点击外部关闭所有菜单
        document.addEventListener('click', () => this._closeAllMenus());
        
        // 菜单内的点击事件不关闭菜单
        [this.settingsMenu, this.toolsMenu].forEach(menu => {
            if (menu) {
                menu.addEventListener('click', e => e.stopPropagation());
            }
        });
    }

    /**
     * 更新设置视图
     * @param {Object} config - 配置对象
     */
    updateSettingsView(config) {
        this._initializeSettingsInputs();
        
        const { urlInput, keyInput, modelInput, githubUrlInput } = this._settingsInputs;
        
        const baseUrl = config.baseUrl || '';
        const apiKey = config.apiKey || '';
        const model = config.model || '';
        const githubUrl = config.githubUrl || '';
        
        // 更新输入框值
        const inputValues = [
            { input: urlInput, value: baseUrl },
            { input: keyInput, value: apiKey },
            { input: modelInput, value: model },
            { input: githubUrlInput, value: githubUrl }
        ];
        
        inputValues.forEach(({ input, value }) => {
            if (input) {
                input.value = value;
                input.defaultValue = value;
            }
        });
    }

    /**
     * 初始化设置输入框引用
     * @private
     */
    _initializeSettingsInputs() {
        if (!this._settingsInputs) {
            this._settingsInputs = {
                urlInput: document.getElementById('input-base-url'),
                keyInput: document.getElementById('input-api-key'),
                modelInput: document.getElementById('input-model-name'),
                githubUrlInput: document.getElementById('input-fetch-readme-url')
            };
        }
    }

    /**
     * 绑定菜单按钮事件
     * @private
     * @param {string} buttonId - 按钮ID
     * @param {HTMLElement} menu - 菜单元素
     */
    _bindMenuButton(buttonId, menu) {
        const button = document.getElementById(buttonId);
        if (button) {
            const openMenu = (e) => this._openMenu(button, menu, e);

            // Hover 打开，不在 hover 结束时关闭
            button.addEventListener('mouseenter', openMenu);
            menu.addEventListener('mouseenter', openMenu);

            // 仍允许点击切换（兼容触摸/键盘）
            button.addEventListener('click', (e) => openMenu(e));
        }
    }

    /**
     * 绑定设置输入框事件
     * @private
     */
    _bindSettingsInputs() {
        if (!this._settingsInputs) return;

        const inputs = [
            this._settingsInputs.urlInput,
            this._settingsInputs.keyInput,
            this._settingsInputs.modelInput,
            this._settingsInputs.githubUrlInput
        ];
        
        inputs.forEach(input => {
            if (input) {
                input.addEventListener('input', () => this._saveConfigFromInputs());
                input.addEventListener('blur', () => this._saveConfigFromInputs());
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        input.blur();
                    }
                });
            }
        });
    }

    /**
     * 从输入框保存配置
     * @private
     */
    _saveConfigFromInputs() {
        if (!this._settingsInputs || !this.onConfigSave) return;
        
        const { urlInput, keyInput, modelInput, githubUrlInput } = this._settingsInputs;
        this.onConfigSave(
            keyInput?.value.trim() || '',
            urlInput?.value.trim() || '',
            modelInput?.value.trim() || '',
            githubUrlInput?.value.trim() || ''
        );
    }

    /**
     * 切换菜单显示/隐藏
     * @private
     * @param {HTMLElement} btn - 按钮元素
     * @param {HTMLElement} menu - 菜单元素
     * @param {Event} e - 事件对象
     */
    _toggleMenu(btn, menu, e) {
        if (e) e.stopPropagation();

        const isHidden = menu.classList.contains('hidden');
        this._closeAllMenus();

        if (isHidden) {
            menu.classList.remove('hidden');

            // 使用 requestAnimationFrame 确保菜单已渲染后计算位置
            requestAnimationFrame(() => {
                this._positionMenu(menu, btn);
            });
        }
    }

    /**
     * 打开菜单（如果已打开则不做任何事）
     * @private
     * @param {HTMLElement} btn - 按钮元素
     * @param {HTMLElement} menu - 菜单元素
     * @param {Event} e - 事件对象
     */
    _openMenu(btn, menu, e) {
        if (e) e.stopPropagation();
        if (!menu.classList.contains('hidden')) {
            return;
        }

        this._closeAllMenus();
        menu.classList.remove('hidden');

        requestAnimationFrame(() => {
            this._positionMenu(menu, btn);
        });
    }

    /**
     * 定位菜单在按钮右侧，避免溢出屏幕
     * @private
     * @param {HTMLElement} menu - 菜单元素
     * @param {HTMLElement} btn - 按钮元素
     */
    _positionMenu(menu, btn) {
        const container = btn.closest('.sidebar-bottom');
        if (!container) return;
        
        const btnRect = btn.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const padding = 8;
        const gap = 12;
        
        // 计算初始位置：从sidebar容器右边界开始，保持一定距离
        // sidebar-bottom容器宽度等于sidebar宽度，所以菜单从容器右边界开始
        let left = containerRect.width + gap;
        // 临时设置位置以获取菜单尺寸
        menu.style.setProperty('--menu-top', '0px');
        menu.style.setProperty('--menu-left', `${left}px`);
        const menuRect = menu.getBoundingClientRect();
        
        // 计算菜单顶部位置，使菜单底部对齐按钮底部
        let top = btn.offsetTop + btn.offsetHeight - menuRect.height;
        
        // 检查水平溢出并调整
        const menuRight = containerRect.left + left + menuRect.width;
        if (menuRight > viewportWidth - padding) {
            // 右侧空间不足，尝试显示在sidebar容器左侧
            const leftPos = -menuRect.width - gap;
            const menuLeft = containerRect.left + leftPos;
            
            if (menuLeft >= padding) {
                // 左侧有足够空间
                left = leftPos;
            } else {
                // 左侧空间也不足，调整到右边界内
                left = viewportWidth - containerRect.left - menuRect.width - padding;
            }
        }
        
        // 检查左边界溢出
        const finalMenuLeft = containerRect.left + left;
        if (finalMenuLeft < padding) {
            left = padding - containerRect.left;
        }
        
        // 检查垂直溢出并调整
        let finalTop = top;
        
        // 计算菜单在视口中的底部位置（应该对齐按钮底部）
        const menuBottom = containerRect.top + top + menuRect.height;
        const maxBottom = viewportHeight - padding;
        
        // 如果菜单底部超出视口，向上调整
        if (menuBottom > maxBottom) {
            finalTop = maxBottom - containerRect.top - menuRect.height;
        }
        
        // 检查上边界溢出
        const finalMenuTop = containerRect.top + finalTop;
        if (finalMenuTop < padding) {
            finalTop = padding - containerRect.top;
            // 如果菜单太高无法完全显示，限制菜单高度使其可滚动
            const maxVisibleHeight = viewportHeight - padding * 2;
            if (menuRect.height > maxVisibleHeight) {
                menu.style.setProperty('--menu-max-height', `${maxVisibleHeight}px`);
            } else {
                menu.style.removeProperty('--menu-max-height');
            }
        } else {
            // 清除可能之前设置的 maxHeight
            menu.style.removeProperty('--menu-max-height');
        }
        
        // 应用最终位置
        menu.style.setProperty('--menu-top', `${finalTop}px`);
        menu.style.setProperty('--menu-left', `${left}px`);
    }

    /**
     * 绑定 Fetch README 按钮事件
     * @private
     */
    _bindFetchReadmeButton() {
        const btn = document.getElementById('btn-fetch-readme');
        if (btn) {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!this.onFetchReadme) return;

                const githubUrlInput = this._settingsInputs?.githubUrlInput;
                if (!githubUrlInput) return;

                const githubUrl = githubUrlInput.value.trim();
                if (!githubUrl) {
                    if (window.notify) {
                        window.notify.alert('Please enter a GitHub URL', { type: 'warning' });
                    }
                    return;
                }

                try {
                    await this.onFetchReadme(githubUrl);
                } catch (error) {
                    // Error handling is done in the handler
                }
            });
        }
    }

    /**
     * 绑定 File Size Chart 按钮事件
     * @private
     */
    _bindFileSizeChartButton() {
        const btn = document.getElementById('btn-file-size-chart');
        if (btn) {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!this.onFileSizeChart) return;

                try {
                    await this.onFileSizeChart();
                } catch (error) {
                    // Error handling is done in the handler
                }
            });
        }
    }

    /**
     * 绑定 Auto Space 按钮事件
     * @private
     */
    _bindAutoSpaceButton() {
        const btn = document.getElementById('btn-auto-space');
        if (btn) {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!this.onAutoSpace) return;

                try {
                    await this.onAutoSpace();
                } catch (error) {
                    // Error handling is done in the handler
                }
            });
        }
    }

    /**
     * 绑定 Pure Color 按钮事件
     * @private
     */
    _bindPureColorButton() {
        const btn = document.getElementById('btn-pure-color');
        if (btn) {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!this.onPureColor) return;

                try {
                    await this.onPureColor();
                } catch (error) {
                    // Error handling is done in the handler
                }
            });
        }
    }

    /**
     * 关闭所有菜单
     * @private
     */
    _closeAllMenus() {
        this.settingsMenu.classList.add('hidden');
        this.toolsMenu.classList.add('hidden');
    }
}
