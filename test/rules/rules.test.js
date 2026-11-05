// Unit tests for the booking rules (src/rules/rules.js). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, SERVICES, evaluate, monthsSince, latestBookingDate } from '../../src/rules/rules.js';

const where = { clinic: 'CEN', date: '2026-10-20' };
const services = (ev) => ev.parts.map((p) => p.service);

test('new patient: clinic and date are needed; requests an Initial Assessment', () => {
  const ev = evaluate({ type: 'new' }, {});
  assert.deepEqual(ev.missing, ['clinic', 'date']);
  assert.deepEqual(services(ev), ['assessment']);
  assert.equal(ev.ready, false);
  assert.equal(evaluate({ type: 'new' }, where).ready, true);
});

test('a new patient cannot start with a massage, but can take a class', () => {
  const massage = evaluate({ type: 'new' }, { ...where, request: 'massage' });
  assert.equal(massage.blocked?.code, 'new_patient_checkup_first');
  assert.equal(massage.blocked?.suggest, 'checkup');
  assert.equal(massage.ready, false);
  assert.deepEqual(services(evaluate({ type: 'new' }, { ...where, request: 'class' })), ['class']);
});

test('returning check-up: a review within 24 months, an assessment after that', () => {
  const at = (months) => services(evaluate({ type: 'returning', lastVisitMonthsAgo: months }, { ...where, request: 'checkup', addOn: 'none' }));
  assert.deepEqual(at(0), ['review']);
  assert.deepEqual(at(24), ['review']);
  assert.deepEqual(at(25), ['assessment']);
  // The minutes are part of what the service is identified by.
  assert.equal(SERVICES.assessment.duration, 45);
  assert.equal(SERVICES.review.duration, 20);
});

test('a review offers a stretch session, and the add-on is requested when accepted', () => {
  const asked = evaluate({ type: 'returning', lastVisitMonthsAgo: 2 }, { ...where, request: 'checkup' });
  assert.equal(asked.offer, 'add_stretch');
  assert.equal(asked.ready, false);
  const yes = evaluate({ type: 'returning', lastVisitMonthsAgo: 2 }, { ...where, request: 'checkup', addOn: 'stretch' });
  assert.deepEqual(services(yes), ['review', 'stretch']);
  assert.equal(yes.ready, true);
  const no = evaluate({ type: 'returning', lastVisitMonthsAgo: 2 }, { ...where, request: 'checkup', addOn: 'none' });
  assert.deepEqual(services(no), ['review']);
  // an assessment never offers the add-on
  assert.equal(evaluate({ type: 'returning', lastVisitMonthsAgo: 30 }, { ...where, request: 'checkup' }).offer, null);
});

test('returning: the last visit is asked for before a check-up or a massage, not before a class', () => {
  assert.deepEqual(evaluate({ type: 'returning' }, { ...where, request: 'checkup' }).missing, ['last_visit']);
  assert.deepEqual(evaluate({ type: 'returning' }, { ...where, request: 'massage' }).missing, ['last_visit']);
  assert.deepEqual(evaluate({ type: 'returning' }, { ...where, request: 'class' }).missing, []);
  assert.deepEqual(evaluate({ type: 'returning' }, {}).missing, ['service', 'clinic', 'date']);
});

test('massage: a visit within 9 months, the weekly count asked for, and at most 2 a week', () => {
  const base = { type: 'returning', lastVisitMonthsAgo: 9 };
  const draft = { ...where, request: 'massage' };
  assert.deepEqual(evaluate(base, draft).missing, ['massages_this_week']);
  assert.deepEqual(services(evaluate({ ...base, massagesThisWeek: 0 }, draft)), ['massage']);
  assert.equal(evaluate({ ...base, massagesThisWeek: 0 }, draft).ready, true);
  assert.equal(evaluate({ ...base, massagesThisWeek: 1 }, draft).ready, true);
  assert.equal(evaluate({ ...base, massagesThisWeek: 2 }, draft).blocked?.code, 'massage_limit');
  assert.equal(evaluate({ ...base, massagesThisWeek: 1, massagesThisSession: 1 }, draft).blocked?.code, 'massage_limit');
  const lapsed = evaluate({ type: 'returning', lastVisitMonthsAgo: 10, massagesThisWeek: 0 }, draft);
  assert.equal(lapsed.blocked?.code, 'massage_needs_checkup');
  assert.equal(lapsed.blocked?.suggest, 'checkup');
});

test('the numbers in the rules are the ones the clinic configured', () => {
  assert.deepEqual(RULES, {
    minAge: 16, // online requests are for patients 16 or over
    reassessAfterMonths: 24, // a returning patient last seen longer ago starts again with an assessment
    massageMaxMonths: 9, // a massage needs a visit in the last 9 months
    massageWeeklyLimit: 2, // at most 2 massages in any 7 days
    maxAdvanceMonths: 2, // up to two months ahead
    minNoticeMinutes: 60, // nothing today that starts less than an hour from now
    maxBookingsPerSession: 3, // at most 3 requests in one chat
    insultStrikes: 2, // the second direct insult ends the chat
    stallMessages: 5, // five patient messages in a row without progress end the chat
  }, 'a rule number changed: update this test together with the documents that quote the number');
});

test('monthsSince counts whole months', () => {
  assert.equal(monthsSince('2025-10', '2026-10-06'), 12);
  assert.equal(monthsSince('2025-09-07', '2026-10-06'), 12);
  assert.equal(monthsSince('2025-09-06', '2026-10-06'), 13);
  assert.equal(monthsSince('garbage', '2026-10-06'), null);
});

test('monthsSince returns null for anything that is not a date', () => {
  for (const bad of ['last year', '', null, undefined, '2026/10', '10-2026', 5]) assert.equal(monthsSince(bad, '2026-10-06'), null, String(bad));
  assert.equal(monthsSince('2026-01', 'today'), null);
  assert.equal(monthsSince('2026-01', null), null);
});

test('the latest date a request can be made for is two months ahead', () => {
  assert.equal(latestBookingDate('2026-10-06'), '2026-12-06');
  assert.equal(latestBookingDate('2026-12-31'), '2027-02-28');
});

// --- boundaries -------------------------------------------------------------

test('the 9-month and 24-month limits: exactly the limit is still fine, one more is not', () => {
  const massage = (months) => evaluate({ type: 'returning', lastVisitMonthsAgo: months, massagesThisWeek: 0 }, { ...where, request: 'massage' });
  assert.equal(massage(9).blocked, null);
  assert.equal(massage(10).blocked.code, 'massage_needs_checkup');
  const checkup = (months) => services(evaluate({ type: 'returning', lastVisitMonthsAgo: months }, { ...where, request: 'checkup', addOn: 'none' }));
  assert.deepEqual(checkup(24), ['review']);
  assert.deepEqual(checkup(25), ['assessment']);
});

test('a blocked request is never ready, whatever else is filled in', () => {
  const full = { addOn: 'none', clinic: 'CEN', date: '2026-10-20', time: 'any' };
  const blocked = [
    [{ type: 'new' }, { request: 'massage' }],
    [{ type: 'returning', lastVisitMonthsAgo: 20, massagesThisWeek: 0 }, { request: 'massage' }],
    [{ type: 'returning', lastVisitMonthsAgo: 2, massagesThisWeek: 2 }, { request: 'massage' }],
    [{ type: 'returning', lastVisitMonthsAgo: 2, massagesThisWeek: 1, massagesThisSession: 1 }, { request: 'massage' }],
  ];
  for (const [patient, draft] of blocked) {
    const ev = evaluate(patient, { ...full, ...draft });
    assert.ok(ev.blocked, JSON.stringify([patient, draft]));
    assert.equal(ev.ready, false, JSON.stringify([patient, draft]));
  }
});

test('missing facts are never guessed: nothing is ready until they are given', () => {
  const draft = { request: 'checkup', clinic: 'CEN', date: '2026-10-20' };
  assert.equal(evaluate({ type: 'returning' }, draft).ready, false, 'last visit unknown');
  assert.equal(evaluate({ type: 'returning', lastVisitMonthsAgo: 2 }, draft).ready, false, 'stretch question unanswered');
  assert.equal(evaluate({ type: 'returning', lastVisitMonthsAgo: 2 }, { request: 'massage', clinic: 'CEN', date: '2026-10-20' }).ready, false, 'massage count unknown');
  assert.equal(evaluate({ type: 'new' }, { clinic: 'CEN' }).ready, false, 'date unknown');
  assert.equal(evaluate({ type: 'returning', lastVisitMonthsAgo: 2 }, {}).ready, false, 'nothing asked for');
});

// Every combination of patient facts and request, checked against the rules as a whole instead of one hand-picked case at a time.
test('over every combination, what is ready always follows the rules', () => {
  let ready = 0;
  const cases = [];
  for (const type of ['new', 'returning'])
    for (const request of [undefined, 'checkup', 'massage', 'class'])
      for (const lastVisitMonthsAgo of [undefined, 0, 9, 10, 24, 25, 40])
        for (const massagesThisWeek of [undefined, 0, 1, 2, 3])
          for (const massagesThisSession of [0, 1, 3])
            for (const addOn of [undefined, 'none', 'stretch'])
              cases.push([{ type, lastVisitMonthsAgo, massagesThisWeek, massagesThisSession }, { request, addOn, clinic: 'CEN', date: '2026-10-20' }]);
  for (const [patient, draft] of cases) {
    const r = evaluate(patient, draft);
    const label = JSON.stringify([patient, draft]);
    const got = services(r);
    if (r.blocked) assert.equal(r.ready, false, `blocked but ready: ${label}`);
    if (r.offer || r.missing.length) assert.equal(r.ready, false, `ready with an open question: ${label}`);
    if (!r.ready) continue;
    ready++;
    assert.ok(got.length >= 1 && got.length <= 2, `1-2 services: ${label}`);
    if (patient.type === 'new') {
      assert.ok(['assessment', 'class'].includes(got[0]), `a new patient got ${got}: ${label}`);
      assert.ok(!got.includes('massage') && !got.includes('review'), `new patient got ${got}: ${label}`);
    } else {
      assert.ok(!(got.includes('assessment') && patient.lastVisitMonthsAgo <= RULES.reassessAfterMonths), `needless assessment: ${label}`);
      if (got.includes('review')) assert.ok(patient.lastVisitMonthsAgo <= RULES.reassessAfterMonths, label);
      if (got.includes('massage')) {
        assert.ok(patient.lastVisitMonthsAgo <= RULES.massageMaxMonths, `massage after a long gap: ${label}`);
        assert.ok(patient.massagesThisWeek + patient.massagesThisSession + 1 <= RULES.massageWeeklyLimit, `massage over the limit: ${label}`);
      }
      if (got.includes('stretch')) assert.deepEqual(got, ['review', 'stretch'], label);
    }
  }
  assert.ok(ready > 100, 'the grid reaches plenty of requestable cases');
});

test('the rules never throw, whatever junk they are given', () => {
  const junk = [undefined, null, NaN, -1, 1e9, 'x', '', {}, [], true];
  for (const v of junk) {
    for (const patient of [{ type: 'new' }, { type: 'returning', lastVisitMonthsAgo: v, massagesThisWeek: v, massagesThisSession: v }, { type: v }]) {
      for (const draft of [{}, { request: v, addOn: v, clinic: v, date: v }]) {
        assert.doesNotThrow(() => evaluate(patient, draft), JSON.stringify([patient, draft]));
      }
    }
  }
});
