/**
 * Dictation through the HOST's microphone (the frame never touches the device).
 * Four states the button can show; every refusal keeps its code so the screen
 * can name it (NO_ENGINE, MIC_BUSY, NO_SPEECH, a permission refused…).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelDictation, startDictation, stopDictation } from './host';

export type DictationState =
  | { kind: 'idle' }
  | { kind: 'listening'; since: number }
  | { kind: 'transcribing' }
  | { kind: 'failed'; error: string };

function code(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useDictation(lang: string, onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>({ kind: 'idle' });
  const listening = useRef(false);
  const mounted = useRef(true);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  // A recording must never outlive the panel that started it: the mic light
  // would stay on for a cartridge nobody is looking at.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (listening.current) {
        listening.current = false;
        cancelDictation().catch((err) => console.warn('[mnemo-crm] dictation not cancelled on close:', err));
      }
    };
  }, []);

  const start = useCallback(async () => {
    try {
      await startDictation();
      // Closed while the host was opening the mic: the cleanup above saw nothing
      // to cancel yet, so this answer is the last chance to turn the light off.
      if (!mounted.current) {
        await cancelDictation();
        return;
      }
      listening.current = true;
      setState({ kind: 'listening', since: Date.now() });
    } catch (err) {
      console.warn('[mnemo-crm] dictation refused:', err);
      setState({ kind: 'failed', error: code(err) });
    }
  }, []);

  const stop = useCallback(async () => {
    if (!listening.current) return;
    listening.current = false;
    setState({ kind: 'transcribing' });
    try {
      const text = await stopDictation(lang);
      setState({ kind: 'idle' });
      onTextRef.current(text);
    } catch (err) {
      console.warn('[mnemo-crm] transcription failed:', err);
      setState({ kind: 'failed', error: code(err) });
    }
  }, [lang]);

  const cancel = useCallback(async () => {
    listening.current = false;
    setState({ kind: 'idle' });
    try {
      await cancelDictation();
    } catch (err) {
      console.warn('[mnemo-crm] dictation cancel failed:', err);
    }
  }, []);

  return { state, start, stop, cancel, reset: () => setState({ kind: 'idle' }) };
}
