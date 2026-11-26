import { SHELF_KINDS, SHELF_LIMITS, type ShelfKind } from '../data/social.ts';
import { count, integer, oneOf, text, type Db, type Row } from './db.ts';
import { fail, ok, type Result } from './result.ts';
import { activeSql } from './social-profiles.ts';

/*
 * The shelf: public work a member links to, by kind, and saves from other members. A saved item sits in the saver's
 * private Saved list until its owner takes it down. We store a link, never the file.
 */

export interface ShelfDraft {
  readonly kind: ShelfKind;
  readonly title: string;
  readonly url: string;
}

export interface ShelfItem extends ShelfDraft {
  readonly id: number;
  readonly saves: number;
  readonly savedByViewer: boolean;
  readonly mine: boolean;
}

export interface SavedItem extends ShelfDraft {
  readonly id: number;
  readonly owner: { readonly handle: string; readonly name: string };
}

export type ShelfRefusal = 'no-handle' | 'url' | 'full';
export type SaveRefusal = 'not-found' | 'self';

const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** An item anyone may see: not taken down, and its owner active with a profile. */
const VISIBLE_ITEM = (i: string) => `${i}.removed_at IS NULL AND ${activeSql(`${i}.member_id`)} AND EXISTS (SELECT 1 FROM profiles WHERE member_id = ${i}.member_id)`;
/** Saves that count: from active members. */
const COUNTED_SAVES = (i: string) => `(SELECT count(*) FROM saves s WHERE s.item_id = ${i}.id AND ${activeSql('s.member_id')})`;

/** A link to public work: https, with a host, and no user name or password in it. Null for anything else. */
export function publicLink(raw: string): string | null {
  if (!URL.canParse(raw.trim())) return null;
  const url = new URL(raw.trim());
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password) return null;
  return url.href.length <= SHELF_LIMITS.url ? url.href : null;
}

export function createSocialShelf(db: Db, now: () => Date = () => new Date()) {
  const toItem = (row: Row, viewerId: number | null): ShelfItem => ({
    id: integer(row, 'id'),
    kind: oneOf(row, 'kind', SHELF_KINDS),
    title: text(row, 'title'),
    url: text(row, 'url'),
    saves: integer(row, 'saves'),
    savedByViewer: integer(row, 'saved_by_viewer') === 1,
    mine: integer(row, 'member_id') === viewerId,
  });

  const savesOf = (itemId: number) => count(db.prepare(`SELECT ${COUNTED_SAVES('i')} AS n FROM shelf_items i WHERE i.id = ?`).get(itemId));

  return {
    /** Adds a link to the member's shelf. */
    add(memberId: number, draft: ShelfDraft): Result<{ readonly id: number }, ShelfRefusal> {
      if (!db.prepare('SELECT 1 FROM profiles WHERE member_id = ?').get(memberId)) return fail('no-handle');
      const url = publicLink(draft.url);
      if (!url) return fail('url');
      if (count(db.prepare('SELECT count(*) AS n FROM shelf_items WHERE member_id = ? AND removed_at IS NULL').get(memberId)) >= SHELF_LIMITS.items) return fail('full');
      const { lastInsertRowid } = db
        .prepare('INSERT INTO shelf_items (member_id, kind, title, url, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(memberId, draft.kind, draft.title, url, iso(now()));
      return ok({ id: lastInsertRowid });
    },

    /** The owner takes an item down. It leaves everyone's Saved list with it. */
    remove(memberId: number, itemId: number): boolean {
      return db.prepare('UPDATE shelf_items SET removed_at = ? WHERE id = ? AND member_id = ? AND removed_at IS NULL').run(iso(now()), itemId, memberId).changes > 0;
    },

    /** A member's shelf, newest first, as this viewer sees it. */
    shelf(ownerId: number, viewerId: number | null): ShelfItem[] {
      return db
        .prepare(
          `SELECT i.*, ${COUNTED_SAVES('i')} AS saves, EXISTS (SELECT 1 FROM saves s WHERE s.item_id = i.id AND s.member_id = ?) AS saved_by_viewer
           FROM shelf_items i WHERE i.member_id = ? AND ${VISIBLE_ITEM('i')} ORDER BY i.created_at DESC, i.id DESC`,
        )
        .all(viewerId, ownerId)
        .map((row) => toItem(row, viewerId));
    },

    /** Saves another member's item. Saving twice changes nothing. Returns the new count. */
    save(memberId: number, itemId: number): Result<{ readonly saves: number }, SaveRefusal> {
      const row = db.prepare(`SELECT i.member_id FROM shelf_items i WHERE i.id = ? AND ${VISIBLE_ITEM('i')}`).get(itemId);
      if (!row) return fail('not-found');
      if (integer(row, 'member_id') === memberId) return fail('self');
      db.prepare('INSERT INTO saves (member_id, item_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(memberId, itemId, iso(now()));
      return ok({ saves: savesOf(itemId) });
    },

    unsave(memberId: number, itemId: number): { readonly saves: number } {
      db.prepare('DELETE FROM saves WHERE member_id = ? AND item_id = ?').run(memberId, itemId);
      return { saves: savesOf(itemId) };
    },

    /** The member's private Saved list, newest save first. */
    saved(memberId: number): SavedItem[] {
      return db
        .prepare(
          `SELECT i.*, p.handle, m.name FROM saves s JOIN shelf_items i ON i.id = s.item_id JOIN profiles p ON p.member_id = i.member_id JOIN members m ON m.id = i.member_id
           WHERE s.member_id = ? AND ${VISIBLE_ITEM('i')} ORDER BY s.created_at DESC, i.id DESC`,
        )
        .all(memberId)
        .map((row) => ({
          id: integer(row, 'id'),
          kind: oneOf(row, 'kind', SHELF_KINDS),
          title: text(row, 'title'),
          url: text(row, 'url'),
          owner: { handle: text(row, 'handle'), name: text(row, 'name') },
        }));
    },
  };
}

export type SocialShelf = ReturnType<typeof createSocialShelf>;
