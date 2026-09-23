import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/controls.css';
import './styles/panels.css';
import './styles/settings.css';
import './styles/processing.css';
import './styles/model.css';
import './styles/style.css';
import './styles/svgfile.css';
import './styles/svgedit.css';
import { createApp } from './app/createApp';

createApp(document.getElementById('app')!)
  .then((ctx) => {
    // Dev-only debugging handle (stripped from production builds).
    if (import.meta.env.DEV) (window as unknown as { kentos: unknown }).kentos = ctx;
  })
  .catch((err) => {
    console.error(err);
    document.getElementById('app')!.textContent = `Uygulama başlatılamadı: ${(err as Error).message}`;
  });
