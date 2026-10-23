import http from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig, parseOptions, resolveAccount } from "./config.mjs";
import { renderPage, pageHeaders } from "./page.mjs";
import { isDeepStrictEqual } from "node:util";
import { verifyRecords } from "@atproto/repo";
import {
  NodeOAuthClient,
  buildAtprotoLoopbackClientMetadata,
  requestLocalLock,
} from "@atproto/oauth-client-node";

export function createBinding(config, dependencies = {}) {
  const fetch = dependencies.fetch ?? globalThis.fetch;
  const resolveIdentity = dependencies.resolveAccount ?? resolveAccount;
  const verifyRepository = dependencies.verifyRecords ?? verifyRecords;
  const createClient =
    dependencies.createClient ?? ((options) => new NodeOAuthClient(options));
  const { agent, principal, port = 8767 } = config;
  const AGENT = agent.did,
    PRINCIPAL = principal.did;
  const DECLARATION = `https://ident.link/agent-of/${PRINCIPAL}`;
  const ORIGIN = `http://127.0.0.1:${port}`;
  const ROOT = resolve(
    config.auditDirectory ??
      join(tmpdir(), "ident-binding-public-" + randomBytes(8).toString("hex")),
  );
  const ROLES = {
    principal: {
      ...principal,
      scope: "atproto repo:link.ident.endorsement?action=create",
    },
    agent: { ...agent, scope: "atproto identity:*" },
  };
  async function publishEndorsement(call, lookup, verify) {
    const { status, data } = await lookup();
    if (status === 200) {
      if (
        data.value?.agent !== AGENT ||
        data.value?.$type !== "link.ident.endorsement"
      )
        throw new Error("Existing endorsement conflicts");
    } else {
      if (status !== 400 || data.error !== "RecordNotFound")
        throw new Error("Endorsement lookup failed");
      // putRecord requires create AND update, even for a new record. createRecord
      // matches our create-only grant and refuses to replace an existing record.
      await call("principal", "com.atproto.repo.createRecord", {
        repo: PRINCIPAL,
        collection: "link.ident.endorsement",
        rkey: AGENT,
        record: { $type: "link.ident.endorsement", agent: AGENT },
      });
    }
    await verify();
  }

  class SafeOperationError extends Error {}
  class MissingEndorsementError extends Error {}

  function pdsPostRequest(body) {
    return body === undefined
      ? { method: "POST" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        };
  }

  function memoryStore(allowed = () => true, valid = () => true) {
    const values = new Map();
    return {
      async get(key) {
        return allowed(key) ? values.get(key) : undefined;
      },
      async set(key, value) {
        if (!allowed(key) || !valid(value))
          throw new Error("Unexpected operator session");
        values.set(key, value);
      },
      async del(key) {
        values.delete(key);
      },
    };
  }

  async function verifyEndorsement() {
    const principalNow = await resolveIdentity(PRINCIPAL);
    const principalDoc = principalNow.didDoc;
    if (
      principalDoc.id !== PRINCIPAL ||
      principalDoc.service?.find((service) =>
        service.id.endsWith("#atproto_pds"),
      )?.serviceEndpoint !== principal.pds
    ) {
      throw new Error("Unexpected principal hosting");
    }
    const key = principalDoc.verificationMethod?.find((method) =>
      method.id.endsWith("#atproto"),
    )?.publicKeyMultibase;
    if (!key) throw new Error("Missing principal signing key");
    const url = new URL("/xrpc/com.atproto.sync.getRecord", principal.pds);
    url.search = new URLSearchParams({
      did: PRINCIPAL,
      collection: "link.ident.endorsement",
      rkey: AGENT,
    });
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      if (response.status === 400 || response.status === 404) {
        const error = await response.json().catch(() => ({}));
        if (error.error === "RecordNotFound")
          throw new MissingEndorsementError();
      }
      throw new Error("Endorsement proof unavailable");
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 8 * 1024 * 1024)
        throw new Error("Endorsement proof too large");
      chunks.push(chunk);
    }
    const records = await verifyRepository(
      Buffer.concat(chunks),
      PRINCIPAL,
      `did:key:${key}`,
    );
    const record = records.find(
      (entry) =>
        entry.collection === "link.ident.endorsement" && entry.rkey === AGENT,
    )?.record;
    if (record?.agent !== AGENT || record?.$type !== "link.ident.endorsement")
      throw new Error("Endorsement proof did not match");
  }

  async function verifyBinding() {
    const [declaration, endorsement] = await Promise.allSettled([
      resolveIdentity(AGENT).then((current) => {
        if (current.did !== AGENT) throw new Error("Unexpected agent identity");
        return current.didDoc.alsoKnownAs?.includes(DECLARATION) ?? false;
      }),
      verifyEndorsement(),
    ]);
    const declarationStatus =
      declaration.status === "fulfilled"
        ? declaration.value
          ? "present"
          : "missing"
        : "unavailable";
    const endorsementStatus =
      endorsement.status === "fulfilled"
        ? "verified"
        : endorsement.reason instanceof MissingEndorsementError
          ? "missing"
          : "unavailable";
    return {
      confirmed:
        declarationStatus === "present" && endorsementStatus === "verified",
      declaration: declarationStatus,
      endorsement: endorsementStatus,
      checkedAt: new Date().toISOString(),
    };
  }

  function declarationPlan(before) {
    for (const key of [
      "rotationKeys",
      "alsoKnownAs",
      "verificationMethods",
      "services",
    ]) {
      if (!before[key]) throw new Error("Incomplete PLC data");
    }
    if (
      !before.verificationMethods.atproto ||
      before.services.atproto_pds?.endpoint !== agent.pds ||
      !before.alsoKnownAs.includes(`at://${agent.handle}`)
    ) {
      throw new Error("Unexpected Agent identity");
    }
    return {
      rotationKeys: before.rotationKeys,
      alsoKnownAs: [...new Set([...before.alsoKnownAs, DECLARATION])],
      verificationMethods: before.verificationMethods,
      services: before.services,
    };
  }

  function checkSignedPlan(operation, plan) {
    if (
      operation?.type !== "plc_operation" ||
      !operation.sig ||
      !operation.prev
    )
      throw new Error("Invalid signed operation");
    for (const key of Object.keys(plan)) {
      if (!isDeepStrictEqual(operation[key], plan[key]))
        throw new Error("Signed operation changed identity fields");
    }
  }

  async function publicJson(url) {
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Public read failed");
    return response.json();
  }

  async function startBinding({ signals = true } = {}) {
    process.umask(0o077);
    const nonce = randomBytes(32).toString("hex");
    const clients = {};
    const stores = {};
    const messages = [];
    let completed = false;
    let endorsed = false;
    const pending = new Set();
    let busy = false;
    for (const [role, config] of Object.entries(ROLES)) {
      const store = memoryStore(
        (key) => key === config.did,
        (value) =>
          value?.tokenSet?.sub === config.did &&
          value?.tokenSet?.iss === config.issuer,
      );
      stores[role] = store;
      clients[role] = createClient({
        clientMetadata: buildAtprotoLoopbackClientMetadata({
          scope: config.scope,
          redirect_uris: [`${ORIGIN}/callback/${role}`],
        }),
        stateStore: memoryStore(),
        sessionStore: store,
        requestLock: requestLocalLock,
      });
    }
    const revokeAll = async () => {
      const results = await Promise.allSettled(
        Object.keys(ROLES).map(async (role) => {
          if (await stores[role].get(ROLES[role].did))
            await clients[role].revoke(ROLES[role].did);
        }),
      );
      if (results.some((result) => result.status === "rejected"))
        throw new Error("Operator revocation incomplete");
    };
    const session = (role) => clients[role].restore(ROLES[role].did);
    const call = async (role, nsid, body) => {
      const response = await (
        await session(role)
      ).fetchHandler(`/xrpc/${nsid}`, pdsPostRequest(body));
      if (!response.ok)
        throw new SafeOperationError(
          `PDS ${nsid} failed (HTTP ${response.status}).`,
        );
      if (response.status === 204) return {};
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    };
    const headers = pageHeaders(nonce, [agent.issuer, principal.issuer]);
    const server = http.createServer(async (req, res) => {
      const reply = (status, text) => {
        res.writeHead(status, headers);
        res.end(text);
      };
      const redirect = (location) => {
        res.writeHead(303, { ...headers, Location: location });
        res.end();
      };
      let ownsBusy = false;
      try {
        if (req.headers.host !== `127.0.0.1:${port}`)
          return reply(403, "Invalid host");
        const url = new URL(req.url, ORIGIN);
        if (req.method === "GET" && url.pathname === "/") {
          const binding = await verifyBinding();
          endorsed = binding.endorsement === "verified";
          const principalConnected = Boolean(
            await stores.principal.get(PRINCIPAL),
          );
          const agentConnected = Boolean(await stores.agent.get(AGENT));
          return reply(
            200,
            renderPage({
              agent,
              principal: config.principal,
              agentConnected,
              principalConnected,
              nonce,
              messages,
              completed,
              endorsed,
              binding,
            }),
          );
        }
        const callbackRole = url.pathname.match(
          /^\/callback\/(principal|agent)$/,
        )?.[1];
        if (req.method === "GET" && callbackRole) {
          if (!pending.has(callbackRole))
            return reply(400, "No authorization pending");
          try {
            const { session: connected } = await clients[callbackRole].callback(
              url.searchParams,
            );
            const info = await connected.getTokenInfo(false);
            if (
              info.sub !== ROLES[callbackRole].did ||
              info.iss !== ROLES[callbackRole].issuer
            )
              throw new Error("Unexpected operator identity");
            messages.push(`${callbackRole} operator connected.`);
          } finally {
            pending.delete(callbackRole);
          }
          return redirect("/");
        }
        if (req.method !== "POST") return reply(404, "Not found");
        if (req.headers.origin !== ORIGIN) return reply(403, "Invalid origin");
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 2048) return reply(413, "Request too large");
        }
        const fields = new URLSearchParams(body);
        if (fields.get("csrf") !== nonce) return reply(403, "Invalid request");
        if (completed)
          return reply(409, "Binding already completed. Stop this helper.");
        if (busy) return reply(409, "An operation is in progress");
        busy = true;
        ownsBusy = true;
        const role = url.pathname.match(/^\/login\/(principal|agent)$/)?.[1];
        if (role) {
          if (pending.has(role))
            return reply(
              409,
              "Complete the existing sign-in or restart this helper.",
            );
          pending.add(role);
          try {
            const target = await clients[role].authorize(ROLES[role].did, {
              scope: ROLES[role].scope,
            });
            if (target.origin !== ROLES[role].issuer)
              throw new Error("Unexpected issuer");
            return redirect(target.href);
          } catch (error) {
            pending.delete(role);
            throw error;
          }
        }
        if (url.pathname === "/endorse") {
          const recordUrl = new URL(
            "/xrpc/com.atproto.repo.getRecord",
            principal.pds,
          );
          recordUrl.search = new URLSearchParams({
            repo: PRINCIPAL,
            collection: "link.ident.endorsement",
            rkey: AGENT,
          });
          await publishEndorsement(
            call,
            async () => {
              const existing = await fetch(recordUrl, {
                redirect: "error",
                signal: AbortSignal.timeout(15_000),
              });
              return { status: existing.status, data: await existing.json() };
            },
            verifyEndorsement,
          );
          endorsed = true;
          messages.push(
            "Principal endorsement signature and repository proof verified.",
          );
        } else if (url.pathname === "/request-code") {
          await call(
            "agent",
            "com.atproto.identity.requestPlcOperationSignature",
          );
          messages.push(
            "Identity confirmation email requested. Enter its code only in this local page.",
          );
        } else if (url.pathname === "/declare") {
          const code = fields.get("code")?.trim();
          if (!code || code.length > 256)
            return reply(400, "Enter the email confirmation code");
          await verifyEndorsement();
          const before = await publicJson(
            `https://plc.directory/${AGENT}/data`,
          );
          const plan = declarationPlan(before);
          if (!before.alsoKnownAs.includes(DECLARATION)) {
            const { operation } = await call(
              "agent",
              "com.atproto.identity.signPlcOperation",
              { ...plan, token: code },
            );
            checkSignedPlan(operation, plan);
            const fresh = await publicJson(
              `https://plc.directory/${AGENT}/data`,
            );
            if (!isDeepStrictEqual(before, fresh))
              throw new Error("Identity changed during preparation");
            await mkdir(`${ROOT}/public-audit`, {
              recursive: true,
              mode: 0o700,
            });
            await writeFile(
              `${ROOT}/public-audit/${Date.now()}-before.json`,
              JSON.stringify(before),
              { mode: 0o600, flag: "wx" },
            );
            console.log(
              `Public pre-change identity snapshot: ${ROOT}/public-audit`,
            );
            await call("agent", "com.atproto.identity.submitPlcOperation", {
              operation,
            });
          }
          const after = await publicJson(`https://plc.directory/${AGENT}/data`);
          for (const key of Object.keys(plan))
            if (!isDeepStrictEqual(after[key], plan[key]))
              throw new Error("Declaration readback mismatch");
          await verifyEndorsement();
          messages.push(
            "Agent declaration and principal endorsement verified.",
          );
          await revokeAll();
          messages.push("Temporary operator sessions revoked.");
          completed = true;
        } else return reply(404, "Not found");
        return redirect("/");
      } catch (error) {
        // Do not emit SDK error bodies, OAuth URLs, tokens, codes or signed requests.
        // Only locally constructed endpoint/status errors are safe to show.
        const detail =
          error instanceof SafeOperationError
            ? error.message
            : "Operation failed; no error details logged.";
        return reply(502, `${detail} <a href="/">Return to setup</a>`);
      } finally {
        if (ownsBusy) busy = false;
      }
    });
    server.requestTimeout = 30_000;
    server.headersTimeout = 15_000;
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    const close = async () => {
      await revokeAll();
      await new Promise((resolve) => server.close(resolve));
    };
    const shutdown = async () => {
      const timeout = setTimeout(() => {
        console.error(
          "Operator revocation timed out; revoke the setup grant at the PDS.",
        );
        process.exit(1);
      }, 15_000);
      try {
        await close();
        clearTimeout(timeout);
        process.exit(0);
      } catch {
        console.error(
          "Operator revocation incomplete; revoke the setup grant at the PDS.",
        );
        process.exit(1);
      }
    };
    if (signals) {
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    }
    console.log(`Operator binding setup: ${ORIGIN}`);
    return { server, close };
  }

  return {
    startBinding,
    declarationPlan,
    checkSignedPlan,
    memoryStore,
    pdsPostRequest,
    publishEndorsement,
    verifyEndorsement,
    verifyBinding,
  };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.help) {
    console.log(
      "Usage: node bind.mjs --agent <handle-or-did> --principal <handle-or-did> [--port 8767] [--check-only | --verify-only]",
    );
    return;
  }
  const config = await resolveConfig(options);
  console.log(`Agent: ${config.agent.handle} (${config.agent.did})`);
  console.log(
    `Principal: ${config.principal.handle} (${config.principal.did})`,
  );
  if (options.checkOnly) return;
  if (options.verifyOnly) {
    const binding = await createBinding(config).verifyBinding();
    console.log(JSON.stringify(binding));
    if (!binding.confirmed) process.exitCode = 1;
    return;
  }
  await createBinding(config).startBinding();
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    console.error(
      "Setup failed. Check account identifiers, HTTPS hosting, and the local port. No credentials or server response bodies were logged.",
    );
    process.exitCode = 1;
  });
}
