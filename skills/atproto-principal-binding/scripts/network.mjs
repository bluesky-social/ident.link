import { lookup } from "node:dns";
import { Agent } from "undici";
import ipaddr from "ipaddr.js";

export function publicLookup(resolve = lookup) {
  return (hostname, options, callback) => {
    resolve(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) return callback(error);
      try {
        if (
          !addresses?.length ||
          addresses.some(
            ({ address }) => ipaddr.process(address).range() !== "unicast",
          )
        ) {
          throw new Error(
            "Account endpoints must resolve exclusively to public addresses",
          );
        }
        // These exact checked addresses are passed to the socket connector.
        // There is no separate DNS lookup between checking and connecting.
        if (options?.all) return callback(null, addresses);
        const address = addresses.find(
          (entry) => !options?.family || entry.family === options.family,
        );
        if (!address) throw new Error("No usable public address");
        return callback(null, address.address, address.family);
      } catch (failure) {
        return callback(failure);
      }
    });
  };
}

const dispatcher = new Agent({ connect: { lookup: publicLookup() } });

export async function publicFetch(input, init = {}) {
  const url = new URL(input instanceof Request ? input.url : input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hostname.startsWith("[") ||
    ipaddr.isValid(url.hostname)
  ) {
    throw new Error("Public HTTPS hostnames are required");
  }
  return globalThis.fetch(input, {
    ...init,
    dispatcher,
    redirect: "error",
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
}
