import Icon from './Icon.jsx';
import { Avatar } from './bits.jsx';
import { ui, resetDemo } from '../lib/store.js';
import { ME, OTHER } from '../lib/util.js';
import { hasKey, openSettings } from '../lib/llm.js';
import { ask } from '../lib/ui.js';

export default function Header() {
  const key = hasKey();
  const reset = async () => {
    if (await ask('Clears the shared notebook in every open window and restores the Titanic scenario. This cannot be undone.', { title: 'Reset the demo?', ok: 'Reset notebook' })) resetDemo();
  };
  return <header>
    <h1 className="brand">CoPrompt <small>revibe · CHI ’24</small></h1>
    <span id="me"><Avatar u={ME} />You are {ME}</span>
    <span className="grow" />
    <span id="pystat" data-s={ui.py.s}>{ui.py.text}</span>
    <button id="other" onClick={() => window.open(`?user=${OTHER}`, OTHER, 'width=1100,height=900')}><Icon name="external" />Open as {OTHER}</button>
    <button id="settings" className={key ? undefined : 'needs'} onClick={openSettings}><Icon name="key" />{key ? 'API key' : 'Add API key'}</button>
    <button id="reset" onClick={reset}><Icon name="reset" />Reset demo</button>
  </header>;
}
