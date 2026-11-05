import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractActions, maskedArgs, ACTIONS } from '../../src/agent/actions.js';

test('notes are pulled out of the reply and the patient text is kept', () => {
  const { reply, actions } = extractActions('Which clinic would you like?\n[[ACTION update_request {"service":"checkup","patient_type":"returning"}]]');
  assert.equal(reply, 'Which clinic would you like?');
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0].args, { service: 'checkup', patient_type: 'returning' });
  assert.equal(actions[0].invalid, false);
});

test('several notes, a note with no details, and values read leniently', () => {
  const { reply, actions } = extractActions('Done.\n[[ACTION confirm_age {"age_ok":"true"}]]\n[[ACTION flag_behavior]]\n[[ACTION update_request {"massages_this_week":"2","add_on":"stretch"}]]');
  assert.equal(reply, 'Done.');
  assert.deepEqual(actions.map((a) => a.name), ['confirm_age', 'flag_behavior', 'update_request']);
  assert.equal(actions[0].args.age_ok, true);
  assert.deepEqual(actions[2].args, { massages_this_week: 2, add_on: 'stretch' });
});

test('an unknown action, unknown field, wrong value and missing field are reported', () => {
  const unknown = extractActions('[[ACTION cancel_booking {"id":1}]]').actions[0];
  assert.equal(unknown.invalid, true);
  assert.match(unknown.problems.join(), /not an action/);

  const field = extractActions('[[ACTION update_request {"colour":"red","service":"yoga"}]]').actions[0];
  assert.equal(field.invalid, false);
  assert.deepEqual(field.args, {});
  assert.equal(field.problems.length, 2);

  const missing = extractActions('[[ACTION end_session {"reason":"patient_declined"}]]').actions[0];
  assert.equal(missing.invalid, true);
  assert.match(missing.problems.join(), /"summary" is missing/);

  const badReason = extractActions('[[ACTION end_session {"reason":"because","summary":"x"}]]').actions[0];
  assert.equal(badReason.invalid, true);
});

test('JSON that does not parse makes the note invalid; the patient never sees it', () => {
  const { reply, actions } = extractActions("Hello\n[[ACTION update_request {'service': 'massage'}]]");
  assert.equal(reply, 'Hello');
  assert.equal(actions[0].invalid, true);
  assert.match(actions[0].problems[0], /not valid JSON/);
});

test('a note cut off before its brackets close is removed from the reply', () => {
  const { reply, stray, actions } = extractActions('Sure.\n[[ACTION update_request {"clinic":"Orch');
  assert.equal(reply, 'Sure.');
  assert.equal(stray, true);
  assert.equal(actions.length, 0);
});

test('private fields are masked for the log', () => {
  assert.deepEqual(maskedArgs({ name: 'A B', email: 'a@b.co', mobile: '91234567', summary: 'long', clinic: 'Northpoint' }), { name: '[recorded]', email: '[recorded]', mobile: '[recorded]', summary: '[recorded]', clinic: 'Northpoint' });
});

test('every action has a field list and required fields that exist', () => {
  for (const [name, spec] of Object.entries(ACTIONS)) for (const r of spec.required) assert.ok(r in spec.fields, `${name}.${r}`);
});
