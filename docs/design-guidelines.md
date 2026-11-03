# Caret 样式设计规范

## 颜色系统

**可用变量：**
- `--bg-1` 到 `--bg-7`（灰阶背景）
- `--text-1` 到 `--text-7`（灰阶文字）
- `--color-red`, `--color-yellow`, `--color-blue`, `--color-green`（功能色）
- `--bg-red-dim`, `--bg-yellow-dim`, `--bg-blue-dim`, `--bg-green-dim`（功能色背景）
- `--accent`（品牌橙，用于标志和图形），`--accent-text`（需要阅读的橙色小字）
- `--diff-*`（Diff 配色，Monaco 只接受十六进制）

所有变量在 `theme.css` 里同时定义深色和浅色取值。

**区域背景层级：**
- `--bg-1`：Editor、Sidebar
- `--bg-2`：Agent 面板、File Tree、对话框
- `--bg-3`：输入区、改动列表、次级容器

**交互状态：** hover/active 背景色比所在区域高一级（如 `--bg-2` → `--bg-3`）

**限制：** 禁止硬编码颜色值，新增颜色变量必须同时给出两个主题的取值。文字在 `--bg-1` 到 `--bg-4` 上的对比度不低于 4.5:1，图标和焦点框不低于 3:1，改色值后要重新核对

## 按钮系统

**基础类：** `.btn`（所有按钮必须继承）

**修饰类：**
- `.btn-text` - 文本按钮
- `.btn-text-chat` - 面板内的次要文本按钮
- `.btn-primary` - 主按钮，每个区域最多一个
- `.btn-close` - 小图标按钮（24px × 24px，icon-size: 16px）
- `.is-loading` - 等待状态，点击后立刻显示

## 表单与菜单

- 输入框、分段选择和胶囊开关的样式在 `controls.css`，下拉菜单和说明提示在 `popups.css`
- 下拉菜单统一用 `#select-menu`，说明提示统一用 `#tooltip`，不使用浏览器默认样式
- 说明按钮 `.info` 在任何状态下都不加底色、描边或阴影；悬停、键盘聚焦和展开时只把 i 从 `--text-5` 变成 `--text-1`，悬停样式放在 `@media (hover: hover)` 里
- 设置里的单行设置用 `.setting-row`，布尔项用 `.switch`，控件带上 `data-setting` 后由 `settings.js` 统一读写

## 交互规范

- 扁平化设计（禁止边框、圆角；只有浮层可以用 `--popup-shadow`）
- 可交互按钮的背景色与所在区域背景一致
- hover 状态只改变背景色，背景色比元素所在区域的背景色高一级，不改变文本色
- 长内容放进固定高度的容器内部滚动，只滚动容器，不滚动页面
- 能滚动的列表下方还有内容时，底部渐隐（`base.css` 里的 `--scroll-fade`），新增滚动列表时加进同一组选择器
- 对话框只用 `theme.css` 里的两档尺寸：确认框用 `--dialog-small-*`，设置用 `--dialog-large-*`。外框高度固定，长内容在正文里滚动，按钮留在底部

## 文本规范

- 所有显示文本放在 `src/i18n/zh.js` 和 `src/i18n/en.js`，两个文件同时修改
- 文件注释可以用中文
