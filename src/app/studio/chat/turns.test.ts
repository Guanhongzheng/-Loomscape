import { describe, expect, it } from 'vitest';
import { calcTurns, exchange, localHistory } from '@/app/studio/chat/turns';
import type { Turn } from '@/app/studio/chat/parts';

const at = Date.UTC(2026, 10, 2, 12, 0, 0);

const turn = (patch: Partial<Turn>): Turn => ({
  id: 't',
  role: 'user',
  text: 'x',
  at,
  ...patch,
});

describe('calcTurns', () => {
  it('answers a pure expression without touching a model', () => {
    const turns = calcTurns('10-3是多少', at);
    expect(turns).toHaveLength(2);
    expect(turns?.[0].role).toBe('user');
    expect(turns?.[1].mode).toBe('calc');
    expect(turns?.[1].text).toBe('10 - 3 = 7');
    // Both turns share the timestamp the caller passed, so the transcript
    // cannot show the question after the answer.
    expect(turns?.[1].at).toBe(at);
  });

  it('leaves everything else to the model', () => {
    expect(calcTurns('帮我把 10-3 写成文案', at)).toBeNull();
    expect(calcTurns('你好', at)).toBeNull();
  });

  it('names the answer after the question it belongs to', () => {
    const turns = calcTurns('2+2', at);
    expect(turns?.[1].id).toBe(`${turns?.[0].id}_a`);
  });
});

describe('exchange', () => {
  it('keeps the sources on the answer, not on the question', () => {
    const hit = { record: { id: 'm1' } } as never;
    const turns = exchange('local_1', '问', '答', 'local', [hit], at);
    expect(turns[0].sources).toBeUndefined();
    expect(turns[1].sources).toHaveLength(1);
    expect(turns[1].id).toBe('local_1_a');
    expect(turns[1].mode).toBe('local');
  });

  it('can start an answer empty, which is what streaming fills in', () => {
    const turns = exchange('local_2', '问', '', 'local', [], at);
    expect(turns[1].text).toBe('');
  });
});

describe('localHistory', () => {
  it('drops empty turns so a pending answer is not sent back as context', () => {
    const rows = [turn({ id: '1', text: '问' }), turn({ id: '2', role: 'assistant', text: '  ' })];
    expect(localHistory(rows)).toHaveLength(1);
  });

  it('keeps only the most recent turns', () => {
    const rows = Array.from({ length: 9 }, (_, index) => turn({ id: String(index), text: `问${index}` }));
    const history = localHistory(rows);
    expect(history).toHaveLength(6);
    expect(history[0].content).toBe('问3');
    expect(history[5].content).toBe('问8');
  });

  it('truncates a long turn so the context cannot swallow the weights', () => {
    const rows = [turn({ text: 'x'.repeat(2000) })];
    expect(localHistory(rows)[0].content).toHaveLength(800);
  });
});
