import { Button } from "@base-ui/react/button";
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Arrow, Download } from "../components/Icons.tsx";
import { Logo } from "../components/Logo.tsx";
import { formatDay, mytDate } from "../domain/calendar.ts";
import { formatHours } from "../domain/courses.ts";
import { itemOf } from "../domain/subjects.ts";
import { Link } from "../router.tsx";
import { useAppState } from "../state.tsx";
import { NotFound } from "./NotFound.tsx";

export function CertificatePage({ id }: { id: string }) {
  const state = useAppState();
  const cert = state.certificates.find((c) => c.id === id);
  // Printed from the public register, not just this account's copy: what anyone checking the id will see.
  const [registered, setRegistered] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    api("GET /api/verify/:id", { params: { id } }).then(
      () => live && setRegistered(true),
      () => live && setRegistered(false),
    );
    return () => {
      live = false;
    };
  }, [id]);
  if (!cert) return <NotFound />;
  const verifyAt = `${location.origin}/verify/${cert.id}`;
  const issued = formatDay(mytDate(new Date(cert.issuedAt)));
  const ethics = cert.tags.ethics ?? 0;

  return (
    <div className="page certpage">
      <div className="certpage__bar noprint">
        <Link href="/ledger" className="pill pill--ghost">
          My CPE
        </Link>
        <Button className="pill pill--ink" onClick={() => window.print()} data-test="print">
          <Download /> Save as PDF
        </Button>
      </div>
      <article className="cert">
        <div className="cert__watermark" aria-hidden>
          SAMPLE
        </div>
        <header className="cert__head">
          <Logo />
          <span className="tnum">Certificate of completion</span>
        </header>
        <p className="cert__certify">This certifies that</p>
        <h1 className="cert__name">{cert.name || state.learner || "Learner"}</h1>
        {state.profile.miaNumber && (
          <p className="cert__member tnum" data-test="cert-mia">
            MIA membership no. {state.profile.miaNumber}
          </p>
        )}
        <p className="cert__certify">has completed</p>
        <h2 className="cert__course">{cert.title}</h2>
        <dl className="cert__grid">
          <div>
            <dt>Credit</dt>
            <dd>
              {formatHours(cert.credits)} hours
              {ethics > 0 && <span className="cert__part">of which ethics: {ethics} min</span>}
            </dd>
          </div>
          <div><dt>Field of study</dt><dd>{cert.field}</dd></div>
          <div><dt>Level</dt><dd>{cert.level}</dd></div>
          <div>
            <dt>Appendix V item</dt>
            <dd>
              {itemOf("online-course")}
              <span className="cert__part">Online learning, assessed</span>
            </dd>
          </div>
          <div><dt>Assessment</dt><dd>{cert.correct}/{cert.total} · passed</dd></div>
          <div><dt>Completed</dt><dd>{issued}</dd></div>
        </dl>
        <footer className="cert__foot">
          <div>
            <span className="cert__sig">{cert.provider}</span>
            <span className="tnum">Programme</span>
          </div>
          <div className="cert__stamp" aria-hidden>
            <span>Passed</span>
          </div>
          <div className="cert__id">
            <span className="tnum">{cert.id}</span>
            <span className="tnum">Certificate ID</span>
          </div>
        </footer>
        <p className="cert__fine">
          Sample course. Not accredited and not valid for regulatory CPE. {registered === false ? "Not yet on the public register; reload in a moment. " : ""}Check this certificate at{" "}
          <a href={verifyAt} data-test="verify-link">
            {verifyAt.replace(/^https?:\/\//, "")}
          </a>
          .
        </p>
      </article>
      <div className="noprint certpage__next">
        <Link href="/home" className="textbtn">
          Find your next course <Arrow />
        </Link>
      </div>
    </div>
  );
}
