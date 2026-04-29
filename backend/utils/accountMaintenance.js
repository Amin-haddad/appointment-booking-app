import { config } from '../config/env.js';
import { query } from '../database/connection.js';

let purgeTimer = null;

async function purgeUnverifiedAccounts() {
  const cutoff = new Date(Date.now() - config.maintenance.unverifiedRetentionDays * 24 * 60 * 60 * 1000);

  const [result] = await query(
    `DELETE FROM users
     WHERE is_verified = 0
       AND created_at < ?`,
    [cutoff]
  );

  if (result.affectedRows > 0) {
    console.info(`[Maintenance] Purged ${result.affectedRows} unverified account(s).`);
  }
}

export function startAccountMaintenance() {
  if (purgeTimer) return;

  const intervalMs = config.maintenance.purgeIntervalMinutes * 60 * 1000;

  purgeUnverifiedAccounts().catch((err) => {
    console.error('[Maintenance] Initial unverified-account purge failed:', err.message);
  });

  purgeTimer = setInterval(() => {
    purgeUnverifiedAccounts().catch((err) => {
      console.error('[Maintenance] Scheduled unverified-account purge failed:', err.message);
    });
  }, intervalMs);
}

export function stopAccountMaintenance() {
  if (purgeTimer) {
    clearInterval(purgeTimer);
    purgeTimer = null;
  }
}

