import { randomUUID } from "node:crypto";
import { readFile, open, rename, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ModelChoice } from "../provider-protocol.js";
import { ProviderError } from "./provider-errors.js";

/** Host metadata, not a credential backend. Caller holds the settings-directory ownership lock. */
export async function providerStores(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, "installation.json");
  let deviceId: string;
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (
      typeof value.deviceId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(value.deviceId)
    )
      throw new ProviderError("provider-storage");
    deviceId = value.deviceId;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new ProviderError("provider-storage");
    deviceId = randomUUID();
    await writeMetadata(path, { deviceId });
  }
  return {
    authPath: join(root, "auth.json"),
    modelsStorePath: join(root, "models-store.json"),
    deviceId,
  };
}
async function writeMetadata(path: string, value: unknown) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
}
export function validChoice(value: unknown): value is ModelChoice {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).length === 2 &&
    typeof v.provider === "string" &&
    v.provider.length > 0 &&
    v.provider.length <= 128 &&
    typeof v.id === "string" &&
    v.id.length > 0 &&
    v.id.length <= 256
  );
}
export class ModelDefaults {
  value: ModelChoice | null = null;
  constructor(private readonly root: string) {}
  async load() {
    try {
      const text = await readFile(join(this.root, "settings.json"), "utf8");
      if (text.length > 4096) throw new Error();
      const data = JSON.parse(text);
      if (
        data.version !== 1 ||
        (data.defaultModel !== null && !validChoice(data.defaultModel))
      )
        throw new Error();
      this.value = data.defaultModel;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new ProviderError("provider-storage");
    }
  }
  async save(value: ModelChoice | null) {
    const temporary = join(this.root, `settings-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(
          JSON.stringify({ version: 1, defaultModel: value }),
        );
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, join(this.root, "settings.json"));
      this.value = value ? { ...value } : null;
    } catch {
      throw new ProviderError("provider-storage");
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
}
