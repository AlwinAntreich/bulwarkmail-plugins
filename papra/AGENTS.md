# AI agent guidelines (AGENTS.md)

**You are** an engineering agent (goose or Claude Code) on `papra/`, a Bulwark
webmail plugin that saves attachments to Papra and attaches Papra documents
to new mail. It lives in the fork `AlwinAntreich/bulwarkmail-plugins` of
`bulwarkmail/plugins`, next to the other plugins, and may go upstream later.

The rules below are those of croit's repositories, adapted to Bulwark's: where
they differ, the Bulwark repository's conventions win, because the code is
written to be merged there. Commits, the record and pull requests:
[CONTRIBUTING.md](CONTRIBUTING.md). If a request conflicts with these rules,
follow the rules and say so.

## Read first

- [`../WRITING_PLUGINS.md`](../WRITING_PLUGINS.md): the authoritative plugin
  API (manifest, permissions, hooks, slots, `api`, credentials, testing,
  security). Check every API name, slot and permission there instead of
  guessing.
- [`../README.md`](../README.md): build, test, release, `publish.json`.
- `../paperless/`: the reference implementation. Mirror its layout, UI
  patterns and tests; when in doubt, do what it does.
- [`docs/PLAN.md`](docs/PLAN.md): goal, scope, decisions and open
  questions (see Gating), and the other documents in `docs/`.

## Gating

- **Get an explicit OK on the approach before producing anything** (code,
  content, configuration). Reading, investigating and proposing a plan need
  no OK.
- **`papra/docs/` is the record.** The fork has no issues. The OK is given
  in the session; `docs/PLAN.md` keeps what was agreed for whoever was not
  there. Once an approach has its OK, write it into the plan, and each
  decision under "Decisions already made" as it is made, in the same commit
  as the work it governs. How the plugin is built is documented in `docs/`
  as well, one Markdown file per topic, named after the topic.
- **Someone else decides:** a decision that belongs to someone not in the
  session goes into "Open questions for the owner" in `docs/PLAN.md`, with
  the options and a recommendation; that part of the work waits for the
  answer.
- **On a feature branch, commit and push to the fork freely:** small commits
  that pass the checks. Before a pull request, list every commit on the branch
  (subject, why, files), show the description, and wait for an OK.
- **Rewrite only your own feature branch, with a lease:** after a rebase,
  `git push --force-with-lease`; first check that the branch holds only your
  commits: `git log origin/main..origin/<branch> --format=%ae | sort -u`.
- **These need a fresh, explicit OK each time:** opening a pull request,
  anything on `main`, anything on `bulwarkmail/*` (issues, comments, pull
  requests; none until the owner decides to go upstream), a plain
  `--force`, tags and releases (`npm run release`), `--no-verify`, and
  destructive or privileged actions. A prior OK never
  carries over, and silence is not consent.
- **Agents never merge.**
- **Never work on `main`.** Branch off it for every change.
- **Never commit secrets:** no Papra API keys, passwords, tokens or `.env`
  files in code, tests, fixtures, commit messages or prompts. Test keys come
  from `test-env/` seeding or the environment.
- **No AI attribution** anywhere: no co-author or session trailers, no
  "Generated with" lines, in commits, pull requests, issues or comments.
  Bulwark doesn't ask for disclosure; the author answers for the change.
  `.claude/settings.json` turns off Claude Code's own trailers.
- **Never add a `CLAUDE.md`:** put rules into `AGENTS.md`.

## Working on a change

- **Start from green.** On the fresh branch, before the first edit, run the
  checks of [CONTRIBUTING.md](CONTRIBUTING.md#checks); if they fail, stop and
  report instead of mixing old failures into the change.
- **Gates first:** changes to the root `.pre-commit-config.yaml` or
  `.githooks/` (fork-only) go into the first commit of a branch, with an OK
  of their own.
- **Small, focused commits,** each leaving the branch working. Stage explicit
  paths, never `git add -A` or `git add .`.
- **Rebase conflicts:** if a rebase onto `main` doesn't apply cleanly, stop;
  the human resolves it.
- **Stay inside `papra/`.** Outside it only what the plugin needs and the
  repository expects: a Papra service in `test-env/`, the entry in
  `publish.json`, the plugin row in the root `README.md`. Anything else in a
  shared file (`scripts/`, `test-utils/`, `e2e/`, `WRITING_PLUGINS.md`, CI)
  is a separate change with its own OK.
- **Update the documentation in the same commit** wherever the change makes
  it wrong or incomplete: `papra/README.md` for admins and users,
  `papra/docs/` for the plan, the decisions and how the plugin works.
- **Report bottom line first,** then the detail.

## Before new code: the ladder

1. Is it needed at all? Version 1's scope is in the plan; nothing beyond it
   without asking.
2. Does the host do it? `api.*`, the slots, `@plugin-host/ui` and
   host-drawn actions (`api.ui.setActions`) before anything drawn by hand.
3. Is it in this repository? `paperless/` (client, errors, MIME, combobox,
   connection state), `test-utils/fake-api.mjs`, `e2e/helpers.mjs`. Copy
   into `papra/src/lib/` rather than import across plugins: each plugin must
   build alone.
4. The browser platform: `Intl`, `URL`, `FormData`, `Blob`. No `fetch`:
   the network goes through `api.proxy`.
5. A package in `papra/package.json`. It is bundled into the plugin and
   reviewed upstream like a runtime dependency: propose it with the why
   first.
6. Only then new code, kept short.

## Code

- JavaScript ES modules in `papra/src/` (`.js`, `.jsx` where it helps),
  logic in plain modules under `src/lib/`, React from the host, never
  bundled. No TypeScript, no Tailwind, no own stylesheets, no hard-coded
  colours: the UI kit and the theme variables only.
- Match the style of the file and of `paperless/`; no reformatting.
- **Every string a user sees** goes into `locales` in `manifest.json` (`en`
  and `de`), read with `api.i18n.t()`. Keep layouts right-to-left safe.
- **Permissions:** request only what the code uses; a new permission is a
  change the admin has to accept, so say why in the commit.
- **Credentials:** the user's Papra key lives only in the user-scope
  credential and reaches Papra through `api.proxy.fetch`. Never in
  `settingsSchema`, `api.storage`, logs or error messages.
- **Accounts:** email and blob ids repeat across accounts. Pass on the
  `accountId` an action or slot provides wherever the API takes one, so
  team and shared mailboxes work.
- **Never fail silently.** When something cannot do its job (not connected,
  file too large, Papra unreachable, key without permission), the user is
  told what failed and what to do next.
- **Logging:** `api.log`, never `console`; no personal data or document
  content.
- No hand-edited version numbers: `npm run release` sets them. The ZIP
  `papra/papra.zip` is built by the release as well.

## Tests

- Unit tests (Vitest, `papra/test/*.test.mjs`) mock every external system
  through `fakeApi` handlers; no test talks to a real Papra or Bulwark.
- End-to-end tests (`papra/e2e/*.spec.mjs`) run against `test-env/`.
  Anything else, such as the owner's own Bulwark or Papra, needs
  confirmation first.
- A new test must fail without the change it covers.
- **Bug fixes start with a failing test**, commented
  `// Regression: <what broke>`; it may share the fix's commit.

## How to think

- **Ask instead of guessing.** State your reading of an ambiguous request;
  check Papra routes and fields in Papra's source before relying on them.
- **Push back** when a simpler option exists or the request misses the real
  goal; a line or two of tradeoff, then the user decides.
- **KISS and YAGNI.** Nothing speculative or configurable that wasn't asked
  for. One good default; an admin setting only when deployments really
  differ, not a per-user toggle.
- **Surgical changes.** Touch only what the task needs, and remove what your
  change leaves unused.
- **Unrelated findings:** don't fix them; note them and ask whether to add
  them to "Open questions for the owner" in `docs/PLAN.md`.

## Done

The plan's definition of done is met for the step, every check is green,
the plugin works in a running Bulwark against `test-env/` in light and dark
theme and at phone width, `README.md` and `docs/` are updated, and nothing
out of scope changed.
