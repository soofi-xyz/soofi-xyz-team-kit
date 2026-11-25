/**
 * One Node services process for the Oracle pipeline (Restate endpoint).
 *
 *   node --env-file-if-exists=.env services/app.ts      # npm run services
 *   restate deployments register http://host.docker.internal:9080
 *   (on Linux with host networking: http://localhost:9080)
 */
import * as restate from "@restatedev/restate-sdk";

import { countyIngest, ingestChunk } from "./county-ingest.ts";
import { countyLedger } from "./ledger.ts";
import { parcel } from "./parcel.ts";
import { permitFeed, permitHarvest } from "./permits.ts";
import { publishGroup } from "./publish.ts";
import { dataRoot, elephantCliBinary } from "./lib/config.ts";

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

restate.serve({ services, port });

process.stdout.write(
  `${JSON.stringify({
    event: "oracle_services_listening",
    port,
    services: services.map((definition) => definition.name),
    dataDir: dataRoot(),
    elephantCli: elephantCliBinary().split("/").at(-1),
  })}\n`,
);
