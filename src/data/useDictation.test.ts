/**
 * The microphone never outlives the panel that asked for it (doc 124, lot 3;
 * verification pass of 30/09), including when the panel closes while the
 * host is still opening the mic.
 */
import { act, renderHook } from '@testing-library/react';

let releaseStart: () => void = () => {};
const startDictation = vi.fn(() => new Promise<void>((resolve) => { releaseStart = resolve; }));
const cancelDictation = vi.fn(async () => undefined);
vi.mock('./host', () => ({
  startDictation: () => startDictation(),
  stopDictation: vi.fn(async () => 'texte'),
  cancelDictation: () => cancelDictation(),
}));

import { useDictation } from './useDictation';

describe('useDictation', () => {
  beforeEach(() => {
    startDictation.mockClear();
    cancelDictation.mockClear();
  });

  it('closed while the host opens the mic: the late answer cancels the recording', async () => {
    const { result, unmount } = renderHook(() => useDictation('fr', () => {}));
    let started!: Promise<void>;
    act(() => { started = result.current.start(); });
    unmount();
    expect(cancelDictation).not.toHaveBeenCalled();
    await act(async () => { releaseStart(); await started; });
    expect(cancelDictation).toHaveBeenCalledTimes(1);
  });

  it('closed while listening: the cleanup cancels; a panel still open keeps listening', async () => {
    const { result, unmount } = renderHook(() => useDictation('fr', () => {}));
    let started!: Promise<void>;
    act(() => { started = result.current.start(); });
    await act(async () => { releaseStart(); await started; });
    expect(result.current.state.kind).toBe('listening');
    expect(cancelDictation).not.toHaveBeenCalled();
    unmount();
    expect(cancelDictation).toHaveBeenCalledTimes(1);
  });
});
