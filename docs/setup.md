---
title: setup
subtitle: a local helper and a reusable agent skill
status: draft
updated: 2026-10-22
nav: { label: setup, order: 10 }
---

# Set up an agent binding

The setup helper connects an existing agent account to its principal using
the [agent ↔ principal draft](/). You review the public endorsement and DID
declaration locally, sign in through each account's PDS, and confirm the DID
change by email. A live status panel checks both halves and verifies the
endorsement's repository signature.

The helper is a local Node.js application. Passwords stay on the PDS sign-in
page; temporary operator grants stay in process memory. After the binding
verifies, the helper revokes those grants automatically. There is no manual
cleanup step.

## Give it to an agent

Share the [skill instructions](/skills/atproto-principal-binding/SKILL.md),
or download the complete [skill and helper archive](/downloads/atproto-principal-binding.tar.gz).
The archive contains `SKILL.md`, the helper, pinned npm dependencies, protocol
notes, and tests. It contains no configured accounts or runtime data.

The source lives in
[`skills/atproto-principal-binding`](https://github.com/bluesky-social/ident.link/tree/main/skills/atproto-principal-binding).
Install that folder with your agent's skill installer, or let the agent read
the instructions and run the bundled helper in a local directory.

Tell the agent which account is the agent and which is the principal. It can
prepare the flow and verify the result; the operator signs in and approves
the changes. Reading the skill does not grant permission to change an account.

## Run it yourself

Requires Node.js 22+ and npm. Download and inspect the archive, then:

```sh
tar -xzf atproto-principal-binding.tar.gz
cd atproto-principal-binding/scripts
npm ci --ignore-scripts --no-audit --no-fund
node bind.mjs --agent '<agent-handle>' --principal '<principal-handle>'
```

Replace the placeholders and open the printed loopback URL. Both accounts
must support AT Protocol OAuth and public HTTPS hosting. The helper currently
supports PLC agent identities; `did:web` agents need an operator-managed DID
document edit. No Spaces support is required for the binding itself.

## Check a binding

The top of the local page looks up both accounts each time it loads. Use
**Check again** for a fresh lookup. A failed lookup is shown as unavailable,
not as a missing record or a confirmed relationship.

For a public verification without sign-in or write permissions:

```sh
node bind.mjs --agent '<agent-handle>' --principal '<principal-handle>' --verify-only
```

## Operator permissions

The principal grant permits only endorsement creation. The agent-operator
grant permits identity changes and is kept separate from the agent runtime.
The helper preserves existing keys, aliases, rotation keys, and hosting.

Stop the helper with Ctrl-C to cancel; it attempts to revoke any operator
grants. A forced kill or machine crash cannot guarantee remote revocation—
remove a surviving setup grant at the PDS if that occurs. Never share account
snapshots, session tokens, passwords, or email codes with a redistributed skill.
