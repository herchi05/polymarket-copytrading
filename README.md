# Polymarket Copytrading Bot

A command-line copytrading bot for **Polymarket** that monitors a target trader
and mirrors their **BUY trades** using configurable risk controls.

---

## ✅ Features

- Dry-run simulation (no real trades)
- Live trading (real market orders)
- Multiple wallet support
- Persistent budgets & limits (SQLite)
- Idempotent execution (no duplicate trades)
- Automatic API key handling
- Allowance auto-repair
- Encrypted private key storage

---

## ⚠️ Important Notes

- Operates on **Polygon (Chain ID 137)**
- Live trading requires a funded wallet with **USDC.e**
- Trading involves **real financial risk**
- BUY trades only (SELL mirroring not implemented)

---

## Requirements

- Node.js 18+
- npm
- Polygon-compatible RPC endpoint

---

# 🚀 Getting Started

Install dependencies:

```bash
npm install
```

Create a `.env` file:

```bash
BOT_SECRET=your_encryption_secret
RPC_URL=https://your-polygon-rpc-url
```

---

## ✅ Step 1 — Register Your Wallet (Required for Live Trading)

```bash
npx ts-node src/add-account.ts \
  --private-key 0xYOUR_PRIVATE_KEY \
  --budget 50 \
  --copy-percentage 0.25 \
  --max-trade-size 5
```

### Parameters

- `--private-key`       Polygon wallet private key  
- `--budget`            Total USDC allocated to copytrading  
- `--copy-percentage`   Fraction of trader position to mirror  
- `--max-trade-size`    Maximum notional per copied trade  

This step:

- Validates wallet connectivity
- Ensures sufficient USDC balance
- Repairs missing allowances
- Derives Polymarket API credentials
- Persists encrypted key & config

---

## 🧪 Dry-Run Mode (Simulation Only)

Dry-run mode **never places trades**.  
It simulates what the bot would execute.

```bash
npx ts-node src/copytrade-live.ts \
  --dry-run \
  --trader-address 0xTARGET_WALLET \
  --budget 100 \
  --copy-percentage 0.25 \
  --max-trade-size 10
```

Dry-run behavior:

- Uses CLI-provided budget & limits
- Fetches recent trader trades
- Computes copytrade decisions
- Outputs structured JSON report

---

## 🚀 Live Trading Mode (REAL TRADES)

```bash
npx ts-node src/copytrade-live.ts \
  --live \
  --trader-address 0xTARGET_WALLET
```

Live behavior:

- Loads accounts & limits from SQLite
- Polls trader activity continuously
- Executes market orders
- Persists budget & trade history

⚠ **Live mode submits real Polymarket orders.**
Use small budgets when testing.

---

## 🧠 Copytrading Logic

For each detected BUY trade:

1. Compute original notional value  
2. Apply copy percentage  
3. Apply max trade size cap  
4. Enforce remaining budget  
5. Submit market order  
6. Persist execution record  

---

## 💾 Storage

Uses SQLite (`copytrade.db`) for:

- Wallet storage (encrypted private keys)
- Risk configuration
- Budget tracking
- Trade history
- Idempotency protection

---

## 🔐 Security Model

- Private keys encrypted via `BOT_SECRET`
- No plaintext key persistence
- Local signing only
- Secrets never logged

---

## 🛑 Risk Controls

- Global budget per account
- Maximum trade size cap
- Copy percentage scaling
- Duplicate trade prevention

---

## 🧩 Multi-Account Support

Multiple wallets can be registered and run simultaneously.
Each account maintains independent budgets and limits.

---

## 📡 Runtime Behavior

Live mode continuously:

1. Polls trader activity
2. Detects new trades
3. Executes copytrades
4. Sleeps and repeats

Interrupt with `CTRL + C`.

---

## Known Limitations

- BUY trades only (SELL mirroring not implemented)
- Polling-based ingestion (no websockets)
- No position netting or exposure aggregation
- No stop-loss or exit logic
- No advanced slippage controls

---

## ✅ Recommended Workflow

1. Register wallet  
2. Run dry-run simulation  
3. Verify logic & budget usage  
4. Enable live trading  
