import wordmark from "../assets/tria-wordmark.svg?raw";

/** The club wordmark, inlined unaltered so it inherits colour and survives print, locked up with the CPE sub-brand tag. */
export function Logo({ tag = true }: { tag?: boolean }) {
  return (
    <span className="lockup">
      <span className="lockup__mark" dangerouslySetInnerHTML={{ __html: wordmark }} />
      {tag && <span className="lockup__tag">CPE</span>}
    </span>
  );
}
