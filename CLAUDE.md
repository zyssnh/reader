# Reader — Claude Code 工作守则

## 强制初始化
每次新对话开始，必须先 Read file: src/styles/tokens.css，再响应任何代码请求。

## 样式铁律
- 所有颜色、字号、间距、字体：只能引用 tokens.css 中的 CSS 变量
- 禁止在任何文件中出现硬编码十六进制值（如 #0d1117）或硬编码 px 字号
- 禁止引入任何 UI 组件库（shadcn、DaisyUI、Tailwind 组件等）
- 主题切换通过 [data-theme] 属性切换 :root 变量，不得用 JS 直接改颜色

## 组件规范
- 圆角：var(--radius)
- 边框：1px solid var(--border)
- 过渡：transition: all 0.15s ease
- 滚动条：4px 宽，颜色 var(--text-muted)
- UI 标签字体：var(--font-mono)，小写，letter-spacing: 0.06em

## 技术约束
- Astro 5.x + TypeScript 严格模式，禁止 any
- 脚本文件必须有 JSDoc 注释
- 错误必须有 UI 层提示，不能只 console.error
