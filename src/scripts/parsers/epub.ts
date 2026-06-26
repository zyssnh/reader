/**
 * EPUB 解析器 — OCF → OPF → spine → 章节内容 → TOC
 *
 * 严格遵循 EPUB 2.0.1 / EPUB 3.3 规范。
 * API: parseEpub(file: File): Promise<EpubData>
 */
import JSZip from 'jszip';
import type { TocEntry } from '../../types/index';
import * as xml from './xml';
import * as path from './path';

// ═══════════════════════════════════════════════════
// 内部类型
// ═══════════════════════════════════════════════════

interface TocNode {
  readonly label: string;
  readonly href: string;
  readonly children: readonly TocNode[];
  readonly depth: number;
}

interface TocSpineMapping {
  readonly spineIndex: number;
  readonly tocTitle: string;
  readonly depth: number;
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

// ═══════════════════════════════════════════════════
// 调试日志
// ═══════════════════════════════════════════════════

function logGroup(label: string): void {
  console.groupCollapsed(`[EPUB] ${label}`);
}
function logGroupEnd(): void {
  console.groupEnd();
}
function logInfo(kv: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(kv)) {
    console.log(`  ${k}: ${String(v)}`);
  }
}

// ═══════════════════════════════════════════════════
// 主解析入口
// ═══════════════════════════════════════════════════

export async function parseEpub(file: File): Promise<EpubData> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  logGroup(`${file.name}`);
  logInfo({ size: `${(file.size / 1024).toFixed(0)} KB` });

  // ── 1. container.xml → OPF 路径 ──
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) {
    logGroupEnd();
    throw new Error('无效的 EPUB：缺少 META-INF/container.xml');
  }

  const opfMatch =
    containerXml.match(/full-path="([^"]+\.opf)"/) ??
    containerXml.match(/full-path=['"]([^'"]+\.opf)['"]/);
  if (!opfMatch) {
    logGroupEnd();
    throw new Error('container.xml 中找不到 .opf 路径');
  }
  const opfPath = opfMatch[1];
  logInfo({ container: `→ ${opfPath}` });

  // ── 2. 解析 OPF → root Element ──
  const opfXml = await zip.file(opfPath)?.async('string');
  if (!opfXml) {
    logGroupEnd();
    throw new Error('无法读取 OPF');
  }

  const opfRoot = xml.parseXml(opfXml);
  if (!opfRoot) {
    logGroupEnd();
    throw new Error('OPF XML 解析失败');
  }

  // ── 3. 元数据 ──
  const title =
    xml.text(opfRoot, 'metadata > title') ??
    file.name.replace(/\.epub$/i, '');
  const author =
    xml.text(opfRoot, 'metadata > creator') ?? '未知作者';
  logInfo({ title, author });

  // ── 4. 封面 ──
  const cover = await extractCover(zip, opfRoot, opfPath);

  // ── 5. manifest: id → 完整路径（相对于 ZIP 根） ──
  const manifestEl = xml.query(opfRoot, 'manifest');
  const manifestItems = manifestEl ? xml.children(manifestEl, 'item') : [];
  const idToHref = new Map<string, string>();
  for (const item of manifestItems) {
    const id = xml.attr(item, 'id');
    const href = xml.attr(item, 'href');
    if (id && href) {
      idToHref.set(id, path.normalize(opfPath, href));
    }
  }
  logInfo({ manifest: idToHref.size });

  // ── 6. spine ──
  const spineEl = xml.query(opfRoot, 'spine');
  const spineRefs = spineEl ? xml.children(spineEl, 'itemref') : [];
  const spineIds = spineRefs
    .map(r => xml.attr(r, 'idref'))
    .filter((v): v is string => v !== null);
  logInfo({ spine: spineIds.length });

  // ── 7. 解析 TOC 树（NCX 或 NAV） ──
  const tocTree = await parseTocTree(zip, opfRoot, opfPath, manifestItems);

  // ── 8. TOC → spine 映射 ──
  const hrefToSpineIndex = new Map<string, number>();
  for (let i = 0; i < spineIds.length; i++) {
    const fp = idToHref.get(spineIds[i]);
    if (fp) hrefToSpineIndex.set(fp, i);
  }

  const tocToSpine = resolveTocTree(tocTree, hrefToSpineIndex);
  const chapterOrder = buildChapterOrder(spineIds, tocToSpine);

  // ── 9. 读取章节内容 ──
  const chapters: EpubChapter[] = [];
  for (const { spineIndex, tocTitle, depth } of chapterOrder) {
    const idref = spineIds[spineIndex];
    const filePath = idToHref.get(idref) ?? '';
    const chTitle = tocTitle || idref || `第 ${spineIndex + 1} 章`;
    let content = '';

    try {
      const raw = await zip.file(filePath)?.async('string');
      if (raw) {
        const doc = xml.parseHtml(raw);
        if (doc) {
          // 清理不可渲染的元素
          doc.querySelectorAll('script, style, head, svg, iframe, noscript')
            .forEach(el => el.remove());
          content = doc.body?.innerHTML?.trim() || '';
        }
        if (!content) {
          // body 为空或解析失败 → 从原始文本生成段落
          const text = raw.replace(/<[^>]+>/g, '').trim();
          if (text) {
            content = text.split(/\n{2,}/).filter(p => p.trim())
              .map(p => `<p>${p.trim()}</p>`).join('\n');
          }
        }
      }
    } catch (err) {
      console.warn(`[EPUB] 章节 ${spineIndex} (${idref}) 读取失败:`, err);
    }

    chapters.push({ id: idref, href: filePath, title: chTitle, content, index: spineIndex, depth });
  }

  logInfo({ chapters: chapters.length, withContent: chapters.filter(c => c.content).length });

  // ── 10. spine 为空 → fallback: 遍历 ZIP ──
  if (chapters.length === 0) {
    logInfo({ fallback: 'spine 为空，扫描 ZIP 中的 XHTML' });
    const fb = await fallbackExtract(zip);
    if (fb.length > 0) {
      const fbChapters: EpubChapter[] = fb.map((c, i) => ({ ...c, index: i, depth: 0 }));
      const fbToc: TocEntry[] = fbChapters.map(c => ({
        chapterIndex: c.index, title: c.title, depth: 0,
      }));
      logGroupEnd();
      return { title, author, cover, chapters: fbChapters, toc: fbToc };
    }
  }

  // ── 11. 构建 UI TOC ──
  const displayToc = buildDisplayToc(tocTree, hrefToSpineIndex, chapterOrder);
  logInfo({ tocEntries: displayToc.length });

  logGroupEnd();
  return { title, author, cover, chapters, toc: displayToc };
}

// ═══════════════════════════════════════════════════
// TOC 树解析 — EPUB 3 NAV → EPUB 2 NCX → 空回退
// ═══════════════════════════════════════════════════

async function parseTocTree(
  zip: JSZip,
  opfRoot: Element,
  opfPath: string,
  manifestItems: Element[],
): Promise<TocNode[]> {
  // EPUB 3: NAV document — manifest 中 properties 包含 "nav" 的 item
  try {
    const navItem = manifestItems.find(
      el => (xml.attr(el, 'properties') ?? '').includes('nav'),
    );
    if (navItem) {
      const navHref = xml.attr(navItem, 'href');
      if (navHref) {
        const navPath = path.normalize(opfPath, navHref);
        const navXml = await zip.file(navPath)?.async('string');
        if (navXml) {
          const navDoc = xml.parseHtml(navXml);
          if (navDoc) {
            // text/html 模式下命名空间已剥离，CSS 安全
            const tocNav = navDoc.querySelector('nav[epub\\:type="toc"], nav');
            const topOl = tocNav?.querySelector('ol');
            if (topOl) {
              const tree = parseNavOl(topOl, path.dirname(navPath), 0);
              if (tree.length > 0) {
                logInfo({ tocSource: 'NAV (EPUB 3)' });
                return tree;
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[EPUB] NAV 解析失败，降级到 NCX:', err);
  }

  // EPUB 2: NCX — spine 的 toc 属性指向 manifest item id
  try {
    const spineEl = xml.query(opfRoot, 'spine');
    const ncxId = spineEl ? xml.attr(spineEl, 'toc') : null;
    if (ncxId) {
      const ncxItem = manifestItems.find(el => xml.attr(el, 'id') === ncxId);
      const ncxHref = ncxItem ? xml.attr(ncxItem, 'href') : null;
      if (ncxHref) {
        const ncxPath = path.normalize(opfPath, ncxHref);
        const ncxXml = await zip.file(ncxPath)?.async('string');
        if (ncxXml) {
          const ncxRoot = xml.parseXml(ncxXml);
          if (ncxRoot) {
            const navMapEl = xml.query(ncxRoot, 'navMap');
            if (navMapEl) {
              const ncxDir = path.dirname(ncxPath);
              const tree = parseNcxNavPoints(navMapEl, ncxDir, 0);
              if (tree.length > 0) {
                logInfo({ tocSource: 'NCX (EPUB 2)' });
                return tree;
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[EPUB] NCX 解析失败:', err);
  }

  logInfo({ tocSource: '(none)' });
  return [];
}

/** EPUB 3 NAV: 递归 <ol> → TocNode[] */
function parseNavOl(ol: Element, baseDir: string, depth: number): TocNode[] {
  const nodes: TocNode[] = [];
  const lis = ol.querySelectorAll(':scope > li');

  for (const li of lis) {
    const a = li.querySelector('a');
    if (!a) continue;

    const href = a.getAttribute('href') ?? '';
    const label = a.textContent?.trim() ?? '';
    if (!label) continue;

    const fullHref = path.normalize(baseDir, href);
    const childOl = li.querySelector(':scope > ol');
    const children = childOl ? parseNavOl(childOl, baseDir, depth + 1) : [];

    nodes.push({ label, href: fullHref, children, depth });
  }
  return nodes;
}

/** EPUB 2 NCX: 递归 <navPoint> → TocNode[] */
function parseNcxNavPoints(parent: Element, ncxDir: string, depth: number): TocNode[] {
  const nodes: TocNode[] = [];
  const navPoints = xml.children(parent, 'navPoint');

  for (const np of navPoints) {
    const contentEl = xml.first(np, 'content');
    const src = contentEl ? xml.attr(contentEl, 'src') : null;
    if (!src) continue;

    const navLabel = xml.first(np, 'navLabel');
    const textEl = navLabel ? xml.first(navLabel, 'text') : null;
    const label = textEl?.textContent?.trim() ?? '';
    if (!label) continue;

    const fullHref = path.normalize(ncxDir, src);
    const children = parseNcxNavPoints(np, ncxDir, depth + 1);
    nodes.push({ label, href: fullHref, children, depth });
  }
  return nodes;
}

// ═══════════════════════════════════════════════════
// TOC → Spine 映射（保留原逻辑，已验证正确）
// ═══════════════════════════════════════════════════

function resolveTocTree(
  tree: TocNode[],
  hrefToSpineIndex: Map<string, number>,
): TocSpineMapping[] {
  const result: TocSpineMapping[] = [];
  const seen = new Set<number>();

  function walk(nodes: readonly TocNode[]): void {
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
      result.push({ spineIndex: i, tocTitle: spineIds[i], depth: 0 });
    }
  }

  return result;
}

function buildDisplayToc(
  tree: readonly TocNode[],
  hrefToSpineIndex: Map<string, number>,
  chapterOrder: TocSpineMapping[],
): TocEntry[] {
  const spineToOrderPos = new Map<number, number>();
  chapterOrder.forEach((m, pos) => spineToOrderPos.set(m.spineIndex, pos));

  function convert(nodes: readonly TocNode[]): TocEntry[] {
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
// 封面提取 — meta[cover] → properties="cover-image" → 首个 image/*
// ═══════════════════════════════════════════════════

async function extractCover(
  zip: JSZip,
  opfRoot: Element,
  opfPath: string,
): Promise<string | undefined> {
  try {
    const opfDir = path.dirname(opfPath);
    const manifestEl = xml.query(opfRoot, 'manifest');
    const allItems = manifestEl ? xml.children(manifestEl, 'item') : [];

    let coverItem: Element | null = null;

    // EPUB 2: <meta name="cover" content="cover-id"/>
    const allMeta = xml.descendants(opfRoot, 'meta');
    const coverMeta = allMeta.find(el => xml.attr(el, 'name') === 'cover');
    if (coverMeta) {
      const coverId = xml.attr(coverMeta, 'content');
      if (coverId) {
        coverItem = allItems.find(el => xml.attr(el, 'id') === coverId) ?? null;
      }
    }

    // EPUB 3: properties="cover-image"
    if (!coverItem) {
      coverItem = allItems.find(el =>
        (xml.attr(el, 'properties') ?? '').includes('cover-image'),
      ) ?? null;
    }

    // 回退：第一个 image/* 的 manifest item
    if (!coverItem) {
      coverItem = allItems.find(el =>
        (xml.attr(el, 'media-type') ?? '').startsWith('image/'),
      ) ?? null;
    }

    if (coverItem) {
      const coverHref = xml.attr(coverItem, 'href');
      if (coverHref) {
        const fullPath = path.normalize(opfDir, coverHref);
        const coverData = await zip.file(fullPath)?.async('base64');
        if (coverData) {
          const mt = xml.attr(coverItem, 'media-type') ?? 'image/jpeg';
          logInfo({ cover: fullPath });
          return `data:${mt};base64,${coverData}`;
        }
      }
    }
  } catch { /* 封面可选 */ }

  logInfo({ cover: '(none)' });
  return undefined;
}

// ═══════════════════════════════════════════════════
// Fallback — spine 为空时扫描 ZIP 中所有 XHTML
// ═══════════════════════════════════════════════════

async function fallbackExtract(
  zip: JSZip,
): Promise<Array<{ id: string; href: string; title: string; content: string }>> {
  const result: Array<{ id: string; href: string; title: string; content: string }> = [];
  const xhtmlFiles: string[] = [];

  zip.forEach((relativePath) => {
    const lower = relativePath.toLowerCase();
    if (lower.match(/\.(xhtml|html?)$/) && !lower.includes('nav') && !lower.includes('toc')) {
      xhtmlFiles.push(relativePath);
    }
  });

  xhtmlFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  for (let i = 0; i < xhtmlFiles.length; i++) {
    const filePath = xhtmlFiles[i];
    try {
      const raw = await zip.file(filePath)?.async('string');
      if (!raw) continue;

      const doc = xml.parseHtml(raw);
      let title = '';
      let content = '';

      if (doc) {
        doc.querySelectorAll('script, style, head, svg, iframe, noscript')
          .forEach(el => el.remove());
        content = doc.body?.innerHTML?.trim() || '';

        // 层级标题提取
        title =
          doc.querySelector('h1')?.textContent?.trim() ??
          doc.querySelector('h2')?.textContent?.trim() ??
          doc.querySelector('title')?.textContent?.trim() ??
          filePath.split('/').pop()?.replace(/\.\w+$/, '') ??
          '';
      }

      if (!content) {
        const text = raw.replace(/<[^>]+>/g, '').trim();
        if (text) {
          content = text.split(/\n{2,}/).filter(p => p.trim())
            .map(p => `<p>${p.trim()}</p>`).join('\n');
        }
      }

      if (!title) {
        title = `第 ${i + 1} 章`;
      }

      result.push({ id: `fb-${i}`, href: filePath, title, content });
    } catch { /* 单文件失败不中断 */ }
  }
  return result;
}
