import { existsSync, readFileSync } from "node:fs";
import { writeAtomic } from "../personas/store.js";
import type { HostSettings } from "../../contract/protocol.js";
import { RuntimeError } from "./errors.js";

/** PiSpark's own settings, in `<home>/settings.json`. Missing or unreadable values use the defaults. */
export const DEFAULT_SETTINGS: HostSettings = { maxRunning: 8, schedulesPaused: false };
export const MAX_RUNNING = 32;

const validRunning = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= MAX_RUNNING;

export function readSettings(path: string): HostSettings {
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS };
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<HostSettings>;
    return {
      maxRunning: validRunning(value.maxRunning) ? value.maxRunning : DEFAULT_SETTINGS.maxRunning,
      schedulesPaused: value.schedulesPaused === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** A change from a client: one or more known keys, values in range. */
export function validSettings(value: unknown): Partial<HostSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RuntimeError("invalid-input");
  const change = value as Partial<HostSettings>;
  const keys = Object.keys(change);
  if (
    !keys.length ||
    keys.some((key) => key !== "maxRunning" && key !== "schedulesPaused") ||
    ("maxRunning" in change && !validRunning(change.maxRunning)) ||
    ("schedulesPaused" in change && typeof change.schedulesPaused !== "boolean")
  )
    throw new RuntimeError("invalid-input");
  return {
    ...(change.maxRunning !== undefined ? { maxRunning: change.maxRunning } : {}),
    ...(change.schedulesPaused !== undefined ? { schedulesPaused: change.schedulesPaused } : {}),
  };
}

export function writeSettings(path: string, settings: HostSettings): void {
  try {
    writeAtomic(path, JSON.stringify(settings, null, 2) + "\n");
  } catch {
    throw new RuntimeError("storage");
  }
}
