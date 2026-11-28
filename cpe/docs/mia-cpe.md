# CPE for MIA members: rules and design

Status: design, not built. The sources were read on 27 November 2026.

Every rule below carries its source:

- **[By-Laws]** The text of the MIA By-Laws (On Professional Ethics, Conduct and Practice), updated January 2026, cited by paragraph. These are binding.
- **[MIA web]** Guidance on mia.org.my. It explains the By-Laws but is not the By-Laws. Where the two differ, the By-Laws win. MIA's surveillance page still shows the Appendix V from before December 2024 and still says "ISQC 1".
- **[Ours]** A choice we make where MIA says nothing. Each one is conservative, and each is on the list of questions for MIA.

## 1. What MIA requires

| # | Rule | Source |
|---|---|---|
| R1 | At least 120 CPE credit hours of relevant learning in every rolling period of 3 calendar years. | By-Laws B110.4 |
| R2 | Of those, 60 must be structured and verifiable. | B110.4 |
| R3 | At least 20 structured and verifiable hours in each calendar year. | B110.4 |
| R4 | No carry-over: extra structured hours in one year do not count towards another year's 20. | B110.4 |
| R5 | From 1 January 2026, at least 2 of each year's 20 structured hours must relate to professional ethics. | B110.4, Circular 15/2025 |
| R6 | Approved company auditors: at least 10 of each year's 20 structured hours must relate to ISQM 1, approved auditing standards, approved accounting standards or professional ethics. AGMs and members' dialogues (App. V 1(m)) and CARE mentoring (1(p)) do not count towards these 10. | B110.4, App. V |
| R7 | Members admitted from 1 January to 30 June start CPE in their year of admission. Members admitted from 1 July to 31 December start the next calendar year. The By-Laws say nothing about pro-rating. | B110.4(a)(b) |
| R8 | Learning must be relevant to the member's current and future work. | B110.2 |
| R9 | Members keep records of compliance and produce the evidence if MIA asks. No retention period is stated. | B110.7, B110.8 |
| R10 | MIA audits a random sample of members each year. | B110.6, MIA web |
| R11 | The Council may grant a temporary or partial exemption, for illness or any other reason it accepts. Members apply within 30 days of being selected for audit, and the Council's decision is final. | B110.9–B110.12 |
| R12 | Exemption categories: aged 60+ and retired; homemaker; caregiver for more than 12 months; unemployed for more than 12 months; illness, with a medical report. Holders of a practising certificate or audit licence, directors of a PLC or PIE, and anyone providing professional services cannot apply. | MIA web |
| R13 | Members record each external activity in the MIA portal ("Add External CPE Hours": event date, course title, organiser, duration) and make the online CPE Declaration, both by 31 December. A late declaration is a common audit finding. | MIA web, Accountants Today 2022 |
| R14 | A practising certificate is renewed only if the previous year's CPE was met. | MIA web |
| R15 | Audit licence renewal checks the three preceding years. | Accountants Today 2021 (secondary source) |
| R16 | Lecturing on a structured course counts for at most 50% of "the minimum CPE credit hours". Repeat presentations count for at most 30%. | App. V 1(k) |
| R17 | Committee meetings of MIA or the recognised bodies: at most 2 hours per meeting. AGMs and members' dialogues: at most 2 hours each. CARE mentoring: 4 hours for a year. Developing standards: at most 10 hours per activity per cycle. Speaking: 1 hour of training is 1 credit hour. | App. V 1(l)–(q), B110.13 |
| R18 | Ethics topics include the Code of Ethics and By-Laws updates, independence, conflicts of interest, anti-bribery, anti-money-laundering, whistleblowing, business ethics and codes of conduct. The list is not exhaustive. | MIA web (ethics FAQ Q4) |
| R19 | The ethics part of a broader programme counts if the programme content clearly states that part and how long it lasts. | MIA web (ethics FAQ Q6) |
| R20 | Unstructured learning: reading technical, professional, financial or business literature, and relevant meetings or discussion groups not run by MIA or a recognised body. The item for "audio tapes ... where no participation is required" was deleted on 15 December 2024. | App. V 2 |

## 2. Does our course count as structured and verifiable?

On the By-Laws text, it probably does, and it does not need accreditation first. This corrects the earlier business read, which said the credit counts only once a body recognises it.

- **Structured:** Appendix V 1(i) accepts "structured webinars and on-line learnings that are relevant or related to the accountancy profession, which require participation by the member". It names no accredited organiser, unlike 1(a)–(c). MIA's ethics FAQ (Q9) also counts "formal home study or distance learning courses requiring participation and assessment". Our courses require participation (review questions stop playback) and assessment (the quiz).
- **Verifiable:** MIA lists "certificates of attendance" and "assessment reports" as evidence (ethics FAQ Q9). We issue both, and a public register lets anyone check them.
- **The risk:** MIA's FAQ for its own events says "Listening to pre-recorded webinar and/or reading from past webinar e-material shall not qualify as structured CPE credit hours." That rule concerns MIA's events and passive replays, not a course with assessment. An auditor could still apply it to us. This is the one question to put to MIA in writing before we market the hours as structured.
- **Our bar against MIA's:** For its own webinars, MIA wants 80% of the time logged in plus a learning-outcome evaluation within 3 days. We require 95% of the audio heard, every review question answered and a passed assessment.

Until MIA confirms in writing, keep the product's "not accredited" wording. Change it to "structured and verifiable under Appendix V 1(i)" only with that confirmation in hand.

Plain listening is not counted. The audio item was deleted from Appendix V in 2024, so an episode heard with no assessment is not a category we count by default.

## 3. Model

Each entry is a fact. The rules are data. One pure function, shared by server and app, compares the two. The project already follows this pattern in `src/domain/rules.ts`.

```ts
/** A Malaysian calendar date, "YYYY-MM-DD", taken in Asia/Kuala_Lumpur. Never derived from a UTC ISO string. */
type MytDate = string & { readonly __myt: unique symbol };

/** What learning was about. One entry carries several tags, each with its own minutes. */
type Tag = "ethics" | "isqm" | "auditing-standards" | "accounting-standards" | "tax" | "practice" | "technology" | "other";

/** The Appendix V item an activity falls under. It decides the kind, the caps and the auditor exclusions. */
type Activity =
  | "online-course"     // 1(i): our courses
  | "course"            // 1(a)–(c), (g), (h): courses and conferences
  | "postgraduate"      // 1(e), (f)
  | "writing"           // 1(j)
  | "lecturing" | "lecturing-repeat" // 1(k)
  | "committee"         // 1(l), (n)
  | "agm"               // 1(m)
  | "standards"         // 1(o)
  | "care-mentor"       // 1(p)
  | "speaking"          // 1(q)
  | "reading" | "discussion"; // 2(a), (c): unstructured

interface Entry {
  readonly id: string;
  readonly date: MytDate;            // completion date: the date the certificate was issued
  readonly minutes: number;          // an integer; never fractional hours
  readonly activity: Activity;
  readonly tags: Partial<Record<Tag, number>>; // minutes per tag, summing to at most `minutes`
  readonly title: string;
  readonly organiser: string;
  readonly source: "earned" | "logged";       // earned: our certificate; logged: the member's own record
  readonly evidence: { readonly certificateId: string } | { readonly fileKey: string } | null;
  readonly declaredToMia: boolean;   // the member ticked it once entered in the MIA portal
}

interface Profile {
  readonly admitted: MytDate | null; // MIA admission date; null means "long-standing member"
  readonly approvedAuditor: boolean;
  readonly practisingCertificate: boolean;
  readonly exemptions: readonly { readonly year: number; readonly scope: "full" | { readonly structuredMinutes: number } }[]; // as granted by MIA; we never decide one
  readonly miaNumber: string | null; // printed on certificates
}

/** One version of MIA's rules, in force from the first calendar year it applies to. */
interface Ruleset {
  readonly from: number;
  readonly rolling: { readonly years: 3; readonly totalMinutes: 7200; readonly structuredMinutes: 3600 };
  readonly annualStructuredMinutes: 1200;
  /** Minimums inside the annual structured hours: ethics from 2026; a sustainability minimum would be one more row. */
  readonly within: readonly { readonly id: string; readonly minutes: number; readonly tags: readonly Tag[] }[];
  readonly auditor: { readonly minutes: 600; readonly tags: readonly Tag[]; readonly excluded: readonly Activity[] };
  readonly caps: RulesetCaps; // R16, R17
}
```

The rulesets are a list: `[{ from: 2017, within: [] }, { from: 2026, within: [{ id: "ethics", minutes: 120, tags: ["ethics"] }] }]`. Each year is evaluated under the ruleset in force that year. A rule change becomes one new row plus the tests for it.

## 4. Evaluation

`evaluate(entries, profile, rulesets, year)` returns the checks for one calendar year. Each check has an id, a label, the minutes the member has, the minutes needed and its source.

1. **Start year.** CPE starts in the year of admission if admitted by 30 June, otherwise the next year (R7). Before that, return "not yet required".
2. **Exemption.** A full exemption returns "exempt". A partial one replaces the annual target (R11).
3. **Year.** Count the year's entries by their MYT date.
4. **Caps.** Apply the per-item caps (R16, R17) before summing. When an entry is capped, the check shows which cap applied.
5. **Annual checks:**
   - structured minutes ≥ 1200 (R3)
   - for each `within` row, tagged structured minutes ≥ its minutes (R5)
   - if `approvedAuditor`, tagged structured minutes on activities not in `excluded` ≥ 600 (R6)
6. **Rolling checks.** For the window from year−2 to year: all minutes ≥ 7200 (R1) and structured minutes ≥ 3600 (R2). Structured minutes count towards both. A member who meets 20 structured hours every year meets R2 automatically. The 120 can then come from any mix of structured and unstructured hours, so nobody needs 60 unstructured hours.
7. **Overlap.** One minute of ethics in a structured course counts towards the 2, the 20, the auditor's 10, the 60 and the 120 at once. The checks are filters over tagged minutes, never buckets that consume hours.

Planning reads the same result. "What next" is the check with the largest shortfall relative to the days left. Ethics first, if it is missing.

## 5. Where MIA is silent: our defaults

| Question | Default | Why |
|---|---|---|
| What is one credit hour of online learning? | 60 minutes of course content at 1×, rounded down to the nearest 30 minutes. Assessment time is not counted. | App. V 1(q) sets 1 hour of training as 1 credit hour. Rounding down never overstates. |
| Playback speed | Credit needs real listening time of at least 80% of the content length, so credit-bearing playback effectively tops out at 1.25×. Faster playback still plays; the assessment just opens later. | MIA's own webinars require 80% of the time logged in. A course "done" in half its length is hard to defend at audit. |
| A course repeated in a later year | Credit once per course per member. A substantially new edition (next year's tax update) is a new course with a new id, not a new version. | Repeating the same content is hard to argue is relevant learning (R8). |
| The rolling 120 in a member's first years, and around exemptions | The window asks for the sum of its years' structured targets as structured hours, and twice that in all. A full member gets exactly 60 and 120. A new member's first year asks for 20 and 40. A fully exempt year adds nothing, and a partly exempt year adds its reduced target. | The By-Laws start the requirement (R7) but do not say how a 3-year window applies before 3 years exist, or around an exemption. One rule covers both. |
| "50% of the minimum CPE credit hours" for lecturing | 50% of the 20 annual structured hours: at most 10 hours a year, or 6 for repeat presentations. | The smallest reading. A wider one would overstate. |
| How long records are kept | For good. The public register keeps certificates forever, and the ledger stays readable and exportable after paid membership ends. | Audits sample members, and the audit year is not limited (R9). Locking someone's compliance record behind a subscription is a risk to them and to our trust. |
| Which entries a pooled cap (lecturing, CARE, standards) pays first | Entries carrying ethics or auditor-relevant minutes first, then the earliest. | The total is the same either way. This order never costs a member a minimum they would otherwise meet. |
| Years before 2017 | Measured by the 2017 rules. | Older By-Laws aren't modelled, and only a window reaching back past 2017 needs them. |
| Which calendar day a completion falls on | The MYT date when the assessment is passed. | MIA's year is the Malaysian calendar year. |
| Who decides whether something is relevant (R8) | The member, for logged entries. We tag our own courses. | Relevance depends on the member's role, which we cannot verify. |

## 6. Edge cases (each row becomes a test)

| Case | Input | Expected |
|---|---|---|
| Admitted mid-year (first half) | Admitted 2026-06-30, evaluate 2026 | 20 structured hours and 2 ethics hours required in 2026 |
| Admitted mid-year (second half) | Admitted 2026-07-01, evaluate 2026 | Not required in 2026; required from 2027 |
| Ethics before 2026 | 2025, 20 structured hours, 0 ethics | Compliant |
| Ethics from 2026 | 2026, 20 structured hours, 0 ethics | Short 2 ethics hours, even though 20 hours are met |
| Ethics inside a broader course | One 1.5-hour course tagged 30 ethics minutes | 1.5 hours towards the 20, 0.5 towards the ethics 2 |
| No carry-over | 2026: 30 structured hours; 2027: 12 structured hours | 2027 is short 8 structured hours. The extra 10 from 2026 still count towards the rolling 120 and 60. |
| Rolling total | 2024: 40, 2025: 40, 2026: 30 hours, each year ≥ 20 structured | Short 10 hours on the 2024–2026 window |
| Structured counts towards the total | 3 years of 40 structured hours, no unstructured | Compliant on every check |
| Midnight on New Year's Eve | Pass at 2026-12-31T16:30Z (00:30 on 1 January in MYT) | Counts in 2027 |
| Last minute of the year | Pass at 2026-12-31T15:59Z (23:59 on 31 December in MYT) | Counts in 2026 |
| Auditor's 10 hours | Approved auditor, 20 structured hours of which 8 are ISQM, auditing or ethics | Short 2 auditor hours |
| An AGM for the auditor's 10 | Auditor logs a 2-hour AGM tagged ethics | Counts towards the 20, not the auditor's 10 |
| Lecturing cap | Logs 14 hours of lecturing | 10 hours count; the check says the cap applied |
| Committee cap | One meeting logged as 3 hours | 2 hours count |
| A new version mid-course | The member heard 60% of version 3, then version 4 is published | They stay on version 3 until certified (current behaviour) |
| Same course twice | Certified in 2026, takes it again in 2027 | No second credit |
| Full exemption | Exemption granted for 2026 | 2026 shows "exempt"; the 2024–2026 rolling check excludes 2026's requirement |
| Partial exemption | 2026 target reduced to 10 hours | Annual check against 10; ethics 2 still applies unless the exemption says otherwise |
| Membership lapses | Club membership ends in March 2027 | Ledger and certificates stay readable and exportable, and the register still verifies them. No new courses. |
| Name changes | The member changes their name after certification | The certificate keeps its issued name. A corrected certificate replaces it on the register, which marks the old one superseded. |
| Late December | 25 December, 16 structured hours | Shows 4 hours left, the courses that fill it, and the 31 December portal deadline |
| Not yet declared | Compliant, 3 entries not ticked as entered in the MIA portal | Prompts to declare before 31 December |

## 7. The experience

- **One answer first.** The ledger opens on "2026: covered" or "4 hours left, 2 of them ethics, 34 days". The rolling window comes second. A member should never have to do the sum themselves.
- **The next course fills the gap.** Suggestions are ordered by the check with the largest shortfall.
- **Handing over to MIA.** A "Declare to MIA" view lists each entry with the four portal fields (event date, title, organiser, duration). Each field has a copy button and each entry a tick for "entered". Reminders go out on 1 October, 1 December and 15 December, and only to members who are short or have undeclared entries.
- **Audit pack.** One button builds a year's certificates, the ledger and the verify links as one PDF. It is ready for the day MIA's sample picks the member, and it reminds them of the 30-day exemption window (R11).
- **Onboarding: three questions.** When were you admitted to MIA? Are you an approved company auditor? Do you hold a practising certificate? Each can be left as "not sure", which uses the strictest default.
- **The certificate shows what an auditor checks:** name and MIA number, course, organiser, completion date (MYT), credit hours, any ethics or auditor-relevant minutes, assessment score, Appendix V item, and the verify URL.

## 8. What changes in the current code

Built: the rules engine (`src/domain/mia.ts`, tested in `mia.test.ts`), and Malaysian calendar dates (`src/domain/calendar.ts`). Every date that decides a CPE year (the ledger, certificate ids, the example requirement, legacy imports, the Studio's publish date) and every certificate date shown on screen now uses them.

Wired since:

- `Requirement` and `exampleRequirement` are gone. A member has a `MemberProfile` (`src/domain/progress.ts`), and the ledger, the rings and the CSV all read `evaluate` through one adapter, `entriesOf` (`src/domain/ledger.ts`).
- A segment can carry a `tag`. A version's credited minutes are split by tag in proportion to its segments' audio (`tagMinutes` in `src/domain/subjects.ts`), and a certificate keeps that split from the day it is issued.
- `LoggedEntry` carries `activity`, `minutes` and `tags`. Which entries are in the MIA portal is kept apart, as a set of entry ids, so a certificate can be ticked too.

Not yet wired:

- Credits are still set by the author. Deriving them from the segments' timed lengths, and refusing a course whose credit does not match its audio, waits for full-length audio.
- `src/domain/rules.ts`: `MAX_RATE = 2` sets the heard-time budget. Credit needs the 80% real-time rule from section 5.
- Logged entries have no `evidence` yet.
- `Profile.practisingCertificate` and the onboarding questions.
- The member identity check: the ledger and certificates must stay readable without paid access.

## 9. Questions for MIA (ask in writing)

1. Does a pre-recorded online course with in-course questions and a passed assessment count as structured and verifiable under Appendix V 1(i)? How does that square with the FAQ line on pre-recorded webinars?
2. How is one credit hour of self-paced online learning measured: by content length, or by time spent? What playback speed is acceptable?
3. Does MIA endorse providers under Appendix V 1(a), and how do we apply?
4. How does the rolling 120-hour rule apply in a member's first two years?
5. In 1(k), what does "the minimum CPE credit hours" refer to: the annual 20, or the rolling figures?
6. How long must members keep CPE evidence?
7. Is the 2-hour sustainability minimum within the 20 confirmed, and from when? A third-party blog describes it as a draft; we found no MIA text.

## Sources

- [MIA By-Laws, updated January 2026, effective 15 December 2026](https://mia.org.my/box/2026/01/By-Laws-updated-Jan-2026-%E2%80%93-Effective-15-December-2026-1.pdf): Section B110 (pp. 473–475) and Appendix V (pp. 491–492)
- [Circular 15/2025: change to CPE requirements](https://mia.org.my/box/2025/03/Circular-15-2025.pdf)
- [MIA CPE compliance](https://mia.org.my/regulatory-public-interest/surveillance/cpe-compliance/)
- [MIA CPE FAQ](https://mia.org.my/faq/cpe/): the ethics FAQ, and the rules for crediting MIA's own events
- [Accountants Today: CPE Compliance Audit, 2022](https://www.at-mia.my/2022/11/21/cpe-compliance-audit-are-you-prepared/)
- [Accountants Today: CPE, what you need to know, 2021](https://www.at-mia.my/2021/05/07/continuing-professional-education-what-you-need-to-know/)
- [Accountants Today: CPE exemptions, 2024](https://www.at-mia.my/2024/04/19/navigating-continuing-professional-education-compliance-and-exemptions-a-guide-for-professional-accountants/)
- Not found: the text of Circular 23/2024, which deleted Appendix V items 1(d) and 2(b).
