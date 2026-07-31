// app/(tabs)/browser.tsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { FONT } from "@/src/theme/typography";
import { Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isRecordableUrl } from "@/src/lib/browser/recents";
import * as SecureStore from "expo-secure-store";

import { useTheme } from "@/src/theme/ThemeProvider";
import { Screen } from "@/src/components/Screen";
import { toast } from "@/src/state/toast";
import { T } from "@/src/components/T";
import { SiteIcon } from "@/src/components/SiteIcon";
import { useSession } from "@/src/state/session";
import { RADIUS, SPACING } from "@/src/theme/tokens";

// Kept deliberately short. Only the D-App is listed for Decentroneum —
// the marketing site was a near-duplicate entry that added a line without
// adding a destination anyone needs from inside a wallet.
const FEATURED = [
  { name: "Decentroneum D-App", url: "https://app.decentroneum.com" },
  { name: "ElectroSwap", url: "https://electroswap.io" },
  { name: "Electroneum Explorer", url: "https://blockexplorer.electroneum.com" },
];

type RecentItem = {
  url: string; // clean url (no dw param)
  title?: string;
  lastVisited: number;
};

// Migrate from old SecureStore key -> AsyncStorage
const OLD_SECURESTORE_KEY = "dw.browser.recents.v1";
const RECENTS_KEY = "dw_browser_recents_v2"; // AsyncStorage key
const MAX_RECENTS = 20;

function normalizeToUrl(input: string) {
  const s = input.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\S*)$/i.test(s)) return `https://${s}`;
  const q = encodeURIComponent(s);
  return `https://duckduckgo.com/?q=${q}`;
}

function stripDw(url: string) {
  try {
    const u = new URL(url);
    u.searchParams.delete("dw");
    return u.toString();
  } catch {
    return url
      .replace(/([?&])dw=\d+(&?)/g, (m, p1, p2) => {
        if (p1 === "?" && p2) return "?";
        if (p1 === "?" && !p2) return "";
        if (p1 === "&" && p2) return "&";
        return "";
      })
      .replace(/[?&]$/, "");
  }
}


function safeParseRecents(raw: string | null): RecentItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as RecentItem[];
    if (!Array.isArray(parsed)) return [];
    // sanitize + cap
    return parsed
      .filter((x) => x && typeof x.url === "string" && typeof x.lastVisited === "number")
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

async function migrateRecentsIfNeeded() {
  try {
    const already = await AsyncStorage.getItem(RECENTS_KEY);
    if (already) return;

    const oldRaw = await SecureStore.getItemAsync(OLD_SECURESTORE_KEY);
    const items = safeParseRecents(oldRaw);
    if (items.length) {
      await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(items.slice(0, MAX_RECENTS)));
    }
    // delete old key (best effort)
    await SecureStore.deleteItemAsync(OLD_SECURESTORE_KEY);
  } catch {
    // ignore
  }
}

async function readRecents(): Promise<RecentItem[]> {
  const raw = await AsyncStorage.getItem(RECENTS_KEY);
  // Filter on READ as well as on write, so search pages already saved by an
  // earlier build disappear without anyone having to tap Clear.
  return safeParseRecents(raw).filter((x) => isRecordableUrl(x.url));
}

async function writeRecents(items: RecentItem[]) {
  // keep storage small + predictable
  const compact = items.slice(0, MAX_RECENTS).map((x) => ({
    url: x.url,
    title: x.title?.slice(0, 80), // cap title size
    lastVisited: x.lastVisited,
  }));
  await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(compact));
}

async function upsertRecent(url: string, title?: string) {
  const clean = stripDw(url);

  // Search-result pages are transit, not destinations — see lib/browser/recents.
  if (!isRecordableUrl(clean)) return;

  const items = await readRecents();
  const now = Date.now();

  const next: RecentItem[] = [{ url: clean, title, lastVisited: now }, ...items.filter((x) => x.url !== clean)];
  await writeRecents(next);
}

/** "electroswap.io" — never throws, unlike a bare `new URL(...)` in render. */
function hostLabel(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function timeAgo(ts: number) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 20) return "Just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function Browser() {
  const { theme } = useTheme();
  const router = useRouter();

  const [value, setValue] = useState("");
  const hint = useMemo(() => "Search or enter website", []);

  const [recents, setRecents] = useState<RecentItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllRecents, setShowAllRecents] = useState(false);

  const isUnlocked = useSession((s) => s.isUnlocked);

  const refreshRecents = useCallback(async () => {
    const items = await readRecents();
    setRecents(items);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await migrateRecentsIfNeeded();
      const items = await readRecents();
      if (alive) setRecents(items);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshRecents();
    } finally {
      setTimeout(() => setRefreshing(false), 120);
    }
  }, [refreshRecents]);

  const go = useCallback(
    async (raw: string) => {
      const url = normalizeToUrl(raw);
      if (!url) return;

      await upsertRecent(url);
      await refreshRecents();

      router.push({
        pathname: "/browser/web" as any,
        params: { url },
      });
    },
    [refreshRecents, router]
  );

  const clearRecents = useCallback(async () => {
    await AsyncStorage.removeItem(RECENTS_KEY);
    setRecents([]);
    setShowAllRecents(false);
    // The section disappears entirely on the same tap, so without a word the
    // screen just... changes. One line confirms it was deliberate.
    toast.success("Recents cleared");
  }, []);

  const RECENTS_COLLAPSED_COUNT = 5;
  const RECENTS_EXPANDED_COUNT = 10;
  const visibleRecents = recents.slice(0, showAllRecents ? RECENTS_EXPANDED_COUNT : RECENTS_COLLAPSED_COUNT);

  const query = value.trim().toLowerCase();

  const suggestions = useMemo(() => {
    if (!query) return [];

    const featuredMatches = FEATURED.filter(
      (x) => x.name.toLowerCase().includes(query) || x.url.toLowerCase().includes(query)
    ).map((x) => ({ kind: "featured" as const, name: x.name, url: x.url, meta: "Featured" }));

    const recentMatches = recents
      .filter((x) => x.url.toLowerCase().includes(query) || (x.title ?? "").toLowerCase().includes(query))
      .slice(0, 8)
      .map((x) => ({
        kind: "recent" as const,
        name: x.title || new URL(x.url).host,
        url: x.url,
        meta: timeAgo(x.lastVisited),
      }));

    const direct = normalizeToUrl(value);
    const showDirect = !!direct && !direct.includes("duckduckgo.com/?q=");

    const out = [
      ...(showDirect
        ? [{ kind: "go" as const, name: `Go to ${direct.replace(/^https?:\/\//, "")}`, url: direct, meta: "Direct" }]
        : []),
      ...recentMatches,
      ...featuredMatches,
    ];

    const seen = new Set<string>();
    return out
      .filter((x) => {
        if (seen.has(x.url)) return false;
        seen.add(x.url);
        return true;
      })
      .slice(0, 8);
  }, [query, recents, value]);

  if (!isUnlocked) return <Redirect href="/unlock" />;

  return (
    // edges={["top"]}: the tab bar below this screen is now IN FLOW and
    // carries the bottom safe area itself (see app/(tabs)/_layout.tsx).
    // Reserving it here as well would double-count the inset and leave a
    // visible dead strip above the bar.
    <Screen edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: SPACING.xxl }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={theme.muted} />}
      >
        <View>
          <T weight="bold" style={{ fontSize: 32, lineHeight: 38, letterSpacing: -1 }}>
            Browser
          </T>

          <View style={{ height: SPACING.xl }} />

          {/* URL bar */}
          <View
            style={{
              borderRadius: RADIUS.xl,
              backgroundColor: theme.surface2,
              paddingHorizontal: SPACING.md,
              paddingVertical: SPACING.sm,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Ionicons name="search-outline" size={18} color={theme.muted} />
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder={hint}
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={() => go(value)}
              style={{
                flex: 1,
                minWidth: 0,
                color: theme.text,
                fontSize: 16,
                fontFamily: FONT.medium,
                paddingVertical: 6,
              }}
            />

            {/* Clear. Only present when there is something to clear, so it
                never competes with the Go button on an empty field.
                
                Not `clearButtonMode` — that's iOS-only, unstyleable, and sits
                where our Go button already is. A 28pt target inside the bar
                works identically on both platforms and matches the app's own
                circular-control language. */}
            {value.length > 0 ? (
              <Pressable
                onPress={() => setValue("")}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Clear address"
                style={({ pressed }) => ({
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: theme.border,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Ionicons name="close" size={13} color={theme.text} />
              </Pressable>
            ) : null}
            <Pressable hitSlop={6}
              onPress={() => go(value)}
              style={({ pressed }) => [
                {
                  width: 40,
                  height: 40,
                  borderRadius: 999,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: theme.primary,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
            >
              <Ionicons name="arrow-forward" size={18} color={theme.bg} />
            </Pressable>
          </View>

          {/* Suggestions — typeahead, directly under the field where a
              typed query is answered. Gated on having actual matches rather
              than on the field being non-empty, so an unmatched query leaves
              no phantom gap above Featured. */}
          {suggestions.length > 0 ? (
            <>
              <View style={{ height: SPACING.md }} />
              <View>
                {suggestions.map((s) => (
                  <Pressable hitSlop={6}
                    key={`${s.kind}:${s.url}`}
                    onPress={() => go(s.url)}
                    style={({ pressed }) => ({
                      paddingVertical: SPACING.sm,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                      <SiteIcon url={s.url} size={38} />

                      <View style={{ flex: 1, minWidth: 0 }}>
                        <T weight="semibold" numberOfLines={1}>
                          {s.name}
                        </T>
                        <T variant="caption" color={theme.muted} numberOfLines={1}>
                          {s.meta} • {s.url.replace(/^https?:\/\//, "")}
                        </T>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          <View style={{ height: SPACING.xxl }} />

          {/* Featured */}
          <View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <T weight="bold" style={{ fontSize: 20, letterSpacing: -0.3 }}>
                Featured
              </T>
            </View>

            <View style={{ height: SPACING.sm }} />

            {/* Cards, matching the Assets list on Home — a tap target that
                looks like a tap target, and a consistent rhythm across the
                two browsing surfaces of the app. */}
            <View style={{ gap: SPACING.sm }}>
              {FEATURED.map((d) => (
                <Pressable
                  hitSlop={4}
                  key={d.url}
                  onPress={() => go(d.url)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: SPACING.md,
                    padding: SPACING.md,
                    borderRadius: RADIUS.xl,
                    backgroundColor: theme.surface2,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <SiteIcon url={d.url} size={40} />

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T weight="semibold" numberOfLines={1}>
                      {d.name}
                    </T>
                    <T variant="caption" color={theme.muted} numberOfLines={1}>
                      {d.url.replace(/^https?:\/\//, "")}
                    </T>
                  </View>

                  <Ionicons name="chevron-forward" size={15} color={theme.muted} />
                </Pressable>
              ))}
            </View>
          </View>

          {/* Recents — the entire section, heading and all, only exists once
              there is something in it. An empty "Recents / No recent sites
              yet" block is a heading announcing nothing: it costs a screenful
              of vertical space to say the same thing its own absence says
              more quietly. */}
          {recents.length > 0 ? (
            <>
              <View style={{ height: SPACING.xxl }} />

              <View>
                <View
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                >
                  <T weight="bold" style={{ fontSize: 20, letterSpacing: -0.3 }}>
                    Recents
                  </T>
                  {/* No disabled state needed — this button only exists inside
                      a section that requires at least one recent to render. */}
                  <Pressable
                    onPress={clearRecents}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Clear recent sites"
                    style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.6 : 1 })}
                  >
                    <T variant="caption" weight="semibold" color={theme.muted}>
                      Clear
                    </T>
                  </Pressable>
                </View>

                <View style={{ height: SPACING.sm }} />

                <View style={{ gap: SPACING.sm }}>
                  {visibleRecents.map((r) => (
                    <Pressable
                      hitSlop={4}
                      key={r.url}
                      onPress={() => go(r.url)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: SPACING.md,
                        padding: SPACING.md,
                        borderRadius: RADIUS.xl,
                        backgroundColor: theme.surface2,
                        opacity: pressed ? 0.85 : 1,
                      })}
                    >
                      <SiteIcon url={r.url} size={40} />

                      <View style={{ flex: 1, minWidth: 0 }}>
                        <T weight="semibold" numberOfLines={1}>
                          {r.title || hostLabel(r.url)}
                        </T>
                        <T variant="caption" color={theme.muted} numberOfLines={1}>
                          {timeAgo(r.lastVisited)} · {r.url.replace(/^https?:\/\//, "")}
                        </T>
                      </View>

                      <Ionicons name="chevron-forward" size={15} color={theme.muted} />
                    </Pressable>
                  ))}
                </View>

                {recents.length > RECENTS_COLLAPSED_COUNT ? (
                  <Pressable
                    onPress={() => setShowAllRecents((v) => !v)}
                    hitSlop={8}
                    style={({ pressed }) => ({ paddingTop: SPACING.md, opacity: pressed ? 0.6 : 1 })}
                  >
                    <T variant="caption" weight="semibold" color={theme.muted}>
                      {showAllRecents
                        ? "Show less"
                        : `Show ${Math.min(recents.length, RECENTS_EXPANDED_COUNT) - RECENTS_COLLAPSED_COUNT} more`}
                    </T>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : null}

          <View style={{ height: SPACING.xxl }} />

          {/* Said once, at the end, in the calmest possible voice.
              
              This is a browser that can be asked to sign transactions, so the
              warning earns its place — but it belonged at the foot of the
              screen, not tucked under Featured where it read as a caption on
              the three sites we ourselves recommend. */}
          <View style={{ height: SPACING.xl }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center" }}>
            <Ionicons name="shield-checkmark-outline" size={13} color={theme.muted} />
            <T variant="caption" color={theme.muted}>
              Only connect your wallet to sites you trust.
            </T>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
