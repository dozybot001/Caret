# Caret

只有三个工具的 Coding Agent：`read`、`write`、`edit`。

Caret 运行在浏览器里，不用安装。打开一个本地文件夹，说明要改什么，Agent 找到代码并做出改动。改动先出现在编辑器里，你看完 diff，也可以再手动调整，确认后写入磁盘。

它不提供 bash，不执行命令，也不运行测试。适合看 diff 就能判断对错的改动，例如文案、配置、样式、文档和小 bug。

## 三个工具

| 工具 | 作用 |
| --- | --- |
| `read` | 读取文件、列出目录、搜索内容 |
| `write` | 新建文件，或重写整个文件 |
| `edit` | 精确替换文件里的一段文字，匹配到多处时拒绝修改 |

Agent 的循环、工具和模型调用都在 [src/agent](src/agent)。

## 功能

- **编辑器** — Monaco 编辑器，标签页（单击预览，双击固定），`Ctrl/Cmd+S` 保存，`Ctrl/Cmd + =/- /0` 调整字号
- **文件树** — 打开或拖入本地文件夹，按 `.gitignore` 过滤
- **审阅** — 改动就是编辑器里未保存的内容，用 Monaco Diff 显示，可以直接编辑；Agent 和你改的是同一份内容
- **写入** — `Ctrl/Cmd+Enter` 或点击按钮写入全部文件，磁盘内容变化时提示冲突，写入后可以撤销
- **模型** — 从浏览器直连 OpenAI 兼容接口，内置 DeepSeek、Kimi、Qwen、OpenAI、OpenRouter，也可以填写自定义地址
- **历史记录** — 按项目保存对话，可以恢复、继续和删除，不需要账号

## 记忆

Caret 没有隐藏的记忆，只有两样你能看到的东西：

- **项目规则** — 运行时读取 `AGENTS.md` 或 `CLAUDE.md`。你说出长期规则时，Agent 用 `edit` 加一行，走同样的 diff 审阅。其他 Coding Agent 也能读这份文件
- **对话记录** — 保存在这个浏览器的 IndexedDB 里，恢复时重新发给模型。换浏览器或清除网站数据后不会保留

## 数据去向

- Caret 没有账号，也没有应用服务器
- 你的需求和 Agent 读取的文件内容只发给你配置的模型服务
- `.env`、私钥等常见密钥文件不会被读取
- API Key 和对话记录只保存在这台设备的浏览器里

## 使用

用桌面版 Chrome 或 Edge 打开 <https://caret.tenon.asia/>，也可以在本地运行：

```bash
python3 -m http.server 8000
```

然后打开 `http://localhost:8000`。

## 测试

```bash
node --test test.mjs
```

## 许可证

[MIT](LICENSE)。图标来自 [vscode-codicons](https://github.com/microsoft/vscode-codicons)，许可证见 [css/codicons](css/codicons)。
