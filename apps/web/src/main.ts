import { mount } from 'svelte';
import App from './App.svelte';
import PairPage from './features/remote/PairPage.svelte';
import type { RemoteSelf } from '../../server/src/contract/remote-protocol';
import './lib/theme/themes.css';
import './app.css';
import { appearance } from './lib/theme/appearance.svelte';

// Apply the saved theme before the first render to avoid a flash.
appearance.apply();

const target = document.getElementById('app');
if (!target) throw new Error('App mount element is missing');
/**
 * At the remote address (HTTPS, through Tailscale) a device that hasn't paired gets the pairing
 * screen instead of the app. On this computer (plain HTTP) nothing is asked.
 */
async function unpaired(): Promise<boolean> {
  if (location.protocol !== 'https:') return false;
  try {
    const self = (await (await fetch('/api/remote/me')).json()) as RemoteSelf;
    return self.remote === true && !self.device;
  } catch {
    return false;
  }
}
void unpaired().then((pair) => {
  if (pair) return void mount(PairPage, { target });
  // A paired device that opens a pairing link again just goes to the app.
  if (location.pathname === '/pair') history.replaceState(null, '', '/');
  mount(App, { target });
});

// Installable as an app, and opens while the server restarts (see public/sw.js). Not in development.
if ("serviceWorker" in navigator && import.meta.env.PROD) void navigator.serviceWorker.register("/sw.js").catch(() => {});
