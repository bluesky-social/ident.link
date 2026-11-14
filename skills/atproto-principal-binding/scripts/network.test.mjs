import test from "node:test";
import assert from "node:assert/strict";
import { publicLookup, publicFetch } from "./network.mjs";

const resolve = (addresses) => (_hostname, _options, callback) =>
  callback(null, addresses);
const check = (addresses) =>
  new Promise((resolveResult, reject) => {
    publicLookup(resolve(addresses))(
      "account.example.test",
      { all: true },
      (error, result) => (error ? reject(error) : resolveResult(result)),
    );
  });

test("connection-time DNS lookup blocks private, mapped, link-local and mixed results", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ]) {
    await assert.rejects(
      check([{ address, family: address.includes(":") ? 6 : 4 }]),
    );
  }
  await assert.rejects(check([]));
  await assert.rejects(
    check([
      { address: "1.1.1.1", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
  );
});

test("socket connector receives exactly the checked public addresses", async () => {
  const addresses = [
    { address: "1.1.1.1", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 },
  ];
  assert.deepEqual(await check(addresses), addresses);
  let attempt = 0;
  const rebinding = publicLookup((_hostname, _options, callback) =>
    callback(
      null,
      attempt++ ? [{ address: "127.0.0.1", family: 4 }] : addresses,
    ),
  );
  const connect = () =>
    new Promise((resolveResult, reject) =>
      rebinding("account.example.test", { all: true }, (error, value) =>
        error ? reject(error) : resolveResult(value),
      ),
    );
  assert.deepEqual(await connect(), addresses);
  await assert.rejects(connect());
});

test("unsafe protocols and literal addresses fail before any request", async () => {
  for (const url of [
    "http://example.test",
    "https://127.0.0.1",
    "https://[::1]",
    "https://user:pass@example.test",
  ])
    await assert.rejects(publicFetch(url));
});
