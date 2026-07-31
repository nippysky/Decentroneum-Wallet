// src/lib/browser/recents.ts
//
// What counts as a "recent site", in one place.
//
// Both the browser tab and the in-app web view kept their own copy of this
// logic, and both recorded every navigation — including search-result pages.
// That produced the duplication you'd see after one search: "google at
// DuckDuckGo" appeared as a typeahead suggestion AND again under Recents,
// twice over, because DuckDuckGo redirects `?q=google` to `?q=google&ia=web`
// and each URL was stored as a separate "site".
//
// Recents answers "where do I go back to", and a search results page is not a
// destination — it is the road to one. Safari, Chrome and Arc all exclude
// them from frequently-visited for the same reason.

/** Hosts whose result pages are transit, not destinations. */
const SEARCH_HOSTS = [
  "duckduckgo.com",
  "www.duckduckgo.com",
  "google.com",
  "www.google.com",
  "bing.com",
  "www.bing.com",
  "search.brave.com",
  "ecosia.org",
  "www.ecosia.org",
  "startpage.com",
  "www.startpage.com",
];

/**
 * True for a search-engine results page.
 *
 * A search engine's HOME page is a legitimate destination, so this only
 * excludes URLs that actually carry a query.
 */
export function isSearchResultsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!SEARCH_HOSTS.includes(u.host.toLowerCase())) return false;
    return u.searchParams.has("q") || u.searchParams.has("query") || /^\/search/.test(u.pathname);
  } catch {
    return false;
  }
}

/** True when this navigation is worth remembering. */
export function isRecordableUrl(url: string): boolean {
  if (!url) return false;
  if (!/^https?:/i.test(url)) return false; // about:blank, data:, file:…
  return !isSearchResultsUrl(url);
}
