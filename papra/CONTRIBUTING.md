# Contributing to the Papra plugin

How we work on `papra/`. For building, testing and releasing plugins in
general, see the repository [README](../README.md); for the plugin API,
[WRITING_PLUGINS.md](../WRITING_PLUGINS.md). AI agents also read
[AGENTS.md](AGENTS.md).

The plugin is developed in the fork `AlwinAntreich/bulwarkmail-plugins` and
written to be merged into [bulwarkmail/plugins](https://github.com/bulwarkmail/plugins).
So Bulwark's [contributing guide](https://bulwarkmail.org/docs/development/contributing)
applies on top of this file, in particular "Before you write code" and
"AI-assisted contributions".

## Workflow

Every change starts in the plan and ends with a reviewed merge to `main`.

1. **Plan:** [`docs/PLAN.md`](docs/PLAN.md) says what is to be done, why and
   when it is done. The fork has no issues; `papra/docs/` is the record.
1. **Discuss** the approach before writing code. The agreed approach and
   each decision taken during the work go into `docs/PLAN.md` ("Decisions
   already made"), open points into "Open questions for the owner", so
   whoever was not in the conversation can follow it.
1. **Branch** off an up-to-date `main` (`papra/<topic>`), never work on
   `main`.
1. **Implement** the minimal change for the step, and update in the same
   commit every document it makes wrong or incomplete: `papra/README.md`
   for admins and users, `papra/docs/` for how the plugin works.
1. **Validate locally:** the [checks](#checks), and the change tried in a
   running Bulwark against `test-env/`, in the light and dark theme and at
   phone width.
1. **Commit** (see below). Before opening the pull request, and again before
   the merge, check whether `main` has moved
   (`git fetch origin && git rev-list --count HEAD..origin/main`); if it has,
   rebase and run the checks again.
1. **Pull request** into the fork's `main`. When opening it and after every
   further commit, check its title and description against
   `git log origin/main..HEAD`: they say what the branch does, every
   commit included, and nothing it does not do.
1. The CI **must pass green** before the merge. Every review finding is
   either fixed or answered in its thread with why it does not apply.
1. **Release:** see [Releasing](#releasing).

## Releasing

While `papra` is under `skip` in `publish.json`, `npm run release` refuses
it ("not in the publish list"), and it would not build `papra.zip` anyway:
it only rebuilds a ZIP that is already committed. So a release is made by
hand, the same way the script does it:

1. On a branch off `main`: set the version in `manifest.json`,
   `package.json` and `package-lock.json` (its top-level and root package
   `version`), run `node scripts/build.mjs papra`, `npm run check` and the
   tests, and turn `## Unreleased` in `CHANGELOG.md` into
   `## <version> (<date>)`.
2. Commit exactly those files and `papra/papra.zip` as
   `chore: release papra <version>`.
3. The owner merges it into `main` and tags the commit there:
   `git tag -a papra@<version> -m "papra <version>"`.

Pushing a `papra@<version>` tag starts the Publish workflow, if Actions
run in the fork; it stops at once because `papra` isn't in the publish
list, and submits nothing. Once `papra` is listed, `npm run release`
does all of this.

## Documentation

- `papra/README.md`: what the plugin does, how to install and set it up
  (including `PLUGIN_PROXY_PRIVATE_ORIGINS` and the Papra key permissions).
  Written for admins and users.
- `papra/docs/`: the plan, the decisions and how the implementation works,
  one Markdown file per topic, named after the topic
  (`papra-client.md`, not `notes.md`).
- `papra/CHANGELOG.md`: written by `npm run changelog` from the commits.

## Going upstream

`AGENTS.md`, `CONTRIBUTING.md`, `.claude/`, and the root
`.pre-commit-config.yaml` and `.githooks/` stay in the fork: leave them out of the branch for
an upstream pull request.

A new plugin is larger than 500 lines, so Bulwark wants an issue on
`bulwarkmail/plugins` and the maintainers' agreement to the approach before
the pull request. Open that issue, and later the pull request, only with the
owner's go-ahead. Deliver it as pull requests that each work and can be
reviewed on their own. Answer review feedback within 30 days, in your own
words, or the pull request is closed.

## Checks

[pre-commit](https://pre-commit.com/) runs them, configured in the fork's
root `.pre-commit-config.yaml`. Set it up once per clone, with Node 24 as in
CI (npm 9 from Node 20 can't read the lockfiles):

```
pipx install pre-commit
npm ci && (cd smime && npm ci)   # the S/MIME tests need its own packages
pre-commit install               # installs the pre-commit, commit-msg and pre-push hooks
```

| When | Hook | Command |
| --- | --- | --- |
| commit | manifests, versions, lockfiles, publish.json | `npm run check` |
| commit, when papra or the test tooling changed | Papra unit tests | `npm test -- --passWithNoTests papra/` |
| commit | no `CLAUDE.md` anywhere | |
| commit message | Conventional Commit subject, no AI attribution (see [Commits](#commits)) | `.githooks/` |
| push | Node 24 or later | |
| push | all unit tests, check, every plugin built alone (what CI runs) | `npm test`, `npm run check`, `npm run build:isolated` |
| by hand | generated tables in WRITING_PLUGINS.md and README; needs `BULWARK_WEBMAIL` | `pre-commit run --hook-stage manual docs-check` |
| by hand | Playwright, needs `./test-env/up.sh` and a webmail | `pre-commit run --hook-stage manual e2e` |

Start every branch with `pre-commit run --all-files` and
`pre-commit run --hook-stage pre-push --all-files`: if they already fail on
`main`, report it rather than mixing old failures into the change. Never skip
the hooks with `--no-verify`. Changes to the hooks go in the first commit of
a branch, so they check every later one.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/),
without a scope, as in the rest of the repository. The subject is imperative
and lowercase, names the plugin, and says what changes for the user:

```text
fix: tell the user when Papra refuses a file larger than its upload limit

Papra answered 413 and the plugin showed a generic error. Map the status
to a message that names the limit.
```

| Type | For |
| --- | --- |
| `feat` | a new feature |
| `fix` | a bug fix |
| `docs` | documentation |
| `style` | formatting, no change in behaviour |
| `refactor` | restructuring, no change in behaviour |
| `perf` | faster, no change in behaviour |
| `test` | tests only |
| `build` | the plugin's build or `package.json` |
| `ci` | CI and the hooks |
| `security` | a security fix |
| `chore` | maintenance; `chore: release papra <version>` is written by `npm run release` |

A `!` after the type (`feat!: ...`) marks a breaking change.

**The subjects are the release notes.** `npm run changelog` turns them into
the plugin's CHANGELOG, which admins read before they update: `feat` under
Added, `fix` under Fixed, `security` under Security, `!` under Breaking,
`refactor` and `perf` under Changed, and leaves out `chore`, `test`, `ci`,
`docs`, `style` and `build`. Write them for an admin, not for a reviewer.

The upstream maintainers merge branches with a merge commit, so every commit
stays in the history: write each to stand on its own, add a body with the why
for anything non-trivial, wrap it at 72 characters, and squash fixups into
the commit they fix before the merge. A change that alters what the admin
has to accept (a new permission, credential or `minAppVersion`) says so in
the body.

No co-author or AI session trailers and no "Generated with" lines, in
commits, pull requests or issues. The `commit-msg` hook checks the subject
format (Merge, `Revert "..."`, `fixup!` and `squash!` subjects pass too) and
rejects those lines. Don't touch `papra/papra.zip` or version
numbers in feature commits: `npm run release` builds and sets them.

## Pull requests

The description follows the shape of Bulwark's pull request template, short
and written by a person:

```markdown
## What and why
What changes for the user or admin, and why. A few sentences.

## Plan
The step of `papra/docs/PLAN.md` this finishes, and the decisions it
records.

## Checklist
- [ ] Checks pass, and new logic has tests that fail without it
- [ ] New user-facing text is in `locales` (en, de)
- [ ] Checked in the light and dark theme and at phone width
- [ ] `papra/README.md` and `papra/docs/` updated, or not needed

## Screenshots
For UI changes: desktop and phone width, light and dark.
```

- Keep changes single-purpose. No unrelated refactoring, no reformatting of
  untouched files.
- **Bug fixes:** add a failing regression test first, commented
  `// Regression: <what broke>`, confirm it fails, then fix. Both may land in
  the same commit.
- **Features:** tests covering the core behaviour before the merge, with
  every external system (Papra, the proxy) mocked through
  `test-utils/fake-api.mjs`.
- Changes outside `papra/` (test-env, `publish.json`, shared scripts or
  docs) go into their own commits, and shared tooling into its own pull
  request.
- An unrelated bug or debt goes into "Open questions for the owner" in
  `docs/PLAN.md`, not into this change.

## Security

Never commit secrets: no Papra API keys, passwords or `.env` files, not even
for tests. The user's key lives only in the Bulwark credential. Report
vulnerabilities in the plugin privately to the owner, and in Bulwark itself
to [dev@bulwarkmail.org](mailto:dev@bulwarkmail.org), never in a public
issue.

## License

Contributions are licensed under the repository's
[GNU Affero General Public License v3](../LICENSE).
