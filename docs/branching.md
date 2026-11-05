# How the branching logic leads to actions

The agent has no tools. It writes `[[ACTION name {json}]]` notes at the end of
its replies, and `src/agent/checks.js` runs the pure rules in `src/rules/` on
them. The diagram shows which branch of `evaluate()` ends in which outcome.

```mermaid
flowchart LR
  A{"Age 16 or over?<br/>confirm_age"} -- no --> M["end_session: minor<br/>hand over to front desk"]
  A -- yes --> C["save_contact<br/>name, mobile, optional email"]
  C --> P{"Patient type"}

  P -- new --> NC["Check-up"] --> IA1["Initial Assessment"]
  P -- new --> NM["Massage"] --> B1["Blocked:<br/>new_patient_checkup_first"]
  P -- new --> NK["Class"] --> CL1["Mobility Class"]

  P -- returning --> RC{"Check-up:<br/>last visit"}
  RC -- "over 24 months" --> IA2["Initial Assessment"]
  RC -- "within 24 months" --> RV["Review Appointment<br/>offer Stretch Session"]
  P -- returning --> RM{"Massage:<br/>last visit"}
  RM -- "over 9 months" --> B2["Blocked:<br/>massage_needs_checkup"]
  RM -- "within 9 months" --> WK{"Massages that week<br/>plus this chat plus 1"}
  WK -- "more than 2" --> B3["Blocked:<br/>massage_limit"]
  WK -- "2 or fewer" --> MS["Therapeutic Massage"]
  P -- returning --> RK["Class"] --> CL2["Mobility Class"]

  IA1 & IA2 & RV & MS & CL1 & CL2 --> U["update_request<br/>clinic, date, time, practitioner"]
  U --> V{"Clinic known, date in range,<br/>at least 60 min notice,<br/>service at that clinic and weekday?"}
  V -- "no: error finding" --> R["Reply rewritten once"] --> U
  V -- yes --> Y["Read back details, patient says yes"]
  Y --> S["submit_request<br/>patient_confirmed true, max 3 per chat"]
  S --> E["end_session: booked"]

  B1 & B2 & B3 --> SAY["Fixed wording sent<br/>optional staff_note"]
  SAY --> E2["end_session: not booked"]
```

## Notes

- Blocked outcomes use the fixed wording in `src/rules/templates.js`, so the
  model cannot improvise a refusal.
- A request cannot be submitted until contact details are saved
  (`contact_first`) and the age check has passed (`age_first`).
- `flag_behavior` gives a warning, then ends the session at two strikes.
- Missing facts (service, last visit, clinic, date, massages that week) do not
  branch. They produce a `missing` finding and the agent asks one question.
