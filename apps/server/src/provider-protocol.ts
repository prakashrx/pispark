/** Safe browser projections only. Never return SDK provider/model/credential objects. */
export interface ModelChoice {
  provider: string;
  id: string;
}
export interface CatalogModel {
  id: string;
  name: string;
  input: string[];
  reasoning: boolean;
  contextWindow: number;
  available: boolean;
}
export interface ProviderInfo {
  id: string;
  name: string;
  methods: { type: "api_key" | "oauth"; label: string; interactive: boolean }[];
  models: CatalogModel[];
  configured: boolean;
  stored: boolean;
  source: "stored" | "host" | "none";
}
export interface ProviderCatalog {
  providers: ProviderInfo[];
  defaultModel: ModelChoice | null;
  networkBlocked: boolean;
}
export type AuthPromptView = { id: string; message: string } & (
  | { type: "text" | "secret" | "manual_code"; placeholder?: string }
  | {
      type: "select";
      options: { id: string; label: string; description?: string }[];
    }
);
export type AuthEventView =
  | {
      type: "info" | "progress";
      message: string;
      links?: { url: string; label?: string }[];
    }
  | { type: "auth_url"; url: string; instructions?: string }
  | {
      type: "device_code";
      userCode: string;
      verificationUri: string;
      expiresInSeconds?: number;
    };
export interface AuthView {
  id: string;
  provider: string;
  method: "api_key" | "oauth";
  state: "pending" | "saved" | "saved-sync-failed" | "cancelled" | "failed";
  prompt?: AuthPromptView;
  events: AuthEventView[];
}
export const providerErrorMessages: Record<string, string> = {
  "network-blocked":
    "Provider operations are disabled on this host: install an owner-approved security-patched Node runtime bundling undici >=6.29.1 <7, >=7.30.1 <8, or >=8.12.2. The npm override does not patch Node. No credentials were requested.",
  "provider-configuration":
    "Native model configuration or catalog restoration failed. Ask the host owner to check its configuration and cache, then refresh or restart. Model selection is disabled; private error details are not returned.",
  "provider-storage":
    "PiSpark could not read or save its private settings. Check host storage permissions; no successful save is confirmed.",
  "provider-unavailable":
    "This model or provider is unavailable. Connect its provider or ask the host owner to review configuration. The saved choice was not replaced.",
  "provider-busy":
    "Another provider operation is still running. Wait for it to finish.",
  "auth-invalid":
    "This sign-in prompt is no longer current or is owned by another client. Close and start again.",
  "auth-limit":
    "Sign-in capacity or time limit reached. Close this dialog and try again later.",
  "provider-failed":
    "The native provider operation failed. It may require a host-local browser or callback port; use Pi's manual prompt when offered. No successful save is confirmed.",
  "removed-sync-failed":
    "Stored credentials were removed, but local synchronization failed. Reload status before continuing. Provider grants and host configuration are unchanged.",
};
