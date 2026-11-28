import { Link } from "../router.tsx";

export function NotFound() {
  return (
    <div className="view narrow">
      <h1 className="display">Nothing here.</h1>
      <Link className="pill pill--ink" href="/home">
        Back home
      </Link>
    </div>
  );
}
