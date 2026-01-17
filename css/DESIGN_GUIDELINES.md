# Caret 样式设计规范

## 颜色系统

**可用变量：**
- `--bg-1` 到 `--bg-7`（灰阶背景）
- `--text-1` 到 `--text-7`（灰阶文字）
- `--color-red`, `--color-yellow`, `--color-blue`, `--color-green`（功能色）
- `--bg-red-dim`, `--bg-yellow-dim`, `--bg-blue-dim`, `--bg-green-dim`（功能色背景）

**区域背景层级：**
- `--bg-1`：Editor、Sidebar
- `--bg-2`：Chat、File Tree
- `--bg-3`：菜单、次级容器

**交互状态：** hover/active 背景色比所在区域高一级（如 `--bg-2` → `--bg-3`）

**限制：** 禁止硬编码颜色值，禁止创建新颜色变量，禁止使用非相邻层级背景色

## 按钮系统

**基础类：** `.btn`（所有按钮必须继承）

**修饰类：**
- `.btn i`： - 按钮图标 (icon-size: 20px)
- `.btn-text` - 文本按钮（padding: 8px 14px，font-size: 12px）
- `.btn-small` - 小按钮（padding: 4px 8px，font-size: 12px）
- `.btn-close` - 关闭按钮（24px × 24px, icon-size: 16px）

**限制：** 禁止创建新按钮样式类，必须使用 `.btn` + 修饰类

## 菜单系统

**基础类：** `.popup-menu`（所有菜单必须使用）

**菜单项：** `.menu-item-editable`、`.menu-item-label`、`.menu-item-input`

**限制：** 禁止创建新菜单样式类，统一使用 `.popup-menu`

## 交互规范

- 扁平化设计（禁止阴影、边框、active高亮边框、圆角）
- 可交互按钮的背景色与所在区域背景一致
- hover 状态只改变背景色，背景色比元素所在区域的背景色高一级，不改变文本色
- 不使用 active 状态

## 文本规范

- 所有显示文本暂时采用 English
- 文件注释可以用中文