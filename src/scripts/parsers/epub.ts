/**
 * EPUB 解析器
 * 使用 JSZip 直接解压，支持 EPUB 2/3，命名空间自适应，
 * 层级化 TOC（卷→章→节）。
 */
import JSZip from 'jszip';
import type { TocEntry } from '../../types/index';

/** 内部 TOC 树节点 */
interface TocNode {
  label: string;
  href: string;             // 相对于 OPF 根的文件路径（已 resolve）
  children: TocNode[];
  depth: number;
}

export interface EpubChapter {
  id: string;               // manifest idref
  href: string;             // 文件路径（用于 TOC 匹配）
  title: string;
  content: string;          // HTML
  index: number;            // spine 顺序
  depth: number;            // TOC 层级
}

export interface EpubData {
  title: string;
  author: string;
  cover?: string;
  chapters: EpubChapter[];  // spine 顺序（内容渲染）
  toc: TocEntry[];          // TOC 层级结构（面板显示）
}

// ═══════════════════════════════════════════════════
// 命名空间安全查询
// ═══════════════════════════════════════════════════

/** 将裸标签选择器转为 local-name() 形式 */
function toNsSelector(selector: string): string {
  return selector.replace(/([a-zA-Z_][\w-]*)/g, (m, tag) => {
    if (/^\[.*\]$/.test(m) || m === '*') return m;
    return `*[local-name()='${tag}']`;
  });
}

function nsQuery(parent: Document | Element, selector: string): Element | null {
  return parent.querySelector(selector) ?? parent.querySelector(toNsSelector(selector));
}

function nsQueryAll(parent: Document | Element, selector: string): Element[] {
  const direct = Array.from(parent.querySelectorAll(selector));
  if (direct.length > 0) return direct;
  return Array.from(parent.querySelectorAll(toNsSelector(selector)));
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

// ═══════════════════════════════════════════════════
// 路径工具
// ═══════════════════════════════════════════════════

/** 规范化路径：去掉 ./ ../ fragment，统一斜杠 */
function normalizePath(base: string, rel: string): string {
  // 去掉 fragment
  const cleanRel = rel.split('#')[0];
  if (!cleanRel) return base;

  let resolved: string;
  if (cleanRel.startsWith('/')) {
    // 绝对路径（相对于 EPUB 根）：截取第一段目录
    resolved = cleanRel.replace(/^\/+/, '');
  } else {
    // 相对路径：拼接在 base 目录下
    const baseDir = base.includes('/') ? base.split('/').slice(0, -1).join('/') + '/' : '';
    resolved = baseDir + cleanRel;
  }

  // 处理 ../
  const parts = resolved.split('/');
  const stack: string[] = [];
  for (const p of parts) {
    if (p === '..') stack.pop();
    else if (p !== '.' && p !== '') stack.push(p);
  }
  return stack.join('/');
}

// ═══════════════════════════════════════════════════
// 主解析入口
// ═══════════════════════════════════════════════════

export async function parseEpub(file: File): Promise<EpubData> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // 1. container.xml → OPF 路径
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error('无效的 EPUB：缺少 container.xml');

  const opfMatch = containerXml.match(/full-path="([^"]+\.opf)"/)
    ?? containerXml.match(/full-path=['"]([^'"]+\.opf)['"]/);
  if (!opfMatch) throw new Error('无法找到 OPF 文件路径');
  const opfPath = opfMatch[1];
  const opfDir = opfPath.includes('/') ? opfPath.split('/').slice(0, -1).join('/') + '/' : '';

  // 2. 解析 OPF
  const opfXml = await zip.file(opfPath)?.async('string');
  if (!opfXml) throw new Error('无法读取 OPF 文件');
  const opf = new DOMParser().parseFromString(opfXml, 'application/xml');
  if (opf.querySelector('parsererror')) throw new Error('OPF XML 解析失败');

  const title = nsQuery(opf, 'metadata > title')?.textContent?.trim()
    || file.name.replace(/\.epub$/i, '');
  const author = nsQuery(opf, 'metadata > creator')?.textContent?.trim() || '未知作者';

  // 3. 封面
  const cover = await extractCover(zip, opf, opfDir);

  // 4. manifest: id → href（相对于 OPF 目录的完整路径）
  const manifestItems = nsQueryAll(opf, 'manifest > item');
  const idToHref = new Map<string, string>();
  const idToMediaType = new Map<string, string>();
  for (const item of manifestItems) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) {
      idToHref.set(id, normalizePath(opfPath, href));
      idToMediaType.set(id, item.getAttribute('media-type') ?? '');
    }
  }

  // 5. spine 顺序
  const spineRefs = nsQueryAll(opf, 'spine > itemref');
  const spineIds = spineRefs.map(r => r.getAttribute('idref')).filter(Boolean) as string[];

  // 6. 解析层级化 TOC 树
  const tocTree = await parseTocTree(zip, opf, opfPath);

  // 7. 构建 href→spineIndex 映射（用于 TOC→章节匹配）
  const hrefToSpineIndex = new Map<string, number>();
  for (let i = 0; i < spineIds.length; i++) {
    const filePath = idToHref.get(spineIds[i]);
    if (filePath) hrefToSpineIndex.set(filePath, i);
  }

  // 8. 将 TOC 树解析为章节顺序，flat map 到 spine index
  const tocToSpine = resolveTocTree(tocTree, hrefToSpineIndex);

  // 9. 如果 TOC 提供了排序，按 TOC 顺序重排 spine 中的章节；
  //    同时标注 depth
  const chapterOrder = buildChapterOrder(spineIds, tocToSpine);

  // 10. 读取章节内容
  const chapters: EpubChapter[] = [];
  for (const { spineIndex, tocTitle, depth } of chapterOrder) {
    const idref = spineIds[spineIndex];
    const filePath = idToHref.get(idref) ?? '';
    const title = tocTitle || idref || `第 ${spineIndex + 1} 章`;
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

    chapters.push({ id: idref, href: filePath, title, content, index: spineIndex, depth });
  }

  // 11. 如果 spine 为空，fallback
  if (chapters.length === 0) {
    console.warn('spine 为空，遍历 ZIP 中所有 XHTML');
    const fb = await fallbackExtract(zip);
    if (fb.length > 0) {
      const fbChapters = fb.map((c, i) => ({ ...c, index: i, depth: 0 }));
      const fbToc = fbChapters.map(c => ({ chapterIndex: c.index, title: c.title, depth: 0 }));
      return { title, author, cover, chapters: fbChapters, toc: fbToc };
    }
  }

  // 12. 构建 UI TOC 结构（层级化，供 TocPanel 渲染）
  const displayToc = buildDisplayToc(tocTree, hrefToSpineIndex, chapterOrder);

  return { title, author, cover, chapters, toc: displayToc };
}

// ═══════════════════════════════════════════════════
// TOC 树解析（层级化）
// ═══════════════════════════════════════════════════

async function parseTocTree(
  zip: JSZip,
  opf: Document,
  opfPath: string,
): Promise<TocNode[]> {
  const opfDir = opfPath.includes('/') ? opfPath.split('/').slice(0, -1).join('/') + '/' : '';
  const allItems = nsQueryAll(opf, 'manifest > item');

  try {
    // EPUB 3: NAV document
    const navItem = allItems.find(el => (el.getAttribute('properties') ?? '').includes('nav'));
    if (navItem) {
      const navHref = navItem.getAttribute('href');
      if (navHref) {
        const navPath = normalizePath(opfPath, navHref);
        const navXml = await zip.file(navPath)?.async('string');
        if (navXml) {
          const navDoc = parseSectionHtml(navXml);
          // 找 <nav epub:type="toc"> 内的第一个 <ol>
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
    const spineEl = nsQuery(opf, 'spine');
    const ncxId = spineEl?.getAttribute('toc');
    if (ncxId) {
      const ncxItem = allItems.find(el => el.getAttribute('id') === ncxId);
      const ncxHref = ncxItem?.getAttribute('href');
      if (ncxHref) {
        const ncxPath = normalizePath(opfPath, ncxHref);
        const ncxXml = await zip.file(ncxPath)?.async('string');
        if (ncxXml) {
          const ncxDoc = new DOMParser().parseFromString(ncxXml, 'application/xml');
          const navMap = nsQuery(ncxDoc, 'navMap');
          if (navMap) {
            const tree = parseNcxNavPoints(navMap, opfDir, 0);
            if (tree.length > 0) return tree;
          }
        }
      }
    }
  } catch (err) {
    console.warn('TOC 树解析失败:', err);
  }

  return [];
}

/** 递归解析 EPUB 3 NAV 的 <ol> 结构 */
function parseNavOl(ol: Element, opfDir: string, depth: number): TocNode[] {
  const nodes: TocNode[] = [];
  const lis = ol.querySelectorAll(':scope > li');

  for (const li of lis) {
    const a = li.querySelector('a');
    if (!a) continue;

    const href = a.getAttribute('href') ?? '';
    const label = a.textContent?.trim() ?? '';
    if (!label) continue;

    const fullHref = normalizePath(opfDir, href);

    const childOl = li.querySelector(':scope > ol');
    const children = childOl ? parseNavOl(childOl, opfDir, depth + 1) : [];

    nodes.push({ label, href: fullHref, children, depth });
  }
  return nodes;
}

/** 递归解析 EPUB 2 NCX 的 <navPoint> 结构 */
function parseNcxNavPoints(parent: Element, opfDir: string, depth: number): TocNode[] {
  const nodes: TocNode[] = [];
  const navPoints = parent.querySelectorAll(':scope > navPoint, :scope > *[local-name()="navPoint"]');

  for (const np of navPoints) {
    const contentEl = np.querySelector('content, *[local-name()="content"]');
    const src = contentEl?.getAttribute('src') ?? '';
    const textEl = np.querySelector('navLabel > text, text, *[local-name()="text"]');
    const label = textEl?.textContent?.trim() ?? '';
    if (!label || !src) continue;

    const fullHref = normalizePath(opfDir, src);

    const children = parseNcxNavPoints(np, opfDir, depth + 1);
    nodes.push({ label, href: fullHref, children, depth });
  }
  return nodes;
}

// ═══════════════════════════════════════════════════
// TOC → Spine 解析
// ═══════════════════════════════════════════════════

interface TocSpineMapping {
  spineIndex: number;
  tocTitle: string;
  depth: number;
}

/** 将 TOC 树展平为 spine-index 映射列表 */
function resolveTocTree(
  tree: TocNode[],
  hrefToSpineIndex: Map<string, number>,
): TocSpineMapping[] {
  const result: TocSpineMapping[] = [];
  const seen = new Set<number>();

  function walk(nodes: TocNode[]): void {
    for (const node of nodes) {
      const si = hrefToSpineIndex.get(node.href);
      if (si !== undefined) {
        if (!seen.has(si)) {
          result.push({ spineIndex: si, tocTitle: node.label, depth: node.depth });
          seen.add(si);
        }
      }
      if (node.children.length > 0) walk(node.children);
    }
  }

  walk(tree);
  return result;
}

/** 按 TOC 顺序排列章节（TOC 覆盖的排前面，未被覆盖的追加末尾） */
function buildChapterOrder(
  spineIds: string[],
  tocMapping: TocSpineMapping[],
): TocSpineMapping[] {
  const covered = new Set(tocMapping.map(m => m.spineIndex));
  const result = [...tocMapping];

  // 追加 TOC 未覆盖的 spine 项
  for (let i = 0; i < spineIds.length; i++) {
    if (!covered.has(i)) {
      result.push({ spineIndex: i, tocTitle: '', depth: 0 });
    }
  }

  return result;
}

/** 构建 UI 显示的层级化 TOC */
function buildDisplayToc(
  tree: TocNode[],
  hrefToSpineIndex: Map<string, number>,
  chapterOrder: TocSpineMapping[],
): TocEntry[] {
  // 建立 spineIndex → chapterOrder 位置映射
  const spineToOrderPos = new Map<number, number>();
  chapterOrder.forEach((m, pos) => {
    spineToOrderPos.set(m.spineIndex, pos);
  });

  function convert(nodes: TocNode[]): TocEntry[] {
    const entries: TocEntry[] = [];
    for (const node of nodes) {
      const si = hrefToSpineIndex.get(node.href);
      if (si === undefined) {
        // TOC 节点无对应章节（如外部链接），跳过但保留子节点
        if (node.children.length > 0) {
          entries.push(...convert(node.children));
        }
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

  // 如果 TOC 为空，用 chapterOrder 生成平铺目录
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
    const coverMetaEl = opf.querySelector('meta[name="cover"]')
      ?? opf.querySelector('*[local-name()="meta"][name="cover"]');
    const coverId = coverMetaEl?.getAttribute('content');

    const allItems = nsQueryAll(opf, 'manifest > item');
    let coverItem: Element | null = null;
    if (coverId) {
      coverItem = allItems.find(el =>
        el.getAttribute('id') === coverId
      ) ?? null;
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
// Fallback：遍历 ZIP 中所有 XHTML
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
