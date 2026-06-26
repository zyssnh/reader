# Reader — 极客书房

极客风格电子书阅读器，支持 EPUB / TXT，PWA 离线可用，部署在 GitHub Pages。

**线上地址**：[zyssnh.github.io/reader](https://zyssnh.github.io/reader/)

## 特性

- **双页面架构**：书架主页（卡片网格）+ 阅读页（三栏布局）
- **EPUB 解析**：JSZip 直接解压，支持 EPUB 2.x / 3.x，命名空间自适应
- **TXT 解析**：11 种章节标题格式自动检测，装饰符号自动清理
- **Hash 去重**：SHA-256（前 64KB），重复文件不存储
- **4 主题**：暗黑 / 明亮 / 护眼 / 黑客
- **每书独立样式**：字号、行距、字体、宽度、缩进、竖排
- **IndexedDB 持久化**：刷新恢复进度、书签、高亮、设置
- **PWA 离线**：Service Worker Cache-First，可添加到手机主屏幕
- **键盘快捷键**：← → 翻章、B 书签、F 全屏
- **选中工具栏**：4 色高亮、书签、复制

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | [Astro 5](https://astro.build/) |
| 类型 | TypeScript strict |
| 存储 | IndexedDB ([idb](https://github.com/jakearchibald/idb)) |
| EPUB | [JSZip](https://stuk.github.io/jszip/) |
| 部署 | GitHub Pages + Actions |
| PWA | Service Worker + Web App Manifest |

## 本地运行

```bash
npm install
npm run dev    # http://localhost:4321/reader
npm run build  # 构建到 dist/
```

## 项目结构

```
src/
├── types/index.ts                共享类型
├── styles/tokens.css             CSS 变量（4 主题）
├── scripts/
│   ├── storage.ts                IndexedDB（去重 + 每书样式）
│   ├── book-style.ts             样式加载/应用
│   └── parsers/
│       ├── epub.ts               JSZip 直接解析
│       └── txt.ts                11 种章节检测
├── components/
│   ├── shelf/                    书架页组件
│   └── reader/                   阅读页组件
└── pages/
    ├── index.astro               书架主页 /
    └── read.astro                阅读页 /read?id=xxx
```

## 部署

Push 到 `main` 分支，GitHub Actions 自动构建部署到 GitHub Pages。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
