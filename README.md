# Stubbed booking agent

A WhatsApp-style booking assistant for a fictional clinic, with nothing behind it. It talks to a patient, applies the clinic's booking rules, and **writes down the actions it would have taken** instead of taking them. There is no booking system, patient record, calendar, messaging service or tool of any kind in this repository: the only thing it contacts is the language model you point it at.

```
patient message -> model -> reply + action notes -> notes checked against the booking rules
                                                  -> (a broken rule: the model rewrites the reply, once)
                                                  -> patient sees the reply; notes go to the action log
```

## Run it

```
npm install
cp .env.example .env      # optional: the defaults use a local server at http://localhost:1234/v1
npm run chat              # terminal chat: you are the patient
npm run web               # the same in a browser page: http://localhost:3000
npm run eval              # scripted patients against the agent and your model
npm test                  # unit tests, no model needed
```

Needs Node 20 or newer. The default model is any OpenAI-compatible local server (LM Studio, Ollama, llama-server): set `LOCAL_LLM_URL` and `LOCAL_LLM_MODEL`. `MODEL_PROVIDER=gemini` with a `GEMINI_API_KEY` uses Gemini instead; the chat then leaves your computer, so it is no longer isolated.

## What a chat shows

Below each reply you see the action notes the agent wrote and whether the rules accepted them:

```
Agent: I've noted your appointment request ... a team member will confirm the time.

  [noted] update_request {"service":"checkup","clinic":"Northpoint","date_text":"next Tuesday"}
  [noted] submit_request {"patient_confirmed":true,"clinic":"Northpoint","time":"15:00"}
```

Commands: `/reset`, `/actions`, `/state`, `/help`, `/exit`. When a session ends, the hand-over note for the team is printed. Nothing is ever booked, so the agent says a request has been *noted* and that a team member will confirm.

## Web page (`npm run web`)

A single page on `http://localhost:3000` (`PORT=<number>` changes it). You type as the patient; each reply shows the action notes the agent wrote, any rules still broken, the rules check for the next turn, the hand-over note when the session ends, and a panel of what the rules currently hold. The header says which model answers and whether the chat stays on this computer.

**Personas** are simulated patients: a reminder card of who they are, what they want, how they behave, their language and an opening line, plus the made-up facts they know. Click the opening line or a fact on the card to put it in the message box, so playing a patient is quick and consistent. Create, edit, duplicate and delete personas in the page, and export or import them as JSON. They are saved in `data/personas.json` (git-ignored); *Reset examples* restores the examples shipped in `config/personas.default.json`, which cover the main paths: returning and new patients, a new patient asking for a massage, a child, a massage after a long gap, the weekly massage limit, a class on the wrong day, a date too far ahead, a price question, a Chinese speaker, a rude patient and a prompt-injection attempt. A persona never reaches the agent: it only sees what you type. Use made-up details only.

The server listens on `127.0.0.1` only, refuses requests whose Host is not a local name or whose Origin is another site, caps request size, and shows model text as plain text (never as HTML). The page loads nothing from the internet. Conversations live in memory (the 20 most recent are kept); the action log works as in the terminal chat.

## Action notes

The agent has no tools. At the end of a reply it writes notes such as `[[ACTION save_contact {"name":"...","mobile":"..."}]]`; the loop removes them from what the patient sees (`src/agent/actions.js`):

| Note | Meaning |
|---|---|
| `confirm_age` | The patient answered "16 or over?". Under 16 ends the session with the fixed message. |
| `save_contact` | The patient gave a name and mobile number (number checked for validity), and optionally an email. |
| `update_request` | Details as the patient gives them: service, clinic, date in their own words, time, practitioner, last visit and so on. |
| `submit_request` | The patient said yes to the full details. Only noted when the rules allow it. |
| `staff_note`, `flag_behavior` | Things a person or the system would otherwise do. |
| `end_session` | The end, with a reason and a summary for staff. The closing message is added automatically. |

## The booking rules (pure code)

The clinic is fictional, and so are its rules. Patients can request a **check-up**, a **massage** or a **mobility class**:

- A new patient's check-up is an *Initial Assessment*; a returning patient gets a *Review Appointment* (an assessment again if they were last seen over 24 months ago). A review offers a *Stretch Session* as an add-on.
- A massage needs a visit in the last 9 months (otherwise a check-up first), is never offered to a new patient, and is capped at 2 in any 7 days.
- Classes are open to everyone but only run on certain days at certain clinics, and massages are only offered at some clinics: that is data in `config/service-availability.json`.
- Requests are for patients 16 and over, up to two months ahead and at least 60 minutes from now.

`src/rules/` holds them as plain functions with no I/O: `dates.js` (the patient's words to a date), `rules.js` (what each patient may request, what is still needed, what must be offered or refused), `availability.js` (clinic and day restrictions), `phone.js` (mobile numbers), `clinics.js`, and `templates.js` (wording that must be exact: refusals, closing messages, the staff note). `src/agent/checks.js` applies them to the notes. It keeps no name, email or mobile number, only that one was given.

When a note breaks a rule (a date too far ahead, an unknown clinic, a class on the wrong day, a request without the patient's yes) the reply is not sent: the model is told what is wrong, with the exact wording to use, and writes it again once. Guidance that does not need a rewrite (what is still needed, an offer to make) goes in front of the patient's next message.

## Action log and privacy

Every note is written to `logs/actions-<date>-<time>.jsonl` (git-ignored). Names, emails, mobile numbers, health information and the staff summary are written as `[recorded]`; the chat text itself is never logged. The terminal does show the hand-over note, because that is what you are testing. `ACTION_LOG=0` turns the file off. Use made-up patients, particularly with `MODEL_PROVIDER=gemini`.

## Eval

`npm run eval` plays scripted patients (`eval/scenarios.js`) against the agent and your model, then checks the notes it wrote and the replies: nothing claimed as booked, no price quoted, English only, no instructions leaked, a minor ends the session, a date over two months away is refused, and so on. `-- --verbose` prints every conversation; `-- --only <text>` runs matching scenarios. Expectations are goals a small model may miss; read the failures with the transcript.

## Layout

```
prompts/          system-prompt.txt (behaviour), clinic-reference.md (what it may answer from)
src/rules/        the booking rules, pure
src/agent/        actions (parser), checks (rules applied to notes), agent (the loop), model, prompt, action-log
src/cli.js        terminal chat
src/web/          the web page: server.js, app.js (API), personas.js, public/index.html
eval/             scenarios and runner
test/             unit tests (node --test)
config/           service-availability.json (maintained by the clinic), personas.default.json
data/             your saved personas (git-ignored)
```

## What is deliberately not here

A booking engine, a calendar or patient-record integration, a messaging webhook, a database, and any tool-calling client. The agent only talks to the language model you point it at. A test (`test/agent/prompt.test.js`) fails if a source file pulls in a network client or a database library.

All clinic names, locations, staff, prices and patients in this repository are made up.
