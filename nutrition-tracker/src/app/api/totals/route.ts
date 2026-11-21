import { authorize, json, readJson } from "../../../lib/auth";
import { InputError, parseDailyTotal, parseDate, parseId } from "../../../lib/food";
import { deleteDailyTotal, upsertDailyTotal } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function saved(error: unknown): Response {
  if (error instanceof InputError) return json({ error: error.message }, 400);
  console.error("daily total save failed");
  return json({ error: "Could not save that daily total." }, 500);
}

export async function PUT(request: Request) {
  const viewer = await authorize(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = parseDailyTotal(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  try {
    await upsertDailyTotal(viewer.householdId, parsed.value);
    return json({ ok: true });
  } catch (error) {
    return saved(error);
  }
}

export async function DELETE(request: Request) {
  const viewer = await authorize(request);
  if (viewer instanceof Response) return viewer;
  const params = new URL(request.url).searchParams;
  const personId = parseId(params.get("personId"));
  const date = parseDate(params.get("date"));
  if (!personId) return json({ error: "Choose a person." }, 400);
  if (!date) return json({ error: "Choose a valid day." }, 400);
  try {
    await deleteDailyTotal(viewer.householdId, personId, date);
    return json({ ok: true });
  } catch (error) {
    return saved(error);
  }
}
