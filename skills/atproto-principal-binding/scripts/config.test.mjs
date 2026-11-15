import test from "node:test";
import assert from "node:assert/strict";
import { parseOptions, httpsOrigin, resolveConfig } from "./config.mjs";
import { agent, principal } from "./fixtures.mjs";

test("CLI requires explicit identities and rejects invalid options", () => {
  assert.throws(() => parseOptions([]));
  assert.throws(() => parseOptions(["--agent", "--principal"]));
  assert.throws(() => parseOptions(["--unexpected"]));
  assert.throws(() =>
    parseOptions(["--agent", "a", "--principal", "p", "--port", "0"]),
  );
  assert.throws(() =>
    parseOptions([
      "--agent",
      "a",
      "--principal",
      "p",
      "--check-only",
      "--verify-only",
    ]),
  );
  assert.equal(parseOptions(["--help"]).help, true);
});

test("origin validation rejects credentials, paths and local endpoints", () => {
  for (const url of [
    "http://example.test",
    "https://user:pass@example.test",
    "https://example.test/path",
    "https://127.0.0.1",
    "https://localhost",
  ]) {
    assert.throws(() => httpsOrigin(url));
  }
  assert.equal(
    httpsOrigin("https://pds.example.test/"),
    "https://pds.example.test",
  );
});

test("account resolution supports separate PDS and authorization server origins", async () => {
  const options = parseOptions([
    "--agent",
    agent.handle,
    "--principal",
    principal.handle,
  ]);
  const config = await resolveConfig(
    options,
    async (handle) => ({ ...(handle === agent.handle ? agent : principal) }),
    async (account) => account.issuer,
  );
  assert.notEqual(config.agent.pds, config.principal.pds);
  assert.notEqual(config.agent.pds, config.agent.issuer);
  await assert.rejects(
    resolveConfig(
      options,
      async () => ({ ...agent }),
      async (account) => account.issuer,
    ),
  );
  await assert.rejects(
    resolveConfig(
      options,
      async () => ({ ...agent, did: "did:web:agent.example.test" }),
      async (account) => account.issuer,
    ),
  );
});
