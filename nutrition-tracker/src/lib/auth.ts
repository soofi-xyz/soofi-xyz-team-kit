import "server-only";
import { getIdentity, type VerifiedIdentity } from "../../cursor/identity";

export type Viewer = {
  householdId: string;
};

export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export async function authorize(request: Request): Promise<Viewer | Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    const blocked = crossOrigin(request);
    if (blocked) return blocked;
  }
  const identity = await getIdentity(request);
  if (!identity.verified) {
    return json({ error: "Sign in with Cursor to open this log." }, 401);
  }
  return { householdId: householdFor(identity) };
}

function householdFor(identity: VerifiedIdentity): string {
  const scope = identity.appVisibility === "team" ? `team:${identity.teamId}` : `user:${identity.sub}`;
  return `${identity.stage}:${scope}`;
}

function crossOrigin(request: Request): Response | null {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return json({ error: "Cross-origin request blocked." }, 403);
  }
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const forwarded = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const host = forwarded.split(",")[0]?.trim() ?? "";
  if (!host) return json({ error: "Bad request." }, 400);
  try {
    if (new URL(origin).host !== host) return json({ error: "Cross-origin request blocked." }, 403);
  } catch {
    return json({ error: "Bad request." }, 400);
  }
  return null;
}

export async function readJson(request: Request): Promise<unknown | Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 20_000) return json({ error: "Request is too large." }, 413);
  const text = await request.text();
  if (text.length > 20_000) return json({ error: "Request is too large." }, 413);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return json({ error: "Expected JSON." }, 400);
  }
}
