#!/usr/bin/env node
// `npm run bolt` — the one deliberately impure file in the repository.
// It prints the bolt and one invariant. It is not imported by anything,
// which is the only reason it is allowed to call Math.random(): the
// library's purity claim (no clock, no randomness, no I/O) applies to
// what ships in dist, and this ships to your terminal.
const INVARIANTS = [
  'Append-only — history you can edit is not evidence.',
  'Signed integer minor units — floats drift; chains reject fractions.',
  'One sign convention — SUM(amount) must mean something.',
  'Idempotent writes — retries are constant at scale.',
  'Balances are derived — a cache can be rebuilt; a truth cannot.',
];
const BOLT = ['        ██', '       ██', '      ██████', '        ██', '       ██', '      ██'];
console.log('\x1b[33m' + BOLT.join('\n') + '\x1b[0m');
console.log('\n  ' + INVARIANTS[Math.floor(Math.random() * INVARIANTS.length)] + '\n');
