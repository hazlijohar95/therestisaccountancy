/** The outcome of an operation that can be refused for a reason the caller is expected to handle. */
export type Result<T, R extends string> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: R };

export const ok = <T>(value: T): { readonly ok: true; readonly value: T } => ({ ok: true, value });
export const fail = <R extends string>(reason: R): { readonly ok: false; readonly reason: R } => ({ ok: false, reason });
