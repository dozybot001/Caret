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
        'welcome.intro': '改文案、配置、样式和小 bug，通常不需要一整套开发环境。Caret 运行在网页里，带编辑器、文件树、diff 审阅、对话历史和 Git 状态。打开文件夹，说明要改什么，Agent 改完由你确认后写入。',
        'welcome.read': '读取文件、列出目录、搜索内容',
        'welcome.write': '新建文件，或重写整个文件',
        'welcome.edit': '精确替换文件里的一段文字',
        'welcome.note': 'Caret 不执行命令，也不运行测试，适合看 diff 就能判断对错的改动。',
        'welcome.pointOpen': '打开就能用',
        'welcome.pointOpenBody': '不用安装，不用账号。Key 和代码只发给你选的模型服务，不经过 Tenon 的服务器。',
        'welcome.pointReview': '改动由你确认',
        'welcome.pointReviewBody': '改动先进编辑器，看完 diff 再写入磁盘。写入后还能撤销。',
        'welcome.pointPrompt': '提示词不随项目变大',
        'welcome.pointPromptBody': '系统提示词和工具定义约 700 token，不带文件列表，Agent 需要什么再读什么。长对话自动压缩，不调用模型写摘要。',
        'welcome.pointMemory': '没有隐藏的记忆',
        'welcome.pointMemoryBody': '项目规则写在 AGENTS.md，对话记录只存在这个浏览器里，都能查看和删除。',
        'welcome.open': '打开文件夹',

        'git.branch': name => `当前分支：${name}`,
        'git.M': '已修改',
        'git.U': '未跟踪',
        'git.D': '已删除',
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
        'chat.context': percent => `上下文已用 ${percent}%，点击查看说明`,
        'chat.compacted': '已压缩上下文：清理了较早的读取内容，Agent 需要时会重新读取。',
        'chat.copyFailed': '复制失败，请手动选中文字复制。',
        'layout.resizeTree': '调整文件树宽度',
        'layout.resizeChat': '调整 Agent 面板宽度',
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
        'model.switch': '切换模型',
        'model.switchEffort': '切换推理强度',
        'model.settings': '模型设置',
        'model.default': '默认',

        'settings.model': '模型',
        'settings.modelTip': 'Caret 从浏览器直接连接模型服务，不经过 Tenon 的服务器。这里只列出实测允许网页直连的服务。',
        'settings.provider': '服务商',
        'settings.custom': '自定义',
        'settings.baseUrl': 'Base URL',
        'settings.apiKey': 'API Key',
        'settings.apiKeyTip': 'Key 只保存在这台设备的浏览器里，只发给上面选择的服务。',
        'settings.getKey': '获取 Key',
        'settings.clearKey': '清除 Key',
        'settings.defaultModel': '默认模型',
        'settings.defaultModelTip': '新任务默认使用这个模型。在输入栏切换模型只影响当前对话。',
        'settings.defaultEffort': '默认推理强度',
        'settings.defaultEffortTip': '档位来自模型服务的接口，模型没有返回档位时不显示。新任务默认使用这个强度，在输入栏切换只影响当前对话。',
        'settings.chooseModel': '选择模型',
        'settings.searchModel': '搜索模型',
        'settings.searchOrTypeModel': '搜索或输入模型名称',
        'settings.useModel': name => `使用 ${name}`,
        'settings.typeModel': '输入模型名称',
        'settings.noModels': '没有匹配的模型',
        'settings.checking': '正在检查连接',
        'settings.connected': count => `已连接，可用模型 ${count} 个`,
        'settings.noList': '暂时拿不到模型列表，可以直接填写模型名称',
        'settings.appearance': '外观',
        'settings.theme': '主题',
        'settings.themeSystem': '跟随系统',
        'settings.themeLight': '浅色',
        'settings.themeDark': '深色',
        'settings.language': '语言',
        'settings.editorFontSize': '编辑器字号',
        'settings.chatFontSize': '对话字号',
        'settings.wordWrap': '编辑器自动换行',
        'settings.about': '关于 Caret',
        'context.title': '上下文与压缩',
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
        'folder.loaded': name => `已打开 ${name}`,
        'folder.release': '取消授权',
        'folder.releaseConfirm': name => `取消对 ${name} 的授权？Caret 会关闭这个文件夹，之后不能再读取或修改它。未写入的改动会丢失，对话记录保留。浏览器自己的授权记录可以在网站设置里清除。`,
        'folder.released': name => `已取消对 ${name} 的授权`,
        'folder.releaseBusy': 'Agent 正在运行，请先停止。'
    },
    en: {
        'brand.label': 'Caret, by Tenon',
        'sidebar.files': 'Files',
        'sidebar.open': 'Open folder',
        'sidebar.agent': 'Agent',
        'settings.title': 'Settings',

        'welcome.tagline': 'A coding agent with three tools',
        'welcome.intro': 'Copy, config, styles and small bugs rarely need a full development setup. Caret runs in a web page, with an editor, file tree, diff review, conversation history and Git status. Open a folder, say what should change, and apply the result once you have reviewed it.',
        'welcome.read': 'Read files, list directories, search content',
        'welcome.write': 'Create a file, or rewrite a whole file',
        'welcome.edit': 'Replace an exact piece of text in a file',
        'welcome.note': 'Caret runs no commands and no tests. It suits changes you can judge by reading the diff.',
        'welcome.pointOpen': 'Nothing to install',
        'welcome.pointOpenBody': 'No install and no account. Your key and code go only to the model service you choose, never through Tenon servers.',
        'welcome.pointReview': 'You approve every change',
        'welcome.pointReviewBody': 'Changes stay in the editor until you read the diff and apply them. You can undo an apply.',
        'welcome.pointPrompt': 'The prompt stays small',
        'welcome.pointPromptBody': 'The system prompt and tool definitions take about 700 tokens, with no file list. The Agent reads what it needs. Long conversations are compacted without calling the model.',
        'welcome.pointMemory': 'No hidden memory',
        'welcome.pointMemoryBody': 'Project rules live in AGENTS.md. Conversations stay in this browser, where you can view and delete them.',
        'welcome.open': 'Open folder',

        'git.branch': name => `Current branch: ${name}`,
        'git.M': 'Modified',
        'git.U': 'Untracked',
        'git.D': 'Deleted',
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
        'chat.context': percent => `Context used: ${percent}%. Click for details.`,
        'chat.compacted': 'Context compacted. Older file contents were cleared, and the Agent reads them again when needed.',
        'chat.copyFailed': 'Could not copy. Select the text and copy it by hand.',
        'layout.resizeTree': 'Resize the file tree',
        'layout.resizeChat': 'Resize the Agent panel',
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
        'model.switch': 'Switch model',
        'model.switchEffort': 'Switch reasoning effort',
        'model.settings': 'Model settings',
        'model.default': 'default',

        'settings.model': 'Model',
        'settings.modelTip': 'Caret connects to the model service directly from your browser, without passing through Tenon servers. This list only has services tested to allow web access.',
        'settings.provider': 'Provider',
        'settings.custom': 'Custom',
        'settings.baseUrl': 'Base URL',
        'settings.apiKey': 'API Key',
        'settings.apiKeyTip': 'The key is stored only in this browser and is sent only to the provider selected above.',
        'settings.getKey': 'Get a key',
        'settings.clearKey': 'Clear key',
        'settings.defaultModel': 'Default model',
        'settings.defaultModelTip': 'New tasks use this model. Switching in the input bar only affects the current conversation.',
        'settings.defaultEffort': 'Default reasoning effort',
        'settings.defaultEffortTip': 'Levels come from the model service. This option is hidden when a model reports none. New tasks use this level. Switching in the input bar only affects the current conversation.',
        'settings.chooseModel': 'Choose a model',
        'settings.searchModel': 'Search models',
        'settings.searchOrTypeModel': 'Search or type a model name',
        'settings.useModel': name => `Use ${name}`,
        'settings.typeModel': 'Type a model name',
        'settings.noModels': 'No matching models',
        'settings.checking': 'Checking the connection',
        'settings.connected': count => `Connected. ${count} models available.`,
        'settings.noList': 'The model list is unavailable. You can type a model name.',
        'settings.appearance': 'Appearance',
        'settings.theme': 'Theme',
        'settings.themeSystem': 'System',
        'settings.themeLight': 'Light',
        'settings.themeDark': 'Dark',
        'settings.language': 'Language',
        'settings.editorFontSize': 'Editor font size',
        'settings.chatFontSize': 'Conversation font size',
        'settings.wordWrap': 'Word wrap in the editor',
        'settings.about': 'About Caret',
        'context.title': 'Context and compaction',
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
        'folder.loaded': name => `Opened ${name}`,
        'folder.release': 'Remove access',
        'folder.releaseConfirm': name => `Remove access to ${name}? Caret closes this folder and can no longer read or change it. Unapplied changes are lost. Conversations stay. You can clear the browser's own permission record in site settings.`,
        'folder.released': name => `Removed access to ${name}`,
        'folder.releaseBusy': 'The Agent is running. Stop it first.'
    }
};

const ARTICLES = {
    zh: {
        context: [
            ['什么是上下文', '模型每次回复前，都要重新读一遍这段对话：你的消息、Agent 的回复、读过的文件内容和改动记录。这些内容合起来就是上下文。对话越长，每次发送的内容越多。'],
            ['小圈的数字', '输入栏右下角的小圈显示已用比例，100% 约等于 10 万 token。这个数字按字符数估算，和模型服务的实际用量会有出入。'],
            ['自动压缩', '到 100% 时，Caret 自动清理较早的工具结果，只保留最近的部分。这些结果主要是 Agent 读到的文件内容，文件还在项目里，需要时 Agent 会重新读取。压缩不调用模型写摘要。'],
            ['保留什么', '你的消息、Agent 的回复和改动记录都会保留，对话界面上的内容也不变。未写入的改动留在编辑器里，不受影响。每次压缩时，对话里会出现一行说明。'],
            ['重新开始', '点 Agent 面板右上角的 + 开始新任务，上下文从 0 算起。之前的对话留在历史记录里。'],
            ['上限更小的模型', '如果模型的上限低于 10 万 token，超限时 Caret 会先清理再重试一次。仍然超限时，需要开始新任务。']
        ],
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
        context: [
            ['What context is', 'Before each reply, the model reads this conversation again: your messages, the Agent\'s replies, the file contents it read and the changes it made. Together they are the context. The longer the conversation, the more is sent each time.'],
            ['The number in the ring', 'The ring at the bottom right of the input bar shows how much is used. 100% is about 100,000 tokens. The number is estimated from the character count, so it can differ from what the model service reports.'],
            ['Automatic compaction', 'At 100%, Caret clears older tool results and keeps only the most recent ones. These are mostly file contents the Agent read. The files are still in your project, so the Agent reads them again when needed. Compaction does not call the model to write a summary.'],
            ['What stays', 'Your messages, the Agent\'s replies and the record of changes stay, and the conversation on screen does not change. Unapplied changes stay in the editor. A short note appears in the conversation each time compaction runs.'],
            ['Starting over', 'Click + at the top right of the Agent panel to start a new task. Context starts from 0, and the previous conversation stays in the history.'],
            ['Models with a smaller limit', 'If a model allows fewer than 100,000 tokens, Caret clears older results and retries once when the limit is exceeded. If that still fails, start a new task.']
        ],
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
export const articleText = page => ARTICLES[getLang()][page];

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
