import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { Field } from "@base-ui/react/field";
import { Form } from "@base-ui/react/form";
import { Input } from "@base-ui/react/input";
import { Switch } from "@base-ui/react/switch";
import { useState } from "react";
import { Close, Plus } from "../../components/Icons.tsx";
import { formatDay, mytDate, parseMytDate, yearOf } from "../../domain/calendar.ts";
import { rulesetFor, type Exemption } from "../../domain/mia.ts";
import type { MemberProfile } from "../../domain/progress.ts";
import { useActions } from "../../state.tsx";
import { toasts as toast } from "../../toasts.ts";
import { saving, Sheet, Stepper } from "./parts.tsx";

/** An exemption as the form holds it: the hours MIA still asks for that year, none for a full exemption. */
interface ExemptionDraft {
  year: number | null;
  hours: number | null;
}

interface Draft {
  miaNumber: string;
  admitted: string;
  approvedAuditor: boolean;
  exemptions: ExemptionDraft[];
}

const toDraft = (p: MemberProfile): Draft => ({
  miaNumber: p.miaNumber ?? "",
  admitted: p.admitted ?? "",
  approvedAuditor: p.approvedAuditor,
  exemptions: p.exemptions.map((e) => ({ year: e.year, hours: e.scope === "full" ? 0 : e.scope.structuredMinutes / 60 })),
});

/** What is wrong with the exemptions as typed, or null. */
function exemptionsError(rows: readonly ExemptionDraft[]): string | null {
  const years = rows.map((r) => r.year);
  if (years.some((y) => y === null)) return "Give each exemption its year.";
  if (new Set(years).size !== years.length) return "A year can have one exemption.";
  const over = rows.find((r) => r.year !== null && Math.round((r.hours ?? 0) * 60) >= rulesetFor(r.year).annualStructuredMinutes);
  return over ? `An exemption asks for fewer than the usual ${rulesetFor(over.year ?? 0).annualStructuredMinutes / 60} hours.` : null;
}

const toExemptions = (rows: readonly ExemptionDraft[]): Exemption[] =>
  rows.flatMap((r) => {
    if (r.year === null) return [];
    const structuredMinutes = Math.round((r.hours ?? 0) * 60);
    return [{ year: r.year, scope: structuredMinutes > 0 ? { structuredMinutes } : "full" }];
  });

/** The member's MIA details in a line, for the foot of the standing panel. */
export function profileSummary(p: MemberProfile): string {
  const parts = [
    p.miaNumber ? `MIA member ${p.miaNumber}` : "MIA member",
    p.admitted ? `admitted ${formatDay(p.admitted)}` : "",
    p.approvedAuditor ? "approved company auditor" : "",
    p.exemptions.length ? `${p.exemptions.length} ${p.exemptions.length === 1 ? "exemption" : "exemptions"}` : "",
  ];
  return `${parts.filter(Boolean).join(", ")}.`;
}

export function ProfileDialog({ value }: { value: MemberProfile }) {
  const actions = useActions();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState(() => toDraft(value));
  const thisYear = yearOf(mytDate(new Date()));
  const admitted = d.admitted ? parseMytDate(d.admitted) : null;
  const admittedError = d.admitted && (!admitted || admitted > mytDate(new Date())) ? "Enter the date MIA admitted you." : null;
  const exemptError = exemptionsError(d.exemptions);
  const setRow = (i: number, row: ExemptionDraft) => setD({ ...d, exemptions: d.exemptions.map((x, j) => (j === i ? row : x)) });

  return (
    <Sheet
      title="Your MIA details"
      open={open}
      onOpenChange={(o) => {
        if (o) setD(toDraft(value));
        setOpen(o);
      }}
      trigger={
        <Dialog.Trigger className="textbtn" data-test="profile-edit">
          Edit MIA details
        </Dialog.Trigger>
      }
    >
      <Form
        className="sheet__form"
        onFormSubmit={() => {
          if (admittedError || exemptError) return;
          const profile: MemberProfile = { miaNumber: d.miaNumber.trim() || null, admitted, approvedAuditor: d.approvedAuditor, exemptions: toExemptions(d.exemptions) };
          void saving(actions.setProfile(profile)).then(() => toast.add({ title: "MIA details saved" }));
          setOpen(false);
        }}
      >
        <Field.Root name="miaNumber" className="field">
          <Field.Label className="label">MIA membership number (optional)</Field.Label>
          <Input className="input" value={d.miaNumber} onValueChange={(miaNumber) => setD({ ...d, miaNumber })} maxLength={20} autoComplete="off" data-test="profile-number" />
          <Field.Description className="field__hint">Printed on your certificates.</Field.Description>
        </Field.Root>
        <Field.Root name="admitted" className="field" validate={() => admittedError}>
          <Field.Label className="label">Admitted to MIA (optional)</Field.Label>
          <Input className="input" type="date" value={d.admitted} max={mytDate(new Date())} onValueChange={(v) => setD({ ...d, admitted: v })} data-test="profile-admitted" />
          <Field.Description className="field__hint">It only changes your first three years. Admitted after 30 June, your CPE starts the next year.</Field.Description>
          <Field.Error className="field__error" />
        </Field.Root>
        <Field.Root name="approvedAuditor" className="field field--switch">
          <span>
            <Field.Label className="label field__title">Approved company auditor</Field.Label>
            <Field.Description className="field__hint">At least 10 of each year's 20 hours must be on ISQM, auditing or accounting standards, or ethics.</Field.Description>
          </span>
          <Switch.Root checked={d.approvedAuditor} onCheckedChange={(approvedAuditor) => setD({ ...d, approvedAuditor })} className="switch" data-test="profile-auditor">
            <Switch.Thumb className="switch__thumb" />
          </Switch.Root>
        </Field.Root>

        <fieldset className="field exemptions">
          <legend>Exemptions MIA granted</legend>
          {d.exemptions.length === 0 && <p className="field__hint">None. Add one only when MIA's Council has granted it.</p>}
          {d.exemptions.map((row, i) => (
            <div key={i} className="exemption">
              <label className="minput">
                <span className="minput__label">Year</span>
                <Stepper label={`Year of exemption ${i + 1}`} value={row.year} onChange={(year) => setRow(i, { ...row, year })} step={1} min={2000} max={2100} plain test={`exemption-year-${i}`} />
              </label>
              <label className="minput">
                <span className="minput__label">Hours still asked</span>
                <Stepper label={`Hours still asked in exemption ${i + 1}`} value={row.hours} onChange={(hours) => setRow(i, { ...row, hours })} step={1} min={0} max={20} test={`exemption-hours-${i}`} />
              </label>
              <Button className="ghost-icon" onClick={() => setD({ ...d, exemptions: d.exemptions.filter((_, j) => j !== i) })} aria-label={`Remove exemption ${i + 1}`}>
                <Close width={16} height={16} />
              </Button>
            </div>
          ))}
          {d.exemptions.length > 0 && <p className="field__hint">0 hours is a full exemption.</p>}
          {exemptError && <p className="field__error">{exemptError}</p>}
          <Button className="textbtn" onClick={() => setD({ ...d, exemptions: [...d.exemptions, { year: thisYear, hours: 0 }] })} data-test="exemption-add">
            <Plus width={16} height={16} /> Add an exemption
          </Button>
        </fieldset>
        <Button type="submit" className="pill pill--ink sheet__submit" data-test="profile-save">
          Save
        </Button>
      </Form>
    </Sheet>
  );
}
