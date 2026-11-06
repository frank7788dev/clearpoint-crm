// TASK: the Run button runs this
function task() { setup(); }
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
  "Call or text me at (248) 805-2855, or reply with a good time and I'll send a Zoom link.\n\n" +
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

// Sends follow-ups for agents this mailbox started, and first emails one state batch at a time.
function run() {
  const now = new Date();
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
            if (r2) { row[iSt] = r2; changed.push(r); continue; }
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
