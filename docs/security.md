# 安全自查：OWASP ASVS 5.0 Level 1

- 范围：Caret 0.11.3，线上地址 <https://caret.tenon.asia>。包括页面代码、`vendor/` 里的 Monaco、`deploy/` 里的 Caddy 站点配置和发布脚本；不包括使用者选择的模型服务，以及服务器上的 Caddy 主配置和操作系统。
- 日期：2026-11-03。
- 依据：Tenon 15.1.8，新产品逐条对照 OWASP ASVS 5.0 Level 1 自查，结果写进项目文档。
- 方法：阅读代码和配置，对照 ASVS 5.0.0 的 70 条 Level 1 要求逐条判断，不涉及 Level 2、Level 3。要求清单取自 OWASP 的 [ASVS 5.0.0 正式版 CSV](https://github.com/OWASP/ASVS/releases/download/v5.0.0_release/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv)。响应头、TLS 和证书另用 curl、openssl 检查了线上站点，当时线上是 0.11.2，本次发布改动的配置以仓库为准。
- 结果：满足 19 条，不适用 51 条，未满足 0 条。V16（安全日志和错误处理）和 V17（WebRTC）没有 Level 1 要求。

Caret 是由 Caddy 托管的静态网站，没有自己的应用服务器，也没有账号、会话、授权、令牌、OAuth 和接口。使用者在设置里填写自己的模型服务 API Key，保存在浏览器的 IndexedDB，页面从浏览器直接请求该服务。Agent 只能通过 `read`、`write`、`edit` 操作使用者选择的文件夹，改动留在编辑器里，使用者审阅 diff 后才写入磁盘。

## 未满足

无。初查时有 3 条未满足，已在本次发布中处理：

- V4.1.1：没有扩展名的许可证文件（`LICENSE` 等）返回时没有 `Content-Type`，现在由 Caddy 设为纯文本。
- V15.1.1：没有文档规定第三方组件漏洞的修复时限和常规更新周期，现在写在下文「第三方组件」。
- V15.2.1：没有成文的时限可以对照，现在按「第三方组件」里的时限，Monaco 0.52.2 没有超期。

## Level 1 之外的说明

以下几点不属于 Level 1，不影响本文的结论：

- CSP 的 `script-src`、`style-src` 允许 `'unsafe-inline'`。脚本是因为 `index.html` 里有一段首屏主题脚本和两个内联事件（`onclick`、`onerror`），样式是因为 Monaco 运行时插入 `<style>`，错误页也用内联样式。这样 CSP 拦不住注入的内联脚本，防 XSS 依靠 V1.2.1、V3.2.2 所述的渲染方式和不加载第三方脚本。CSP 本身属于 V3.4.3（Level 2）。把主题脚本和内联事件移到脚本文件后，`script-src` 可以去掉 `'unsafe-inline'`。
- CSP 的 `connect-src` 允许任意 HTTPS 地址和本机 `localhost`、`127.0.0.1` 的 HTTP 端口，因为使用者可以连接任何 OpenAI 兼容服务和本机模型，无法列出固定的域名。代价是页面一旦被注入脚本，CSP 不能阻止它把 API Key 和文件内容发往其他地址。
- API Key 以明文保存在 IndexedDB（`src/app/store.js`），同源脚本和能访问这个浏览器配置文件的人都能读到。这是纯前端、使用者自带 Key 的方式决定的。

## V1 编码和净化（Encoding and Sanitization）

| 编号 | 要求 | 结论 | 依据 |
| --- | --- | --- | --- |
| V1.2.1 | 按上下文对 HTTP 响应、HTML、XML 的输出编码，避免改变文档结构 | 满足 | 没有服务端模板，HTML 都是仓库里的静态文件。页面上的动态文字用 `textContent`、`createTextNode` 写入；模型回复由 `src/chat/markdown.js` 用 DOM 接口生成节点，不拼接 HTML；`innerHTML` 只用于清空和写入固定的图标标记 |
| V1.2.2 | 动态拼接 URL 时按上下文编码，只允许安全的协议 | 满足 | 模型回复里的链接只接受 `http`、`https`、`mailto`，其他协议按文字显示，`href` 通过 DOM 属性设置（`src/chat/markdown.js`、`tests/markdown.test.mjs`）；请求模型服务的地址是配置的地址加固定路径（`src/agent/model.js`） |
| V1.2.3 | 动态生成 JavaScript 或 JSON 时编码，防止注入 | 满足 | 请求体用 `JSON.stringify` 生成（`src/agent/model.js`），不动态生成脚本 |
| V1.2.4 | 数据库查询使用参数化等方式，防止 SQL 等注入 | 不适用 | 没有服务端数据库；浏览器里的 IndexedDB 只按键读写（`src/app/store.js`），没有查询语言 |
| V1.2.5 | 防止操作系统命令注入 | 不适用 | 没有服务端代码，也不执行命令；Agent 只有 `read`、`write`、`edit` 三个工具（`src/agent/tools.js`） |
| V1.3.1 | 富文本编辑器等来源的 HTML 输入用成熟的净化库处理 | 不适用 | 不接收按 HTML 渲染的输入；模型回复按 Markdown 解析成有限的几种节点，其中的 HTML 标签按文字显示 |
| V1.3.2 | 不使用 `eval` 等动态执行代码的功能 | 满足 | 自有代码没有 `eval`、`new Function` 或字符串形式的定时器；CSP 不含 `'unsafe-eval'`，浏览器拒绝动态执行代码 |
| V1.5.1 | XML 解析器使用严格配置，禁用外部实体 | 不适用 | 不解析 XML |

## V2 校验和业务逻辑（Validation and Business Logic）

| 编号 | 要求 | 结论 | 依据 |
| --- | --- | --- | --- |
| V2.1.1 | 文档规定各类输入的校验规则 | 满足 | 本文“输入校验规则”一节 |
| V2.2.1 | 按业务预期校验输入，优先使用允许列表或预定结构；L1 至少覆盖用于业务或安全决策的输入 | 满足 | 工具名、参数、路径和文件按固定规则校验（`src/agent/agent.js`、`src/agent/tools.js`）；网址参数 `theme`、`lang` 只接受固定取值（`src/app/preferences.js`） |
| V2.2.2 | 在可信的服务层执行输入校验，不依赖客户端校验 | 不适用 | 没有服务端，数据和操作都属于使用者本人；对模型返回内容的校验见 V2.2.1 |
| V2.3.1 | 业务流程只能按预期顺序执行，不能跳过步骤 | 满足 | Agent 的改动只进入编辑器缓冲区（`src/editor/pending-changes.js`），只有使用者点“写入文件”或按保存键才写入磁盘（`src/chat/review.js`、`src/editor/editor-manager.js`） |

## V3 Web 前端安全（Web Frontend Security）

| 编号 | 要求 | 结论 | 依据 |
| --- | --- | --- | --- |
| V3.2.1 | 防止浏览器在错误的上下文中渲染响应内容，例如直接访问接口或上传的文件 | 满足 | 站点只发布仓库里的静态文件（`deploy/release.sh` 的 `FILES` 和 `vendor/`），没有上传文件和接口；所有响应带 `X-Content-Type-Options: nosniff` 和 `frame-ancestors 'none'`（`deploy/caret.Caddyfile`）；本地文件只在 Monaco 里按文本显示 |
| V3.2.2 | 应按文本显示的内容用 `textContent` 等安全方式渲染 | 满足 | 用户消息、状态和通知用 `textContent`（`src/chat/chat-ui.js`、`src/app/notification-system.js`），模型回复用 `createTextNode` 和 `textContent`（`src/chat/markdown.js`） |
| V3.3.1 | Cookie 设置 `Secure`，并使用 `__Host-` 或 `__Secure-` 前缀 | 不适用 | 不设置 Cookie：线上响应没有 `Set-Cookie`，代码不读写 `document.cookie` |
| V3.4.1 | 所有响应带 HSTS，`max-age` 至少一年 | 满足 | `deploy/caret.Caddyfile` 对所有响应（包括错误页）设置 `Strict-Transport-Security: max-age=31536000; includeSubDomains`，发布验收检查这个值（`deploy/release.sh`） |
| V3.4.2 | CORS 的 `Access-Control-Allow-Origin` 为固定值或按允许列表校验；用 `*` 时响应不含敏感信息 | 不适用 | 不发送 `Access-Control-Allow-Origin`（线上检查），没有供跨域调用的接口 |
| V3.5.1 | 不依赖 CORS 预检时，敏感操作要校验请求来自本应用（防 CSRF） | 不适用 | 服务器只提供静态文件，没有敏感操作，也没有 Cookie 和会话 |
| V3.5.2 | 依赖 CORS 预检时，不能用不触发预检的请求调用敏感操作 | 不适用 | 同上 |
| V3.5.3 | 敏感操作使用 POST 等方法，不用 GET 等安全方法 | 不适用 | 同上 |

## V4 API 和 Web 服务（API and Web Service）

| 编号 | 要求 | 结论 | 依据 |
| --- | --- | --- | --- |
| V4.1.1 | 有消息体的响应都带与内容相符的 `Content-Type`，文本类型带 `charset` | 满足 | HTML、JS、CSS、TXT 都是 `charset=utf-8`，PNG、TTF 类型正确；没有扩展名的 `LICENSE`、`css/codicons/LICENSE`、`css/codicons/LICENSE-CODE`、`vendor/monaco-<版本>/LICENSE` 由 Caddy 设为 `text/plain; charset=utf-8`（`deploy/caret.Caddyfile`），发布验收检查 `/LICENSE` |
| V4.4.1 | WebSocket 连接都使用 WSS | 不适用 | 不使用 WebSocket；模型的流式回复用 `fetch` 读取 SSE（`src/agent/model.js`） |

## V5 文件处理（File Handling）

| 编号 | 要求 | 结论 | 依据 |
| --- | --- | --- | --- |
| V5.2.1 | 只接受能正常处理的文件大小，避免性能下降或拒绝服务 | 不适用 | 没有文件上传，本地文件只在使用者自己的浏览器里处理；Agent 从磁盘读取文件的上限是 2 MB（`src/app/constants.js` 的 `AGENT_FILE_LIMIT`） |
| V5.2.2 | 接受文件时检查扩展名和内容是否一致 | 不适用 | 没有文件上传，也没有依据文件内容做的业务或安全决策；不是 UTF-8 文本的文件只读，不交给 Agent（`src/file-tree/file-manager.js`） |
| V5.3.1 | 上传或由不可信输入生成、放在公开目录的文件不会作为服务端代码执行 | 不适用 | 没有上传，服务器不运行服务端程序，Caddy 只发送静态文件；Agent 写的文件在使用者本地 |
| V5.3.2 | 文件路径使用内部生成或可信的数据；必须用外部提供的文件名时严格校验，防止路径穿越等 | 满足 | 模型给出的路径统一成项目内的相对路径，含 `..` 时拒绝，任何层级的 `.git`、`.intent` 拒绝（`src/agent/tools.js` 的 `normalizePath`）；常见密钥文件不读取、不修改（`SECRET_FILE`）；访问范围限于使用者选择的文件夹（File System Access API）；有测试（`tests/tools.test.mjs`） |

## V6 认证（Authentication）

| 编号 | 要求 | 结论 | 依据 |
| --- | --- | --- | --- |
| V6.1.1 | 文档说明如何用限流、防自动化等手段防御撞库和暴力破解 | 不适用 | 没有账号、登录和密码，也没有默认账户；API Key 是模型服务的凭据，不用于登录 Caret |
| V6.2.1 | 用户设置的密码至少 8 位 | 不适用 | 同上 |
| V6.2.2 | 用户可以修改密码 | 不适用 | 同上 |
| V6.2.3 | 修改密码时要求输入当前密码和新密码 | 不适用 | 同上 |
| V6.2.4 | 注册或修改密码时对照至少 3000 个常见密码 | 不适用 | 同上 |
| V6.2.5 | 不限制密码的字符组成 | 不适用 | 同上 |
| V6.2.6 | 密码输入框使用 `type=password` | 不适用 | 同上 |
| V6.2.7 | 允许粘贴、浏览器密码助手和密码管理器 | 不适用 | 同上 |
| V6.2.8 | 按收到的原样校验密码，不截断、不改大小写 | 不适用 | 同上 |
| V6.3.1 | 按安全文档实施防撞库和暴力破解的控制 | 不适用 | 同上 |
| V6.3.2 | 不存在默认账户（如 root、admin），或已禁用 | 不适用 | 同上 |
| V6.4.1 | 系统生成的初始密码或激活码安全随机、短时有效，不能变成长期密码 | 不适用 | 同上 |
| V6.4.2 | 不使用密码提示和密保问题 | 不适用 | 同上 |

## V7 会话管理（Session Management）

| 编号 | 要求 | 结论 | 依据 |
| --- | --- | --- | --- |
| V7.2.1 | 会话令牌由可信的后端验证 | 不适用 | 没有登录会话和会话令牌；代码里的 sessions 指对话记录（`src/app/store.js`） |
| V7.2.2 | 会话使用动态生成的令牌，不用静态的 API 密钥 | 不适用 | 同上 |
| V7.2.3 | 引用型会话令牌唯一，由 CSPRNG 生成，至少 128 位熵 | 不适用 | 同上 |
| V7.2.4 | 认证（包括再次认证）时生成新的会话令牌并终止旧令牌 | 不适用 | 同上 |
| V7.4.1 | 会话终止（退出或过期）后不能再使用 | 不适用 | 同上 |
| V7.4.2 | 账户被禁用或删除时终止其全部会话 | 不适用 | 同上 |

## V8 授权（Authorization）

| 编号 | 要求 | 结论 | 依据 |
| --- | --- | --- | --- |
| V8.1.1 | 授权文档规定功能级和数据级的访问规则 | 不适用 | 没有服务端资源，也没有多个使用者之间要隔离的数据；Agent 的文件访问范围见 V5.3.2 |
| V8.2.1 | 功能级访问只开放给有明确权限的使用者 | 不适用 | 同上 |
| V8.2.2 | 数据级访问只开放给对该数据有明确权限的使用者（防 IDOR、BOLA） | 不适用 | 同上 |
| V8.3.1 | 在可信的服务层执行授权，不依赖客户端可改动的控制 | 不适用 | 同上 |

## V9 自包含令牌（Self-contained Tokens）

| 编号 | 要求 | 结论 | 依据 |
| --- | --- | --- | --- |
| V9.1.1 | 自包含令牌在使用前校验签名或 MAC | 不适用 | 不签发、不接收 JWT 等自包含令牌 |
| V9.1.2 | 签发和校验令牌只允许列表内的算法，不允许 `None` | 不适用 | 同上 |
| V9.1.3 | 校验令牌的密钥来自预先配置的可信来源，`jku`、`x5u`、`jwk` 要校验 | 不适用 | 同上 |
| V9.2.1 | 令牌带有效期时只在有效期内接受，例如校验 `nbf`、`exp` | 不适用 | 同上 |

## V10 OAuth 和 OIDC（OAuth and OIDC）

| 编号 | 要求 | 结论 | 依据 |
| --- | --- | --- | --- |
| V10.4.1 | 授权服务器按预先登记的重定向 URI 精确匹配 | 不适用 | 不是 OAuth 授权服务器，也不使用 OAuth 或 OIDC |
| V10.4.2 | 授权码只能使用一次，重复使用时拒绝并撤销相关令牌 | 不适用 | 同上 |
| V10.4.3 | 授权码短时有效，L1 最长 10 分钟 | 不适用 | 同上 |
| V10.4.4 | 客户端只能使用需要的授权类型，不再使用 implicit 和 password | 不适用 | 同上 |
| V10.4.5 | 防止公共客户端的刷新令牌重放，L1 可以用刷新令牌轮换 | 不适用 | 同上 |

## V11 密码学（Cryptography）

| 编号 | 要求 | 结论 | 依据 |
| --- | --- | --- | --- |
| V11.3.1 | 不使用 ECB 等不安全的分组模式和 PKCS#1 v1.5 等弱填充 | 不适用 | 代码不做加解密；传输加密由 TLS 完成，见 V12 |
| V11.3.2 | 只使用 AES-GCM 等认可的算法和模式 | 不适用 | 同上 |
| V11.4.1 | 加密用途只使用认可的哈希函数，不用 MD5 等 | 不适用 | 没有签名、HMAC、密钥派生等加密用途的哈希；`src/file-tree/git-status.js` 用 SHA-1 按 git 对象格式计算哈希，只用来判断文件是否改动 |

## V12 安全通信（Secure Communication）

| 编号 | 要求 | 结论 | 依据 |
| --- | --- | --- | --- |
| V12.1.1 | 只启用 TLS 1.2、1.3 等推荐版本，优先最新版本 | 满足 | 线上检查：TLS 1.0、1.1 被拒绝，TLS 1.2、1.3 可用，默认协商 TLS 1.3；`deploy/caret.Caddyfile` 没有改动 Caddy 的默认 TLS 设置 |
| V12.2.1 | 客户端与对外 HTTP 服务之间都用 TLS，不回退到明文 | 满足 | HTTP 请求 308 跳转到 HTTPS，并有 HSTS；CSP 的 `connect-src` 只放行 HTTPS 和本机地址，内置模型服务都是 HTTPS 地址（`src/app/constants.js`） |
| V12.2.2 | 对外服务使用公开信任的证书 | 满足 | 证书由 Let's Encrypt 签发，Caddy 自动续期（线上检查，有效期到 2027-01-30） |

## V13 配置（Configuration）

| 编号 | 要求 | 结论 | 依据 |
| --- | --- | --- | --- |
| V13.4.1 | 部署时不带 `.git` 等版本控制元数据，或外部和应用都无法访问 | 满足 | `deploy/release.sh` 用 `git archive` 按文件清单打包，发布内容不含 `.git`；发布验收确认 `/.git/config` 返回 404 |

## V14 数据保护（Data Protection）

| 编号 | 要求 | 结论 | 依据 |
| --- | --- | --- | --- |
| V14.2.1 | 敏感数据只放在请求体或请求头，不放在 URL 和查询字符串 | 满足 | API Key 放在 `Authorization` 请求头，需求和文件内容放在 POST 请求体，请求地址只有配置的地址和固定路径（`src/agent/model.js`）；站点的网址参数只有 `theme`、`lang`；README 写明访问日志不含网址参数（日志片段在服务器的 Caddy 主配置里） |
| V14.3.1 | 客户端或会话结束后清除客户端存储里的认证数据 | 不适用 | 没有登录和会话，也就没有登录后才能得到的数据。API Key、设置和对话记录按设计保存在 IndexedDB，使用者可以清除 Key、关闭保存对话记录，或在设置的数据页清除全部本地数据（`src/settings/data-page.js`） |

## V15 安全编码和架构（Secure Coding and Architecture）

| 编号 | 要求 | 结论 | 依据 |
| --- | --- | --- | --- |
| V15.1.1 | 文档按风险规定第三方组件漏洞的修复时限和常规更新周期 | 满足 | 见下文「第三方组件」；`deploy/release.sh` 在上传前查询 OSV，Monaco 有已知漏洞时停止发布 |
| V15.2.1 | 组件没有超过文档规定的更新和修复时限 | 满足 | 唯一的第三方代码是 Monaco 0.52.2（2024-12 发布，npm 最新为 0.57.0）。2026-11-03 查询 OSV 没有它的已知漏洞，按「第三方组件」的周期，下次检查在 2027 年 2 月 3 日前 |
| V15.3.1 | 只返回数据对象中需要的字段 | 不适用 | 没有返回数据对象的接口，服务器只发送静态文件 |

## 第三方组件

供 V15.1.1、V15.2.1 对照。

| 组件 | 位置 | 检查方式 |
| --- | --- | --- |
| Monaco Editor | `vendor/monaco-<版本>/` | 每次发布前 `deploy/release.sh` 按版本查询 OSV，有已知漏洞时停止发布 |
| vscode-codicons | `css/codicons/` | 只有图标字体和样式，不含脚本，升级 Monaco 时一起检查 |

- 修复时限：严重和高危漏洞 7 天内升级或移除组件，中危 30 天内，低危 90 天内。暂时不能升级时，在本节写明豁免理由和到期日，到期前重新评估。
- 常规更新：没有已知漏洞时，每个季度检查一次新版本和更新说明，下次在 2027 年 2 月 3 日前。新版本修了安全问题时，按上面的时限升级。

## 输入校验规则

按代码整理，供 V2.1.1 对照。

- 工具调用：工具名只接受 `read`、`write`、`edit`；参数必须是合法的 JSON；`write` 的 `content` 和 `edit` 的 `old`、`new` 必须是字符串；`edit` 的 `old` 必须只匹配一处，设置 `all` 时才替换全部（`src/agent/agent.js`、`src/agent/tools.js`）。
- 路径：统一成 `/` 分隔的项目内相对路径，去掉 `.` 和空段；含 `..` 时拒绝；任何层级的 `.git`、`.intent` 拒绝，不区分大小写（`normalizePath`）。
- 文件：`.env`、私钥、证书和常见登录凭据等密钥文件不读取、不修改、不进入搜索结果（`SECRET_FILE`）；Agent 从磁盘读取时，超过 2 MB 的文件和不是 UTF-8 文本的文件不读取（`src/file-tree/file-manager.js`）。
- 网址参数：`theme` 只接受 `light`、`dark`，`lang` 只接受 `zh`、`en`，其他值忽略（`src/app/preferences.js`）。
- 模型服务地址：内置服务使用固定的 HTTPS 地址（`src/app/constants.js`）；自定义地址由使用者填写，浏览器按 CSP 的 `connect-src` 只放行 HTTPS 和本机地址。
- 模型回复里的链接：只有 `http`、`https`、`mailto` 生成链接，其他按文字显示（`src/chat/markdown.js`）。
