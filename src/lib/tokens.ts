// src/lib/tokens.ts
export type ListedToken = {
  address: string; // ERC-20 contract
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string; // later: host on decentroneum.com CDN
};

// MVP: you hardcode legit, reviewed tokens here.
// Keep this list small (e.g., 10–30) so on-chain balance calls are fast.
export const ALLOWLIST_TOKENS: ListedToken[] = [
  {
    address: "0xE74e4E7A064310466f3bdBd3F3Ce4e8c8F7CF1d5",
    symbol: "DCNT",
    name: "Decentroneum",
    decimals: 18,
    logoURI: "https://static.electroswap.io/launchpad/presales/0x34b0dde73Ce7Dc241444B2d8A6Fe3dcB44c5FbEC_logo.webp",
  },
];
