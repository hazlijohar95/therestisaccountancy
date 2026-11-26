import { Button } from "@base-ui/react/button";
import { Arrow, Download } from "../components/Icons.tsx";
import { Logo } from "../components/Logo.tsx";
import { courseById, formatHours } from "../domain/courses.ts";
import { Link } from "../router.tsx";
import { useAppState } from "../state.tsx";
import { NotFound } from "./NotFound.tsx";

export function CertificatePage({ id }: { id: string }) {
  const state = useAppState();
  const cert = state.certificates.find((c) => c.id === id);
  const course = cert ? courseById(cert.courseId) : undefined;
  if (!cert || !course) return <NotFound />;
  const issued = new Date(cert.issuedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="page certpage">
      <div className="certpage__bar noprint">
        <Link href="/ledger" className="pill pill--ghost">
          Ledger
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
          <span className="mono">Certificate of completion</span>
        </header>
        <p className="cert__certify">This certifies that</p>
        <h1 className="cert__name">{cert.name || state.learner || "Learner"}</h1>
        <p className="cert__certify">has completed</p>
        <h2 className="cert__course">{course.title}</h2>
        <dl className="cert__grid">
          <div><dt>Credit</dt><dd>{formatHours(course.credits)} hours</dd></div>
          <div><dt>Field of study</dt><dd>{course.field}</dd></div>
          <div><dt>Level</dt><dd>{course.level}</dd></div>
          <div><dt>Delivery</dt><dd>Self-study, audio</dd></div>
          <div><dt>Assessment</dt><dd>{cert.correct}/{cert.total} · passed</dd></div>
          <div><dt>Completed</dt><dd>{issued}</dd></div>
        </dl>
        <footer className="cert__foot">
          <div>
            <span className="cert__sig">{course.show.title}</span>
            <span className="mono">Programme</span>
          </div>
          <div className="cert__stamp" aria-hidden>
            <span>Passed</span>
          </div>
          <div className="cert__id">
            <span className="mono">{cert.id}</span>
            <span className="mono">Certificate ID</span>
          </div>
        </footer>
        <p className="cert__fine">
          Prototype certificate for a sample course. Not accredited and not valid for regulatory CPE.
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
