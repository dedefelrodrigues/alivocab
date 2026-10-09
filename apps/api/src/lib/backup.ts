/**
 * Database backups: a consistent copy of the live SQLite file (SQLite's online backup API, safe
 * while the app is writing), one file per run, older ones pruned. Pictures and cached audio
 * are plain files under MEDIA_DIR; copy that folder too for a full backup (see docs/deploy.md).
 */
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '@alivocab/db';
import { logger } from './logger.ts';

const DAY_MS = 86_400_000;
const FILE_RE = /^alivocab-(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})Z\.db$/;

/** `alivocab-2026-10-09T030000Z.db` (UTC, sorts by time). */
export function backupFileName(at: Date): string {
  const iso = at.toISOString(); // 2026-10-09T03:00:00.000Z
  return `alivocab-${iso.slice(0, 10)}T${iso.slice(11, 19).replaceAll(':', '')}Z.db`;
}

/** Writes a backup and deletes those older than `keepDays`. Returns the new file's path. */
export async function backupDatabase(
  db: Db,
  dir: string,
  { keepDays, now = new Date() }: { keepDays: number; now?: Date },
): Promise<{ file: string; removed: string[] }> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, backupFileName(now));
  await db.$client.backup(file);

  const removed: string[] = [];
  const cutoff = now.getTime() - keepDays * DAY_MS;
  for (const name of await readdir(dir)) {
    const m = FILE_RE.exec(name);
    if (!m) continue;
    const at = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
    if (at < cutoff) {
      await rm(join(dir, name), { force: true });
      removed.push(name);
    }
  }
  return { file, removed };
}

/** Milliseconds until the next `hour:00` (server local time). */
export function msUntilHour(hour: number, now = new Date()): number {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/** Backs up every night at `hour`. Returns a function that stops the schedule. */
export function scheduleBackups(
  db: Db,
  { dir, keepDays, hour }: { dir: string; keepDays: number; hour: number },
): () => void {
  let timer: NodeJS.Timeout;
  const plan = () => {
    timer = setTimeout(async () => {
      try {
        const { file, removed } = await backupDatabase(db, dir, { keepDays });
        logger.info({ file, removed }, 'database backup written');
      } catch (err) {
        logger.error({ err }, 'database backup failed');
      }
      plan();
    }, msUntilHour(hour));
    timer.unref();
  };
  plan();
  return () => clearTimeout(timer);
}
