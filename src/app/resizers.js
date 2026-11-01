/**
 * @fileoverview 侧栏拖拽
 * @description 拖动文件树和 Agent 面板的边界，在固定范围内调整宽度，并记住结果
 */

import { getPanelWidth, setPanelWidth } from './preferences.js';

const PANELS = {
    tree: { element: 'file-tree-panel', handle: 'resize-tree', variable: '--tree-width', min: 180, max: 480, initial: 260, direction: 1 },
    chat: { element: 'chat-panel', handle: 'resize-chat', variable: '--chat-width', min: 280, max: 640, initial: 360, direction: -1 }
};

/** 无论怎么拖，编辑器至少保留这个宽度 */
const EDITOR_MIN_WIDTH = 320;
const KEY_STEP = 16;

const element = id => document.getElementById(id);

let isDragging = false;

/**
 * 限制在固定范围内。编辑器和这一栏现在的宽度之和，就是这一栏最多能用的空间
 * @private
 */
function clamp(name, width) {
    const { min, max } = PANELS[name];
    const room = element('editor-area').offsetWidth + element(PANELS[name].element).offsetWidth - EDITOR_MIN_WIDTH;
    return Math.max(min, Math.min(max, room, width));
}

function apply(name, width) {
    const { variable, handle } = PANELS[name];
    const value = clamp(name, width);
    document.documentElement.style.setProperty(variable, `${value}px`);
    element(handle).setAttribute('aria-valuenow', String(value));
    return value;
}

function bindHandle(name) {
    const { element: panelId, handle: handleId, min, max, initial, direction } = PANELS[name];
    const handle = element(handleId);
    handle.setAttribute('aria-valuemin', String(min));
    handle.setAttribute('aria-valuemax', String(max));

    const commit = (width) => setPanelWidth(name, apply(name, width));

    handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = element(panelId).offsetWidth;
        let width = startWidth;

        isDragging = true;
        handle.setPointerCapture(event.pointerId);
        handle.classList.add('is-dragging');
        document.documentElement.classList.add('is-resizing');

        const move = (moveEvent) => {
            width = apply(name, startWidth + (moveEvent.clientX - startX) * direction);
        };
        const stop = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', stop);
            handle.removeEventListener('pointercancel', stop);
            handle.classList.remove('is-dragging');
            document.documentElement.classList.remove('is-resizing');
            isDragging = false;
            commit(width);
        };

        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', stop);
        handle.addEventListener('pointercancel', stop);
    });

    handle.addEventListener('dblclick', () => commit(initial));

    handle.addEventListener('keydown', (event) => {
        const current = element(panelId).offsetWidth;
        const target = {
            ArrowLeft: current - KEY_STEP * direction,
            ArrowRight: current + KEY_STEP * direction,
            Home: min,
            End: max
        }[event.key];
        if (target === undefined) return;
        event.preventDefault();
        commit(target);
    });
}

/** 恢复保存的宽度并绑定拖拽 */
export function initResizers() {
    const applySaved = () => {
        if (isDragging) return;
        for (const name of Object.keys(PANELS)) apply(name, getPanelWidth(name) ?? PANELS[name].initial);
    };

    applySaved();
    Object.keys(PANELS).forEach(bindHandle);

    // 窗口变化或侧栏开合时重新限制。保存的宽度不变，空间够了之后可以恢复
    new ResizeObserver(() => requestAnimationFrame(applySaved)).observe(element('editor-area'));
}
