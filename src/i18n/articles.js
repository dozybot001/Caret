/**
 * @fileoverview 说明和法律文本
 * @description 上下文说明、隐私政策和用户协议，每页是标题和正文组成的段落
 */

export const ARTICLES = {
    zh: {
        context: [
            ['什么是上下文', '模型每次回复前，都要重新读一遍这段对话：你的消息、Agent 的回复、读过的文件内容和改动记录。这些内容合起来就是上下文。对话越长，每次发送的内容越多。'],
            ['小圈的数字', '输入栏右下角的小圈显示已用比例，100% 就是设置里的压缩线，默认约 10 万 token。这个数字按字符数估算，和模型服务的实际用量会有出入。'],
            ['自动压缩', '到 100% 时，Caret 自动清理较早的工具结果，只保留最近的部分。这些结果主要是 Agent 读到的文件内容，文件还在项目里，需要时 Agent 会重新读取。压缩不调用模型写摘要。'],
            ['保留什么', '你的消息、Agent 的回复和改动记录都会保留，对话界面上的内容也不变。未写入的改动留在编辑器里，不受影响。每次压缩时，对话里会出现一行说明。'],
            ['重新开始', '点 Agent 面板右上角的 + 开始新任务，上下文从 0 算起。之前的对话留在历史记录里。'],
            ['上限更小的模型', '如果模型的上限低于压缩线，超限时 Caret 会先清理再重试一次。仍然超限时，需要开始新任务。也可以在设置里调低压缩线。']
        ],
        privacy: [
            ['谁提供 Caret', 'Caret 由长沙榫卯人工智能科技有限公司（品牌“榫卯 Tenon AI”，下称“我们”）提供。我们是本政策所述个人信息的处理者。'],
            ['我们不收集什么', 'Caret 没有账号，也没有应用服务器。我们收不到你的文件、需求、API Key 或模型回复。Caret 不使用统计或追踪工具。'],
            ['发送给模型服务的内容', '你写的需求和全局指令，以及 Agent 为完成任务读取的文件内容和文件路径，会从浏览器直接发给你配置的模型服务。该服务按自己的隐私政策处理这些数据，是否出境取决于你选择的服务。.env、私钥等常见密钥文件不会被读取。'],
            ['保存在这台设备上的内容', '设置、API Key、对话记录、文件夹访问授权和打开的标签页保存在浏览器的 IndexedDB，主题和语言保存在 localStorage。对话记录包含 Agent 读取过的文件内容，每个项目最多保留 100 条，不会上传。你可以在设置里关闭保存对话记录。你可以在历史记录里删除对话，也可以在设置的数据页清除全部本地数据。'],
            ['网页托管', '通过线上地址访问时，为保障网络安全，服务器会记录访问日志，包括访问时间、IP 地址和访问的页面，不含网址中的参数；这些日志保存 6 个月后自动删除。'],
            ['联系我们', '如有问题或隐私请求，请发送邮件到 support@tenonai.cn。']
        ],
        terms: [
            ['谁提供 Caret', 'Caret 由长沙榫卯人工智能科技有限公司（品牌“榫卯 Tenon AI”，下称“我们”）提供。本协议是你和我们之间关于使用 Caret 的约定。'],
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
            ['The number in the ring', 'The ring at the bottom right of the input bar shows how much is used. 100% is the compaction size in Settings, about 100,000 tokens by default. The number is estimated from the character count, so it can differ from what the model service reports.'],
            ['Automatic compaction', 'At 100%, Caret clears older tool results and keeps only the most recent ones. These are mostly file contents the Agent read. The files are still in your project, so the Agent reads them again when needed. Compaction does not call the model to write a summary.'],
            ['What stays', 'Your messages, the Agent\'s replies and the record of changes stay, and the conversation on screen does not change. Unapplied changes stay in the editor. A short note appears in the conversation each time compaction runs.'],
            ['Starting over', 'Click + at the top right of the Agent panel to start a new task. Context starts from 0, and the previous conversation stays in the history.'],
            ['Models with a smaller limit', 'If a model allows less than the compaction size, Caret clears older results and retries once when the limit is exceeded. If that still fails, start a new task. You can also lower the compaction size in Settings.']
        ],
        privacy: [
            ['Who provides Caret', 'Caret is provided by Changsha Tenon Artificial Intelligence Technology Co., Ltd. (长沙榫卯人工智能科技有限公司), the company behind Tenon AI ("we"). We handle the personal information described in this policy.'],
            ['What we do not collect', 'Caret has no accounts and no application server. We never receive your files, requests, API keys or model replies. Caret uses no analytics or tracking.'],
            ['What goes to the model service', 'Your requests and global instructions, plus the file contents and paths the Agent reads for the task, go directly from your browser to the model service you configured. That service handles the data under its own privacy policy, and whether data leaves your country depends on the service you choose. Common secret files such as .env and private keys are not read.'],
            ['What stays on this device', 'Settings, API keys, conversation history, folder access and open tabs are stored in the browser\'s IndexedDB. Theme and language are stored in localStorage. Conversation history includes the file contents the Agent read, keeps up to 100 conversations per project, and is never uploaded. You can turn off saving conversations in Settings. You can delete conversations in History, or delete all local data on the Data page in Settings.'],
            ['Web hosting', 'When you use the hosted page, the server records access logs to keep the network secure. They include the access time, IP address and the page visited, without the parameters in the URL, and are deleted automatically after 6 months.'],
            ['Contact', 'Questions or privacy requests? Email support@tenonai.cn.']
        ],
        terms: [
            ['Who provides Caret', 'Caret is provided by Changsha Tenon Artificial Intelligence Technology Co., Ltd. (长沙榫卯人工智能科技有限公司), the company behind Tenon AI ("we"). These terms are an agreement between you and us about using Caret.'],
            ['The service', 'Caret is free, and its source code is open under the MIT License. The service is provided as is. We do not guarantee that changes are correct or that the service stays available.'],
            ['Your responsibility', 'Read the diff before you apply it. Caret does not run or verify code, and you are responsible for what you apply. We suggest working in a Git repository so you can roll back.'],
            ['Model services', 'You bring your own model service account and API key. Costs and terms are between you and that provider.'],
            ['Acceptable use', 'Do not use Caret for illegal purposes, or on code and data you have no right to process.'],
            ['Contact', 'Questions? Email support@tenonai.cn.']
        ]
    }
};
