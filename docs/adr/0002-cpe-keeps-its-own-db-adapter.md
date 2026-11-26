# 2. CPE keeps its own database adapter

Date: 2026-11-26. Status: accepted.

## Context

`cpe/worker/db.ts` and the club's `src/server/db.ts` each carry a Durable Object adapter behind a small `Db` interface, and the row readers that go with it. The two copies differ (the club counts `changes` with `SELECT changes()`, CPE with `rowsWritten`).

## Decision

Do not share the adapter. CPE is a separate Worker, package and deploy. A shared module would couple their builds and releases to save about fifty lines.

## Consequences

Each app keeps its adapter tested by its own suite. If a third Worker needs the adapter, revisit this.
