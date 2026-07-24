// src/lib/tokens.ts
//
// @deprecated — superseded by src/lib/tokens/registry.ts (remote + cached
// token registry) and src/state/tokens.ts (the store screens should use).
// Kept only as a re-export so this path can't silently break anything the
// dev tooling still resolves against it; new code should import from
// "@/src/lib/tokens/registry" directly.
export type { ListedToken } from "./tokens/registry";
export { DEFAULT_TOKENS as ALLOWLIST_TOKENS } from "./tokens/registry";
