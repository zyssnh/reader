# 样式系统

## 设计原则

1. **CSS 变量单一来源**: `src/styles/tokens.css` 定义所有颜色/字号/间距/字体
2. **禁止硬编码**: 任何文件中不得出现十六进制颜色值或数字 px 字号
3. **主题切换**: 通过 `[data-theme]` 属性覆盖 `:root` 变量
4. **样式隔离**: 书籍内容通过 `contain: layout style` 隔离，不影响 App 外壳

## 主题变量

### 4 种内置主题

| 主题 | data-theme | 特点 |
|------|-----------|------|
| 暗黑 | `dark` (默认) | GitHub 风格深色，蓝绿强调 |
| 明亮 | `light` | GitHub 风格浅色 |
| 护眼 | `sepia` | 暖黄底色，低对比度 |
| 黑客 | `hacker` | 纯黑底绿字，终端风格 |

### 变量清单

```css
/* 背景层级 */
--bg-base       /* 页面底色       #0d1117 (dark) */
--bg-surface    /* 面板/顶栏底色   #161b22 */
--bg-card       /* 卡片底色       #21262d */

/* 边框 */
--border        /* 默认边框       #30363d */
--border-strong /* 强调边框       #484f58 */

/* 强调色 */
--accent-blue   /* 蓝 #58a6ff — 主要交互 */
--accent-green  /* 绿 #3fb950 — 成功/进度 */
--accent-amber  /* 黄 #e3b341 — 高亮/书签 */
--accent-red    /* 红 #f85149 — 错误/删除 */

/* 文字 */
--text-primary    /* 主文字 #e6edf3 */
--text-secondary  /* 次文字 #8b949e */
--text-muted      /* 弱文字/滚动条 #484f58 */

/* 字体栈 */
--font-mono   /* 等宽: JetBrains Mono → Fira Code → Cascadia Code */
--font-serif  /* 衬线: Georgia → Noto Serif SC → Source Han Serif */
--font-sans   /* 无衬线: -apple-system → PingFang SC → Microsoft YaHei */

/* 尺寸 */
--radius      /* 圆角 6px */
--space-1/2/3/4/6/8  /* 间距 4/8/12/16/24/32px */
--reader-width /* 默认阅读宽度 640px（可被每书样式覆盖） */
```

## 每书阅读样式

阅读页通过 `book-style.ts` 管理每本书独立的 CSS 变量：

```css
/* 由 applyStyle() 注入 :root */
--font-size: 18px;          /* 14-26，step 1 */
--line-height: 1.8;         /* 1.4-2.2，step 0.1 */
--para-spacing: 1.2em;      /* 0.5-2.0，step 0.1 */
--reader-font: var(--font-sans);  /* sans | serif | mono */
--reader-width: 640px;      /* 480 | 640 | 800 */
--text-indent: 0;           /* 0 | 2em */
```

### 隔离机制

```css
/* Content.astro — 书籍内容容器 */
.read-content {
  contain: layout style;          /* 样式不泄露到外部 */
  column-count: 1 !important;     /* 强制单列 */
  columns: unset !important;      /* 清除任何多列设置 */
}

/* index.astro — 卡片网格 */
.shelf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
}
```

## 书籍卡片样式

卡片通过 `renderCard()` 动态生成，样式定义在 `index.astro` 的全局 `<style is:global>` 中：

```
┌──────────────┐
│   封面区域    │  160px宽 × 2:3 比例
│   (图片 或   │  无封面：渐变色 + 书名首字
│   渐变色)    │  渐变色基于 book.id hash
├──────────────┤
│ 书名         │  14px 粗体，单行省略
│ 作者 · EPUB  │  10px mono，格式标签
│ ██████░░ 34% │  进度条 + 百分比
└──────────────┘
  hover: translateY(-4px) + box-shadow
```

### 响应式

```css
@media (max-width: 768px) {
  .toc-panel    { position: fixed; transform: translateX(-100%); }
  .toc-panel.open { transform: translateX(0); }
  .style-panel  { position: fixed; transform: translateX(100%); }
  .style-panel.open { transform: translateX(0); }
}
```

小屏设备上 TOC 和样式面板以抽屉形式滑入，叠加在内容上方。

## PWA / iOS 适配

```html
<!-- 独立窗口模式 -->
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<!-- 状态栏黑色 -->
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<!-- theme-color 跟随主题切换 -->
<meta name="theme-color" content="#161b22" id="meta-theme-color">
```

theme-color 通过 JS 在亮暗切换时同步更新：
- dark: `#161b22` (顶栏底色)
- light: `#ffffff`
