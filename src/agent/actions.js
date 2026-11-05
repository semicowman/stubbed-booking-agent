// Action notes. The agent has no tools: when it would have done something (save contact details, record a request) it writes a note
// at the end of its reply instead, in this form, one per line:
//
//   [[ACTION update_request {"service":"checkup","clinic":"Northpoint","date_text":"next Tuesday"}]]
//
// The loop strips the notes out of what the patient sees, checks them against the booking rules (checks.js) and writes them to the
// action log. Nothing here talks to anything.

export const END_REASONS = [
  'booking_completed', 'patient_declined', 'handoff_to_staff', 'outside_booking', 'emergency',
  'out_of_scope', 'uncooperative', 'spam', 'scam', 'hacker', 'abuse',
];

// name -> { fields: { field: 'string' | 'boolean' | 'number' | [allowed values] }, required: [field] }
export const ACTIONS = {
  confirm_age: { fields: { age_ok: 'boolean' }, required: ['age_ok'] },
  save_contact: { fields: { name: 'string', mobile: 'string', email: 'string' }, required: ['name', 'mobile'] },
  update_request: {
    fields: {
      patient_type: ['new', 'returning'],
      on_behalf: 'boolean',
      service: ['checkup', 'massage', 'class'],
      add_on: ['stretch', 'none'],
      clinic: 'string',
      date_text: 'string',
      time: 'string',
      practitioner: 'string',
      last_visit: 'string',
      massages_this_week: 'number',
      gender_preference: 'string',
    },
    required: [],
  },
  submit_request: {
    fields: { service: ['checkup', 'massage', 'class'], clinic: 'string', date_text: 'string', time: 'string', practitioner: 'string', patient_confirmed: 'boolean' },
    required: ['patient_confirmed'],
  },
  staff_note: { fields: { text: 'string' }, required: ['text'] },
  flag_behavior: { fields: {}, required: [] },
  end_session: { fields: { reason: END_REASONS, summary: 'string' }, required: ['reason', 'summary'] },
};

// What is never written to the log or the terminal: the patient's own details. The rules check still sees them.
export const PRIVATE_FIELDS = ['name', 'email', 'mobile', 'summary', 'text', 'gender_preference'];

const NOTE = /\[\[\s*ACTION\s+([A-Za-z_]+)\s*([\s\S]*?)\]\]/g;
const UNCLOSED = /\[\[\s*ACTION[\s\S]*$/;

function coerce(value, spec) {
  if (spec === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
  }
  if (spec === 'number') {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
    return Number.isFinite(n) ? n : undefined;
  }
  if (spec === 'string') return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : undefined;
  const text = String(value ?? '').trim().toLowerCase();
  return spec.includes(text) ? text : undefined;
}

// text -> { reply, actions: [{ name, args, problems: [text] }], stray }
//   reply: what the patient can see (the notes cut out).
//   problems: an unknown name or field, a value of the wrong kind, a missing required field, JSON that does not parse. A note with an
//   unknown name or unreadable JSON is kept (so it is logged and the agent is told) but flagged `invalid`.
export function extractActions(text) {
  const actions = [];
  let reply = String(text ?? '').replace(NOTE, (_, rawName, body) => {
    const name = rawName.toLowerCase();
    const problems = [];
    let args = {};
    const trimmed = body.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
        else problems.push('the details must be a JSON object');
      } catch {
        problems.push('the details are not valid JSON (use double quotes)');
      }
    }
    const spec = ACTIONS[name];
    let invalid = problems.length > 0;
    if (!spec) {
      problems.push(`"${rawName}" is not an action (use one of: ${Object.keys(ACTIONS).join(', ')})`);
      invalid = true;
      args = {};
    } else if (!invalid) {
      const clean = {};
      for (const [field, value] of Object.entries(args)) {
        if (!(field in spec.fields)) { problems.push(`${name}: "${field}" is not a field of this action (ignored)`); continue; }
        const v = coerce(value, spec.fields[field]);
        if (v === undefined || v === '') {
          problems.push(`${name}: "${field}" ${Array.isArray(spec.fields[field]) ? `must be one of ${spec.fields[field].join(', ')}` : `must be ${spec.fields[field]}`} (ignored)`);
        } else clean[field] = v;
      }
      for (const field of spec.required) if (!(field in clean)) { problems.push(`${name}: "${field}" is missing`); invalid = true; }
      args = clean;
    }
    actions.push({ name, args, problems, invalid });
    return '';
  });
  // A note cut off before its closing brackets (the model ran out of tokens): never show it to the patient.
  const stray = UNCLOSED.test(reply);
  if (stray) reply = reply.replace(UNCLOSED, '');
  reply = reply.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { reply, actions, stray };
}

// The note with the patient's own details taken out, for the log and the terminal.
export function maskedArgs(args) {
  return Object.fromEntries(Object.entries(args ?? {}).map(([k, v]) => [k, PRIVATE_FIELDS.includes(k) ? '[recorded]' : v]));
}
