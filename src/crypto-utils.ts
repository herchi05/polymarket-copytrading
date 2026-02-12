// src/crypto-utils.ts
import crypto from "crypto";
import { CONFIG } from "./config";

export function decrypt(payload: string): string {
  const [ivHex, encryptedHex] = payload.split(":");

  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  const key = crypto.createHash("sha256")
    .update(CONFIG.BOT_SECRET!)
    .digest();

  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = crypto.createHash("sha256").update(CONFIG.BOT_SECRET!).digest();

  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);

  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}
