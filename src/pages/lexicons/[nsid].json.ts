import type { APIRoute, GetStaticPaths } from 'astro';
import { lexicons, type LexiconDoc } from '../../lib/lexicons';

// Serves each schema in ./lexicons as raw JSON at /lexicons/<nsid>.json
export const getStaticPaths = (() =>
  lexicons.map((lex) => ({ params: { nsid: lex.id }, props: { lex } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify((props as { lex: LexiconDoc }).lex, null, 2) + '\n', {
    headers: { 'Content-Type': 'application/json' },
  });
