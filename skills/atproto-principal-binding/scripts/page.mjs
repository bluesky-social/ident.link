import { readFileSync } from "node:fs";
const stylesheet = readFileSync(
  new URL("./style.css", import.meta.url),
  "utf8",
);

export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );

export function pageHeaders(nonce, issuers) {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "strict-origin",
    "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self' ${[...new Set(issuers)].join(" ")}; frame-ancestors 'none'; base-uri 'none'`,
    "X-Content-Type-Options": "nosniff",
  };
}

export function renderPage({
  agent,
  principal,
  agentConnected,
  principalConnected,
  nonce,
  messages = [],
  completed = false,
  endorsed = false,
  binding,
}) {
  const escape = escapeHtml;
  const locked = completed || binding?.confirmed;
  const button = (action, label, disabled = false, extra = "") =>
    `<form method="post" action="${action}"><input type="hidden" name="csrf" value="${escape(nonce)}">${extra}<button ${disabled ? "disabled" : ""}>${label}</button></form>`;
  const account = (role, value, ready) =>
    `<div class="account"><div><span class="label">${role}</span><strong>${escape(value.handle)}</strong><code>${escape(value.did)}</code></div><span class="badge ${ready ? "ready" : ""}">${ready ? "Connected" : "Not connected"}</span></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bind an agent · ident.link</title>
  <style nonce="${escape(nonce)}">${stylesheet}</style></head><body><main><header><a class="brand" href="https://ident.link">ident.link</a><div class="eyebrow">Local operator setup</div><h1><span class="number">#</span> Agent Identity Link</h1><p>Publish and verify an agent’s relationship with its principal. You approve each account change on this device.</p></header>
  <section aria-label="Live binding status" class="binding-status"><div class="section-title"><span class="number" aria-hidden="true">↔</span><h2>${binding?.confirmed ? "Two-way binding confirmed" : "Two-way binding not confirmed"}</h2></div>
  <p>Live lookup of both accounts, with repository signature verification.</p>
  <div class="account"><span>Agent’s principal declaration</span><span class="badge ${binding?.declaration === "present" ? "ready" : ""}">${escape(binding?.declaration ?? "unavailable")}</span></div>
  <div class="account"><span>Principal’s signed endorsement</span><span class="badge ${binding?.endorsement === "verified" ? "ready" : ""}">${escape(binding?.endorsement ?? "unavailable")}</span></div>
  <p class="note">Checked: <time datetime="${escape(binding?.checkedAt ?? "")}">${escape(binding?.checkedAt ?? "not yet checked")}</time>. “Unavailable” means the lookup or verification failed; it does not mean the binding is absent.</p>
  <form method="get" action="/"><button>Check again</button></form></section>
  ${completed ? '<div class="notice" role="status"><p>Setup complete. Temporary operator sessions have been revoked.</p></div>' : ""}
  <section><div class="section-title"><span class="number" aria-hidden="true">##</span><h2>Endorse the agent</h2></div><p>The principal publishes a signed record confirming this agent.</p>
  ${account("Principal", principal, principalConnected)}
  <div class="actions">${button("/login/principal", "Connect principal", locked || endorsed || principalConnected)}${button("/endorse", endorsed ? "Endorsement verified" : "Publish endorsement", locked || endorsed || !principalConnected)}</div>
  <p class="note">${endorsed ? "The existing endorsement was verified. You can skip principal sign-in." : "Access is limited to creating link.ident.endorsement records. Existing records cannot be overwritten."}</p></section>
  <section><div class="section-title"><span class="number" aria-hidden="true">##</span><h2>Confirm the agent identity</h2></div><p>Sign in as the agent’s operator, then request the email confirmation.</p>
  ${account("Agent", agent, agentConnected)}
  <div class="actions">${button("/login/agent", "Connect agent operator", locked || agentConnected)}${button("/request-code", "Send confirmation email", locked || !agentConnected)}</div>
  <p class="note">This separate operator grant permits DID and handle changes. It stays in memory and is never given to the agent’s normal runtime.</p></section>
  <section><div class="section-title"><span class="number" aria-hidden="true">##</span><h2>Review &amp; bind</h2></div><p>Add this principal declaration to the agent’s DID document:</p>
  <div class="preview"><code>+ https://ident.link/agent-of/${escape(principal.did)}</code></div>
  <p class="note">The helper preserves the existing handle, aliases, rotation keys, signing keys, and hosting. The principal endorsement’s repository signature is verified before and after the update.</p>
  ${button("/declare", "Confirm principal binding", locked || !agentConnected || !endorsed, '<label>Email confirmation code<input name="code" autocomplete="off" required maxlength="256" placeholder="Code from the agent account’s email" ' + (locked ? "disabled" : "") + "></label>")}
  <p class="note">After successful verification, temporary permissions are revoked automatically. No separate cleanup step.</p></section>
  ${messages.length ? `<ul class="messages" aria-label="Setup activity">${messages.map((message) => `<li>${escape(message)}</li>`).join("")}</ul>` : ""}
  <footer>Credentials and confirmation codes are never written to disk. To cancel, stop the helper with Ctrl-C; it will attempt to revoke both grants. A forced kill or crash cannot guarantee remote revocation—remove the setup grant at your PDS if that happens.</footer>
  </main></body></html>`;
}
