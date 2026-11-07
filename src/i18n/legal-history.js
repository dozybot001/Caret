/**
 * @fileoverview 隐私政策和用户协议的历史版本
 * @description 修改法律文本后，把被替代的版本连同版本号和生效日期加到这里，新的在前。用户打开法律文本时才加载
 */

export const LEGAL_HISTORY = {
    zh: {
        privacy: [
            {
                version: '1.2',
                date: '2026 年 11 月 3 日',
                sections: [
                    ['我们不收集什么', 'Caret 没有账号，也没有应用服务器。榫卯 Tenon AI 收不到你的文件、需求、API Key 或模型回复。Caret 不使用统计或追踪工具。'],
                    ['发送给模型服务的内容', '你写的需求和全局指令，以及 Agent 为完成任务读取的文件内容和文件路径，会从浏览器直接发给你配置的模型服务。该服务按自己的隐私政策处理这些数据，是否出境取决于你选择的服务。.env、私钥等常见密钥文件不会被读取。'],
                    ['保存在这台设备上的内容', '设置、API Key、对话记录、文件夹访问授权和打开的标签页保存在浏览器的 IndexedDB，主题和语言保存在 localStorage。对话记录包含 Agent 读取过的文件内容，每个项目最多保留 100 条，不会上传。你可以在设置里关闭保存对话记录。你可以在历史记录里删除对话，也可以在设置的数据页清除全部本地数据。'],
                    ['网页托管', '通过线上地址访问时，为保障网络安全，服务器会记录访问日志，包括访问时间、IP 地址和访问的页面，不含网址中的参数；这些日志保存 6 个月后自动删除。'],
                    ['联系我们', '如有问题，请发送邮件到 support@tenonai.cn。']
                ]
            },
            {
                version: '1.1',
                date: '2026 年 11 月 1 日',
                sections: [
                    ['我们不收集什么', 'Caret 没有账号，也没有应用服务器。榫卯 Tenon AI 收不到你的文件、需求、API Key 或模型回复。Caret 不使用统计或追踪工具。'],
                    ['发送给模型服务的内容', '你写的需求和全局指令，以及 Agent 为完成任务读取的文件内容和文件路径，会从浏览器直接发给你配置的模型服务。该服务按自己的隐私政策处理这些数据，是否出境取决于你选择的服务。.env、私钥等常见密钥文件不会被读取。'],
                    ['保存在这台设备上的内容', '设置、API Key、对话记录、文件夹访问授权和打开的标签页保存在浏览器的 IndexedDB，主题和语言保存在 localStorage。对话记录包含 Agent 读取过的文件内容，每个项目最多保留 100 条，不会上传。你可以在设置里关闭保存对话记录。你可以在历史记录里删除对话，也可以在设置的数据页清除全部本地数据。'],
                    ['网页托管', '通过线上地址访问时，托管服务器会留下常规访问日志，例如 IP 地址和访问时间，用于安全和故障排查。'],
                    ['联系我们', '如有问题，请发送邮件到 support@tenonai.cn。']
                ]
            },
            {
                version: '1.0',
                date: '2026 年 11 月 1 日',
                sections: [
                    ['我们不收集什么', 'Caret 没有账号，也没有应用服务器。榫卯 Tenon AI 收不到你的文件、需求、API Key 或模型回复。Caret 不使用统计或追踪工具。'],
                    ['发送给模型服务的内容', '你写的需求，以及 Agent 为完成任务读取的文件内容和文件路径，会从浏览器直接发给你配置的模型服务。该服务按自己的隐私政策处理这些数据，是否出境取决于你选择的服务。.env、私钥等常见密钥文件不会被读取。'],
                    ['保存在这台设备上的内容', '模型设置和 API Key 保存在浏览器的 IndexedDB，主题和语言保存在 localStorage，文件夹访问授权和打开的标签页也保存在浏览器里。对话只保留在当前页面，刷新后消失。你可以在设置里清除 Key，或清除这个网站的数据来删除全部内容。'],
                    ['网页托管', '通过线上地址访问时，托管服务器会留下常规访问日志，例如 IP 地址和访问时间，用于安全和故障排查。'],
                    ['联系我们', '如有问题，请发送邮件到 support@tenonai.cn。']
                ]
            }
        ],
        terms: [
            {
                version: '1.1',
                date: '2026 年 11 月 1 日',
                sections: [
                    ['服务内容', 'Caret 免费提供，源代码按 MIT 许可证开源。服务按现状提供，不保证改动结果正确，也不保证持续可用。'],
                    ['你的责任', '写入前请阅读 diff。Caret 不运行代码，也不验证改动，写入后的结果由你负责。建议在 Git 仓库里使用，以便回退。'],
                    ['模型服务', '你需要自备模型服务账号和 API Key，相关费用和条款由你与服务商约定。'],
                    ['合规使用', '不得将 Caret 用于违法用途，也不得处理你无权处理的代码和数据。'],
                    ['联系我们', '如有问题，请发送邮件到 support@tenonai.cn。']
                ]
            },
            {
                version: '1.0',
                date: '2026 年 11 月 1 日',
                sections: [
                    ['服务内容', 'Caret 免费提供，按现状提供，不保证改动结果正确，也不保证持续可用。'],
                    ['你的责任', '写入前请阅读 diff。Caret 不运行代码，也不验证改动，写入后的结果由你负责。建议在 Git 仓库里使用，以便回退。'],
                    ['模型服务', '你需要自备模型服务账号和 API Key，相关费用和条款由你与服务商约定。'],
                    ['合规使用', '不得将 Caret 用于违法用途，也不得处理你无权处理的代码和数据。'],
                    ['联系我们', '如有问题，请发送邮件到 support@tenonai.cn。']
                ]
            }
        ]
    },
    en: {
        privacy: [
            {
                version: '1.2',
                date: 'Nov 3, 2026',
                sections: [
                    ['What we do not collect', 'Caret has no accounts and no application server. Tenon AI never receives your files, requests, API keys or model replies. Caret uses no analytics or tracking.'],
                    ['What goes to the model service', 'Your requests and global instructions, plus the file contents and paths the Agent reads for the task, go directly from your browser to the model service you configured. That service handles the data under its own privacy policy, and whether data leaves your country depends on the service you choose. Common secret files such as .env and private keys are not read.'],
                    ['What stays on this device', 'Settings, API keys, conversation history, folder access and open tabs are stored in the browser\'s IndexedDB. Theme and language are stored in localStorage. Conversation history includes the file contents the Agent read, keeps up to 100 conversations per project, and is never uploaded. You can turn off saving conversations in Settings. You can delete conversations in History, or delete all local data on the Data page in Settings.'],
                    ['Web hosting', 'When you use the hosted page, the server records access logs to keep the network secure. They include the access time, IP address and the page visited, without the parameters in the URL, and are deleted automatically after 6 months.'],
                    ['Contact', 'Questions? Email support@tenonai.cn.']
                ]
            },
            {
                version: '1.1',
                date: 'Nov 1, 2026',
                sections: [
                    ['What we do not collect', 'Caret has no accounts and no application server. Tenon AI never receives your files, requests, API keys or model replies. Caret uses no analytics or tracking.'],
                    ['What goes to the model service', 'Your requests and global instructions, plus the file contents and paths the Agent reads for the task, go directly from your browser to the model service you configured. That service handles the data under its own privacy policy, and whether data leaves your country depends on the service you choose. Common secret files such as .env and private keys are not read.'],
                    ['What stays on this device', 'Settings, API keys, conversation history, folder access and open tabs are stored in the browser\'s IndexedDB. Theme and language are stored in localStorage. Conversation history includes the file contents the Agent read, keeps up to 100 conversations per project, and is never uploaded. You can turn off saving conversations in Settings. You can delete conversations in History, or delete all local data on the Data page in Settings.'],
                    ['Web hosting', 'When you use the hosted page, the server keeps ordinary access logs, such as IP addresses and timestamps, for security and troubleshooting.'],
                    ['Contact', 'Questions? Email support@tenonai.cn.']
                ]
            },
            {
                version: '1.0',
                date: 'Nov 1, 2026',
                sections: [
                    ['What we do not collect', 'Caret has no accounts and no application server. Tenon AI never receives your files, requests, API keys or model replies. Caret uses no analytics or tracking.'],
                    ['What goes to the model service', 'Your requests, plus the file contents and paths the Agent reads for the task, go directly from your browser to the model service you configured. That service handles the data under its own privacy policy, and whether data leaves your country depends on the service you choose. Common secret files such as .env and private keys are not read.'],
                    ['What stays on this device', 'Model settings and API keys are stored in the browser\'s IndexedDB. Theme and language are stored in localStorage. Folder access and open tabs are also kept in the browser. Conversations stay on the current page and disappear on refresh. You can clear the key in Settings, or clear this site\'s data to remove everything.'],
                    ['Web hosting', 'When you use the hosted page, the server keeps ordinary access logs, such as IP addresses and timestamps, for security and troubleshooting.'],
                    ['Contact', 'Questions? Email support@tenonai.cn.']
                ]
            }
        ],
        terms: [
            {
                version: '1.1',
                date: 'Nov 1, 2026',
                sections: [
                    ['The service', 'Caret is free, and its source code is open under the MIT License. The service is provided as is. We do not guarantee that changes are correct or that the service stays available.'],
                    ['Your responsibility', 'Read the diff before you apply it. Caret does not run or verify code, and you are responsible for what you apply. We suggest working in a Git repository so you can roll back.'],
                    ['Model services', 'You bring your own model service account and API key. Costs and terms are between you and that provider.'],
                    ['Acceptable use', 'Do not use Caret for illegal purposes, or on code and data you have no right to process.'],
                    ['Contact', 'Questions? Email support@tenonai.cn.']
                ]
            },
            {
                version: '1.0',
                date: 'Nov 1, 2026',
                sections: [
                    ['The service', 'Caret is free and provided as is. We do not guarantee that changes are correct or that the service stays available.'],
                    ['Your responsibility', 'Read the diff before you apply it. Caret does not run or verify code, and you are responsible for what you apply. We suggest working in a Git repository so you can roll back.'],
                    ['Model services', 'You bring your own model service account and API key. Costs and terms are between you and that provider.'],
                    ['Acceptable use', 'Do not use Caret for illegal purposes, or on code and data you have no right to process.'],
                    ['Contact', 'Questions? Email support@tenonai.cn.']
                ]
            }
        ]
    }
};
