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
npm run dev # Astro pages only
```

The pair-check endpoint is a Rust Worker that serves JSON or the static HTML
shell at the same URL, according to `Accept`. To run it locally, install the
WebAssembly target and the Workers build tool once, then build the site and
start Wrangler:

```sh
rustup target add wasm32-unknown-unknown
cargo install worker-build --version 0.9.0 --locked
npm run build
npx wrangler dev
```

Run the pair-check tests without network access with:

```sh
cargo test --manifest-path worker/Cargo.toml
```

## Pair check

`GET /agent-of/<principal-did>/endorses/<agent-did>` returns HTML to browsers
and JSON to requests for `application/json`, `*/*`, or no `Accept` header. The
HTML page fetches JSON from the same URL. The Worker resolves the two DIDs and
reads the endorsement with `com.atproto.repo.getRecord` from the principal's
PDS, using [`rust-tools`](https://github.com/bluesky-social/rust-tools) for
identity and outbound requests. It does not verify a signed repository proof.
An unavailable upstream is a 503, not a negative confirmation. Successful JSON
responses may be cached by the browser for 30 seconds; they are not cached in
the shared edge cache.

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

Under atproto lexicon resolution, a lexicon is fetched from the network rather than from
this website: the `_lexicon.ident.link` DNS TXT record names a DID, and that account's repo
holds `com.atproto.lexicon.schema` records keyed by NSID. The files here are the source of
truth for what gets published there.

## Deploy (Cloudflare Workers)

`npm run deploy` builds the Astro assets and uses Wrangler to build and deploy
the Rust Worker and assets together. The Worker build requires `worker-build`
and the WebAssembly target described above. Cloudflare Workers Builds installs
a pinned Rust toolchain and `worker-build` automatically.
