# 架构文档

## 概述

Reader 是一个纯前端电子书阅读器，基于 Astro 5 构建，部署在 GitHub Pages。没有任何后端服务——所有数据存储在浏览器 IndexedDB 中。

## 页面路由

```
/                  → src/pages/index.astro   书架主页
/read?id={bookId}  → src/pages/read.astro    阅读页
```

两个页面是**完全独立的 Astro 页面**，通过 URL 参数传递书籍 ID。不是 SPA——每次导航是完整的页面加载。

```
┌────────────────────────────────────────────────────────────┐
│  / (index.astro)                                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Topbar  [☀]  [+ 导入]                               │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │  最近阅读                                              │  │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐               │  │
│  │  │ Card │ │ Card │ │ Card │ │ Card │  ...           │  │
│  │  └──────┘ └──────┘ └──────┘ └──────┘               │  │
│  │  全部书籍                                              │  │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ...                     │  │
│  │  │ Card │ │ Card │ │ Card │                         │  │
│  │  └──────┘ └──────┘ └──────┘                         │  │
│  └──────────────────────────────────────────────────────┘  │
│  [MetaEditor 弹窗]                                         │
│  [DropOverlay 拖拽遮罩]                                    │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│  /read?id=xxx (read.astro)                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Topbar  [←书架]  书名  进度 2/1242  [目录] [样式]    │  │
│  ├────────┬───────────────────────────────┬─────────────┤  │
│  │ TOC    │ Content                       │ StylePanel  │  │
│  │ 220px  │ flex:1                        │ 260px       │  │
│  │        │                               │             │  │
│  │ 章1  ◄─│─── 第一章 标题 ───            │ 主题 ▦▦    │  │
│  │ 章2    │                               │ ▦▦         │  │
│  │ 章3    │ 段落正文内容...               │ 字号 ====●  │  │
│  │ 章4    │                               │ 行距 ====●  │  │
│  │        │                               │ 字体 [S][R] │  │
│  └────────┴───────────────────────────────┴─────────────┤  │
│  [FloatToolbar 选中工具栏]                                │  │
└────────────────────────────────────────────────────────────┘
```

## 组件树

```
index.astro
├── ImportBtn          (右上角导入按钮)
├── MetaEditor         (元数据编辑弹窗)
└── (JS 动态渲染)
    ├── BookCard × N   (renderCard() 生成 HTML 字符串)
    └── DropOverlay    (全局拖拽遮罩)

read.astro
├── Topbar             (返回/书名/进度/工具栏)
├── TocPanel           (左侧目录面板)
├── Content            (中央阅读区)
├── StylePanel         (右侧样式面板)
└── FloatToolbar       (JS 动态创建，选中文字时出现)
```

## 数据流

### 导入流程

```
File (.epub/.txt)
  │
  ├─→ calcHash(file)           SHA-256 前 64KB
  │     │
  │     └─→ findByHash(hash)   已存在？→ Toast 提示，跳过
  │
  ├─→ parseEpub(file)           或 parseTxt(text, name)
  │     │
  │     ├─→ { title, author, cover?, chapters[] }
  │     │
  │     ├─→ saveBook(meta)      → IndexedDB.books
  │     └─→ saveChapters(list)  → IndexedDB.chapters
  │
  └─→ renderShelf()             刷新卡片网格
```

### 阅读流程

```
read.astro 加载
  │
  ├─→ getBook(id)              → 元数据 + 进度信息
  ├─→ getChapters(id)          → 章节列表（按 index 排序）
  ├─→ loadStyle(id)            → 该书的样式设置
  │     └─→ applyStyle()        → CSS 变量注入 :root
  │
  ├─→ renderChapter(0)          → 渲染第一章
  │     或 renderChapter(进度)   → 恢复到上次位置
  │
  └─→ scroll 事件
        └─→ debounce 1s
              └─→ updateProgress(id, chapterId, scrollY)
```

### 样式变更流程

```
StylePanel 控件操作
  │
  ├─→ updateStyle(bookId, { fontSize: 20 })
  │     │
  │     ├─→ applyStyle(newStyle)    更新 CSS 变量
  │     └─→ saveBookStyle(style)    持久化到 IndexedDB
  │
  └─→ syncStyleUI()                 刷新面板控件状态
```

## 模块依赖

```
types/index.ts          (零依赖，纯类型定义)
    ↑
    ├── storage.ts      → idb
    ├── book-style.ts   → storage.ts
    ├── parsers/epub.ts → JSZip
    ├── parsers/txt.ts  (零依赖)
    │
    └── pages/*.astro   → storage.ts, book-style.ts, parsers/*
            ↑
            └── components/**/*.astro
```

## 错误处理策略

| 场景 | 处理方式 |
|------|---------|
| 文件格式不支持 | Toast 提示，3 秒消失 |
| EPUB OPF 命名空间 | `nsQuery()` local-name 回退 |
| EPUB XHTML 解析失败 | `text/html` 宽松回退 → 纯文本转 `<p>` |
| EPUB spine 为空 | Fallback: 遍历 ZIP 中所有 XHTML |
| 单章节保存失败 | 跳过该章，其他继续，console.warn |
| IndexedDB 不可用 | console.warn，功能降级 |
| 书籍不存在 | Toast + 2秒后跳转书架 |
| 所有章节内容为空 | 友好提示"EPUB 解析未能提取正文" |
| 存储配额不足 | 导入前检查 + 模态框提示 |
