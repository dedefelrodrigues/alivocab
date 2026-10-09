/** Writes a database backup now (`pnpm db:backup`, or `node dist/scripts/backup.js` in Docker). */
import { createDb } from '@alivocab/db';
import { backupDir, databasePath, env } from '../env.ts';
import { backupDatabase } from '../lib/backup.ts';

const db = createDb(databasePath);
const { file, removed } = await backupDatabase(db, backupDir, { keepDays: env.BACKUP_KEEP_DAYS });
console.log(`Backup written: ${file}`);
if (removed.length) console.log(`Removed old backups: ${removed.join(', ')}`);
db.$client.close();
