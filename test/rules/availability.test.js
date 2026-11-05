import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAvailability, availabilityProblem, defaultAvailability } from '../../src/rules/availability.js';

test('the shipped file loads: massage at some clinics, classes at some clinics on some days', () => {
  const a = defaultAvailability();
  assert.deepEqual(a.massage, { clinics: ['CEN', 'EST', 'SSH'], days: null });
  assert.deepEqual(a.class, { clinics: ['CEN', 'WST'], days: ['Tuesday', 'Thursday'] });
});

test('clinic and day are checked only when known', () => {
  const a = defaultAvailability();
  assert.equal(availabilityProblem(a, 'class', 'CEN', 'Tuesday'), null);
  assert.deepEqual(availabilityProblem(a, 'class', 'SSH', 'Tuesday'), { code: 'not_at_clinic', clinics: ['CEN', 'WST'] });
  assert.deepEqual(availabilityProblem(a, 'class', 'CEN', 'Monday'), { code: 'wrong_day', days: ['Tuesday', 'Thursday'] });
  assert.equal(availabilityProblem(a, 'class', undefined, undefined), null);
  assert.equal(availabilityProblem(a, 'massage', 'WST', 'Monday')?.code, 'not_at_clinic');
  assert.equal(availabilityProblem(a, 'review', 'WST', 'Monday'), null, 'a service not in the file is offered everywhere');
});

test('a file that makes no sense is refused', () => {
  assert.throws(() => parseAvailability({ yoga: { clinics: ['CEN'] } }), /not a service/);
  assert.throws(() => parseAvailability({ class: { clinics: ['Mars'] } }), /not a clinic/);
  assert.throws(() => parseAvailability({ class: { days: ['Funday'] } }), /not a weekday/);
  assert.throws(() => parseAvailability('[1'), /JSON|Unexpected/);
  assert.deepEqual(parseAvailability({ class: { clinics: ['Central'] } }).class.clinics, ['CEN']);
});
