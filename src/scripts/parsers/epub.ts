/**
 * EPUB 解析器
 * 使用 JSZip 直接解压，支持 EPUB 2/3。
 *
 * 核心修复：
 * - 命名空间安全查询使用 Element.localName 过滤，
 *   彻底替换有 bug 的 CSS toNsSelector()
 * - NCX navLabel > text 提取不走 CSS，直接用 child search
 * - TOC label 原样保留，永不自动生成
 */
import JSZip from 'jszip';
import type { TocEntry } from '../../types/index';

// ═══════════════════════════════════════════════════
// XML 命名空间安全查询
// ═══════════════════════════════════════════════════

/** 按 localName 取第一个后代（深度优先） */
function childByLocalName(parent: Element, name: string): Element | null {
  for (const c of parent.children) {
    if (c.localName === name) return c;
  }
  return null;
}

/** 按 localName 取所有直接子元素 */
function childrenByLocalName(parent: Element, name: string): Element[] {
  return Array.from(parent.children).filter(c => c.localName === name);
}

/** 深层搜索：按 localName 取所有后代 */
function allByLocalName(parent: Element, name: string): Element[] {
  return Array.from(parent.getElementsByTagName('*')).filter(e => e.localName === name);
}

/** 按路径取第一个匹配: "parent > child" 或 "parent > child > grandchild" */
function queryPath(parent: Element, path: string): Element | null {
  const parts = path.split(/\s*>\s*/);
  let current: Element | null = parent;
  for (const part of parts) {
    if (!current) return null;
    current = childByLocalName(current, part);
  }
  return current;
}

/** 按路径取所有匹配（只支持 "parent > child" 两级） */
function queryPathAll(parent: Element, path: string): Element[] {
  const parts = path.split(/\s*>\s*/);
  if (parts.length === 1) {
    return childrenByLocalName(parent, parts[0]);
  }
  const [first, second] = parts;
  const results: Element[] = [];
  for (const child of childrenByLocalName(parent, first)) {
    results.push(...childrenByLocalName(child, second));
  }
  return results;
}

// ═══════════════════════════════════════════════════
// HTML/XHTML 解析
// ═══════════════════════════════════════════════════

function parseSectionHtml(raw: string): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, 'application/xhtml+xml');
  if (!doc.querySelector('parsererror') && doc.body?.innerHTML.trim()) return doc;
  return parser.parseFromString(raw, 'text/html');
}

/** 从 text/html 模式的 doc 中取 <a> 标签（text/html 下无命名空间，可安全用 CSS） */
function queryA_all(parent: Element): Element[] {
  return Array.from(parent.querySelectorAll('a'));
}

// ═══════════════════════════════════════════════════
// 路径工具
// ═══════════════════════════════════════════════════

function normalizePath(base: string, rel: string): string {
  const cleanRel = rel.split('#')[0];
  if (!cleanRel) return base;

  let resolved: string;
  if (cleanRel.startsWith('/')) {
    resolved = cleanRel.replace(/^\/+/, '');
  } else {
    const baseDir = base.includes('/') ? base.split('/').slice(0, -1).join('/') + '/' : '';
    resolved = baseDir + cleanRel;
  }

  const parts = resolved.split('/');
  const stack: string[] = [];
  for (const p of parts) {
    if (p === '..') stack.pop();
    else if (p !== '.' && p !== '') stack.push(p);
  }
  return stack.join('/');
}

// ═══════════════════════════════════════════════════
// 内部类型
// ═══════════════════════════════════════════════════

interface TocNode {
  label: string;
  href: string;
  children: TocNode[];
  depth: number;
}

export interface EpubChapter {
  id: string;
  href: string;
  title: string;
  content: string;
  index: number;
  depth: number;
}

export interface EpubData {
  title: string;
  author: string;
  cover?: string;
  chapters: EpubChapter[];
  toc: TocEntry[];
}

interface TocSpineMapping {
  spineIndex: number;
  tocTitle: string;
  depth: number;
}

// ═══════════════════════════════════════════════════
// 主解析入口
// ═══════════════════════════════════════════════════

export async function parseEpub(file: File): Promise<EpubData> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // 1. container.xml
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error('无效的 EPUB：缺少 container.xml');

  const opfMatch = containerXml.match(/full-path="([^"]+\.opf)"/)
    ?? containerXml.match(/full-path=['"]([^'"]+\.opf)['"]/);
  if (!opfMatch) throw new Error('找不到 OPF 路径');
  const opfPath = opfMatch[1];
  const opfDir = opfPath.includes('/') ? opfPath.split('/').slice(0, -1).join('/') + '/' : '';

  // 2. 解析 OPF
  const opfXml = await zip.file(opfPath)?.async('string');
  if (!opfXml) throw new Error('无法读取 OPF');
  const opf = new DOMParser().parseFromString(opfXml, 'application/xml');
  if (opf.querySelector('parsererror')) throw new Error('OPF XML 无效');

  // 元数据
  const title = queryPath(opf, 'metadata > title')?.textContent?.trim()
    || file.name.replace(/\.epub$/i, '');
  const author = queryPath(opf, 'metadata > creator')?.textContent?.trim() || '未知作者';

  // 3. 封面
  const cover = await extractCover(zip, opf, opfDir);

  // 4. manifest: id → 完整路径
  const manifestItems = allByLocalName(queryPath(opf, 'manifest')!, 'item');
  const idToHref = new Map<string, string>();
  for (const item of manifestItems) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) idToHref.set(id, normalizePath(opfPath, href));
  }

  // 5. spine 顺序
  const spineEl = queryPath(opf, 'spine');
  const spineRefs = spineEl ? childrenByLocalName(spineEl, 'itemref') : [];
  const spineIds = spineRefs.map(r => r.getAttribute('idref')).filter(Boolean) as string[];

  // 6. 解析层级 TOC 树
  const tocTree = await parseTocTree(zip, opf, opfPath, idToHref, spineIds);

  // 7. href → spineIndex 映射
  const hrefToSpineIndex = new Map<string, number>();
  for (let i = 0; i < spineIds.length; i++) {
    const fp = idToHref.get(spineIds[i]);
    if (fp) hrefToSpineIndex.set(fp, i);
  }

  // 8. TOC → spine 映射
  const tocToSpine = resolveTocTree(tocTree, hrefToSpineIndex);
  const chapterOrder = buildChapterOrder(spineIds, tocToSpine);

  // 9. 读取章节内容
  const chapters: EpubChapter[] = [];
  for (const { spineIndex, tocTitle, depth } of chapterOrder) {
    const idref = spineIds[spineIndex];
    const filePath = idToHref.get(idref) ?? '';
    // 优先 TOC label，其次 spine idref，最后才是自动编号
    const chTitle = tocTitle || idref || `第 ${spineIndex + 1} 章`;
    let content = '';

    try {
      const raw = await zip.file(filePath)?.async('string');
      if (raw) {
        const doc = parseSectionHtml(raw);
        doc.querySelectorAll('script, style, head').forEach(el => el.remove());
        const bodyContent = doc.body?.innerHTML?.trim();
        content = bodyContent || raw;
        if (!bodyContent) {
          const text = doc.body?.textContent?.trim() || raw.replace(/<[^>]+>/g, '').trim();
          if (text) {
            content = text.split(/\n{2,}/).filter(p => p.trim())
              .map(p => `<p>${p.trim()}</p>`).join('\n');
          }
        }
      }
    } catch (err) {
      console.warn(`章节 ${spineIndex} (${idref}) 解析失败:`, err);
    }

    chapters.push({ id: idref, href: filePath, title: chTitle, content, index: spineIndex, depth });
  }

  // 10. spine 为空 → fallback
  if (chapters.length === 0) {
    console.warn('spine 为空，遍历 ZIP');
    const fb = await fallbackExtract(zip);
    if (fb.length > 0) {
      const fbChapters = fb.map((c, i) => ({ ...c, index: i, depth: 0 }));
      const fbToc = fbChapters.map(c => ({ chapterIndex: c.index, title: c.title, depth: 0 }));
      return { title, author, cover, chapters: fbChapters, toc: fbToc };
    }
  }

  // 11. 构建 UI TOC
  const displayToc = buildDisplayToc(tocTree, hrefToSpineIndex, chapterOrder);

  return { title, author, cover, chapters, toc: displayToc };
}

// ═══════════════════════════════════════════════════
// TOC 树解析
// ═══════════════════════════════════════════════════

async function parseTocTree(
  zip: JSZip,
  opf: Document,
  opfPath: string,
  idToHref: Map<string, string>,
  spineIds: string[],
): Promise<TocNode[]> {
  const opfDir = opfPath.includes('/') ? opfPath.split('/').slice(0, -1).join('/') + '/' : '';
  const navMap = allByLocalName(opf, 'manifest').flatMap(m => childrenByLocalName(m, 'item'));

  try {
    // EPUB 3: NAV document (properties 含 "nav")
    const navItem = navMap.find(el => (el.getAttribute('properties') ?? '').includes('nav'));
    if (navItem) {
      const navHref = navItem.getAttribute('href');
      if (navHref) {
        const navPath = normalizePath(opfPath, navHref);
        const navXml = await zip.file(navPath)?.async('string');
        if (navXml) {
          const navDoc = parseSectionHtml(navXml);
          // text/html 模式下可以用 CSS 安全 select
          const tocNav = navDoc.querySelector('nav[epub\\:type="toc"], nav');
          const topOl = tocNav?.querySelector('ol');
          if (topOl) {
            const tree = parseNavOl(topOl, opfDir, 0);
            if (tree.length > 0) return tree;
          }
        }
      }
    }

    // EPUB 2: NCX
    const spineEl = queryPath(opf, 'spine');
    const ncxId = spineEl?.getAttribute('toc');
    if (ncxId) {
      const ncxItem = navMap.find(el => el.getAttribute('id') === ncxId);
      const ncxHref = ncxItem?.getAttribute('href');
      if (ncxHref) {
        const ncxPath = normalizePath(opfPath, ncxHref);
        const ncxXml = await zip.file(ncxPath)?.async('string');
        if (ncxXml) {
          const ncxDoc = new DOMParser().parseFromString(ncxXml, 'application/xml');
          if (!ncxDoc.querySelector('parsererror')) {
            const navMapEl = queryPath(ncxDoc, 'navMap');
            if (navMapEl) {
              // 用 ncxPath 的目录作为 base（NCX 中的 src 相对路径基准）
              const ncxDir = ncxPath.includes('/') ? ncxPath.split('/').slice(0, -1).join('/') + '/' : '';
              const tree = parseNcxNavPoints(navMapEl, ncxDir, 0);
              if (tree.length > 0) return tree;
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('TOC 树解析失败:', err);
  }

  return [];
}

/** EPUB 3 NAV: 递归 <ol> → TocNode[] */
function parseNavOl(ol: Element, baseDir: string, depth: number): TocNode[] {
  const nodes: TocNode[] = [];
  // text/html 模式下 <li> 无命名空间，CSS 安全
  const lis = ol.querySelectorAll(':scope > li');

  for (const li of lis) {
    const a = li.querySelector('a');
    if (!a) continue;

    const href = a.getAttribute('href') ?? '';
    const label = a.textContent?.trim() ?? '';
    if (!label) continue;

    const fullHref = normalizePath(baseDir, href);
    const childOl = li.querySelector(':scope > ol');
    const children = childOl ? parseNavOl(childOl, baseDir, depth + 1) : [];

    nodes.push({ label, href: fullHref, children, depth });
  }
  return nodes;
}

/** EPUB 2 NCX: 递归 <navPoint> → TocNode[] */
function parseNcxNavPoints(parent: Element, ncxDir: string, depth: number): TocNode[] {
  const nodes: TocNode[] = [];
  const navPoints = childrenByLocalName(parent, 'navPoint');

  for (const np of navPoints) {
    // content: <content src="…"/>
    const contentEl = childByLocalName(np, 'content');
    const src = contentEl?.getAttribute('src') ?? '';
    if (!src) continue;

    // label: <navLabel><text>第一章 小小灵娥</text></navLabel>
    const navLabel = childByLocalName(np, 'navLabel');
    const textEl = navLabel ? childByLocalName(navLabel, 'text') : null;
    const label = textEl?.textContent?.trim() ?? '';
    if (!label) continue;

    const fullHref = normalizePath(ncxDir, src);
    const children = parseNcxNavPoints(np, ncxDir, depth + 1);

    nodes.push({ label, href: fullHref, children, depth });
  }
  return nodes;
}

// ═══════════════════════════════════════════════════
// TOC → Spine 映射
// ═══════════════════════════════════════════════════

function resolveTocTree(
  tree: TocNode[],
  hrefToSpineIndex: Map<string, number>,
): TocSpineMapping[] {
  const result: TocSpineMapping[] = [];
  const seen = new Set<number>();

  function walk(nodes: TocNode[]): void {
    for (const node of nodes) {
      const si = hrefToSpineIndex.get(node.href);
      if (si !== undefined && !seen.has(si)) {
        result.push({ spineIndex: si, tocTitle: node.label, depth: node.depth });
        seen.add(si);
      }
      if (node.children.length > 0) walk(node.children);
    }
  }

  walk(tree);
  return result;
}

function buildChapterOrder(
  spineIds: string[],
  tocMapping: TocSpineMapping[],
): TocSpineMapping[] {
  const covered = new Set(tocMapping.map(m => m.spineIndex));
  const result = [...tocMapping];

  for (let i = 0; i < spineIds.length; i++) {
    if (!covered.has(i)) {
      // 未被 TOC 覆盖的章节也用 spine idref 作为标题（而非自动编号）
      const idref = spineIds[i];
      result.push({ spineIndex: i, tocTitle: idref, depth: 0 });
    }
  }

  return result;
}

function buildDisplayToc(
  tree: TocNode[],
  hrefToSpineIndex: Map<string, number>,
  chapterOrder: TocSpineMapping[],
): TocEntry[] {
  const spineToOrderPos = new Map<number, number>();
  chapterOrder.forEach((m, pos) => spineToOrderPos.set(m.spineIndex, pos));

  function convert(nodes: TocNode[]): TocEntry[] {
    const entries: TocEntry[] = [];
    for (const node of nodes) {
      const si = hrefToSpineIndex.get(node.href);
      if (si === undefined) {
        if (node.children.length > 0) entries.push(...convert(node.children));
        continue;
      }

      const orderPos = spineToOrderPos.get(si);
      if (orderPos === undefined) continue;

      const entry: TocEntry = {
        chapterIndex: orderPos,
        title: node.label,
        depth: Math.min(node.depth, 2),
      };

      if (node.children.length > 0) {
        const childEntries = convert(node.children);
        if (childEntries.length > 0) entry.children = childEntries;
      }

      entries.push(entry);
    }
    return entries;
  }

  const tocEntries = convert(tree);

  // TOC 为空：用 chapterOrder 构建平铺目录
  if (tocEntries.length === 0) {
    return chapterOrder.map(m => ({
      chapterIndex: m.spineIndex,
      title: m.tocTitle || `第 ${m.spineIndex + 1} 章`,
      depth: m.depth,
    }));
  }

  return tocEntries;
}

// ═══════════════════════════════════════════════════
// 封面提取
// ═══════════════════════════════════════════════════

async function extractCover(zip: JSZip, opf: Document, opfDir: string): Promise<string | undefined> {
  try {
    const allMeta = allByLocalName(opf, 'meta');
    const coverMeta = allMeta.find(el => el.getAttribute('name') === 'cover');
    const coverId = coverMeta?.getAttribute('content');

    const manifestEl = queryPath(opf, 'manifest');
    const allItems = manifestEl ? childrenByLocalName(manifestEl, 'item') : [];
    let coverItem: Element | null = null;

    if (coverId) {
      coverItem = allItems.find(el => el.getAttribute('id') === coverId) ?? null;
    }
    if (!coverItem) {
      coverItem = allItems.find(el =>
        (el.getAttribute('media-type') ?? '').startsWith('image/')
      ) ?? null;
    }

    const coverHref = coverItem?.getAttribute('href');
    if (coverHref) {
      const fullPath = normalizePath(opfDir, coverHref);
      const coverData = await zip.file(fullPath)?.async('base64');
      const mt = coverItem?.getAttribute('media-type') ?? 'image/jpeg';
      if (coverData) return `data:${mt};base64,${coverData}`;
    }
  } catch { /* ignore */ }
  return undefined;
}

// ═══════════════════════════════════════════════════
// Fallback
// ═══════════════════════════════════════════════════

async function fallbackExtract(zip: JSZip): Promise<Array<{ id: string; href: string; title: string; content: string }>> {
  const chapters: Array<{ id: string; href: string; title: string; content: string }> = [];
  const xhtmlFiles: string[] = [];

  zip.forEach((relativePath) => {
    const lower = relativePath.toLowerCase();
    if (lower.match(/\.(xhtml|html?)$/) && !lower.includes('nav') && !lower.includes('toc')) {
      xhtmlFiles.push(relativePath);
    }
  });

  xhtmlFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  for (let i = 0; i < xhtmlFiles.length; i++) {
    const path = xhtmlFiles[i];
    try {
      const raw = await zip.file(path)?.async('string');
      if (!raw) continue;

      const doc = parseSectionHtml(raw);
      doc.querySelectorAll('script, style, head').forEach(el => el.remove());
      let content = doc.body?.innerHTML?.trim() || '';
      if (!content) {
        const text = doc.body?.textContent?.trim() || raw.replace(/<[^>]+>/g, '').trim();
        if (text) content = text.split(/\n{2,}/).filter(p => p.trim()).map(p => `<p>${p.trim()}</p>`).join('\n');
      }

      const h1 = doc.querySelector('h1')?.textContent?.trim();
      const title = h1 || `第 ${i + 1} 章`;
      chapters.push({ id: `fb-${i}`, href: path, title, content });
    } catch { /* skip */ }
  }
  return chapters;
}
