import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { SessionRuntime } from '../../src/runtime/session-runtime.js';
import { LocalProviderControl } from './local-provider.js';
import { createSessionServices } from '../../src/runtime/configuration.js';
import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import { ExtensionUI } from '../../src/extensions/extension-ui.js';
import { unsupported } from '../../src/runtime/errors.js';
import type { Setup } from '../../src/personas/resolve.js';

// HOME/USERPROFILE/PI_CODING_AGENT_DIR point at a planted terminal Pi setup; none of it may load.
const root = process.argv[2]!;
const provider = new LocalProviderControl(); provider.automatic = true;
const runtime = new SessionRuntime({ home: join(root, 'pispark'), fixedModel: { provider: provider.provider, id: 'deterministic' } });
const a = await runtime.create({ folder: join(root, 'cwd') });
assert.equal((await runtime.start(a.id, 'probe').completion).outcome, 'completed');
assert.equal(provider.requests[0]!.apiKey, 'pispark-local-keyless');
assert.doesNotMatch(JSON.stringify(provider.requests[0]!.context), /FORBIDDEN/);
await runtime.shutdown();

// Direct SDK boundary test: native extension commands fail, rather than fake success, on replacement/reload.
const nativeExtension = join(root, 'explicit.mjs');
await writeFile(nativeExtension, `export default (pi)=>{pi.events.on('probe',()=>pi.events.emit('observed',{}));pi.on('session_start',(_e,ctx)=>{if(!ctx.hasUI||ctx.mode!=='rpc') throw Error('UI missing')});for(const name of ['reload','newSession','fork','switchSession','navigateTree']) pi.registerCommand(name,{handler:async(_args,ctx)=>{await ctx[name]('not-a-path')}})}`);
await mkdir(join(root, 'agent', 'extensions'), { recursive: true });
await writeFile(join(root, 'agent', 'extensions', 'global.js'), `export default ()=>{throw Error('Ambient global extension executed')}`);
const setup: Setup = { layers: [], items: [], tools: [], settings: {}, instructions: [], skillDirs: [], prompts: [], extensionPaths: [nativeExtension], mcpServers: {}, toolsOn: [], toolsOff: [], fingerprint: '' };
const services = await createSessionServices({
  setup, cwd: join(root, 'cwd'), agentDir: join(root, 'agent'),
  fixed: { provider: provider.provider(), id: 'deterministic' },
  admission: { valid: () => true, beforeSettle: async () => {}, beforeProviderDispatch: () => {} },
  host: { setTitle: () => {}, ownCleanup: () => {}, views: { bind: () => () => {} } },
});
await assert.rejects(services.modelRuntime.getAuth('anthropic'), /credentials/);
assert.equal(services.settingsManager.getCacheWarmingMode(), 'off');
let busEvents = 0;
services.eventBus.on('observed', () => { busEvents++; });
services.eventBus.emit('probe', {});
assert.equal(busEvents, 1);
const { session } = await createAgentSession({ cwd: join(root, 'cwd'), agentDir: join(root, 'agent'), modelRuntime: services.modelRuntime, model: services.model, settingsManager: services.settingsManager, resourceLoader: services.resourceLoader, sessionManager: SessionManager.inMemory(join(root, 'cwd')), tools: [] });
let errors = 0;
const ui = new ExtensionUI({ changed: () => {}, position: () => 0, cwd: join(root, 'cwd') });
await session.bindExtensions({ mode: 'rpc', uiContext: ui.context, onError: () => { errors++; }, commandContextActions: { waitForIdle: () => session.waitForIdle(), reload: unsupported, newSession: unsupported, fork: unsupported, switchSession: unsupported, navigateTree: unsupported } });
for (const command of ['reload','newSession','fork','switchSession','navigateTree']) await session.prompt(`/${command}`);
assert.equal(errors, 5);
assert.equal(session.extensionRunner.hasUI(), true);
await session.abort(); await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }); session.dispose();
services.eventBus.emit('probe', {});
assert.equal(busEvents, 1, 'native invalidation removes extension bus subscriptions');
await assert.rejects(readFile(join(root, 'ambient-executed')), { code: 'ENOENT' });
console.log('isolated-home/project/resources and native unsupported-command probes passed');
