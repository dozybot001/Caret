# Caret

[简体中文](README.md) | English

A coding agent with three tools: `read`, `write` and `edit`.

Caret runs in your browser, with nothing to install. Open a local folder and describe the change. The Agent finds the code and makes the edit. Changes appear in the editor first, so you can read the diff and adjust them by hand before applying them to disk.

It has no bash, runs no commands and runs no tests. It suits changes you can judge by reading the diff, such as copy, configuration, styles, documentation and small bugs.

## The three tools

| Tool | What it does |
| --- | --- |
| `read` | Reads files, lists directories and searches content |
| `write` | Creates a file, or rewrites a whole file |
| `edit` | Replaces an exact piece of text in a file, and refuses when it matches more than one place |

The Agent loop, the tools and the model calls are all in [src/agent](src/agent).

## Features

- **Editor** — Monaco editor with tabs (single click to preview, double click to keep), `Ctrl/Cmd+S` to save and `Ctrl/Cmd + =/- /0` to change the font size
- **File tree** — Open or drop a local folder. Files are filtered by `.gitignore`, and you can add ignore rules in Settings. Next to the root folder you can remove access and return to the initial state
- **Git status** — The file tree shows the current branch and change marks (`M` modified, `U` untracked, `D` deleted). It is read-only: it does not commit or write to `.git`. Staged changes are not shown. You can turn it off in Settings
- **Review** — Changes are unsaved content in the editor, shown in a Monaco diff (inline or side by side) that you can edit directly. You and the Agent work on the same content
- **Apply** — `Ctrl/Cmd+Enter` or the button writes all files, and warns you if a file changed on disk. You can undo an apply, and undo runs the same check first
- **Models** — Connects directly from the browser to OpenAI-compatible APIs. DeepSeek, Kimi, Qwen, OpenAI and OpenRouter are built in, and you can enter a custom URL. Model lists and reasoning levels come from each provider's API. Choose defaults in Settings, and switch for the current conversation in the input bar
- **History** — Conversations are saved per project and can be resumed, continued and deleted, with no account. You can turn saving off. Use the up and down keys in the input to recall earlier prompts
- **Long conversations** — The ring in the input bar shows context usage, and compaction runs automatically at 100%. See [Context](#context)
- **Settings** — A side navigation with Model, Agent, Editor, Files, Appearance, Data and About. The Agent page has global instructions, the send key, the step limit and the compaction size. The Editor page has tab size, cursor, line numbers, minimap, whitespace and diff view. The Appearance page has theme, language, font and font sizes. The Data page shows storage use and can clear conversations, restore defaults or delete all local data

## Memory

Caret has no hidden memory. There are three things, and you can see all of them:

- **Project rules** — `AGENTS.md` or `CLAUDE.md` is read at run time. When you state a lasting rule, the Agent adds a line with `edit`, and you review it like any other diff. You can turn this off in Settings. Other coding agents can read the same file
- **Global instructions** — You write these in Settings. They apply to every project and the Agent does not change them. If they disagree with project rules, the project rules win
- **Conversations** — Stored in this browser's IndexedDB and sent to the model again when resumed. They do not follow you to another browser, and clearing site data removes them

## Context

The model receives the whole conversation with every reply. The ring in the input bar shows how much is used. 100% is the compaction size in Settings (50k, 100k or 200k tokens, 100k by default). The number is estimated from the character count.

At 100%, Caret clears older tool results and keeps the most recent ones. These results are mostly file contents the Agent read, and it can read them again when needed, so compaction does not call the model to write a summary. Your messages, the Agent's replies and the record of changes all stay.

A new task starts from 0. The explanation in the app is at Settings → Agent → Context and compaction, and clicking the ring opens it too.

## Where your data goes

- Caret has no accounts and no application server
- Your requests, global instructions and the file contents the Agent reads go only to the model service you configured
- Common secret files, such as `.env`, private keys and login files for cloud and package tools, are not read
- API keys, settings and conversations are stored only in this device's browser, and you can delete all of them on the Data page in Settings

## Usage

Open <https://caret.tenon.asia/> in desktop Chrome or Edge, or run it locally:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Tests

```bash
node --test test.mjs
```

## License

[MIT](LICENSE). Icons are from [vscode-codicons](https://github.com/microsoft/vscode-codicons), with the license in [css/codicons](css/codicons).
