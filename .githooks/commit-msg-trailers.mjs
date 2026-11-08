#!/usr/bin/env node
// commit-msg hook: reject co-author trailers, Claude-Session lines and
// "Generated with Claude/goose" lines.
// Based on croitutils' contrib/git-hooks/croitutils-commit-msg-trailers.sh.

import { readFileSync } from 'node:fs';

const message = readFileSync(process.argv[2], 'utf8');

const RULES = [
  [/co-authored-by/i, 'never write co-author commit messages'],
  [/claude-session/i, 'never write Claude-Session lines in commit messages'],
  // At the start of a line (after an emoji, say), so a sentence about such lines passes.
  [/^[^\p{L}\p{N}\n]*generated (with|by) \[?(claude|goose)\b/imu, 'never write "Generated with" lines in commit messages'],
];

for (const [pattern, error] of RULES) {
  if (pattern.test(message)) {
    console.error(`commit-msg-trailers: ERROR: ${error}`);
    process.exit(1);
  }
}
