import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { markdownResponse } from '../lib/markdown-source';

// /index.md, /about.md, ...: the markdown source of each docs page
export const getStaticPaths = (async () => {
  const docs = await getCollection('docs');
  return docs.map((doc) => ({ params: { slug: doc.id }, props: { doc } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) => markdownResponse((props as { doc: CollectionEntry<'docs'> }).doc);
