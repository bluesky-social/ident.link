# Protocol and implementation reference

Compatibility target: ident.link draft dated **2026-10-22**. These are
implementation notes for the bundled helper, not additions to the draft.

- Agent DID `alsoKnownAs` entry: `https://ident.link/agent-of/<principal-did>`.
- Principal record collection: `link.ident.endorsement`.
- Record key: the agent DID; value: `{ "$type": "link.ident.endorsement", "agent": "<agent-did>" }`.
- Both halves are required. The principal endorsement's signed repository proof
  is fetched with `com.atproto.sync.getRecord` and verified using the official
  `@atproto/repo` package against the principal DID's signing key.
- Either party can revoke the relationship by removing its half. The helper
  creates bindings; revocation and account migration are outside its write scope.

Sources: [spec and schema](https://github.com/bluesky-social/ident.link/tree/41af2b3),
[OAuth](https://atproto.com/specs/oauth),
[permissions](https://atproto.com/specs/permission).

## API details that affect correctness

The principal grant is exactly `atproto repo:link.ident.endorsement?action=create`.
Use `createRecord` with the explicit agent DID key; `putRecord` requires both
create and update permissions even when the record does not exist. Existing
matching endorsements are verified; conflicting records are never overwritten.

The separate agent-operator grant is `atproto identity:*`. The agent runtime
must not receive it. `requestPlcOperationSignature` takes **no request body**;
send neither JSON nor `Content-Type`. `signPlcOperation` takes JSON containing
the operator-entered email token and reviewed identity fields.

The PLC update appends one alias, preserving all other aliases, rotation keys,
verification methods (including optional KEM and additional keys), and services.
The returned signed operation must match that plan. The helper compares fresh
PLC data immediately before submission and refuses to submit if it changed.

Loopback POST forms need their origin preserved: `Referrer-Policy: strict-origin`
avoids disclosing paths or queries while preserving the form Origin header.
The CSP allows form redirects only to the pinned authorization server origins.
It allows nonce-scoped inline CSS and no scripts or third-party assets.

All helper and OAuth/resolver HTTP requests use a public-only HTTPS dispatcher.
DNS results are checked at socket connection time and passed directly to the
connector, blocking private, link-local, mapped-private, and mixed address sets
without a second DNS lookup. Redirects and literal-address URLs are rejected.

Public identity snapshots can identify accounts. Runtime snapshots belong in
the operator's temporary audit directory, not in the redistributed package.

## Validation

In `scripts/`, run `npm test` and `npm run check`. Tests use reserved domains,
synthetic identities, and local/mock transports. They never sign into live
accounts, send confirmation emails, or publish identity changes.
