import { createHash } from "node:crypto";
import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

import {
  FILEBASE_GATEWAY,
  FILEBASE_S3_ENDPOINT,
  fillDerivedFilebaseToken,
  hasFilebaseCredentials,
  uploadFilebaseObject,
  upsertFilebaseName,
} from "./filebase.mjs";
import { isIpfsCid } from "../enrichment/hoa-pm-object-publication.mjs";
import {
  readHoaPmPropertyLinks,
  restampHoaPmPropertyCids,
} from "../enrichment/query-table-hoa-pm.mjs";

export const HOA_PM_PROPERTY_APPROVAL_SCHEMA_VERSION =
  "elephant.filebase-hoa-pm-property-publish-approval.v1";

const approvalSchema = z
  .object({
    schemaVersion: z.literal(HOA_PM_PROPERTY_APPROVAL_SCHEMA_VERSION),
    action: z.enum([
      "publish-stamped-property-pages-and-overlay-query-table",
      "publish-thin-overlay-property-pages-and-overlay-query-table",
    ]),
    county: z.string().min(1),
    bucket: z.literal("elephant-oracle-query-table"),
    queryTableIpnsLabel: z.string().min(1),
    sourceQueryTable: z
      .object({
        bytes: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    sourceOfficialQueryTable: z
      .object({
        bytes: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .optional(),
    approved: z.literal(true),
    approvedBy: z.string().min(1),
    approvedAt: z.string().datetime({ offset: true }),
  })
  .strict();

function integrity(body) {
  return {
    bytes: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
}

function requiredOverlayLabel(county) {
  return `oracle-query-table-${county}-hoa-pm`;
}

function queryTableKey(county) {
  return `${county}/hoa-pm/query-table.parquet`;
}

function propertyObjectKey(county, link) {
  const suffix = createHash("sha256").update(link.key).digest("hex").slice(0, 16);
  return `${county}/hoa-pm/properties/${link.propertyCid ?? "thin"}-${suffix}.json`;
}

async function writeReceipt(filePath, receipt) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`);
  await rename(temporaryPath, filePath);
}

export function stampHoaPmPropertyJson(body, link) {
  const property = JSON.parse(body.toString("utf8"));
  if (
    typeof property !== "object" ||
    property === null ||
    Array.isArray(property)
  ) {
    throw new Error(`Property ${link.propertyCid} is not a JSON object`);
  }
  const stamped = { ...property };
  if (link.hoaCid) stamped.hoa_cid = link.hoaCid;
  if (link.propertyManagerCid) {
    stamped.property_manager_cid = link.propertyManagerCid;
  }
  return Buffer.from(JSON.stringify(stamped), "utf8");
}

export function thinHoaPmPropertyJson(county, link) {
  const property = {
    ...link.thinProperty,
    county: link.thinProperty?.county ?? county,
    ...(link.hoaCid ? { hoa_cid: link.hoaCid } : {}),
    ...(link.propertyManagerCid
      ? { property_manager_cid: link.propertyManagerCid }
      : {}),
    hoa_pm_status: link.hoaPmStatus,
  };
  return Buffer.from(JSON.stringify(property), "utf8");
}

export function validateHoaPmPropertyApproval(
  value,
  { county, bucket, queryTableIpnsLabel },
  sourceBody,
  officialBody = null,
  { thinOverlay = false } = {},
) {
  const approval = approvalSchema.parse(value);
  const expectedLabel = requiredOverlayLabel(county);
  if (
    bucket !== "elephant-oracle-query-table" ||
    queryTableIpnsLabel !== expectedLabel
  ) {
    throw new Error(
      `HOA/PM property publication must target ${expectedLabel} in elephant-oracle-query-table`,
    );
  }
  const expected = {
    action: thinOverlay
      ? "publish-thin-overlay-property-pages-and-overlay-query-table"
      : "publish-stamped-property-pages-and-overlay-query-table",
    county,
    bucket,
    queryTableIpnsLabel,
    sourceQueryTable: integrity(sourceBody),
    ...(officialBody
      ? { sourceOfficialQueryTable: integrity(officialBody) }
      : {}),
  };
  for (const field of [
    "action",
    "county",
    "bucket",
    "queryTableIpnsLabel",
  ]) {
    if (approval[field] !== expected[field]) {
      throw new Error(`HOA/PM property approval ${field} does not match`);
    }
  }
  if (
    approval.sourceQueryTable.bytes !== expected.sourceQueryTable.bytes ||
    approval.sourceQueryTable.sha256 !== expected.sourceQueryTable.sha256
  ) {
    throw new Error(
      "HOA/PM property approval source query table integrity does not match",
    );
  }
  if (
    JSON.stringify(approval.sourceOfficialQueryTable ?? null) !==
    JSON.stringify(expected.sourceOfficialQueryTable ?? null)
  ) {
    throw new Error(
      "HOA/PM property approval official query table integrity does not match",
    );
  }
  return approval;
}

async function publishLinkBatch({
  batch,
  county,
  bucket,
  client,
  fetchImpl,
}) {
  return Promise.all(
    batch.map(async (link) => {
      let body;
      if (link.propertyCid) {
        let response;
        for (let attempt = 0; attempt < 6; attempt += 1) {
          response = await fetchImpl(
            `${FILEBASE_GATEWAY}/ipfs/${link.propertyCid}`,
          );
          if (response.ok) break;
          if (response.status !== 429 && response.status < 500) break;
          const retryAfterHeader = response.headers.get("retry-after");
          const retryAfter =
            retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
          const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1_000
            : 500 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        if (!response?.ok) {
          throw new Error(
            `Property fetch failed for ${link.propertyCid}: ${response?.status ?? "no response"}`,
          );
        }
        body = stampHoaPmPropertyJson(
          Buffer.from(await response.arrayBuffer()),
          link,
        );
      } else {
        body = thinHoaPmPropertyJson(county, link);
      }
      const objectKey = propertyObjectKey(county, link);
      const cid = await uploadFilebaseObject({
        client,
        bucket,
        key: objectKey,
        body,
        contentType: "application/json",
      });
      if (!isIpfsCid(cid)) {
        throw new Error(`Filebase returned invalid property CID for ${objectKey}`);
      }
      return { ...link, cid, objectKey };
    }),
  );
}

export async function publishHoaPmPropertyPages(artifacts, config) {
  const expectedLabel = requiredOverlayLabel(artifacts.county);
  if (config.thinOverlay === true && artifacts.officialParquetPath) {
    throw new Error("--thin-overlay cannot be combined with --official-parquet");
  }
  if (
    artifacts.bucket !== "elephant-oracle-query-table" ||
    artifacts.queryTableIpnsLabel !== expectedLabel
  ) {
    throw new Error(
      `HOA/PM property publication must target ${expectedLabel} in elephant-oracle-query-table`,
    );
  }
  if (config.dryRun === true) {
    return {
      dryRun: true,
      bucket: artifacts.bucket,
      queryTableKey: queryTableKey(artifacts.county),
      queryTableIpnsLabel: artifacts.queryTableIpnsLabel,
      propertyObjectPrefix: `${artifacts.county}/hoa-pm/properties/`,
      approvalAction: config.thinOverlay
        ? "publish-thin-overlay-property-pages-and-overlay-query-table"
        : "publish-stamped-property-pages-and-overlay-query-table",
    };
  }
  if (!config.approvalManifestPath || !config.receiptPath) {
    throw new Error(
      "Live HOA/PM property publication requires --approve and --receipt",
    );
  }
  const env = config.env ?? process.env;
  fillDerivedFilebaseToken(env);
  if (!hasFilebaseCredentials(env)) {
    throw new Error(`Filebase credentials are missing for ${artifacts.county}`);
  }

  const sourceBody = await readFile(artifacts.parquetPath);
  const officialBody = artifacts.officialParquetPath
    ? await readFile(artifacts.officialParquetPath)
    : null;
  const approval = validateHoaPmPropertyApproval(
    JSON.parse(await readFile(config.approvalManifestPath, "utf8")),
    artifacts,
    sourceBody,
    officialBody,
    { thinOverlay: config.thinOverlay === true },
  );
  const sourceQueryTable = integrity(sourceBody);
  const sourceOfficialQueryTable = officialBody
    ? integrity(officialBody)
    : null;
  let receipt = {
    schemaVersion: "elephant.filebase-hoa-pm-property-publication-receipt.v1",
    status: "publishing",
    county: artifacts.county,
    bucket: artifacts.bucket,
    queryTableIpnsLabel: artifacts.queryTableIpnsLabel,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
    sourceQueryTable,
    sourceOfficialQueryTable,
    ...(config.thinOverlay === true ? { thinOverlay: true } : {}),
    properties: {},
    upload: null,
    name: null,
  };
  try {
    const existing = JSON.parse(await readFile(config.receiptPath, "utf8"));
    if (
      existing.county !== receipt.county ||
      existing.bucket !== receipt.bucket ||
      JSON.stringify(existing.sourceQueryTable) !==
        JSON.stringify(sourceQueryTable) ||
      JSON.stringify(existing.sourceOfficialQueryTable ?? null) !==
        JSON.stringify(sourceOfficialQueryTable) ||
      (existing.thinOverlay === true) !== (receipt.thinOverlay === true)
    ) {
      throw new Error("Existing HOA/PM property receipt is incompatible");
    }
    receipt = existing;
  } catch (caught) {
    if (!(caught instanceof Error && "code" in caught && caught.code === "ENOENT")) {
      throw caught;
    }
  }

  const client = new S3Client({
    region: "us-east-1",
    endpoint: config.endpoint ?? FILEBASE_S3_ENDPOINT,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID.trim(),
      secretAccessKey: env.S3_SECRET_ACCESS_KEY.trim(),
    },
    forcePathStyle: true,
  });
  const summary = await readHoaPmPropertyLinks(
    artifacts.parquetPath,
    artifacts.officialParquetPath ?? null,
    { allowThinOverlay: config.thinOverlay === true },
  );
  const pending = summary.links.filter((link) => !receipt.properties[link.key]);
  const batchSize = config.objectConcurrency ?? 4;
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const published = await publishLinkBatch({
      batch: pending.slice(offset, offset + batchSize),
      county: artifacts.county,
      bucket: artifacts.bucket,
      client,
      fetchImpl: config.fetchImpl ?? fetch,
    });
    for (const result of published) {
      receipt.properties[result.key] = {
        originalPropertyCid: result.propertyCid,
        thinOverlay: result.propertyCid == null,
        cid: result.cid,
        key: result.objectKey,
        parcelIdentifier: result.parcelIdentifier,
        hoaCid: result.hoaCid,
        propertyManagerCid: result.propertyManagerCid,
      };
    }
    await writeReceipt(config.receiptPath, receipt);
  }

  const outputDir = path.join(
    path.dirname(config.receiptPath),
    `${artifacts.county}-hoa-pm-property-published`,
  );
  await mkdir(outputDir, { recursive: true });
  const outputParquet = path.join(outputDir, "query-table.parquet");
  const propertyCidByParcel = new Map(
    Object.values(receipt.properties).map((value) => [
      value.parcelIdentifier,
      value.cid,
    ]),
  );
  const reconciliation = await restampHoaPmPropertyCids({
    inputParquet: artifacts.parquetPath,
    outputParquet,
    publishedPropertyCidByParcel: propertyCidByParcel,
  });
  receipt.reconciliation = {
    ...reconciliation,
    uniquePropertyCount: summary.links.length,
  };
  if (!receipt.upload) {
    receipt.upload = {
      key: queryTableKey(artifacts.county),
      cid: await uploadFilebaseObject({
        client,
        bucket: artifacts.bucket,
        key: queryTableKey(artifacts.county),
        body: await readFile(outputParquet),
        contentType: "application/vnd.apache.parquet",
      }),
    };
    await writeReceipt(config.receiptPath, receipt);
  }
  if (!receipt.name) {
    receipt.name = await upsertFilebaseName(
      env.FILEBASE_API_TOKEN.trim(),
      artifacts.queryTableIpnsLabel,
      receipt.upload.cid,
    );
  }
  receipt.status = "complete";
  receipt.completedAt = new Date().toISOString();
  await writeReceipt(config.receiptPath, receipt);
  return {
    dryRun: false,
    queryTableCid: receipt.upload.cid,
    queryTableIpns: `${FILEBASE_GATEWAY}/ipns/${receipt.name.network_key}`,
    matchedRowCount: reconciliation.matchedRowCount,
    uniquePropertyCount: summary.links.length,
    receiptPath: config.receiptPath,
  };
}
