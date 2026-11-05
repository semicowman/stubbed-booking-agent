// Patient-facing wording that has to be exact: rule explanations and every closing message.
// The rules check hands these to the agent as `say` (send exactly as written); closing messages are added by the
// loop itself. Everything else is phrased by the model. Edit the wording here, not in the prompt.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatDate(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${suffix}` : `${h12}${suffix}`;
}

export const OFFERS = {
  add_stretch: 'Would you like to add a Stretch Session straight after your review?',
};

export const BLOCKS = {
  new_patient_checkup_first:
    'As a new patient, your first visit is an Initial Assessment, so our practitioner can learn about you before any treatment. Shall I request an Initial Assessment for you?',
  massage_needs_checkup:
    "A massage needs a visit with us in the last 9 months, so you'll need a check-up first. May I request a check-up for you?",
  massage_limit:
    "We can fit in at most 2 massages in any 7 days, so I can't request another one for that week. Would you like to try a different date?",
};

export const TOO_FAR = (latest) =>
  `We can only take requests up to two months ahead, so the latest date I can offer is ${formatDate(latest)}. Which date works for you?`;

// Not at that clinic / not on that day: the data comes from config/service-availability.json.
export const NOT_AT_CLINIC = (label, clinic, clinics) =>
  `${label} isn't offered at ${clinic}. It is available at ${clinics.join(', ')}. Which of those would you prefer?`;
export const WRONG_DAY = (label, days) =>
  `${label} is only on ${days.join(' and ')}. Which of those days works for you?`;

// A patient under the minimum age: the clinic does not take those requests online.
export const MINOR_SAY = 'Thank you for letting us know. We can only take online requests for patients aged 16 and over, but our front desk team can help you with this one.';

export const WARNING = "I'm happy to help, but please keep our conversation respectful so I can carry on with your booking.";

export const NOTES = {
  price_link: 'https://www.harbour-wellness.example/prices/',
  services_link: 'https://www.harbour-wellness.example/services/',
};

const partLine = (p) => `${p.service} at ${p.clinic} on ${formatDate(p.date)}${p.time ? ` at ${formatTime(p.time)}` : ' (time to be set by staff)'}${p.practitioner ? ` with ${p.practitioner}` : ''}`;

const CLOSINGS = {
  minor: `${MINOR_SAY} Let me get an agent to assist you. This booking session will end here.`,
  handoff_to_staff: 'Let me get an agent to assist you. Someone will be right with you. This booking session will end here.',
  outside_booking: "I can't help with that in this booking session, so a team member will take it from here. This booking session will end now.",
  patient_declined: 'No problem. This booking session has ended. Feel free to message us any time to start again.',
  booking_completed: 'Thank you for contacting Harbour Wellness Clinic. Your request has been noted and a team member will confirm it. This booking session has ended.',
  emergency:
    'Please go to the nearest emergency department or call the clinic directly. This booking session will end now.',
  out_of_scope: 'This booking session has ended.',
  system_fault: "I'm sorry, I can't continue with this booking right now because of a technical problem on our side. Our team has been notified and will follow up with you. This booking session has ended.",
  uncooperative: "I'm not able to continue with this booking right now. Please message us again whenever you're ready, or contact the clinic directly. This booking session has ended.",
  ended: 'This booking session has ended.',
};

const NOT_ENGLISH_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Tamil}]/u;

// The closing message for the end_session note.
export function closing(kind, { booked, notBooked, followups }) {
  const parts = [CLOSINGS[kind] ?? CLOSINGS.ended];
  const showSummary = booked.length > 0 || booked.length + notBooked.length > 1;
  if (showSummary && kind !== 'ended') {
    const lines = ['Here is a summary of this session:'];
    for (const b of booked) lines.push(`- Noted request: ${partLine(b)}`);
    for (const n of notBooked) lines.push(`- Not requested: ${n.service} (${n.reason})`);
    parts.push(lines.join('\n'));
  }
  // The patient reads this line in English: a note the model wrote in another script (a Chinese note after a Chinese chat) stays in the staff note only.
  // A note that already ends with a full stop (or ? or !) must not get a second one from the sentence it sits in.
  const readable = followups.filter((f) => !NOT_ENGLISH_SCRIPT.test(String(f))).map((f) => String(f).trim().replace(/[\s.!?;,]+$/, '')).filter(Boolean);
  if (readable.length && kind !== 'ended') parts.push(`A team member will follow up on: ${readable.join('; ')}.`);
  return parts.join('\n\n');
}

export const NOT_BOOKED_REASONS = {
  new_patient_checkup_first: 'new patients start with an Initial Assessment',
  massage_needs_checkup: 'a check-up is needed first',
  massage_limit: 'weekly massage limit reached',
  no_slots: 'no suitable slot',
  stopped: 'you chose to stop',
  failed: 'the request could not be completed',
};

// Summary note for the front desk team (internal). The first line says what happened.
// No medical details, and never the patient's own words.
const HANDOVER_WHY = {
  handoff: 'Patient was handed to an agent (asked for a person, or the request could not be completed).',
  outside_booking: 'Patient needs something staff handle (not a new booking).',
  token_budget: 'The conversation hit its length limit and was handed over.',
  booking_completed: 'Booking session completed. The assistant has noted the requests below and ended the session: a team member needs to confirm them.',
  no_booking: 'The assistant ended the session without noting a request.',
  patient_declined: 'Patient chose not to book and ended the session. Nothing was requested.',
  minor: 'The patient is under the minimum age for online requests (16). The assistant told them so and handed the chat to the front desk. No name, phone or other details were collected, and nothing was requested.',
  emergency: 'Patient mentioned something urgent. The assistant told them to go to the nearest emergency department or call the clinic, and ended the session. Please check in with the patient.',
  out_of_scope: 'Patient asked for something outside booking. The assistant ended the session.',
  uncooperative: 'The assistant ended the session: several messages in a row without moving the request forward.',
  rude: 'The assistant ended the session after repeated rude or insulting messages.',
  abuse: 'The assistant ended the session after abusive or threatening messages.',
  spam: 'The assistant ended the session: suspected spam.',
  scam: 'The assistant ended the session: suspected scam attempt.',
  hacker: 'The assistant ended the session: suspected attempt to manipulate the assistant.',
  system_fault: 'A technical problem stopped this request, so the assistant ended the session and attempted nothing further. Please follow up with the patient.',
};

// The assistant's own short summary of the chat, for staff only. Whatever the model wrote is cut down: no control characters,
// no e-mail addresses, ID-like or long digit strings, and a length cap, so it cannot carry identifiers into the note.
export function cleanSummary(text, max = 700) {
  return String(text ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/\b[STFGM]\d{7}[A-Z]\b/gi, '[id]')
    .replace(/\+?\d[\d ]{6,}\d/g, '[number]') // 8 or more digits: a Singapore mobile number is 8
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// contact: whether contact details were given in the chat (the details themselves are never kept)
// actions: [text]  what staff need to do (empty: nothing)
// summary: the assistant's own summary of the chat, already cleaned (cleanSummary)
export function handoverNote({ why, contact, booked, notBooked, followups, onBehalf = false, actions = [], summary = '' }) {
  const key = why === 'booking_completed' && !booked.length ? 'no_booking' : why;
  const lines = ['BOOKING AGENT SUMMARY', HANDOVER_WHY[key] ?? HANDOVER_WHY.handoff];
  lines.push(contact ? 'Patient: contact details were given in the chat.' : 'Patient: no contact details yet');
  if (onBehalf) lines.push("Booked on the patient's behalf by someone else (not the patient).");
  if (summary) lines.push(`Conversation summary: ${summary}`);
  if (booked.length) {
    lines.push('Appointment requests noted (nothing was actually booked):');
    for (const b of booked) lines.push(`- ${partLine(b)}`);
  }
  if (notBooked.length) {
    lines.push('Not requested:');
    for (const n of notBooked) lines.push(`- ${n.service} (${n.reason})`);
  }
  if (followups.length) lines.push(`Follow up: ${followups.join('; ')}`);
  lines.push(actions.length ? `Actions required:\n${actions.map((a) => `- ${a}`).join('\n')}` : 'Actions required: none.');
  return lines.join('\n');
}
