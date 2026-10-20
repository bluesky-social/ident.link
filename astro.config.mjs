// @ts-check
import { defineConfig } from 'astro/config';
import { satteri } from '@astrojs/markdown-satteri';
import markdownStylePlugin from './src/lib/markdown-style-plugin.mjs';
import shikiTheme from './src/lib/shiki-theme.mjs';

export default defineConfig({
  site: 'https://agentid.at',
  // Static output: Cloudflare Pages serves ./dist directly, no adapter needed.
  output: 'static',
  markdown: {
    shikiConfig: { theme: shikiTheme },
    // mermaid blocks are left as plain code and rendered in the browser (src/lib/mermaid.ts)
    syntaxHighlight: { type: 'shiki', excludeLangs: ['math', 'mermaid'] },
    processor: satteri({
      hastPlugins: [markdownStylePlugin],
      // keep straight quotes, as in markdown source
      features: { smartPunctuation: false },
    }),
  },
});
