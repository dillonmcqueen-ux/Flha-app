// server-lib/weakPins.js
// Refuses the PINs an attacker tries first. Names are searchable before login,
// so the lockout (8 wrong guesses, 15 minutes) is the only thing between a
// stranger and a worker account; a PIN on this list would fall to the first
// few guesses. Applied wherever a person chooses their own PIN. PINs generated
// by the server are random and never go through this.
//
// Rejects: one repeated digit (000000, 111111), straight runs up or down
// (123456, 654321, 234567), two repeated halves (121212, 123123), and a short
// list of the most common choices.

const COMMON = new Set(['123456', '654321', '112233', '121212', '123123', '159753', '147258', '102030', '696969', '010203', '246810', '135790', '000111', '111000', '202020', '101010']);

export function isWeakPin(pin) {
  const p = String(pin || '');
  if (!/^\d{4,6}$/.test(p)) return false; // shape is checked elsewhere
  if (/^(\d)\1+$/.test(p)) return true;
  if (COMMON.has(p)) return true;
  const d = p.split('').map(Number);
  const step = d[1] - d[0];
  if ((step === 1 || step === -1) && d.every((v, i) => i === 0 || v - d[i - 1] === step)) return true;
  const half = p.length / 2;
  if (Number.isInteger(half) && p.slice(0, half) === p.slice(half)) return true;
  if (p.length === 6 && p.slice(0, 3) === p.slice(3)) return true;
  return false;
}

export const WEAK_PIN_MESSAGE = 'That PIN is too easy to guess. Avoid repeats like 111111 and runs like 123456.';
