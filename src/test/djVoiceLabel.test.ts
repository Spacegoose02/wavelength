import { describe, expect, it } from 'vitest';
import { voiceLabel } from '../lib/djVoiceNames';

describe('talking DJ voice names', () => {
  it('reads Kokoro names as name, accent and voice', () => {
    expect(voiceLabel('am_michael', 'kokoro')).toBe('Michael (American, male)');
    expect(voiceLabel('bf_emma', 'kokoro')).toBe('Emma (British, female)');
    expect(voiceLabel('af_bella(2)+af_sky(1)', 'kokoro')).toBe('Bella + Sky (blend)');
    expect(voiceLabel('af_heart+am_adam', 'kokoro')).toBe('Heart + Adam (blend)');
  });
  it('capitalises OpenAI voices', () => {
    expect(voiceLabel('coral', 'openai')).toBe('Coral');
  });
});
