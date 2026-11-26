import { courseById, fields } from "./courses.ts";
import type { AppState, Requirement } from "./progress.ts";
import type { Field } from "./types.ts";

export interface LedgerLine {
  id: string;
  date: string;
  title: string;
  provider: string;
  field: Field;
  hours: number;
  source: "earned" | "logged";
  certificateId?: string;
}

export function ledgerLines(state: AppState): LedgerLine[] {
  const earned: LedgerLine[] = state.certificates.flatMap((c) => {
    const course = courseById(c.courseId);
    if (!course) return [];
    return [
      {
        id: c.id,
        date: c.issuedAt.slice(0, 10),
        title: course.title,
        provider: course.show.title,
        field: course.field,
        hours: course.credits,
        source: "earned" as const,
        certificateId: c.id,
      },
    ];
  });
  const logged: LedgerLine[] = state.logged.map((e) => ({ ...e, source: "logged" as const }));
  return [...earned, ...logged].sort((a, b) => a.date.localeCompare(b.date));
}

export interface Standing {
  inCycle: LedgerLine[];
  total: number;
  byField: Map<Field, number>;
  minimums: { field: Field; required: number; have: number }[];
  remaining: number;
  daysLeft: number;
  perWeek: number;
}

const DAY = 86_400_000;

export function standing(lines: readonly LedgerLine[], req: Requirement, today: Date): Standing {
  const inCycle = lines.filter((l) => l.date >= req.start && l.date <= req.end);
  const total = inCycle.reduce((s, l) => s + l.hours, 0);
  const byField = new Map<Field, number>();
  for (const l of inCycle) byField.set(l.field, (byField.get(l.field) ?? 0) + l.hours);
  const minimums = fields.flatMap((field) => {
    const required = req.minimums[field];
    return required ? [{ field, required, have: byField.get(field) ?? 0 }] : [];
  });
  const remaining = Math.max(0, req.target - total);
  const daysLeft = Math.max(0, Math.ceil((Date.parse(req.end) + DAY - today.getTime()) / DAY));
  const perWeek = daysLeft > 0 ? remaining / (daysLeft / 7) : remaining;
  return { inCycle, total, byField, minimums, remaining, daysLeft, perWeek };
}

export function toCsv(lines: readonly LedgerLine[]): string {
  const head = ["Date", "Title", "Provider", "Field of study", "Hours", "Source", "Certificate"];
  const cell = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
  const rows = lines.map((l) => [l.date, l.title, l.provider, l.field, l.hours, l.source, l.certificateId ?? ""].map(cell).join(","));
  return [head.map(cell).join(","), ...rows].join("\n");
}
