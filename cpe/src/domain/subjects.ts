/*
 * How the app's own words map onto MIA's: a course's field of study to the tag its minutes carry, a version's
 * segments to minutes per tag, and the names of tags and activities as a member reads them.
 */
import { activities, type Activity, type Tag } from "./mia.ts";
import type { CourseScript, Field, Timing } from "./types.ts";

export type TagMinutes = Readonly<Partial<Record<Tag, number>>>;

export const tagNames: Readonly<Record<Tag, string>> = {
  ethics: "Ethics",
  isqm: "ISQM",
  "auditing-standards": "Auditing standards",
  "accounting-standards": "Accounting standards",
  tax: "Tax",
  practice: "Practice",
  technology: "Technology",
  other: "Other",
};

export const isTag = (value: string): value is Tag => Object.hasOwn(tagNames, value);
export const tags: readonly Tag[] = Object.keys(tagNames).filter(isTag);

/** Each Appendix V item in a few words, after the summaries in docs/mia-cpe.md. The item number is shown beside it. */
export const activityNames: Readonly<Record<Activity, string>> = {
  "online-course": "Online course or webinar",
  course: "Course or conference",
  postgraduate: "Postgraduate study",
  writing: "Writing",
  lecturing: "Lecturing on a structured course",
  "lecturing-repeat": "Lecturing, a repeat presentation",
  committee: "Committee meeting of MIA or a recognised body",
  agm: "AGM or members' dialogue",
  standards: "Developing standards",
  "care-mentor": "CARE mentoring",
  speaking: "Speaking",
  reading: "Reading technical or business literature",
  discussion: "Meeting or discussion group not run by MIA",
};

export const isActivity = (value: string): value is Activity => Object.hasOwn(activityNames, value);
export const activityList: readonly Activity[] = Object.keys(activityNames).filter(isActivity);

/** "1(i)": the Appendix V item as MIA numbers it, without the document's name. */
export const itemOf = (activity: Activity): string => activities[activity].item.replace("Appendix V ", "");

/** The tag a course's minutes carry unless a segment says otherwise. */
export const defaultTag: Readonly<Record<Field, Tag>> = {
  Ethics: "ethics",
  Auditing: "auditing-standards",
  Accounting: "accounting-standards",
  Taxation: "tax",
  "Practice Management": "practice",
};

/** A whole credit under its field's default tag: how anything recorded before tagged minutes is read. */
export const wholeUnder = (field: Field, minutes: number): TagMinutes => ({ [defaultTag[field]]: minutes });

/**
 * The credited minutes of a course version, split by tag in proportion to the audio each tag's segments take. Parts
 * are whole minutes and sum to the credit: each tag gets its share rounded down, and the minutes left over go to the
 * largest remainders. Without timings the whole credit sits under the course's default tag.
 */
export function tagMinutes(script: Pick<CourseScript, "field" | "credits" | "segments">, timing: Timing | null): TagMinutes {
  const minutes = Math.round(script.credits * 60);
  const seconds = new Map<Tag, number>();
  if (timing && timing.segments.length === script.segments.length) {
    script.segments.forEach((segment, i) => {
      const { start, end } = timing.segments[i]!;
      const tag = segment.tag ?? defaultTag[script.field];
      seconds.set(tag, (seconds.get(tag) ?? 0) + Math.max(0, end - start));
    });
  }
  const total = [...seconds.values()].reduce((sum, s) => sum + s, 0);
  if (total <= 0) return wholeUnder(script.field, minutes);

  const shares = tags.flatMap((tag) => {
    const exact = ((seconds.get(tag) ?? 0) / total) * minutes;
    return exact > 0 ? [{ tag, whole: Math.floor(exact), rest: exact - Math.floor(exact) }] : [];
  });
  let spare = minutes - shares.reduce((sum, s) => sum + s.whole, 0);
  for (const share of [...shares].sort((a, b) => b.rest - a.rest)) {
    if (spare <= 0) break;
    share.whole += 1;
    spare -= 1;
  }
  return Object.fromEntries(shares.filter((s) => s.whole > 0).map((s) => [s.tag, s.whole]));
}
