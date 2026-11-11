/** Deterministic native providers and explicitly injected private stores; no production flag or provider network. */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  Provider,
  ProviderAuthInteraction,
  AuthPrompt,
} from "@earendil-works/pi-ai";
import { LocalProviderControl } from "./local-provider.js";
import {
  providerStores,
  ModelDefaults,
} from "../../src/core/runtime/provider-storage.js";
import { nativeModelRuntime } from "../../src/core/runtime/native-model-runtime.js";
import { ProviderSettings } from "../../src/core/runtime/provider-settings.js";
export class AuthProviderControl extends LocalProviderControl {
  syncFails = false;
  refreshes = 0;
  refreshGate?: Promise<void>;
  checkGate?: Promise<void>;
  checking = false;
  callback = new AbortController();
  callbackWon = false;
  prompts: AuthPrompt["type"][] = [];
  responses: string[] = [];
  customLogin?: (interaction: ProviderAuthInteraction) => Promise<void>;
  native = (): Provider => {
    const p = this.provider();
    const models = p
      .getModels()
      .flatMap((m) => [m, { ...m, id: "second", name: "Second local model" }]);
    const ask = async (i: ProviderAuthInteraction, prompt: AuthPrompt) => {
      this.prompts.push(prompt.type);
      const response = await i.prompt(prompt);
      this.responses.push(response);
      return response;
    };
    return {
      ...p,
      name: "Local auth fixture",
      getModels: () => models,
      auth: {
        apiKey: {
          name: "Local test key",
          login: async (i) => {
            await this.customLogin?.(i);
            return {
              type: "api_key",
              key: await ask(i, { type: "secret", message: "Test key" }),
            };
          },
          check: async ({ credential }) => {
            if (credential?.key && this.checkGate) {
              this.checking = true;
              await this.checkGate;
            }
            if (this.syncFails) throw Error("PRIVATE_SYNC_ERROR");
            return credential?.key
              ? { type: "api_key", source: "PRIVATE_SOURCE" }
              : undefined;
          },
          resolve: async ({ credential }) => {
            return credential?.key
              ? { auth: { apiKey: credential.key } }
              : undefined;
          },
        },
        oauth: {
          name: "Local test OAuth",
          login: async (i) => {
            i.notify({
              type: "info",
              message: "Local flow",
              links: [
                {
                  url: "https://example.invalid/info",
                  label: "About local test",
                },
              ],
            });
            i.notify({
              type: "auth_url",
              url: "https://example.invalid/auth",
              instructions: "Do not navigate; local test only",
            });
            i.notify({
              type: "device_code",
              userCode: "LOCAL-CODE",
              verificationUri: "https://example.invalid/device",
              expiresInSeconds: 600,
            });
            i.notify({ type: "progress", message: "Waiting locally" });
            await ask(i, { type: "text", message: "Local project" });
            await ask(i, {
              type: "select",
              message: "Local region",
              options: [
                { id: "local", label: "Local" },
                {
                  id: "other",
                  label: "Other",
                  description: "Another test choice",
                },
              ],
            });
            try {
              await ask(i, {
                type: "manual_code",
                message: "Local manual code",
                signal: this.callback.signal,
              });
            } catch (e) {
              if (i.signal.aborted || !this.callbackWon) throw e;
            }
            return {
              type: "oauth",
              access: "test-access",
              refresh: "test-refresh",
              expires: Date.now() + 3600_000,
            };
          },
          refresh: async (current) => {
            this.refreshes++;
            await this.refreshGate;
            return {
              ...current,
              access: "test-refreshed",
              expires: Date.now() + 3600_000,
            };
          },
          toAuth: async (c) => ({ apiKey: c.access }),
        },
      },
    };
  };
}
export async function localProviderSettings(
  root: string,
  control = new AuthProviderControl(),
  modelsPath: string | null = null,
) {
  await mkdir(root, { recursive: true });
  const stores = await providerStores(root);
  const defaults = new ModelDefaults(root);
  await defaults.load();
  const allowed = (id: string) => id === "pispark-local-test";
  const runtime = await nativeModelRuntime({ ...stores, modelsPath });
  runtime.registerNativeProvider(control.native());
  await runtime.refresh({ allowNetwork: false });
  const settings = new ProviderSettings(
    runtime,
    stores.authPath,
    defaults,
    allowed,
    () => {},
    false,
    stores.deviceId,
    modelsPath,
    stores.modelsStorePath,
    [control.native],
  );
  return {
    settings,
    control,
    stores,
    defaults,
    runtime,
    root,
    authPath: join(root, "auth.json"),
  };
}
