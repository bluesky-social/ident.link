import test from "node:test";
import assert from "node:assert/strict";
import { renderPage, pageHeaders } from "./page.mjs";
import { agent, principal } from "./fixtures.mjs";

test("untrusted account labels and activity are escaped and no scripts are needed", () => {
  const html = renderPage({
    agent: { ...agent, handle: "<script>example</script>" },
    principal,
    nonce: "synthetic-nonce",
    messages: ["<img src=x onerror=example>"],
    binding: {
      confirmed: false,
      declaration: "missing",
      endorsement: "unavailable",
      checkedAt: "2026-10-22T00:00:00Z",
    },
  });
  assert.ok(html.includes("&lt;script&gt;example&lt;/script&gt;"));
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<img src=x"), false);
  assert.ok(html.includes("Unavailable") || html.includes("unavailable"));
  const csp = pageHeaders("synthetic-nonce", [agent.issuer, principal.issuer])[
    "Content-Security-Policy"
  ];
  assert.ok(csp.includes("default-src 'none'"));
  assert.ok(csp.includes("style-src 'nonce-synthetic-nonce'"));
  assert.ok(csp.includes(agent.issuer));
  assert.ok(csp.includes(principal.issuer));
});
