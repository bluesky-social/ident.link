---
name: atproto-principal-binding
description: Set up or verify an AT Protocol agent-to-principal identity binding using the ident.link draft, operator OAuth, and email confirmation. Use when linking an agent account to its human principal; this does not configure agent memory or grant runtime tools.
---

# AT Protocol principal binding

Use the bundled local helper to link an existing agent account to an existing
principal account. The operator approves the public endorsement, the agent DID
declaration, and the temporary OAuth grants. The helper verifies both halves
and revokes its grants automatically after successful setup.

## Inputs and compatibility

Obtain the agent and principal handles or DIDs from the user. Never infer that
the currently signed-in account is the principal. Both accounts need public
HTTPS PDS hosting with AT Protocol OAuth and loopback-client support. They may
have different PDS and authorization servers. This helper supports `did:plc`
agents; a `did:web` agent requires an operator-managed DID document edit.
Principals may use either DID method supported by the official resolver.

This implements the [ident.link draft](https://ident.link/) dated 2026-10-22.
Before using it with a later draft, compare its declaration and endorsement
formats with [the protocol reference](references/protocol.md). Stop on an
incompatible change rather than improvising an identity mutation.

## Run locally

Requires Node.js 22+ and npm. In this skill's `scripts/` directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node bind.mjs --agent '<agent-handle>' --principal '<principal-handle>' --check-only
node bind.mjs --agent '<agent-handle>' --principal '<principal-handle>'
```

Substitute the operator's inputs; quote each argument. `--check-only` resolves
identities and hosting without authorization or writes. Open the printed
loopback address, normally `http://127.0.0.1:8767`. Use `--port` if occupied.
Do not stop unrelated local services to make room.

The top panel performs a fresh public lookup of both halves on each page load.
“Missing” and “unavailable” have different meanings; a lookup or signature
failure must never be reported as an absent record or a confirmed binding.
The **Check again** button repeats the lookup without signing in.

Let the operator use the page to:

1. Sign in as principal and approve creation of the endorsement record. If a
   matching signed endorsement already exists, this sign-in is unnecessary.
2. Sign in separately as the agent's operator and request the identity email.
3. Review the exact principal declaration, enter the email code in the local
   page, and approve the identity update.

Keep passwords and confirmation codes out of chat, shell arguments, source,
and logs. Do not automate consent for the elevated `identity:*` grant or hand
that grant to the agent runtime. Operator OAuth state and tokens remain only
in memory. Stopping the helper loses those sessions and attempts revocation;
restart and sign in again if needed. Forced termination or a crash cannot
guarantee remote revocation; remove a surviving setup grant at the PDS.

## Verify and finish

Successful setup verifies the principal's repository proof against its DID
signing key, checks the agent declaration, and revokes both operator grants.
There is no separate cleanup button. To verify later without any grant:

```sh
node bind.mjs --agent '<agent-handle>' --principal '<principal-handle>' --verify-only
```

Report confirmation only when both halves verify. The normal agent credentials
are separate and must continue to exclude identity-management access.

On an error, check the live panel before retrying; a write may have succeeded
before a later verification failed. Keep any published endorsement. Do not
overwrite conflicting records, expand scopes to make an API call work, or
repeat failed remote writes automatically. Preserve all existing DID keys,
rotation keys, aliases, and service endpoints. The helper stores a public
pre-change PLC snapshot in its printed temporary audit directory (or
`--audit-directory`), never tokens or email codes. Do not include those
account-specific snapshots in redistributed skills or archives.
