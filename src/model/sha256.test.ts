import { sha256Hex } from './sha256';

describe('sha256Hex', () => {
  it('matches the FIPS 180-2 vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  // The test runner has WebCrypto (the cartridge may not): it is the reference here.
  it('agrees with WebCrypto on UTF-8 text and on every padding boundary', async () => {
    const samples = ['Céramique bleue ✓ 12,50 €', '日本語'];
    for (let n = 50; n <= 130; n++) samples.push('x'.repeat(n));
    for (const s of samples) {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      expect(sha256Hex(s)).toBe(hex);
    }
  });
});
