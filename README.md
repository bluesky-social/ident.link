# ident.link

Source for the [ident.link](https://ident.link) site, a static Astro build hosted on Cloudflare Workers.

```
docs/          markdown pages → rendered into the site (docs/index.md is the spec, at /)
lexicons/      lexicon schemas published under ident.link, laid out by NSID
src/           layout, styles, and routes
public/        static files copied as-is (favicon, Cloudflare _headers)
```

## Develop

```sh
npm install
npm run dev
```

## Docs

Each `docs/**/*.md` file becomes a page: `docs/index.md` is `/`, `docs/about.md` is `/about/`.
Frontmatter:

```yaml
title: about                   # required
subtitle: about the project    # optional; these fields show in the page's frontmatter block
status: draft 01
updated: 2026-10-20
discussion: https://github.com/bluesky-social/ident.link
nav: { label: about, order: 10 } # optional; adds the page to the header nav
```

Write normal markdown (GFM tables and task lists work too). The styles put the markdown
punctuation back in (`#`, `-`, `>`, `[ ]`). Top-level and `##` headings go in the
"on this page" sidebar.

## Markdown for agents

Every docs page is also served as its original markdown file: add `.md` to the page's path
(`/index.md` for the home page). Each HTML page advertises its markdown version with
`<link rel="alternate" type="text/markdown">`.

## Lexicons

Put each schema at `lexicons/<nsid path>.json`, e.g. `link.ident.endorsement` goes in
`lexicons/link/ident/endorsement.json`. The build fails if a file's `id` doesn't match its path.

The site lists every schema at `/lexicons/` and serves each one as raw JSON at
`/lexicons/<nsid>.json` (with CORS open).

## Principal-binding skill

`skills/atproto-principal-binding/` contains a reusable skill and local operator
helper. `docs/setup.md` explains its use. The helper resolves explicit account
inputs; the source and download contain no configured accounts or runtime data.

`npm run pack:skill` builds the downloadable archive and individually readable
skill files from an explicit source-file allowlist. `npm run build` and
`npm run dev` run this packaging step automatically. Generated downloads are
ignored by Git. The archive excludes dependencies, local state, and public
account snapshots; npm dependencies are installed from its pinned lockfile.

Validate the helper separately:

```sh
npm ci --prefix skills/atproto-principal-binding/scripts --ignore-scripts --no-audit --no-fund
npm test --prefix skills/atproto-principal-binding/scripts
npm run check --prefix skills/atproto-principal-binding/scripts
```

Under atproto lexicon resolution, a lexicon is fetched from the network rather than from
this website: the `_lexicon.ident.link` DNS TXT record names a DID, and that account's repo
holds `com.atproto.lexicon.schema` records keyed by NSID. The files here are the source of
truth for what gets published there.

## Deploy (Cloudflare Pages)

In the Pages project settings:

- Build command: `npm run build`
- Build output directory: `dist`

Or deploy from your machine with `npx wrangler pages deploy` (`wrangler.toml` already points it at `./dist`).
