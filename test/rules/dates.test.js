import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDate, splitTime, addMonths, addDays, weekdayName } from '../../src/rules/dates.js';

// Tuesday, 6 October 2026
const TODAY = '2026-10-06';

test('the reference day is a Tuesday', () => assert.equal(weekdayName(TODAY), 'tuesday'));

test('today, tomorrow, in N days/weeks', () => {
  assert.equal(resolveDate('today', TODAY), '2026-10-06');
  assert.equal(resolveDate('Tomorrow', TODAY), '2026-10-07');
  assert.equal(resolveDate('day after tomorrow', TODAY), '2026-10-08');
  assert.equal(resolveDate('in 3 days', TODAY), '2026-10-09');
  assert.equal(resolveDate('in two weeks', TODAY), '2026-10-20');
});

test('weekday names: bare, this, next', () => {
  assert.equal(resolveDate('Tuesday', TODAY), '2026-10-13', 'a bare weekday is the next one after today');
  assert.equal(resolveDate('Friday', TODAY), '2026-10-09');
  assert.equal(resolveDate('this Friday', TODAY), '2026-10-09');
  assert.equal(resolveDate('this Tuesday', TODAY), '2026-10-06');
  assert.equal(resolveDate('next Tuesday', TODAY), '2026-10-13');
  assert.equal(resolveDate('next Friday', TODAY), '2026-10-16');
  assert.equal(resolveDate('next Monday', TODAY), '2026-10-12');
  assert.equal(resolveDate('Sat next week', TODAY), '2026-10-17');
  assert.equal(resolveDate('thurs', TODAY), '2026-10-08');
});

test('next <weekday> from a Sunday and a Monday', () => {
  assert.equal(resolveDate('next Monday', '2026-10-04'), '2026-10-05'); // Sunday -> the very next day
  assert.equal(resolveDate('next Wednesday', '2026-10-05'), '2026-10-14'); // Monday -> a week and two days
});

test('day and month, with and without a year', () => {
  assert.equal(resolveDate('15 Oct', TODAY), '2026-10-15');
  assert.equal(resolveDate('15th October', TODAY), '2026-10-15');
  assert.equal(resolveDate('Oct 15', TODAY), '2026-10-15');
  assert.equal(resolveDate('on the 3rd of November.', TODAY), '2026-11-03');
  assert.equal(resolveDate('15/10', TODAY), '2026-10-15');
  assert.equal(resolveDate('15-10-2026', TODAY), '2026-10-15');
  assert.equal(resolveDate('2026-10-20', TODAY), '2026-10-20');
  assert.equal(resolveDate('2 Jan', TODAY), '2027-01-02', 'already past this year: next year');
});

test('unclear or impossible dates are not guessed', () => {
  for (const text of ['next week', 'next month', 'soon', '', 'sometime in the afternoon', '31 Feb', '32/1', '2026-02-30']) {
    assert.equal(resolveDate(text, TODAY), null, text);
  }
});

test('addMonths clamps to the end of a shorter month', () => {
  assert.equal(addMonths('2026-10-06', 1), '2026-11-06');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

// --- negatives ---------------------------------------------------------------

test('absurd counts and non-text input never throw', () => {
  for (const text of ['in 99999999999 days', 'in 99999999 weeks', null, undefined, 123, {}, [], 'x'.repeat(100000)]) {
    assert.doesNotThrow(() => resolveDate(text, TODAY), String(text).slice(0, 30));
  }
  assert.ok(resolveDate('in 99999999999 days', TODAY) > '2030-01-01', 'a huge count lands far in the future, to be refused as too far ahead');
  assert.equal(resolveDate(123, TODAY), null);
  assert.equal(resolveDate({}, TODAY), null);
});

test('past, contradictory and half-said dates are not guessed', () => {
  for (const text of ['yesterday', 'last friday', 'next next friday', 'monday monday', 'this next tuesday', 'the day before', 'friday or saturday', 'in', 'in days', 'in -3 days', 'after lunch']) {
    assert.equal(resolveDate(text, TODAY), null, text);
  }
});

test('impossible calendar dates are refused', () => {
  for (const text of ['29 Feb 2027', '31 Apr', '0 Oct', '15/13', '15/0', '00-00-2026', 'Oct 32', '2026-00-10', '2026-10-00', '15 Octember']) {
    assert.equal(resolveDate(text, TODAY), null, text);
  }
});

test('a time of day inside the date text is split off, in the forms patients really write it', () => {
  const split = (text) => {
    const r = splitTime(text);
    return [resolveDate(r.dateText, TODAY), r.time];
  };
  assert.deepEqual(split('next Friday around 4pm'), ['2026-10-16', '16:00']);
  assert.deepEqual(split('in 3 weeks around 5pm'), ['2026-10-27', '17:00']);
  assert.deepEqual(split('4 Nov around 11am'), ['2026-11-04', '11:00']);
  assert.deepEqual(split('tomorrow at 3:30 pm'), ['2026-10-07', '15:30']);
  // "day after tomorrow" has an "after" in it that is not a limit like "after 3pm" (the local eval's patient said it with a time and the date was never read).
  assert.deepEqual(split('day after tomorrow around 6pm'), ['2026-10-08', '18:00']);
  assert.deepEqual(split('the day after tomorrow, any time works'), ['2026-10-08', 'any']);
  assert.deepEqual(split('day after tomorrow after 3pm'), [null, null]);
  assert.deepEqual(split('tomorrow at 4.30 p.m.'), ['2026-10-07', '16:30']);
  assert.deepEqual(split('4pm tomorrow'), ['2026-10-07', '16:00']);
  assert.deepEqual(split('Friday, 10am'), ['2026-10-09', '10:00']);
  assert.deepEqual(split('next Friday 16:00'), ['2026-10-16', '16:00']);
  assert.deepEqual(split('tomorrow 11:30'), ['2026-10-07', '11:30']);
  assert.deepEqual(split('12pm tomorrow'), ['2026-10-07', '12:00']);
  assert.deepEqual(split('12am tomorrow'), ['2026-10-07', '00:00']);
  assert.deepEqual(split('next Thursday, any time works'), ['2026-10-15', 'any']);
  assert.deepEqual(split('tomorrow anytime'), ['2026-10-07', 'any']);
});

test('what is not safely a time of day is left alone', () => {
  for (const text of [
    'before 5pm tomorrow', 'tomorrow after 3pm', 'between 2 and 4pm tomorrow', 'tomorrow by noon', // limits, not times
    'tomorrow 4:30', 'tomorrow 9:15', // morning or evening?
    '13pm tomorrow', '0am tomorrow', // not a clock time
    'next Friday', '15/10', '15.10', '15 Oct', '15.10.26', 'in 2 weeks', 'next week', '', // no time in there: unchanged
  ]) {
    const r = splitTime(text);
    assert.equal(r.time, null, text);
    assert.equal(r.dateText, text, text);
  }
  assert.equal(splitTime(undefined).time, null);
  // A time with no date still comes out as a time, and the empty rest is not a date: the engine then asks for the date.
  assert.deepEqual(splitTime('any time'), { dateText: '', time: 'any' });
  assert.equal(resolveDate('', TODAY), null);
  // resolveDate itself is unchanged: a date with a time stuck on is not a date until the time is split off.
  assert.equal(resolveDate('next Friday around 4pm', TODAY), null);
});
