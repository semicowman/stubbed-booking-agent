// The booking rules applied to the agent's action notes. This is the only "logic" behind the agent, and it is pure: it reads what the
// agent wrote down, keeps a small in-memory record of what the patient has said, and reports what breaks a rule, what is still needed and
// what the patient must be told. It never contacts anything and never stores a name, email or mobile number (only that one was given).
//
// A finding is { level: 'error' | 'info', code, text, say? }.
//   error  the note or the reply breaks a rule; the agent is asked to rewrite its reply (agent.js).
//   info   guidance carried into the agent's next turn (what is still needed, an offer to make).
//   say    wording the patient must be sent exactly as written (templates.js).

import { evaluate, monthsSince, latestBookingDate, RULES, SERVICES } from '../rules/rules.js';
import { resolveDate, splitTime, weekdayName } from '../rules/dates.js';
import { resolveClinic, CLINICS } from '../rules/clinics.js';
import { normalizePhone } from '../rules/phone.js';
import { availabilityProblem, defaultAvailability } from '../rules/availability.js';
import * as T from '../rules/templates.js';

// Singapore date and time from a clock reading (ms since epoch).
export function sgtNow(ms = Date.now()) {
  const d = new Date(ms + 8 * 3600_000);
  const iso = d.toISOString();
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return { today: iso.slice(0, 10), time: iso.slice(11, 16), minutes };
}

export function newSession() {
  return {
    facts: { patientType: null, ageOk: false, onBehalf: false, lastVisit: undefined, massagesThisWeek: undefined },
    draft: { request: undefined, addOn: undefined, clinic: undefined, date: undefined, time: undefined, practitioner: undefined },
    flags: { contact: false },
    requested: [], // appointment requests noted: [{ service, clinic, date, time, practitioner }]
    notBooked: [], // [{ service, reason }]
    followups: [],
    insults: 0,
    ended: null, // { reason, summary }
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const finding = (level, code, text, say) => ({ level, code, text, ...(say ? { say } : {}) });

// Plain reasons for the closing message and the staff note.
const STOPPING_KINDS = new Set(['booking_completed', 'patient_declined', 'handoff_to_staff', 'outside_booking', 'emergency', 'out_of_scope', 'uncooperative', 'spam', 'scam', 'hacker', 'abuse', 'minor', 'rude']);

function finish(session, kind, summary = '') {
  if (!STOPPING_KINDS.has(kind)) kind = 'out_of_scope';
  const closingKind = kind === 'rude' ? 'ended' : kind;
  const text = T.closing(closingKind, { booked: session.requested, notBooked: session.notBooked, followups: session.followups });
  const why = kind === 'handoff_to_staff' ? 'handoff' : kind;
  const note = T.handoverNote({
    why,
    contact: session.flags.contact,
    booked: session.requested,
    notBooked: session.notBooked,
    followups: session.followups,
    onBehalf: session.facts.onBehalf,
    actions: [
      ...(session.requested.length ? ['Confirm the requested appointment time(s) with the patient: nothing has been booked.'] : []),
      ...session.followups.map((f) => `Follow up: ${f}`),
    ],
    summary: T.cleanSummary(summary),
  });
  session.ended = { reason: kind, summary: T.cleanSummary(summary) };
  session.handover = note;
  return text;
}

// "2026-11" or "2026-11-03"; anything else is null.
const visitOf = (text) => (/^\d{4}-\d{2}(-\d{2})?$/.test(String(text ?? '').trim()) ? String(text).trim() : null);

function readTime(raw) {
  const t = String(raw ?? '').trim().toLowerCase();
  if (!t) return { time: undefined };
  if (t === 'any' || t === 'anytime' || t === 'any time') return { time: 'any' };
  const hhmm = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t);
  if (hhmm) return { time: `${hhmm[1].padStart(2, '0')}:${hhmm[2]}` };
  const split = splitTime(t);
  return split.time ? { time: split.time } : { time: undefined, unclear: true };
}

// Reads the booking details of an update_request or submit_request note into the draft, with the checks that need no rules engine.
function recordDetails(session, args, ctx, out) {
  const { facts, draft } = session;
  const { today, minutes } = ctx.clock;
  if (args.service) draft.request = args.service;
  if ('add_on' in args) draft.addOn = args.add_on;
  if (args.practitioner) draft.practitioner = args.practitioner;
  if (args.clinic) {
    const clinic = resolveClinic(args.clinic);
    if (clinic) draft.clinic = clinic.name;
    else out.push(finding('error', 'clinic_unknown', `"${args.clinic}" is not one of our clinics. The clinics are ${CLINICS.map((c) => c.name).join(', ')}. Ask which one the patient means.`));
  }
  if (args.date_text) {
    let text = args.date_text;
    let date = resolveDate(text, today);
    if (!date) {
      const split = splitTime(text);
      if (split.time && !args.time) args = { ...args, time: split.time };
      if (split.time) date = resolveDate(split.dateText, today);
    }
    if (!date) out.push(finding('info', 'date_unclear', `"${args.date_text}" is not a specific date. Ask the patient for a day (for example "next Tuesday" or "15 Oct").`));
    else {
      const latest = latestBookingDate(today);
      if (date < today) out.push(finding('error', 'date_past', `${date} is in the past (today is ${today}). Ask for a date from today on.`));
      else if (date > latest) out.push(finding('error', 'too_far', `${date} is more than ${RULES.maxAdvanceMonths} months ahead (the latest date is ${latest}).`, T.TOO_FAR(latest)));
      else { draft.date = date; }
      if (date < today || date > latest) draft.date = undefined;
    }
  }
  if (args.time) {
    const t = readTime(args.time);
    if (t.unclear) out.push(finding('info', 'time_unclear', `"${args.time}" is not a time of day. Ask for a time (for example 3pm).`));
    else draft.time = t.time;
  }
  if (draft.date === today && draft.time && draft.time !== 'any') {
    const [h, m] = draft.time.split(':').map(Number);
    if (h * 60 + m < minutes + RULES.minNoticeMinutes) {
      out.push(finding('error', 'too_soon', `${draft.time} today is less than ${RULES.minNoticeMinutes} minutes from now (it is ${ctx.clock.time}).`, `That time is too soon: we need at least ${RULES.minNoticeMinutes} minutes' notice. Which later time works for you?`));
      draft.time = undefined;
    }
  }
  // Facts about the patient.
  if (args.patient_type) facts.patientType = args.patient_type;
  if ('on_behalf' in args) facts.onBehalf = args.on_behalf;
  if ('massages_this_week' in args) facts.massagesThisWeek = Math.max(0, Math.floor(args.massages_this_week));
  if (args.last_visit !== undefined) {
    const v = visitOf(args.last_visit);
    if (v) facts.lastVisit = v;
    else out.push(finding('info', 'last_visit_unclear', 'Write last_visit as YYYY-MM (for example 2026-03). If the patient only said something vague such as "last year", ask for the month.'));
  }
  if (args.gender_preference) {
    const line = 'Patient asked for a practitioner gender (details in the chat).';
    if (!session.followups.includes(line)) session.followups.push(line);
  }
}

// The rules on what the details so far allow. Returns the evaluation (or null when the patient type is not known yet).
function runRules(session, ctx, out) {
  const { facts, draft } = session;
  if (!facts.patientType) { out.push(finding('info', 'patient_type_missing', 'Record patient_type (new or returning) as soon as you know it.')); return null; }
  const { today } = ctx.clock;
  const patient = {
    type: facts.patientType,
    lastVisitMonthsAgo: facts.lastVisit ? monthsSince(facts.lastVisit, today) ?? undefined : undefined,
    massagesThisWeek: facts.massagesThisWeek,
    massagesThisSession: session.requested.filter((r) => r.isMassage).length,
  };
  const result = evaluate(patient, draft);

  // Some services are only offered at certain clinics, or on certain days (config/service-availability.json).
  const clinicCode = draft.clinic ? resolveClinic(draft.clinic)?.code : undefined;
  const weekday = draft.date ? weekdayName(draft.date).replace(/^./, (c) => c.toUpperCase()) : undefined;
  for (const part of result.parts) {
    const problem = availabilityProblem(ctx.availability, part.service, clinicCode, weekday);
    if (!problem) continue;
    const label = SERVICES[part.service].label;
    if (problem.code === 'not_at_clinic') {
      const names = CLINICS.filter((c) => problem.clinics.includes(c.code)).map((c) => c.name);
      out.push(finding('error', 'not_at_clinic', `${label} is not offered at ${draft.clinic}. It is offered at ${names.join(', ')}.`, T.NOT_AT_CLINIC(label, draft.clinic, names)));
      draft.clinic = undefined;
    } else {
      out.push(finding('error', 'wrong_day', `${label} does not run on ${weekday}. It runs on ${problem.days.join(' and ')}.`, T.WRONG_DAY(label, problem.days)));
      draft.date = undefined;
    }
    result.ready = false;
    break;
  }

  if (result.blocked) {
    const { code } = result.blocked;
    const label = SERVICES[result.parts[0]?.service]?.label ?? draft.request ?? 'appointment';
    if (!session.notBooked.some((n) => n.reason === (T.NOT_BOOKED_REASONS[code] ?? code))) session.notBooked.push({ service: label, reason: T.NOT_BOOKED_REASONS[code] ?? code });
    out.push(finding('error', `blocked_${code}`, `The booking rules do not allow this request (${code}).`, T.BLOCKS[code]));
  } else if (result.offer) {
    out.push(finding('info', 'offer', 'Make this offer before going on, and record the answer as add_on (stretch or none).', T.OFFERS[result.offer]));
  }
  if (result.missing.length) out.push(finding('info', 'missing', `Still needed, in this order: ${result.missing.join(', ')}.`));
  return result;
}

// actions: the notes extracted from one reply. Mutates `session` (callers pass a copy and keep it only when the reply is accepted).
// Returns { findings, appendix: [text added to the patient's reply], suppressReply }.
export function applyActions(session, actions, { now = Date.now(), availability = defaultAvailability() } = {}) {
  const ctx = { clock: sgtNow(now), availability };
  const out = [];
  const appendix = [];
  let suppressReply = false;

  for (const action of actions) {
    if (session.ended) break;
    for (const problem of action.problems) out.push(finding(action.invalid ? 'error' : 'info', 'note_format', problem));
    if (action.invalid) continue;
    const { name, args } = action;

    switch (name) {
      case 'confirm_age': {
        if (args.age_ok) { session.facts.ageOk = true; break; }
        appendix.push(finish(session, 'minor', ''));
        suppressReply = true;
        break;
      }
      case 'save_contact': {
        if (!session.facts.ageOk) { out.push(finding('error', 'age_first', `The patient must first be asked whether they are ${RULES.minAge} or over (confirm_age) before any details are taken.`)); break; }
        if (args.email && !EMAIL.test(args.email)) { out.push(finding('error', 'email_invalid', 'That email address does not look valid. Ask the patient to check it, or leave it out.')); break; }
        if (!normalizePhone(args.mobile).ok) { out.push(finding('error', 'phone_invalid', 'The mobile number is not valid.', "That mobile number doesn't look right. Could you check it and send it again?")); break; }
        session.flags.contact = true;
        break;
      }
      case 'update_request':
      case 'submit_request': {
        const detailFields = Object.keys(args).filter((k) => !['patient_type', 'on_behalf', 'patient_confirmed'].includes(k));
        if (detailFields.length && !session.flags.contact) {
          out.push(finding('error', 'contact_first', 'The patient must first be asked their age (confirm_age) and give their name and mobile number (save_contact) before request details are taken.'));
          break;
        }
        const before = out.length;
        recordDetails(session, args, ctx, out);
        const recorded = out.length === before || out.slice(before).every((f) => f.level === 'info');
        const result = runRules(session, ctx, out);
        if (name === 'update_request') break;

        // submit_request: the patient's yes and a complete, allowed request.
        const problems = [];
        if (!args.patient_confirmed) problems.push("submit_request needs the patient's clear yes to the full details (service, clinic, date, time, practitioner if any). Ask for it, then note submit_request with patient_confirmed true.");
        if (!result) problems.push('the patient type is not recorded yet');
        else {
          if (result.blocked) problems.push(`the rules block this request (${result.blocked.code})`);
          if (result.offer) problems.push('the stretch offer has not been answered');
          if (result.missing.length) problems.push(`still missing: ${result.missing.join(', ')}`);
          if (!result.parts.length) problems.push('no service is settled');
        }
        if (!session.draft.date) problems.push('there is no valid date');
        if (!session.draft.time) problems.push('there is no time (any time is fine only if the patient said so: time "any")');
        if (!recorded) problems.push('a detail in this note was refused');
        if (session.requested.length >= RULES.maxBookingsPerSession) problems.push(`one chat can note at most ${RULES.maxBookingsPerSession} appointments: hand over to a team member for more`);
        if (problems.length || out.some((f) => f.level === 'error' && f.code !== 'note_format')) {
          out.push(finding('error', 'book_not_ready', `Cannot note this booking yet: ${problems.length ? problems.join('; ') : 'see the other findings'}. Do not tell the patient it is noted until it is.`));
          break;
        }
        for (const part of result.parts) {
          session.requested.push({
            service: SERVICES[part.service].label,
            clinic: session.draft.clinic,
            date: session.draft.date,
            time: part.role === 'primary' ? session.draft.time : null,
            practitioner: SERVICES[part.service].practitioner ? session.draft.practitioner : undefined,
            isMassage: part.service === 'massage',
          });
        }
        session.afterBooking = true;
        session.draft = { request: undefined, addOn: undefined, clinic: session.draft.clinic, date: undefined, time: undefined, practitioner: undefined };
        break;
      }
      case 'staff_note': {
        const text = T.cleanSummary(args.text, 160);
        if (text) session.followups.push(text);
        break;
      }
      case 'flag_behavior': {
        session.insults += 1;
        if (session.insults >= RULES.insultStrikes) appendix.push(finish(session, 'rude', ''));
        else appendix.push(T.WARNING);
        break;
      }
      case 'end_session': {
        appendix.push(finish(session, args.reason, args.summary));
        break;
      }
      default:
        break;
    }
  }
  return { findings: out, appendix, suppressReply };
}

// The findings as text for the agent: errors (to correct) or hints (carried into the next turn).
export function describe(findings) {
  return findings
    .map((f) => `- ${f.text}${f.say ? ` Send the patient exactly: "${f.say}"` : ''}`)
    .join('\n');
}

export { weekdayName };
