// File: backend/database/connection.js
// SRS References: NFR Scalability (Page 8), NFR Performance (Page 8)
// SRS Section 5 (Page 9): "Environment variables for all configuration"
// MySQL 8.0 connection pool — mysql2 with promise API

import mysql from 'mysql2/promise';
import { config } from '../config/env.js';

// ── Pool configuration ─────────────────────────────────────────────────────
// NFR Scalability, Page 8: "Connection pooling enabled"
// NFR Performance, Page 8: "Slot listing queries optimized with indexed columns"
// DB_POOL_MAX controls max concurrent connections — set via ENV, never hardcoded
const poolConfig = {
  host:               config.db.host,
  port:               config.db.port,
  user:               config.db.user,
  password:           config.db.password,
  database:           config.db.name,
  charset:            'utf8mb4',
  timezone:           'Z',             // Store all datetimes as UTC
  // NFR Scalability: pool bounds from environment
  connectionLimit:    config.db.poolMax,
  queueLimit:         0,               // Unlimited queue — prevents connection drops at load
  waitForConnections: true,
  // NFR Performance: keep idle connections warm
  idleTimeout:        config.db.idleTimeout,
  enableKeepAlive:    true,
  keepAliveInitialDelay: 10000,
  // NFR Security, Page 8: strict SQL mode prevents silent data truncation
  multipleStatements: false,           // Prevent SQL injection via stacked queries
};

// Singleton pool instance
let pool;

/**
 * Initialise the connection pool. Called once at server startup.
 * @returns {Promise<mysql.Pool>}
 */
export async function initPool() {
  if (pool) return pool;

  pool = mysql.createPool(poolConfig);

  // Validate connectivity on startup — fail fast if DB unreachable
  const conn = await pool.getConnection();
  const [rows] = await conn.execute('SELECT 1 AS connected');
  conn.release();

  if (rows[0].connected !== 1) {
    throw new Error('Database connectivity check failed.');
  }

  console.info(`[DB] Pool connected to ${config.db.host}:${config.db.port}/${config.db.name}`);
  return pool;
}

/**
 * Returns the active pool. Throws if initPool() has not been called.
 * @returns {mysql.Pool}
 */
export function getPool() {
  if (!pool) {
    throw new Error('[DB] Pool not initialised. Call initPool() before use.');
  }
  return pool;
}

/**
 * Execute a parameterised query on the pool.
 * NFR Security, Page 8: All queries must be parameterised — NO string concatenation.
 *
 * @param {string} sql        - Parameterised SQL string
 * @param {Array}  [params]   - Bound parameters
 * @returns {Promise<[mysql.RowDataPacket[], mysql.FieldPacket[]]>}
 */
export async function query(sql, params = []) {
  const p = getPool();
  return p.execute(sql, params);
}

/**
 * Acquire a dedicated connection for multi-statement transactions.
 * Caller MUST call conn.release() in the finally block.
 *
 * Usage:
 *   const conn = await getConnection();
 *   try {
 *     await conn.beginTransaction();
 *     ...
 *     await conn.commit();
 *   } catch (e) {
 *     await conn.rollback();
 *     throw e;
 *   } finally {
 *     conn.release();
 *   }
 *
 * @returns {Promise<mysql.PoolConnection>}
 */
export async function getConnection() {
  return getPool().getConnection();
}

/**
 * Gracefully drain the pool — called on SIGTERM/SIGINT.
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.info('[DB] Pool drained and closed.');
  }
}
