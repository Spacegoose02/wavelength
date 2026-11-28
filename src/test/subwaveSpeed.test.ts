import { describe, expect, test } from 'vitest';
import { FAST_SPEED, speedForm, speedPatch, thinkingStarved } from '../sources/subwave';

describe('SUB/WAVE speed settings', () => {
  test('missing fields read as SUB/WAVE defaults', () => {
    expect(speedForm(undefined)).toEqual({
      reasoning: false, trackSelection: 'agentic', requestMatching: 'agentic', segmentRuntime: 'agentic', deadline: '45', maxOut: '', numCtx: '',
    });
  });

  test('stored values round-trip', () => {
    const llm = { reasoning: true, trackSelection: 'shortlist', requestMatching: 'direct', segmentRuntime: 'direct', agentTimeoutMs: 60_000, maxOutputTokens: 800, numCtx: 8192 };
    expect(speedPatch(speedForm(llm))).toEqual(llm);
  });

  test('Make it fast turns thinking off and every route to one call', () => {
    const p = speedPatch({ ...speedForm({ reasoning: true }), ...FAST_SPEED });
    expect(p).toMatchObject({ reasoning: false, trackSelection: 'shortlist', requestMatching: 'direct', segmentRuntime: 'direct' });
  });

  test('numbers are clamped to what SUB/WAVE takes, empty means its default', () => {
    const p = speedPatch({ ...speedForm(undefined), deadline: '1', maxOut: '99999', numCtx: '100' });
    expect(p).toMatchObject({ agentTimeoutMs: 5000, maxOutputTokens: 8000, numCtx: 2048 });
    const empty = speedPatch({ ...speedForm(undefined), deadline: '', maxOut: '', numCtx: '' });
    expect(empty.agentTimeoutMs).toBeUndefined();
    expect(empty).toMatchObject({ maxOutputTokens: 0, numCtx: 0 });
  });
});

describe('thinking vs the longest answer', () => {
  test('warns only when thinking is on and the cap is low', () => {
    expect(thinkingStarved({ reasoning: true, maxOut: '500' })).toBe(true);
    expect(thinkingStarved({ reasoning: true, maxOut: '' })).toBe(false);
    expect(thinkingStarved({ reasoning: true, maxOut: '4000' })).toBe(false);
    expect(thinkingStarved({ reasoning: false, maxOut: '500' })).toBe(false);
  });
});
