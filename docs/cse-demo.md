# CSE demonstration data

Start `npm run db:local` if necessary, then run `npm run seed:cse` from `D:\web tech project`. An existing active administrator and a MongoDB replica set are required. The seed is an explicit command; application startup never runs it, production refuses it and no emails are queued or sent.

All new records are labelled `[CSE DEMO]` and use a dedicated versioned fixture namespace. They are fictional teaching examples, not real student activity or institutional results. Existing records remain in place, so total table counts will be higher than the seed counts. Use search `CSE DEMO` on the main lists to find them.

| Records added                          | Count |
| -------------------------------------- | ----: |
| Students                               |    20 |
| Cohorts (years 1–4, sections A–E)      |    20 |
| Subjects                               |    20 |
| Questions                              |    60 |
| Exams                                  |    20 |
| Assignments                            |    23 |
| Submitted attempts / grade receipts    |    20 |
| Audited demonstration review decisions |    20 |

Subjects cover data structures, algorithms, DBMS, operating systems, networks, architecture, OOP, C, Python, Java, web technology, software engineering, automata, compilers, discrete mathematics, AI, ML, cyber security, cloud computing and graphics. Each subject has one single-choice, one multiple-choice and one true/false question, stable choice IDs, an explanation, topic, difficulty, tags, fingerprint and initial version history.

Grades are produced by the existing readiness/start/save/submit services. The seed never writes an arbitrary score or backdates attempts. Answers include correct, incorrect and blank examples. Review events and decisions are explicitly simulated, unrelated to grade calculation and never proof of cheating. Sixteen exams are closed/released through the existing lifecycle services; two remain available for interactive attempts, one opens the day after initial seeding and one stays draft. Schedules expire 30 days after initial creation; reruns never silently extend them. Duplicate a draft with new dates for a later demonstration.

Student passwords are randomly generated and kept only in the ignored `.cache/cse-demo-accounts.json`; passwords are hashed in MongoDB and never printed by the seed. Keep the file private. The first account is assigned the available Machine Learning practice, the second Cyber Security practice, and the third the upcoming Cloud Computing practice. Existing administrator credentials are unchanged. Browser restrictions are enabled for the available/upcoming/draft practices.

Reruns add only missing fixture records and never alter existing records, passwords, saved work or published snapshots. Natural-key collisions stop the command instead of adopting unowned records. An interrupted run can leave a partial fixture set; existing exams/activity are deliberately left alone on rerun. Inspect the summary and use ordinary admin controls to complete partially prepared exams rather than resetting data. If demo accounts exist but the private credentials file was lost, restore it; the command refuses to invent replacement passwords. No destructive cleanup command is provided.

For the demo: show Students and CSE Subjects → inspect questions and explanations as admin → inspect the released completed practices and calculated results → expand More tools for attempts/assignments/reviews → sign in as the first demo student and take Machine Learning practice. Refresh MongoDB Compass to show the same stored records.
