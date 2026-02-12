// src/add-account.ts
import { db } from "./db";
import { Wallet, providers, Contract, constants, utils } from "ethers";
import yargs from "yargs";
import { encrypt } from "./crypto-utils";
import { ClobClient, AssetType } from "@polymarket/clob-client";
import { CONFIG } from "./config";

/* ------------------------------------------------ */
/* Types                                            */
/* ------------------------------------------------ */

type AccountRow = {
  id: number;
};

/* ------------------------------------------------ */
/* CLI Arguments                                    */
/* ------------------------------------------------ */

const argv = yargs(process.argv.slice(2))
  .option("private-key", {
    type: "string",
    demandOption: true,
    describe: "Polygon wallet private key",
  })
  .option("copy-percentage", {
    type: "number",
    default: 0.25,
    describe: "Fraction of trader position to copy (e.g. 0.25 = 25%)",
  })
  .option("max-trade-size", {
    type: "number",
    default: 10,
    describe: "Maximum notional per copied trade (USDC)",
  })
  .option("budget", {
    type: "number",
    default: 100,
    describe: "Total budget allocated to copytrading (USDC)",
  })
  .parseSync();

/* ------------------------------------------------ */
/* Constants                                        */
/* ------------------------------------------------ */

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
];

/* ------------------------------------------------ */
/* Guards                                           */
/* ------------------------------------------------ */

if (!CONFIG.BOT_SECRET) {
  throw new Error("Missing BOT_SECRET env variable");
}

function isZero(val?: string) {
  return !val || val === "0";
}

/* ------------------------------------------------ */
/* Wallet Validation                                */
/* ------------------------------------------------ */

async function validateWallet(privateKey: string) {
  const provider = new providers.JsonRpcProvider(CONFIG.RPC_URL);
  const wallet = new Wallet(privateKey, provider);
  const address = await wallet.getAddress();

  console.log("🔎 Validating wallet:", address);

  /* ---------------- API Credentials -------------- */

  const tempClob = new ClobClient(CONFIG.HOST, CONFIG.CHAIN_ID, wallet);

  let apiCreds: any;

  try {
    apiCreds = await tempClob.createOrDeriveApiKey();
  } catch {
    console.log("⚠️ API key creation skipped (may already exist)");
  }

  if (apiCreds?.key) {
    console.log("✅ API credentials ready");
  }

  const clob = new ClobClient(
    CONFIG.HOST,
    CONFIG.CHAIN_ID,
    wallet,
    apiCreds,
    CONFIG.SIGNATURE_TYPE,
    address
  );

  /* ---------------- Balance Check ---------------- */

  const balanceAllowance = await clob.getBalanceAllowance({
    asset_type: AssetType.COLLATERAL,
  });

  const balance = Number(balanceAllowance.balance);

  console.log("USDC balance:", balance);

  if (!balance || balance <= 0) {
    throw new Error("Wallet has zero USDC balance");
  }

  /* ---------------- Allowances ------------------- */

  const allowances = (balanceAllowance as any).allowances ?? {};

  const spendersNeedingApproval = Object.entries(allowances)
    .filter(([_, allowance]) => isZero(allowance as string))
    .map(([spender]) => spender);

  if (spendersNeedingApproval.length === 0) {
    console.log("✅ All allowances already set");
    return { address, privateKey };
  }

  console.log("⚠️ Allowances missing for:", spendersNeedingApproval);

  /* ---------------- Gas Strategy ----------------- */

  await provider.getFeeData(); // optional sanity call

  const maxFeePerGas = utils.parseUnits("700", "gwei");
  const maxPriorityFeePerGas = utils.parseUnits("150", "gwei");

  console.log("Gas settings:", {
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
  });

  const usdc = new Contract(CONFIG.USDCe_ADDRESS, ERC20_ABI, wallet);

  for (const spender of spendersNeedingApproval) {
    console.log(`⏳ Approving ${spender}...`);

    const tx = await usdc.approve(spender, constants.MaxUint256, {
      maxFeePerGas,
      maxPriorityFeePerGas,
    });

    console.log("TX:", tx.hash);

    await tx.wait();

    console.log(`✅ Approved ${spender}`);
  }

  /* ---------------- Recheck Allowances ----------- */

  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 1500));

    const updated = await clob.getBalanceAllowance({
      asset_type: AssetType.COLLATERAL,
    });

    const stillZero = spendersNeedingApproval.filter(
      s => isZero((updated as any).allowances?.[s])
    );

    console.log(`Recheck ${i + 1} → still zero:`, stillZero);

    if (stillZero.length === 0) break;

    if (i === 4) {
      throw new Error("Allowances still zero after approvals");
    }
  }

  console.log("✅ Wallet is trade-ready");

  return { address, privateKey };
}

/* ------------------------------------------------ */
/* Main                                             */
/* ------------------------------------------------ */

async function main() {
  try {
    const { address, privateKey } = await validateWallet(argv["private-key"]);

    const encryptedPk = encrypt(privateKey);

    /* ---------------- Accounts Table -------------- */

    db.prepare(`
      INSERT OR IGNORE INTO accounts (address, encrypted_private_key)
      VALUES (?, ?)
    `).run(address, encryptedPk);

    const account = db.prepare(`
      SELECT id FROM accounts WHERE address = ?
    `).get(address) as AccountRow | undefined;

    if (!account) {
      throw new Error("Failed to resolve account ID");
    }

    /* ---------------- Config UPSERT (CRITICAL) ---- */

    db.prepare(`
      INSERT INTO account_config (
        account_id,
        copy_percentage,
        max_trade_size,
        budget,
        updated_at
      )
      VALUES (?, ?, ?, ?, strftime('%s','now'))

      ON CONFLICT(account_id) DO UPDATE SET
        copy_percentage = excluded.copy_percentage,
        max_trade_size = excluded.max_trade_size,
        budget = excluded.budget,
        updated_at = strftime('%s','now')
    `).run(
      account.id,
      argv["copy-percentage"],
      argv["max-trade-size"],
      argv["budget"]
    );

    console.log("✅ Account saved & configured:", {
      address,
      copyPercentage: argv["copy-percentage"],
      maxTradeSize: argv["max-trade-size"],
      budget: argv["budget"],
    });

  } catch (err: any) {
    console.error("\n❌ Setup failed");
    console.error(err?.message ?? err);
  }
}

main();
