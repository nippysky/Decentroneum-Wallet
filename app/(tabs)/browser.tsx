// app/(tabs)/browser.tsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { FONT } from "@/src/theme/typography";
import { Image, Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import { useTheme } from "@/src/theme/ThemeProvider";
import { Screen } from "@/src/components/Screen";
import { T } from "@/src/components/T";
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

function faviconUrl(siteUrl: string) {
  try {
    const d = new URL(siteUrl).host;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`;
  } catch {
    return "";
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
  return safeParseRecents(raw);
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
  const items = await readRecents();
  const now = Date.now();

  const next: RecentItem[] = [{ url: clean, title, lastVisited: now }, ...items.filter((x) => x.url !== clean)];
  await writeRecents(next);
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
    <Screen>
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
            <Ionicons name="globe-outline" size={18} color={theme.muted} />
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
            <Pressable
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

          {/* Suggestions */}
          {query ? (
            <>
              <View style={{ height: SPACING.md }} />
              <View>
                {suggestions.map((s) => (
                  <Pressable
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
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: RADIUS.md,
                          backgroundColor: theme.surface2,
                          alignItems: "center",
                          justifyContent: "center",
                          overflow: "hidden",
                        }}
                      >
                        {faviconUrl(s.url) ? (
                          <Image source={{ uri: faviconUrl(s.url) }} style={{ width: 18, height: 18 }} resizeMode="contain" />
                        ) : (
                          <Ionicons name="link-outline" size={18} color={theme.text} />
                        )}
                      </View>

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
              <T weight="bold" style={{ fontSize: 18 }}>Featured</T>
              <T variant="caption" color={theme.muted}>
                Curated
              </T>
            </View>

            <View style={{ height: SPACING.sm }} />

            <View>
              {FEATURED.map((d) => (
                <Pressable
                  key={d.url}
                  onPress={() => go(d.url)}
                  style={({ pressed }) => ({
                    paddingVertical: SPACING.sm,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: RADIUS.md,
                        backgroundColor: theme.surface2,
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                      }}
                    >
                      {faviconUrl(d.url) ? (
                        <Image source={{ uri: faviconUrl(d.url) }} style={{ width: 18, height: 18 }} resizeMode="contain" />
                      ) : (
                        <Ionicons name="link-outline" size={18} color={theme.text} />
                      )}
                    </View>

                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T weight="semibold">{d.name}</T>
                      <T variant="caption" color={theme.muted} numberOfLines={1}>
                        {d.url.replace(/^https?:\/\//, "")}
                      </T>
                    </View>
                  </View>
                </Pressable>
              ))}
            </View>

            <View style={{ height: SPACING.sm }} />

            <T variant="caption" color={theme.muted}>
              Only connect to sites you trust.
            </T>
          </View>

          <View style={{ height: SPACING.xxl }} />

          {/* Recents */}
          <View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <T weight="bold" style={{ fontSize: 18 }}>Recents</T>
              <Pressable onPress={clearRecents} disabled={recents.length === 0} hitSlop={8}>
                <T variant="caption" weight="semibold" color={recents.length ? theme.muted : theme.border}>
                  Clear
                </T>
              </Pressable>
            </View>

            <View style={{ height: SPACING.sm }} />

            {recents.length ? (
              <View>
                {visibleRecents.map((r) => (
                  <Pressable
                    key={r.url}
                    onPress={() => go(r.url)}
                    style={({ pressed }) => ({
                      paddingVertical: SPACING.sm,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: RADIUS.md,
                          backgroundColor: theme.surface2,
                          alignItems: "center",
                          justifyContent: "center",
                          overflow: "hidden",
                        }}
                      >
                        {faviconUrl(r.url) ? (
                          <Image source={{ uri: faviconUrl(r.url) }} style={{ width: 18, height: 18 }} resizeMode="contain" />
                        ) : (
                          <Ionicons name="time-outline" size={18} color={theme.text} />
                        )}
                      </View>

                      <View style={{ flex: 1, minWidth: 0 }}>
                        <T weight="semibold" numberOfLines={1}>
                          {r.title || new URL(r.url).host}
                        </T>
                        <T variant="caption" color={theme.muted} numberOfLines={1}>
                          {timeAgo(r.lastVisited)} • {r.url.replace(/^https?:\/\//, "")}
                        </T>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : (
              <T color={theme.muted}>No recent sites yet. Pull to refresh anytime.</T>
            )}

            {recents.length > RECENTS_COLLAPSED_COUNT ? (
              <Pressable
                onPress={() => setShowAllRecents((v) => !v)}
                hitSlop={8}
                style={({ pressed }) => ({ paddingTop: SPACING.xs, opacity: pressed ? 0.6 : 1 })}
              >
                <T variant="caption" weight="semibold" color={theme.muted}>
                  {showAllRecents ? "Show less" : `Show ${Math.min(recents.length, RECENTS_EXPANDED_COUNT) - RECENTS_COLLAPSED_COUNT} more`}
                </T>
              </Pressable>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
