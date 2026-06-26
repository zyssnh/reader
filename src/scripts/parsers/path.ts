/**
 * EPUB 路径规范化 — 统一处理 ../、./、#fragment、URL 编码。
 */

/** 规范化 ZIP 内的相对路径，去掉 fragment。 */
export function normalize(base: string, rel: string): string {
  const clean = rel.split('#')[0];   // 去 fragment
  if (!clean) return base;

  // 确定基准目录
  let resolved: string;
  if (clean.startsWith('/')) {
    resolved = clean.replace(/^\/+/, '');
  } else {
    const baseDir = base.includes('/') ? base.split('/').slice(0, -1).join('/') + '/' : '';
    resolved = baseDir + clean;
  }

  // 处理 ../ 和 ./
  const parts = resolved.split(/[\\/]/);   // 兼容 Windows 反斜杠
  const stack: string[] = [];
  for (const p of parts) {
    if (p === '..') {
      stack.pop();
    } else if (p !== '.' && p !== '') {
      // 解码 URL 编码（如 %20 → 空格）
      try {
        stack.push(decodeURIComponent(p));
      } catch {
        stack.push(p);
      }
    }
  }
  return stack.join('/');
}

/** 从文件路径提取目录名（末尾带 /）；根目录返回 '' */
export function dirname(filePath: string): string {
  return filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') + '/' : '';
}
