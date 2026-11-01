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

**限制：** 禁止硬编码颜色值，新增颜色变量必须同时给出两个主题的取值

## 按钮系统

**基础类：** `.btn`（所有按钮必须继承）

**修饰类：**
- `.btn-text` - 文本按钮
- `.btn-text-chat` - 面板内的次要文本按钮
- `.btn-primary` - 主按钮，每个区域最多一个
- `.btn-close` - 小图标按钮（24px × 24px，icon-size: 16px）
- `.is-loading` - 等待状态，点击后立刻显示

## 表单与菜单

- 输入框、下拉菜单和分段选择的样式都在 `settings.css`
- 下拉菜单统一用 `#select-menu`，说明提示统一用 `#tooltip`，不使用浏览器默认样式

## 交互规范

- 扁平化设计（禁止边框、圆角；只有浮层可以用 `--popup-shadow`）
- 可交互按钮的背景色与所在区域背景一致
- hover 状态只改变背景色，背景色比元素所在区域的背景色高一级，不改变文本色
- 长内容放进固定高度的容器内部滚动，只滚动容器，不滚动页面

## 文本规范

- 所有显示文本放在 `src/global/i18n.js`，同时提供简体中文和英文
- 文件注释可以用中文
