import { waitForPhotoSave } from '#lib/utils/photo-save.ts';

describe('durable photo save recovery', () => {
  afterEach(() => vi.useRealTimers());
  it('reconciles completion when the socket event is missed, with no overall time limit', async () => {
    vi.useFakeTimers();
    let saved = false;
    const check = vi.fn(() => Promise.resolve({ status: saved ? ('saved' as const) : ('processing' as const) }));
    const pending = waitForPhotoSave(check, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(check.mock.calls.length).toBeGreaterThan(30);
    saved = true;
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBeUndefined();
  });
  it('survives a network interruption and still observes the same operation', async () => {
    vi.useFakeTimers();
    const check = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue({ status: 'saved' });
    const pending = waitForPhotoSave(check, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBeUndefined();
    expect(check).toHaveBeenCalledTimes(2);
  });
  it('reports an actual failed save without repeating its write', async () => {
    const check = vi.fn(() => Promise.resolve({ status: 'failed' as const }));
    await expect(waitForPhotoSave(check, new AbortController().signal)).rejects.toThrow('Photo save failed');
    expect(check).toHaveBeenCalledOnce();
  });
  it('cancels recovery when the editor closes', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = waitForPhotoSave(() => Promise.resolve({ status: 'processing' }), controller.signal);
    const outcome = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await outcome;
    expect(vi.getTimerCount()).toBe(0);
  });
});
