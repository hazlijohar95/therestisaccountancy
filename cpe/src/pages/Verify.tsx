import { useEffect, useState } from "react";
import { api, Refused } from "../api.ts";
import { Check } from "../components/Icons.tsx";
import type { Verified } from "../domain/api.ts";
import { formatHours } from "../domain/courses.ts";

/** The public check of a certificate id, for anyone a member shows their certificate to. No sign-in. */
export function VerifyPage({ id }: { id: string }) {
  const [result, setResult] = useState<Verified | "missing" | "error" | null>(null);
  useEffect(() => {
    let live = true;
    api<Verified>("GET", `/api/verify/${encodeURIComponent(id)}`).then(
      (v) => live && setResult(v),
      (e: unknown) => live && setResult(e instanceof Refused && e.status === 404 ? "missing" : "error"),
    );
    return () => {
      live = false;
    };
  }, [id]);

  if (result === null) return <div className="page narrow" aria-busy="true" />;
  if (result === "missing" || result === "error") {
    return (
      <div className="page narrow" data-test="verify-missing">
        <p className="eyebrow">Certificate check · {id}</p>
        <h1 className="display">{result === "missing" ? "Not found." : "Couldn’t check."}</h1>
        <p className="lead">
          {result === "missing"
            ? "No certificate with this id was issued by CPE · The Rest Is Accountancy. Check the id against the certificate."
            : "The check didn’t go through. Reload the page to try again."}
        </p>
      </div>
    );
  }
  const issued = new Date(result.issuedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="page narrow" data-test="verify-ok">
      <p className="eyebrow">Certificate check · {result.id}</p>
      <h1 className="display">Genuine.</h1>
      <div className="posted" role="status">
        <Check /> Issued by CPE · The Rest Is Accountancy
      </div>
      <ul className="ledgerlist">
        <li><span>Issued to</span><span>{result.name}</span></li>
        <li><span>Course</span><span>{result.title}</span></li>
        <li><span>Credit</span><span className="mono">{formatHours(result.credits)} hours</span></li>
        <li><span>Field of study</span><span>{result.field}</span></li>
        <li><span>Completed</span><span>{issued}</span></li>
      </ul>
      <p className="muted">Sample course. Not accredited and not valid for regulatory CPE.</p>
    </div>
  );
}
