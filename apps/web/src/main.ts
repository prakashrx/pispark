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
