import type { CollectionEntry } from 'astro:content';

// One row of the YAML-frontmatter block shown at the top of each page.
export interface MetaRow {
  key: string;
  value: string;
  href?: string;
  big?: boolean;
}

type PageData = CollectionEntry<'docs'>['data'] | CollectionEntry<'specs'>['data'];

export const formatDate = (d: Date) => d.toISOString().slice(0, 10);

export function docMeta(data: PageData): MetaRow[] {
  const rows: MetaRow[] = [{ key: 'title', value: data.title, big: true }];
  if (data.subtitle) rows.push({ key: 'subtitle', value: data.subtitle });
  if (data.status) rows.push({ key: 'status', value: data.status });
  if (data.updated) rows.push({ key: 'updated', value: formatDate(data.updated) });
  if (data.discussion) {
    rows.push({ key: 'discussion', value: data.discussion.replace(/^https?:\/\//, ''), href: data.discussion });
  }
  return rows;
}
