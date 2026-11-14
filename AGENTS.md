# Caret

极轻量的浏览器 Coding Agent。目录结构、本地运行、测试和发布命令见 [README.md](README.md) 的「开发」一节，这里只写改代码时要守的约定。

## 产品边界

- Agent 只有 read、write、edit 三个工具。不加 bash，不执行命令，不运行测试。
- 没有构建步骤，也没有运行时依赖，源码就是线上运行的代码。不引入打包工具和 npm 依赖。
- 页面不加载第三方脚本。Monaco 放在 `vendor/monaco-<版本>/` 同源托管，升级时换版本目录。
- Git 状态只读：解析 `.git/index` 和工作区比较，不写 `.git`。
- 模型列表和推理档位以服务商 `/models` 接口返回的为准，不手写档位表。

## 代码

- 原生 ES 模块，缩进 4 个空格，JSDoc 和注释用简体中文。
- 界面文字都放在 `src/i18n/zh.js` 和 `src/i18n/en.js`，两边的键保持一致。
- 改界面前先读 [docs/design-guidelines.md](docs/design-guidelines.md)。颜色只用 `css/theme.css` 里的变量，新变量同时给出深色和浅色取值。
- 线上地址和备案号只写在 `src/app/site.js`。页面、`security.txt` 和 README 里的地址由 `tests/site.test.mjs` 核对。
- 密钥不进仓库，也不写进测试。安全自查见 [docs/security.md](docs/security.md)。

## 改完之后

- 运行 `node --test`，全部通过。新行为加测试，测试文件和 `src` 的模块对应。
- 用户看得到的变化：在 `CHANGELOG.md` 加一条，并改 `src/app/constants.js` 里的 `VERSION`。
- 中文和英文两份 README 一起改。
- 改完一件事，同时清掉它留下的旧代码、旧配置和文档里的旧说法。
