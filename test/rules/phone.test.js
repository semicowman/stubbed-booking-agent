// Mobile numbers are saved in E.164: +65 by default, the WhatsApp sender's own country code when chatting from abroad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, callingCodeOf } from '../../src/rules/phone.js';

test('a Singapore number is saved as +65 whichever way it was typed', () => {
  for (const typed of ['9123 4567', '91234567', '+65 9123 4567', '+65-9123-4567', '6591234567', '0065 9123 4567', '(65) 9123 4567']) {
    const r = normalizePhone(typed);
    assert.equal(r.e164, '+6591234567', typed);
    assert.equal(r.foreign, false, typed);
  }
  assert.equal(normalizePhone('6123 4567').e164, '+6561234567', 'a landline starts with 6');
});

test('numbers that are not valid are refused, never guessed', () => {
  for (const typed of ['', '   ', '1', '12345', '5123 4567', '7123 4567', '9123 456', '9123 45678', 'nine one two', '+65 1234 5678', '+999 123']) {
    assert.equal(normalizePhone(typed).ok, false, JSON.stringify(typed));
  }
  assert.equal(normalizePhone(undefined).ok, false);
});

test('a number with its own country code keeps it, and is marked foreign', () => {
  const my = normalizePhone('+60 12-345 6789');
  assert.deepEqual([my.e164, my.callingCode, my.foreign], ['+60123456789', '60', true]);
  assert.equal(normalizePhone('0044 7911 123456').e164, '+447911123456');
  assert.equal(normalizePhone('+44 7911 123456', { defaultCallingCode: '65' }).foreign, true);
});

test('typed without a country code, a number takes the default one (the WhatsApp sender country)', () => {
  assert.equal(normalizePhone('012-345 6789', { defaultCallingCode: '60' }).e164, '+60123456789');
  assert.equal(normalizePhone('9123 4567').e164, '+6591234567', 'the default is +65');
  assert.equal(normalizePhone('0123456789', { defaultCallingCode: '65' }).ok, false, 'a Malaysian number is not guessed as Singapore');
});

test('the calling code of a WhatsApp number given as digits', () => {
  assert.equal(callingCodeOf('6591234567'), '65');
  assert.equal(callingCodeOf('60123456789'), '60');
  assert.equal(callingCodeOf('447911123456'), '44');
  assert.equal(callingCodeOf('123'), null);
  assert.equal(callingCodeOf(null), null);
});
