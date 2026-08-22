import fs from 'node:fs';
import * as cheerio from 'cheerio';
import { childElements, childNamed, textOf } from './xml-utils.js';

/**
 * Parse one CollXML collection file into a volume tree:
 *   { title, slug, frontMatter: [moduleId], units: [{ title, chapters: [{ title, moduleIds }] }],
 *     backMatter: [moduleId] }
 *
 * Two nesting shapes are supported:
 *  - Nested (University Physics): top-level <col:subcollection> units whose
 *    content is <col:subcollection> chapters whose content is only <col:module>.
 *  - Flat (Astronomy, Calculus, College Physics): top-level <col:subcollection>
 *    chapters whose content is only <col:module>. Flat chapters are coalesced
 *    into a single unit with an empty title so the TOC can omit unit labels.
 *
 * Bare <col:module> before the first subcollection are front matter; bare
 * modules after the last are back matter.
 */
export function parseCollection(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(xml, { xml: true });

  const root = $('col\\:collection').get(0);
  if (!root) throw new Error(`${filePath}: no <col:collection> root element`);

  const metadata = childNamed(root, 'metadata') || childNamed(root, 'col:metadata');
  if (!metadata) throw new Error(`${filePath}: no <metadata> or <col:metadata>`);
  const title = textOf(childNamed(metadata, 'md:title')).trim();
  const slug = textOf(childNamed(metadata, 'md:slug')).trim();
  if (!title || !slug) throw new Error(`${filePath}: missing md:title or md:slug`);

  const content = childNamed(root, 'col:content') || childNamed(root, 'content');
  if (!content) throw new Error(`${filePath}: no <col:content>`);
  const frontMatter = [];
  const units = [];
  const backMatter = [];

  for (const node of childElements(content)) {
    if (node.name === 'col:module') {
      (units.length === 0 ? frontMatter : backMatter).push(node.attribs.document);
    } else if (node.name === 'col:subcollection') {
      if (backMatter.length > 0) {
        throw new Error(`${filePath}: subcollection found after back-matter modules`);
      }
      units.push(parseSubcollection(node, filePath));
    } else {
      throw new Error(`${filePath}: unexpected <${node.name}> in col:content`);
    }
  }

  return { title, slug, frontMatter, units: coalesceFlatUnits(units), backMatter };
}

/**
 * When every top-level subcollection was a flat chapter (empty unit title,
 * one chapter each), merge them into a single untitled unit so chapter
 * numbers stay continuous and the TOC skips redundant unit labels.
 */
function coalesceFlatUnits(units) {
  if (units.length === 0) return units;
  if (!units.every(u => u.title === '' && u.chapters.length === 1)) return units;
  return [{ title: '', chapters: units.flatMap(u => u.chapters) }];
}

function parseSubcollection(node, filePath) {
  const title = textOf(childNamed(node, 'md:title')).trim();
  const content = childNamed(node, 'col:content');
  const children = childElements(content);

  if (children.length === 0) {
    throw new Error(`${filePath}: subcollection "${title}" has empty content`);
  }

  // Flat chapter: modules live directly under this subcollection.
  if (children.every(c => c.name === 'col:module')) {
    return {
      title: '',
      chapters: [{ title, moduleIds: children.map(c => c.attribs.document) }],
    };
  }

  // Nested unit: children are chapter subcollections.
  const chapters = [];
  for (const child of children) {
    if (child.name !== 'col:subcollection') {
      throw new Error(
        `${filePath}: unit "${title}" contains <${child.name}>, expected chapters or modules`
      );
    }
    const chapterTitle = textOf(childNamed(child, 'md:title')).trim();
    const chapterContent = childNamed(child, 'col:content');
    const moduleIds = [];
    for (const m of childElements(chapterContent)) {
      if (m.name !== 'col:module') {
        throw new Error(`${filePath}: chapter "${chapterTitle}" contains <${m.name}>, expected modules`);
      }
      moduleIds.push(m.attribs.document);
    }
    chapters.push({ title: chapterTitle, moduleIds });
  }

  return { title, chapters };
}
