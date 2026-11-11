import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute } from "node:path";
import {
  ModelRuntime,
  type CreateModelRuntimeOptions,
} from "@earendil-works/pi-coding-agent";
import { bundledTransportPatched } from "./transport-gate.js";
import { ProviderError } from "./provider-errors.js";
import type {
  Api,
  Model,
  Context,
  ModelsApiStreamOptions,
  ModelsSimpleStreamOptions,
} from "@earendil-works/pi-ai";

/** Must run before native availability/auth resolution, which may use ambient host credentials. */
export function requireSupportedTransport(version = process.versions.undici) {
  if (!bundledTransportPatched(version))
    throw new ProviderError("network-blocked");
}

/** Explicit paths only. Null disables model configuration and uses Pi's in-memory catalog cache. */
export async function nativeModelRuntime(
  options: CreateModelRuntimeOptions & { modelsPath: string | null },
) {
  requireSupportedTransport();
  if (
    (!options.credentials && !options.authPath) ||
    (options.authPath && !isAbsolute(options.authPath)) ||
    (options.modelsPath &&
      (!isAbsolute(options.modelsPath) ||
        (!options.modelsStore && !options.modelsStorePath))) ||
    (options.modelsStorePath && !isAbsolute(options.modelsStorePath))
  )
    throw new ProviderError("provider-storage");
  if (options.modelsPath) {
    try {
      await access(options.modelsPath, constants.R_OK);
      if (!(await stat(options.modelsPath)).isFile()) throw new Error();
    } catch {
      throw new ProviderError("provider-configuration");
    }
  }
  try {
    const runtime = await ModelRuntime.create({
      ...options,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    requireHealthyModels(runtime);
    return runtime;
  } catch {
    throw new ProviderError("provider-configuration");
  }
}

/** Instance-local public stream seam: Pi calls transformHeaders after native auth, before dispatch.
 * Chain the SDK/extension transform first so cancellation during either async step cannot dispatch.
 * Registration/recomposition may replace providers; this guard belongs to the owned runtime instead.
 */
export function guardModelDispatch(
  runtime: ModelRuntime,
  beforeDispatch: () => void,
) {
  const stream = runtime.stream.bind(runtime);
  const streamSimple = runtime.streamSimple.bind(runtime);
  const transform =
    (
      previous?: ModelsSimpleStreamOptions["transformHeaders"],
    ): NonNullable<ModelsSimpleStreamOptions["transformHeaders"]> =>
    async (headers) => {
      const transformed = previous ? await previous(headers) : headers;
      beforeDispatch();
      return transformed;
    };
  runtime.stream = <TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ModelsApiStreamOptions<TApi>,
  ) =>
    stream(
      model,
      context,
      Object.assign({}, options, {
        transformHeaders: transform(options?.transformHeaders),
      }),
    );
  runtime.streamSimple = (model, context, options) =>
    streamSimple(model, context, {
      ...options,
      transformHeaders: transform(options?.transformHeaders),
    });
}

/** Native errors can contain private configuration, paths, keys and exception causes. Never serialize them. */
export function requireHealthyModels(runtime: ModelRuntime) {
  if (runtime.getError()) throw new ProviderError("provider-configuration");
}
