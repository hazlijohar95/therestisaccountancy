# Glossary

Terms the code and the docs use. Keep them exact.

- **Domain module.** A `createX(db, now)` factory in `src/server/*` that owns one area's tables and rules (club, billing, socialClaims, socialRequests). It returns `Result`s, never throws for a refusal, and is tested on node:sqlite. See ADR-0001.
- **Store.** Every domain module, opened together over one database and one clock by `createStore` (`src/server/store.ts`). In production it lives in the `ClubStore` Durable Object, and the app reaches it with `withStore`, where every call returns a promise. Tests open it on node:sqlite.
- **Use case.** One thing a person does that may touch several tables (approve a join request, remove a member). It is one operation on a domain module, run as one transaction.
- **Server function.** A `createServerFn` in `app/src/functions/*`. It adapts a request to one use case: who is acting, the parsed input, the call, and the letters to send.
- **Action.** A form's server function built with `action()` (`app/src/lib/action.ts`): its access level, schema, throttle and refusal table, then its work, run in that fixed order.
- **Refusal.** A domain module's named reason for saying no (`'no-handle'`, `'full'`). The app maps each refusal to the message a person reads.
- **Outcome.** What a form's server function answers: a value, or a message plus per-field errors.
- **Failure.** A refused Outcome's message when it names no field, shown above the form's button (`failureOf`). A refusal that names fields shows each error beside its field instead.
- **Field.** An input wired to its error: the message, the id of the element that shows it, and the input's `aria-invalid` and `aria-describedby` (`wireField`, or `useAction`'s `field`).
- **Letter.** An email ready to send, built in `src/server/letters.ts` or `social-letters.ts`.
- **Access level.** Who may do something: anyone, signed in, paid, has a handle, or admin. Decided only in `app/src/lib/access.ts`. A level that says no gives a **denial** (`'signed-out'`, `'unpaid'`, `'no-handle'`, `'not-admin'`), which a form shows as a message and a page turns into a redirect or a 404.
