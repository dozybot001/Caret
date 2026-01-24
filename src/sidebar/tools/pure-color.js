/**
 * @fileoverview Pure Color Feature
 * @description Color picker modal with fullscreen display option
 */

/**
 * Pure Color Feature
 * @class PureColorFeature
 */
export class PureColorFeature {
    /**
     * @param {Object} context - Feature context
     */
    constructor(context) {
        this.context = context;
        this.modal = null;
        this.currentColor = '#3498db';
        this.isFullscreen = false;
    }

    /**
     * Execute pure color feature - show modal
     * @returns {Promise<void>}
     */
    async execute() {
        if (!this.modal) {
            this._createModal();
        }
        this._showModal();
    }

    /**
     * Create the modal DOM structure
     * @private
     */
    _createModal() {
        // Create modal container
        this.modal = document.createElement('div');
        this.modal.className = 'pure-color-modal hidden';
        this.modal.innerHTML = `
            <div class="pure-color-modal-content">
                <div class="pure-color-modal-header">
                    <h2>Pure Color</h2>
                    <button type="button" class="btn btn-close" id="pure-color-close">
                        <i class="codicon codicon-close"></i>
                    </button>
                </div>
                <div class="pure-color-modal-body">
                    <div class="pure-color-preview-section">
                        <div class="pure-color-preview" id="pure-color-preview"></div>
                    </div>
                    <div class="pure-color-controls">
                        <div class="pure-color-input-row">
                            <label for="pure-color-picker">Color:</label>
                            <input type="color" id="pure-color-picker" value="${this.currentColor}">
                            <input type="text" id="pure-color-text" value="${this.currentColor}" maxlength="7">
                        </div>
                        <div class="pure-color-presets" id="pure-color-presets"></div>
                    </div>
                    <div class="pure-color-actions">
                        <button type="button" class="btn btn-text" id="pure-color-fullscreen">
                            <i class="codicon codicon-screen-full"></i>
                            <span>Fullscreen</span>
                        </button>
                        <button type="button" class="btn btn-text" id="pure-color-random">
                            <i class="codicon codicon-refresh"></i>
                            <span>Random</span>
                        </button>
                    </div>
                </div>
            </div>
            <div class="pure-color-fullscreen-bg hidden" id="pure-color-fullscreen-bg"></div>
            <div class="pure-color-fullscreen-controls hidden" id="pure-color-fullscreen-controls">
                <button type="button" class="btn btn-close" id="pure-color-exit-fullscreen" title="Exit Fullscreen">
                    <i class="codicon codicon-close"></i>
                </button>
                <button type="button" class="btn btn-close" id="pure-color-new-color" title="New Color">
                    <i class="codicon codicon-refresh"></i>
                </button>
            </div>
        `;

        document.body.appendChild(this.modal);
        this._bindEvents();
        this._createPresets();
    }

    /**
     * Create preset color buttons
     * @private
     */
    _createPresets() {
        const presets = [
            '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
            '#9b59b6', '#1abc9c', '#e67e22', '#34495e'
        ];

        const presetsContainer = this.modal.querySelector('#pure-color-presets');
        presets.forEach(color => {
            const preset = document.createElement('div');
            preset.className = 'pure-color-preset';
            preset.style.backgroundColor = color;
            preset.setAttribute('data-color', color);
            preset.addEventListener('click', () => this._updateColor(color));
            presetsContainer.appendChild(preset);
        });
    }

    /**
     * Bind event listeners
     * @private
     */
    _bindEvents() {
        const colorPicker = this.modal.querySelector('#pure-color-picker');
        const colorText = this.modal.querySelector('#pure-color-text');
        const colorPreview = this.modal.querySelector('#pure-color-preview');
        const fullscreenBtn = this.modal.querySelector('#pure-color-fullscreen');
        const randomBtn = this.modal.querySelector('#pure-color-random');
        const closeBtn = this.modal.querySelector('#pure-color-close');
        const exitFullscreenBtn = this.modal.querySelector('#pure-color-exit-fullscreen');
        const newColorBtn = this.modal.querySelector('#pure-color-new-color');
        const fullscreenBg = this.modal.querySelector('#pure-color-fullscreen-bg');
        const fullscreenControls = this.modal.querySelector('#pure-color-fullscreen-controls');

        // Color picker input
        colorPicker.addEventListener('input', (e) => {
            this._updateColor(e.target.value);
        });

        // Color text input
        colorText.addEventListener('input', (e) => {
            const color = e.target.value;
            if (this._isValidColor(color)) {
                this._updateColor(color);
            }
        });

        colorText.addEventListener('change', (e) => {
            const color = e.target.value;
            if (!this._isValidColor(color)) {
                e.target.value = this.currentColor;
            }
        });

        // Preview click
        colorPreview.addEventListener('click', () => {
            colorPicker.click();
        });

        // Fullscreen button
        fullscreenBtn.addEventListener('click', () => {
            this._enterFullscreen();
        });

        // Random button
        randomBtn.addEventListener('click', () => {
            this._generateRandomColor();
        });

        // Close button
        closeBtn.addEventListener('click', () => {
            this._hideModal();
        });

        // Exit fullscreen
        exitFullscreenBtn.addEventListener('click', () => {
            this._exitFullscreen();
        });

        // New color in fullscreen
        newColorBtn.addEventListener('click', () => {
            this._generateRandomColor();
            setTimeout(() => this._enterFullscreen(), 100);
        });

        // ESC key to exit fullscreen
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isFullscreen) {
                this._exitFullscreen();
            }
        });

        // Click outside modal to close
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this._hideModal();
            }
        });
    }

    /**
     * Update color
     * @private
     * @param {string} color - Color value
     */
    _updateColor(color) {
        // Ensure color format is correct
        if (!color.startsWith('#')) {
            color = '#' + color;
        }

        this.currentColor = color;

        // Update UI elements
        const colorPicker = this.modal.querySelector('#pure-color-picker');
        const colorText = this.modal.querySelector('#pure-color-text');
        const colorPreview = this.modal.querySelector('#pure-color-preview');
        const fullscreenBg = this.modal.querySelector('#pure-color-fullscreen-bg');

        if (colorPicker) colorPicker.value = color;
        if (colorText) colorText.value = color;
        if (colorPreview) colorPreview.style.backgroundColor = color;

        // Update fullscreen background if in fullscreen mode
        if (this.isFullscreen && fullscreenBg) {
            fullscreenBg.style.backgroundColor = color;
        }
    }

    /**
     * Enter fullscreen mode
     * @private
     */
    _enterFullscreen() {
        this.isFullscreen = true;
        const fullscreenBg = this.modal.querySelector('#pure-color-fullscreen-bg');
        const fullscreenControls = this.modal.querySelector('#pure-color-fullscreen-controls');
        const modalContent = this.modal.querySelector('.pure-color-modal-content');

        if (fullscreenBg) {
            fullscreenBg.style.backgroundColor = this.currentColor;
            fullscreenBg.classList.remove('hidden');
        }
        if (fullscreenControls) {
            fullscreenControls.classList.remove('hidden');
        }
        if (modalContent) {
            modalContent.classList.add('hidden');
        }
    }

    /**
     * Exit fullscreen mode
     * @private
     */
    _exitFullscreen() {
        this.isFullscreen = false;
        const fullscreenBg = this.modal.querySelector('#pure-color-fullscreen-bg');
        const fullscreenControls = this.modal.querySelector('#pure-color-fullscreen-controls');
        const modalContent = this.modal.querySelector('.pure-color-modal-content');

        if (fullscreenBg) {
            fullscreenBg.classList.add('hidden');
        }
        if (fullscreenControls) {
            fullscreenControls.classList.add('hidden');
        }
        if (modalContent) {
            modalContent.classList.remove('hidden');
        }
    }

    /**
     * Generate random color
     * @private
     */
    _generateRandomColor() {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        this._updateColor(color);
    }

    /**
     * Validate color format
     * @private
     * @param {string} color - Color value
     * @returns {boolean}
     */
    _isValidColor(color) {
        const hexPattern = /^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
        return hexPattern.test(color);
    }

    /**
     * Show modal
     * @private
     */
    _showModal() {
        if (this.modal) {
            this.modal.classList.remove('hidden');
            this._updateColor(this.currentColor);
        }
    }

    /**
     * Hide modal
     * @private
     */
    _hideModal() {
        if (this.modal) {
            this._exitFullscreen();
            this.modal.classList.add('hidden');
        }
    }
}
