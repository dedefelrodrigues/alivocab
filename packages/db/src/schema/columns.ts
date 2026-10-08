import { integer, text } from 'drizzle-orm/sqlite-core';
import { nanoid } from 'nanoid';

/** Text primary key generated with nanoid (21 chars, URL-safe). */
export const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => nanoid());

/** Timestamp stored as integer unix ms; exposed as `Date` in TypeScript. */
export const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

export const createdAt = () =>
  timestamp('created_at')
    .notNull()
    .$defaultFn(() => new Date());

export const updatedAt = () =>
  timestamp('updated_at')
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());
