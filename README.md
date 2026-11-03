# Caret

简体中文 | [English](README.en.md)

极轻量的浏览器 Coding Agent。只有三个工具：`read`、`write`、`edit`。

Caret 运行在浏览器里，不用安装，也不用账号。打开一个本地文件夹，说明要改什么，Agent 找到代码并做出改动。改动先留在编辑器里，你看完 diff 再写入磁盘。

线上地址：<https://caret.tenon.asia/>

![Caret 正在审阅一处改动](docs/screenshot.png)

## 适合做什么

改文案、配置、样式、文档和小 bug，这些改动看 diff 就能判断对错。

Caret 不提供 bash，不执行命令，也不运行测试。需要跑起来才能确认的改动，它会告诉你该检查什么。

| 工具 | 作用 |
| --- | --- |
| `read` | 读取文件、列出目录、搜索内容 |
| `write` | 新建文件，或重写整个文件 |
| `edit` | 精确替换文件里的一段文字，匹配到多处时拒绝修改 |

## 开始使用

1. 用桌面版 Chrome 或 Edge 打开 <https://caret.tenon.asia/>。其他浏览器不能访问本地文件夹
2. 在设置里选择模型服务，填写 API Key。内置 DeepSeek、Kimi、Qwen、OpenAI 和 OpenRouter，也可以填写 OpenAI 兼容的自定义地址
3. 打开或拖入一个文件夹，说明要改什么
4. 看完 diff，点“写入文件”或按 `Ctrl/Cmd+Enter`。写入后可以撤销

Caret 只做网页版，不做手机应用：它要直接读写本地文件夹，目前只有桌面版 Chrome 和 Edge 支持这个能力（File System Access API）。

## 功能

- **编辑和审阅**：Monaco 编辑器，Agent 和你改的是同一份内容。Diff 支持行内和并排，可以直接编辑
- **写入保护**：写入和撤销前都检查磁盘内容，文件被其他程序改过时先提示
- **文件树**：按 `.gitignore` 过滤，显示 Git 分支和改动标记。Git 状态只读，不提交，也不写入 `.git`
- **模型**：模型列表和推理档位都来自服务商的接口，设置里选默认值，输入栏可以为当前对话切换
- **历史记录**：按项目保存对话，可以恢复、继续和删除
- **设置**：左侧导航分为模型、Agent、编辑器、文件、外观、数据和关于

## 记忆

Caret 没有隐藏的记忆，只有三样你能看到的东西：

- **项目规则**：运行时读取 `AGENTS.md` 或 `CLAUDE.md`。你说出长期规则时，Agent 加一行，走同样的 diff 审阅。这一行为可以在设置里关闭
- **全局指令**：你写在设置里，在所有项目生效，Agent 不会修改。和项目规则冲突时以项目规则为准
- **对话记录**：保存在这个浏览器的 IndexedDB 里，可以删除，也可以关闭保存

## 上下文

系统提示词和工具定义约 700 token，不带文件列表，Agent 需要什么再读什么。

输入栏的小圈显示上下文已用比例，100% 是设置里的压缩线，默认约 10 万 token。到 100% 时，Caret 清理较早的工具结果，这些内容可以重新读取，所以压缩不调用模型写摘要。

## 数据去向

- Caret 没有账号，也没有应用服务器
- 你的需求、全局指令和 Agent 读取的文件内容只发给你配置的模型服务
- `.env`、私钥、云服务和包管理工具的登录文件等常见密钥文件不会被读取
- API Key、设置和对话记录只保存在这台设备的浏览器里，可以在设置的数据页全部清除
- 访问线上地址时，服务器会记录访问日志，包括访问时间、IP 地址和访问的页面，不含网址参数，保存 6 个月后自动删除

### 数据清单

| 数据 | 来源 | 用途 | 保存位置和期限 | 删除方式 |
| --- | --- | --- | --- | --- |
| 模型服务设置和 API Key | 你在设置里填写 | 调用你选的模型服务 | 本机 IndexedDB，直到你删除 | 设置的数据页 |
| 偏好设置和全局指令 | 你在设置里填写 | 按你的偏好运行 | 本机 IndexedDB，直到你删除 | 恢复默认设置，或数据页 |
| 对话记录，含 Agent 读过的文件内容 | 你和 Agent 的对话 | 恢复和继续对话 | 本机 IndexedDB，每个项目最多 100 条 | 历史记录里删除，或数据页；可以关闭保存 |
| 发过的提示词 | 输入栏 | 按上下键找回 | 本机 IndexedDB，每个项目最多 200 条 | 数据页 |
| 文件夹访问授权和打开的标签页 | 你选的文件夹 | 下次打开时恢复 | 本机 IndexedDB，直到你删除 | 取消文件夹授权，或数据页 |
| 主题、语言和面板宽度 | 设置和界面操作 | 打开页面时直接按偏好显示 | 本机 localStorage，直到你删除 | 数据页 |
| 需求、全局指令，以及 Agent 读取的文件内容和路径 | 你的对话 | 完成任务 | 你选的模型服务，按它的隐私政策处理 | 按服务商的规则 |
| 访问日志：时间、IP 地址、访问的页面（不含参数）、状态码和耗时 | 访问线上地址 | 网络安全 | 服务器，6 个月后自动删除 | 到期自动删除 |

## 开发

没有构建步骤，也没有运行时依赖，源码就是线上运行的代码。Monaco 放在 `vendor/`，和页面同源托管，页面不加载第三方脚本。

页面自己的脚本和样式没有内容哈希：没有构建步骤就没法给文件名加哈希，所以这些文件设为 `no-cache`，每次向服务器确认有没有更新。Monaco 按版本放在 `vendor/monaco-<版本>/`，设为长期缓存。

```bash
python3 -m http.server 8000             # 本地运行，然后打开 http://localhost:8000
node --test                             # 运行测试，需要 Node.js 22 或更高版本
bash deploy/release.sh                  # 发布：扫描密钥、查依赖漏洞、跑测试、上传并公网验收
bash deploy/release.sh maintenance on   # 显示维护页，off 恢复
```

```text
*.html                 页面入口、错误页和维护页
CHANGELOG.md           更新记录
src/
  main.js              启动
  app/                 控制器、存储、偏好和常量
  agent/               Agent 循环、模型调用和三个工具
  chat/                对话界面、输入栏、审阅改动和历史记录
  editor/              Monaco、标签页和未写入的改动
  file-tree/           文件树、忽略规则和 Git 状态
  settings/            设置对话框
  i18n/                中英文文案和法律文本
css/                   样式，入口是 style.css
assets/                分享图等静态资源
tests/                 测试，和 src 的模块、deploy 的脚本对应
docs/                  设计规范、安全自查和 README 截图
vendor/                Monaco 0.52.2，来自 npm 包的 min/vs，只保留简体中文语言包
deploy/                发布和旧版本清理脚本、Caddy 配置、服务器主机公钥
```

修改界面前先看[设计规范](docs/design-guidelines.md)。版本变化见[更新记录](CHANGELOG.md)，安全自查见 [docs/security.md](docs/security.md)。

## 许可证

[MIT](LICENSE)。编辑器是 [Monaco Editor](https://github.com/microsoft/monaco-editor)，许可证见 [vendor/monaco-0.52.2](vendor/monaco-0.52.2)。图标来自 [vscode-codicons](https://github.com/microsoft/vscode-codicons)，许可证见 [css/codicons](css/codicons)。
