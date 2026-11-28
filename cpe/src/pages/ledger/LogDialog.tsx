import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { Field } from "@base-ui/react/field";
import { Form } from "@base-ui/react/form";
import { Input } from "@base-ui/react/input";
import { Select } from "@base-ui/react/select";
import { useState } from "react";
import { Check, Plus } from "../../components/Icons.tsx";
import { mytDate, parseMytDate } from "../../domain/calendar.ts";
import { span } from "../../domain/ledger.ts";
import { activities, type Activity, type Kind } from "../../domain/mia.ts";
import { activityList, activityNames, isActivity, itemOf } from "../../domain/subjects.ts";
import { useActions, useAppState } from "../../state.tsx";
import { toasts as toast } from "../../toasts.ts";
import { saving, Sheet, Stepper } from "./parts.tsx";

const GROUPS: readonly { kind: Kind; label: string }[] = [
  { kind: "structured", label: "Structured" },
  { kind: "unstructured", label: "Unstructured" },
];

function ActivitySelect({ value, onChange }: { value: Activity; onChange: (a: Activity) => void }) {
  return (
    <Select.Root value={value} onValueChange={(v) => typeof v === "string" && isActivity(v) && onChange(v)}>
      <Select.Trigger className="input select" data-test="log-activity">
        <Select.Value>{(v: unknown) => (typeof v === "string" && isActivity(v) ? activityNames[v] : "")}</Select.Value>
        <Select.Icon className="select__icon">▾</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={6} alignItemWithTrigger={false} className="menu-positioner">
          <Select.Popup className="menu menu--tall">
            <Select.List>
              {GROUPS.map((group) => (
                <Select.Group key={group.kind}>
                  <Select.GroupLabel className="menu__group">{group.label}</Select.GroupLabel>
                  {activityList
                    .filter((a) => activities[a].kind === group.kind)
                    .map((a) => (
                      <Select.Item key={a} value={a} className="menu__item">
                        <span className="menu__text">
                          <Select.ItemText>{activityNames[a]}</Select.ItemText>
                          <span className="menu__hint">Appendix V {itemOf(a)}</span>
                        </span>
                        <Select.ItemIndicator className="menu__tick">
                          <Check width={16} height={16} />
                        </Select.ItemIndicator>
                      </Select.Item>
                    ))}
                </Select.Group>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

const minutesOf = (hours: number | null) => Math.round((hours ?? 0) * 60);

export function LogDialog() {
  const actions = useActions();
  const auditor = useAppState().profile.approvedAuditor;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [organiser, setOrganiser] = useState("");
  const [date, setDate] = useState<string>(() => mytDate(new Date()));
  const [activity, setActivity] = useState<Activity>("course");
  const [hours, setHours] = useState<number | null>(1);
  const [ethics, setEthics] = useState<number | null>(null);
  const [standards, setStandards] = useState<number | null>(null);

  const today = mytDate(new Date());
  const minutes = minutesOf(hours);
  const parts = minutesOf(ethics) + (auditor ? minutesOf(standards) : 0);
  const partsError = parts > minutes ? "These cannot add up to more than the hours above." : null;

  const submit = () => {
    const day = parseMytDate(date);
    if (!title.trim() || !organiser.trim() || !day || day > today || minutes < 1 || partsError) return;
    const entry = {
      title: title.trim(),
      organiser: organiser.trim(),
      date: day,
      activity,
      minutes,
      tags: {
        ...(minutesOf(ethics) > 0 ? { ethics: minutesOf(ethics) } : {}),
        ...(auditor && minutesOf(standards) > 0 ? { "auditing-standards": minutesOf(standards) } : {}),
      },
    };
    void saving(actions.log(entry)).then(() => toast.add({ title: `${span(minutes)} logged`, description: entry.title }));
    setTitle("");
    setOrganiser("");
    setEthics(null);
    setStandards(null);
    setOpen(false);
  };

  return (
    <Sheet
      title="Log CPE"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Dialog.Trigger className="pill pill--ink" data-test="log-open">
          <Plus width={18} height={18} /> Log CPE
        </Dialog.Trigger>
      }
    >
      <Form className="sheet__form" onFormSubmit={submit}>
        <Field.Root name="activity" className="field">
          <Field.Label className="label" nativeLabel={false} render={<div />}>
            What kind of learning?
          </Field.Label>
          <ActivitySelect value={activity} onChange={setActivity} />
          {activities[activity].kind === "unstructured" && <Field.Description className="field__hint">Unstructured learning counts towards the 120 hours over three years, not the 20 a year.</Field.Description>}
        </Field.Root>
        <Field.Root name="title" className="field" validate={(v) => (typeof v === "string" && v.trim() ? null : "Say what it was.")}>
          <Field.Label className="label">Title</Field.Label>
          <Input className="input" value={title} onValueChange={setTitle} placeholder="Year-end tax seminar" required data-test="log-title" />
          <Field.Error className="field__error" />
        </Field.Root>
        <Field.Root name="organiser" className="field" validate={(v) => (typeof v === "string" && v.trim() ? null : "MIA's portal asks who ran it.")}>
          <Field.Label className="label">Organiser</Field.Label>
          <Input className="input" value={organiser} onValueChange={setOrganiser} placeholder="Who ran it, or who published it" required data-test="log-organiser" />
          <Field.Error className="field__error" />
        </Field.Root>
        <div className="sheet__row">
          <Field.Root name="date" className="field" validate={(v) => (typeof v === "string" && v > today ? "Log it once it has happened." : null)}>
            <Field.Label className="label">Date</Field.Label>
            <Input className="input" type="date" value={date} max={today} onValueChange={setDate} required />
            <Field.Error className="field__error" />
          </Field.Root>
          <Field.Root name="hours" className="field" validate={() => (minutes >= 1 ? null : "Enter the hours it took.")}>
            <Field.Label className="label">Hours</Field.Label>
            <Stepper label="Hours" value={hours} onChange={setHours} step={0.5} min={0} max={100} test="log-hours" />
            <Field.Error className="field__error" />
          </Field.Root>
        </div>
        <div className="sheet__row">
          <Field.Root name="ethics" className="field" validate={() => partsError}>
            <Field.Label className="label">Of which ethics hours</Field.Label>
            <Stepper label="Ethics hours" value={ethics} onChange={setEthics} step={0.5} min={0} max={100} test="log-ethics" />
            <Field.Error className="field__error" />
          </Field.Root>
          {auditor && (
            <Field.Root name="standards" className="field" validate={() => partsError}>
              <Field.Label className="label">Of which ISQM, auditing or accounting standards hours</Field.Label>
              <Stepper label="ISQM, auditing or accounting standards hours" value={standards} onChange={setStandards} step={0.5} min={0} max={100} test="log-standards" />
              <Field.Error className="field__error" />
            </Field.Root>
          )}
        </div>
        <Button type="submit" className="pill pill--cpe sheet__submit" data-test="log-submit">
          Add to My CPE
        </Button>
      </Form>
    </Sheet>
  );
}
