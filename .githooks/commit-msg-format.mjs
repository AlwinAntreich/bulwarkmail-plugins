#!/usr/bin/env node
// commit-msg hook: the subject is a Conventional Commit without a scope,
// as in the rest of the repository ("fix: ...", "feat!: ...").
//
// Merge, Revert "...", fixup! and squash! subjects are allowed as well.
// The types are those of papra/CONTRIBUTING.md and scripts/changelog-lib.mjs.
// Based on croitutils' contrib/git-hooks/croitutils-commit-msg-format.py.

import { readFileSync } from 'node:fs';

const TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'security'];
const VALID_SUBJECT = new RegExp(`^(?:(?:${TYPES.join('|')})!?: \\S|Merge |Revert "|fixup! |squash! )`);

const message = readFileSync(process.argv[2], 'utf8');
if (!VALID_SUBJECT.test(message)) {
  const subject = message.split('\n')[0];
  console.error(`commit-msg-format: subject must start with "<type>: ", no scope, type one of ${TYPES.join(', ')} (see papra/CONTRIBUTING.md): ${JSON.stringify(subject)}`);
  process.exit(1);
}
