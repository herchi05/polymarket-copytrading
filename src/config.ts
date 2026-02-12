// src/config.ts
import dotenv from "dotenv";

dotenv.config();

export const CONFIG = {
    HOST: "https://clob.polymarket.com",
    API_BASE: "https://data-api.polymarket.com",
  
    CHAIN_ID: 137,
  
    SIGNATURE_TYPE: 0,
  
    DEFAULT_POLL_INTERVAL_MS: 10_000,

    BOT_SECRET: process.env.BOT_SECRET,

    USDCe_ADDRESS: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    RELAYER_URL: "https://relayer-v2.polymarket.com/",
    
    RPC_URL: process.env.RPC_URL,
  };
