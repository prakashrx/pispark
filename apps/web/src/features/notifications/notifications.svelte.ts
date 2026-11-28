import { NOTIFY_EVENTS, type NotificationState, type NotifyEvent } from "../../../../server/src/contract/notification-protocol";
import { RequestFailed, requestJson } from "../workspace/transport";

/**
 * Notifications on this device (design set 9): whether this browser can show them, whether it may,
 * whether it is subscribed and to what. A subscription is the browser's push endpoint, given to
 * PiSpark; pushes carry nothing, and the service worker reads what to show from PiSpark.
 */
export type Support = "yes" | "home-screen" | "no";

const OFFER_KEY = "pispark.notifications.offer";

class DeviceNotifications {
  /** "home-screen": an iPhone or iPad only shows them from the app added to the Home Screen. */
  support = $state<Support>("no");
  permission = $state<NotificationPermission>("default");
  subscribed = $state(false);
  events = $state<NotifyEvent[]>([...NOTIFY_EVENTS]);
  busy = $state(false);
  error = $state("");
  /** The person said Not now to the offer in the nudge. */
  declined = $state(false);
  private publicKey = "";
  private loaded?: Promise<void>;

  constructor() {
    if (typeof window === "undefined") return;
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone =
      (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches) ||
      (navigator as { standalone?: boolean }).standalone === true;
    const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;
    this.support = capable ? "yes" : ios && !standalone ? "home-screen" : "no";
    this.permission = "Notification" in window ? Notification.permission : "denied";
    // Browser storage may be blocked (some private modes): then the offer simply isn't remembered.
    try {
      this.declined = localStorage.getItem(OFFER_KEY) === "no";
    } catch {
      this.declined = false;
    }
  }
  /** Whether the nudge may offer them: possible here, not decided yet, never asked away. */
  get offerable(): boolean {
    return this.support === "yes" && this.permission === "default" && !this.subscribed && !this.declined;
  }
  decline() {
    this.declined = true;
    try {
      localStorage.setItem(OFFER_KEY, "no");
    } catch {
      /* not remembered past this page */
    }
  }

  /** What PiSpark knows about this device's subscription. */
  load(): Promise<void> {
    return (this.loaded ??= this.read());
  }
  private async read() {
    if (this.support !== "yes") return;
    this.permission = await permission();
    try {
      const subscription = await this.subscription();
      const state = await post<NotificationState>("state", subscription ? { endpoint: subscription.endpoint } : {});
      this.publicKey = typeof state.publicKey === "string" ? state.publicKey : "";
      this.subscribed = state.subscribed === true;
      if (Array.isArray(state.events)) this.events = state.events;
    } catch {
      /* the page says what it can; turning on tries again */
    }
  }
  private async subscription(): Promise<PushSubscription | null> {
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager.getSubscription()) ?? null;
  }

  /** Turn them on for this device: the browser asks first. */
  async enable(): Promise<boolean> {
    if (this.support !== "yes") return false;
    this.busy = true;
    this.error = "";
    try {
      this.permission = await Notification.requestPermission();
      if (this.permission !== "granted") return false;
      await this.load();
      if (!this.publicKey) this.publicKey = (await post<NotificationState>("state", {})).publicKey;
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64urlBytes(this.publicKey) }));
      await post("subscribe", { endpoint: subscription.endpoint, events: this.events });
      this.subscribed = true;
      return true;
    } catch (failure) {
      this.error = `Couldn’t turn notifications on: ${(failure as Error).message}`;
      return false;
    } finally {
      this.busy = false;
    }
  }
  async disable() {
    this.busy = true;
    this.error = "";
    try {
      const subscription = await this.subscription();
      if (subscription) {
        await post("unsubscribe", { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      this.subscribed = false;
    } catch (failure) {
      this.error = (failure as Error).message;
    } finally {
      this.busy = false;
    }
  }
  async setEvent(event: NotifyEvent, on: boolean) {
    const events = on ? [...new Set([...this.events, event])] : this.events.filter((each) => each !== event);
    this.events = NOTIFY_EVENTS.filter((each) => events.includes(each));
    const subscription = await this.subscription();
    if (subscription && this.subscribed) await post("subscribe", { endpoint: subscription.endpoint, events: this.events }).catch(() => {});
  }
  async test(): Promise<boolean> {
    const subscription = await this.subscription();
    if (!subscription) return false;
    return (await post<{ sent: boolean }>("test", { endpoint: subscription.endpoint })).sent;
  }
}

export const deviceNotifications = new DeviceNotifications();

async function post<T = unknown>(path: string, body: unknown): Promise<T> {
  // Bounded in size and time like every other request; a refusal reads as one.
  try {
    return await requestJson<T>(`/api/notifications/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw error instanceof RequestFailed ? new Error(error.status === 400 ? "refused" : `error ${error.status}`) : error;
  }
}
/** What the browser allows now; the Permissions API where it answers (it follows a change made in the browser's settings). */
async function permission(): Promise<NotificationPermission> {
  try {
    const state = (await navigator.permissions.query({ name: "notifications" })).state;
    return state === "prompt" ? "default" : state;
  } catch {
    return Notification.permission;
  }
}
function base64urlBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/**
 * This page tells PiSpark while it is in view, so a device where PiSpark is open and looked at gets
 * the nudge instead of a notification. A tapped notification opens its session here.
 */
export function followPresence(): () => void {
  const page = crypto.randomUUID();
  const say = (visible: boolean) => {
    const body = JSON.stringify({ page, visible });
    if (!visible && navigator.sendBeacon)
      navigator.sendBeacon("/api/notifications/presence", new Blob([body], { type: "application/json" }));
    else
      void fetch("/api/notifications/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
  };
  const now = () => say(document.visibilityState === "visible");
  const timer = setInterval(() => document.visibilityState === "visible" && say(true), 45_000);
  const gone = () => say(false);
  const opened = (event: MessageEvent) => {
    if (event.data?.type === "pispark:open" && typeof event.data.hash === "string" && event.data.hash.startsWith("#/"))
      location.hash = event.data.hash;
  };
  document.addEventListener("visibilitychange", now);
  window.addEventListener("pagehide", gone);
  navigator.serviceWorker?.addEventListener("message", opened);
  now();
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", now);
    window.removeEventListener("pagehide", gone);
    navigator.serviceWorker?.removeEventListener("message", opened);
    gone();
  };
}
