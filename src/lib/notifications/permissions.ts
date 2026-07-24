// src/lib/notifications/permissions.ts
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let channelReady = false;

async function ensureAndroidChannel() {
  if (Platform.OS !== "android" || channelReady) return;
  await Notifications.setNotificationChannelAsync("transactions", {
    name: "Transactions",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 120, 80, 120],
    lightColor: "#4DEE54",
  });
  channelReady = true;
}

export async function getNotificationPermissionStatus(): Promise<Notifications.PermissionStatus> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

export async function requestNotificationPermission(): Promise<boolean> {
  await ensureAndroidChannel();

  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === "granted") return true;

  const requested = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });

  return requested.status === "granted";
}
