// Reserved test domains and deliberately synthetic DIDs; never real accounts.
export const agent = {
  did: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
  handle: "agent.example.test",
  pds: "https://agent-pds.example.test",
  issuer: "https://agent-auth.example.test",
};
export const principal = {
  did: "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb",
  handle: "principal.example.test",
  pds: "https://principal-pds.example.test",
  issuer: "https://principal-auth.example.test",
};
export const config = { agent, principal, port: 18769 };
export const plcData = () => ({
  did: agent.did,
  rotationKeys: ["operator-key", "pds-key"],
  alsoKnownAs: ["at://" + agent.handle, "https://example.test/existing-alias"],
  verificationMethods: {
    atproto: "signing-key",
    atproto_kem: "kem-key",
    extra: "extra-key",
  },
  services: {
    atproto_pds: { type: "AtprotoPersonalDataServer", endpoint: agent.pds },
  },
});
export const accountDocument = (account) => ({
  id: account.did,
  alsoKnownAs: ["at://" + account.handle],
  verificationMethod: [
    {
      id: account.did + "#atproto",
      publicKeyMultibase: "synthetic-public-key",
    },
  ],
  service: [{ id: "#atproto_pds", serviceEndpoint: account.pds }],
});
