# agentid.at

Source for the [agentid.at](https://agentid.at) site, a static Astro build hosted on Cloudflare Pages.

```
docs/          markdown pages → rendered into the site
lexicons/      lexicon schemas published under agentid.at, laid out by NSID
design/        original HTML design mock (reference only)
src/           layout, styles, and routes
public/        static files copied as-is (favicon, Cloudflare _headers)
```

## Develop

```sh
npm install
npm run dev
```

## Docs

Each `docs/**/*.md` file becomes a page: `docs/index.md` is `/`, `docs/faq.md` is `/faq/`.
Frontmatter:

```yaml
title: faq                     # required
subtitle: common questions     # optional; these fields show in the page's frontmatter block
status: draft 01
updated: 2026-10-20
discussion: https://github.com/agentid-at/spec
nav: { label: faq, order: 10 } # optional; adds the page to the header nav
```

Write normal markdown (GFM tables and task lists work too). The styles put the markdown
punctuation back in (`#`, `-`, `>`, `[ ]`). Top-level and `##` headings go in the
"on this page" sidebar.

## Lexicons

Put each schema at `lexicons/<nsid path>.json`, e.g. `at.agentid.endorsement` goes in
`lexicons/at/agentid/endorsement.json`. The build fails if a file's `id` doesn't match its path.

The site lists every schema at `/lexicons/` and serves each one as raw JSON at
`/lexicons/<nsid>.json` (with CORS open).

Under atproto lexicon resolution, a lexicon is fetched from the network rather than from
this website: the `_lexicon.agentid.at` DNS TXT record names a DID, and that account's repo
holds `com.atproto.lexicon.schema` records keyed by NSID. The files here are the source of
truth for what gets published there.

## Deploy (Cloudflare Pages)

In the Pages project settings:

- Build command: `npm run build`
- Build output directory: `dist`

Or deploy from your machine with `npx wrangler pages deploy` (`wrangler.toml` already points it at `./dist`).
