/**
 * @fileoverview 应用控制器
 * @description 核心协调者，负责初始化所有组件并协调它们之间的交互
 *
 * ## 职责
 * - 初始化所有 UI 组件（ChatUI, ChangesUI, FileTreeUI, Settings）
 * - 协调 Agent、编辑器和文件系统
 * - 绑定全局事件和回调
 *
 * ## 数据流
 * 用户输入 → Agent → read/write/edit → 编辑器缓冲区 → 用户审阅 → 写入磁盘
 *
 * @module AppController
 */

import { Agent } from '../agent/agent.js';
import { Workspace } from '../agent/workspace.js';
import { ChatUI } from '../chat/chat-ui.js';
import { Composer } from '../chat/composer.js';
import { Conversations } from '../chat/conversations.js';
import { SessionHistory } from '../chat/history.js';
import { PromptRecall } from '../chat/prompt-recall.js';
import { Review } from '../chat/review.js';
import { describeError, RUN_NOTES } from '../chat/run-messages.js';
import { applyMonacoTheme } from '../editor/monaco.js';
import { FileHandlers } from '../file-tree/file-handlers.js';
import { FileTreeUI } from '../file-tree/file-tree-ui.js';
import { bindFolderDrop } from '../file-tree/folder-drop.js';
import { Settings } from '../settings/settings.js';
import { applyTranslations, onLanguageChange, t } from '../i18n/index.js';
import { canMigrate, migrateFromLegacy } from './migration.js';
import { clearPreferences, onThemeChange } from './preferences.js';
import { initResizers } from './resizers.js';
import { FILING, LEGACY_DOMAIN, legacyDeadline } from './site.js';

/**
 * 应用控制器
 * @class AppController
 */
export class AppController {
    /**
     * 构造函数
     * @param {Object} fileManager - 文件管理器实例
     * @param {Object} editorManager - 编辑器管理器实例
     * @param {Object} store - 状态存储实例
     */
    constructor(fileManager, editorManager, store) {
        this.file = fileManager;
        this.editor = editorManager;
        this.store = store;
        this.workspace = new Workspace(fileManager, editorManager);
        this.history = new SessionHistory(store);
        this.promptRecall = new PromptRecall();

        /** 选好文件夹或连好模型后要继续发送 */
        this.waitingToSend = false;
        /** 正在清除全部数据，刷新页面时不再提醒 */
        this.isLeaving = false;
        this.replyRow = null;
    }

    /**
     * 初始化应用
     * @returns {Promise<void>}
     */
    async init() {
        applyTranslations();
        this._initUI();
        this._initAgent();
        this._bindEditor();
        this.composer = new Composer(this, {
            input: document.getElementById('chat-input'),
            sendButton: document.getElementById('btn-send-chat'),
            modelButton: document.getElementById('btn-model'),
            effortButton: document.getElementById('btn-effort')
        });
        bindFolderDrop({
            isBusy: () => this.agent.running,
            onFolder: handle => this.fileHandlers.handleDroppedFolder(handle)
        });
        this._bindWindow();
        initResizers();

        await this._restoreFolder();
        await this.editor.tabState.restore();
        if (this.file.hasRoot()) await this.conversations.openProject();
        this.composer.updateModelButton();
        this.connection.refreshModels();
        this.composer.input.focus();
    }

    /**
     * 初始化 UI 组件
     * @private
     */
    _initUI() {
        const element = id => document.getElementById(id);
        this.chatPanel = element('chat-panel');
        this.welcome = element('welcome');

        this.chatUI = new ChatUI(this.chatPanel, element('chat-messages'), element('chat-input'), element('context-ring'));
        this.chatUI.onFileClick = path => this.review.open(path);

        this.fileTreeUI = new FileTreeUI(element('file-tree'), element('file-tree-panel'));
        this.fileHandlers = new FileHandlers({
            file: this.file,
            editor: this.editor,
            fileTreeUI: this.fileTreeUI,
            onFolderOpened: () => this.conversations.openProject()
        });

        this.settings = new Settings(element('settings-dialog'), this.store);
        this.settings.init();
        this.connection = this.settings.connection;
        this.connection.onChange = () => this.composer.updateModelButton();
        this.settings.onClose = () => {
            if (this.waitingToSend && this.connection.isReady()) this.composer.submit();
            this.waitingToSend = false;
        };
        this.settings.data.isBusy = () => this.agent.running;
        this.settings.data.onClearConversations = () => this.conversations.clearAll();
        this.settings.data.onDeleteAll = () => this._deleteAllData();

        this.review = new Review(this, element('changes-panel'));
        this.conversations = new Conversations(this, {
            chatPanel: this.chatPanel,
            chatMessages: element('chat-messages'),
            historyButton: element('btn-history'),
            historyPanel: element('history-panel')
        });

        element('btn-toggle-tree').addEventListener('click', () => this.fileTreeUI.fileTreePanel.classList.toggle('collapsed'));
        element('btn-toggle-chat').addEventListener('click', () => this.chatPanel.classList.toggle('collapsed'));
        element('btn-open-folder').addEventListener('click', () => this._openFolder());
        element('btn-welcome-open').addEventListener('click', () => this._openFolder());
        element('btn-settings').addEventListener('click', () => this.settings.open());
        element('context-ring').addEventListener('click', () => this.settings.open('context'));
        document.querySelectorAll('[data-legal]').forEach(button => {
            button.addEventListener('click', () => this.settings.open(button.dataset.legal));
        });
        element('btn-new-task').addEventListener('click', () => this.conversations.startNew());
        this._renderFilings();
        this._initMigration();

        this.history.onError = () => window.notify?.alert(t('history.saveFailed'), { type: 'warning' });

        this.fileTreeUI.onOpenFolder = () => this._openFolder();
        this.fileTreeUI.onResumeFolder = () => this.fileHandlers.handleResumeFolder();
        this.fileTreeUI.onReleaseFolder = () => this._releaseFolder();
        this.fileTreeUI.onFileClick = (handle, path, isPreview) => {
            this.workspace.follow = false;
            this.editor.openFile(handle, path, isPreview && this.store.getConfig().previewTabs);
            if (this.fileTreeUI.isOverlay()) this.fileTreeUI.setFileTreeVisible(false);
        };

        // 窗口变窄时文件树改为覆盖式，先收起，避免挡住编辑器
        window.matchMedia('(max-width: 900px)').addEventListener('change', () => {
            this.fileTreeUI.setFileTreeVisible(this.file.hasRoot());
        });

        if (!('showDirectoryPicker' in window)) {
            const note = element('welcome-note');
            note.dataset.i18n = 'error.unsupported';
            note.textContent = t('error.unsupported');
            element('btn-welcome-open').classList.add('hidden');
        }

        onLanguageChange(() => this._renderStatic());
    }

    /** 窄屏时 Agent 面板和编辑器只显示一个 */
    isNarrow() {
        return window.matchMedia('(max-width: 760px)').matches;
    }

    /**
     * 更新不随 data-i18n 变化的文案
     * @private
     */
    _renderStatic() {
        this.composer.updateModelButton();
        this.composer.updateSendButton();
        if (this.file.hasRoot()) this.fileHandlers.refreshTree();
        else if (this.file.pendingHandle) this.fileTreeUI.renderResume(this.file.pendingHandle.name);
        else this.fileTreeUI.renderEmpty();
        this._renderMigratePrompt();
    }

    /**
     * 显示备案号
     * @private
     */
    _renderFilings() {
        const { icp, police } = FILING;
        document.querySelectorAll('[data-filing="icp"]').forEach(link => {
            link.textContent = icp;
            link.hidden = !icp;
        });
        document.querySelectorAll('[data-filing="police"]').forEach(link => {
            link.textContent = `湘公网安备${police}号`;
            link.href = `https://beian.mps.gov.cn/#/query/webSearch?code=${police}`;
            link.hidden = !police;
        });
    }

    /**
     * 迁到新地址后，欢迎页提供从旧地址迁移设置和对话的入口
     * @private
     */
    _initMigration() {
        this.migrateRow = document.getElementById('welcome-migrate');
        this._renderMigratePrompt();
        if (!canMigrate(this.store.getConfig())) return;
        this.migrateRow.hidden = false;
        const button = this.migrateRow.querySelector('button');
        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                const { count, cleared } = await migrateFromLegacy(this.store);
                // 旧地址删掉数据才算迁移完成，否则保留入口，再点一次会接着删
                if (cleared) await this.store.updateConfig({ legacyMigrated: true });
                if (count === null) {
                    button.disabled = false;
                    this.migrateRow.hidden = cleared;
                    if (cleared) window.notify?.alert(t('migrate.empty'));
                    else window.notify?.alert(t('migrate.notCleared'), { type: 'warning' });
                    return;
                }
                window.notify?.alert(t('migrate.done', count, cleared), { type: 'success' });
                if (!cleared) window.notify?.alert(t('migrate.notCleared'), { type: 'warning', duration: 6000 });
                // 刷新后设置、显示偏好和模型菜单都按迁过来的数据加载
                this.isLeaving = true;
                setTimeout(() => location.reload(), cleared ? 2500 : 6000);
            } catch (error) {
                button.disabled = false;
                window.notify?.alert(t('migrate.failed', error.message), { type: 'error' });
            }
        });
    }

    /** 迁移入口的说明，定下截止日期后一并提醒 */
    _renderMigratePrompt() {
        this.migrateRow.querySelector('span').textContent = t('migrate.prompt', LEGACY_DOMAIN, legacyDeadline());
    }

    /**
     * 连接 Agent 与界面
     * @private
     */
    _initAgent() {
        const { chatUI } = this;
        this.agent = new Agent(this.workspace, () => this.connection.getConnection(), {
            onThinking: () => chatUI.setStatus(this.replyRow ? null : 'chat.thinking'),
            onToolCall: () => chatUI.setStatus('chat.generating'),
            onText: (text) => {
                chatUI.setStatus(null);
                this.replyRow ||= chatUI.addReply();
                chatUI.updateReply(this.replyRow, text);
            },
            onStepStart: (name, args) => {
                this.replyRow = null;
                chatUI.setStatus(null);
                const verb = name === 'read' ? (args?.pattern ? 'search' : 'read') : name;
                return chatUI.addStep(verb, args?.pattern || args?.path || '.');
            },
            onStepEnd: (row, result) => {
                chatUI.finishStep(row, result);
                chatUI.setStatus('chat.thinking');
                this.conversations.updateUsage();
                this.conversations.save();
            },
            onCompact: () => {
                chatUI.addNote('chat.compacted');
                this.conversations.updateUsage();
            }
        }, () => this.store.getConfig());
    }

    /**
     * 应用设置里的偏好
     * @private
     * @param {Object} changes - 这次改动的设置，启动时为空
     */
    _applyPreferences(changes = {}) {
        const config = this.store.getConfig();
        this.editor.views.setFontSize(config.fontSize);
        this.editor.views.setPreferences(config);
        document.documentElement.style.setProperty('--chat-font-size', `${config.chatFontSize}px`);
        this.file.setUserIgnoreRules(config.ignoreRules);
        this.fileHandlers.showGit = config.gitStatus;
        this.history.isEnabled = config.saveHistory;

        if ('ignoreRules' in changes) this.fileHandlers.refreshTree();
        else if ('gitStatus' in changes) this.fileHandlers.refreshGit();
        if ('contextLimit' in changes) this.conversations.updateUsage();
    }

    /**
     * 绑定编辑器事件
     * @private
     */
    _bindEditor() {
        const { editor } = this;

        editor.store = this.store;
        editor.fileManager = this.file;
        this._applyPreferences();
        this.settings.onPreferencesChange = changes => this._applyPreferences(changes);
        editor.views.onFontSizeChange = fontSize => this.store.updateConfig({ fontSize });

        editor.onChangesUpdated = () => {
            const changes = editor.changes.list();
            this.review.ui.render(changes);
            this.review.ui.setLocked(this.agent.running);
            this.fileTreeUI.setChangedPaths(changes.map(change => change.path));
        };
        editor.onFileSaved = () => this.fileHandlers.refreshGit();
        editor.onEmptyChange = (isEmpty) => {
            this.welcome.classList.toggle('hidden', !isEmpty);
        };
        editor.onUserNavigate = () => {
            this.workspace.follow = false;
        };

        onThemeChange(applyMonacoTheme);
    }

    /**
     * 运行 Agent 并更新界面
     * @param {Function} start - 启动函数
     */
    async run(start) {
        const startedAt = performance.now();
        this.replyRow = null;
        this.workspace.follow = this.store.getConfig().followAgent;
        this.review.ui.setLocked(true);
        this.chatUI.setStatus('chat.thinking');

        const running = start();
        this.composer.updateSendButton();
        this.conversations.save();
        try {
            const outcome = await running;
            if (RUN_NOTES[outcome]) {
                this.chatUI.addNote(RUN_NOTES[outcome]);
            } else {
                const seconds = Math.max(1, Math.round((performance.now() - startedAt) / 1000));
                this.chatUI.addNote('chat.finished', seconds);
            }
        } catch (error) {
            const describe = describeError(error);
            const canRetry = !error.code;
            this.chatUI.addError(describe, canRetry ? () => this.run(() => this.agent.resume()) : null);
        } finally {
            this.chatUI.setStatus(null);
            this.conversations.updateUsage();
            this.review.ui.setLocked(false);
            this.composer.updateSendButton();
            this.composer.input.focus();
            // 运行结束后从第一个改动开始审阅
            const [firstChange] = this.editor.changes.list();
            if (firstChange && this.workspace.follow) {
                this.editor.changes.show(firstChange.path, { focus: false });
            }
            this.conversations.save();
            await this.history.flush();
            await this.conversations.refresh();
        }
    }

    /**
     * 打开文件夹。运行中不切换，避免 Agent 的改动落到另一个项目
     * @private
     */
    _openFolder() {
        if (!this.agent.running) return this.fileHandlers.handleOpenFolder();
    }

    /**
     * 取消文件夹授权，回到初始状态。对话记录保留，重新打开同名文件夹时可以继续
     * @private
     */
    async _releaseFolder() {
        const { file } = this;
        const { pendingHandle } = file;
        const handle = file.getRootHandle() || pendingHandle;
        if (!handle) return;
        if (this.agent.running) {
            window.notify?.alert(t('folder.releaseBusy'), { type: 'warning' });
            return;
        }
        if (!(await window.notify.confirm(t('folder.releaseConfirm', handle.name), t('folder.release')))) return;

        // 还没恢复访问的文件夹没有打开项目，先找到它的记录
        if (pendingHandle) await this.history.openProject(pendingHandle);
        await this.history.releaseProject();
        await this.fileHandlers.handleReleaseFolder();
        this.workspace.files = [];
        this.promptRecall.load([]);
        this.conversations.reset();
        await this.conversations.refresh();
        this.conversations.setHistoryVisible(false);
        if (this.isNarrow()) this.chatPanel.classList.add('collapsed');
        window.notify?.alert(t('folder.released', handle.name), { type: 'success' });
    }

    /** 删除这个浏览器里的全部 Caret 数据，然后回到初次打开时的样子 */
    async _deleteAllData() {
        await this.history.clearAll();
        await this.store.deleteDatabase();
        clearPreferences();
        this.isLeaving = true;
        location.reload();
        // 刷新完成前按钮保持等待状态，也不再读取数据库
        await new Promise(() => {});
    }

    /**
     * 关闭页面前提醒未写入的改动
     * @private
     */
    _bindWindow() {
        window.addEventListener('beforeunload', (event) => {
            if (this.isLeaving) return;
            if (this.editor.changes.list().length > 0 || this.agent.running) event.preventDefault();
        });
        // 在终端里提交或切换分支后回到页面时更新
        window.addEventListener('focus', () => this.fileHandlers.refreshGit());
    }

    /**
     * 恢复之前打开的文件夹
     * @private
     */
    async _restoreFolder() {
        const rootHandle = this.file.getRootHandle();
        if (this.file.pendingHandle) {
            this.fileTreeUI.renderResume(this.file.pendingHandle.name);
            return;
        }
        if (!rootHandle) {
            // 欢迎页已经给出打开入口，这里不重复
            this.fileTreeUI.renderEmpty();
            this.fileTreeUI.setFileTreeVisible(false);
            if (this.isNarrow()) this.chatPanel.classList.add('collapsed');
            return;
        }

        try {
            await this.fileHandlers.refreshTree();
            this.fileTreeUI.setFileTreeVisible(true);
        } catch (err) {
            // 文件夹可能已被删除或移动
            this.file.rootDirHandle = null;
            await this.store.clearDirectoryHandle();
            this.fileTreeUI.renderEmpty();
            window.notify?.alert(t('error.generic', err.message), { type: 'warning' });
        }
    }
}
