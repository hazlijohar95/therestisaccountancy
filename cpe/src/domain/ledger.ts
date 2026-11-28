/*
 * The member's record as MIA's rules read it. One adapter turns certificates and logged entries into the engine's
 * entries; everything the ledger shows or exports is worked out from those and from evaluate().
 */
import { daysToYearEnd, mytDate, yearOf, type MytDate } from "./calendar.ts";
import { activities, evaluate, rulesetFor, type Check, type Entry, type Standing } from "./mia.ts";
import type { AppState } from "./progress.ts";
import { itemOf } from "./subjects.ts";

/** An entry as the ledger lists it: what the engine measures, plus who ran it and where the record came from. */
export interface LedgerLine extends Entry {
  readonly organiser: string;
  /** Earned: a certificate the server issued. The others are the member's own word. */
  readonly source: "earned" | "self-reported" | "unverified";
  readonly certificateId?: string;
}

/** Every entry on the record, oldest first. A certificate counts on the Malaysian day it was issued. */
export function entriesOf(state: Pick<AppState, "certificates" | "logged" | "declared">): LedgerLine[] {
  const declared = new Set(state.declared);
  const earned: LedgerLine[] = state.certificates.map((c) => ({
    id: c.id,
    date: mytDate(new Date(c.issuedAt)),
    minutes: Math.round(c.credits * 60),
    activity: "online-course",
    tags: c.tags,
    title: c.title,
    organiser: c.provider,
    declaredToMia: declared.has(c.id),
    source: "earned",
    certificateId: c.id,
  }));
  const logged: LedgerLine[] = state.logged.map((e) => ({ ...e, declaredToMia: declared.has(e.id) }));
  return [...earned, ...logged].sort((a, b) => a.date.localeCompare(b.date));
}

/** Minutes as decimal hours, the unit MIA's portal takes: 90 is "1.5", 50 is "0.83". */
export const hours = (minutes: number): string => String(Math.round((minutes / 60) * 100) / 100);

/** The ethics part of an entry: never more than the entry itself. */
export const ethicsMinutes = (entry: Pick<Entry, "minutes" | "tags">): number => Math.min(entry.minutes, Math.max(0, entry.tags.ethics ?? 0));

/** The ledger as a spreadsheet, one row per entry, with the fields MIA's portal and a CPE audit ask for. */
export function toCsv(lines: readonly LedgerLine[]): string {
  const head = ["Date", "Title", "Organiser", "Hours", "Kind", "Appendix V item", "Ethics hours", "Certificate"];
  const cell = (v: string) => `"${v.replaceAll('"', '""')}"`;
  const rows = lines.map((l) =>
    [l.date, l.title, l.organiser, hours(l.minutes), activities[l.activity].kind, itemOf(l.activity), hours(ethicsMinutes(l)), l.certificateId ?? ""].map(cell).join(","),
  );
  return [head.map(cell).join(","), ...rows].join("\n");
}

/** The years the ledger can show: every year with an entry, and the current one, newest first. */
export const yearsOf = (lines: readonly Entry[], today: MytDate): number[] => [...new Set([yearOf(today), ...lines.map((l) => yearOf(l.date))])].sort((a, b) => b - a);

export const standingOf = (state: AppState, year: number): Standing => evaluate(entriesOf(state), state.profile, year);

/** The year's structured check, the one figure the app's rings show. Null when the year asks nothing of the member. */
export function structuredOf(standing: Standing): Check | null {
  return standing.status === "required" ? (standing.checks.find((c) => c.id === "structured") ?? null) : null;
}

/** A check in plain words. The rolling checks name the years they span. */
export function checkName(check: Pick<Check, "id">, year: number): string {
  const window = `${year - rulesetFor(year).rolling.years + 1}–${year}`;
  switch (check.id) {
    case "structured":
      return `Structured learning in ${year}`;
    case "ethics":
      return "Ethics, within those hours";
    case "auditor":
      return "Auditing, standards or ethics, as an approved auditor";
    case "rolling-structured":
      return `Structured learning, ${window}`;
    case "rolling-total":
      return `All learning, ${window}`;
    default:
      return check.id;
  }
}

const short = (check: Check | undefined): number => (check ? Math.max(0, check.need - check.have) : 0);

/** Minutes in words: whole hours where they are whole, otherwise to the minute, so a few minutes short never reads as none. */
export function span(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return h === 1 ? "1 hour" : `${h} hours`;
  return h === 0 ? `${m} min` : `${h} h ${m} min`;
}

export interface Headline {
  readonly status: "covered" | "short" | "not-required" | "exempt";
  /** The one answer: "2026: covered", or what is left. */
  readonly title: string;
  /** "34 days to 31 December", while the year is open and short. */
  readonly deadline: string | null;
  /** What else the member should know, a sentence each. */
  readonly notes: readonly string[];
}

/**
 * The one answer the ledger opens on. "Covered" is the engine's verdict, never worked out again here. What is left for
 * the year is the largest of its shortfalls, not their sum: an ethics hour is also a structured hour.
 */
export function headline(standing: Standing, year: number, today: MytDate): Headline {
  if (standing.status === "not-required") {
    return { status: "not-required", title: `${year}: nothing required`, deadline: null, notes: [`MIA counts your CPE from ${standing.from}, the first year after your admission that it asks for hours.`] };
  }
  if (standing.status === "exempt") return { status: "exempt", title: `${year}: exempt`, deadline: null, notes: ["MIA exempted you for this year, so it asks for no hours."] };

  const of = (id: string) => standing.checks.find((c) => c.id === id);
  const current = year === yearOf(today);
  const notes: string[] = [];

  const window = `${year - rulesetFor(year).rolling.years + 1}–${year}`;
  const rollingStructured = short(of("rolling-structured"));
  const rollingTotal = short(of("rolling-total"));
  if (rollingStructured > 0) notes.push(`${span(rollingStructured)} of structured learning short across ${window}.`);
  if (rollingTotal > rollingStructured) notes.push(`${span(rollingTotal)} short in all across ${window}. Reading and discussion count towards this.`);
  const undeclared = standing.undeclared.length;
  if (undeclared > 0) notes.push(`${undeclared} ${undeclared === 1 ? "entry is" : "entries are"} not yet in the MIA portal${current ? `, which closes for ${year} on 31 December` : ""}.`);

  if (standing.met) return { status: "covered", title: `${year}: covered`, deadline: null, notes };

  const left = Math.max(0, ...standing.checks.filter((c) => !c.id.startsWith("rolling-")).map(short));
  if (left === 0) return { status: "short", title: `${year}: this year's hours are met`, deadline: null, notes };

  const ethics = short(of("ethics"));
  const auditor = short(of("auditor"));
  const verb = current ? "left" : "short";
  const parts = [...(ethics > 0 ? [`${span(ethics)} of ethics`] : []), ...(auditor > 0 ? [`${span(auditor)} for your audit licence`] : [])];
  const title =
    ethics === left && auditor === 0
      ? `${span(left)} of ethics ${verb}`
      : auditor === left && ethics === 0
        ? `${span(left)} ${verb} for your audit licence`
        : parts.length > 0
          ? `${span(left)} ${verb}, including ${parts.join(" and ")}`
          : `${span(left)} ${verb}`;
  const days = daysToYearEnd(today);
  return {
    status: "short",
    title,
    deadline: current ? `${days} ${days === 1 ? "day" : "days"} to 31 December` : null,
    notes,
  };
}
