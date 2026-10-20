import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { formatDate } from '../lib/meta';

// /specs.md: markdown index of every spec, mirroring /specs/
export const GET: APIRoute = async () => {
  const specs = (await getCollection('specs')).sort((a, b) => a.data.title.localeCompare(b.data.title));
  const rows = specs.map((s) =>
    [
      `[${s.data.title}](/specs/${s.id}.md)`,
      s.data.status ?? '',
      s.data.updated ? formatDate(s.data.updated) : '',
      s.data.subtitle ?? '',
    ].join(' | '),
  );
  const body = [
    '# Specs',
    '',
    'spec | status | updated | summary',
    '--- | --- | --- | ---',
    ...rows,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
