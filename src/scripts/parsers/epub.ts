/**
 * EPUB 解析器
 * 使用 JSZip 直接解压解析 EPUB，不依赖 epubjs 运行时渲染
 */
import JSZip from 'jszip';

export interface EpubData {
  title: string;
  author: string;
  cover?: string;
  chapters: Array<{ id: string; title: string; content: string; index: number; depth: number }>;
}

/**
 * 解析 EPUB 文件
 */
export async function parseEpub(file: File): Promise<EpubData> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // 1. 读取 container.xml 找到 OPF 路径
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error('无效的 EPUB 文件：缺少 container.xml');

  const opfPath = containerXml.match(/full-path="([^"]+\.opf)"/)?.[1];
  if (!opfPath) throw new Error('无法找到 OPF 文件路径');

  const opfDir = opfPath.includes('/') ? opfPath.split('/').slice(0, -1).join('/') + '/' : '';

  // 2. 解析 OPF
  const opfXml = await zip.file(opfPath)?.async('string');
  if (!opfXml) throw new Error('无法读取 OPF 文件');

  const parser = new DOMParser();
  const opf = parser.parseFromString(opfXml, 'application/xml');

  // 检查是否有解析错误
  if (opf.querySelector('parsererror')) {
    throw new Error('OPF 文件 XML 解析失败');
  }

  const title =
    opf.querySelector('metadata > title, metadata > *|title')?.textContent?.trim() ??
    file.name.replace(/\.epub$/i, '');
  const author =
    opf.querySelector('metadata > creator, metadata > *|creator')?.textContent?.trim() ?? '未知作者';

  // 3. 提取封面
  let cover: string | undefined;
  try {
    const coverId = opf.querySelector('meta[name="cover"]')?.getAttribute('content');
    const coverItem = coverId
      ? opf.querySelector(`manifest > item[id="${coverId}"]`)
      : opf.querySelector('manifest > item[media-type^="image/"]');
    const coverHref = coverItem?.getAttribute('href');
    if (coverHref) {
      const coverData = await zip.file(opfDir + coverHref)?.async('base64');
      const mt = coverItem?.getAttribute('media-type') ?? 'image/jpeg';
      if (coverData) cover = `data:${mt};base64,${coverData}`;
    }
  } catch {
    /* 封面可选 */
  }

  // 4. 读取 spine 顺序
  const spineItems = Array.from(opf.querySelectorAll('spine > itemref'))
    .map(ref => ref.getAttribute('idref'))
    .filter(Boolean) as string[];

  // 5. 构建 id→href 映射
  const manifest = new Map<string, string>();
  opf.querySelectorAll('manifest > item').forEach(item => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, opfDir + href);
  });

  // 6. 解析 TOC 获取章节标题
  const tocMap = await parseToc(zip, opf, opfDir);

  // 7. 读取章节内容
  const chapters = await Promise.all(
    spineItems.map(async (idref, index) => {
      const href = manifest.get(idref) ?? '';
      let title = `第 ${index + 1} 章`;
      let content = '';
      let depth = 0;

      try {
        const raw = await zip.file(href)?.async('string');
        if (raw) {
          const doc = parser.parseFromString(raw, 'application/xhtml+xml');
          doc.querySelectorAll('script, style, head').forEach(el => el.remove());
          content = doc.body?.innerHTML ?? raw;

          // 尝试从内容中提取标题
          const hTag = doc.querySelector('h1, h2, h3, title')?.textContent?.trim();
          if (hTag) {
            depth = doc.querySelector('h1') ? 0 : doc.querySelector('h2') ? 1 : 2;
          }
          // 优先使用 TOC 中的标题
          const tocTitle = tocMap.get(href.split('#')[0]);
          if (tocTitle) title = tocTitle;
          else if (hTag) title = hTag;
        }
      } catch {
        /* 跳过无法解析的章节 */
      }

      return { id: idref, title, content, index, depth };
    }),
  );

  return { title, author, cover, chapters };
}

/**
 * 解析 EPUB 目录（NCX 或 NAV）
 */
async function parseToc(zip: JSZip, opf: Document, opfDir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    // EPUB 3: nav document
    const navItem = opf.querySelector('manifest > item[properties*="nav"]');
    const navHref = navItem?.getAttribute('href');
    if (navHref) {
      const navXml = await zip.file(opfDir + navHref)?.async('string');
      if (navXml) {
        const doc = new DOMParser().parseFromString(navXml, 'application/xhtml+xml');
        doc.querySelectorAll('nav[epub\\:type="toc"] a, nav a').forEach(a => {
          const href = (a.getAttribute('href') ?? '').split('#')[0];
          const label = a.textContent?.trim() ?? '';
          if (href && label) map.set(opfDir + href, label);
        });
        if (map.size > 0) return map;
      }
    }

    // EPUB 2: NCX
    const ncxId = opf.querySelector('spine')?.getAttribute('toc');
    if (ncxId) {
      const ncxItem = opf.querySelector(`manifest > item[id="${ncxId}"]`);
      const ncxHref = ncxItem?.getAttribute('href');
      if (ncxHref) {
        const ncxXml = await zip.file(opfDir + ncxHref)?.async('string');
        if (ncxXml) {
          const doc = new DOMParser().parseFromString(ncxXml, 'application/xml');
          doc.querySelectorAll('navPoint').forEach(np => {
            const src = np.querySelector('content')?.getAttribute('src')?.split('#')[0] ?? '';
            const label = np.querySelector('navLabel > text')?.textContent?.trim() ?? '';
            if (src && label) map.set(opfDir + src, label);
          });
        }
      }
    }
  } catch {
    /* TOC 解析失败不影响内容读取 */
  }
  return map;
}
