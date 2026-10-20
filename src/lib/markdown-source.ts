import { readFile } from 'node:fs/promises';
import type { CollectionEntry } from 'astro:content';

// Serve a page's original markdown file (frontmatter included) so agents can read it directly.
export async function markdownResponse(entry: CollectionEntry<'docs'> | CollectionEntry<'specs'>) {
  if (!entry.filePath) throw new Error(`${entry.collection}/${entry.id}: no source file`);
  return new Response(await readFile(entry.filePath, 'utf8'), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}

// Where a page's markdown lives: the page path with ".md" appended (the home page is /index.md).
export const markdownHref = (pagePath: string) =>
  pagePath === '/' ? '/index.md' : `${pagePath.replace(/\/$/, '')}.md`;
