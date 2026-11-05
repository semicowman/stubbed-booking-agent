import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSession, applyActions, sgtNow, describe } from '../../src/agent/checks.js';
import { extractActions } from '../../src/agent/actions.js';

const NOW = Date.parse('2026-10-28T02:00:00Z'); // Wednesday 28 Oct 2026, 10:00 Singapore time
const note = (name, args = {}) => ({ name, args, problems: [], invalid: false });
const run = (session, ...actions) => applyActions(session, actions, { now: NOW });
const codes = (r, level) => r.findings.filter((f) => !level || f.level === level).map((f) => f.code);

// A patient who has passed the age question and given contact details.
function withContact() {
  const s = newSession();
  run(s, note('confirm_age', { age_ok: true }), note('save_contact', { name: 'A B', mobile: '91234567' }));
  return s;
}

test('Singapore time', () => {
  assert.deepEqual(sgtNow(NOW), { today: '2026-10-28', time: '10:00', minutes: 600 });
  assert.equal(sgtNow(Date.parse('2026-10-28T17:00:00Z')).today, '2026-10-29');
});

test('age first, then valid contact details, then request details', () => {
  const s = newSession();
  assert.deepEqual(codes(run(s, note('save_contact', { name: 'A B', mobile: '91234567' })), 'error'), ['age_first']);
  assert.deepEqual(codes(run(s, note('update_request', { clinic: 'Northpoint' })), 'error'), ['contact_first']);
  run(s, note('confirm_age', { age_ok: true }));
  assert.deepEqual(codes(run(s, note('save_contact', { name: 'A B', mobile: '12345' })), 'error'), ['phone_invalid']);
  assert.deepEqual(codes(run(s, note('save_contact', { name: 'A B', mobile: '91234567', email: 'nope' })), 'error'), ['email_invalid']);
  assert.deepEqual(codes(run(s, note('save_contact', { name: 'A B', mobile: '9123 4567' })), 'error'), []);
  assert.equal(s.flags.contact, true);
  assert.ok(!JSON.stringify(s).includes('91234567') && !JSON.stringify(s).includes('9123 4567'), 'no personal details are kept');
});

test('under 16 ends the session with the fixed message and nothing else', () => {
  const s = newSession();
  const r = run(s, note('confirm_age', { age_ok: false }));
  assert.equal(r.suppressReply, true);
  assert.equal(s.ended.reason, 'minor');
  assert.match(r.appendix.join(), /patients aged 16 and over/);
  assert.match(s.handover, /under the minimum age/);
});

test('dates: resolved from the patient\'s words, past and too-far dates are refused', () => {
  const s = withContact();
  let r = run(s, note('update_request', { patient_type: 'returning', service: 'checkup', last_visit: '2026-06', clinic: 'Northpoint', date_text: 'next Tuesday' }));
  assert.equal(s.draft.date, '2026-11-03');
  assert.equal(s.draft.clinic, 'Northpoint');
  assert.deepEqual(codes(r, 'error'), []);
  r = run(s, note('update_request', { date_text: '1 Mar' }));
  assert.deepEqual(codes(r, 'error'), ['too_far']);
  assert.match(r.findings[0].say, /latest date I can offer is Monday, 28 December/);
  assert.equal(s.draft.date, undefined);
  r = run(s, note('update_request', { date_text: '2026-10-01' }));
  assert.deepEqual(codes(r, 'error'), ['date_past']);
  r = run(s, note('update_request', { date_text: 'sometime soon' }));
  assert.deepEqual(codes(r, 'info').includes('date_unclear'), true);
});

test('a time under 60 minutes away today is refused; a time given inside the date text is read', () => {
  const s = withContact();
  const r = run(s, note('update_request', { patient_type: 'returning', date_text: 'today', time: '10:50' }));
  assert.deepEqual(codes(r, 'error'), ['too_soon']);
  assert.equal(s.draft.time, undefined);
  assert.deepEqual(codes(run(s, note('update_request', { date_text: 'today', time: '11:00' })), 'error'), []);
  run(s, note('update_request', { date_text: 'tomorrow at 4pm' }));
  assert.equal(s.draft.date, '2026-10-29');
  assert.equal(s.draft.time, '16:00');
});

test('an unknown clinic is refused', () => {
  assert.deepEqual(codes(run(withContact(), note('update_request', { clinic: 'Tampines' })), 'error'), ['clinic_unknown']);
});

test('the rules say what is still needed and what to offer', () => {
  const s = withContact();
  let r = run(s, note('update_request', { patient_type: 'returning', service: 'checkup', last_visit: '2026-08' }));
  assert.ok(codes(r, 'info').includes('offer'));
  assert.match(r.findings.find((f) => f.code === 'offer').say, /Stretch Session/);
  r = run(s, note('update_request', { add_on: 'none' }));
  assert.match(r.findings.find((f) => f.code === 'missing').text, /clinic, date/);
});

test('rules blocks come with their exact wording', () => {
  const s = withContact();
  const r = run(s, note('update_request', { patient_type: 'returning', service: 'massage', last_visit: '2025-01' }));
  assert.deepEqual(codes(r, 'error'), ['blocked_massage_needs_checkup']);
  assert.match(describe(r.findings.filter((f) => f.level === 'error')), /Send the patient exactly: "A massage needs a visit with us in the last 9 months/);
  assert.equal(s.notBooked.length, 1);

  const n = withContact();
  assert.deepEqual(codes(run(n, note('update_request', { patient_type: 'new', service: 'massage' })), 'error'), ['blocked_new_patient_checkup_first']);
});

test('classes and massages are only offered at some clinics, and classes only on some days', () => {
  const s = withContact();
  let r = run(s, note('update_request', { patient_type: 'new', service: 'class', clinic: 'Southshore' }));
  assert.deepEqual(codes(r, 'error'), ['not_at_clinic']);
  assert.match(r.findings[0].say, /Mobility Class isn't offered at Southshore\. It is available at Central, Westgate/);
  assert.equal(s.draft.clinic, undefined, 'the clinic is not kept');

  r = run(s, note('update_request', { clinic: 'Central', date_text: 'next Monday' }));
  assert.deepEqual(codes(r, 'error'), ['wrong_day']);
  assert.match(r.findings[0].say, /only on Tuesday and Thursday/);
  assert.equal(s.draft.date, undefined);

  r = run(s, note('update_request', { date_text: 'next Tuesday' }));
  assert.deepEqual(codes(r, 'error'), []);
  assert.equal(s.draft.date, '2026-11-03');

  const m = withContact();
  r = run(m, note('update_request', { patient_type: 'returning', service: 'massage', last_visit: '2026-08', clinic: 'Westgate' }));
  assert.deepEqual(codes(r, 'error'), ['not_at_clinic']);
});

test('submit_request needs the patient\'s yes and a complete allowed request', () => {
  const s = withContact();
  const details = { patient_type: 'returning', service: 'checkup', last_visit: '2026-08', add_on: 'none', clinic: 'Northpoint', date_text: 'next Tuesday', time: '15:00', practitioner: 'Alice' };
  let r = run(s, note('submit_request', { ...details, patient_confirmed: false }));
  assert.ok(codes(r, 'error').includes('book_not_ready'));
  assert.equal(s.requested.length, 0);
  r = run(s, note('submit_request', { ...details, patient_confirmed: true }));
  assert.deepEqual(codes(r, 'error'), []);
  assert.deepEqual(s.requested.map((x) => [x.service, x.clinic, x.date, x.time, x.practitioner]), [['Review Appointment', 'Northpoint', '2026-11-03', '15:00', 'Alice']]);
  assert.equal(s.draft.clinic, 'Northpoint', 'the clinic is carried over, the rest is cleared');
  assert.equal(s.draft.date, undefined);
});

test('a review with a stretch add-on is noted as two requests, the second with its time left to staff', () => {
  const s = withContact();
  run(s, note('submit_request', { patient_type: 'returning', service: 'checkup', last_visit: '2026-08', add_on: 'stretch', clinic: 'Central', date_text: 'next Tuesday', time: '11:00', patient_confirmed: true }));
  assert.deepEqual(s.requested.map((x) => [x.service, x.time]), [['Review Appointment', '11:00'], ['Stretch Session', null]]);
  const end = run(s, note('end_session', { reason: 'booking_completed', summary: 'Wanted a review and a stretch.' }));
  assert.match(end.appendix[0], /Your request has been noted/);
  assert.match(s.handover, /Confirm the requested appointment time/);
  assert.match(s.handover, /nothing was actually booked/);
});

test('the weekly massage limit counts what was already noted in this chat', () => {
  const s = withContact();
  const r = run(s, note('update_request', { patient_type: 'returning', service: 'massage', last_visit: '2026-08', massages_this_week: 2 }));
  assert.deepEqual(codes(r, 'error'), ['blocked_massage_limit']);

  const t = withContact();
  const details = { patient_type: 'returning', service: 'massage', last_visit: '2026-08', massages_this_week: 1, clinic: 'Central', date_text: 'next Tuesday', time: '11:00', patient_confirmed: true };
  run(t, note('submit_request', details));
  assert.equal(t.requested.length, 1);
  const again = run(t, note('update_request', { service: 'massage', date_text: 'next Wednesday' }));
  assert.deepEqual(codes(again, 'error'), ['blocked_massage_limit']);
});

test('end_session builds the closing message and the hand-over note; the chat is over after it', () => {
  const s = withContact();
  const r = run(s, note('staff_note', { text: 'wants to cancel tomorrow\'s appointment' }), note('end_session', { reason: 'outside_booking', summary: 'Asked to cancel. Reach them on 91234567 or a@test.local.' }));
  assert.match(r.appendix[0], /A team member will follow up on: wants to cancel/);
  assert.ok(!s.handover.includes('91234567') && !s.handover.includes('a@test.local'), 'identifiers are cut from the summary');
  assert.equal(s.ended.reason, 'outside_booking');
  assert.deepEqual(codes(run(s, note('update_request', { clinic: 'Central' }))), [], 'nothing is processed after the end');
});

test('repeated insults end the session; the first one gets the warning', () => {
  const s = newSession();
  assert.match(run(s, note('flag_behavior')).appendix[0], /keep our conversation respectful/);
  run(s, note('flag_behavior'));
  assert.equal(s.ended.reason, 'rude');
});

test('invalid notes are errors and change nothing', () => {
  const s = withContact();
  const { actions } = extractActions('[[ACTION update_request {broken}]]');
  const r = applyActions(s, actions, { now: NOW });
  assert.deepEqual(codes(r, 'error'), ['note_format']);
});

test('a gender preference goes to staff as a note without the details', () => {
  const s = withContact();
  run(s, note('update_request', { gender_preference: 'female' }));
  assert.match(s.followups[0], /practitioner gender/);
  assert.ok(!JSON.stringify(s).includes('female'));
});

test('a new patient can be noted for an Initial Assessment, and a class needs no visit history', () => {
  const s = withContact();
  const r = run(s, note('submit_request', { patient_type: 'new', service: 'checkup', clinic: 'Southshore', date_text: 'next Wednesday', time: '11:00', patient_confirmed: true }));
  assert.deepEqual(codes(r, 'error'), []);
  assert.deepEqual(s.requested.map((x) => [x.service, x.clinic, x.date, x.time]), [['Initial Assessment', 'Southshore', '2026-11-04', '11:00']]);

  const c = withContact();
  run(c, note('submit_request', { patient_type: 'returning', service: 'class', clinic: 'Westgate', date_text: 'next Thursday', time: '18:00', patient_confirmed: true }));
  assert.deepEqual(c.requested.map((x) => [x.service, x.clinic, x.date, x.practitioner]), [['Mobility Class', 'Westgate', '2026-11-05', undefined]]);
});

test('one chat can note at most 3 requests', () => {
  const s = withContact();
  const one = (day) => note('submit_request', { patient_type: 'new', service: 'checkup', clinic: 'Central', date_text: day, time: '11:00', patient_confirmed: true });
  run(s, one('next Monday'), one('next Tuesday'), one('next Wednesday'));
  assert.equal(s.requested.length, 3);
  assert.ok(codes(run(s, one('next Thursday')), 'error').includes('book_not_ready'));
  assert.equal(s.requested.length, 3);
});
