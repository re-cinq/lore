import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.LORE_DB_HOST || 'localhost',
  port: parseInt(process.env.LORE_DB_PORT || '5432'),
  database: process.env.LORE_DB_NAME || 'lore',
  user: process.env.LORE_DB_USER || 'lore_ui',
  password: process.env.LORE_DB_PASSWORD,
  max: 10,
});

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const { rows } = await pool.query(text, params);
  return rows as T[];
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}
