# Caret

浏览器端 AI IDE，无需安装，通过 File System Access API 读写本地文件。

## 功能

- **Monaco 编辑器** — 标签页（单击预览 / 双击固定）、大文件分块加载、`Ctrl/Cmd+S` 保存、`Ctrl/Cmd + =/- /0` 调整字号
- **文件浏览器** — 打开本地文件夹，`.gitignore` 过滤
- **AI 对话** — plan → patch → preview → apply，流式输出，支持取消
- **Repo Map** — Tree-sitter 生成仓库结构图（`repo-map.txt`）
- **设置** — 配置 Base URL、API Key、Model
- **持久化** — IndexedDB 保存配置、标签页状态、聊天历史，恢复上次打开的文件夹

## 启动

```bash
python -m http.server 8000
```

Chrome/Edge 打开 `http://localhost:8000`。
