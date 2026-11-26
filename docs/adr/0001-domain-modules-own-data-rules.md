# 1. Domain modules own every rule that changes data

Date: 2026-11-26. Status: accepted. Replaces the rule "Shared server code stays put" in `docs/app/PLAN.md`.

## Context

The port from Astro to TanStack Start kept `src/server/*` frozen so the move stayed mechanical. The port has landed. Since then, rules that change data have collected in the app's server functions (`app/src/functions/*`). There they run as several store calls that are not one transaction, and no test reaches them. Examples are approving a join request and issuing its password link, and removing a host and calling off their calls.

## Decision

A rule that reads or changes the club's data lives in its domain module in `src/server/*`. It runs inside one `attempt` on the module's `db`, and its test sits beside it. A use case that touches two modules goes in the module that owns its main noun and shares the other module's internals on the same `db`, as `social-requests.ts` already shares `admit`.

A use case that ends in mail returns the `Letter[]` to send. The caller passes the absolute URLs (or the site's base URL) the letters need. A server function does four things only. It asks who is acting, parses the input, calls one domain operation, and sends the letters it got back.

## Consequences

- Rules are tested in `src/server/*.test.ts` on node:sqlite, as the rest of the domain is.
- Work that cannot share the database transaction stays in the app: R2 evidence files, `waitUntil` mail delivery, cookies.
