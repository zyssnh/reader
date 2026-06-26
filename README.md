# Reader — 极客书房

极客风格电子书阅读器，支持 EPUB / TXT，PWA 离线可用，部署在 GitHub Pages。

**[📖 打开阅读器](https://zyssnh.github.io/reader/)**

## ✨ 特性

- **📚 双格式支持** — EPUB 2.x / 3.x + TXT，JSZip 直接解压，无需后端
- **🧠 智能解析** — 11 种 TXT 章节格式自动检测；OPF 命名空间自适应
- **🔒 Hash 去重** — SHA-256 前 64KB，重复文件拒绝导入
- **🎨 4 主题** — 暗黑 / 明亮 / 护眼（Sepia）/ 黑客（终端绿）
- **📝 每书独立样式** — 字号(14-26)、行距、段落间距、字体、宽度、缩进、竖排
- **💾 全持久化** — IndexedDB 存储书籍+进度+书签+高亮+样式，刷新不丢失
- **📱 PWA** — Service Worker 离线缓存，添加到主屏幕像原生 App
- **⌨️ 键盘操作** — ←→ 翻章 / B 书签 / F 全屏 / 选中浮动工具栏
- **🌓 自动主题** — 首页支持暗/亮切换，首次跟随系统偏好

## 🚀 快速开始

```bash
git clone https://github.com/zyssnh/reader.git
cd reader
npm install
npm run dev     # → http://localhost:4321/reader
```

## 📖 文档

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构总览、组件树、数据流、路由设计 |
| [STORAGE.md](docs/STORAGE.md) | IndexedDB Schema、API 参考、去重机制 |
| [PARSERS.md](docs/PARSERS.md) | EPUB/TXT 解析器原理、命名空间处理、章节检测 |
| [STYLING.md](docs/STYLING.md) | 主题系统、CSS 变量清单、样式隔离、PWA 适配 |

## 🏗️ 项目结构

```
src/
├── types/index.ts              共享类型定义（BookMeta, BookStyle, Chapter, Bookmark, Highlight）
├── styles/tokens.css           单一真相源 — 4 主题 CSS 变量 + 全局 Reset
├── scripts/
│   ├── storage.ts              IndexedDB CRUD（5 store, hash 索引去重, 级联删除）
│   ├── book-style.ts           每书样式加载/应用/更新，CSS 变量注入 :root
│   └── parsers/
│       ├── epub.ts             JSZip 解压 → OPF 解析（nsQuery 命名空间安全）→ XHTML 渲染
│       └── txt.ts              11 种正则章节检测 → 标题清理 → HTML 段落生成
├── components/
│   ├── shelf/                  书架页：BookCard（封面+进度） ImportBtn MetaEditor
│   └── reader/                 阅读页：Topbar TocPanel Content（contain隔离） StylePanel
└── pages/
    ├── index.astro             书架主页 / （卡片网格 + 全局拖拽 + 主题切换）
    └── read.astro              阅读页 /read?id=xxx（三栏布局 + 浮动工具栏 + 快捷键）
```

## 🛠️ 技术栈

| 层 | 技术 | 用途 |
|---|---|---|
| 框架 | Astro 5 + TypeScript strict | 静态生成 + 客户端交互 |
| EPUB | JSZip + DOMParser | 直接解压 ZIP，不依赖 epubjs |
| 存储 | IndexedDB via idb | 书籍/章节/样式/书签/高亮 |
| PWA | Service Worker (Cache-First) + Web App Manifest | 离线可用 |
| 部署 | GitHub Pages + Actions | 零成本，push 即部署 |

## 🔧 快捷键

| 键 | 功能 |
|----|------|
| `←` `→` | 上一章 / 下一章 |
| `B` | 添加书签 |
| `F` | 切换全屏 |
| 选中文字 | 浮动工具栏（4 色高亮 / 书签 / 复制）|

## 📦 部署

Push 到 `main` 分支 → GitHub Actions 自动构建 → 部署到 GitHub Pages。

⚠️ 部署前确保仓库 Settings → Pages → Build and deployment → Source = **GitHub Actions**。

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
