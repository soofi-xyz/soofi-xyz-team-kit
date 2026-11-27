import { authorize, json } from "../../../lib/auth";
import { parseDate } from "../../../lib/food";
import { getBoard } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await authorize(request);
  if (viewer instanceof Response) return viewer;
  const date = parseDate(new URL(request.url).searchParams.get("date"));
  if (!date) return json({ error: "Choose a valid day." }, 400);
  try {
    return json(await getBoard(viewer.householdId, date));
  } catch (error) {
    console.error("board load failed");
    const message = error instanceof Error ? error.message : "";
    if (message === "A saved staple is unreadable." || message === "A logged item is unreadable.") {
      return json({ error: message }, 500);
    }
    return json({ error: "Could not load this day." }, 500);
  }
}
