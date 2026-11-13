import { authorize, json, readJson } from "../../../lib/auth";
import { InputError, isRecord, parseId, parseStaple } from "../../../lib/food";
import { addStaple, deleteStaple, updateStaple } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function saved(error: unknown): Response {
  if (error instanceof InputError) return json({ error: error.message }, 400);
  console.error("staple save failed");
  return json({ error: "Could not save that staple." }, 500);
}

export async function POST(request: Request) {
  const viewer = await authorize(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = parseStaple(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  try {
    await addStaple(viewer.householdId, parsed.value);
    return json({ ok: true });
  } catch (error) {
    return saved(error);
  }
}

export async function PATCH(request: Request) {
  const viewer = await authorize(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (!isRecord(body)) return json({ error: "Expected a staple." }, 400);
  const id = parseId(body.id);
  if (!id) return json({ error: "That staple is already gone." }, 400);
  const parsed = parseStaple(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  try {
    await updateStaple(viewer.householdId, id, parsed.value);
    return json({ ok: true });
  } catch (error) {
    return saved(error);
  }
}

export async function DELETE(request: Request) {
  const viewer = await authorize(request);
  if (viewer instanceof Response) return viewer;
  const id = parseId(new URL(request.url).searchParams.get("id"));
  if (!id) return json({ error: "That staple is already gone." }, 400);
  try {
    await deleteStaple(viewer.householdId, id);
    return json({ ok: true });
  } catch (error) {
    return saved(error);
  }
}
