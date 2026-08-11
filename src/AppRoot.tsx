import { StrictMode } from 'react';

import { App } from './App';
import { DiffWorkerPoolProvider } from './features/diff/DiffSurface';

export function AppRoot() {
  return (
    // @pierre/diffsのsingleton workerはStrictModeの再マウントで終了済みになるため、poolだけ外側で保持する。
    <DiffWorkerPoolProvider>
      <StrictMode>
        <App />
      </StrictMode>
    </DiffWorkerPoolProvider>
  );
}
