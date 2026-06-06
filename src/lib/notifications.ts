import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let cachedPermission: "granted" | "denied" | "unknown" = "unknown";

export async function ensureNotificationPermission(): Promise<boolean> {
  if (cachedPermission === "granted") return true;
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const result = await requestPermission();
      granted = result === "granted";
    }
    cachedPermission = granted ? "granted" : "denied";
    return granted;
  } catch (err) {
    console.error("[notifications] permission check failed:", err);
    return false;
  }
}

export async function notify(title: string, body?: string): Promise<void> {
  const ok = await ensureNotificationPermission();
  if (!ok) return;
  try {
    sendNotification({ title, body });
  } catch (err) {
    console.error("[notifications] send failed:", err);
  }
}
