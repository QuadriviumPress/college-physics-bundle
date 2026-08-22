import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { childNamed, textOf } from './xml-utils.js';

const CNXML_NS = 'xmlns="http://cnx.rice.edu/cnxml"';
const MATHML_NS = 'xmlns:m="http://www.w3.org/1998/Math/MathML"';

// Parse cache keyed by module id; invalidated by file mtime so dev-server
// rebuilds only re-parse edited modules.
const cache = new Map();

/**
 * Load and parse modules/<id>/index.cnxml.
 * Returns { id, docClass, title, abstract (element node or null), content (element node) }.
 */
export function loadModule(root, id) {
  const file = path.join(root, 'modules', id, 'index.cnxml');
  const { mtimeMs } = fs.statSync(file);
  const hit = cache.get(id);
  if (hit && hit.mtimeMs === mtimeMs) return hit.value;

  const xml = fs.readFileSync(file, 'utf8');

  // htmlparser2 treats namespace prefixes as literal tag names, which is only
  // safe while the corpus declares the expected namespaces with the expected
  // prefixes. Fail loudly if an upstream merge ever changes that.
  if (!xml.includes(CNXML_NS)) {
    throw new Error(`${file}: expected ${CNXML_NS} on <document>`);
  }
  if (xml.includes('<m:math') && !xml.includes(MATHML_NS)) {
    throw new Error(`${file}: <m:math> used without ${MATHML_NS}`);
  }

  const $ = cheerio.load(xml, { xml: true });
  const docEl = $('document').get(0);
  if (!docEl) throw new Error(`${file}: no <document> root element`);

  const metadata = childNamed(docEl, 'metadata');
  const abstractEl = childNamed(metadata, 'md:abstract');
  const value = {
    id,
    docClass: (docEl.attribs && docEl.attribs.class) || null,
    title: textOf(childNamed(metadata, 'md:title')).trim() || textOf(childNamed(docEl, 'title')).trim(),
    abstract: abstractEl && (abstractEl.children || []).some(c => c.type === 'tag') ? abstractEl : null,
    content: childNamed(docEl, 'content'),
    // <glossary> is a sibling of <content>, not a child.
    glossary: childNamed(docEl, 'glossary'),
  };

  cache.set(id, { mtimeMs, value });
  return value;
}
