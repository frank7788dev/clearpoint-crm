// campaign-sync: the email campaign (Google Apps Script) reports replies, bookings and
// opt-outs here, and this updates the agent in the CRM. Only Frank's Google account is accepted.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const STATUS: Record<string, string> = { replied: "replied", booked: "booked", optout: "dnc" };

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  // Only Frank's Google account may report campaign events: the script sends its Google
  // sign-in token, and Google confirms whose it is.
  const ALLOWED = ["fadybashir@clearpointglobal.org"];
  const idToken = req.headers.get("x-google-id-token") || "";
  if (!idToken) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  const info = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken)).then((r) => r.ok ? r.json() : null).catch(() => null);
  if (!info || String(info.email_verified) !== "true" || !ALLOWED.includes(String(info.email).toLowerCase()) || Number(info.exp) * 1000 < Date.now()) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }
  let p: { email?: string; event?: string; what?: string; body?: string; when?: string };
  try { p = await req.json(); } catch { return new Response(JSON.stringify({ error: "bad json" }), { status: 400 }); }
  const email = String(p.email || "").trim().toLowerCase();
  const event = String(p.event || "");
  if (!email || !STATUS[event]) return new Response(JSON.stringify({ error: "email and event required" }), { status: 400 });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: rows, error } = await sb.from("agents").select("id,status").eq("email", email).limit(3);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!rows || !rows.length) return new Response(JSON.stringify({ matched: 0 }));

  const at = new Date().toISOString();
  const what = String(p.what || "").slice(0, 200);
  const body = String(p.body || "").slice(0, 2000);
  for (const r of rows) {
    const patch: Record<string, unknown> = {
      last_touch: { at, ch: "email", dir: event === "booked" ? "note" : "in", what, body: body.slice(0, 240) },
    };
    // never move someone backwards (e.g. a reply after they already booked)
    const order = ["new", "contacted", "replied", "booked", "contracting", "joined"];
    const next = STATUS[event];
    if (next === "dnc" || order.indexOf(next) > order.indexOf(r.status)) patch.status = next;
    if (event === "replied") patch.waiting = !/booking link sent/i.test(what);
    if (event === "booked") { patch.waiting = false; if (p.when) patch.fu = String(p.when).slice(0, 10); }
    if (event === "optout") { patch.waiting = false; patch.fu = ""; }
    await sb.from("agents").update(patch).eq("id", r.id);
    await sb.from("activities").insert({ agent_id: r.id, user_id: null, ch: "email", dir: event === "booked" ? "note" : "in", what, body, at });
  }
  return new Response(JSON.stringify({ matched: rows.length }), { headers: { "Content-Type": "application/json" } });
});
