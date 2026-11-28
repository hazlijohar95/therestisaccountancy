import { Button } from "@base-ui/react/button";
import { Meter } from "@base-ui/react/meter";
import { useState } from "react";
import { Close, Download } from "../components/Icons.tsx";
import { Ring } from "../components/Ring.tsx";
import { formatDay, mytDate, yearOf } from "../domain/calendar.ts";
import { checkName, entriesOf, ethicsMinutes, headline, hours, span, structuredOf, toCsv, yearsOf, type LedgerLine } from "../domain/ledger.ts";
import { activities, evaluate, type Capped, type Check } from "../domain/mia.ts";
import { activityNames, itemOf } from "../domain/subjects.ts";
import { Link } from "../router.tsx";
import { useActions, useAppState } from "../state.tsx";
import { toasts as toast } from "../toasts.ts";
import { Declare } from "./ledger/Declare.tsx";
import { LogDialog } from "./ledger/LogDialog.tsx";
import { PortalTick, saving } from "./ledger/parts.tsx";
import { ProfileDialog, profileSummary } from "./ledger/ProfileDialog.tsx";

export function Ledger() {
  const state = useAppState();
  const actions = useActions();
  const today = mytDate(new Date());
  const [picked, setPicked] = useState<number | null>(null);
  const lines = entriesOf(state);
  const years = yearsOf(lines, today);
  const year = picked !== null && years.includes(picked) ? picked : yearOf(today);
  const standing = evaluate(lines, state.profile, year);
  const answer = headline(standing, year, today);
  const structured = structuredOf(standing);
  const inYear = lines.filter((l) => yearOf(l.date) === year);
  const required = standing.status === "required" ? standing : null;
  const undeclared = inYear.filter((l) => required?.undeclared.includes(l.id));
  const setDeclared = (id: string, declared: boolean) => void saving(actions.setDeclared(id, declared));

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([toCsv(lines)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `cpe-ledger-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const remove = (line: LedgerLine) => {
    const entry = state.logged.find((e) => e.id === line.id);
    void saving(actions.unlog(line.id));
    if (!entry || entry.source !== "self-reported") return;
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
  };

  return (
    <div className="view">
      <header className="libhead">
        <h1 className="pagetitle">My CPE</h1>
        <div className="row">
          <Button className="pill pill--ghost" onClick={exportCsv} disabled={lines.length === 0} data-test="export">
            <Download width={18} height={18} /> Export CSV
          </Button>
          <LogDialog />
        </div>
      </header>

      {years.length > 1 && (
        <nav className="years" aria-label="Year">
          {years.map((y) => (
            <Button key={y} className={`years__year${y === year ? " years__year--on" : ""}`} aria-current={y === year ? "true" : undefined} onClick={() => setPicked(y)} data-test={`year-${y}`}>
              {y}
            </Button>
          ))}
        </nav>
      )}

      <section className="standing" data-status={answer.status}>
        <div className="standing__main">
          {structured && (
            <Ring slices={[{ value: Math.min(structured.have, structured.need), tone: "var(--cpe)" }]} total={structured.need} size={148} stroke={14}>
              <span className="standing__total" data-test="ledger-total">
                {hours(structured.have)}
              </span>
              <span className="tnum muted">of {hours(structured.need)} h</span>
            </Ring>
          )}
          <div className="standing__info">
            <p className="label">MIA CPE · {year}</p>
            <h2 className="answer" data-test="answer">
              {answer.title}
            </h2>
            {answer.deadline && <p className="answer__deadline">{answer.deadline}</p>}
            {answer.notes.map((note) => (
              <p key={note} className="answer__note">
                {note}
              </p>
            ))}
          </div>
        </div>
        {required &&
          [false, true].map((rolling) => (
            <div key={String(rolling)} className="standing__mins">
              {required.checks
                .filter((c) => c.id.startsWith("rolling-") === rolling)
                .map((c) => (
                  <CheckMeter key={c.id} check={c} year={year} />
                ))}
            </div>
          ))}
        <div className="standing__foot">
          <span className="muted">{profileSummary(state.profile)}</span>
          <ProfileDialog value={state.profile} />
        </div>
      </section>

      {undeclared.length > 0 && <Declare lines={undeclared} year={year} open={year === yearOf(today)} onDeclared={setDeclared} />}

      <section className="shelf">
        <h2 className="label">Entries in {year}</h2>
        {inYear.length === 0 ? (
          <div className="empty">
            <p className="lead">No entries in {year}.</p>
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
                  <th>Kind</th>
                  <th className="num">Hours</th>
                  <th>Record</th>
                  <th>In MIA portal</th>
                </tr>
              </thead>
              <tbody>
                {inYear.map((l) => (
                  <Row key={l.id} line={l} capped={required?.capped.find((c) => c.entryId === l.id)} onDeclared={setDeclared} onRemove={remove} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="fineprint">Progress is saved to your club account. Sample course credits are not accredited.</div>
    </div>
  );
}

function CheckMeter({ check, year }: { check: Check; year: number }) {
  const met = check.have >= check.need;
  return (
    <Meter.Root value={Math.min(check.have, check.need)} max={check.need} className="minimum" data-test={`check-${check.id}`}>
      <Meter.Label className="minimum__label">
        {checkName(check, year)}
        <span className={`tnum ${met ? "minimum__met" : "muted"}`}>
          {hours(check.have)} / {hours(check.need)} h
        </span>
      </Meter.Label>
      <Meter.Track className="meter">
        <Meter.Indicator className="meter__fill" />
      </Meter.Track>
      <span className="minimum__source">
        {met ? "Met" : `${span(check.need - check.have)} to go`} · {check.source}
      </span>
    </Meter.Root>
  );
}

function Row({ line, capped, onDeclared, onRemove }: { line: LedgerLine; capped: Capped | undefined; onDeclared: (id: string, declared: boolean) => void; onRemove: (line: LedgerLine) => void }) {
  const ethics = ethicsMinutes(line);
  const rule = activities[line.activity];
  return (
    <tr>
      <td className="tnum ledger__date">{formatDay(line.date, "short")}</td>
      <td className="ledger__what">
        <span className="ledger__title">{line.title}</span>
        <span className="muted">{line.organiser}</span>
      </td>
      <td className="ledger__kind">
        {activityNames[line.activity]}
        <span className="outside">
          {rule.kind === "structured" ? "Structured" : "Unstructured"} · {itemOf(line.activity)}
        </span>
      </td>
      <td className="num tnum ledger__hours" data-label="Hours">
        {hours(line.minutes)}
        {ethics > 0 && <span className="outside">of which ethics {hours(ethics)}</span>}
        {capped && (
          <span className="outside ledger__cap">
            {hours(capped.credited)} of these count · {capped.source}
          </span>
        )}
      </td>
      <td className="ledger__record">
        {line.certificateId ? (
          <Link href={`/certificate/${line.certificateId}`} className="tag tag--ink">
            Certificate
          </Link>
        ) : (
          <span className="logged">
            <span className="tag" title={line.source === "unverified" ? "A certificate this browser made before accounts. It was never checked, so it counts as your own record." : "Logged by you."}>
              {line.source === "unverified" ? "Unverified" : "Logged"}
            </span>
            <Button className="ghost-icon ghost-icon--sm" onClick={() => onRemove(line)} aria-label={`Remove ${line.title}`} data-test="remove-entry">
              <Close width={16} height={16} />
            </Button>
          </span>
        )}
      </td>
      <td className="ledger__portal" data-label="In MIA portal">
        {rule.kind === "structured" ? <PortalTick checked={line.declaredToMia} onChange={(checked) => onDeclared(line.id, checked)} title={line.title} /> : <span className="muted">Not declared</span>}
      </td>
    </tr>
  );
}
