import './style.css';
import { App } from './App';

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');

const app = new App(root);
app.start();

// Optional debug handle for smoke tests / manual poking: append ?debug to the URL.
if (location.search.includes('debug') || location.search.includes('smoke')) {
  (window as unknown as { __mv?: App }).__mv = app;
}
