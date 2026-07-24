// src/lib/tokens/schema.ts
//
// Validates entries coming from the remote token registry before they ever
// touch balance/send logic. A malformed remote entry must never crash the
// wallet — invalid entries are dropped individually, not the whole list.
import { z } from "zod";
import { ethers } from "ethers";

export const TokenEntrySchema = z.object({
  address: z.string().refine((v) => ethers.isAddress(v), { message: "Invalid contract address" }),
  symbol: z.string().min(1).max(12),
  name: z.string().min(1).max(64),
  decimals: z.number().int().min(0).max(36),
  logoURI: z
    .string()
    .url()
    .refine((v) => v.startsWith("https://"), { message: "Logo must be https" })
    .optional(),
  status: z.enum(["approved"]).optional(),
});

export const TokenListResponseSchema = z.object({
  updatedAt: z.string().optional(),
  tokens: z.array(z.unknown()),
});

export type TokenEntry = z.infer<typeof TokenEntrySchema>;
