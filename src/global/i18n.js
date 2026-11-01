/**
 * @fileoverview 界面文案
 * @description 简体中文和英文文案。静态文案用 data-i18n 属性标记，动态文案调用 t()
 */

import { getLang, setLang } from './preferences.js';

const MESSAGES = {
    zh: {
        'brand.label': 'Caret，Tenon 出品',
        'sidebar.files': '文件',
        'sidebar.open': '打开文件夹',
        'sidebar.agent': 'Agent',
        'settings.title': '设置',

        'welcome.tagline': '只有三个工具的 Coding Agent',
        'welcome.read': '读取文件、列出目录、搜索内容',
        'welcome.write': '新建文件，或重写整个文件',
        'welcome.edit': '精确替换文件里的一段文字',
        'welcome.note': '不执行命令，不运行测试。改动先进编辑器，你看完 diff 再写入磁盘。',
        'welcome.open': '打开文件夹',

        'tree.empty': '还没有打开文件夹',
        'tree.open': '打开文件夹',
        'tree.resume': name => `继续访问 ${name}`,
        'tree.drop': '松开以打开这个文件夹',

        'chat.newTask': '新任务',
        'history.title': '历史记录',
        'history.empty': '这个项目还没有对话。发送第一条消息后，对话会保存在这个浏览器里。',
        'history.clear': '清空',
        'history.delete': '删除这条记录',
        'history.deleteConfirm': title => `删除“${title}”？删除后无法恢复。`,
        'history.clearConfirm': '清空这个项目的全部对话？删除后无法恢复。',
        'history.missing': '这条记录已经不存在。',
        'history.saveFailed': '对话没能保存到这个浏览器，当前任务不受影响。可以删除一些历史记录后再试。',
        'confirm.delete': '删除',
        'chat.placeholder': '想改什么？例如：把登录按钮的文字改成“继续”',
        'chat.placeholderNext': '继续说明要改什么',
        'chat.send': '发送',
        'chat.stop': '停止',
        'chat.copy': '复制',
        'chat.copied': '已复制',
        'chat.retry': '重试',
        'chat.thinking': '思考中',
        'chat.generating': '正在生成改动',
        'chat.finished': seconds => `完成，用时 ${seconds} 秒`,
        'chat.stopped': '已停止，已经做出的改动还在',

        'step.read': '读取',
        'step.list': '列出',
        'step.search': '搜索',
        'step.edit': '修改',
        'step.write': '写入',
        'step.create': '新建',
        'step.rewrite': '重写',
        'step.retrying': '未成功，Agent 会调整后重试',

        'changes.files': count => `${count} 个文件`,
        'changes.apply': '写入文件',
        'changes.discardAll': '放弃全部',
        'changes.discard': '放弃这个文件',
        'changes.new': '新文件',
        'changes.conflict': names => `${names} 在 Caret 读取后被其他程序改过。`,
        'changes.overwrite': '仍然写入',
        'changes.cancel': '取消',
        'changes.applied': count => `已写入 ${count} 个文件`,
        'changes.undo': '撤销',
        'changes.undone': '已撤销写入，改动回到待写入状态',
        'changes.leave': '还有改动没有写入，确定离开吗？',
        'changes.switchFolder': '当前改动还没有写入，切换文件夹会放弃这些改动。继续吗？',
        'confirm.discard': '放弃改动',

        'model.connect': '连接模型',

        'settings.model': '模型',
        'settings.modelTip': 'Caret 从浏览器直接连接模型服务，不经过 Tenon 的服务器。这里只列出实测允许网页直连的服务。',
        'settings.provider': '服务商',
        'settings.custom': '自定义',
        'settings.baseUrl': 'Base URL',
        'settings.apiKey': 'API Key',
        'settings.apiKeyTip': 'Key 只保存在这台设备的浏览器里，只发给上面选择的服务。',
        'settings.getKey': '获取 Key',
        'settings.clearKey': '清除 Key',
        'settings.modelName': '模型名称',
        'settings.checking': '正在检查连接',
        'settings.connected': count => `已连接，可用模型 ${count} 个`,
        'settings.noList': '暂时拿不到模型列表，可以直接填写模型名称',
        'settings.appearance': '外观',
        'settings.theme': '主题',
        'settings.themeSystem': '跟随系统',
        'settings.themeLight': '浅色',
        'settings.themeDark': '深色',
        'settings.language': '语言',
        'settings.about': '关于 Caret',
        'settings.done': '完成',
        'settings.info': '说明',
        'settings.back': '返回',
        'settings.close': '关闭',

        'about.version': '版本',
        'about.body1': 'Caret 是运行在浏览器里的 Coding Agent。你打开一个本地文件夹，说明要改什么，模型用读、写、改三个工具完成改动。改动先出现在编辑器里，你看完 diff，也可以再手动调整，确认后写入磁盘。',
        'about.body2': '它适合看 diff 就能判断对错的改动，例如文案、配置、样式、文档和小 bug。Caret 不执行命令，不运行测试，也不需要安装。',
        'about.publisher': '出品方',
        'about.website': 'Tenon 官网',
        'about.feedback': '反馈',
        'about.source': '源代码',
        'about.license': '许可证',
        'about.privacy': '隐私政策',
        'about.terms': '用户协议',
        'legal.meta': '版本 1.0 · 生效日期：2026年11月1日',

        'error.auth': '模型服务拒绝了这个 Key。请在设置里检查 Key 是否正确。',
        'error.rate': '请求太频繁或额度不足。请稍后重试，或检查账户余额。',
        'error.long': '这次对话内容太长。请开始新任务，把需求拆小。',
        'error.steps': '这次改动超过了步数上限。请把需求拆小后重试。',
        'error.network': '连不上模型服务。请检查网络和 Base URL，这个服务也可能不允许网页直连。',
        'error.http': (status, message) => `模型服务返回错误（${status}）：${message}`,
        'error.permission': '没有这个文件夹的写入权限。请重新打开文件夹后再试。',
        'error.generic': message => `操作失败：${message}`,
        'error.unsupported': '当前浏览器不能访问本地文件夹。请用桌面版 Chrome 或 Edge 打开。',
        'error.editorLoad': '编辑器加载失败。请检查网络后刷新页面。',
        'error.openFile': (name, message) => `无法打开 ${name}：${message}`,
        'error.save': message => `保存失败：${message}`,
        'error.dropFile': '请拖入文件夹，而不是单个文件。',
        'notice.readOnly': name => `${name} 不是 UTF-8 文本，只能查看，不能修改。`,
        'editor.closeConfirm': name => `${name} 有未写入的改动，确定关闭吗？`,
        'folder.loaded': name => `已打开 ${name}`
    },
    en: {
        'brand.label': 'Caret, by Tenon',
        'sidebar.files': 'Files',
        'sidebar.open': 'Open folder',
        'sidebar.agent': 'Agent',
        'settings.title': 'Settings',

        'welcome.tagline': 'A coding agent with three tools',
        'welcome.read': 'Read files, list directories, search content',
        'welcome.write': 'Create a file, or rewrite a whole file',
        'welcome.edit': 'Replace an exact piece of text in a file',
        'welcome.note': 'It runs no commands and no tests. Changes stay in the editor until you review the diff and apply them.',
        'welcome.open': 'Open folder',

        'tree.empty': 'No folder is open',
        'tree.open': 'Open folder',
        'tree.resume': name => `Continue with ${name}`,
        'tree.drop': 'Drop to open this folder',

        'chat.newTask': 'New task',
        'history.title': 'History',
        'history.empty': 'No conversations for this project yet. They are saved in this browser after your first message.',
        'history.clear': 'Clear',
        'history.delete': 'Delete this conversation',
        'history.deleteConfirm': title => `Delete "${title}"? This cannot be undone.`,
        'history.clearConfirm': 'Delete all conversations for this project? This cannot be undone.',
        'history.missing': 'This conversation no longer exists.',
        'history.saveFailed': 'The conversation could not be saved in this browser. The current task is not affected. Delete some history and try again.',
        'confirm.delete': 'Delete',
        'chat.placeholder': 'What should change? For example: change the sign-in button text to "Continue"',
        'chat.placeholderNext': 'Describe the next change',
        'chat.send': 'Send',
        'chat.stop': 'Stop',
        'chat.copy': 'Copy',
        'chat.copied': 'Copied',
        'chat.retry': 'Retry',
        'chat.thinking': 'Thinking',
        'chat.generating': 'Writing changes',
        'chat.finished': seconds => `Done in ${seconds}s`,
        'chat.stopped': 'Stopped. The changes made so far are still here.',

        'step.read': 'Read',
        'step.list': 'List',
        'step.search': 'Search',
        'step.edit': 'Edit',
        'step.write': 'Write',
        'step.create': 'Create',
        'step.rewrite': 'Rewrite',
        'step.retrying': 'Did not work. The Agent will adjust and try again.',

        'changes.files': count => `${count} ${count === 1 ? 'file' : 'files'}`,
        'changes.apply': 'Apply',
        'changes.discardAll': 'Discard all',
        'changes.discard': 'Discard this file',
        'changes.new': 'New',
        'changes.conflict': names => `${names} changed on disk after Caret read it.`,
        'changes.overwrite': 'Apply anyway',
        'changes.cancel': 'Cancel',
        'changes.applied': count => `Applied ${count} ${count === 1 ? 'file' : 'files'}`,
        'changes.undo': 'Undo',
        'changes.undone': 'Undone. The changes are waiting to be applied again.',
        'changes.leave': 'Some changes are not applied. Leave anyway?',
        'changes.switchFolder': 'Switching folders discards the changes that are not applied. Continue?',
        'confirm.discard': 'Discard changes',

        'model.connect': 'Connect a model',

        'settings.model': 'Model',
        'settings.modelTip': 'Caret connects to the model service directly from your browser, without passing through Tenon servers. This list only has services tested to allow web access.',
        'settings.provider': 'Provider',
        'settings.custom': 'Custom',
        'settings.baseUrl': 'Base URL',
        'settings.apiKey': 'API Key',
        'settings.apiKeyTip': 'The key is stored only in this browser and is sent only to the provider selected above.',
        'settings.getKey': 'Get a key',
        'settings.clearKey': 'Clear key',
        'settings.modelName': 'Model name',
        'settings.checking': 'Checking the connection',
        'settings.connected': count => `Connected. ${count} models available.`,
        'settings.noList': 'The model list is unavailable. You can type a model name.',
        'settings.appearance': 'Appearance',
        'settings.theme': 'Theme',
        'settings.themeSystem': 'System',
        'settings.themeLight': 'Light',
        'settings.themeDark': 'Dark',
        'settings.language': 'Language',
        'settings.about': 'About Caret',
        'settings.done': 'Done',
        'settings.info': 'More information',
        'settings.back': 'Back',
        'settings.close': 'Close',

        'about.version': 'Version',
        'about.body1': 'Caret is a coding agent that runs in your browser. Open a local folder and describe the change. The model works with three tools: read, write and edit. Changes appear in the editor first. Review the diff, adjust by hand if you like, then apply them to disk.',
        'about.body2': 'It suits changes you can judge by reading the diff, such as copy, configuration, styles, documentation and small bugs. Caret runs no commands and no tests, and there is nothing to install.',
        'about.publisher': 'Publisher',
        'about.website': 'Tenon website',
        'about.feedback': 'Feedback',
        'about.source': 'Source code',
        'about.license': 'License',
        'about.privacy': 'Privacy Policy',
        'about.terms': 'Terms of Service',
        'legal.meta': 'Version 1.0 · Effective Nov 1, 2026',

        'error.auth': 'The model service rejected this key. Check the key in Settings.',
        'error.rate': 'Too many requests, or the quota is used up. Try again later, or check your balance.',
        'error.long': 'This conversation is too long. Start a new task with a smaller request.',
        'error.steps': 'This change went over the step limit. Split the request and try again.',
        'error.network': 'Cannot reach the model service. Check your network and Base URL. The service may also block web access.',
        'error.http': (status, message) => `The model service returned an error (${status}): ${message}`,
        'error.permission': 'Caret has no write access to this folder. Open the folder again and retry.',
        'error.generic': message => `Something went wrong: ${message}`,
        'error.unsupported': 'This browser cannot access local folders. Open Caret in desktop Chrome or Edge.',
        'error.editorLoad': 'The editor failed to load. Check your network and refresh the page.',
        'error.openFile': (name, message) => `Cannot open ${name}: ${message}`,
        'error.save': message => `Save failed: ${message}`,
        'error.dropFile': 'Drop a folder, not a single file.',
        'notice.readOnly': name => `${name} is not UTF-8 text, so it is read-only.`,
        'editor.closeConfirm': name => `${name} has changes that are not applied. Close anyway?`,
        'folder.loaded': name => `Opened ${name}`
    }
};

const LEGAL = {
    zh: {
        privacy: [
            ['我们不收集什么', 'Caret 没有账号，也没有应用服务器。榫卯 Tenon AI 收不到你的文件、需求、API Key 或模型回复。Caret 不使用统计或追踪工具。'],
            ['发送给模型服务的内容', '你写的需求，以及 Agent 为完成任务读取的文件内容和文件路径，会从浏览器直接发给你配置的模型服务。该服务按自己的隐私政策处理这些数据，是否出境取决于你选择的服务。.env、私钥等常见密钥文件不会被读取。'],
            ['保存在这台设备上的内容', '模型设置、API Key、对话记录、文件夹访问授权和打开的标签页保存在浏览器的 IndexedDB，主题和语言保存在 localStorage。对话记录包含 Agent 读取过的文件内容，每个项目最多保留 100 条，不会上传。你可以在历史记录里删除对话，在设置里清除 Key，或清除这个网站的数据来删除全部内容。'],
            ['网页托管', '通过线上地址访问时，托管服务器会留下常规访问日志，例如 IP 地址和访问时间，用于安全和故障排查。'],
            ['联系我们', '如有问题，请发送邮件到 support@tenonai.cn。']
        ],
        terms: [
            ['服务内容', 'Caret 免费提供，源代码按 MIT 许可证开源。服务按现状提供，不保证改动结果正确，也不保证持续可用。'],
            ['你的责任', '写入前请阅读 diff。Caret 不运行代码，也不验证改动，写入后的结果由你负责。建议在 Git 仓库里使用，以便回退。'],
            ['模型服务', '你需要自备模型服务账号和 API Key，相关费用和条款由你与服务商约定。'],
            ['合规使用', '不得将 Caret 用于违法用途，也不得处理你无权处理的代码和数据。'],
            ['联系我们', '如有问题，请发送邮件到 support@tenonai.cn。']
        ]
    },
    en: {
        privacy: [
            ['What we do not collect', 'Caret has no accounts and no application server. Tenon AI never receives your files, requests, API keys or model replies. Caret uses no analytics or tracking.'],
            ['What goes to the model service', 'Your requests, plus the file contents and paths the Agent reads for the task, go directly from your browser to the model service you configured. That service handles the data under its own privacy policy, and whether data leaves your country depends on the service you choose. Common secret files such as .env and private keys are not read.'],
            ['What stays on this device', 'Model settings, API keys, conversation history, folder access and open tabs are stored in the browser\'s IndexedDB. Theme and language are stored in localStorage. Conversation history includes the file contents the Agent read, keeps up to 100 conversations per project, and is never uploaded. You can delete conversations in History, clear the key in Settings, or clear this site\'s data to remove everything.'],
            ['Web hosting', 'When you use the hosted page, the server keeps ordinary access logs, such as IP addresses and timestamps, for security and troubleshooting.'],
            ['Contact', 'Questions? Email support@tenonai.cn.']
        ],
        terms: [
            ['The service', 'Caret is free, and its source code is open under the MIT License. The service is provided as is. We do not guarantee that changes are correct or that the service stays available.'],
            ['Your responsibility', 'Read the diff before you apply it. Caret does not run or verify code, and you are responsible for what you apply. We suggest working in a Git repository so you can roll back.'],
            ['Model services', 'You bring your own model service account and API key. Costs and terms are between you and that provider.'],
            ['Acceptable use', 'Do not use Caret for illegal purposes, or on code and data you have no right to process.'],
            ['Contact', 'Questions? Email support@tenonai.cn.']
        ]
    }
};

const languageListeners = new Set();

/** @returns {'zh'|'en'} 当前语言 */
export const getLanguage = getLang;

/**
 * 取文案
 * @param {string} key - 文案键
 * @param {...*} args - 动态文案的参数
 * @returns {string}
 */
export function t(key, ...args) {
    const value = MESSAGES[getLang()][key] ?? key;
    return typeof value === 'function' ? value(...args) : value;
}

/**
 * 取法律文本
 * @param {'privacy'|'terms'} page - 页面
 * @returns {Array<[string, string]>} 标题和正文
 */
export const legalText = page => LEGAL[getLang()][page];

/**
 * 更新页面上的静态文案
 * @param {ParentNode} root - 根节点
 */
export function applyTranslations(root = document) {
    document.documentElement.lang = getLang() === 'zh' ? 'zh-CN' : 'en';
    root.querySelectorAll('[data-i18n]').forEach(element => {
        element.textContent = t(element.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-title]').forEach(element => {
        element.title = t(element.dataset.i18nTitle);
        element.setAttribute('aria-label', element.title);
    });
    root.querySelectorAll('[data-i18n-label]').forEach(element => {
        element.setAttribute('aria-label', t(element.dataset.i18nLabel));
    });
}

/** @param {Function} listener - 语言变化时调用 */
export function onLanguageChange(listener) {
    languageListeners.add(listener);
}

/**
 * 切换语言，输入内容和运行中的操作不受影响
 * @param {'zh'|'en'} lang - 语言
 */
export function changeLanguage(lang) {
    setLang(lang);
    applyTranslations();
    languageListeners.forEach(listener => listener());
}
