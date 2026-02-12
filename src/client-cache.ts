// src/client-cache.ts
import { Wallet } from "ethers";
import { ClobClient } from "@polymarket/clob-client";
import { CONFIG } from "./config";

const cache = new Map<string, ClobClient>();

export async function getClient(privateKey: string): Promise<ClobClient> {
  if (cache.has(privateKey)) {
    return cache.get(privateKey)!;
  }

  const wallet = new Wallet(privateKey);

  const temp = new ClobClient(CONFIG.HOST, CONFIG.CHAIN_ID, wallet);
  const apiCreds = await temp.createOrDeriveApiKey();

  const client = new ClobClient(
    CONFIG.HOST,
    CONFIG.CHAIN_ID,
    wallet,
    apiCreds,
    CONFIG.SIGNATURE_TYPE
  );

  cache.set(privateKey, client);

  return client;
}
