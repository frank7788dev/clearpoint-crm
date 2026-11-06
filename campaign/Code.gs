// TASK: the Run button runs this
function task() { setup(); const me = Session.getActiveUser().getEmail().toLowerCase(); syncCalendar(me); pushStats(); }
// END TASK
// ClearPoint Global recruiting emails, sent from fadybashir@clearpointglobal.org.
// Sends a 3-email sequence to the agents in the Google Sheet, stops for anyone who
// replies, and warms up the new domain slowly so emails land in the inbox.
// The old Gmail project only finishes follow-ups it started; rows sent from here are tagged "W:".

const SHEET_ID = '1P5lpG1UJpD47VnOm9VZTp5mWh6j1OVXC_HsjFK_zqCA';
const PER_RUN = 15;          // runs every hour, Mon-Fri 8am-5pm Eastern
const DAYS_BETWEEN = 3;
const TZ = 'America/Detroit';
const TAG = 'W:';            // marks threads that live in this mailbox

// Replies, bookings and notifications
const BOOKING_URL = 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ3zCJ4R7G-ZUDKAmekWWmadc5py1KwR33N3cPo_HzqBFH65TDj1Lkwg9hOJMRIcgpwGU32I_28O';
const NOTIFY_TO = 'fadybashir3218@gmail.com';   // your phone gets these as Gmail push notifications
const CRM_URL = 'https://keykofhjbiptqessfkdy.supabase.co/functions/v1/campaign-sync';
const CRM_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtleWtvZmhqYmlwdHFlc3Nma2R5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5MTc2OTAsImV4cCI6MjEwOTQ5MzY5MH0.uWZKMMIzj9W5gpl3eu1UrLAPI3Ip1BoGTlPxZgzOmh0';                 // public app key (same one the CRM app uses)
const BOOK_REPLY = 'Great to hear from you, {first}.\n\n' +
  "Grab any open time that works for you here and it goes straight onto my calendar with a Google Meet link:\n" + BOOKING_URL + '\n\n' +
  'If none of those times work, reply with one that does, or call or text me at (248) 805-2855.\n\n' +
  'Frank B.\nClearPoint Global\n(248) 805-2855';

// New-domain warm-up: 30 emails on day 1, +10 a day, capped at 140 a day.
function dailyLimit() {
  const props = PropertiesService.getScriptProperties();
  const start = props.getProperty('start') ? new Date(props.getProperty('start')) : new Date();
  const days = Math.max(0, Math.floor((new Date() - start) / 864e5));
  return Math.min(140, 30 + 10 * days);
}

const E1_SUBJ = '{first}, a better contract is worth one call';
const E1 = 'Hello {first},\n\n' +
  "I'm Frank with ClearPoint Global. I work in the life insurance industry, and I love what you're doing, especially what you're building toward and the goals you're going after.\n\n" +
  "Here's why I'm reaching out: I'm direct to the IMO, which means fewer layers between you and your money. I have the systems and structure in place for you to prosper, and if you have a team, your team prospers with you.\n\n" +
  "On one quick call, I'll show you exactly what your compensation looks like at a higher contract level, side by side with what you have now. I guarantee it won't be a waste of your time.\n\n" +
  "Call or text me at (248) 805-2855, or just reply and I'll send you my calendar to grab a time.\n\n" +
  'Frank B.\nClearPoint Global\n(248) 805-2855\n\n' +
  'Not interested? Reply "no thanks" and I won\'t email you again.';

const E2 = 'Hello {first},\n\n' +
  "Following up on my note. One honest question: do you know exactly what you're paid on each policy, and how many layers sit between you and the carrier?\n\n" +
  "Most agents I talk to don't, and that's usually where the money goes. Because I'm direct to the IMO, I can put your numbers next to ours in 15 minutes, on Zoom or the phone. If yours come out better, I'll tell you.\n\n" +
  'Call or text (248) 805-2855, or just reply with a time that works.\n\n' +
  'Frank B.\nClearPoint Global';

const E3_SUBJ = 'Should I close your file?';
const E3 = 'Hello {first},\n\n' +
  "I haven't heard back, so I'll assume the timing isn't right, and that's completely okay.\n\n" +
  "One last thought before I close this out: the agents who grow fastest are the ones who stop leaving money on the table early. If you ever want to see what your comp, and your team's comp, could look like with ClearPoint, my line stays open: (248) 805-2855.\n\n" +
  'Wishing you a great year either way.\n\n' +
  'Frank B.\nClearPoint Global\n(248) 805-2855';

function fill(t, first) { return t.split('{first}').join(first); }

// Run once: turns on the hourly schedule and starts the warm-up clock.
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('run').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('sendOutbox').timeBased().everyMinutes(5).create();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('start')) props.setProperty('start', new Date().toISOString());
  SpreadsheetApp.openById(SHEET_ID).getName(); // confirms access to the sheet
}

// Sends you a preview of all 3 emails from the company address.
function sendTest() {
  const me = Session.getActiveUser().getEmail();
  GmailApp.sendEmail(me, '[TEST 1/3] ' + fill(E1_SUBJ, 'Frank'), fill(E1, 'Frank'));
  GmailApp.sendEmail(me, '[TEST 2/3] Re: ' + fill(E1_SUBJ, 'Frank'), fill(E2, 'Frank'));
  GmailApp.sendEmail(me, '[TEST 3/3] ' + E3_SUBJ, fill(E3, 'Frank'));
}

// Sends you a sample notification so you can check it reaches your phone.
function testNotification() { notifyMe('✅ ClearPoint alerts are on', 'This is how you\'ll hear about replies and booked calls.'); }

// Stops the automation.
function stopAll() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

function theyReplied(ids, me) {
  for (const raw of String(ids).split(',').filter(String)) {
    const id = raw.indexOf(TAG) === 0 ? raw.slice(TAG.length) : raw;
    let th; try { th = GmailApp.getThreadById(id); } catch (e) { continue; }
    if (!th) continue;
    for (const m of th.getMessages()) {
      const from = m.getFrom().toLowerCase();
      if (from.indexOf(me) === -1) return /mailer-daemon|postmaster/.test(from) ? 'Bounced' : 'Replied';
    }
  }
  return '';
}

function sendTracked(to, subj, body) {
  const msg = GmailApp.createDraft(to, subj, body).send();
  return msg.getThread().getId();
}

function batchSheets() {
  return SpreadsheetApp.openById(SHEET_ID).getSheets()
    .filter(function (s) { return /^Batch/.test(s.getName()); })
    .sort(function (a, b) { return a.getName().localeCompare(b.getName(), undefined, { numeric: true }); });
}

/* ---------------- replies, bookings, notifications ---------------- */

// Only the newest part of a reply (drops the quoted email underneath).
function freshText(m) {
  const out = [];
  for (const line of String(m.getPlainBody() || '').split(/\r?\n/)) {
    if (/^\s*>/.test(line) || /^On .+wrote:\s*$/.test(line) || /^-{2,}\s*Original Message/i.test(line) || /^From: /.test(line)) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

// optout | yes | other
function classify(text) {
  const t = ' ' + text.toLowerCase().replace(/[’]/g, "'") + ' ';
  if (/\b(no thanks|no thank you|not interested|unsubscribe|remove me|take me off|stop emailing|stop contacting|do not (email|contact)|don't (email|contact)|please stop|leave me alone)\b/.test(t) || /^\s*(no|stop|remove)[.!]?\s*$/.test(text.toLowerCase())) return 'optout';
  if (/\b(yes|yeah|yep|sure|interested|let'?s (talk|chat|connect|do it|set)|call me|give me a call|happy to (talk|chat|connect)|open to|i'?m (free|available)|available|schedule|set (up )?a (call|time|meeting)|book|tell me more|more info|sounds good|send (me )?(the |a |your )?(link|calendar|zoom|times?)|what times?|when (are|is) you|works for me|let me know when)\b/.test(t)) return 'yes';
  return 'other';
}

function mark(ref, status) { ref.status = status; if (ref.sh) ref.sh.getRange(ref.r, ref.col).setValue(status); }

function notifyMe(subject, body) {
  try { GmailApp.sendEmail(NOTIFY_TO, subject, body + '\n\n— ClearPoint CRM', { name: 'ClearPoint CRM' }); } catch (e) {}
}

// Tells the CRM what happened, signed with your Google account so nobody else can.
function toCrm(email, event, what, body, when) {
  return crm({ email: email, event: event, what: what, body: String(body || '').slice(0, 2000), when: when || '' });
}
function crm(payload) {
  try {
    const r = UrlFetchApp.fetch(CRM_URL, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + CRM_KEY, apikey: CRM_KEY, 'x-google-id-token': ScriptApp.getIdentityToken() },
      payload: JSON.stringify(Object.assign({ id_token: ScriptApp.getIdentityToken() }, payload))
    });
    if (r.getResponseCode() !== 200) { console.log('CRM ' + payload.event + ': ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200)); return null; }
    return JSON.parse(r.getContentText());
  } catch (e) { console.log('CRM ' + payload.event + ': ' + e); return null; }
}

// Every agent row this mailbox emailed, by thread and by email.
function rowIndex() {
  const byThread = {}, byEmail = {};
  batchSheets().forEach(function (sh) {
    const d = sh.getDataRange().getValues(), H = d[0];
    const iE = H.indexOf('Email'), iT = H.indexOf('Thread ID'), iF = H.indexOf('First Name'), iSt = H.indexOf('Status');
    for (let r = 1; r < d.length; r++) {
      const ids = String(d[r][iT] || '');
      if (ids.indexOf(TAG) !== 0) continue;
      const ref = { sh: sh, r: r + 1, col: iSt + 1, email: String(d[r][iE]).trim(), first: String(d[r][iF]).trim() || 'there', status: String(d[r][iSt]) };
      ids.slice(TAG.length).split(',').forEach(function (id) { if (id) byThread[id] = ref; });
      byEmail[ref.email.toLowerCase()] = ref;
    }
  });
  const t = crm({ event: 'threads' });
  ((t && t.threads) || []).forEach(function (x) {
    if (byThread[x.thread]) return;
    const ref = byEmail[String(x.email).toLowerCase()] || { email: x.email, first: x.first || 'there', status: '' };
    byThread[x.thread] = ref;
  });
  return { byThread: byThread, byEmail: byEmail };
}

// Reads new replies: interested people get your booking link right away, opt-outs are stopped,
// anything else is flagged for you. You get a notification for every real reply.
function handleReplies(idx, me) {
  const props = PropertiesService.getScriptProperties();
  const threads = GmailApp.search('newer_than:3d -from:me -in:sent', 0, 100);
  for (const th of threads) {
    const ref = idx.byThread[th.getId()];
    if (!ref) continue;
    const msgs = th.getMessages(), last = msgs[msgs.length - 1];
    const from = last.getFrom().toLowerCase();
    if (from.indexOf(me) !== -1) continue;                 // we already answered
    const key = 'm:' + last.getId();
    if (props.getProperty(key)) continue;                   // already handled
    props.setProperty(key, '1');
    if (/mailer-daemon|postmaster/.test(from)) { mark(ref, 'Bounced'); continue; }
    const text = freshText(last), kind = classify(text);
    const already = /booking link sent|Call booked/.test(ref.status);
    if (kind === 'optout') {
      mark(ref, 'Opted out');
      toCrm(ref.email, 'optout', 'Opted out by email', text);
      continue;
    }
    if (kind === 'yes' && !already) {
      th.reply(fill(BOOK_REPLY, ref.first));
      mark(ref, 'Replied - booking link sent');
      ref.status = 'Replied - booking link sent';
      toCrm(ref.email, 'replied', 'Replied: interested · booking link sent automatically', text);
      notifyMe('🔥 ' + ref.first + ' wants to talk: booking link sent', ref.first + ' (' + ref.email + ') replied:\n\n' + text.slice(0, 800) +
        '\n\nYour booking link went out automatically. You\'ll get another alert when they pick a time.');
    } else {
      mark(ref, 'Replied - needs you');
      ref.status = 'Replied - needs you';
      toCrm(ref.email, 'replied', 'Replied: needs your answer', text);
      notifyMe('💬 ' + ref.first + ' replied: needs you', ref.first + ' (' + ref.email + ') replied:\n\n' + text.slice(0, 800) +
        '\n\nOpen fadybashir@clearpointglobal.org to answer. Their booking link: ' + BOOKING_URL);
    }
  }
}

// Finds calls booked on your calendar (from the booking page or any invite with an agent on it).
function checkBookings(idx, me) {
  const props = PropertiesService.getScriptProperties();
  const now = new Date(), until = new Date(now.getTime() + 45 * 864e5);
  const events = CalendarApp.getDefaultCalendar().getEvents(now, until);
  const first = !props.getProperty('evInit'); props.setProperty('evInit', '1');
  for (const ev of events) {
    const key = 'e:' + ev.getId() + ':' + ev.getStartTime().getTime();
    if (props.getProperty(key)) continue;
    const guests = ev.getGuestList(true).map(function (g) { return g.getEmail().toLowerCase(); }).filter(function (e) { return e && e !== me; });
    if (!guests.length) continue;
    props.setProperty(key, '1');
    const when = Utilities.formatDate(ev.getStartTime(), TZ, "EEE MMM d 'at' h:mm a");
    const day = Utilities.formatDate(ev.getStartTime(), TZ, 'yyyy-MM-dd');
    const agent = guests.map(function (g) { return idx.byEmail[g]; }).filter(Boolean)[0];
    if (agent) mark(agent, 'Call booked ' + day);
    toCrm(agent ? agent.email : guests[0], 'booked', 'Call booked: ' + when, ev.getTitle(), day);
    if (first) continue;   // first run: just learn what's already on the calendar
    notifyMe('📅 Call booked: ' + (agent ? agent.first : guests[0]) + ' · ' + when,
      (agent ? agent.first + ' (' + agent.email + ')' : guests.join(', ')) + ' booked "' + ev.getTitle() + '" for ' + when + ' (Eastern).\n\nIt\'s on your Google Calendar with the Meet link.');
  }
}

// Copies your upcoming calls (next 30 days) into the CRM's Today's Calls list.
function syncCalendar(me) {
  const from = new Date(Date.now() - 864e5), to = new Date(Date.now() + 30 * 864e5);
  const out = [];
  CalendarApp.getDefaultCalendar().getEvents(from, to).forEach(function (ev) {
    if (ev.isAllDayEvent()) return;
    const guests = ev.getGuestList(true).filter(function (g) { return g.getEmail() && g.getEmail().toLowerCase() !== me; });
    if (!guests.length) return;
    const desc = String(ev.getDescription() || '') + ' ' + String(ev.getLocation() || '');
    const meet = (desc.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i) || [''])[0];
    out.push({ id: ev.getId() + ':' + ev.getStartTime().getTime(), start: ev.getStartTime().toISOString(), end: ev.getEndTime().toISOString(),
      title: ev.getTitle(), meet: meet, guest: guests[0].getEmail(), guestName: guests[0].getName() || '' });
  });
  crm({ event: 'calendar', events: out, from: from.toISOString(), to: to.toISOString() });
}

// Campaign numbers for the CRM's Home screen.
function pushStats() {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const st = { sentToday: props.getProperty('day') === today ? +props.getProperty('sent') : 0, dailyLimit: dailyLimit(),
    queued: 0, inSequence: 0, finished: 0, replied: 0, booked: 0, optedOut: 0, bounced: 0, total: 0, warmupDay: 0 };
  const start = props.getProperty('start'); if (start) st.warmupDay = Math.floor((new Date() - new Date(start)) / 864e5) + 1;
  batchSheets().forEach(function (sh) {
    const d = sh.getDataRange().getValues(), iSt = d[0].indexOf('Status');
    for (let r = 1; r < d.length; r++) {
      const v = String(d[r][iSt]); st.total++;
      if (v === 'Queued') st.queued++; else if (v === 'In sequence') st.inSequence++; else if (v === 'Finished') st.finished++;
      else if (/^Replied/.test(v)) st.replied++; else if (/^Call booked/.test(v)) st.booked++; else if (v === 'Opted out') st.optedOut++; else if (v === 'Bounced') st.bounced++;
    }
  });
  crm({ event: 'stats', stats: st });
}

// Emails you write in the CRM ("Send now") go out from this business mailbox within 5 minutes.
function sendOutbox() {
  const res = crm({ event: 'outbox_pull', limit: Math.min(25, MailApp.getRemainingDailyQuota() - 5) });
  const items = (res && res.items) || [];
  if (!items.length) return;
  // never double-email someone the Sheet campaign already wrote to
  const inSheet = {};
  batchSheets().forEach(function (sh) {
    const d = sh.getDataRange().getValues(), H = d[0], iE = H.indexOf('Email'), iS = H.indexOf('Step'), iSt = H.indexOf('Status');
    for (let r = 1; r < d.length; r++) inSheet[String(d[r][iE]).trim().toLowerCase()] = { sh: sh, r: r + 1, col: iSt + 1, step: +d[r][iS] || 0, status: String(d[r][iSt]) };
  });
  const results = items.map(function (it) {
    const row = inSheet[String(it.to_email).trim().toLowerCase()];
    if (it.kind === 'batch' && row && row.step > 0) return { id: it.id, ok: false, error: 'Skipped: already emailed by the campaign' };
    try {
      const thread = sendTracked(it.to_email, it.subject || '(no subject)', it.body || '');
      if (row && row.step === 0 && row.status === 'Queued') row.sh.getRange(row.r, row.col).setValue('Skipped (emailed from CRM)');
      return { id: it.id, ok: true, thread: thread };
    } catch (e) { return { id: it.id, ok: false, error: String(e.message || e) }; }
  });
  crm({ event: 'outbox_done', results: results });
}

// Sends follow-ups for agents this mailbox started, and first emails one state batch at a time.
// Replies, bookings, calendar and stats are checked every hour, day or night.
function run() {
  const now = new Date();
  const me0 = Session.getActiveUser().getEmail().toLowerCase();
  try { const idx = rowIndex(); handleReplies(idx, me0); checkBookings(idx, me0); } catch (e) { console.log('replies: ' + e); }
  try { syncCalendar(me0); } catch (e) { console.log('calendar: ' + e); }
  try { pushStats(); } catch (e) { console.log('stats: ' + e); }
  const dow = +Utilities.formatDate(now, TZ, 'u'), hr = +Utilities.formatDate(now, TZ, 'H');
  if (dow > 5 || hr < 8 || hr >= 17) return;
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  let sent = props.getProperty('day') === today ? +props.getProperty('sent') : 0;
  let budget = Math.min(PER_RUN, dailyLimit() - sent, MailApp.getRemainingDailyQuota() - 1);
  if (budget <= 0) return;
  const me = Session.getActiveUser().getEmail().toLowerCase();
  const sheets = batchSheets();
  let newSendsDone = false;
  const contacted = {};
  sheets.forEach(function (s) { const d = s.getDataRange().getValues(), h = d[0], ie = h.indexOf('Email'), is = h.indexOf('Step');
    for (let r = 1; r < d.length; r++) if (+d[r][is] > 0) contacted[String(d[r][ie]).trim().toLowerCase()] = 1; });

  for (const pass of [1, 2]) {
    for (const sh of sheets) {
      if (budget <= 0) break;
      if (pass === 2 && newSendsDone) break;
      const data = sh.getDataRange().getValues();
      const H = data[0], c = function (n) { return H.indexOf(n); };
      const iF = c('First Name'), iE = c('Email'), iS = c('Step'), iL = c('Last Sent'), iSt = c('Status'), iT = c('Thread ID');
      const changed = [];
      let hasQueued = false;
      for (let r = 1; r < data.length && budget > 0; r++) {
        const row = data[r], status = row[iSt], step = +row[iS] || 0;
        const email = String(row[iE]).trim(), first = String(row[iF]).trim() || 'there';
        if (!email || (status !== 'Queued' && status !== 'In sequence')) continue;
        try {
          if (pass === 2 && step === 0) {
            hasQueued = true;
            if (contacted[email.toLowerCase()]) { row[iSt] = 'Skipped (already emailed)'; changed.push(r); continue; }
            contacted[email.toLowerCase()] = 1;
            row[iT] = TAG + sendTracked(email, fill(E1_SUBJ, first), fill(E1, first));
            row[iS] = 1; row[iSt] = 'In sequence';
          } else if (pass === 1 && step >= 1 && step < 3) {
            if (String(row[iT]).indexOf(TAG) !== 0) continue; // the old Gmail project finishes its own
            if ((now - new Date(row[iL])) / 864e5 < DAYS_BETWEEN) continue;
            const r2 = theyReplied(row[iT], me);
            if (r2) { if (r2 === 'Bounced') { row[iSt] = r2; changed.push(r); } else if (row[iSt] === 'In sequence') { row[iSt] = 'Replied - needs you'; changed.push(r); notifyMe('💬 ' + first + ' replied', first + ' (' + email + ') replied to your email. Open fadybashir@clearpointglobal.org to answer.'); } continue; }
            if (step === 1) {
              row[iT] += ',' + sendTracked(email, 'Re: ' + fill(E1_SUBJ, first), fill(E2, first));
              row[iS] = 2;
            } else {
              row[iT] += ',' + sendTracked(email, E3_SUBJ, fill(E3, first));
              row[iS] = 3; row[iSt] = 'Finished';
            }
          } else continue;
          row[iL] = now; budget--; sent++; changed.push(r);
        } catch (e) {
          row[iSt] = 'Error: ' + String(e.message).slice(0, 80); changed.push(r);
        }
      }
      changed.forEach(function (r) { sh.getRange(r + 1, 1, 1, H.length).setValues([data[r]]); });
      if (pass === 2 && hasQueued) newSendsDone = true;
    }
  }
  props.setProperties({ day: today, sent: String(sent) });
}
