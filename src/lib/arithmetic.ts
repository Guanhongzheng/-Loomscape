/**
 * A deliberately tiny arithmetic reader.
 *
 * A half-billion-parameter model reads "10-3" as "10.3" often enough that the
 * workbench cannot pretend the on-device path does arithmetic. Anything that is
 * unambiguously `a op b` is answered here instead of being sampled; everything
 * else falls through to the model untouched. The matcher is anchored end to end
 * so a sentence that happens to contain numbers ("10 月 3 日") never matches.
 */

const OPERATORS: Array<[string, string]> = [
  ['加上', '+'],
  ['加', '+'],
  ['减去', '-'],
  ['减', '-'],
  ['乘以', '*'],
  ['乘', '*'],
  ['除以', '/'],
  ['除', '/'],
  ['×', '*'],
  ['÷', '/'],
  ['＊', '*'],
  ['／', '/'],
];

const TRAILING = /(等于多少|等于几|是多少|等于|得多少|是几|算一下|请计算|计算)/g;

export type Arithmetic = { expression: string; result: string };

function text(value: number): string {
  if (Number.isInteger(value)) return String(value);
  // Trim binary-float noise such as 0.30000000000000004.
  return String(Number(value.toFixed(10)));
}

export function solveArithmetic(raw: string): Arithmetic | null {
  let input = raw.trim();
  if (!input) return null;

  input = input.replace(/[？?。！!]+$/g, '').trim();
  // "10 - 3 = ?" leaves a dangling equals sign once the question mark is gone.
  input = input.replace(/[=＝]+$/g, '').trim();
  input = input.replace(TRAILING, ' ').trim();
  if (!input) return null;

  for (const [word, symbol] of OPERATORS) {
    if (input.includes(word)) input = input.split(word).join(` ${symbol} `);
  }
  input = input.replace(/\s+/g, ' ').trim();

  const match = /^(-?\d+(?:\.\d+)?) ?([+\-*/]) ?(-?\d+(?:\.\d+)?)$/.exec(input);
  if (!match) return null;

  const left = Number(match[1]);
  const right = Number(match[3]);
  const op = match[2];
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;

  let value: number;
  switch (op) {
    case '+':
      value = left + right;
      break;
    case '-':
      value = left - right;
      break;
    case '*':
      value = left * right;
      break;
    case '/':
      if (right === 0) return null;
      value = left / right;
      break;
    default:
      return null;
  }

  const symbol = op === '*' ? '×' : op === '/' ? '÷' : op;
  return { expression: `${match[1]} ${symbol} ${match[3]}`, result: text(value) };
}
