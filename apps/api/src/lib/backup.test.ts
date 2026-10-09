import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, runMigrations, schema } from '@alivocab/db';
import { describe, expect, it } from 'vitest';
import { backupDatabase, backupFileName, msUntilHour } from './backup.ts';

describe('database backups', () => {
  it('writes a readable copy and prunes old ones', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'alivocab-backup-'));
    const db = createDb(join(dir, 'live.db'));
    runMigrations(db);
    db.insert(schema.inviteCodes).values({ code: 'KEEP-ME' }).run();
    const out = join(dir, 'backups');
    // An old backup and an unrelated file.
    await backupDatabase(db, out, { keepDays: 14, now: new Date('2026-09-01T03:00:00Z') });
    writeFileSync(join(out, 'notes.txt'), 'mine');

    const now = new Date('2026-10-09T03:00:00Z');
    const { file, removed } = await backupDatabase(db, out, { keepDays: 14, now });
    expect(file).toBe(join(out, 'alivocab-2026-10-09T030000Z.db'));
    expect(removed).toEqual(['alivocab-2026-09-01T030000Z.db']);
    expect(readdirSync(out).sort()).toEqual(['alivocab-2026-10-09T030000Z.db', 'notes.txt']);

    const copy = createDb(file);
    expect(
      copy
        .select()
        .from(schema.inviteCodes)
        .all()
        .map((r) => r.code),
    ).toEqual(['KEEP-ME']);
  });

  it('names files by UTC time and plans the next run', () => {
    expect(backupFileName(new Date('2026-01-02T23:04:05.678Z'))).toBe(
      'alivocab-2026-01-02T230405Z.db',
    );
    const evening = new Date(2026, 9, 9, 22, 30);
    expect(msUntilHour(3, evening)).toBe(4.5 * 3_600_000);
    const early = new Date(2026, 9, 9, 1, 0);
    expect(msUntilHour(3, early)).toBe(2 * 3_600_000);
  });
});
