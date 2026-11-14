import { mount } from 'svelte';
import App from './App.svelte';
import './lib/theme/themes.css';
import './app.css';
import { appearance } from './lib/theme/appearance.svelte';

// Apply the saved theme before the first render to avoid a flash.
appearance.apply();

const target = document.getElementById('app');
if (!target) throw new Error('App mount element is missing');
mount(App, { target });

// Installable as an app, and opens while the server restarts (see public/sw.js). Not in development.
if ("serviceWorker" in navigator && import.meta.env.PROD) void navigator.serviceWorker.register("/sw.js").catch(() => {});
