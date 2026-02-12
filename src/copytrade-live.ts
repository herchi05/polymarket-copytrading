// src/copytrade-live.ts
import axios from "axios";
import yargs from "yargs";
import { db } from "./db";
import { getClient } from "./client-cache";
import { Side } from "@polymarket/clob-client";
import { CONFIG } from "./config";
import { decrypt } from "./crypto-utils";

/* ------------------------------------------------ */
/* CLI Flags                                        */
/* ------------------------------------------------ */

const argv = yargs(process.argv.slice(2))
  .option("trader-address", { type: "string", demandOption: true })
  .option("live", { type: "boolean", default: false })
  .option("dry-run", { type: "boolean", default: false })
  .option("budget", { type: "number", default: 100 })
  .option("copy-percentage", { type: "number", default: 0.25 })
  .option("max-trade-size", { type: "number", default: 10 }) // USDC cap
  .parseSync();

console.log(
  argv["dry-run"]
    ? "🧪 Running DRY RUN simulation"
    : argv["live"]
    ? "🚀 Running LIVE mode"
    : "⚠️ No mode selected"
);

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts - 1) throw err;
    }
  }
  throw new Error("Retry failed");
}

/* ------------------------------------------------ */
/* API                                              */
/* ------------------------------------------------ */

type Trade = {
  asset: string;
  conditionId: string;
  outcomeIndex: number;
  price: number;
  size: number;
  side: string;
  timestamp: number;
  transactionHash: string;
};

async function fetchTrades(user: string): Promise<Trade[]> {
  const res = await axios.get(`${CONFIG.API_BASE}/trades`, {
    params: { user, limit: 50, takerOnly: true },
  });

  return res.data;
}

async function fetchMarketsByConditionIds(conditionIds: string[]) {
  if (conditionIds.length === 0) return [];

  const res = await axios.get(
    "https://gamma-api.polymarket.com/markets",
    {
      params: {},
      paramsSerializer: () =>
        conditionIds.map(id => `condition_ids=${id}`).join("&"),
    }
  );

  return res.data;
}

/* ------------------------------------------------ */
/* Simulation State                                */
/* ------------------------------------------------ */

type Position = {
  tokenID: string;
  conditionId: string;
  outcomeIndex: number;
  shares: number;
  cost: number;
};

const simState = {
  budgetRemaining: argv.budget,
  spend: 0,
};

const positions = new Map<string, Position>();
const report: any[] = [];

/* ------------------------------------------------ */
/* Trade Simulation                                 */
/* ------------------------------------------------ */

async function simulateTrade(trade: Trade) {
  const shares = Number(trade.size);
  const price = Number(trade.price);
  const tokenID = String(trade.asset);

  if (!Number.isFinite(shares) || !Number.isFinite(price)) return;

  const entry: any = {
    txHash: trade.transactionHash,
    tokenID,
    conditionId: trade.conditionId,
    outcomeIndex: trade.outcomeIndex,
    price,
    shares,
  };

  if (trade.side !== "BUY") {
    entry.skipped = "not_buy";
    report.push(entry);
    return;
  }

  const desiredShares = shares * argv["copy-percentage"];

  const maxSharesByUSDC = argv["max-trade-size"] / price;
  const maxSharesByBudget = simState.budgetRemaining / price;

  const copiedShares = Math.min(
    desiredShares,
    maxSharesByUSDC,
    maxSharesByBudget
  );

  const cost = copiedShares * price;

  entry.copiedShares = copiedShares;
  entry.cost = cost;

  if (copiedShares <= 0 || cost <= 0) {
    entry.skipped = "budget_exhausted";
    report.push(entry);
    return;
  }

  simState.budgetRemaining -= cost;
  simState.spend += cost;

  const existing = positions.get(tokenID);

  if (existing) {
    existing.shares += copiedShares;
    existing.cost += cost;
  } else {
    positions.set(tokenID, {
      tokenID,
      conditionId: trade.conditionId,
      outcomeIndex: trade.outcomeIndex,
      shares: copiedShares,
      cost,
    });
  }

  report.push(entry);
}

/* ------------------------------------------------ */
/* ✅ ONLY CHANGE IS HERE (PnL pricing fix)         */
/* ------------------------------------------------ */

async function computePnL() {
  let totalCost = 0;
  let totalValue = 0;

  const breakdown = [];

  const conditionIds = [
    ...new Set([...positions.values()].map(p => p.conditionId)),
  ];

  const markets = await fetchMarketsByConditionIds(conditionIds);

  const marketMap = new Map<string, any>();
  for (const m of markets) {
    marketMap.set(m.conditionId, m);
  }

  for (const pos of positions.values()) {
    const market = marketMap.get(pos.conditionId);
    if (!market) continue;

    const outcomePrices = JSON.parse(market.outcomePrices);

    /* ✅ Correct mark-to-market valuation */
    const price =
      Number(market.bestBid) ||
      Number(market.lastTradePrice) ||
      Number(outcomePrices[pos.outcomeIndex]);

    console.log("markPrice", price);

    if (!Number.isFinite(price)) continue;

    const value = pos.shares * price;
    const pnl = value - pos.cost;

    totalCost += pos.cost;
    totalValue += value;

    breakdown.push({
      tokenID: pos.tokenID,
      question: market.question,
      shares: pos.shares,
      avgEntry: pos.cost / pos.shares,
      marketPrice: price,
      positionValue: value,
      pnl,
    });
  }

  return {
    totalCost,
    totalValue,
    unrealizedPnL: totalValue - totalCost,
    positions: breakdown,
  };
}

/* ------------------------------------------------ */

async function runDrySimulation(traderAddress: string) {
  const trades = await fetchTrades(traderAddress);

  const sorted = trades.sort(
    (a, b) => a.timestamp - b.timestamp
  );

  for (const trade of sorted) {
    await simulateTrade(trade);
  }

  const pnl = await computePnL();

  console.log("\n📊 SIMULATION RESULT\n");

  console.log(JSON.stringify({
    summary: {
      initialBudget: argv.budget,
      simulatedSpend: simState.spend,
      budgetRemaining: simState.budgetRemaining,
      tradesEvaluated: report.length,
      pnl,
    },
    trades: report,
  }, null, 2));
}

/* ------------------------------------------------ */
/* DB Helpers (CRITICAL FOR LIVE MODE)              */
/* ------------------------------------------------ */

function getAccounts() {
  return db.prepare(`
    SELECT
      a.id,
      a.address,
      a.encrypted_private_key,
      c.copy_percentage,
      c.max_trade_size,
      c.budget
    FROM accounts a
    JOIN account_config c
      ON a.id = c.account_id
  `).all();
}

function alreadyCopied(accountId: number, txHash: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM copied_trades WHERE account_id = ? AND tx_hash = ?")
    .get(accountId, txHash);
}

function recordCopy(
  accountId: number,
  txHash: string,
  conditionId: string,
  notional: number
) {
  db.prepare(`
    INSERT OR IGNORE INTO copied_trades
    (account_id, tx_hash, condition_id, copied_notional)
    VALUES (?, ?, ?, ?)
  `).run(accountId, txHash, conditionId, notional);
}

function updateBudget(accountId: number, notional: number) {
  db.prepare(`
    UPDATE account_config
    SET budget = budget - ?, updated_at = strftime('%s','now')
    WHERE account_id = ?
  `).run(notional, accountId);
}

/* ------------------------------------------------ */
/* LIVE EXECUTION ENGINE                            */
/* ------------------------------------------------ */

let lastSeenTimestamp = Math.floor(Date.now() / 1000);

async function executeForAccount(account: any, trade: any) {
  try {
    if (trade.side !== "BUY") return;

    if (alreadyCopied(account.id, trade.transactionHash)) {
      console.log("⏭ Already copied", trade.transactionHash);
      return;
    }

    const originalNotional = trade.size * trade.price;
    const desired = originalNotional * account.copy_percentage;

    const notional = Math.min(
      desired,
      account.max_trade_size,
      account.budget
    );

    if (notional <= 0) {
      console.log(`⏭ Skipped for ${account.address} (budget/limits)`);
      return;
    }

    const privateKey = decrypt(account.encrypted_private_key);
    const client = await getClient(privateKey);

    const order = await retry(() =>
      client.createAndPostMarketOrder({
        tokenID: trade.asset,   // ✅ Correct Polymarket token id
        side: Side.BUY,
        amount: notional,
      })
    );

    updateBudget(account.id, notional);     // ✅ Persist risk state
    recordCopy(
      account.id,
      trade.transactionHash,
      trade.conditionId,
      notional
    );                                      // ✅ Persist execution history

    console.log(`✅ LIVE ORDER ${account.address}`, order.orderID);

  } catch (err: any) {
    console.error(`❌ Failed for ${account.address}`, err.message);
  }
}

async function runLive(traderAddress: string) {
  console.log("\n📡 Monitoring trader:", traderAddress);

  while (true) {
    try {
      const trades = await fetchTrades(traderAddress);
      const accounts = getAccounts();

      const newTrades = trades.filter(
        (t: any) => t.timestamp > lastSeenTimestamp
      );

      if (newTrades.length > 0) {
        lastSeenTimestamp = Math.max(
          ...newTrades.map((t: any) => t.timestamp)
        );
      }

      for (const trade of newTrades) {
        for (const account of accounts) {
          await executeForAccount(account, trade);
        }
      }

    } catch (err: any) {
      console.error("Polling error:", err.message);
    }

    await sleep(CONFIG.DEFAULT_POLL_INTERVAL_MS);
  }
}

/* ------------------------------------------------ */
/* Entry Point                                      */
/* ------------------------------------------------ */

async function main() {
  const traderAddress = argv["trader-address"];

  if (argv["dry-run"]) {
    await runDrySimulation(traderAddress);
    process.exit();
  }

  if (argv["live"]) {
    await runLive(traderAddress);
  }
}

main();
