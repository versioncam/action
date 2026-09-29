# Contributing

This repository is a GitHub Action around [versioncam](https://version.cam). It is small on purpose, and these rules keep it that way.

## The rules

- **A thin wrapper.** The Action adds only what a command line cannot: the pull request comment, the artifacts, the job summary and GitHub's token for `publish`. Everything else belongs in versioncam, where a customer on another CI gets it too. If a step is tempted to parse what versioncam prints, versioncam's `--report` grows a field instead.
- **The repository's own versioncam, and no other.** The Action runs `node_modules/.bin/versioncam` from the app's directory up to the repository's root. It never runs `npx versioncam`, which downloads the latest when none is installed, and it has no `version` input: two recorders in one job is the bug a pinned recorder exists to prevent.
- **No secrets, anywhere.** No token, key or account id in a file, a workflow, an example or a test fixture. GitHub's token for version.cam is asked for at run time, masked at once, kept in one shell variable and given to the one command that needs it. The pull request comment's token is in the comment step's environment and no other.
- **Inputs reach scripts through `env`.** A run step never has `${{ inputs.… }}` or any other expression inside its script, so no input can become shell code.
- **No dependencies.** The scripts in `scripts/` are plain Node, `node:` modules and `fetch` only. Each is small, does one step's work, and is tested beside itself.
- **No long dashes** in anything a stranger reads: the README, the changelog, `action.yml`, and every line the Action prints or writes. A test holds the Action's own text to it.

## Working on it

```bash
node --test                        # the scripts' tests, Node 22

cd test-app
npm install                        # versioncam from npm
npx versioncam check               # what mode: check runs
npx versioncam render --sequence   # what mode: render runs (needs ffmpeg)
```

To try a versioncam that is not on npm yet, pack it and install the tarball without saving it: `npm i --no-save /path/to/versioncam-x.y.z.tgz`. A tarball is exactly what npm would deliver; a link is not.

`node scripts/comment.mjs --dry-run --report <check report> --status 1 --working-directory test-app` prints the pull request comment for a real report and calls nothing.

## Commits

- The author is `Peter Bulovec <92371345+petbul@users.noreply.github.com>`, the noreply address, in this repository's own git config. No personal address ever appears in this public history: check `git log --format='%an %ae %cn %ce'` before pushing.
- An imperative subject, and a body that says what changed and why. One concern per commit.
- Name the files you add. Never `git add -A`.

## Releases

A release is made by hand on github.com as `vX.Y.Z`, with the Marketplace box ticked for the first. The `Release` workflow then moves the major tag, `vX`, to it, which is what `uses: petbul/versioncam-action@v1` resolves to. Update `CHANGELOG.md` in the commit the release points at.
