import {
  AREAS,
  BANDS,
  casebookYears,
  EMPLOYER_KINDS,
  ENGAGEMENT_ROLES,
  FRAMEWORKS,
  INDUSTRIES,
  normaliseHandle,
  ROLE_LIMITS,
  SERVICES,
  type Area,
  type Band,
  type EmployerKind,
  type EngagementRole,
  type Framework,
  type Industry,
  type Service,
} from '../data/social.ts';
import { identifying, ROLE_TITLE_SKIP } from '../lib/guard.ts';
import { attempt, integer, oneOf, optionalText, text, type Db, type Row } from './db.ts';
import { fail, ok, type Result } from './result.ts';
import { notify } from './social-notify.ts';
import { activeSql, authorOf, claimFacts, hasHandle, sealedSql, sealOf, type Author } from './social-profiles.ts';

/*
 * The casebook: work logged by kind, industry, size band and year, never by client, and a colleague with the seal who
 * co-signs it. The same guard the form shows refuses any note that could point at a client. Roles on the timeline name
 * the kind of employer from a list, never the employer.
 */

export interface EntryDraft {
  readonly service: Service;
  readonly industry: Industry;
  readonly band: Band;
  readonly framework: Framework;
  /** A year that has ended, or 'Earlier'. */
  readonly year: string;
  readonly role: EngagementRole;
  readonly areas: readonly Area[];
  readonly note: string;
  /** The handle of a colleague with the seal, to co-sign it. */
  readonly cosigner: string | null;
}

export type CosignState = 'pending' | 'signed' | 'declined';

export interface Entry extends Omit<EntryDraft, 'cosigner'> {
  readonly id: number;
  readonly cosigner: Author | null;
  readonly cosign: CosignState | null;
  readonly createdAt: string;
}

/** A request waiting on this member to co-sign. */
export interface CosignRequest {
  readonly entry: Entry;
  readonly author: Author;
}

export interface HeatCell {
  readonly industry: Industry;
  readonly service: Service;
  readonly entries: number;
  readonly cosigned: number;
}

export interface Heatmap {
  /** Industries with at least one entry, in the registry's order. */
  readonly industries: readonly Industry[];
  readonly cells: readonly HeatCell[];
  readonly entries: number;
  readonly cosigned: number;
}

export interface RoleDraft {
  readonly from: number;
  /** Null while they still hold it. */
  readonly to: number | null;
  readonly title: string;
  readonly employer: EmployerKind;
}

export interface Role extends RoleDraft {
  readonly id: number;
}

export type EntryRefusal = 'no-handle' | 'identifying' | 'year' | 'cosigner-not-found' | 'cosigner-self' | 'cosigner-no-seal';
export type CosignRefusal = 'not-found' | 'already' | 'no-seal';
export type RoleRefusal = 'identifying' | 'years';

const COSIGN_STATES = ['pending', 'signed', 'declined'] as const;
const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const thisYear = (date: Date) => new Date(date.getTime() + 8 * 3_600_000).getUTCFullYear();

/** A co-sign counts while its co-signer is active and holds the seal now. */
const COUNTED_COSIGN = (e: string) => `${e}.cosign = 'signed' AND ${e}.cosigner_id IS NOT NULL AND ${activeSql(`${e}.cosigner_id`)} AND ${sealedSql(`${e}.cosigner_id`)}`;

export function createSocialCasebook(db: Db, now: () => Date = () => new Date()) {
  const visibleAuthor = (memberId: number | null): Author | null => {
    if (memberId === null) return null;
    return db.prepare(`SELECT 1 FROM profiles p WHERE p.member_id = ? AND ${activeSql('p.member_id')}`).get(memberId) ? authorOf(db, memberId) : null;
  };

  const toEntry = (row: Row): Entry => {
    const stored: unknown = JSON.parse(text(row, 'areas'));
    const cosign = optionalText(row, 'cosign');
    return {
      id: integer(row, 'id'),
      service: oneOf(row, 'service', SERVICES),
      industry: oneOf(row, 'industry', INDUSTRIES),
      band: oneOf(row, 'band', BANDS),
      framework: oneOf(row, 'framework', FRAMEWORKS),
      year: text(row, 'year'),
      role: oneOf(row, 'role', ENGAGEMENT_ROLES),
      areas: AREAS.filter((area) => Array.isArray(stored) && stored.includes(area)),
      note: text(row, 'note'),
      cosigner: visibleAuthor(row.cosigner_id === null ? null : integer(row, 'cosigner_id')),
      cosign: cosign === null ? null : oneOf(row, 'cosign', COSIGN_STATES),
      createdAt: text(row, 'created_at'),
    };
  };

  const toRole = (row: Row): Role => ({
    id: integer(row, 'id'),
    from: integer(row, 'from_year'),
    to: row.to_year === null ? null : integer(row, 'to_year'),
    title: text(row, 'title'),
    employer: oneOf(row, 'employer', EMPLOYER_KINDS),
  });

  return {
    /**
     * Logs an entry. A named co-signer must hold the seal; they are asked in their notifications, and the entry shows
     * as co-signed once they say yes. Nothing is saved when anything is refused.
     */
    add(memberId: number, draft: EntryDraft): Result<{ readonly id: number }, EntryRefusal> {
      return attempt<{ readonly id: number }, EntryRefusal>(db, (refuse) => {
        if (!hasHandle(db, memberId)) refuse('no-handle');
        if (identifying(draft.note).length) refuse('identifying');
        if (!casebookYears(now()).includes(draft.year)) refuse('year');
        let cosignerId: number | null = null;
        if (draft.cosigner !== null) {
          const found = db.prepare(`SELECT p.member_id FROM profiles p WHERE p.handle = ? AND ${activeSql('p.member_id')}`).get(normaliseHandle(draft.cosigner)) ?? refuse('cosigner-not-found');
          cosignerId = integer(found, 'member_id');
          if (cosignerId === memberId) refuse('cosigner-self');
          if (!sealOf(claimFacts(db, cosignerId))) refuse('cosigner-no-seal');
        }
        const { lastInsertRowid: id } = db
          .prepare(
            `INSERT INTO casebook (member_id, service, industry, band, framework, year, role, areas, note, cosigner_id, cosign, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            memberId,
            draft.service,
            draft.industry,
            draft.band,
            draft.framework,
            draft.year,
            draft.role,
            JSON.stringify(AREAS.filter((area) => draft.areas.includes(area))),
            draft.note,
            cosignerId,
            cosignerId === null ? null : 'pending',
            iso(now()),
          );
        if (cosignerId !== null) notify(db, now(), cosignerId, { kind: 'cosign-request', key: String(id), actorId: memberId, subjectId: id });
        return { id };
      });
    },

    /** The author takes an entry off their casebook. A request still waiting goes with it. */
    remove(memberId: number, entryId: number): boolean {
      return db.prepare('DELETE FROM casebook WHERE id = ? AND member_id = ?').run(entryId, memberId).changes > 0;
    },

    /** The named co-signer says yes or no, once, while they hold the seal. The author hears either way. */
    decide(cosignerId: number, entryId: number, outcome: 'signed' | 'declined'): Result<{ readonly entryId: number; readonly outcome: 'signed' | 'declined' }, CosignRefusal> {
      return attempt<{ readonly entryId: number; readonly outcome: 'signed' | 'declined' }, CosignRefusal>(db, (refuse) => {
        const row = db.prepare(`SELECT member_id, cosign FROM casebook WHERE id = ? AND cosigner_id = ? AND ${activeSql('member_id')}`).get(entryId, cosignerId) ?? refuse('not-found');
        if (optionalText(row, 'cosign') !== 'pending') refuse('already');
        if (outcome === 'signed' && !sealOf(claimFacts(db, cosignerId))) refuse('no-seal');
        db.prepare('UPDATE casebook SET cosign = ?, cosigned_at = ? WHERE id = ?').run(outcome, iso(now()), entryId);
        notify(db, now(), integer(row, 'member_id'), { kind: 'cosign-outcome', key: String(entryId), actorId: cosignerId, subjectId: entryId, detail: outcome });
        return { entryId, outcome };
      });
    },

    /** Requests waiting on this member, oldest first, from authors the public can see. */
    requests(cosignerId: number): CosignRequest[] {
      return db
        .prepare(`SELECT * FROM casebook WHERE cosigner_id = ? AND cosign = 'pending' AND ${activeSql('member_id')} ORDER BY created_at, id`)
        .all(cosignerId)
        .flatMap((row) => {
          const author = visibleAuthor(integer(row, 'member_id'));
          return author ? [{ entry: toEntry(row), author }] : [];
        });
    },

    /** The member's own entries, newest first. */
    entries(memberId: number): Entry[] {
      return db.prepare('SELECT * FROM casebook WHERE member_id = ? ORDER BY created_at DESC, id DESC').all(memberId).map(toEntry);
    },

    /** Engagements by industry and kind of work, for a profile. A co-sign counts while its co-signer holds the seal. */
    heatmap(memberId: number): Heatmap {
      const cells = db
        .prepare(
          `SELECT e.industry, e.service, count(*) AS entries, sum(CASE WHEN ${COUNTED_COSIGN('e')} THEN 1 ELSE 0 END) AS cosigned
           FROM casebook e WHERE e.member_id = ? GROUP BY e.industry, e.service`,
        )
        .all(memberId)
        .map((row): HeatCell => ({ industry: oneOf(row, 'industry', INDUSTRIES), service: oneOf(row, 'service', SERVICES), entries: integer(row, 'entries'), cosigned: integer(row, 'cosigned') }));
      return {
        industries: INDUSTRIES.filter((industry) => cells.some((cell) => cell.industry === industry)),
        cells,
        entries: cells.reduce((sum, cell) => sum + cell.entries, 0),
        cosigned: cells.reduce((sum, cell) => sum + cell.cosigned, 0),
      };
    },

    /** Adds a role to the member's timeline. Its title is checked like a note, and its years must make sense. */
    addRole(memberId: number, draft: RoleDraft): Result<{ readonly id: number }, RoleRefusal> {
      if (identifying(draft.title, ROLE_TITLE_SKIP).length) return fail('identifying');
      const latest = thisYear(now());
      if (draft.from < ROLE_LIMITS.earliest || draft.from > latest || (draft.to !== null && (draft.to < draft.from || draft.to > latest))) return fail('years');
      const { lastInsertRowid } = db
        .prepare('INSERT INTO roles (member_id, from_year, to_year, title, employer, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(memberId, draft.from, draft.to, draft.title, draft.employer, iso(now()));
      return ok({ id: lastInsertRowid });
    },

    removeRole(memberId: number, roleId: number): boolean {
      return db.prepare('DELETE FROM roles WHERE id = ? AND member_id = ?').run(roleId, memberId).changes > 0;
    },

    /** The member's roles, earliest first; the ones they hold now last among equals. */
    roles(memberId: number): Role[] {
      return db.prepare('SELECT * FROM roles WHERE member_id = ? ORDER BY from_year, to_year IS NULL, to_year, id').all(memberId).map(toRole);
    },
  };
}

export type SocialCasebook = ReturnType<typeof createSocialCasebook>;
