import { createHash } from "node:crypto";

const LOCAL_CID_PATTERN = /^sha256:[a-f0-9]{64}$/;
const IPFS_CID_PATTERN = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]+)$/;

function canonicalPayload(object) {
  const { cid: _cid, ...payload } = object;
  return payload;
}

function localCidFor(payload) {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

export function isIpfsCid(value) {
  return typeof value === "string" && IPFS_CID_PATTERN.test(value);
}

export function parseHoaPmObjects(body) {
  const byLocalCid = new Map();
  for (const [index, line] of body.toString("utf8").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const object = JSON.parse(line);
    if (!LOCAL_CID_PATTERN.test(object.cid ?? "")) {
      throw new Error(`HOA/PM object line ${index + 1} has no local sha256 CID`);
    }
    const payload = canonicalPayload(object);
    if (localCidFor(payload) !== object.cid) {
      throw new Error(`HOA/PM object ${object.cid} does not match its canonical payload`);
    }
    if (
      object.type !== "company" &&
      object.type !== "homeowners_association"
    ) {
      throw new Error(`Unsupported HOA/PM object type: ${object.type}`);
    }
    const previous = byLocalCid.get(object.cid);
    if (previous && JSON.stringify(previous) !== JSON.stringify(object)) {
      throw new Error(`Conflicting HOA/PM payloads share ${object.cid}`);
    }
    byLocalCid.set(object.cid, object);
  }
  return [...byLocalCid.values()];
}

export function publishableHoaPmObject(object, publishedCidByLocalCid) {
  const payload = canonicalPayload(object);
  for (const field of ["company_cid", "property_manager_cid"]) {
    const localCid = payload[field];
    if (localCid == null) continue;
    const publishedCid = publishedCidByLocalCid.get(localCid);
    if (!isIpfsCid(publishedCid)) {
      throw new Error(`HOA/PM object ${object.cid} has unresolved ${field} ${localCid}`);
    }
    payload[field] = publishedCid;
  }
  return Buffer.from(JSON.stringify(payload), "utf8");
}

export function hoaPmPublicationLayers(objects) {
  const companies = objects.filter((object) => object.type === "company");
  const associations = objects.filter(
    (object) => object.type === "homeowners_association",
  );
  const known = new Set(objects.map((object) => object.cid));
  for (const association of associations) {
    for (const field of ["company_cid", "property_manager_cid"]) {
      if (association[field] != null && !known.has(association[field])) {
        throw new Error(
          `HOA/PM object ${association.cid} references missing ${field} ${association[field]}`,
        );
      }
    }
  }
  return [companies, associations];
}

export function restampHoaPmObjectBundle(objects, publishedCidByLocalCid) {
  return Buffer.from(
    objects
      .map((object) => {
        const payload = JSON.parse(
          publishableHoaPmObject(object, publishedCidByLocalCid).toString("utf8"),
        );
        const cid = publishedCidByLocalCid.get(object.cid);
        if (!isIpfsCid(cid)) {
          throw new Error(`HOA/PM object ${object.cid} has no published CID`);
        }
        return JSON.stringify({ ...payload, cid });
      })
      .join("\n")
      .concat(objects.length ? "\n" : ""),
    "utf8",
  );
}
