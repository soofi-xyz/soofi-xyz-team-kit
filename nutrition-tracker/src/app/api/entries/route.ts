import { authorize, json, readJson } from "../../../lib/auth";
import { InputError, isRecord, parseAdd, parseCopy, parseEntryPatch, parseId } from "../../../lib/food";
import { addEntry, copyDay, deleteEntry, updateEntry } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function saved(error: unknown, fallback: string): Response {
  if (error instanceof InputError) return json({ error: error.message }, 400);
  console.error(fallback);
  return json({ error: "Could not save that item." }, 500);
}

export async function POST(request: Request) {
  const viewer = await authorize(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  try {
    if (isRecord(body) && body.op === "copy") {
      const parsed = parseCopy(body);
      if (!parsed.ok) return json({ error: parsed.error }, 400);
      const added = await copyDay(viewer.householdId, parsed.value);
      return json({ ok: true, added });
    }
    const parsed = parseAdd(body);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    await addEntry(viewer.householdId, parsed.value);
    return json({ ok: true });
  } catch (error) {
    return saved(error, "entry save failed");
  }
}

export async function PATCH(request: Request) {
  const viewer = await authorize(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = parseEntryPatch(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  try {
    await updateEntry(viewer.householdId, parsed.value);
    return json({ ok: true });
  } catch (error) {
    return saved(error, "entry update failed");
  }
}

export async function DELETE(request: Request) {
  const viewer = await authorize(request);
  if (viewer instanceof Response) return viewer;
  const id = parseId(new URL(request.url).searchParams.get("id"));
  if (!id) return json({ error: "That item could not be found." }, 400);
  try {
    await deleteEntry(viewer.householdId, id);
    return json({ ok: true });
  } catch (error) {
    return saved(error, "entry delete failed");
  }
}
