import test from "node:test";
import assert from "node:assert/strict";
import { createBinding } from "./bind.mjs";
import { config, agent, principal, plcData } from "./fixtures.mjs";
const {
  declarationPlan,
  checkSignedPlan,
  memoryStore,
  publishEndorsement,
  pdsPostRequest,
} = createBinding(config);
const AGENT = agent.did,
  PRINCIPAL = principal.did;
const current = plcData;

test("principal declaration preserves all existing identity material and aliases", () => {
  const before = current();
  const plan = declarationPlan(before);
  assert.deepEqual(plan.alsoKnownAs, [
    ...before.alsoKnownAs,
    `https://ident.link/agent-of/${PRINCIPAL}`,
  ]);
  for (const key of ["rotationKeys", "verificationMethods", "services"])
    assert.deepEqual(plan[key], before[key]);
  assert.equal(before.alsoKnownAs.length, 2);
  assert.deepEqual(declarationPlan(plan), plan);
});

test("unexpected hosting, handle and missing KEM key block a DID update", () => {
  for (const change of [
    (value) => {
      value.services.atproto_pds.endpoint = "https://unexpected.example";
    },
    (value) => {
      value.alsoKnownAs[0] = "at://other.example.test";
    },
    (value) => {
      delete value.verificationMethods.atproto;
    },
  ]) {
    const value = current();
    change(value);
    assert.throws(() => declarationPlan(value));
  }
});

test("PDS signed operation must match the exact reviewed declaration plan", () => {
  const plan = declarationPlan(current());
  const signed = {
    type: "plc_operation",
    prev: "previous-operation",
    sig: "signature",
    ...plan,
  };
  checkSignedPlan(signed, plan);
  for (const change of [
    (value) => {
      value.rotationKeys = ["replacement"];
    },
    (value) => {
      value.verificationMethods = { atproto: "replacement" };
    },
    (value) => {
      value.services = {};
    },
    (value) => {
      value.alsoKnownAs = ["at://other.example.test"];
    },
  ]) {
    const changed = structuredClone(signed);
    change(changed);
    assert.throws(() => checkSignedPlan(changed, plan));
  }
});

test("operator credentials stay in memory and reject unexpected identities", async () => {
  const store = memoryStore(
    (key) => key === "expected",
    (value) => value.issuer === "expected",
  );
  await assert.rejects(store.set("other", { issuer: "expected" }));
  await assert.rejects(store.set("expected", { issuer: "other" }));
  await store.set("expected", { issuer: "expected" });
  assert.deepEqual(await store.get("expected"), { issuer: "expected" });
  assert.equal(await memoryStore().get("expected"), undefined);
  await store.del("expected");
  assert.equal(await store.get("expected"), undefined);
});

test("endorsement creation works with create-only permission and is idempotent", async () => {
  let record;
  let writes = 0;
  let verified = 0;
  const lookup = async () =>
    record
      ? { status: 200, data: { value: record } }
      : { status: 400, data: { error: "RecordNotFound" } };
  const call = async (role, nsid, body) => {
    // Model the observed PDS permission contract: putRecord requires update.
    if (nsid === "com.atproto.repo.putRecord")
      throw new Error("403: update scope not granted");
    assert.equal(role, "principal");
    assert.equal(nsid, "com.atproto.repo.createRecord");
    assert.equal(body.repo, PRINCIPAL);
    assert.equal(body.rkey, AGENT);
    assert.equal(body.collection, "link.ident.endorsement");
    assert.equal(record, undefined);
    record = body.record;
    writes++;
  };
  const verify = async () => {
    assert.equal(record?.agent, AGENT);
    verified++;
  };
  await publishEndorsement(call, lookup, verify);
  await publishEndorsement(call, lookup, verify);
  assert.equal(writes, 1);
  assert.equal(verified, 2);
});

test("conflicting endorsement and failed lookup cannot trigger a write", async () => {
  const forbidden = async () => {
    assert.fail("Must not write or verify an untrusted lookup");
  };
  await assert.rejects(
    publishEndorsement(
      forbidden,
      async () => ({
        status: 200,
        data: {
          value: { $type: "link.ident.endorsement", agent: "did:plc:other" },
        },
      }),
      forbidden,
    ),
  );
  await assert.rejects(
    publishEndorsement(
      forbidden,
      async () => ({ status: 503, data: { error: "RecordNotFound" } }),
      forbidden,
    ),
  );
});

test("no-input identity procedure sends neither JSON body nor content type", async () => {
  // The XRPC procedure has no input schema, so the server rejects any payload.
  const endpoint = async (request) => {
    if (request.body !== null || request.headers.has("content-type"))
      return new Response(null, { status: 400 });
    return new Response(null, { status: 200 });
  };
  const url =
    "https://agent-pds.example.test/xrpc/com.atproto.identity.requestPlcOperationSignature";
  assert.equal(
    (await endpoint(new Request(url, pdsPostRequest({})))).status,
    400,
  );
  assert.equal(
    (await endpoint(new Request(url, pdsPostRequest()))).status,
    200,
  );
  const signing = new Request(
    "https://agent-pds.example.test/xrpc/com.atproto.identity.signPlcOperation",
    pdsPostRequest({ token: "synthetic-code" }),
  );
  assert.equal(signing.headers.get("content-type"), "application/json");
  assert.deepEqual(await signing.json(), { token: "synthetic-code" });
});
