// src/lib/url.ts
export function getDomain(url: string) {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return "site";
  }
}
