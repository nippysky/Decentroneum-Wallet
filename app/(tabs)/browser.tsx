// app/(tabs)/browser.tsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Image, Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";

import { useTheme } from "@/src/theme/ThemeProvider";
import { Screen } from "@/src/ui/Screen";
import { T } from "@/src/ui/T";
import { useSession } from "@/src/state/session";

const FEATURED = [
  { name: "Decentroneum", url: "https://decentroneum.com" },
  { name: "Panthart", url: "https://panth.art" },
  { name: "ElectroSwap", url: "https://electroswap.io" },
  { name: "Block Explorer", url: "https://blockexplorer.electroneum.com" },
];

type RecentItem = {
  url: string; // clean url (no dw param)
  title?: string;
  lastVisited: number;
};

// SecureStore keys must be alphanumeric + . - _
const RECENTS_KEY = "dw.browser.recents.v1";
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

async function readRecents(): Promise<RecentItem[]> {
  const raw = await SecureStore.getItemAsync(RECENTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as RecentItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeRecents(items: RecentItem[]) {
  await SecureStore.setItemAsync(RECENTS_KEY, JSON.stringify(items.slice(0, MAX_RECENTS)));
}

async function upsertRecent(url: string, title?: string) {
  const clean = stripDw(url);
  const items = await readRecents();
  const now = Date.now();

  const next: RecentItem[] = [
    { url: clean, title, lastVisited: now },
    ...items.filter((x) => x.url !== clean),
  ];

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

  const isUnlocked = useSession((s) => s.isUnlocked);

  const refreshRecents = useCallback(async () => {
    const items = await readRecents();
    setRecents(items);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
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
      // lightning-fast feel
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
    await SecureStore.deleteItemAsync(RECENTS_KEY);
    setRecents([]);
  }, []);

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
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onPullRefresh}
            tintColor={theme.muted}
          />
        }
      >
        <View style={{ gap: 14 }}>
          <T variant="h2" weight="bold">
            Browser
          </T>

          {/* URL bar */}
          <View
            style={{
              borderRadius: 18,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.card,
              paddingHorizontal: 12,
              paddingVertical: 10,
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
                color: theme.text,
                fontSize: 16,
                fontFamily: "Lexend_500Medium",
                paddingVertical: 6,
              }}
            />
            <Pressable
              onPress={() => go(value)}
              style={({ pressed }) => [
                {
                  width: 40,
                  height: 40,
                  borderRadius: 14,
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

          {/* Suggestions (while typing) */}
          {query ? (
            <View
              style={{
                borderRadius: 22,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.card,
                overflow: "hidden",
              }}
            >
              {suggestions.map((s, idx) => (
                <Pressable
                  key={`${s.kind}:${s.url}`}
                  onPress={() => go(s.url)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    opacity: pressed ? 0.92 : 1,
                    borderTopWidth: idx === 0 ? 0 : 1,
                    borderTopColor: theme.border,
                  })}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: theme.border,
                        backgroundColor: theme.bg,
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

                    <View style={{ flex: 1 }}>
                      <T weight="semibold" numberOfLines={1}>
                        {s.name}
                      </T>
                      <T variant="caption" color={theme.muted} numberOfLines={1}>
                        {s.meta} • {s.url.replace(/^https?:\/\//, "")}
                      </T>
                    </View>
                  </View>

                  <Ionicons name="chevron-forward" size={18} color={theme.muted} />
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* Recents */}
          <View style={{ gap: 10, marginTop: query ? 2 : 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <T weight="bold">Recents</T>
              <Pressable onPress={clearRecents} disabled={recents.length === 0}>
                <T variant="caption" color={recents.length ? theme.muted : theme.border}>
                  Clear
                </T>
              </Pressable>
            </View>

            {recents.length ? (
              <View
                style={{
                  borderRadius: 22,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.card,
                  overflow: "hidden",
                }}
              >
                {recents.slice(0, 10).map((r, idx) => (
                  <Pressable
                    key={r.url}
                    onPress={() => go(r.url)}
                    style={({ pressed }) => ({
                      paddingHorizontal: 16,
                      paddingVertical: 14,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      opacity: pressed ? 0.92 : 1,
                      borderTopWidth: idx === 0 ? 0 : 1,
                      borderTopColor: theme.border,
                    })}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
                      <View
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 16,
                          borderWidth: 1,
                          borderColor: theme.border,
                          backgroundColor: theme.bg,
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

                      <View style={{ flex: 1 }}>
                        <T weight="semibold" numberOfLines={1}>
                          {r.title || new URL(r.url).host}
                        </T>
                        <T variant="caption" color={theme.muted} numberOfLines={1}>
                          {timeAgo(r.lastVisited)} • {r.url.replace(/^https?:\/\//, "")}
                        </T>
                      </View>
                    </View>

                    <Ionicons name="chevron-forward" size={18} color={theme.muted} />
                  </Pressable>
                ))}
              </View>
            ) : (
              <View
                style={{
                  borderRadius: 22,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.card,
                  padding: 16,
                }}
              >
                <T color={theme.muted}>No recent sites yet. Pull to refresh anytime.</T>
              </View>
            )}
          </View>

          {/* Featured */}
          <View style={{ gap: 10, marginTop: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <T weight="bold">Featured</T>
              <T variant="caption" color={theme.muted}>
                Curated
              </T>
            </View>

            <View
              style={{
                borderRadius: 22,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.card,
                overflow: "hidden",
              }}
            >
              {FEATURED.map((d, idx) => (
                <Pressable
                  key={d.url}
                  onPress={() => go(d.url)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    opacity: pressed ? 0.92 : 1,
                    borderTopWidth: idx === 0 ? 0 : 1,
                    borderTopColor: theme.border,
                  })}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: theme.border,
                        backgroundColor: theme.bg,
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

                    <View style={{ flex: 1 }}>
                      <T weight="semibold">{d.name}</T>
                      <T variant="caption" color={theme.muted} numberOfLines={1}>
                        {d.url.replace(/^https?:\/\//, "")}
                      </T>
                    </View>
                  </View>

                  <Ionicons name="chevron-forward" size={18} color={theme.muted} />
                </Pressable>
              ))}
            </View>

            <T variant="caption" color={theme.muted} style={{ marginTop: 2 }}>
              Only connect to sites you trust.
            </T>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
