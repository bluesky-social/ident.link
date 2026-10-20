---
title: agent principal
subtitle: identifying the user an agent acts on behalf of
status: draft
updated: 2026-10-20
discussion: https://github.com/agentid-at/spec
---

# Summary

We propose using an `alsoKnownAs` entry in an agent account’s DID document to identify the principal—the user on whose behalf the agent acts.

A principal entry conveys:

- The actor described by the DID Document is an agent.
- The agent acts on behalf of the referenced “principal.”

The relationship establishes no standard privileges but may be interpreted by applications as a form of authorization (for either actor). Future standard privileges may be established.

## Background

Agents are increasingly represented by DIDs in the atproto network. This presents multiple needs:

1. Chain of responsibility for actions by agents.
   1. Contact this user for issues with this agent.

There are also future needs which may benefit from this solution, including:

1. Authorization of actions by agents on behalf of users.
   1. This agent may update my calendar.
2. Authorization of actions by users on behalf of agents.
   1. This user may change my name.

These systems require a trustworthy linkage between the user and agent. Any solution must be resilient to malicious or accidental modification of the linkage. This approach uses the DID perimeter to achieve that security goal; it additionally benefits from the auditability of did:plc.

## Proposal

### Agent declaration

This establishes the agent account’s declaration. Confirming the relationship requires a separate statement controlled by the principal. Changing or removing this declaration requires a PLC update.

We identify the principal directly in an aka entry with a fixed host. The agent’s DID document contains this `alsoKnownAs` entry:

```json
"alsoKnownAs": [..., "https://agentid.at/agent-of/did:plc:principal"]
```

This is compact, requires no separately hosted document, and makes the principal discoverable from a single resolution of the agent’s DID. The principal identifier is included directly in the signed PLC operation.

**Alternative proposal:** identify the principal directly in a service record. The agent’s DID document contains this service entry:

```json
{
  "id": "#principal",
  "type": "https://agentid.at/agent-of",
  "serviceEndpoint": "did:plc:principal"
}
```

The convention defines this as: “The subject of this DID document is a software agent claiming to act on behalf of the principal identified by `serviceEndpoint`.”

This approach is functionally similar to using `alsoKnownAs`, but feels like more of a semantic kludge.

### Agent endorsement by the principal

The principal publishes a record in the principal’s repository. That record could contain:

```json
{
  "$type": "at.agentid.endorsement",
  "agent": "did:plc:agent"
}
```

The endorsement acts as a confirmation of the relationship and must be present to consider the relationship valid. One record per agent allows a principal to endorse multiple agents independently.

The rkey of the endorsement record should be the DID of the agent, to enable simple lookup.

## Verification

A consumer would:

1. Read the `alsoKnownAs` entry from the agent’s DID document.
2. Extract the principal’s DID and resolve its current PDS.
3. Retrieve and authenticate the referenced record.
4. Check that the record names the original agent.

The principal can withdraw endorsement by deleting the record. Consumers must refresh endorsement state periodically; a failed retrieval leaves the relationship unconfirmed.
