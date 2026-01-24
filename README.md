# Caret

A lightweight, browser-based AI IDE: **Monaco editor + local file system access + chat-driven code changes**.

Runs fully in your browser (no install). Uses the File System Access API to read/write your local project.

## Features

- **Editor**
  - Monaco editor with tabs
  - Preview tabs (single click) vs pinned tabs (double click)
  - Large file support (chunked loading)
  - Save: `Ctrl/Cmd+S`
  - Font size: `Ctrl/Cmd + = / - / 0`
- **Explorer**
  - Open a local folder (read/write)
  - `.gitignore` support (hides ignored files, skips `.git`)
- **AI workflow (plan → patch → preview → apply)**
  - Chat message → generates a **Relevant Files** list (with streaming "thinking")
  - Select files → **Generate Patch** → shows **Files to Patch** with `+added / -removed`
  - Click a file to open an **inline patch preview** in the editor (old highlighted, new highlighted)
  - Accept/Reject per file (and Accept/Reject All), then **Apply Patches** to write changes to disk
  - Cancel in-flight requests (Send button turns into Cancel)
- **Repo map**
  - Generates a repo map (Tree-sitter + worker) and saves it as `repo-map.txt`
- **Tools**
  - **Fetch README**: given a GitHub user/org URL, downloads all public repo READMEs as a zip
  - **File Size Chart**: local-only folder scan, donut chart + list, highlights GitHub's 100MB/file limit, click to copy paths
  - **Auto Space**: automatically adds spaces between Chinese characters and Latin characters/punctuation in the currently opened file (based on [daft-auto-spacing](https://github.com/zizhengwu/daft-auto-spacing))
  - **Pure Color**: color picker modal with fullscreen display - useful for viewing pure color backgrounds (e.g., for scanning X-ray films)
- **Persistence (IndexedDB)**
  - API config (base URL, key, model), font size, GitHub URL
  - Restores last opened folder (permission required), open tabs, chat history, and plan/patch UI state

## Quick start

Serve the folder (ES modules require a local server):

```bash
python -m http.server 8000
# or: npx http-server -p 8000
```

Open `http://localhost:8000` in Chrome/Edge.

## Usage

- **Open folder**: folder icon → pick a directory
- **Settings**: gear icon → set **Base URL**, **API Key**, **Model**
- **Chat**: type a request → pick relevant files → Generate Patch → review → Apply Patches
- **Repo map**: "Repo Map" button → writes `repo-map.txt` into your project
- **Tools**: extensions icon → Fetch README / File Size Chart / Auto Space / Pure Color
- **Clear chat**: trash icon

## Requirements

- Chromium browser with File System Access API (Chrome/Edge recommended)
- IndexedDB enabled

## Project structure

```
src/
├── chat/          # plan/patch prompts, streaming, repo-map
├── editor/        # Monaco editor + tab system
├── file-tree/     # explorer + .gitignore support
├── global/        # app controller, store (IndexedDB), notifications
└── sidebar/       # settings + tools/features
```

## AI Statement

Tag: `ai-build`  
Reference: `AI_STATEMENTS.md`
