// app/notifications.tsx
//
// Full-screen notification list (was a bottom sheet — moved to its own
// route per feedback: a proper screen, not a modal card). Everything the
// local incoming-funds/sent watcher has ever fired, persisted per-device in
// SQLite (src/lib/notifications/db.ts). Tapping a card deep-links to the
// right screen, switching account first if the notification was for a
// different one than the currently active account.
import React, { useEffect } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { Screen } from "@/src/components/Screen";
import { T } from "@/src/components/T";
import { useTheme } from "@/src/theme/ThemeProvider";
import { SPACING } from "@/src/theme/tokens";
import { useNotificationFeed, type FeedItem } from "@/src/state/notificationsFeed";
import { useAccounts } from "@/src/state/accounts";

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

export default function NotificationsScreen() {
  const { theme } = useTheme();
  const router = useRouter();

  const items = useNotificationFeed((s) => s.items);
  const markAllRead = useNotificationFeed((s) => s.markAllRead);
  const clear = useNotificationFeed((s) => s.clear);

  useEffect(() => {
    // Mark read as soon as the person actually opens the list — the badge's
    // job is just to say "something happened", not to track per-item state.
    markAllRead().catch(() => {});
  }, [markAllRead]);

  const onOpenItem = async (item: FeedItem) => {
    const accountId = typeof item.data.accountId === "string" ? item.data.accountId : null;
    if (accountId) {
      const accounts = useAccounts.getState().accounts;
      const target = accounts.find((a) => a.id === accountId);
      if (target && target.id !== useAccounts.getState().activeAccountId) {
        await useAccounts.getState().switchAccount(target.id).catch(() => {});
      }
    }

    const route = typeof item.data.route === "string" ? item.data.route : "/(tabs)/wallet";
    router.replace(route as any);
  };

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <T weight="bold" style={{ fontSize: 28, lineHeight: 33, letterSpacing: -0.6 }}>
            Notifications
          </T>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            {items.length ? (
              <Pressable onPress={() => clear()} hitSlop={8}>
                <T variant="caption" weight="semibold" color={theme.muted}>
                  Clear all
                </T>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => ({
                width: 38,
                height: 38,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.surface2,
                opacity: pressed ? 0.85 : 1,
              })}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={18} color={theme.text} />
            </Pressable>
          </View>
        </View>

        <View style={{ height: SPACING.xl }} />

        {items.length === 0 ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: SPACING.sm, paddingBottom: 80 }}>
            <View
              style={{
                width: 60,
                height: 60,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.surface2,
              }}
            >
              <Ionicons name="notifications-outline" size={26} color={theme.muted} />
            </View>
            <T weight="semibold">Nothing yet</T>
            <T color={theme.muted} style={{ textAlign: "center", maxWidth: 260 }}>
              You&apos;ll see it here the moment ETN or a token moves in or out of one of your accounts.
            </T>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: SPACING.xxl }}>
            <View style={{ gap: 2 }}>
              {items.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => onOpenItem(item)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 12,
                    paddingVertical: SPACING.md,
                    opacity: pressed ? 0.65 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      marginTop: 7,
                      backgroundColor: item.read ? "transparent" : theme.accent,
                    }}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T weight="semibold" numberOfLines={1}>
                      {item.title}
                    </T>
                    <T color={theme.muted} numberOfLines={2}>
                      {item.body}
                    </T>
                  </View>
                  <T variant="caption" color={theme.muted}>
                    {timeAgo(item.createdAt)}
                  </T>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    </Screen>
  );
}
