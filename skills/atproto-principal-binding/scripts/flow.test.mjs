import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBinding } from "./bind.mjs";
import {
  config,
  agent,
  principal,
  plcData,
  accountDocument,
} from "./fixtures.mjs";

test("HTTP workflow verifies both sides, preserves identity and automatically revokes operator grants", async () => {
  const auditDirectory = await mkdtemp(join(tmpdir(), "ident-binding-test-"));
  let plc = plcData();
  let record;
  let proofAvailable = true;
  let simulateOutage = false;
  const revoked = [];
  const scopes = [];
  const writes = [];
  let authorizations = 0;
  const account = (did) => (did === agent.did ? agent : principal);
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), { status });
  const dependencies = {
    async resolveAccount(did) {
      if (simulateOutage) throw new Error("Network unavailable");
      const value = account(did);
      const didDoc = accountDocument(value);
      if (did === agent.did) didDoc.alsoKnownAs = plc.alsoKnownAs;
      return { ...value, didDoc };
    },
    async verifyRecords() {
      if (!proofAvailable) throw new Error("Invalid repository signature");
      return [
        { collection: "link.ident.endorsement", rkey: agent.did, record },
      ];
    },
    async fetch(input) {
      const url = new URL(input);
      if (simulateOutage) throw new Error("Network unavailable");
      if (url.origin === "https://plc.directory") return json(plc);
      assert.equal(url.origin, principal.pds);
      if (url.pathname.endsWith("getRecord")) {
        if (!record) return json({ error: "RecordNotFound" }, 400);
        return json(record);
      }
      throw new Error("Unexpected public read");
    },
    createClient(options) {
      const isPrincipal = options.clientMetadata.scope.includes("repo:");
      const value = isPrincipal ? principal : agent;
      scopes.push(options.clientMetadata.scope);
      const session = {
        async getTokenInfo() {
          return { sub: value.did, iss: value.issuer };
        },
        async fetchHandler(path, init) {
          writes.push(path);
          if (path.endsWith("requestPlcOperationSignature")) {
            assert.equal(init.body, undefined);
            assert.equal(init.headers, undefined);
            return new Response(null, { status: 200 });
          }
          const body = JSON.parse(init.body);
          if (path.endsWith("createRecord")) {
            assert.equal(record, undefined);
            assert.equal(body.repo, principal.did);
            record = body.record;
            return json({ uri: "at://synthetic" });
          }
          if (path.endsWith("signPlcOperation")) {
            const { token, ...plan } = body;
            assert.equal(token, "synthetic-code");
            return json({
              operation: {
                type: "plc_operation",
                prev: "previous",
                sig: "synthetic-signature",
                ...plan,
              },
            });
          }
          if (path.endsWith("submitPlcOperation")) {
            const { type, prev, sig, ...updated } = body.operation;
            plc = { did: agent.did, ...updated };
            return new Response(null, { status: 200 });
          }
          throw new Error("Unexpected authenticated request");
        },
      };
      return {
        async authorize(did) {
          authorizations++;
          assert.equal(did, value.did);
          return new URL(value.issuer + "/authorize");
        },
        async callback() {
          await options.sessionStore.set(value.did, {
            tokenSet: { sub: value.did, iss: value.issuer },
          });
          return { session };
        },
        async restore(did) {
          assert.ok(await options.sessionStore.get(did));
          return session;
        },
        async revoke(did) {
          revoked.push(did);
          await options.sessionStore.del(did);
        },
      };
    },
  };
  const binding = createBinding({ ...config, auditDirectory }, dependencies);
  const { server, close } = await binding.startBinding({ signals: false });
  const origin = `http://127.0.0.1:${config.port}`;
  const page = async () => (await fetch(origin)).text();
  const initial = await page();
  const nonce = initial.match(/name="csrf" value="([a-f0-9]+)"/)[1];
  const post = (path, extra = {}, source = origin) =>
    fetch(origin + path, {
      method: "POST",
      headers: { Origin: source },
      body: new URLSearchParams({ csrf: nonce, ...extra }),
      redirect: "manual",
    });
  try {
    const live = await binding.verifyBinding();
    assert.equal(live.declaration, "missing");
    assert.equal(live.endorsement, "missing");
    assert.equal(
      (await post("/endorse", {}, "https://untrusted.example.test")).status,
      403,
    );
    assert.equal((await fetch(origin + "/callback/agent")).status, 400);
    for (const role of ["principal", "agent"]) {
      assert.equal((await post("/login/" + role)).status, 303);
      assert.equal(
        (await fetch(origin + "/callback/" + role, { redirect: "manual" }))
          .status,
        303,
      );
    }
    assert.equal((await post("/endorse")).status, 303);
    assert.equal((await binding.verifyBinding()).confirmed, false);
    assert.equal((await binding.verifyBinding()).endorsement, "verified");
    proofAvailable = false;
    assert.equal((await binding.verifyBinding()).endorsement, "unavailable");
    proofAvailable = true;
    assert.equal((await post("/request-code")).status, 303);
    assert.equal(
      (await post("/declare", { code: "synthetic-code" })).status,
      303,
    );
    assert.equal((await binding.verifyBinding()).confirmed, true);
    const finished = await page();
    assert.ok(finished.includes("Two-way binding confirmed"));
    assert.ok(
      finished.includes("Temporary operator sessions have been revoked"),
    );
    assert.deepEqual(revoked.sort(), [agent.did, principal.did].sort());
    assert.deepEqual(plc.rotationKeys, plcData().rotationKeys);
    assert.deepEqual(plc.verificationMethods, plcData().verificationMethods);
    assert.deepEqual(plc.services, plcData().services);
    assert.equal(
      writes.some((path) => path.endsWith("putRecord")),
      false,
    );
    assert.deepEqual(
      scopes.sort(),
      [
        "atproto identity:*",
        "atproto repo:link.ident.endorsement?action=create",
      ].sort(),
    );
    assert.equal((await post("/request-code")).status, 409);
    simulateOutage = true;
    const unavailable = await binding.verifyBinding();
    assert.equal(unavailable.confirmed, false);
    assert.equal(unavailable.declaration, "unavailable");
    assert.equal(unavailable.endorsement, "unavailable");
    simulateOutage = false;
    const secondConfig = { ...config, port: 18770, auditDirectory };
    const second = await createBinding(secondConfig, dependencies).startBinding(
      { signals: false },
    );
    try {
      const secondOrigin = "http://127.0.0.1:18770";
      const html = await (await fetch(secondOrigin)).text();
      const csrf = html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
      const attemptsBefore = authorizations;
      const response = await fetch(secondOrigin + "/login/agent", {
        method: "POST",
        headers: { Origin: secondOrigin },
        body: new URLSearchParams({ csrf }),
        redirect: "manual",
      });
      assert.equal(response.status, 409);
      assert.equal(authorizations, attemptsBefore);
    } finally {
      await second.close();
    }
  } finally {
    simulateOutage = false;
    await close();
    await rm(auditDirectory, { recursive: true, force: true });
  }
});
