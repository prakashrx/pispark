import { mkdirSync, readFileSync } from "node:fs";
import { writeAtomic } from "../core/files.js";
import { join } from "node:path";
import { NOTIFY_EVENTS, type NotifyEvent, type PendingNotification } from "../contract/notification-protocol.js";
import type { SessionInfo } from "../contract/protocol.js";
import { PushKeys } from "./push.js";

interface Subscription {
  endpoint: string;
  /** The paired device it belongs to, or `local` for this computer. Removed with the device. */
  device: string;
  events: NotifyEvent[];
  createdAt: string;
}
interface Seen {
  waiting: boolean;
  status: string;
  workingSince?: string;
  schedule: boolean;
}
const LONG_RUN_MS = 2 * 60_000;
const PAGE_TTL_MS = 90_000;

/**
 * Notifications on devices (design set 9, G-13): it watches the session list for a session that
 * starts needing you, a run that fails, a long run that finishes and a schedule run that fails, and
 * tells each subscribed device that asked for it, unless PiSpark is open and in view there (the nudge
 * says it then). A push carries nothing; the device's service worker reads what to show from here.
 */
export class Notifications {
  private madeKeys?: PushKeys;
  /** Made (and kept under the data folder) the first time a device asks. */
  get keys(): PushKeys {
    return (this.madeKeys ??= new PushKeys(join(this.folder, "vapid.pem")));
  }
  private subscriptions: Subscription[];
  private readonly pending = new Map<string, PendingNotification[]>();
  /** Pages in view, per device: page id → when its word expires. */
  private readonly presence = new Map<string, Map<string, number>>();
  private seen?: Map<string, Seen>;

  constructor(
    private readonly folder: string,
    private readonly list: () => SessionInfo[],
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    try {
      const saved = JSON.parse(readFileSync(join(folder, "subscriptions.json"), "utf8")) as Subscription[];
      this.subscriptions = Array.isArray(saved) ? saved.filter((each) => typeof each?.endpoint === "string") : [];
    } catch {
      this.subscriptions = [];
    }
  }

  /** Whether anyone could be told anything: the session list is watched only then. */
  get active(): boolean {
    return this.subscriptions.length > 0;
  }
  /** A device's own subscription: a device acts only on the endpoints it subscribed. */
  private mine(device: string, endpoint: string | undefined): Subscription | undefined {
    return this.subscriptions.find((each) => each.device === device && each.endpoint === endpoint);
  }
  state(device: string, endpoint: string | undefined): { subscribed: boolean; events: NotifyEvent[] } {
    const subscription = this.mine(device, endpoint);
    return { subscribed: !!subscription, events: subscription?.events ?? [...NOTIFY_EVENTS] };
  }
  subscribe(device: string, endpoint: string, events: NotifyEvent[]): void {
    this.subscriptions = [
      ...this.subscriptions.filter((each) => each.endpoint !== endpoint),
      { endpoint, device, events: [...new Set(events)], createdAt: new Date(this.now()).toISOString() },
    ].slice(-64);
    this.save();
  }
  unsubscribe(device: string, endpoint: string): void {
    const subscription = this.mine(device, endpoint);
    if (!subscription) return;
    this.subscriptions = this.subscriptions.filter((each) => each !== subscription);
    this.pending.delete(endpoint);
    this.save();
  }
  /** A paired device was removed (or all of them, `undefined`): its subscriptions go with it. */
  forgetDevice(device?: string): void {
    const before = this.subscriptions.length;
    this.subscriptions = this.subscriptions.filter((each) => (device === undefined ? each.device === "local" : each.device !== device));
    if (this.subscriptions.length !== before) this.save();
  }
  /** A page on a device is (or isn't) in view; it says so again while it stays in view. */
  present(device: string, page: string, visible: boolean): void {
    const pages = this.presence.get(device) ?? new Map<string, number>();
    if (visible) pages.set(page, this.now() + PAGE_TTL_MS);
    else pages.delete(page);
    if (pages.size) this.presence.set(device, pages);
    else this.presence.delete(device);
  }
  private inView(device: string): boolean {
    const pages = this.presence.get(device);
    if (!pages) return false;
    for (const [page, until] of pages) if (until < this.now()) pages.delete(page);
    return pages.size > 0;
  }
  /** What a device's service worker shows for the pushes it got; read once. */
  take(device: string, endpoint: string): PendingNotification[] {
    if (!this.mine(device, endpoint)) return [];
    const list = this.pending.get(endpoint) ?? [];
    this.pending.delete(endpoint);
    return list;
  }
  /** "Send a test": to this endpoint, whether or not PiSpark is in view. */
  async test(device: string, endpoint: string): Promise<boolean> {
    if (!this.mine(device, endpoint)) return false;
    this.queue(endpoint, { title: "PiSpark", body: "Notifications work on this device.", url: "/#/", tag: "test" });
    return (await this.keys.send(endpoint, this.fetcher)) === "sent";
  }

  /** The session list changed: tell what newly happened. The first look only notes how things are. */
  sessionsChanged(): void {
    const sessions = this.list();
    const previous = this.seen;
    this.seen = new Map(
      sessions.map((s) => [s.id, { waiting: !!s.waiting, status: s.status, ...(s.workingSince ? { workingSince: s.workingSince } : {}), schedule: !!s.schedule }]),
    );
    if (!previous) return;
    for (const session of sessions) {
      const before = previous.get(session.id);
      if (!before) continue;
      const name = session.title ?? "A session";
      const ran = ["running", "cancelling", "queued"].includes(before.status);
      if (!before.waiting && session.waiting)
        void this.tell("needs-you", session.id, name, session.question ? `Needs you: ${session.question}` : "Needs you");
      else if (ran && session.status === "error")
        void this.tell(session.schedule ? "schedule-failed" : "failed", session.id, name, session.schedule ? "A scheduled run failed" : "The run failed");
      else if (ran && session.status === "idle" && before.workingSince && this.now() - Date.parse(before.workingSince) >= LONG_RUN_MS)
        void this.tell("finished", session.id, name, `Finished after ${Math.round((this.now() - Date.parse(before.workingSince)) / 60_000)} min`);
    }
  }

  private async tell(event: NotifyEvent, sessionId: string, title: string, body: string): Promise<void> {
    const to = this.subscriptions.filter((each) => each.events.includes(event) && !this.inView(each.device));
    await Promise.all(
      to.map(async ({ endpoint, device }) => {
        this.queue(endpoint, { title, body, url: `/#/s/${sessionId}`, tag: `${sessionId}:${event}` });
        if ((await this.keys.send(endpoint, this.fetcher)) === "gone") this.unsubscribe(device, endpoint);
      }),
    );
  }
  private queue(endpoint: string, notification: PendingNotification): void {
    const list = (this.pending.get(endpoint) ?? []).filter((each) => each.tag !== notification.tag);
    this.pending.set(endpoint, [...list, notification].slice(-10));
  }
  private save(): void {
    try {
      mkdirSync(this.folder, { recursive: true, mode: 0o700 });
      writeAtomic(join(this.folder, "subscriptions.json"), JSON.stringify(this.subscriptions, null, 2));
    } catch {
      /* kept in memory; written again with the next change */
    }
  }
}
