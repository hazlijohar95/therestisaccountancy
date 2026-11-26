import { Arrow } from "../components/Icons.tsx";
import { Link } from "../router.tsx";
import { useSession } from "../state.tsx";

/** What someone sees in place of the app until the club says they are a paid member. */
export function Gate() {
  const session = useSession();
  if (session.status === "loading" || session.status === "member") return <div className="view" aria-busy="true" />;
  if (session.status === "error") {
    return (
      <div className="page narrow" data-test="gate-error">
        <p className="eyebrow">CPE</p>
        <h1 className="display">Couldn’t load.</h1>
        <p className="lead">{session.message} Check your connection and reload the page.</p>
      </div>
    );
  }
  if (session.status === "signed-out") {
    return (
      <div className="page narrow" data-test="gate-signed-out">
        <p className="eyebrow">CPE · The Rest Is Accountancy</p>
        <h1 className="display">Sign in with the club.</h1>
        <p className="lead">CPE comes with club membership. Sign in with your club account and you’ll come straight back here.</p>
        <a className="pill pill--cpe" href={session.signIn} data-test="sign-in">
          Sign in <Arrow />
        </a>
        <p className="muted">
          <Link href="/">What is CPE?</Link>
        </p>
      </div>
    );
  }
  return (
    <div className="page narrow" data-test="gate-unpaid">
      <p className="eyebrow">Signed in as {session.member.name}</p>
      <h1 className="display">Membership needed.</h1>
      <p className="lead">CPE is part of paid club membership. Once your membership is paid, come back and your courses will be here.</p>
      <a className="pill pill--cpe" href={session.pay} data-test="pay">
        Pay for membership <Arrow />
      </a>
    </div>
  );
}
