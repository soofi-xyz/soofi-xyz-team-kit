import { authorize, json, readJson } from "../../../lib/auth";
import { InputError, parsePerson } from "../../../lib/food";
import { updatePerson } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const viewer = await authorize(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = parsePerson(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  try {
    await updatePerson(viewer.householdId, parsed.value);
    return json({ ok: true });
  } catch (error) {
    if (error instanceof InputError) return json({ error: error.message }, 400);
    console.error("person update failed");
    return json({ error: "Could not save that person." }, 500);
  }
}
