// campaign-sync: the bridge between Frank's Google account (Apps Script) and the CRM.
// - replied / booked / optout: updates the agent and logs it
// - calendar: keeps the CRM's list of upcoming calls in step with Google Calendar
// - stats: stores the email campaign's numbers for the Home dashboard
// - outbox_pull / outbox_done: emails written in the CRM, sent from Frank's business address
// - threads: email threads the CRM sent, so replies to them are caught too
// Only Frank's Google account is accepted: the script sends its Google sign-in token and
// Google confirms whose it is.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const ALLOWED = ["fadybashir@clearpointglobal.org"];
const STATUS: Record<string, string> = { replied: "replied", booked: "booked", optout: "dnc" };
const ORDER = ["new", "contacted", "replied", "booked", "contracting", "joined"];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const idToken = req.headers.get("x-google-id-token") || "";
  if (!idToken) return json({ error: "forbidden" }, 403);
  let info: Record<string, unknown> | null = null, why = "";
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken));
    if (r.ok) info = await r.json(); else why = "tokeninfo " + r.status;
  } catch (e) { why = "tokeninfo unreachable: " + String(e).slice(0, 120); }
  if (!info) return json({ error: "forbidden", why }, 403);
  if (String(info.email_verified) !== "true") return json({ error: "forbidden", why: "email not verified" }, 403);
  if (!ALLOWED.includes(String(info.email).toLowerCase())) return json({ error: "forbidden", why: "account not allowed" }, 403);
  if (Number(info.exp) * 1000 < Date.now()) return json({ error: "forbidden", why: "token expired" }, 403);
  // deno-lint-ignore no-explicit-any
  let p: any;
  try { p = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const event = String(p.event || "");
  const now = new Date().toISOString();

  if (event === "calendar") {
    const evs = Array.isArray(p.events) ? p.events.slice(0, 500) : [];
    const from = String(p.from || now), to = String(p.to || now);
    const emails = [...new Set(evs.map((e: { guest?: string }) => String(e.guest || "").toLowerCase()).filter(Boolean))];
    const ids: Record<string, string> = {};
    if (emails.length) {
      const { data } = await sb.from("agents").select("id,email").in("email", emails);
      (data || []).forEach((a) => { ids[String(a.email).toLowerCase()] = a.id; });
    }
    const rows = evs.map((e: Record<string, string>) => ({
      id: String(e.id).slice(0, 300), start_at: e.start, end_at: e.end || null, title: String(e.title || "").slice(0, 300),
      meet_url: String(e.meet || "").slice(0, 500), guest_email: String(e.guest || "").toLowerCase(), guest_name: String(e.guestName || "").slice(0, 200),
      agent_id: ids[String(e.guest || "").toLowerCase()] || null, updated_at: now,
    }));
    if (rows.length) { const r = await sb.from("calls").upsert(rows, { onConflict: "id" }); if (r.error) return json({ error: r.error.message }, 500); }
    // calls cancelled or moved out of the window
    const keep = rows.map((r: { id: string }) => r.id);
    let del = sb.from("calls").delete().gte("start_at", from).lte("start_at", to);
    if (keep.length) del = del.not("id", "in", "(" + keep.map((k: string) => '"' + k.replace(/"/g, "") + '"').join(",") + ")");
    await del;
    await sb.from("calls").delete().lt("start_at", new Date(Date.now() - 14 * 864e5).toISOString());
    return json({ calls: rows.length });
  }

  if (event === "stats") {
    const r = await sb.from("org_settings").update({ campaign: { ...(p.stats || {}), at: now } }).eq("id", 1);
    return r.error ? json({ error: r.error.message }, 500) : json({ ok: true });
  }

  if (event === "outbox_pull") {
    const limit = Math.max(0, Math.min(30, Number(p.limit) || 10));
    // anything stuck "sending" for 30+ minutes failed in the middle: report it rather than risk a double send
    await sb.from("outbox").update({ status: "error", error: "Sending was interrupted. Check Sent mail before trying again." }).eq("status", "sending").lt("created_at", new Date(Date.now() - 30 * 6e4).toISOString());
    if (!limit) return json({ items: [] });
    const { data, error } = await sb.from("outbox").select("id,agent_id,to_email,subject,body,kind").eq("status", "queued").lte("scheduled_for", now).order("scheduled_for").limit(limit);
    if (error) return json({ error: error.message }, 500);
    let items = data || [];
    // batch first-emails: skip anyone who was contacted, replied or opted out since it was scheduled
    const batchIds = items.filter((x) => x.kind === "batch" && x.agent_id).map((x) => x.agent_id);
    if (batchIds.length) {
      const { data: ags } = await sb.from("agents").select("id,status").in("id", batchIds);
      const st: Record<string, string> = {}; (ags || []).forEach((a) => { st[a.id] = a.status; });
      const skip = items.filter((x) => x.kind === "batch" && x.agent_id && st[x.agent_id] && st[x.agent_id] !== "new").map((x) => x.id);
      if (skip.length) await sb.from("outbox").update({ status: "error", error: "Skipped: already contacted" }).in("id", skip);
      items = items.filter((x) => skip.indexOf(x.id) < 0);
    }
    if (items.length) await sb.from("outbox").update({ status: "sending" }).in("id", items.map((x) => x.id));
    return json({ items });
  }

  if (event === "outbox_done") {
    const results = Array.isArray(p.results) ? p.results : [];
    for (const r of results) {
      const { data: ob } = await sb.from("outbox").select("*").eq("id", r.id).maybeSingle();
      if (!ob) continue;
      if (!r.ok) { await sb.from("outbox").update({ status: "error", error: String(r.error || "failed").slice(0, 300) }).eq("id", r.id); continue; }
      await sb.from("outbox").update({ status: "sent", thread_id: String(r.thread || ""), sent_at: now }).eq("id", r.id);
      if (!ob.agent_id) continue;
      const { data: ag } = await sb.from("agents").select("id,status,fu").eq("id", ob.agent_id).maybeSingle();
      if (!ag) continue;
      const patch: Record<string, unknown> = {
        last_touch: { at: now, ch: "email", dir: "out", what: "Email sent from business email", body: "" },
        waiting: false,
      };
      if (ag.status === "new") patch.status = "contacted";
      if (!ag.fu) patch.fu = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
      await sb.from("agents").update(patch).eq("id", ag.id);
      await sb.from("activities").insert({ agent_id: ag.id, user_id: ob.created_by, ch: "email", dir: "out", what: "Email sent from business email", sub: ob.subject, body: ob.body, at: now });
    }
    return json({ ok: true });
  }

  if (event === "threads") {
    const since = new Date(Date.now() - 45 * 864e5).toISOString();
    const { data } = await sb.from("outbox").select("thread_id,to_email,agent_id").eq("status", "sent").gte("sent_at", since).neq("thread_id", "").limit(2000);
    const out = [];
    for (const t of data || []) out.push({ thread: t.thread_id, email: t.to_email });
    // first names for the auto-reply greeting
    const ids = [...new Set((data || []).map((t) => t.agent_id).filter(Boolean))];
    const names: Record<string, string> = {};
    for (let i = 0; i < ids.length; i += 200) {
      const { data: ag } = await sb.from("agents").select("email,first").in("id", ids.slice(i, i + 200));
      (ag || []).forEach((a) => { names[String(a.email).toLowerCase()] = a.first || ""; });
    }
    return json({ threads: out.map((t) => ({ ...t, first: names[String(t.email).toLowerCase()] || "" })) });
  }

  // replied / booked / optout
  const email = String(p.email || "").trim().toLowerCase();
  if (!email || !STATUS[event]) return json({ error: "email and event required" }, 400);
  const { data: rows, error } = await sb.from("agents").select("id,status").eq("email", email).limit(3);
  if (error) return json({ error: error.message }, 500);
  if (!rows || !rows.length) return json({ matched: 0 });
  const what = String(p.what || "").slice(0, 200);
  const body = String(p.body || "").slice(0, 2000);
  for (const r of rows) {
    const patch: Record<string, unknown> = {
      last_touch: { at: now, ch: "email", dir: event === "booked" ? "note" : "in", what, body: body.slice(0, 240) },
    };
    const next = STATUS[event];
    if (next === "dnc" || ORDER.indexOf(next) > ORDER.indexOf(r.status)) patch.status = next;
    if (event === "replied") patch.waiting = !/booking link sent/i.test(what);
    if (event === "booked") { patch.waiting = false; if (p.when) patch.fu = String(p.when).slice(0, 10); }
    if (event === "optout") { patch.waiting = false; patch.fu = ""; }
    await sb.from("agents").update(patch).eq("id", r.id);
    await sb.from("activities").insert({ agent_id: r.id, user_id: null, ch: "email", dir: event === "booked" ? "note" : "in", what, body, at: now });
  }
  return json({ matched: rows.length });
});
