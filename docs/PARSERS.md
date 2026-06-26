# 解析器

## EPUB 解析器 (`src/scripts/parsers/epub.ts`)

### 技术方案

使用 **JSZip** 直接解压 EPUB 文件（EPUB 本质是 ZIP 压缩包），不依赖 epubjs 运行时。避免了 epubjs 在 Vite/SSG 环境下的兼容问题。

### 解析流程

```
File (.epub)
  │
  ├─→ JSZip.loadAsync(file)
  │
  ├─→ META-INF/container.xml          找到 OPF 路径
  │
  ├─→ *.opf                           解析元数据 + spine + manifest
  │     │
  │     ├─ nsQuery('metadata > title')    书名（命名空间安全）
  │     ├─ nsQuery('metadata > creator')  作者
  │     ├─ meta[name="cover"]             封面 → base64
  │     ├─ nsQueryAll('spine > itemref')  spine 顺序
  │     ├─ nsQueryAll('manifest > item')  id→href 映射
  │     └─ parseToc()                     目录（NAV / NCX）
  │
  ├─→ 逐个读取 spine 中的章节文件
  │     │
  │     ├─ parseSectionHtml(raw)          XHTML → (回退) text/html
  │     ├─ 清理 script/style/head
  │     ├─ 提取 body.innerHTML 为 content
  │     ├─ body 为空 → 取 textContent 转 <p>
  │     └─ 标题: TOC优先 → h1 → h2 → h3 → <title>
  │
  └─→ spine 为空? → fallbackExtract()
        └─→ 遍历 ZIP 中所有 .xhtml/.html/.htm
```

### 命名空间处理

EPUB OPF 文件声明 `xmlns="http://www.idpf.org/2007/opf"`，导致 `querySelector('spine > itemref')` 返回空。`nsQuery()` 自动生成命名空间安全的 `local-name()` 选择器：

```typescript
// 输入: "spine > itemref"
// 输出: "*[local-name()='spine'] > *[local-name()='itemref']"
```

### XHTML 兼容性

```typescript
// 1. 先试严格的 application/xhtml+xml
const doc = parser.parseFromString(raw, 'application/xhtml+xml');
// 2. 有 parsererror → 用 text/html 回退
if (doc.querySelector('parsererror')) {
  doc = parser.parseFromString(raw, 'text/html');
}
// 3. body 还是空 → textContent 转 <p> 段落
```

### TOC 解析

支持两种目录格式：
- **EPUB 3**: `<nav epub:type="toc">` 中的 `<a>` 标签
- **EPUB 2**: NCX 文件的 `<navPoint>` 元素（也做了命名空间处理）

### Fallback 模式

当 spine 提取失败（0 章节），自动遍历 ZIP 中所有 XHTML/HTML/HTM 文件作为章节，按文件名自然排序。

## TXT 解析器 (`src/scripts/parsers/txt.ts`)

### 章节检测

11 种正则模式，按优先级匹配：

| # | 模式 | 示例 |
|---|------|------|
| 1 | `第N章/回/节` | `第一章` `第十二回` |
| 2 | `Chapter N` | `Chapter 1` |
| 3 | `CHAPTER N` | `CHAPTER IV` |
| 4 | `(N)` 括号编号 | `(1)` `（15）` |
| 5 | `N.` 数字编号 | `1、` `2.` |
| 6 | `【】` 方括号 | `【第一章 初入江湖】` |
| 7 | `［］` 全角方括号 | `［卷一］` |
| 8 | 符号编号 | `■` `◆` `●` `▶` |
| 9 | 等号装饰 | `===第一章===` |
| 10 | 短横装饰 | `---第二章---` |
| 11 | 星号装饰 | `**第三章**` |

### 标题清理

```typescript
cleanTitle("===第一章 小小灵娥===")  // → "第一章 小小灵娥"
cleanTitle("【第三章】")              // → "第三章"
```

清理步骤：
1. 去除首尾 `=-*#＝－＊＃` 等装饰符号
2. 去除首尾 `【［（(】［］）)` 等括号
3. trim

### 书名提取

```typescript
"斗破苍穹-精校版.txt"  → "斗破苍穹"
"《凡人修仙传》.txt"    → "凡人修仙传"
"诡秘之主全本.txt"     → "诡秘之主"
```

### 自动分段

章节检测失败时，按 3000 字自动分段，生成"第 N 段"标题。

### HTML 生成

```typescript
// 双换行 = 段落分隔
// 单换行 = 行内 <br> 换行
text
  .split(/\n\n+/)           // 段落
  .map(para =>
    para.split('\n')        // 行
      .map(line => escapeHtml(line))
      .join('<br>')
  )
  .map(html => `<p>${html}</p>`)
```
