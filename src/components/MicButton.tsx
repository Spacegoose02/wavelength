import { useEffect, useRef, useState } from 'react';
import { startListening, type Listening } from '../lib/voiceInput';

/**
 * Ask the DJ out loud (lib/voiceInput.ts): press to listen, press again to stop (it also stops by itself after
 * 15 seconds, or when you stop talking on devices that understand speech themselves). `onText` gets the words.
 */
export function MicButton({ onText, disabled, className = 'btn small' }: { onText(text: string): void; disabled?: boolean; className?: string }) {
  const [state, setState] = useState<'idle' | 'listening' | 'working'>('idle');
  const [error, setError] = useState('');
  const live = useRef<Listening | null>(null);
  useEffect(() => () => live.current?.cancel(), []);

  const press = async () => {
    setError('');
    if (state === 'listening') {
      setState('working');
      live.current?.stop();
      return;
    }
    if (state === 'working') return;
    try {
      const l = await startListening();
      live.current = l;
      setState('listening');
      const text = await l.done;
      live.current = null;
      setState('idle');
      if (text) onText(text);
      else setError('Didn’t catch that. Try again?');
    } catch (e) {
      live.current = null;
      setState('idle');
      setError(String((e as Error)?.message ?? e));
    }
  };

  const label = state === 'listening' ? 'Stop listening' : state === 'working' ? 'Working out what you said' : 'Ask out loud';
  return (
    <>
      <button type="button" className={`${className} mic-btn ${state}`} onClick={() => void press()} disabled={disabled && state === 'idle'} aria-label={label} title={error || label} aria-pressed={state === 'listening'}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
          <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
        </svg>
        {state === 'listening' && <span className="mic-dot" />}
      </button>
      {error && <span className="mic-error small" role="status">{error}</span>}
    </>
  );
}
