import { createRoot } from 'react-dom/client';
import { Root } from './Root';
import { installTelemetry } from './net/telemetry';
import './style.css';
import './start/start.css';
import './ui/game-ui.css';

installTelemetry();
createRoot(document.getElementById('root')!).render(<Root/>);
