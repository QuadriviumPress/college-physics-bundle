import { loadModule } from '../parse/module.js';
import { slugify } from './slugs.js';
import { childNamed, textOf, hasClass } from '../parse/xml-utils.js';

/**
 * Pass 1: walk the volume trees in reading order and produce
 *  - pages: every (volume, module) occurrence with slug/url/titles
 *  - tocVolumes: the tree the summary/volume templates render
 *  - anchors: `${moduleId}#${elementId}` -> { moduleId, text } for link-text synthesis
 *  - moduleRefText: moduleId -> text for self-closing <link document=.../> links
 *  - numbersByOccurrence: `${volumeSlug}:${moduleId}` -> WeakMap(element -> number)
 *    so a shared module reused in another volume is renumbered for that volume's
 *    chapter scope (College Physics shares most modules across both books)
 *  - pagesByModule: moduleId -> [page occurrences] for cross-module URL resolution
 *
 * Numbering rules (chapter-scoped, spanning all modules of a chapter, intro first):
 * figures/tables/equations without class "unnumbered", all examples, and
 * check-understanding notes each get `${chapter}.${seq}`. Appendices use the
 * appendix letter with no dot ("A1", "B2"); front matter a bare sequence.
 */
export function buildModel(root, collections) {
  const warnings = [];
  const anchors = new Map();
  const moduleRefText = new Map();
  const numbersByOccurrence = new Map();
  const pagesByModule = new Map();
  const pages = [];
  const tocVolumes = [];
  const scannedModules = new Set();
  const renderList = [];

  for (const vol of collections) {
    const volUrl = `/${vol.slug}/`;
    const tocVol = {
      slug: vol.slug,
      title: vol.title,
      url: volUrl,
      permalink: `${volUrl}index.html`,
      cover: `/cover/${vol.slug}-cover.jpg`,
      front: [],
      units: [],
      back: [],
    };
    tocVolumes.push(tocVol);

    const addPage = (moduleId, slug, displayTitle, sidebarTitle) => {
      const url = `${volUrl}${slug}/`;
      const page = {
        moduleId,
        volumeSlug: vol.slug,
        volumeTitle: vol.title,
        slug,
        url,
        permalink: `${url}index.html`,
        displayTitle,
        sidebarTitle,
      };
      pages.push(page);
      if (!pagesByModule.has(moduleId)) pagesByModule.set(moduleId, []);
      pagesByModule.get(moduleId).push(page);
      return page;
    };

    // Scan every (volume, module) occurrence so shared modules pick up this
    // volume's chapter prefix. Anchors / moduleRefText still first-wins.
    const scanOccurrence = (moduleId, scope, refText) => {
      if (!moduleRefText.has(moduleId)) moduleRefText.set(moduleId, refText);
      if (!scannedModules.has(moduleId)) {
        scannedModules.add(moduleId);
        renderList.push({ moduleId, volumeSlug: vol.slug });
      }
      const numberByNode = new WeakMap();
      numbersByOccurrence.set(`${vol.slug}:${moduleId}`, numberByNode);
      scanModule(root, moduleId, scope, { anchors, numberByNode, warnings });
    };

    // Front matter (preface). Shared across volumes; scanned/rendered once.
    for (const moduleId of vol.frontMatter) {
      const mod = loadModule(root, moduleId);
      const slug = mod.docClass === 'preface' ? 'preface' : slugify(mod.title);
      const page = addPage(moduleId, slug, mod.title, mod.title);
      tocVol.front.push(page);
      scanOccurrence(moduleId, { prefix: '', counters: newCounters() }, mod.title);
    }

    // Units -> chapters -> modules. Chapter numbers are continuous across units
    // and restart per volume.
    let chapterNumber = 0;
    for (const unit of vol.units) {
      const tocUnit = { title: unit.title, chapters: [] };
      tocVol.units.push(tocUnit);

      for (const chapter of unit.chapters) {
        chapterNumber += 1;
        const counters = newCounters();
        const scope = { prefix: `${chapterNumber}.`, counters };
        const tocChapter = { number: chapterNumber, title: chapter.title, url: null, sections: [] };
        tocUnit.chapters.push(tocChapter);

        chapter.moduleIds.forEach((moduleId, i) => {
          const mod = loadModule(root, moduleId);
          if (i === 0) {
            if (mod.docClass !== 'introduction') {
              warnings.push(`${vol.slug} ch.${chapterNumber}: first module ${moduleId} is not class="introduction"`);
            }
            const page = addPage(moduleId, `${chapterNumber}-introduction`, mod.title, chapter.title);
            tocChapter.url = page.url;
            scanOccurrence(moduleId, scope, `Chapter ${chapterNumber} ${chapter.title}`);
          } else {
            const sectionNumber = i;
            const page = addPage(
              moduleId,
              `${chapterNumber}-${sectionNumber}-${slugify(mod.title)}`,
              `${chapterNumber}.${sectionNumber} ${mod.title}`,
              mod.title
            );
            tocChapter.sections.push(page);
            scanOccurrence(moduleId, scope, `${chapterNumber}.${sectionNumber} ${mod.title}`);
          }
        });
      }
    }

    // Back matter (appendices), lettered A, B, C... per volume order.
    vol.backMatter.forEach((moduleId, i) => {
      const mod = loadModule(root, moduleId);
      const letter = String.fromCharCode(65 + i); // A..
      const title = `Appendix ${letter}: ${mod.title}`;
      const page = addPage(moduleId, `${letter.toLowerCase()}-${slugify(mod.title)}`, title, title);
      tocVol.back.push(page);
      scanOccurrence(moduleId, { prefix: letter, counters: newCounters() }, title);
    });
  }

  return {
    pages,
    tocVolumes,
    anchors,
    moduleRefText,
    numbersByOccurrence,
    pagesByModule,
    renderList,
    warnings,
  };
}

function newCounters() {
  return { figure: 0, table: 0, equation: 0, example: 0, cyu: 0 };
}

/**
 * Walk one module's <content> in document order: assign numbers to numbered
 * objects and register every id-bearing element in the anchor map with the
 * best available reference text (own number, else enclosing numbered object,
 * else enclosing section title, else the module title).
 */
function scanModule(root, moduleId, scope, { anchors, numberByNode, warnings }) {
  const mod = loadModule(root, moduleId);
  if (!mod.content) {
    warnings.push(`${moduleId}: module has no <content>`);
    return;
  }

  const visit = (el, inherited) => {
    let own = null;
    switch (el.name) {
      case 'figure':
        if (!hasClass(el, 'unnumbered')) own = { label: 'Figure', n: ++scope.counters.figure };
        break;
      case 'table':
        if (!hasClass(el, 'unnumbered')) own = { label: 'Table', n: ++scope.counters.table };
        break;
      case 'equation':
        if (!hasClass(el, 'unnumbered')) own = { label: 'Equation', n: ++scope.counters.equation };
        break;
      case 'example':
        own = { label: 'Example', n: ++scope.counters.example };
        break;
      case 'note':
        if (hasClass(el, 'check-understanding')) {
          own = { label: 'Check Your Understanding', n: ++scope.counters.cyu };
        }
        break;
    }

    let context = inherited;
    if (own) {
      const number = `${scope.prefix}${own.n}`;
      numberByNode.set(el, number);
      context = { ...inherited, ref: `${own.label} ${number}` };
    } else if (el.name === 'section') {
      const title = textOf(childNamed(el, 'title')).trim();
      if (title) context = { ...inherited, sectionTitle: title };
    }

    const id = el.attribs && el.attribs.id;
    if (id) {
      const text = context.ref || context.sectionTitle || mod.title;
      const key = `${moduleId}#${id}`;
      if (!anchors.has(key)) anchors.set(key, { moduleId, text });
    }

    for (const child of el.children || []) {
      if (child.type === 'tag') visit(child, context);
    }
  };

  for (const child of mod.content.children || []) {
    if (child.type === 'tag') visit(child, { ref: null, sectionTitle: null });
  }
  if (mod.glossary) {
    visit(mod.glossary, { ref: null, sectionTitle: 'Glossary' });
  }
}
