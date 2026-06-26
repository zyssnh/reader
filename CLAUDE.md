# Reader v2 — Claude Code 工作守则

## 强制初始化
每次新对话，必须先执行：
1. Read file: src/styles/tokens.css
2. Read file: src/types/index.ts
然后再响应任何代码请求。

## 样式铁律
- 颜色/字号/间距：只能用 tokens.css 的 CSS 变量
- 禁止硬编码十六进制或 px 字号
- 禁止引入任何 UI 组件库
- 每本书的样式通过 data-book-id 属性隔离，不影响全局

## 架构铁律
- 书架页（/）和阅读页（/read?id=xxx）必须是两个独立的 .astro 文件
- 所有数据操作通过 storage.ts 的函数，禁止直接操作 IndexedDB
- 书籍去重：上传时计算文件前 64KB 的 hash，相同 hash 不重复存储
