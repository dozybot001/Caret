# Caret

**Goal**: Building a pure, powerful, easy-to-use, lightweight web AI-powered IDE.

A modern browser-based code editor that combines Monaco Editor with AI capabilities for intelligent code modification. No installation required—runs entirely in your browser using the File System Access API.

## Features

### ✅ Core Features

- **Monaco Editor**: Full-featured code editor with syntax highlighting, multi-tab support, and large file handling
- **AI Code Modification**: 
  - Plan generation (identify relevant files)
  - Patch generation (search-replace blocks)
  - Diff preview for reviewing changes
- **File Management**: Native file system access, `.gitignore` support, file caching
- **Chat Interface**: Streaming AI responses with message history
- **Settings**: Persistent configuration (API key, base URL, model)

### 🚧 Planned

- **Patch application** (apply patches to real files)
- Tools menu functionality
- Pending changes tracking
- Repo map visualization
- Enhanced editor features (find/replace, code folding, minimap)

## Quick Start

1. **Serve the app** (required for ES modules):
```bash
python -m http.server 8000
# or: npx http-server -p 8000
```

2. **Open** `http://localhost:8000` in Chrome/Edge

3. **Configure** API settings (gear icon):
   - Base URL (e.g., `https://api.openai.com/v1`)
   - API Key
   - Model Name (e.g., `gpt-4`, `deepseek-chat`)

## Usage

- **Open Folder**: Click folder icon → select directory
- **Edit Files**: Click file in tree (preview) or double-click (pin)
- **AI Workflow**: Chat → Generate Plan → Generate Patch → Preview (apply coming soon)
- **Shortcuts**: `Ctrl/Cmd + S` (save), `Ctrl/Cmd + +/-` (font size)

## Architecture

- **Monaco Editor**: Code editing & diff preview
- **File System Access API**: Native file operations
- **TreeSitter**: Code parsing for repo analysis
- **IndexedDB**: State persistence

## Requirements

- Chrome 86+ or Edge 86+ (File System Access API support)
- Modern browser with IndexedDB and ES6 modules support

## Project Structure

```
src/
├── chat/          # AI integration & chat UI
├── editor/        # Monaco Editor wrapper
├── file-tree/     # File explorer
├── global/        # Core services (store, notifications)
└── sidebar/       # UI components
```

## License

Open source.
