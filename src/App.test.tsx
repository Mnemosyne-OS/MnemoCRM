/**
 * The cartridge with no host on the other side of the bridge: the same shape
 * as a refused permission. It must ask for a folder and SAY that Mnemosyne did
 * not answer, never go blank.
 */
import { render, screen } from '@testing-library/react';
import App from './App';

describe('MnemoCRM with no host answering', () => {
  beforeEach(() => localStorage.clear());

  it('asks where the book lives and names the missing host', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<App />);

    await screen.findByRole('button', { name: /Choose a folder|Choisir un dossier|Elegir una carpeta/ });
    expect(await screen.findByRole('alert')).toHaveTextContent(/No Mnemosyne host/);
    expect(warned).toHaveBeenCalled();
    warned.mockRestore();
  });
});
