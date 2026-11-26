/**
 * Pin a source document to IPFS through a Kubo RPC provider (Filebase by
 * default) and prove it is publicly retrievable before anything records the CID.
 *
 * Uses the same transport and credentials as CAR uploads
 * (`skills/use-oracle/reference/car-publication.md`): Kubo RPC on
 * `https://rpc.filebase.io` with bearer token base64(ACCESS_KEY:SECRET_KEY:BUCKET).
 * Credentials come from the environment only and are never logged.
 *
 * @module src/mortgage/ipfs-pin
 */

import { createHash } from "node:crypto";

export const FILEBASE_RPC = "https://rpc.filebase.io";
export const FILEBASE_GATEWAY = "https://ipfs.filebase.io";

/**
 * Build the pin configuration from environment variables.
 *
 * @param {NodeJS.ProcessEnv} env - Environment.
 * @returns {{ api: string, gateway: string, token: string }} Pin config.
 */
export function pinConfigFromEnv(env = process.env) {
  if (env.IPFS_API && env.IPFS_API_TOKEN) {
    return {
      api: env.IPFS_API.replace(/\/+$/, ""),
      gateway: (env.ELEPHANT_CAR_GATEWAY ?? FILEBASE_GATEWAY).replace(/\/+$/, ""),
      token: env.IPFS_API_TOKEN,
    };
  }
  const { FILEBASE_ACCESS_KEY, FILEBASE_SECRET_KEY, FILEBASE_BUCKET } = env;
  if (!FILEBASE_ACCESS_KEY || !FILEBASE_SECRET_KEY || !FILEBASE_BUCKET) {
    throw new Error(
      "Set FILEBASE_ACCESS_KEY, FILEBASE_SECRET_KEY and FILEBASE_BUCKET (or IPFS_API and IPFS_API_TOKEN) to pin documents",
    );
  }
  return {
    api: FILEBASE_RPC,
    gateway: (env.ELEPHANT_CAR_GATEWAY ?? FILEBASE_GATEWAY).replace(/\/+$/, ""),
    token: Buffer.from(
      `${FILEBASE_ACCESS_KEY}:${FILEBASE_SECRET_KEY}:${FILEBASE_BUCKET}`,
    ).toString("base64"),
  };
}

/**
 * @param {Uint8Array} bytes - Content.
 * @returns {string} Hex sha256.
 */
export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Add and pin one file (CIDv1), then read it back through the gateway and
 * require the bytes to hash to the original sha256.
 *
 * @param {{
 *   bytes: Uint8Array,
 *   fileName: string,
 *   contentType?: string,
 *   config: { api: string, gateway: string, token: string },
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 * }} input - File and provider.
 * @returns {Promise<{
 *   cid: string,
 *   ipfsUrl: string,
 *   gatewayUrl: string,
 *   bytes: number,
 *   sha256: string,
 *   api: string,
 *   pinnedAt: string,
 * }>} Verified pin receipt.
 */
export async function pinAndVerify(input) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 300_000;
  const sha256 = sha256Hex(input.bytes);

  const form = new FormData();
  form.append(
    "file",
    new Blob([input.bytes], {
      type: input.contentType ?? "application/octet-stream",
    }),
    input.fileName,
  );
  const response = await fetchImpl(
    `${input.config.api}/api/v0/add?cid-version=1&pin=true`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${input.config.token}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`IPFS add returned HTTP ${response.status}`);
  }
  const lines = body.trim().split("\n").filter(Boolean);
  const cid = JSON.parse(lines[lines.length - 1]).Hash;
  if (typeof cid !== "string" || !/^baf[a-z2-7]+$/.test(cid)) {
    throw new Error("IPFS add returned no CIDv1");
  }

  const gatewayUrl = `${input.config.gateway}/ipfs/${cid}`;
  const readback = await fetchImpl(gatewayUrl, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!readback.ok) {
    throw new Error(`Gateway readback of ${cid} returned HTTP ${readback.status}`);
  }
  const readbackBytes = new Uint8Array(await readback.arrayBuffer());
  const readbackSha = sha256Hex(readbackBytes);
  if (readbackSha !== sha256) {
    throw new Error(
      `Gateway readback of ${cid} hashed to ${readbackSha}, expected ${sha256}`,
    );
  }

  return {
    cid,
    ipfsUrl: `ipfs://${cid}`,
    gatewayUrl,
    bytes: input.bytes.byteLength,
    sha256,
    api: input.config.api,
    pinnedAt: new Date().toISOString(),
  };
}
