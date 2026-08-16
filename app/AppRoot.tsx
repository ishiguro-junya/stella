import { StrictMode } from 'react';

import { App } from './App';
import { DiffWorkerPoolProvider } from './features/diff/DiffSurface';

export function AppRoot() {
  return (
    // @pierre/diffsの単一ワーカーはStrictModeの再マウント時に終了済みとなるため、ワーカープールだけ外側で保持する。
    <DiffWorkerPoolProvider>
      <StrictMode>
        <App />
      </StrictMode>
    </DiffWorkerPoolProvider>
  );
}
