/**
 * One Node services process for the Oracle pipeline (Restate endpoint).
 *
 *   node --env-file-if-exists=.env services/app.ts      # npm run services
 *   npm run register                                     # admin API registration
 *
 * Binding (`SERVICES_HOST`, default `auto`): loopback plus, on Linux, the
 * Docker default-bridge gateway (`docker0`, usually 172.17.0.1) — the address
 * `host.docker.internal:host-gateway` resolves to inside the compose Restate
 * container. The endpoint is never exposed on the machine's public
 * interfaces by default. `SERVICES_HOST` also takes an explicit comma list
 * (for example `127.0.0.1` when Restate runs on the host) or `0.0.0.0`.
 *
 * Request identity (optional hardening): set `RESTATE_IDENTITY_KEYS` to the
 * comma-separated `publickeyv1_…` keys Restate logs when it starts with a
 * request-identity private key; the endpoint then rejects unsigned requests.
 */
import http2 from "node:http2";

import * as restate from "@restatedev/restate-sdk";

import { countyIngest, ingestChunk } from "./county-ingest.ts";
import { countyLedger } from "./ledger.ts";
import { parcel } from "./parcel.ts";
import { permitFeed, permitHarvest } from "./permits.ts";
import { publishGroup } from "./publish.ts";
import { dataRoot, elephantCliBinary } from "./lib/config.ts";
import { resolveIdentityKeys, resolveServicesHosts } from "./lib/endpoint.ts";

export const services = [
  countyIngest,
  ingestChunk,
  parcel,
  countyLedger,
  permitFeed,
  permitHarvest,
  publishGroup,
];

const port = Number(process.env.SERVICES_PORT ?? 9080);
const hosts = resolveServicesHosts(process.env.SERVICES_HOST);
const identityKeys = resolveIdentityKeys(process.env.RESTATE_IDENTITY_KEYS);
for (const key of identityKeys) {
  if (!key.startsWith("publickeyv1_")) {
    throw new Error("RESTATE_IDENTITY_KEYS entries must be publickeyv1_… keys");
  }
}

const handler = restate.createEndpointHandler({
  services,
  ...(identityKeys.length ? { identityKeys } : {}),
});

await Promise.all(
  hosts.map(
    (host) =>
      new Promise<void>((resolve, reject) => {
        const server = http2.createServer(handler);
        server.once("error", reject);
        server.listen(port, host, () => resolve());
      }),
  ),
);

const exposed = hosts.some((host) => host === "0.0.0.0" || host === "::");
process.stdout.write(
  `${JSON.stringify({
    event: "oracle_services_listening",
    port,
    hosts,
    identityKeys: identityKeys.length,
    services: services.map((definition) => definition.name),
    dataDir: dataRoot(),
    elephantCli: elephantCliBinary().split("/").at(-1),
    ...(exposed && !identityKeys.length
      ? { warning: "listening on all interfaces without RESTATE_IDENTITY_KEYS" }
      : {}),
  })}\n`,
);
