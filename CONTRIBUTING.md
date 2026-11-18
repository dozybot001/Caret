# Contributing to Caret

[English](#english) | [简体中文](#简体中文)

## English

### Before you start

- Report bugs and suggest ideas in [issues](https://github.com/dozybot001/Caret/issues/new/choose), using the templates. Security problems go through [SECURITY.md](SECURITY.md) instead.
- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Caret keeps a few boundaries on purpose. Pull requests that cross them will not be merged:
  - The Agent has only `read`, `write` and `edit`. No shell, no commands, no test runs
  - No build step and no runtime dependency: the source is what runs in production, with no bundler or npm packages
  - The page loads no third-party scripts. Monaco is served from `vendor/monaco-<version>/` on the same origin
  - Git status is read-only: Caret parses `.git/index` and compares it with the working tree, and never writes to `.git`
  - Model lists and reasoning levels come from each provider's `/models` API, not a hand-written table

### Development

The page's own scripts and styles have no content hash in their names, because there is no build step to add one. They are served with `no-cache`, so the browser checks with the server for updates each time. Monaco sits in a versioned folder with a long cache lifetime.

```bash
python3 -m http.server 8000             # Run locally, then open http://localhost:8000
node --test                             # Run the tests, with Node.js 22 or later
```

Maintainers release with `bash deploy/release.sh`, which scans for secrets, checks dependency advisories, runs the tests, uploads and checks the live site. `bash deploy/release.sh maintenance on` shows the maintenance page, and `off` restores the site. Both need access to the server.

```text
*.html                 Page entry point, error pages and maintenance page
AGENTS.md              Project conventions for agents (in Chinese)
CHANGELOG.md           Changelog (in Chinese)
src/
  main.js              Startup
  app/                 Controller, storage, preferences and constants
  agent/               Agent loop, model calls and the three tools
  chat/                Conversation UI, input bar, change review and history
  editor/              Monaco, tabs and pending changes
  file-tree/           File tree, ignore rules and Git status
  settings/            Settings dialog
  i18n/                Chinese and English copy, and legal text
css/                   Styles, starting from style.css
assets/                Static assets such as the share image
tests/                 Tests, matching the modules in src and the scripts in deploy
docs/                  Design guidelines, security self-check and README images
vendor/                Monaco 0.52.2, from min/vs in the npm package, with only the Simplified Chinese language pack
deploy/                Release and cleanup scripts, Caddy config and the server's host key
.github/               Issue and pull request templates
```

### Pull requests

- Run `node --test` and make sure everything passes. Add tests for new behaviour, in the test file that matches the module in `src`.
- Follow [AGENTS.md](AGENTS.md) (in Chinese). In short: native ES modules with 4-space indentation, and JSDoc and comments in Simplified Chinese; interface text goes in both `src/i18n/zh.js` and `src/i18n/en.js`; colors come only from the variables in `css/theme.css`; read the [design guidelines](docs/design-guidelines.md) before changing the interface.
- Update `README.md` and `README.zh-CN.md` together.
- For a change users can see, add a line under `[未发布]` in [CHANGELOG.md](CHANGELOG.md). Maintainers set the version when they release.
- Never commit API keys or other secrets, not even in tests.

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## 简体中文

### 动手之前

- 缺陷和建议请用模板开 [issue](https://github.com/dozybot001/Caret/issues/new/choose)。安全问题不开 issue，按 [SECURITY.md](SECURITY.md) 报告。
- 比小修小补大的改动，先开 issue 商量做法。
- Caret 有意守着几条边界，越过的 PR 不会合并：
  - Agent 只有 `read`、`write`、`edit` 三个工具。不加 bash，不执行命令，不运行测试
  - 没有构建步骤，也没有运行时依赖，源码就是线上运行的代码。不引入打包工具和 npm 依赖
  - 页面不加载第三方脚本。Monaco 放在 `vendor/monaco-<版本>/` 同源托管
  - Git 状态只读：解析 `.git/index` 和工作区比较，不写 `.git`
  - 模型列表和推理档位以服务商 `/models` 接口返回的为准，不手写档位表

### 开发

页面自己的脚本和样式没有内容哈希：没有构建步骤就没法给文件名加哈希，所以这些文件设为 `no-cache`，每次向服务器确认有没有更新。Monaco 按版本放在 `vendor/monaco-<版本>/`，设为长期缓存。

```bash
python3 -m http.server 8000             # 本地运行，然后打开 http://localhost:8000
node --test                             # 运行测试，需要 Node.js 22 或更高版本
```

维护者用 `bash deploy/release.sh` 发布：扫描密钥、查依赖漏洞、跑测试、上传并公网验收。`bash deploy/release.sh maintenance on` 显示维护页，`off` 恢复。这两条都要能登录服务器。

```text
*.html                 页面入口、错误页和维护页
AGENTS.md              给 Agent 的项目约定
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
docs/                  设计规范、安全自查和 README 配图
vendor/                Monaco 0.52.2，来自 npm 包的 min/vs，只保留简体中文语言包
deploy/                发布和旧版本清理脚本、Caddy 配置、服务器主机公钥
.github/               Issue 和 PR 模板
```

### 提交 PR

- 按 [AGENTS.md](AGENTS.md) 的约定写代码、文案和测试，提交前运行 `node --test`，全部通过。
- 用户看得到的变化，在 [CHANGELOG.md](CHANGELOG.md) 的 `[未发布]` 下加一条，版本号由维护者发布时改。
- 密钥不进仓库，也不写进测试。

参与的人都遵守[行为准则](CODE_OF_CONDUCT.md)。
