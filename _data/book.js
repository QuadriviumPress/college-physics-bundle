import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBook } from '../lib/book-data.js';

export default function () {
  const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  // The CNXML source lives in the `source/` submodule (a fork of
  // openstax/osbooks-college-physics-bundle), not the project root.
  return buildBook({ root: path.join(projectRoot, 'source') });
}
