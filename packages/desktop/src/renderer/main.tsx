import { render } from 'preact';
import { App } from './app.tsx';
import { pauseWhenHidden } from './components/aura.tsx';

pauseWhenHidden();

render(<App />, document.getElementById('root')!);
