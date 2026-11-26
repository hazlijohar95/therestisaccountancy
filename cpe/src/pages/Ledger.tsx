import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { Field } from "@base-ui/react/field";
import { Form } from "@base-ui/react/form";
import { Input } from "@base-ui/react/input";
import { Meter } from "@base-ui/react/meter";
import { NumberField } from "@base-ui/react/number-field";
import { Select } from "@base-ui/react/select";
import { useState, type ReactNode } from "react";
import { Check, Close, Download, Plus } from "../components/Icons.tsx";
import { Ring } from "../components/Ring.tsx";
import { fields, formatHours } from "../domain/courses.ts";
import { ledgerLines, standing, toCsv } from "../domain/ledger.ts";
import type { Requirement } from "../domain/progress.ts";
import type { Field as FieldOfStudy } from "../domain/types.ts";
import { Link } from "../router.tsx";
import { useActions, useAppState } from "../state.tsx";
import { toasts as toast } from "../toasts.ts";

const FIELD_TONE: Record<FieldOfStudy, string> = {
  Ethics: "var(--color-redline)",
  Accounting: "var(--field-accounting)",
  Auditing: "var(--color-ink)",
  Taxation: "var(--color-redline-dark)",
  "Practice Management": "var(--color-tape)",
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Runs a ledger change on the server and says so if it fails. */
const saving = (work: Promise<void>) =>
  work.catch((e: unknown) => {
    toast.add({ title: "Not saved", description: e instanceof Error ? e.message : "Try again." });
  });

export function Ledger() {
  const state = useAppState();
  const actions = useActions();
  const lines = ledgerLines(state);
  const s = standing(lines, state.requirement, new Date());
  const req = state.requirement;
  const pct = req.target ? Math.min(1, s.total / req.target) : 0;

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([toCsv(lines)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `cpe-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  let running = 0;
  return (
    <div className="view">
      <header className="libhead">
        <h1 className="pagetitle">Ledger</h1>
        <div className="row">
          <Button className="pill pill--ghost" onClick={exportCsv} disabled={lines.length === 0} data-test="export">
            <Download width={18} height={18} /> Export CSV
          </Button>
          <LogDialog />
        </div>
      </header>

      <section className="standing">
        <div className="standing__main">
          <Ring slices={fields.map((f) => ({ value: s.byField.get(f) ?? 0, tone: FIELD_TONE[f] }))} total={req.target} size={176} stroke={18}>
            <span className="standing__total" data-test="ledger-total">
              {formatHours(s.total)}
            </span>
            <span className="mono muted">of {formatHours(req.target)}h</span>
          </Ring>
          <div className="standing__info">
            <p className="eyebrow">
              {fmtDate(req.start)} – {fmtDate(req.end)}
            </p>
            {s.total === 0 ? (
              <p className="muted">No hours yet this cycle.</p>
            ) : (
              <ul className="legend">
                {fields
                  .filter((f) => s.byField.get(f))
                  .map((f) => (
                    <li key={f}>
                      <i style={{ background: FIELD_TONE[f] }} />
                      {f} {formatHours(s.byField.get(f) ?? 0)}h
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>
        <div className="standing__side">
          <div className="kv">
            <span className="label">Still to earn</span>
            <span className="kv__v">{formatHours(s.remaining)}h</span>
          </div>
          <div className="kv">
            <span className="label">Days left</span>
            <span className="kv__v">{s.daysLeft}</span>
          </div>
          <div className="kv">
            <span className="label">Pace needed</span>
            <span className="kv__v">{s.remaining ? `${formatHours(s.perWeek)}h / wk` : "Done"}</span>
          </div>
        </div>
        {s.minimums.length > 0 && (
          <div className="standing__mins">
            {s.minimums.map((m) => (
              <Meter.Root key={m.field} value={Math.min(m.have, m.required)} max={m.required} className="minimum">
                <Meter.Label className="minimum__label">
                  {m.field} minimum{" "}
                  <span className="mono muted">
                    {formatHours(m.have)} / {formatHours(m.required)}h
                  </span>
                </Meter.Label>
                <Meter.Track className="meter">
                  <Meter.Indicator className={`meter__fill${m.have >= m.required ? " is-met" : ""}`} />
                </Meter.Track>
              </Meter.Root>
            ))}
          </div>
        )}
        <div className="standing__foot">
          <span className="muted">
            {req.isExample ? (
              <>
                <strong className="example">Example requirement.</strong> Set the cycle, target and minimums your professional body
                requires.
              </>
            ) : (
              `${pct >= 1 ? "Target met for this cycle." : `${Math.round(pct * 100)}% of your target.`} Rules set by you.`
            )}
          </span>
          <RequirementDialog value={req} />
        </div>
      </section>

      <section className="shelf">
        <h2 className="label">Entries</h2>
        {lines.length === 0 ? (
          <div className="empty">
            <p className="lead">No entries yet.</p>
            <p className="muted">Passed courses post here on their own.</p>
            <Link className="pill pill--ink" href="/home">
              Find a course
            </Link>
          </div>
        ) : (
          <div className="tablewrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Field</th>
                  <th>Source</th>
                  <th className="num">Hours</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  running += l.hours;
                  const outside = l.date < req.start || l.date > req.end;
                  return (
                    <tr key={l.id}>
                      <td className="mono">
                        {l.date}
                        {outside && <span className="outside">Outside cycle</span>}
                      </td>
                      <td>
                        <span className="ledger__title">{l.title}</span>
                        <span className="muted">{l.provider}</span>
                      </td>
                      <td>{l.field}</td>
                      <td>
                        {l.source === "earned" && l.certificateId ? (
                          <Link href={`/certificate/${l.certificateId}`} className="tag tag--ink">
                            Certificate
                          </Link>
                        ) : (
                          <span className="logged">
                            <span className="tag" title={l.source === "unverified" ? "A certificate this browser made before accounts. It was never checked, so it counts as your own record." : "Logged by you."}>
                              {l.source === "unverified" ? "Unverified" : "Logged"}
                            </span>
                          <Button
                            className="ghost-icon ghost-icon--sm"
                            onClick={() => {
                              const entry = state.logged.find((e) => e.id === l.id);
                              void saving(actions.unlog(l.id));
                              if (entry && entry.source === "self-reported") {
                                const { id: _id, source: _source, ...again } = entry;
                                const id = toast.add({
                                  title: "Entry removed",
                                  description: entry.title,
                                  timeout: 0,
                                  actionProps: {
                                    children: "Undo",
                                    onClick: () => {
                                      void saving(actions.log(again));
                                      toast.close(id);
                                    },
                                  },
                                });
                              }
                            }}
                            aria-label={`Remove ${l.title}`}
                            data-test="remove-entry"
                          >
                            <Close width={16} height={16} />
                          </Button>
                          </span>
                        )}
                      </td>
                      <td className="num mono" data-label="Hours">
                        {formatHours(l.hours)}
                      </td>
                      <td className="num mono" data-label="Balance">
                        {formatHours(running)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>In this cycle</td>
                  <td className="num mono total">{formatHours(s.total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
      <div className="fineprint">
        Progress is saved to your club account. Sample course credits are not accredited.
      </div>
    </div>
  );
}

/** A Base UI dialog shell shared by the ledger forms. */
function Sheet({ trigger, title, open, onOpenChange, children }: { trigger: ReactNode; title: string; open: boolean; onOpenChange: (o: boolean) => void; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger}
      <Dialog.Portal>
        <Dialog.Backdrop className="backdrop" />
        <Dialog.Viewport className="dialog-viewport">
          <Dialog.Popup className="sheet">
            <div className="sheet__head">
              <Dialog.Title className="sheet__title">{title}</Dialog.Title>
              <Dialog.Close className="ghost-icon" aria-label="Close">
                <Close />
              </Dialog.Close>
            </div>
            {children}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FieldOfStudySelect({ value, onChange }: { value: FieldOfStudy; onChange: (f: FieldOfStudy) => void }) {
  return (
    <Select.Root
      value={value}
      onValueChange={(v) => {
        const f = fields.find((x) => x === v);
        if (f) onChange(f);
      }}
    >
      <Select.Trigger className="input select" data-test="log-field">
        <Select.Value />
        <Select.Icon className="select__icon">▾</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={6} alignItemWithTrigger={false} className="menu-positioner">
          <Select.Popup className="menu">
            <Select.List>
              {fields.map((f) => (
                <Select.Item key={f} value={f} className="menu__item">
                  <Select.ItemText>{f}</Select.ItemText>
                  <Select.ItemIndicator className="menu__tick">
                    <Check width={16} height={16} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function Hours({ label, value, onChange, step = 0.5, min = 0, test }: { label: string; value: number | null; onChange: (v: number | null) => void; step?: number; min?: number; test?: string }) {
  return (
    <NumberField.Root value={value} onValueChange={onChange} min={min} step={step} className="numfield">
      <NumberField.Group className="numfield__group">
        <NumberField.Decrement className="numfield__btn" aria-label={`Decrease ${label}`}>
          −
        </NumberField.Decrement>
        <NumberField.Input className="numfield__input" data-test={test} />
        <NumberField.Increment className="numfield__btn" aria-label={`Increase ${label}`}>
          +
        </NumberField.Increment>
      </NumberField.Group>
    </NumberField.Root>
  );
}

function LogDialog() {
  const actions = useActions();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [field, setField] = useState<FieldOfStudy>("Accounting");
  const [hours, setHours] = useState<number | null>(1);

  const submit = () => {
    if (!title.trim() || !hours || hours <= 0) return;
    const entry = { title: title.trim(), provider: provider.trim() || "Self-reported", date, field, hours };
    void saving(actions.log(entry)).then(() => toast.add({ title: `${formatHours(hours)}h logged`, description: entry.title }));
    setTitle("");
    setProvider("");
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
        <Field.Root name="title" className="field" validate={(v) => (typeof v === "string" && v.trim() ? null : "Say what it was.")}>
          <Field.Label className="label">What was it?</Field.Label>
          <Input className="input" value={title} onValueChange={setTitle} placeholder="Year-end tax seminar" required data-test="log-title" />
          <Field.Error className="field__error" />
        </Field.Root>
        <Field.Root name="provider" className="field">
          <Field.Label className="label">Provider (optional)</Field.Label>
          <Input className="input" value={provider} onValueChange={setProvider} placeholder="Self-reported" />
        </Field.Root>
        <div className="sheet__row">
          <Field.Root name="date" className="field">
            <Field.Label className="label">Date</Field.Label>
            <Input className="input" type="date" value={date} onValueChange={setDate} required />
          </Field.Root>
          <Field.Root name="hours" className="field" validate={() => (hours !== null && hours >= 0.5 ? null : "Enter at least 0.5 hours.")}>
            <Field.Label className="label">Hours</Field.Label>
            <Hours label="hours" value={hours} onChange={setHours} step={0.5} min={0.5} test="log-hours" />
            <Field.Error className="field__error" />
          </Field.Root>
        </div>
        <Field.Root name="field" className="field">
          <Field.Label className="label" nativeLabel={false} render={<div />}>
            Field of study
          </Field.Label>
          <FieldOfStudySelect value={field} onChange={setField} />
        </Field.Root>
        <Button type="submit" className="pill pill--cpe sheet__submit" data-test="log-submit">
          Add to ledger
        </Button>
      </Form>
    </Sheet>
  );
}

function RequirementDialog({ value }: { value: Requirement }) {
  const actions = useActions();
  const [open, setOpen] = useState(false);
  const [r, setR] = useState(value);

  return (
    <Sheet
      title="Your requirement"
      open={open}
      onOpenChange={(o) => {
        if (o) setR(value);
        setOpen(o);
      }}
      trigger={
        <Dialog.Trigger className="textbtn" data-test="req-edit">
          {value.isExample ? "Set your requirement" : "Edit requirement"}
        </Dialog.Trigger>
      }
    >
      <Form
        className="sheet__form"
        onFormSubmit={() => {
          if (r.end < r.start) return;
          const { isExample: _example, ...own } = r;
          void saving(actions.setRequirement(own)).then(() => toast.add({ title: "Requirement saved", description: `${formatHours(r.target)}h by ${fmtDate(r.end)}` }));
          setOpen(false);
        }}
      >
        <div className="sheet__row">
          <Field.Root name="start" className="field">
            <Field.Label className="label">Cycle starts</Field.Label>
            <Input className="input" type="date" value={r.start} onValueChange={(v) => setR({ ...r, start: v })} required />
          </Field.Root>
          <Field.Root name="end" className="field" validate={(v) => (typeof v === "string" && v < r.start ? "Choose an end date after the start date." : null)}>
            <Field.Label className="label">Cycle ends</Field.Label>
            <Input className="input" type="date" value={r.end} onValueChange={(v) => setR({ ...r, end: v })} required />
            <Field.Error className="field__error" />
          </Field.Root>
        </div>
        <Field.Root name="target" className="field">
          <Field.Label className="label">Target hours</Field.Label>
          <Hours label="target hours" value={r.target} onChange={(v) => setR({ ...r, target: v ?? 0 })} step={1} test="req-target" />
        </Field.Root>
        <p className="label">Minimums by field</p>
        <div className="mins">
          {fields.map((f) => (
            <Field.Root key={f} name={`min-${f}`} className="field">
              <Field.Label className="minput__label">{f}</Field.Label>
              <Hours label={`${f} minimum`} value={r.minimums[f] ?? null} onChange={(v) => setR({ ...r, minimums: { ...r.minimums, [f]: v ?? undefined } })} />
            </Field.Root>
          ))}
        </div>
        <Button type="submit" className="pill pill--ink sheet__submit" data-test="req-save">
          Save
        </Button>
      </Form>
    </Sheet>
  );
}
