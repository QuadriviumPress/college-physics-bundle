/** HTML escaping for text nodes and attribute values. */
export function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(s) {
  return escapeText(s).replace(/"/g, '&quot;');
}

/** Build an attribute string from a {name: value} object, skipping null/undefined. */
export function attrs(map) {
  let out = '';
  for (const [k, v] of Object.entries(map)) {
    if (v === null || v === undefined || v === false) continue;
    out += ` ${k}="${escapeAttr(v)}"`;
  }
  return out;
}
