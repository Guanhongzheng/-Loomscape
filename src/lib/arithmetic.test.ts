import { describe, expect, it } from 'vitest';
import { solveArithmetic } from '@/lib/arithmetic';

describe('solveArithmetic', () => {
  it('reads the phrasing that made the 0.5B answer 10.3', () => {
    expect(solveArithmetic('10-3是多少')?.result).toBe('7');
    expect(solveArithmetic('10-3等于多少')?.result).toBe('7');
    expect(solveArithmetic('10 - 3 = ?')?.result).toBe('7');
  });

  it('understands chinese operators', () => {
    expect(solveArithmetic('3加5等于多少')?.result).toBe('8');
    expect(solveArithmetic('10减3等于多少')?.result).toBe('7');
    expect(solveArithmetic('7乘以8是多少')?.result).toBe('56');
    expect(solveArithmetic('9除以3')?.result).toBe('3');
  });

  it('handles decimals and negatives without float noise', () => {
    expect(solveArithmetic('0.1+0.2')?.result).toBe('0.3');
    expect(solveArithmetic('-4+9')?.result).toBe('5');
    expect(solveArithmetic('2.5*4')?.result).toBe('10');
  });

  it('refuses what it cannot prove', () => {
    // A sentence with numbers, a date, two operators, a division by zero.
    expect(solveArithmetic('10月3日是什么日子')).toBeNull();
    expect(solveArithmetic('2024-10-24')).toBeNull();
    expect(solveArithmetic('1+2+3')).toBeNull();
    expect(solveArithmetic('5除以0')).toBeNull();
    expect(solveArithmetic('帮我把10-3写成文案')).toBeNull();
  });
});
