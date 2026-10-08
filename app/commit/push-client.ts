"use client";

import { createClient } from "@/lib/supabase/client";

export type PushSupport = "unsupported" | "unconfigured" | "denied" | "available";

const SUBSCRIPTIONS_URL = "/api/push/subscriptions";

/** Whether this browser can be offered commitment notifications. */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
    return "unsupported";
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return "unconfigured";
  if (Notification.permission === "denied") return "denied";
  return "available";
}

/**
 * Asks permission, subscribes this browser and registers it for the signed-in
 * user. Call from a user gesture (a button click): browsers block permission
 * prompts that are not. Returns false if permission was not granted.
 */
export async function enablePushNotifications(): Promise<boolean> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (pushSupport() !== "available" || !publicKey) return false;
  if ((await Notification.requestPermission()) !== "granted") return false;
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(publicKey),
    }));
  await send("POST", subscription.toJSON());
  return true;
}

/** Unregisters and unsubscribes this browser. */
export async function disablePushNotifications(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await send("DELETE", { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

/** Whether this browser is currently subscribed. */
export async function isPushEnabled(): Promise<boolean> {
  if (pushSupport() !== "available" || Notification.permission !== "granted") return false;
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  return (await registration?.pushManager.getSubscription()) != null;
}

async function send(method: "POST" | "DELETE", body: unknown): Promise<void> {
  const { data } = await createClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in again to change notifications");
  const response = await fetch(SUBSCRIPTIONS_URL, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Notification settings could not be saved (${response.status})`);
}

function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
