import { waitForWebsocketEvent, websocketEvents } from '#lib/stores/websocket.ts';
import type { SyncAssetV2 } from '@immich/sdk';

type EditEvent = { asset: SyncAssetV2; edit: [] };

describe('editor completion subscription', () => {
  let listener: (event: EditEvent) => void;
  const cleanup = vi.fn();
  beforeEach(() => {
    cleanup.mockClear();
    vi.spyOn(websocketEvents, 'on').mockImplementation((_, callback) => {
      listener = callback as (event: EditEvent) => void;
      return cleanup;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('can wait for healthy editing work beyond the old ten-second deadline', async () => {
    vi.useFakeTimers();
    const pending = waitForWebsocketEvent('AssetEditReadyV2', (event) => event.asset.id === 'target', null);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(cleanup).not.toHaveBeenCalled();
    listener({ asset: { id: 'other' } as SyncAssetV2, edit: [] });
    expect(cleanup).not.toHaveBeenCalled();
    listener({ asset: { id: 'target' } as SyncAssetV2, edit: [] });
    await expect(pending).resolves.toEqual([{ asset: { id: 'target' }, edit: [] }]);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('removes the waiting listener when the editor is closed', async () => {
    const controller = new AbortController();
    const pending = waitForWebsocketEvent('AssetEditReadyV2', undefined, null, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
