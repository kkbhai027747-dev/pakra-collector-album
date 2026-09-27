import { DatabaseSync } from 'node:sqlite';
import { ApiError } from './auth.mjs';

export class CollectionStore {
  constructor(filename) {
    this.database = new DatabaseSync(filename);
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    const version = this.database.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) {
      this.database.close();
      throw new Error('Unsupported collection database version.');
    }
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS collection_accounts (
        shop TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
        PRIMARY KEY (shop, customer_id)
      );
      CREATE TABLE IF NOT EXISTS collection_entries (
        shop TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('unrecorded', 'missing', 'owned', 'previously_owned')),
        quantity INTEGER NOT NULL CHECK (
          (status = 'owned' AND quantity BETWEEN 1 AND 999) OR
          (status != 'owned' AND quantity = 0)
        ),
        wishlist INTEGER NOT NULL CHECK (wishlist IN (0, 1)),
        PRIMARY KEY (shop, customer_id, card_id),
        FOREIGN KEY (shop, customer_id) REFERENCES collection_accounts(shop, customer_id) ON DELETE CASCADE
      );
      PRAGMA user_version = 1;
    `);
    this.readRevision = this.database.prepare('SELECT revision FROM collection_accounts WHERE shop = ? AND customer_id = ?');
    this.readEntries = this.database.prepare('SELECT card_id, status, quantity, wishlist FROM collection_entries WHERE shop = ? AND customer_id = ? ORDER BY card_id');
    this.saveRevision = this.database.prepare(`
      INSERT INTO collection_accounts (shop, customer_id, revision) VALUES (?, ?, ?)
      ON CONFLICT (shop, customer_id) DO UPDATE SET revision = excluded.revision
    `);
    this.saveEntry = this.database.prepare(`
      INSERT INTO collection_entries (shop, customer_id, card_id, status, quantity, wishlist) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (shop, customer_id, card_id) DO UPDATE SET
        status = excluded.status, quantity = excluded.quantity, wishlist = excluded.wishlist
    `);
    this.removeEntry = this.database.prepare('DELETE FROM collection_entries WHERE shop = ? AND customer_id = ? AND card_id = ?');
  }

  snapshot({ shop, customerId }) {
    const revision = this.readRevision.get(shop, customerId)?.revision ?? 0;
    const entries = Object.create(null);
    for (const row of this.readEntries.all(shop, customerId)) {
      entries[row.card_id] = { status: row.status, quantity: row.quantity, wishlist: Boolean(row.wishlist) };
    }
    return { revision, entries };
  }

  read(principal) {
    this.database.exec('BEGIN');
    try {
      const snapshot = this.snapshot(principal);
      this.database.exec('COMMIT');
      return snapshot;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  update(principal, expectedRevision, changes) {
    const { shop, customerId } = principal;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const revision = this.readRevision.get(shop, customerId)?.revision ?? 0;
      if (revision !== expectedRevision) {
        throw new ApiError(409, 'revision_conflict', 'Your collection changed on another device. Refresh before saving.');
      }
      this.saveRevision.run(shop, customerId, revision + 1);
      for (const change of changes) {
        if (change.status === 'unrecorded' && !change.wishlist) {
          this.removeEntry.run(shop, customerId, change.cardId);
        } else {
          this.saveEntry.run(shop, customerId, change.cardId, change.status, change.quantity, Number(change.wishlist));
        }
      }
      const snapshot = this.snapshot(principal);
      this.database.exec('COMMIT');
      return snapshot;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}
