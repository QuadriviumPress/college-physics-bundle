// Small DOM helpers for walking cheerio/htmlparser2 node trees (XML mode).
// htmlparser2 is not namespace-aware: prefixed tag names ("col:module",
// "md:title", "m:math") are literal node names, which is what we rely on.

/** Element children of a node, in document order. */
export function childElements(node) {
  return (node.children || []).filter(c => c.type === 'tag');
}

/** First element child with the given tag name. */
export function childNamed(node, name) {
  return (node.children || []).find(c => c.type === 'tag' && c.name === name) || null;
}

/** Concatenated text content of a node (all descendant text). */
export function textOf(node) {
  if (!node) return '';
  if (node.type === 'text') return node.data;
  if (node.type === 'tag' || node.type === 'root') {
    return (node.children || []).map(textOf).join('');
  }
  return '';
}

/** Pre-order (document order) traversal over element nodes. */
export function walkElements(node, visit) {
  if (node.type === 'tag') visit(node);
  for (const child of node.children || []) {
    if (child.type === 'tag') walkElements(child, visit);
  }
}

/** True when the element's class attribute contains the given token. */
export function hasClass(node, token) {
  const cls = (node.attribs && node.attribs.class) || '';
  return cls.split(/\s+/).includes(token);
}
