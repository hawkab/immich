import { isHttpError } from '@immich/sdk';

/** Reconcile a durable write even when its socket notification was lost. */
export async function waitForPhotoSave(
  check: () => Promise<{ status: 'processing' | 'saved' | 'failed' }>,
  signal: AbortSignal,
): Promise<void> {
  for (;;) {
    signal.throwIfAborted();
    try {
      const result = await check();
      if (result.status === 'saved') return;
      if (result.status === 'failed') throw new Error('Photo save failed');
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof TypeError) && !(isHttpError(error) && error.status >= 500)) throw error;
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, 2000);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        signal.removeEventListener('abort', abort);
        abort();
      }
    });
  }
}
