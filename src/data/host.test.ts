/**
 * The host wrappers' translation of a refusal (doc 124, verification pass of
 * 30/09). A model that cannot see answers `{ success: false, errorCode:
 * 'NO_VISION' }` through the bridge (doc 74); only a NoVisionError lets the PDF
 * import offer the text-only reading instead of reporting a failure.
 */
import { NoVisionError, inferOnImage, sdk } from './host';

describe('inferOnImage', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('turns the bridge refusal into NoVisionError, by errorCode or by error', async () => {
    const invoke = vi.spyOn(sdk, 'invoke');
    invoke.mockResolvedValueOnce({ success: false, errorCode: 'NO_VISION', error: 'The model cannot see images' });
    await expect(inferOnImage('p', 'AAAA')).rejects.toBeInstanceOf(NoVisionError);
    invoke.mockResolvedValueOnce({ success: false, error: 'NO_VISION' });
    await expect(inferOnImage('p', 'AAAA')).rejects.toBeInstanceOf(NoVisionError);
  });

  it('any other refusal stays an ordinary error, with its words', async () => {
    vi.spyOn(sdk, 'invoke').mockResolvedValueOnce({ success: false, error: 'QUOTA' });
    const err = await inferOnImage('p', 'AAAA').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(NoVisionError);
    expect((err as Error).message).toBe('QUOTA');
  });

  it('an answer is returned as text', async () => {
    vi.spyOn(sdk, 'invoke').mockResolvedValueOnce({ success: true, text: '{"products":[]}' });
    await expect(inferOnImage('p', 'AAAA')).resolves.toBe('{"products":[]}');
  });
});
