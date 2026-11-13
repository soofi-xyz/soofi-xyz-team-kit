// Cursor app identity: the simulated viewer for local development. Yours to edit; add-app-identity seeds this file once and never rewrites it.
// While neither CURSOR_APP_ID nor VERCEL is set, which is only your own dev server, a request without the identity header reads as this viewer, with simulated: true and an empty token. Nothing verified it. A published app never reads this file: the gate's signed header is the only viewer it trusts.
// The viewer is invented. Change the fields to see another role or email (teamRole: "member"), or set DEV_VIEWER to null to see the signed-out state (missing_header, 401 from requireIdentity), which every page still has to render. Never write a real person's identity here.

import type { DevViewer } from "./identity.js";

export const DEV_VIEWER: DevViewer | null = {
  sub: "user:dev",
  email: "dev@example.com",
  name: "Dev Viewer",
  teamId: 1,
  teamRole: "admin",
};
