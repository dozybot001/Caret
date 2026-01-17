/**
 * @fileoverview 应用入口文件
 * @description 负责实例化 UI、编辑器、文件系统等管理器并启动 AppController 核心流程
 * 
 * ## 初始化流程
 * 1. 等待 DOM 加载完成
 * 2. 初始化管理器：
 *    - AppStore: 状态管理
 *    - FileManager: 文件系统操作
 *    - EditorManager: Monaco 编辑器管理
 * 3. 创建并初始化 AppController（核心协调器，负责初始化 UI 组件）
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

// 等待 DOM 加载完成后初始化应用
document.addEventListener('DOMContentLoaded', async () => {
    // 初始化通知系统（全局单例）
    const notificationContainer = document.getElementById('notification-container');
    const notify = new Notify(notificationContainer);
    window.notify = notify; // 全局访问
    
    // 初始化各个管理器
    const store = new AppStore();
    const fileManager = new FileManager(store);

    // 创建编辑器管理器
    const editorManager = new EditorManager(
        document.getElementById('monaco-container'),
        document.getElementById('tabs-bar')
    );

    // 并行初始化（延迟加载 Monaco Editor）
    const initPromises = [
        store.init(), // 初始化存储（加载配置）
        fileManager.init() // 初始化文件管理器（TreeSitter 延迟加载）
    ];
    
    // 延迟加载 Monaco Editor（只在需要时加载）
    const editorInitPromise = new Promise((resolve) => {
        const initEditor = () => editorManager.init().then(resolve);
        if ('requestIdleCallback' in window) {
            requestIdleCallback(initEditor, { timeout: 100 });
        } else {
            setTimeout(initEditor, 100);
        }
    });
    
    initPromises.push(editorInitPromise);

    // 等待初始化完成
    await Promise.all(initPromises);

    // 创建并初始化应用控制器（AppController 内部会初始化 UI 组件）
    const app = new AppController(fileManager, editorManager, store);
    
    // 延迟初始化应用（使用 requestIdleCallback）
    const initApp = () => app.init();
    if ('requestIdleCallback' in window) {
        requestIdleCallback(initApp, { timeout: 200 });
    } else {
        setTimeout(initApp, 200);
    }
});
