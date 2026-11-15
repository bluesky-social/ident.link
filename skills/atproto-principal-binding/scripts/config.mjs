import {
  NodeOAuthClient,
  buildAtprotoLoopbackClientMetadata,
  requestLocalLock,
} from "@atproto/oauth-client-node";
import { publicFetch } from "./network.mjs";

export function parseOptions(args) {
  const options = { port: 8767 };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help") options.help = true;
    else if (flag === "--check-only") options.checkOnly = true;
    else if (flag === "--verify-only") options.verifyOnly = true;
    else if (
      ["--agent", "--principal", "--port", "--audit-directory"].includes(flag)
    ) {
      const value = args[++index];
      if (!value || value.startsWith("--"))
        throw new Error("Missing option value");
      options[flag === "--audit-directory" ? "auditDirectory" : flag.slice(2)] =
        value;
    } else throw new Error("Unknown option");
  }
  options.port = Number(options.port);
  if (
    !Number.isInteger(options.port) ||
    options.port < 1024 ||
    options.port > 65535
  )
    throw new Error("Invalid port");
  if (!options.help && (!options.agent || !options.principal))
    throw new Error("Both accounts are required");
  if (options.checkOnly && options.verifyOnly)
    throw new Error("Choose a single check mode");
  return options;
}

export function httpsOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.startsWith("[") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)
  ) {
    throw new Error("Expected a public HTTPS origin");
  }
  return url.origin;
}

const ephemeral = () => {
  const values = new Map();
  return {
    async get(key) {
      return values.get(key);
    },
    async set(key, value) {
      values.set(key, value);
    },
    async del(key) {
      values.delete(key);
    },
  };
};

// Use the official resolver for handle ↔ DID checks, including did:web principals.
const resolverClient = new NodeOAuthClient({
  fetch: publicFetch,
  clientMetadata: buildAtprotoLoopbackClientMetadata({
    scope: "atproto",
    redirect_uris: ["http://127.0.0.1:8767/resolve"],
  }),
  stateStore: ephemeral(),
  sessionStore: ephemeral(),
  requestLock: requestLocalLock,
});

export async function resolveAccount(identifier) {
  const identity = await resolverClient.identityResolver.resolve(identifier, {
    noCache: true,
    signal: AbortSignal.timeout(15_000),
  });
  if (identity.handle === "handle.invalid")
    throw new Error("Account handle could not be verified");
  const service = identity.didDoc.service?.find(
    (entry) =>
      entry.id === "#atproto_pds" || entry.id === `${identity.did}#atproto_pds`,
  );
  if (!service || typeof service.serviceEndpoint !== "string")
    throw new Error("Missing PDS");
  return {
    did: identity.did,
    handle: identity.handle,
    pds: httpsOrigin(service.serviceEndpoint),
    didDoc: identity.didDoc,
  };
}

async function discoverIssuer(account) {
  const response = await publicFetch(
    `${account.pds}/.well-known/oauth-protected-resource`,
    { redirect: "error", signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) throw new Error("OAuth metadata unavailable");
  const metadata = await response.json();
  if (
    metadata.resource !== account.pds ||
    metadata.authorization_servers?.length !== 1
  )
    throw new Error("Unexpected OAuth metadata");
  return httpsOrigin(metadata.authorization_servers[0]);
}

export async function resolveConfig(
  options,
  resolve = resolveAccount,
  issuer = discoverIssuer,
) {
  const [agent, principal] = await Promise.all([
    resolve(options.agent),
    resolve(options.principal),
  ]);
  if (!agent.did.startsWith("did:plc:"))
    throw new Error(
      "This helper supports PLC agents only; did:web agents need operator-managed DID document edits",
    );
  if (agent.did === principal.did)
    throw new Error("Agent and principal must be distinct accounts");
  [agent.issuer, principal.issuer] = await Promise.all([
    issuer(agent),
    issuer(principal),
  ]);
  return {
    agent,
    principal,
    port: options.port,
    auditDirectory: options.auditDirectory,
  };
}
