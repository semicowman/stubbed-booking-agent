// Mobile numbers: always stored in E.164 ("+6591234567"), the clinic's own country being Singapore (+65).
//
// The patient types the number any way they like ("9123 4567", "+65 9123-4567", "0065 9123 4567"). The country code is
// taken from what they type; a number typed without one gets the default country code:
//   - on WhatsApp: the country code of the number the patient is chatting from (so a Malaysian patient's "012-345 6789"
//     becomes +60...), and
//   - everywhere else (the terminal chat, tests, no sender number known): +65.
// A number that is not valid for its country (for example an 8-digit Singapore number that does not start with 3, 6, 8
// or 9) is refused and the patient is asked again, so a wrong or half-typed number never becomes a patient record.
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

export const SINGAPORE = '65';

// The country calling code ("65") of a number given as digits only, or null when it is not a valid international number.
export function callingCodeOf(digits) {
  const d = String(digits ?? '').replace(/\D/g, '');
  if (d.length < 8) return null;
  const n = parsePhoneNumberFromString(`+${d}`);
  return n && n.isValid() ? n.countryCallingCode : null;
}

// -> { ok: true, e164, callingCode, foreign } or { ok: false }.
//    foreign: the number is not a Singapore one.
export function normalizePhone(input, { defaultCallingCode = SINGAPORE } = {}) {
  let t = String(input ?? '').trim();
  if (!t) return { ok: false };
  t = t.replace(/^00(?=\d)/, '+').replace(/^\+\s+/, '+'); // 0065... is the international prefix
  const n = parsePhoneNumberFromString(t, { defaultCallingCode: String(defaultCallingCode) });
  if (!n || !n.isValid()) return { ok: false };
  return { ok: true, e164: n.number, callingCode: n.countryCallingCode, foreign: n.countryCallingCode !== SINGAPORE };
}
