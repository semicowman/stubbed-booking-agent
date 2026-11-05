// The clinic's online booking rules as pure functions: no I/O, no booking system, no model. Given what we know about the
// patient and what they asked for, this works out exactly what can be requested, what is still missing, and what has to be
// offered or refused. Everything here is unit-tested (test/rules/rules.test.js).
//
// Three things can be requested: a check-up (what that means depends on the patient), a massage, or a mobility class.
// Which clinics offer a service, and on which days, is data (config/service-availability.json, see availability.js).

import { addMonths } from './dates.js';

export const RULES = {
  minAge: 16, // online bookings are for patients this old or older; younger patients are helped by the front desk
  reassessAfterMonths: 24, // a returning patient last seen longer ago than this starts again with an Initial Assessment
  massageMaxMonths: 9, // a massage needs a visit within this many months
  massageWeeklyLimit: 2, // at most this many massages in any 7 days
  maxAdvanceMonths: 2, // requests can only be made this many months ahead
  minNoticeMinutes: 60, // ...and no sooner than this many minutes from now
  maxBookingsPerSession: 3, // requests one conversation can note (a review plus its stretch add-on counts as 2); more goes to staff
  insultStrikes: 2, // direct insults before the session ends (frustration never counts)
  stallMessages: 5, // patient messages in a row without any progress before the session ends
};

// The services that can be requested online. `practitioner`: the patient may name a practitioner.
export const SERVICES = {
  assessment: { label: 'Initial Assessment', duration: 45, practitioner: true },
  review: { label: 'Review Appointment', duration: 20, practitioner: true },
  massage: { label: 'Therapeutic Massage', duration: 60, practitioner: true },
  stretch: { label: 'Stretch Session', duration: 15 },
  class: { label: 'Mobility Class', duration: 50 },
};

// What a patient can ask for. 'checkup' becomes an assessment or a review, depending on the patient.
export const REQUESTS = ['checkup', 'massage', 'class'];

// Months between a visit date (YYYY-MM or YYYY-MM-DD) and today (YYYY-MM-DD).
export function monthsSince(visit, today) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(visit ?? ''));
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today ?? ''));
  if (!m || !t) return null;
  const [vy, vm, vd] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 1)];
  const [ty, tm, td] = [Number(t[1]), Number(t[2]), Number(t[3])];
  let months = (ty - vy) * 12 + (tm - vm);
  if (td < vd) months -= 1;
  return months;
}

// The core rule check.
//
// patient: {
//   type: 'new' | 'returning',
//   lastVisitMonthsAgo?: number,        returning only
//   massagesThisWeek?: number,          massages the patient already has in the same 7 days (their answer)
//   massagesThisSession?: number,       massages already noted in this chat
// }
// draft: {
//   request?: 'checkup' | 'massage' | 'class',
//   addOn?: 'stretch' | 'none',         answer to the stretch offer made after a review
//   clinic?: string, date?: 'YYYY-MM-DD', time?: 'HH:MM' | 'any', practitioner?: string
// }
//
// Returns {
//   parts: [{ service, role: 'primary' | 'add_on' }],   what would be requested
//   missing: [field],      facts to ask for, in the order to ask them
//   offer: code | null,    a yes/no question to put to the patient first
//   blocked: { code, suggest? } | null,   the request can't be made as asked
//   ready: boolean,        true when nothing more is needed
// }
export function evaluate(patient, draft) {
  const out = { parts: [], missing: [], offer: null, blocked: null, ready: false };
  const need = (field) => out.missing.push(field);
  const months = patient.lastVisitMonthsAgo;
  const request = patient.type === 'new' ? draft.request ?? 'checkup' : draft.request;

  if (!REQUESTS.includes(request)) {
    if (patient.type !== 'new') need('service');
    else out.parts.push({ service: 'assessment', role: 'primary' });
  } else if (request === 'class') {
    out.parts.push({ service: 'class', role: 'primary' });
  } else if (patient.type === 'new') {
    // A new patient always starts with an assessment; a massage has to wait for it.
    if (request === 'massage') out.blocked = { code: 'new_patient_checkup_first', suggest: 'checkup' };
    else out.parts.push({ service: 'assessment', role: 'primary' });
  } else if (months == null) {
    need('last_visit');
  } else if (request === 'checkup') {
    if (months > RULES.reassessAfterMonths) {
      out.parts.push({ service: 'assessment', role: 'primary' });
    } else {
      out.parts.push({ service: 'review', role: 'primary' });
      if (draft.addOn == null) out.offer = 'add_stretch';
      else if (draft.addOn === 'stretch') out.parts.push({ service: 'stretch', role: 'add_on' });
    }
  } else if (months > RULES.massageMaxMonths) {
    out.blocked = { code: 'massage_needs_checkup', suggest: 'checkup' };
  } else {
    out.parts.push({ service: 'massage', role: 'primary' });
  }

  // Where and when come as soon as the service is settled, ahead of the weekly massage count.
  if (!draft.clinic) need('clinic');
  if (!draft.date) need('date');

  // The weekly massage limit, whichever way the massage got into the request.
  if (out.parts.some((p) => p.service === 'massage')) {
    if (patient.massagesThisWeek == null) need('massages_this_week');
    else if (patient.massagesThisWeek + (patient.massagesThisSession ?? 0) + 1 > RULES.massageWeeklyLimit) {
      out.blocked = { code: 'massage_limit' };
    }
  }

  out.ready = !out.blocked && !out.offer && out.missing.length === 0 && out.parts.length > 0;
  return out;
}

// Latest date a request can be made for, as YYYY-MM-DD.
export function latestBookingDate(today) {
  return addMonths(today, RULES.maxAdvanceMonths);
}
