import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { markdownResponse } from '../../lib/markdown-source';

// /specs/<name>.md: the markdown source of each spec
export const getStaticPaths = (async () => {
  const specs = await getCollection('specs');
  return specs.map((spec) => ({ params: { slug: spec.id }, props: { spec } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) => markdownResponse((props as { spec: CollectionEntry<'specs'> }).spec);
