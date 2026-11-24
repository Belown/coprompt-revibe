import { createRoot } from 'react-dom/client';
import Join from './components/Join.jsx';
import './styles.css';

const root = createRoot(document.getElementById('root'));
if (!new URLSearchParams(location.search).get('user')) root.render(<Join />);
else { // importing the app connects to the room; render once the shared notebook has arrived
  const [{ default: App }, { ready }] = await Promise.all([import('./App.jsx'), import('./lib/store.js')]);
  ready.then(() => root.render(<App />));
}
