/**
 * @fileoverview 应用入口文件
 * @description 负责实例化 UI、编辑器、文件系统等管理器并启动 AppController 核心流程
 *
 * ## 初始化流程
 * 1. 初始化管理器：
 *    - AppStore: 状态管理
 *    - FileManager: 文件系统操作
 *    - EditorManager: Monaco 编辑器管理
 * 2. 创建并初始化 AppController（核心协调器，负责初始化 UI 组件）
 *
 * ## 模块依赖
 * - AppController 协调所有模块
 * - 所有管理器通过依赖注入传递给 AppController
 *
 * @module main
 */

import { EditorManager } from './src/editor/editor-manager.js';
import { FileManager } from './src/file-tree/file-manager.js';
import { AppController } from './src/global/app-controller.js';
import { AppStore } from './src/global/store.js';
import { Notify } from './src/global/notification-system.js';

// 初始化通知系统（全局单例）
window.notify = new Notify(document.getElementById('notification-container'));

// 切换文件时 Monaco 会取消进行中的 diff 计算，不是错误
window.addEventListener('unhandledrejection', (event) => {
    if (event.reason?.name === 'Canceled') event.preventDefault();
});

const store = new AppStore();
const fileManager = new FileManager(store);
const editorManager = new EditorManager(
    document.getElementById('monaco-container'),
    document.getElementById('tabs-bar')
);

await store.init();
await Promise.all([fileManager.init(), editorManager.init()]);

await new AppController(fileManager, editorManager, store).init();
