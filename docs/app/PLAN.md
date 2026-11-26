# The app: TanStack Start on Workers

Everything that runs per request (the club's members' area and admin, sign-in, payments, Social) is one TanStack Start app in `app/`, deployed as the `better-accountant` Worker. Astro builds only the marketing pages, as static files the app serves. There are no users yet, so nothing is migrated: the Worker keeps its name and its `ClubStore`.

## Decisions

- **One Worker.** `app/cloudflare.config.ts` names `better-accountant`, exports `ClubStore`, runs the hourly job and serves the club's host, `www` and the social host. `app/src/server.ts` is the entry: CHIP and unsubscribe posts first, then the app.
- **Shared server code stays put.** `src/server/*` (the store's modules, migrations, letters, jobs, payments) and `src/data/*` are framework-free and imported from the app by relative path. Their tests run with `npm test` at the root. Change them only to remove an Astro dependency.
- **Sign-in is the app's own.** The `sign_ins` table keeps a hash of each session token and the member's epoch. `app/src/lib/session.server.ts` reads the `session` cookie once per request (`currentMember()`), and sets or clears it. In production the cookie is on the whole domain, so both hosts share it.
- **Hosts.** Social's routes live under `app/src/routes/social/`. The router's `rewrite` (`app/src/lib/hosts.ts`) maps the social host's `/x` to `/social/x` and back, on the server and in the browser. On a dev host the same pages are at `/social/x`, or at `social.localhost:<port>/x`.
- **Marketing.** Astro's static build is served from `/_site` by exact path. The Worker maps `/about` to `/_site/about.html` on the club's host, and falls through to the app when no file matches. Pages that read the store or the member (`prerender = false` in Astro) move to the app; a members-only post body must never be in static HTML.
- **Config values.** `app/cloudflare.config.ts` must not import modules the Worker also imports: the dev server then fails to load them. It repeats the domain instead.

## Conventions for porting a page

- **Same paths.** A route keeps the Astro page's URL exactly. Links already sent in emails depend on it.
- **Same markup and classes.** Port the HTML element for element. Global classes (`btn`, `input`, `field`, `wrap`, `night`, `label`, `serif`, Social's `card`, `page`, `kicker` and the rest) stay as strings. An Astro component's scoped `<style>` becomes a co-located `X.module.css`; reach global classes inside it with `:global(.btn)`.
- **Reading data.** A route's `loader` calls a `createServerFn({ method: 'GET' })` in `app/src/functions/<area>.ts`. Server functions use `withStore` and `currentMember()`. A page that needs a member uses `memberOrSignIn()` in its server function, or checks `context.member` (set by the root route) in `beforeLoad`. Missing records `throw notFound()`.
- **Store calls are RPC.** Every call into the store crosses to the Durable Object and returns a stub-typed promise. Inside `withStore`, write an `async` callback, `await` each call and return plain data; returning a store call's promise directly fails to typecheck.
- **Changing data.** One `createServerFn({ method: 'POST' })` per Astro action. Type the input with `.validator((input: X) => input)`, parse it with the action's zod schema through `parsed()`, and return an `Outcome` (`app/src/lib/outcome.ts`). Refusal tables stay `Record<Reason, string>`, so every reason has a message. Throttle with `allowed(form)` from `limits.server.ts`. Guards: `memberOrRefusal`, `paidOrRefusal`, `adminOrRefusal`. Send mail with `sendLater`; build emailed links with `absolute` (`mail.server.ts`).
- **Forms.** A React form calls its server function through `useServerFn`. Field errors from `Outcome.fields` show beside their field with `aria-invalid` and `aria-describedby`; the message shows in a `role="alert"` paragraph. After success, refresh what changed with `router.invalidate()` or navigate. Keep the copy of every message word for word.
- **Browser scripts.** An Astro `<script>` becomes React state or a `useEffect`. Reuse `src/lib/*.ts` helpers where they are framework-free.
- **Titles.** `head: () => ({ meta: [...clubTitle('Name')] })` or `socialTitle`. Add `noindex` where the Astro page had it. Social pages set `staticData: { section }` for the nav.
- **Links between hosts.** `socialHref`, `clubHref` and `socialSignInHref` from `app/src/lib/links.ts`.
- **Types.** Never `any`, `as unknown as`, `@ts-ignore` or `@ts-expect-error`. `npx tsc --noEmit` in `app/` must pass.

## Running it

- `cd app && SITE_URL=http://localhost:4178 VITE_LOCAL_SEED=on CLOUDFLARE_VITE_FORCE_BUILD_OUTPUT=true npx vite build && npx vite preview --port 4178 --host 127.0.0.1`. The dev server works too (`npx vite dev`), but browse loses its tab on it.
- `GET /dev-seed` on that build makes `team@local.test` (admin, handle `team`) and `a@`, `b@`, `c@local.test` (Social members; a and b ticked), all with the password `local test password 1`. The route is compiled out unless `VITE_LOCAL_SEED=on`.
- `GET /dev-seed?as=a@local.test` also signs that account in and sets the cookie. Use it in browse and with `curl -c`/`-b`: Chrome drops browse's connection as soon as a password field holds a value, so never type into the sign-in form.
