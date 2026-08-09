export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ status: "ok", zeit: new Date().toISOString() });
}
