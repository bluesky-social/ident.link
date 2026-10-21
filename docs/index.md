---
title: agent principal
subtitle: identifying the users an agent acts on behalf of
status: draft
updated: 2026-10-20
discussion: https://github.com/bluesky-social/agentid.at
nav: { label: spec, order: 0 }
---

# Overview

This spec defines how an atproto account declares that it is a software agent acting on behalf of one or more other accounts, its **principals**, and how each principal confirms that relationship.

Each agent–principal relationship has two halves:

1. The agent names the principal in its DID document.
2. The principal endorses the agent with a record in its repository.

A relationship is **confirmed** only when both halves are present and agree. An agent with several principals has several independent relationships, each confirmed on its own.

A confirmed relationship establishes a chain of responsibility: the principal is a party to contact about the agent's behavior. It grants no standard privileges. Applications may treat it as a form of authorization in either direction, such as an agent updating its principal's calendar or a principal renaming its agent. Future specs may define standard privileges.

The key words "MUST", "MUST NOT", "SHOULD", and "MAY" are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

## Background

The link between an agent and its principal has to resist tampering, whether malicious or accidental. This spec gets that from properties atproto already provides.

**DID documents are signed and auditable.** Every atproto account is identified by a [DID](https://atproto.com/specs/did), whose document lists the account's handle, signing key, and PDS. With [`did:plc`](https://web.plc.directory/spec/v0.1/did-plc), every change to that document is an operation signed by one of the account's rotation keys and linked by hash to the operation before it. The PLC directory publishes each DID's full operation history as an audit log, so anyone can see when a declaration was added or removed and which key authorized it.

**Repository records are self-certifying.** Records live in an account's [repository](https://atproto.com/specs/repository), whose commits are signed with the signing key published in the account's DID document. Any record can be authenticated through a proof chain back to a signed commit, so a consumer can verify an endorsement without trusting the server that delivered it.

## Agent declaration

An agent declares a principal with an entry in the `alsoKnownAs` array of its DID document:

```
https://agentid.at/agent-of/<principal-did>
```

For example:

```json
{
  "id": "did:plc:agent",
  "alsoKnownAs": [
    "at://helper.example.com",
    "https://agentid.at/agent-of/did:plc:bob"
  ]
}
```

- `<principal-did>` MUST be a valid atproto DID.
- The entry MAY appear anywhere in the array. Handle resolution uses only the first `at://` entry, so the declaration does not affect the account's handle.

Because the declaration lives in the DID document, it is covered by the same controls as the account's identity. For `did:plc`, adding, changing, or removing it requires a signed PLC operation, which leaves an auditable history.

## Principal endorsement

The principal confirms the relationship by publishing an [`at.agentid.endorsement`](/lexicons/#at.agentid.endorsement) record in its repository:

```json
{
  "$type": "at.agentid.endorsement",
  "agent": "did:plc:agent"
}
```

- The record key MUST be the agent's DID, so the endorsement can be fetched directly by its URI: `at://did:plc:bob/at.agentid.endorsement/did:plc:agent`.
- The `agent` field MUST equal the record key.

A principal may endorse any number of agents, each with its own record.

## Verification

To find an agent's confirmed principals, a consumer resolves the agent's DID document and collects its `agent-of` entries. If there are none, the account has no declared principals. Then, for each entry, the consumer:

1. Extracts the principal's DID from the entry and resolves it to find the principal's PDS.
2. Fetches the endorsement record at `at.agentid.endorsement/<agent-did>` from the principal's repository, and authenticates it against the principal's signing key (for example via `com.atproto.sync.getRecord`).
3. Checks that the record's `agent` field equals the agent's DID.

If every step succeeds, that relationship is confirmed. Otherwise it is unconfirmed, and consumers MUST NOT treat an unconfirmed declaration as identifying a principal.

## Multiple principals

An agent MAY act on behalf of more than one principal. It declares each with its own `agent-of` entry:

```json
{
  "id": "did:plc:agent",
  "alsoKnownAs": [
    "at://helper.example.com",
    "https://agentid.at/agent-of/did:plc:bob",
    "https://agentid.at/agent-of/did:plc:alice"
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

## Appendix: alternatives considered

The declaration could instead be a DID document service entry:

```json
{
  "id": "#principal",
  "type": "https://agentid.at/agent-of",
  "serviceEndpoint": "did:plc:bob"
}
```

This works the same way, but a principal is not a service endpoint, so the `alsoKnownAs` form was chosen as the more natural fit.
