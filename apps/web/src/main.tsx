import { createRoot } from 'react-dom/client';
import { Root } from './Root';
import './style.css';
import './start/start.css';
import './ui/game-ui.css';

createRoot(document.getElementById('root')!).render(<Root/>);
