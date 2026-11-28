/*
 * MIA's CPE requirement (By-Laws section B110 and Appendix V) as data, and one pure function that measures a member's
 * learning against it. Shared by the server and the app. docs/mia-cpe.md gives the source of every rule and the
 * defaults we chose where MIA is silent.
 */
import { yearOf, type MytDate } from "./calendar.ts";

/** What learning was about. An entry carries minutes per tag, so one hour can be part ethics and part tax. */
export type Tag = "ethics" | "isqm" | "auditing-standards" | "accounting-standards" | "tax" | "practice" | "technology" | "other";

/** The Appendix V item an activity falls under. */
export type Activity =
  | "online-course"
  | "course"
  | "postgraduate"
  | "writing"
  | "lecturing"
  | "lecturing-repeat"
  | "committee"
  | "agm"
  | "standards"
  | "care-mentor"
  | "speaking"
  | "reading"
  | "discussion";

export type Kind = "structured" | "unstructured";

interface ActivityRule {
  readonly kind: Kind;
  readonly item: string;
  /** False for the two items Appendix V says cannot meet an approved auditor's 10 hours. */
  readonly auditor: boolean;
}

export const activities: Readonly<Record<Activity, ActivityRule>> = {
  "online-course": { kind: "structured", item: "Appendix V 1(i)", auditor: true },
  course: { kind: "structured", item: "Appendix V 1(a)–(c), (g), (h)", auditor: true },
  postgraduate: { kind: "structured", item: "Appendix V 1(e), (f)", auditor: true },
  writing: { kind: "structured", item: "Appendix V 1(j)", auditor: true },
  lecturing: { kind: "structured", item: "Appendix V 1(k)", auditor: true },
  "lecturing-repeat": { kind: "structured", item: "Appendix V 1(k)", auditor: true },
  committee: { kind: "structured", item: "Appendix V 1(l), (n)", auditor: true },
  agm: { kind: "structured", item: "Appendix V 1(m)", auditor: false },
  standards: { kind: "structured", item: "Appendix V 1(o)", auditor: true },
  "care-mentor": { kind: "structured", item: "Appendix V 1(p), B110.13", auditor: false },
  speaking: { kind: "structured", item: "Appendix V 1(q)", auditor: true },
  reading: { kind: "unstructured", item: "Appendix V 2(a)", auditor: false },
  discussion: { kind: "unstructured", item: "Appendix V 2(c)", auditor: false },
};

/** One piece of learning, in whole minutes, dated by the Malaysian day it was completed. */
export interface Entry {
  readonly id: string;
  readonly date: MytDate;
  readonly minutes: number;
  readonly activity: Activity;
  /** Minutes per tag. A tag's minutes count only up to the minutes the entry is credited with. */
  readonly tags: Readonly<Partial<Record<Tag, number>>>;
  /** Names the activity for the standards cap, which is per activity per cycle. */
  readonly title: string;
  /** The member has entered it in the MIA portal. */
  readonly declaredToMia: boolean;
}

/** An exemption MIA's Council granted. We record it; we never decide one. */
export interface Exemption {
  readonly year: number;
  readonly scope: "full" | { readonly structuredMinutes: number };
}

export interface Profile {
  /** The day MIA admitted the member, or null for a member admitted long enough ago that it no longer matters. */
  readonly admitted: MytDate | null;
  readonly approvedAuditor: boolean;
  readonly exemptions: readonly Exemption[];
}

/**
 * A limit on what activities can earn, pooled per `entry` (each alone), per calendar `year`, or per `title` within the
 * window. A limit is fixed minutes, or a share of that year's structured minimum.
 */
interface Cap {
  readonly per: "entry" | "year" | "title";
  readonly activities: readonly Activity[];
  readonly limit: { readonly minutes: number } | { readonly share: number };
  readonly source: string;
}

/** A minimum inside the year's structured minutes, met by structured minutes carrying any of its tags. */
interface Within {
  readonly id: string;
  readonly minutes: number;
  readonly tags: readonly Tag[];
  readonly source: string;
}

/** MIA's rules as they stand from the calendar year `from` until the next ruleset. */
export interface Ruleset {
  readonly from: number;
  readonly annualStructuredMinutes: number;
  readonly rolling: { readonly years: number; readonly totalMinutes: number; readonly structuredMinutes: number };
  readonly within: readonly Within[];
  readonly auditor: { readonly minutes: number; readonly tags: readonly Tag[] };
}

const base = {
  annualStructuredMinutes: 1200,
  rolling: { years: 3, totalMinutes: 7200, structuredMinutes: 3600 },
  auditor: { minutes: 600, tags: ["isqm", "auditing-standards", "accounting-standards", "ethics"] },
} as const satisfies Omit<Ruleset, "from" | "within">;

/**
 * Appendix V's limits, unchanged since 2014. Applied in order, so a narrower cap comes before the cap it sits inside.
 * A year cap is a share of that year's structured minimum: our reading of "the minimum CPE credit hours".
 */
const caps: readonly Cap[] = [
  { per: "entry", activities: ["committee", "agm"], limit: { minutes: 120 }, source: "Appendix V 1(l)–(n)" },
  { per: "year", activities: ["care-mentor"], limit: { minutes: 240 }, source: "Appendix V 1(p), B110.13" },
  { per: "year", activities: ["lecturing-repeat"], limit: { share: 0.3 }, source: "Appendix V 1(k)" },
  { per: "year", activities: ["lecturing", "lecturing-repeat"], limit: { share: 0.5 }, source: "Appendix V 1(k)" },
  { per: "title", activities: ["standards"], limit: { minutes: 600 }, source: "Appendix V 1(o)" },
];

/** Every ruleset, oldest first. A change to MIA's rules is a new entry here. */
export const rulesets: readonly Ruleset[] = [
  { ...base, from: 2017, within: [] },
  { ...base, from: 2026, within: [{ id: "ethics", minutes: 120, tags: ["ethics"], source: "B110.4, Circular 15/2025" }] },
];

/** The ruleset in force in a year. Older By-Laws are not modelled: a year before the first ruleset is measured by it. */
export const rulesetFor = (year: number): Ruleset => rulesets.findLast((r) => r.from <= year) ?? rulesets[0]!;

/** Tags some check counts. A capped pool pays entries carrying them first, so a cap never costs a member those checks. */
const counted: ReadonlySet<Tag> = new Set(rulesets.flatMap((r) => [...r.auditor.tags, ...r.within.flatMap((w) => w.tags)]));
const countedMinutes = (e: Entry) => [...counted].reduce((sum, tag) => sum + Math.max(0, e.tags[tag] ?? 0), 0);

/** B110.4(a)(b): admitted by 30 June, CPE starts that year; admitted later, it starts the next. */
export function firstYear(profile: Profile): number {
  if (!profile.admitted) return Number.NEGATIVE_INFINITY;
  const year = yearOf(profile.admitted);
  return profile.admitted.slice(5) <= "06-30" ? year : year + 1;
}

/** The structured minutes a year asks of the member: none before CPE starts or when exempt, less when partly exempt. */
function annualTarget(profile: Profile, year: number): number {
  if (year < firstYear(profile)) return 0;
  const exemption = profile.exemptions.find((e) => e.year === year);
  if (exemption?.scope === "full") return 0;
  return exemption ? exemption.scope.structuredMinutes : rulesetFor(year).annualStructuredMinutes;
}

export interface Capped {
  readonly entryId: string;
  readonly claimed: number;
  readonly credited: number;
  readonly source: string;
}

const payFirst = (a: Entry, b: Entry) => countedMinutes(b) - countedMinutes(a) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

/** The minutes each entry earns once every cap has had its say. */
function credit(entries: readonly Entry[]): { credited: Map<string, number>; capped: Capped[] } {
  const credited = new Map(entries.map((e) => [e.id, Math.max(0, Math.floor(e.minutes))]));
  const limitedBy = new Map<string, string>();
  const limit = (e: Entry, to: number, source: string) => {
    if (to >= (credited.get(e.id) ?? 0)) return;
    credited.set(e.id, to);
    limitedBy.set(e.id, source);
  };
  for (const cap of caps) {
    const pools = new Map<string, Entry[]>();
    for (const e of [...entries].sort(payFirst)) {
      if (!cap.activities.includes(e.activity)) continue;
      const key = cap.per === "entry" ? e.id : cap.per === "year" ? String(yearOf(e.date)) : e.title.trim().toLowerCase();
      pools.set(key, [...(pools.get(key) ?? []), e]);
    }
    for (const pool of pools.values()) {
      let left = "share" in cap.limit ? Math.floor(rulesetFor(yearOf(pool[0]!.date)).annualStructuredMinutes * cap.limit.share) : cap.limit.minutes;
      for (const e of pool) {
        const earned = Math.min(credited.get(e.id) ?? 0, left);
        left -= earned;
        limit(e, earned, cap.source);
      }
    }
  }
  const capped = entries.flatMap((e) => {
    const source = limitedBy.get(e.id);
    return source ? [{ entryId: e.id, claimed: e.minutes, credited: credited.get(e.id) ?? 0, source }] : [];
  });
  return { credited, capped };
}

export interface Check {
  /** "structured", "auditor", "rolling-total", "rolling-structured", or a within id such as "ethics". */
  readonly id: string;
  readonly have: number;
  readonly need: number;
  readonly source: string;
}

export type Standing =
  | { readonly status: "not-required"; readonly from: number }
  | { readonly status: "exempt" }
  | {
      readonly status: "required";
      readonly met: boolean;
      readonly checks: readonly Check[];
      readonly capped: readonly Capped[];
      /** Structured entries of the year not yet entered in the MIA portal, which closes on 31 December. */
      readonly undeclared: readonly string[];
    };

/** Where a member stands for one calendar year: the year's own minimums, and the rolling window that ends with it. */
export function evaluate(entries: readonly Entry[], profile: Profile, year: number): Standing {
  const start = firstYear(profile);
  if (year < start) return { status: "not-required", from: start };
  const target = annualTarget(profile, year);
  if (target === 0) return { status: "exempt" };

  const rules = rulesetFor(year);
  const windowStart = year - rules.rolling.years + 1;
  const inWindow = entries.filter((e) => yearOf(e.date) >= windowStart && yearOf(e.date) <= year);
  const { credited, capped } = credit(inWindow);
  const minutes = (e: Entry) => credited.get(e.id) ?? 0;
  const structured = (e: Entry) => activities[e.activity].kind === "structured";
  const tagged = (e: Entry, tags: readonly Tag[]) => Math.min(minutes(e), tags.reduce((sum, tag) => sum + Math.max(0, e.tags[tag] ?? 0), 0));
  const sum = (list: readonly Entry[], of: (e: Entry) => number) => list.reduce((total, e) => total + of(e), 0);

  const thisYear = inWindow.filter((e) => yearOf(e.date) === year);
  const structuredThisYear = thisYear.filter(structured);

  /* Our default where MIA is silent: the window asks for each of its years' structured targets, and twice that in all. */
  let windowTarget = 0;
  for (let y = windowStart; y <= year; y++) windowTarget += annualTarget(profile, y);
  const ratio = rules.rolling.totalMinutes / rules.rolling.structuredMinutes;

  const checks: Check[] = [
    { id: "structured", have: sum(structuredThisYear, minutes), need: target, source: "B110.4" },
    ...rules.within.map((w) => ({ id: w.id, have: sum(structuredThisYear, (e) => tagged(e, w.tags)), need: w.minutes, source: w.source })),
    ...(profile.approvedAuditor
      ? [{ id: "auditor", have: sum(structuredThisYear.filter((e) => activities[e.activity].auditor), (e) => tagged(e, rules.auditor.tags)), need: rules.auditor.minutes, source: "B110.4, Appendix V" }]
      : []),
    { id: "rolling-total", have: sum(inWindow, minutes), need: windowTarget * ratio, source: "B110.4" },
    { id: "rolling-structured", have: sum(inWindow.filter(structured), minutes), need: windowTarget, source: "B110.4" },
  ];

  return {
    status: "required",
    met: checks.every((c) => c.have >= c.need),
    checks,
    capped: capped.filter((c) => thisYear.some((e) => e.id === c.entryId)),
    undeclared: structuredThisYear.filter((e) => !e.declaredToMia).map((e) => e.id),
  };
}
