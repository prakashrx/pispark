/** Notifications on a device (design set 9): what can be told, and what a device asks and gets. */
export type NotifyEvent = "needs-you" | "failed" | "finished" | "schedule-failed";
export const NOTIFY_EVENTS: readonly NotifyEvent[] = ["needs-you", "failed", "finished", "schedule-failed"];

/** This device's notifications, as the server knows them (asked with the device's push endpoint). */
export interface NotificationState {
  /** The application server key a browser subscribes with (VAPID, base64url). */
  publicKey: string;
  /** This endpoint is subscribed, and what it is told. */
  subscribed: boolean;
  events: NotifyEvent[];
}

/** What a notification says, read by the service worker when a push (with no content) arrives. */
export interface PendingNotification {
  title: string;
  body: string;
  /** Where tapping it goes, inside PiSpark (`/#/s/<id>`). */
  url: string;
  /** Replaces an earlier one about the same thing. */
  tag: string;
}

export function validEvents(value: unknown): value is NotifyEvent[] {
  return Array.isArray(value) && value.length <= NOTIFY_EVENTS.length && value.every((event) => NOTIFY_EVENTS.includes(event));
}
