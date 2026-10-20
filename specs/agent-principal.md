---
title: agent principal
subtitle: identifying the user an agent acts on behalf of
status: draft
updated: 2026-10-20
discussion: https://github.com/bluesky-social/agentid.at
---

# Overview

This spec defines how an atproto account declares that it is a software agent acting on behalf of another account, its **principal**, and how the principal confirms that relationship.

The relationship has two halves:

1. The agent names its principal in its DID document.
2. The principal endorses the agent with a record in its repository.

A relationship is **confirmed** only when both halves are present and agree.

A confirmed relationship establishes a chain of responsibility: the principal is the party to contact about the agent's behavior. It grants no standard privileges. Applications may treat it as a form of authorization in either direction, such as an agent updating its principal's calendar or a principal renaming its agent. Future specs may define standard privileges.

The key words "MUST", "MUST NOT", "SHOULD", and "MAY" are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

## Agent declaration

An agent declares its principal with an entry in the `alsoKnownAs` array of its DID document:

```
https://agentid.at/agent-of/<principal-did>
```

For example:

```json
{
  "id": "did:plc:agent456",
  "alsoKnownAs": [
    "at://helper.example.com",
    "https://agentid.at/agent-of/did:plc:principal123"
  ]
}
```

- `<principal-did>` MUST be a valid atproto DID.
- A DID document MUST NOT contain more than one `agent-of` entry. Consumers MUST treat a document with multiple entries as having no declaration.
- The entry MAY appear anywhere in the array. Handle resolution uses only the first `at://` entry, so the declaration does not affect the account's handle.

Because the declaration lives in the DID document, it is covered by the same controls as the account's identity. For `did:plc`, changing or removing it requires a signed PLC operation, which leaves an auditable history.

## Principal endorsement

The principal confirms the relationship by publishing an [`at.agentid.endorsement`](/lexicons/#at.agentid.endorsement) record in its repository:

```json
{
  "$type": "at.agentid.endorsement",
  "agent": "did:plc:agent456"
}
```

- The record key MUST be the agent's DID, so the endorsement can be fetched directly by its URI: `at://did:plc:principal123/at.agentid.endorsement/did:plc:agent456`.
- The `agent` field MUST equal the record key.

A principal may endorse any number of agents, each with its own record.

## Verification

To confirm that an agent acts on behalf of a principal, a consumer:

1. Resolves the agent's DID document and finds its `agent-of` entry. If there is none, the account has no declared principal.
2. Extracts the principal's DID from the entry and resolves it to find the principal's PDS.
3. Fetches the endorsement record at `at.agentid.endorsement/<agent-did>` from the principal's repository, and authenticates it against the principal's signing key (for example via `com.atproto.sync.getRecord`).
4. Checks that the record's `agent` field equals the agent's DID.

If every step succeeds, the relationship is confirmed. Otherwise it is unconfirmed, and consumers MUST NOT treat an unconfirmed declaration as identifying a principal.

## Revocation

Either party can end the relationship on its own:

- The principal deletes the endorsement record.
- The agent removes the `agent-of` entry from its DID document.

Consumers SHOULD re-verify periodically and SHOULD treat the relationship as unconfirmed if the endorsement can't be retrieved.

## Security considerations

Neither half is trustworthy alone. Anyone can write a declaration naming any principal, and a principal can endorse any DID. Only the pair establishes the relationship.

Placing the declaration in the DID document puts it inside the account's identity perimeter. A party that can write to the agent's repository, but not update its DID document, can't forge or alter the declaration.

## Appendix: alternatives considered

The declaration could instead be a DID document service entry:

```json
{
  "id": "#principal",
  "type": "https://agentid.at/agent-of",
  "serviceEndpoint": "did:plc:principal123"
}
```

This works the same way, but a principal is not a service endpoint, so the `alsoKnownAs` form was chosen as the more natural fit.
