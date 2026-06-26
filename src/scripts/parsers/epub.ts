/**
 * EPUB 解析器
 * 使用 JSZip 直接解压解析 EPUB，不依赖 epubjs 运行时渲染
 *
 * 关键修复：
 * - 使用 local-name() 处理 OPF XML 命名空间
 * - XHTML 解析失败时回退到 text/html
 * - 章节内容为空时回退到原始文本
 */
import JSZip from 'jszip';

export interface EpubData {
  title: string;
  author: string;
  cover?: string;
  chapters: Array<{ id: string; title: string; content: string; index: number; depth: number }>;
}

/**
 * 用命名空间安全的方式查询元素
 * 因为 OPF XML 有 xmlns 命名空间，裸选择器会失效
 */
function nsQuery(parent: Document | Element, selector: string): Element | null {
  // 先尝试直接查询（对非命名空间文档有效）
  let el = parent.querySelector(selector);
  if (el) return el;

  // 对于命名空间文档，使用 local-name() 匹配
  // 例如 "spine > itemref" → "[local-name()='spine'] > [local-name()='itemref']"
  const nsSelector = selector.replace(/([a-zA-Z][\w-]*)/g, (m, tag) => {
    // 不转换属性选择器中的标签名（如 [id="x"]）
    if (selector.includes(`[${tag}`)) return m;
    return `*[local-name()='${tag}']`;
  });
  return parent.querySelector(nsSelector);
}

function nsQueryAll(parent: Document | Element, selector: string): Element[] {
  let els = Array.from(parent.querySelectorAll(selector));
  if (els.length > 0) return els;

  const nsSelector = selector.replace(/([a-zA-Z][\w-]*)/g, (m, tag) => {
    if (selector.includes(`[${tag}`)) return m;
    return `*[local-name()='${tag}']`;
  });
  return Array.from(parent.querySelectorAll(nsSelector));
}

/**
 * 解析 HTML/XHTML 内容，先试 application/xhtml+xml，失败回退 text/html
 */
function parseSectionHtml(raw: string): Document {
  // 先尝试严格的 XHTML 解析
  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, 'application/xhtml+xml');
  const err = doc.querySelector('parsererror');
  if (!err && doc.body && doc.body.innerHTML.trim()) return doc;

  // 回退到宽松的 HTML 解析
  const htmlDoc = parser.parseFromString(raw, 'text/html');
  return htmlDoc;
}

/**
 * 解析 EPUB 文件
 */
export async function parseEpub(file: File): Promise<EpubData> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // 1. 读取 container.xml
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error('无效的 EPUB 文件：缺少 container.xml');

  // container.xml 也可能有命名空间
  const opfPath =
    containerXml.match(/full-path="([^"]+\.opf)"/)?.[1] ??
    containerXml.match(/full-path=['"]([^'"]+\.opf)['"]/)?.[1];
  if (!opfPath) throw new Error('无法找到 OPF 文件路径');

  const opfDir = opfPath.includes('/') ? opfPath.split('/').slice(0, -1).join('/') + '/' : '';

  // 2. 解析 OPF（XML，有命名空间）
  const opfXml = await zip.file(opfPath)?.async('string');
  if (!opfXml) throw new Error('无法读取 OPF 文件');

  const opf = new DOMParser().parseFromString(opfXml, 'application/xml');
  if (opf.querySelector('parsererror')) throw new Error('OPF 文件 XML 解析失败');

  // 元数据：使用 nsQuery
  const titleEl = nsQuery(opf, 'metadata > title');
  const creatorEl = nsQuery(opf, 'metadata > creator');
  const title = titleEl?.textContent?.trim() || file.name.replace(/\.epub$/i, '');
  const author = creatorEl?.textContent?.trim() || '未知作者';

  // 3. 封面
  let cover: string | undefined;
  try {
    // meta[name="cover"] → content 属性指向 manifest item id
    const coverMetaEl = opf.querySelector('meta[name="cover"]')
      ?? opf.querySelector('*[local-name()="meta"][name="cover"]');
    const coverId = coverMetaEl?.getAttribute('content');

    const allManifestItems = nsQueryAll(opf, 'manifest > item');
    let coverItem: Element | null = null;
    if (coverId) {
      coverItem = allManifestItems.find(el =>
        el.getAttribute('id') === coverId || el.getAttributeNS('*', 'id') === coverId
      ) ?? null;
    }
    if (!coverItem) {
      // 回退：第一个 image/* 的 item
      coverItem = allManifestItems.find(el => {
        const mt = el.getAttribute('media-type') ?? '';
        return mt.startsWith('image/');
      }) ?? null;
    }

    const coverHref = coverItem?.getAttribute('href');
    if (coverHref) {
      const coverData = await zip.file(opfDir + coverHref)?.async('base64');
      const mt = coverItem?.getAttribute('media-type') ?? 'image/jpeg';
      if (coverData) cover = `data:${mt};base64,${coverData}`;
    }
  } catch { /* 封面可选 */ }

  // 4. spine 顺序（idref → manifest id）
  const spineRefs = nsQueryAll(opf, 'spine > itemref');
  const spineIds = spineRefs
    .map(ref => ref.getAttribute('idref'))
    .filter(Boolean) as string[];

  // 5. manifest: id → href 映射
  const manifestItems = nsQueryAll(opf, 'manifest > item');
  const manifest = new Map<string, string>();
  for (const item of manifestItems) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, opfDir + href);
  }

  // 6. TOC 目录
  const tocMap = await parseToc(zip, opf, opfDir, nsQuery, nsQueryAll);

  // 7. 读取章节
  const chapters: EpubData['chapters'] = [];

  for (let i = 0; i < spineIds.length; i++) {
    const idref = spineIds[i];
    const href = manifest.get(idref) ?? '';
    let title = `第 ${i + 1} 章`;
    let content = '';
    let depth = 0;

    try {
      const raw = await zip.file(href)?.async('string');
      if (raw) {
        const doc = parseSectionHtml(raw);
        // 清理
        doc.querySelectorAll('script, style, head').forEach(el => el.remove());

        const bodyContent = doc.body?.innerHTML?.trim();
        content = bodyContent || raw;

        if (!bodyContent) {
          // body 为空：回退到原始文本（自动把纯文本转成 <p>）
          const textContent = doc.body?.textContent?.trim() || raw.replace(/<[^>]+>/g, '').trim();
          if (textContent) {
            content = textContent
              .split(/\n{2,}/)
              .filter(p => p.trim())
              .map(p => `<p>${p.trim()}</p>`)
              .join('\n');
          }
        }

        // 标题检测
        const h1 = doc.querySelector('h1');
        const h2 = doc.querySelector('h2');
        const h3 = doc.querySelector('h3');
        const tocKey = href.split('#')[0];
        const tocTitle = tocMap.get(tocKey);

        if (tocTitle) {
          title = tocTitle;
        } else if (h1?.textContent?.trim()) {
          title = h1.textContent.trim();
          depth = 0;
        } else if (h2?.textContent?.trim()) {
          title = h2.textContent.trim();
          depth = 1;
        } else if (h3?.textContent?.trim()) {
          title = h3.textContent.trim();
          depth = 2;
        } else if (doc.querySelector('title')?.textContent?.trim()) {
          title = doc.querySelector('title')!.textContent!.trim();
        }
      }
    } catch (err) {
      console.warn(`章节 ${i} (${idref}) 解析失败:`, err);
    }

    chapters.push({ id: idref, title, content, index: i, depth });
  }

  // 8. 如果 spine 为空，fallback：直接遍历所有 XHTML 文件
  if (chapters.length === 0) {
    console.warn('spine 为空，使用 fallback 方案：遍历所有 XHTML');
    const fallbackChapters = await fallbackExtract(zip, tocMap);
    if (fallbackChapters.length > 0) {
      return { title, author, cover, chapters: fallbackChapters };
    }
  }

  return { title, author, cover, chapters };
}

/**
 * Fallback：当 spine 解析失败时，直接扫描 zip 中所有 XHTML/HTML 文件
 */
async function fallbackExtract(
  zip: JSZip,
  tocMap: Map<string, string>,
): Promise<EpubData['chapters']> {
  const chapters: EpubData['chapters'] = [];
  const xhtmlFiles: Array<{ path: string; name: string }> = [];

  zip.forEach((relativePath) => {
    const lower = relativePath.toLowerCase();
    if (lower.endsWith('.xhtml') || lower.endsWith('.html') || lower.endsWith('.htm')) {
      // 跳过 nav 文档和封面页
      const name = relativePath.split('/').pop() || relativePath;
      if (lower.includes('nav') || lower.includes('cover') || lower.includes('toc')) return;
      xhtmlFiles.push({ path: relativePath, name });
    }
  });

  xhtmlFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  for (let i = 0; i < xhtmlFiles.length; i++) {
    const { path } = xhtmlFiles[i];
    try {
      const raw = await zip.file(path)?.async('string');
      if (!raw) continue;

      const doc = parseSectionHtml(raw);
      doc.querySelectorAll('script, style, head').forEach(el => el.remove());

      let content = doc.body?.innerHTML?.trim() || '';
      if (!content) {
        const text = doc.body?.textContent?.trim() || raw.replace(/<[^>]+>/g, '').trim();
        if (text) {
          content = text.split(/\n{2,}/).filter(p => p.trim()).map(p => `<p>${p.trim()}</p>`).join('\n');
        }
      }

      const tocTitle = tocMap.get(path);
      const h1 = doc.querySelector('h1')?.textContent?.trim();
      const title = tocTitle || h1 || `第 ${i + 1} 章`;

      chapters.push({ id: `fallback-${i}`, title, content, index: i, depth: 0 });
    } catch {
      /* skip */
    }
  }

  return chapters;
}

/**
 * 解析 EPUB 目录（NCX 或 NAV，都可能有命名空间）
 */
async function parseToc(
  zip: JSZip,
  opf: Document,
  opfDir: string,
  _nsQuery: (parent: Document | Element, selector: string) => Element | null,
  nsQueryAllFn: (parent: Document | Element, selector: string) => Element[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    // EPUB 3: nav document — 找 manifest 中 properties 含 "nav" 的 item
    const navItem = nsQueryAllFn(opf, 'manifest > item')
      .find(el => (el.getAttribute('properties') ?? '').includes('nav'));
    const navHref = navItem?.getAttribute('href');

    if (navHref) {
      const navXml = await zip.file(opfDir + navHref)?.async('string');
      if (navXml) {
        const navDoc = parseSectionHtml(navXml);
        // nav 元素可能有 epub:type="toc" 属性
        navDoc.querySelectorAll('nav a, [epub\\:type="toc"] a').forEach(a => {
          const href = (a.getAttribute('href') ?? '').split('#')[0];
          const label = a.textContent?.trim() ?? '';
          if (href && label) {
            // 处理相对路径
            const fullHref = href.startsWith('/') ? href : opfDir + href;
            map.set(fullHref, label);
          }
        });
        if (map.size > 0) return map;
      }
    }

    // EPUB 2: NCX — spine 的 toc 属性指向 manifest item id
    const spineEl = _nsQuery(opf, 'spine');
    const ncxId = spineEl?.getAttribute('toc');
    if (ncxId) {
      const ncxItem = nsQueryAllFn(opf, 'manifest > item')
        .find(el => el.getAttribute('id') === ncxId);
      const ncxHref = ncxItem?.getAttribute('href');
      if (ncxHref) {
        const ncxXml = await zip.file(opfDir + ncxHref)?.async('string');
        if (ncxXml) {
          const ncxDoc = new DOMParser().parseFromString(ncxXml, 'application/xml');
          // NCX 也可能有命名空间
          const navPoints = ncxDoc.querySelectorAll('navPoint, *|navPoint, [local-name()="navPoint"]');
          navPoints.forEach(np => {
            const contentEl = np.querySelector('content')
              ?? np.querySelector('*|content')
              ?? np.querySelector('[local-name()="content"]');
            const src = contentEl?.getAttribute('src')?.split('#')[0] ?? '';
            const labelEl = np.querySelector('navLabel > text, text, *|text');
            const label = labelEl?.textContent?.trim() ?? '';
            if (src && label) {
              const fullSrc = src.startsWith('/') ? src : opfDir + src;
              map.set(fullSrc, label);
            }
          });
        }
      }
    }
  } catch (err) {
    console.warn('TOC 解析失败:', err);
  }
  return map;
}
