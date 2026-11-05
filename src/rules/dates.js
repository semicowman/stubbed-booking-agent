// Date helpers for the booking agent: turning what a patient says ("next
// Tuesday", "15 Oct", "in 2 weeks") into a YYYY-MM-DD date, and working out how
// far ahead bookings are allowed. Pure functions, all in Singapore dates
// (no timezones involved: `today` is passed in as YYYY-MM-DD).
//
// Conventions (the agent always reads the resolved date back to the patient,
// so a wrong guess is corrected there):
//   "Tuesday" / "coming Tuesday"  the next Tuesday after today
//   "this Tuesday"                today if it is Tuesday, else the next one this week
//   "next Tuesday"                the first Tuesday on or after next Monday
//   "15/10", "15 Oct"             day first (Singapore); next year if already past
//   "next week", "next month"     not specific enough: returns null so we ask

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_ALIASES = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};
const MONTH_ALIASES = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

const parse = (ymd) => new Date(`${ymd}T00:00:00Z`);
const format = (d) => d.toISOString().slice(0, 10);

export function addDays(ymd, n) {
  const d = parse(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return format(d);
}

// Same day number n months on, clamped to the end of a shorter month
// (31 Jan + 1 month = 28/29 Feb).
export function addMonths(ymd, n) {
  const d = parse(ymd);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n + 1, 0); // last day of the target month
  d.setUTCDate(Math.min(day, d.getUTCDate()));
  return format(d);
}

export const weekdayOf = (ymd) => parse(ymd).getUTCDay();
export const weekdayName = (ymd) => WEEKDAYS[weekdayOf(ymd)];

// A real calendar date in YYYY-MM-DD form, or null.
function validDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return format(date);
}

// Day and month with no year: this year, or next year if it has already passed.
function dayMonth(d, m, today) {
  const year = Number(today.slice(0, 4));
  const thisYear = validDate(year, m, d);
  if (!thisYear) return null;
  return thisYear >= today ? thisYear : validDate(year + 1, m, d);
}

const fullYear = (y) => (y < 100 ? 2000 + y : y);

// Returns YYYY-MM-DD, or null if the text isn't a specific enough date.
export function resolveDate(text, today) {
  const t = String(text ?? '')
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/\.+$/, '')
    .replace(/\b(the|on|of|at|around|about)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  let m;

  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));

  if (t === 'today') return today;
  if (t === 'tomorrow' || t === 'tmr' || t === 'tmrw') return addDays(today, 1);
  if (t === 'day after tomorrow') return addDays(today, 2);

  if ((m = /^in (\d+|a|an|one|two|three|four|five|six) (day|days|week|weeks)$/.exec(t))) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
    // Absurd counts would overflow the calendar: cap them at a date that is
    // still far beyond any booking limit.
    return addDays(today, Math.min(m[2].startsWith('week') ? n * 7 : n, 3650));
  }

  // "[this|next|coming] <weekday>", "<weekday> next week"
  if ((m = /^(?:(this|next|coming|upcoming) )?([a-z]+)(?: (next week))?$/.exec(t)) && m[2] in WEEKDAY_ALIASES) {
    const target = WEEKDAY_ALIASES[m[2]];
    const dow = weekdayOf(today);
    const modifier = m[3] ? 'next' : m[1];
    if (modifier === 'next') {
      const nextMonday = addDays(today, (8 - dow) % 7 || 7);
      return addDays(nextMonday, (target + 6) % 7);
    }
    if (modifier === 'this') return addDays(today, (target - dow + 7) % 7);
    return addDays(today, (target - dow + 7) % 7 || 7);
  }

  // "15 oct", "15th october 2026", "oct 15", "october 15th"
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)(?: (\d{2,4}))?$/.exec(t)) && m[2] in MONTH_ALIASES) {
    return m[3] ? validDate(fullYear(Number(m[3])), MONTH_ALIASES[m[2]], Number(m[1])) : dayMonth(Number(m[1]), MONTH_ALIASES[m[2]], today);
  }
  if ((m = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{2,4}))?$/.exec(t)) && m[1] in MONTH_ALIASES) {
    return m[3] ? validDate(fullYear(Number(m[3])), MONTH_ALIASES[m[1]], Number(m[2])) : dayMonth(Number(m[2]), MONTH_ALIASES[m[1]], today);
  }

  // "15/10", "15-10-2026", "15.10.26" (day first)
  if ((m = /^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$/.exec(t))) {
    return m[3] ? validDate(fullYear(Number(m[3])), Number(m[2]), Number(m[1])) : dayMonth(Number(m[1]), Number(m[2]), today);
  }

  return null;
}

// A time of day the patient put inside the date text: "next Friday around 4pm", "tomorrow at 3:30 pm",
// "4 Nov 11am", "next Thursday, any time works". Returns the text without it and the time as the tool takes
// it ('HH:MM' or 'any'), or { dateText: text, time: null } when there is none or it is not safe to read:
//   - "before 5pm", "after 3", "between 2 and 4", "by noon" are limits, not times, so nothing is taken;
//   - a bare "4:30" or "9.15" with no am/pm could be morning or evening, so nothing is taken (the clinics
//     open 10:00 to 19:00, so a bare 10:00 to 23:59 is read as 24-hour time);
//   - a dot only counts as a separator with am/pm ("4.30pm"), because "15.10" is a date, day first.
// The rules check uses this only when the text did not resolve to a date on its own, and only when what is left does.
export function splitTime(text) {
  const original = String(text ?? '');
  const none = { dateText: original, time: null };
  // ("day after tomorrow" has an "after" in it that is not a limit.)
  if (/\b(before|after|by|until|till|between|earlier|later)\b/i.test(original.replace(/\bday after tomorrow\b/gi, 'overmorrow'))) return none;
  const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const take = (re, read) => {
    const m = re.exec(original);
    if (!m) return null;
    const time = read(m);
    if (!time) return null;
    return { dateText: `${original.slice(0, m.index)} ${original.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ').trim(), time };
  };
  const found =
    // 4pm, 4:30pm, 4.30 p.m., 12am
    take(/\b(\d{1,2})(?:[:.]([0-5]\d))?\s*([ap])\.?m\b\.?/i, (m) => {
      const h = Number(m[1]);
      if (h < 1 || h > 12) return null;
      return hhmm((h % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0), Number(m[2] ?? 0));
    }) ??
    // 16:00, 11:30 (24-hour, a colon, and from 10:00 on)
    take(/\b(1\d|2[0-3]):([0-5]\d)\b/, (m) => hhmm(Number(m[1]), Number(m[2]))) ??
    // any time, anytime, any time works / is fine / is ok
    take(/\bany ?time\b(?:\s+(?:works?|is fine|is ok(?:ay)?|is good))?/i, () => 'any');
  return found ?? none;
}
