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
import { isContextError } from '../agent/model.js';
import { Workspace } from '../agent/workspace.js';
import { ChangesUI } from '../chat/changes-ui.js';
import { ChatUI } from '../chat/chat-ui.js';
import { SessionHistory } from '../chat/history.js';
import { HistoryUI } from '../chat/history-ui.js';
import { PromptRecall } from '../chat/prompt-recall.js';
import { FileHandlers } from '../file-tree/file-handlers.js';
import { FileTreeUI } from '../file-tree/file-tree-ui.js';
import { Settings } from '../sidebar/settings.js';
import { applyTranslations, onLanguageChange, t } from './i18n.js';
import { onThemeChange } from './preferences.js';
import { initResizers } from './resizers.js';

/**
 * 把错误转成用户能处理的说明
 * @param {Error} error - 错误
 * @returns {Function} 返回当前语言的文案
 */
function describeError(error) {
    const { status, code, name, message } = error;
    if (code === 'too-many-steps') return () => t('error.steps');
    if (status === 401 || status === 403) return () => t('error.auth');
    if (status === 402 || status === 429) return () => t('error.rate');
    if (isContextError(error)) return () => t('error.long');
    if (status) return () => t('error.http', status, message);
    if (name === 'NotAllowedError') return () => t('error.permission');
    if (name === 'TypeError') return () => t('error.network');
    return () => t('error.generic', message);
}

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
        this.sessions = [];

        /** 选好文件夹或连好模型后要继续发送 */
        this.waitingToSend = false;
        this.stepStartedAt = 0;
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
        this._bindChat();
        this._bindDragAndDrop();
        this._bindWindow();
        initResizers();

        await this._restoreFolder();
        await this.editor.restoreTabsState();
        if (this.file.hasRoot()) await this._openProject();
        this._updateModelButton();
        this.input.focus();
    }

    /**
     * 初始化 UI 组件
     * @private
     */
    _initUI() {
        const element = id => document.getElementById(id);
        this.input = element('chat-input');
        this.sendButton = element('btn-send-chat');
        this.modelButton = element('btn-model');
        this.chatPanel = element('chat-panel');
        this.chatMessages = element('chat-messages');
        this.historyButton = element('btn-history');
        this.welcome = element('welcome');

        this.chatUI = new ChatUI(this.chatPanel, element('chat-messages'), this.input, element('context-ring'));
        this.chatUI.onFileClick = path => this._openChange(path);

        this.fileTreeUI = new FileTreeUI(element('file-tree'), element('file-tree-panel'));
        this.fileHandlers = new FileHandlers({
            file: this.file,
            editor: this.editor,
            fileTreeUI: this.fileTreeUI,
            onFolderOpened: () => this._openProject()
        });

        this.settings = new Settings(element('settings-dialog'), this.store);
        this.settings.init();
        this.settings.onConnectionChange = () => this._updateModelButton();
        this.settings.onClose = () => {
            if (this.waitingToSend && this.settings.isReady()) this._submit();
            this.waitingToSend = false;
        };

        this.changesUI = new ChangesUI(element('changes-panel'), {
            onOpen: path => this._openChange(path),
            onDiscard: path => this._discard([path]),
            onDiscardAll: () => this._discard(this.editor.getChanges().map(change => change.path)),
            onApply: force => this._apply(force)
        });

        element('btn-toggle-tree').addEventListener('click', () => this.fileTreeUI.fileTreePanel.classList.toggle('collapsed'));
        element('btn-toggle-chat').addEventListener('click', () => this.chatPanel.classList.toggle('collapsed'));
        element('btn-open-folder').addEventListener('click', () => this._openFolder());
        element('btn-welcome-open').addEventListener('click', () => this._openFolder());
        element('btn-settings').addEventListener('click', () => this.settings.open());
        element('context-ring').addEventListener('click', () => this.settings.open('context'));
        element('btn-new-task').addEventListener('click', () => this._newTask());
        this.historyButton.addEventListener('click', () => this._setHistoryVisible(!this.historyUI.isVisible));
        this.modelButton.addEventListener('click', () => this.settings.openModelSwitcher(this.modelButton));

        this.historyUI = new HistoryUI(element('history-panel'), {
            onOpen: id => this._openSession(id),
            onDelete: session => this._deleteSession(session),
            onClear: () => this._clearHistory()
        });
        this.history.onError = () => window.notify?.alert(t('history.saveFailed'), { type: 'warning' });

        this.fileTreeUI.onOpenFolder = () => this._openFolder();
        this.fileTreeUI.onResumeFolder = () => this.fileHandlers.handleResumeFolder();
        this.fileTreeUI.onFileClick = (handle, path, isPreview) => {
            this.workspace.follow = false;
            this.editor.openFile(handle, path, isPreview);
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

    /**
     * 查看某个文件的改动。用户开始自己看之后，编辑器不再跟随 Agent
     * @private
     * @param {string} path - 文件路径
     */
    _openChange(path) {
        this.workspace.follow = false;
        this.editor.showChange(path);
        if (this._isNarrow()) this.chatPanel.classList.add('collapsed');
    }

    /** 窄屏时 Agent 面板和编辑器只显示一个 */
    _isNarrow() {
        return window.matchMedia('(max-width: 760px)').matches;
    }

    /**
     * 更新不随 data-i18n 变化的文案
     * @private
     */
    _renderStatic() {
        this._updateModelButton();
        this._updateSendButton();
        if (!this.file.hasRoot()) {
            if (this.file.pendingHandle) this.fileTreeUI.renderResume(this.file.pendingHandle.name);
            else this.fileTreeUI.renderEmpty();
        }
    }

    /**
     * 连接 Agent 与界面
     * @private
     */
    _initAgent() {
        const { chatUI } = this;
        this.agent = new Agent(this.workspace, () => this.settings.getConnection(), {
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
                this._updateContextUsage();
                this._saveSession();
            },
            onCompact: () => {
                chatUI.addNote('chat.compacted');
                this._updateContextUsage();
            }
        });
    }

    /**
     * 绑定编辑器事件
     * @private
     */
    _bindEditor() {
        const { editor } = this;

        editor.store = this.store;
        editor.fileManager = this.file;
        const config = this.store.getConfig();
        if (config.fontSize !== undefined) editor.setFontSize(config.fontSize);
        editor.onFontSizeChange = fontSize => this.store.updateConfig({ fontSize });

        editor.onChangesUpdated = () => {
            const changes = editor.getChanges();
            this.changesUI.render(changes);
            this.changesUI.setLocked(this.agent.running);
            this.fileTreeUI.setChangedPaths(changes.map(change => change.path));
        };
        editor.onEmptyChange = (isEmpty) => {
            this.welcome.classList.toggle('hidden', !isEmpty);
        };
        editor.onUserNavigate = () => {
            this.workspace.follow = false;
        };

        onThemeChange(() => editor.applyTheme());
    }

    /**
     * 绑定输入框和发送按钮
     * @private
     */
    _bindChat() {
        const { input, sendButton } = this;

        sendButton.closest('form').addEventListener('submit', (event) => {
            event.preventDefault();
            if (this.agent.running) this.agent.stop();
            else this._submit();
        });

        input.addEventListener('input', () => {
            this.promptRecall.reset();
            this._updateSendButton();
        });
        input.addEventListener('keydown', (event) => {
            // 输入法组字时的按键不处理
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                this._recallPrompt(event);
                return;
            }
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            if ((event.metaKey || event.ctrlKey) && !input.value.trim()) this._apply(false);
            else this._submit();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.agent.running && !this.settings.dialog.open) this.agent.stop();
        });
        this._updateSendButton();
    }

    /**
     * 用上下键翻看发过的提示词
     * @private
     * @param {KeyboardEvent} event - 按键事件
     */
    _recallPrompt(event) {
        if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
        const { input, promptRecall } = this;
        const value = event.key === 'ArrowUp' ? promptRecall.previous(input) : promptRecall.next(input);
        if (value === null) return;

        event.preventDefault();
        input.value = value;
        input.setSelectionRange(value.length, value.length);
        this._updateSendButton();
    }

    /**
     * 发送输入框里的内容。缺少文件夹或模型时先补齐，内容保留在输入框里
     * @private
     */
    async _submit() {
        const text = this.input.value.trim();
        if (!text || this.agent.running) return;

        if (!this.file.hasRoot()) {
            const opened = this.file.pendingHandle
                ? await this.fileHandlers.handleResumeFolder()
                : await this.fileHandlers.handleOpenFolder();
            if (!opened) return;
        }
        if (!this.settings.isReady()) {
            this.waitingToSend = true;
            this.settings.open();
            this.settings.keyInput.focus();
            return;
        }

        this.input.value = '';
        this.history.rememberPrompt(text);
        this.promptRecall.load(this.history.prompts());
        this._setHistoryVisible(false);
        this.history.begin(text);
        this.chatUI.addUserMessage(text);
        this._run(() => this.agent.send(text));
    }

    /**
     * 运行 Agent 并更新界面
     * @private
     * @param {Function} start - 启动函数
     */
    async _run(start) {
        const startedAt = performance.now();
        this.replyRow = null;
        this.workspace.follow = true;
        this.changesUI.setLocked(true);
        this.chatUI.setStatus('chat.thinking');

        const running = start();
        this._updateSendButton();
        this._saveSession();
        try {
            const outcome = await running;
            if (outcome === 'stopped') {
                this.chatUI.addNote('chat.stopped');
            } else {
                const seconds = Math.max(1, Math.round((performance.now() - startedAt) / 1000));
                this.chatUI.addNote('chat.finished', seconds);
            }
        } catch (error) {
            const describe = describeError(error);
            const canRetry = !error.code;
            this.chatUI.addError(describe, canRetry ? () => this._run(() => this.agent.resume()) : null);
        } finally {
            this.chatUI.setStatus(null);
            this._updateContextUsage();
            this.changesUI.setLocked(false);
            this._updateSendButton();
            this.input.focus();
            // 运行结束后从第一个改动开始审阅
            const [firstChange] = this.editor.getChanges();
            if (firstChange && this.workspace.follow) {
                this.editor.showChange(firstChange.path, { focus: false });
            }
            this._saveSession();
            await this.history.flush();
            await this._refreshHistory();
        }
    }

    /**
     * 写入改动
     * @private
     * @param {boolean} force - 忽略冲突
     */
    async _apply(force) {
        const changes = this.editor.getChanges();
        if (changes.length === 0 || this.agent.running) return;

        this.changesUI.showConflict(null);
        this.changesUI.setBusy(true);
        try {
            const { conflicts, applied } = await this.editor.applyChanges({ force });
            if (conflicts) {
                this.changesUI.showConflict(conflicts);
                return;
            }
            this.agent.addNote('[The user applied the pending changes to disk.]');
            const row = this.chatUI.addApplied(applied.length, () => this._undo(applied, row));
            this._saveSession();
            if (changes.some(change => change.isNew)) await this.fileHandlers.refreshTree();
        } catch (error) {
            this.chatUI.addError(describeError(error), null);
        } finally {
            this.changesUI.setBusy(false);
        }
    }

    /**
     * 撤销一次写入
     * @private
     */
    async _undo(applied, row) {
        try {
            await this.editor.undoApply(applied);
            this.agent.addNote('[The user undid the last apply. Those changes are pending again.]');
            this.chatUI.markUndone(row);
            this._saveSession();
            await this.fileHandlers.refreshTree();
        } catch (error) {
            this.chatUI.addError(describeError(error), null);
        }
    }

    /**
     * 放弃改动
     * @private
     * @param {string[]} paths - 文件路径
     */
    async _discard(paths) {
        for (const path of paths) {
            await this.editor.discardChange(path);
        }
        this.agent.addNote(`[The user discarded the changes to: ${paths.join(', ')}.]`);
    }

    /**
     * 开始新任务。未写入的改动保留在编辑器里，当前对话留在历史记录里
     * @private
     */
    async _newTask() {
        if (this.agent.running) return;
        await this.history.close();
        this._resetConversation();
        await this._refreshHistory();
        this._setHistoryVisible(this.sessions.length > 0);
        this.input.focus();
    }

    _resetConversation() {
        this.agent.reset();
        this.chatUI.clear();
        this.settings.resetSessionModel();
        this._updateContextUsage();
    }

    _updateContextUsage() {
        this.chatUI.setContextUsage(this.agent.contextUsage);
    }

    /**
     * 打开文件夹。运行中不切换，避免 Agent 的改动落到另一个项目
     * @private
     */
    _openFolder() {
        if (!this.agent.running) return this.fileHandlers.handleOpenFolder();
    }

    /**
     * 打开文件夹后切换到这个项目的历史记录
     * @private
     */
    async _openProject() {
        await this.history.openProject(this.file.getRootHandle());
        this.promptRecall.load(this.history.prompts());
        this._resetConversation();
        await this._refreshHistory();
        this._setHistoryVisible(this.sessions.length > 0);
    }

    /**
     * 安排保存当前对话
     * @private
     */
    _saveSession() {
        this.history.schedule(() => ({
            messages: this.agent.messages,
            timeline: this.chatUI.serialize()
        }));
    }

    async _refreshHistory() {
        this.sessions = await this.history.list();
        this.historyUI.render(this.sessions, this.history.currentId);
    }

    /**
     * 显示或隐藏历史记录，隐藏时回到对话
     * @private
     * @param {boolean} visible - 是否显示
     */
    _setHistoryVisible(visible) {
        this.historyUI.setVisible(visible);
        this.chatMessages.classList.toggle('hidden', visible);
        this.historyButton.setAttribute('aria-pressed', String(visible));
        if (visible) this.chatPanel.classList.remove('collapsed');
    }

    /**
     * 打开历史记录里的对话
     * @private
     * @param {string} id - 会话 ID
     */
    async _openSession(id) {
        if (this.agent.running) return;
        if (id === this.history.currentId) {
            this._setHistoryVisible(false);
            return;
        }

        const session = await this.history.open(id);
        if (!session) {
            window.notify?.alert(t('history.missing'), { type: 'warning' });
            await this._refreshHistory();
            return;
        }
        this.agent.restore(session.messages);
        this.chatUI.restore(session.timeline);
        this.settings.resetSessionModel();
        this._updateContextUsage();
        this.historyUI.render(this.sessions, id);
        this._setHistoryVisible(false);
        this.input.focus();
    }

    /**
     * 删除一条历史记录
     * @private
     * @param {{id: string, title: string}} session - 会话
     */
    async _deleteSession(session) {
        const confirmed = await window.notify.confirm(t('history.deleteConfirm', session.title), t('confirm.delete'));
        if (!confirmed) return;
        await this._removeSessions([session.id]);
    }

    /** 清空当前项目的历史记录 */
    async _clearHistory() {
        const confirmed = await window.notify.confirm(t('history.clearConfirm'), t('confirm.delete'));
        if (!confirmed) return;
        await this._removeSessions(this.sessions.map(session => session.id));
    }

    async _removeSessions(ids) {
        const removesCurrent = ids.includes(this.history.currentId);
        if (removesCurrent && this.agent.running) return;
        await this.history.remove(ids);
        if (removesCurrent) this._resetConversation();
        await this._refreshHistory();
    }

    _updateSendButton() {
        const running = this.agent?.running;
        const icon = this.sendButton.querySelector('i');
        icon.className = `codicon codicon-${running ? 'debug-stop' : 'arrow-up'}`;
        this.sendButton.dataset.running = String(Boolean(running));
        this.sendButton.title = t(running ? 'chat.stop' : 'chat.send');
        this.sendButton.setAttribute('aria-label', this.sendButton.title);
        this.sendButton.disabled = !running && !this.input.value.trim();
    }

    _updateModelButton() {
        this.modelButton.querySelector('span').textContent = this.settings.getModelLabel();
        this.modelButton.classList.toggle('is-unset', !this.settings.isReady());
        this.modelButton.title = t(this.settings.isReady() ? 'model.switch' : 'model.connect');
    }

    /**
     * 支持把文件夹拖进页面
     * @private
     */
    _bindDragAndDrop() {
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
            if (handle.kind === 'directory' && !this.agent.running) await this.fileHandlers.handleDroppedFolder(handle);
            else if (handle.kind === 'directory') return;
            else window.notify?.alert(t('error.dropFile'), { type: 'warning' });
        });
    }

    /**
     * 关闭页面前提醒未写入的改动
     * @private
     */
    _bindWindow() {
        window.addEventListener('beforeunload', (event) => {
            if (this.editor.getChanges().length > 0 || this.agent.running) event.preventDefault();
        });
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
            if (this._isNarrow()) this.chatPanel.classList.add('collapsed');
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
