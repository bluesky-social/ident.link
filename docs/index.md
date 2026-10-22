---
title: agent ↔ principal
subtitle: binding agents to their principal users
status: draft
updated: 2026-10-20
discussion: https://github.com/bluesky-social/ident.link
nav: { label: spec, order: 0 }
---

# Overview

A **principal** is a user that an agent acts on behalf of. This spec defines how to bind an agent to its principals and how each principal confirms that relationship.

The key words "MUST", "MUST NOT", "SHOULD", and "MAY" are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

## Background

The link between an agent and its principal has to resist tampering, whether malicious or accidental. This spec gets those properties from atproto, which draws inspiration from [Certificate Transparency](https://en.wikipedia.org/wiki/Certificate_Transparency) (no blockchain).

**DID documents are signed and auditable.** Every atproto account is identified by a [DID](https://atproto.com/specs/did), whose document lists the account's handle, signing key, and PDS. With [`did:plc`](https://web.plc.directory/spec/v0.1/did-plc), every change to that document is signed by one of the account's rotation keys and linked by hash to the operation before it, then published in an audit log.

**Repository records are self-certifying.** Records live in an account's [repository](https://atproto.com/specs/repository), whose commits are signed with the signing key published in the account's DID document.

## Agent declaration

An agent declares a principal with an entry in the `alsoKnownAs` array of its DID document:

```
https://ident.link/agent-of/<principal-did>
```

For example:

```jsonc
{
  "id": "did:plc:agent",
  "alsoKnownAs": [
    "at://agent.bob.com",
    "https://ident.link/agent-of/did:plc:bob"
  ],
  // ...
}
```

- `<principal-did>` MUST be a valid atproto DID.
- The entry MAY appear anywhere in the array. Handle resolution uses only the first `at://` entry, so the declaration does not affect the account's handle.

Because the declaration lives in the DID document, it is covered by the same controls as the account's identity. For `did:plc`, adding, changing, or removing it requires a signed PLC operation, which leaves an auditable history.

## Principal endorsement

The principal confirms the relationship by publishing a [`link.ident.endorsement`](/lexicons/#link.ident.endorsement) record in its repository:

```json
{
  "$type": "link.ident.endorsement",
  "agent": "did:plc:agent"
}
```

- The record key MUST be the agent's DID, so the endorsement can be fetched directly by its URI: `at://did:plc:bob/link.ident.endorsement/did:plc:agent`.
- The `agent` field MUST equal the record key.

A principal may endorse any number of agents, each with its own record.

## Verification

To find an agent's confirmed principals, a consumer resolves the agent's DID document and collects its `agent-of` entries. If there are none, the account has no declared principals. Then, for each entry, the consumer:

1. Extracts the principal's DID from the entry and resolves it to find the principal's PDS.
2. Fetches the endorsement record at `link.ident.endorsement/<agent-did>` from the principal's repository, and authenticates it against the principal's signing key (for example via `com.atproto.sync.getRecord`).
3. Checks that the record's `agent` field equals the agent's DID.

If every step succeeds, that relationship is confirmed. Otherwise it is unconfirmed, and consumers MUST NOT treat an unconfirmed declaration as identifying a principal.

## Multiple principals

An agent MAY act on behalf of more than one principal. It declares each with its own `agent-of` entry:

```json
{
  "id": "did:plc:agent",
  "alsoKnownAs": [
    "at://agent.bob.com",
    "https://ident.link/agent-of/did:plc:bob",
    "https://ident.link/agent-of/did:plc:alice"
  ]
}
```

- Each principal endorses the agent with its own record, and each relationship is verified independently. An unconfirmed entry does not affect the others.
- Entries naming the same DID are equivalent to a single entry.

## Revocation

Either party can end a relationship on its own, without affecting the agent's other relationships:

- The principal deletes its endorsement record.
- The agent removes that principal's `agent-of` entry from its DID document.

Consumers SHOULD re-verify periodically and SHOULD treat a relationship as unconfirmed if its endorsement can't be retrieved.

## Security considerations

Neither half is trustworthy alone. Anyone can write a declaration naming any principal, and a principal can endorse any DID. Only the pair establishes the relationship.

Placing the declaration in the DID document puts it inside the account's identity perimeter. A party that can write to the agent's repository, but not update its DID document, can't forge or alter the declaration.
