// src/db.ts
import Database from "better-sqlite3";

export const db = new Database("copytrade.db");

/* ------------------------------------------------ */
/* Schema                                            */
/* ------------------------------------------------ */

db.exec(`

  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
  
    address TEXT UNIQUE NOT NULL,
    encrypted_private_key TEXT NOT NULL,
  
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  
  CREATE TABLE IF NOT EXISTS account_config (
    account_id INTEGER PRIMARY KEY,
  
    copy_percentage REAL NOT NULL DEFAULT 0.25,
    max_trade_size REAL NOT NULL DEFAULT 10,
    budget REAL NOT NULL DEFAULT 100,
  
    updated_at INTEGER DEFAULT (strftime('%s','now')),
  
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );
  
  CREATE TABLE IF NOT EXISTS copied_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
  
    account_id INTEGER NOT NULL,
    tx_hash TEXT NOT NULL,
    condition_id TEXT NOT NULL,
    copied_notional REAL NOT NULL,
  
    created_at INTEGER DEFAULT (strftime('%s','now')),
  
    UNIQUE(account_id, tx_hash),
  
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );
  
  `);
  