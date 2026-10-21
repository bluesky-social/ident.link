import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Frontmatter shown in the block at the top of each page.
const page = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  status: z.string().optional(),
  updated: z.coerce.date().optional(),
  discussion: z.string().url().optional(),
});

// Every markdown file in ./docs becomes a page: docs/index.md -> /, docs/about.md -> /about/
const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './docs' }),
  schema: page.extend({
    // Include the page in the header nav, ordered by `order`.
    nav: z.object({ label: z.string(), order: z.number() }).optional(),
  }),
});

export const collections = { docs };
