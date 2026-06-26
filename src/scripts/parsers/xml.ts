/**
 * XML 查询工具 — 统一使用 Element，不依赖 CSS namespace selector。
 * 所有函数接受 Element（非 Document），通过 localName 匹配。
 */

/** 按 localName 取第一个直接子元素 */
export function first(parent: Element, localName: string): Element | null {
  for (const c of parent.children) {
    if (c.localName === localName) return c;
  }
  return null;
}

/** 按 localName 取所有直接子元素 */
export function children(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter(c => c.localName === localName);
}

/** 按 localName 取所有后代（深度遍历） */
export function descendants(parent: Element, localName: string): Element[] {
  return Array.from(parent.getElementsByTagName('*')).filter(e => e.localName === localName);
}

/** 按路径 "a > b > c" 取第一个匹配 */
export function query(parent: Element, path: string): Element | null {
  const parts = path.split(/\s*>\s*/);
  let cur: Element | null = parent;
  for (const part of parts) {
    if (!cur) return null;
    cur = first(cur, part);
  }
  return cur;
}

/** 按路径取文本内容，每一级都判空 */
export function text(parent: Element, path: string): string | null {
  const el = query(parent, path);
  return el?.textContent?.trim() ?? null;
}

/** 取指定元素的属性值 */
export function attr(el: Element, name: string): string | null {
  return el.getAttribute(name);
}

/**
 * 从 Document 获取根 Element（XML 模式下的根节点）。
 * 统一入口：所有 XML 查询从 documentElement 开始。
 */
export function root(doc: Document): Element | null {
  return doc.documentElement ?? null;
}

/**
 * 容错解析 XML 字符串 → Element（根节点）。
 * 失败返回 null，不抛异常。
 */
export function parseXml(raw: string): Element | null {
  try {
    const doc = new DOMParser().parseFromString(raw, 'application/xml');
    if (doc.querySelector('parsererror')) return null;
    return root(doc);
  } catch {
    return null;
  }
}

/**
 * 容错解析 HTML/XHTML 内容（用于章节 body）。
 * 先 XHTML 严格模式，失败回退 HTML 宽松模式。
 */
export function parseHtml(raw: string): Document | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(raw, 'application/xhtml+xml');
    if (!doc.querySelector('parsererror') && doc.body?.innerHTML.trim()) return doc;
    return parser.parseFromString(raw, 'text/html');
  } catch {
    return null;
  }
}
