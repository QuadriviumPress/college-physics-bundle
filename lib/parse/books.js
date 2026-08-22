import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';

/**
 * Parse META-INF/books.xml — the bundle manifest listing the three volumes.
 * Returns [{ slug, collectionId, file }] in manifest order (volume 1, 2, 3).
 */
export function parseBooks(root) {
  const manifestPath = path.join(root, 'META-INF', 'books.xml');
  const xml = fs.readFileSync(manifestPath, 'utf8');
  const $ = cheerio.load(xml, { xml: true });

  const books = $('book')
    .map((_, el) => ({
      slug: el.attribs.slug,
      collectionId: el.attribs['collection-id'],
      file: path.resolve(path.dirname(manifestPath), el.attribs.href),
    }))
    .get();

  if (books.length === 0) {
    throw new Error(`No <book> entries found in ${manifestPath}`);
  }
  return books;
}
