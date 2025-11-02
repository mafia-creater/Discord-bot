# Contributing

Thank you for your interest in contributing to this project! This document explains how to report issues, propose changes, and submit pull requests so your contribution can be reviewed and merged quickly.

## Table of Contents
- How to report bugs
- Suggesting enhancements
- Development setup
- Branching & pull requests
- Code style
- Tests
- Commit messages
- Code of Conduct
- License

## How to report bugs

When reporting a bug, please include:

- A clear and descriptive title.
- Steps to reproduce the problem.
- What you expected to happen and what actually happened.
- Relevant logs or error messages (redact any secrets).
- Node.js version and OS where you observed the issue.

Use the `bug` label when creating issues.

## Suggesting enhancements

If you'd like to propose a new feature or improvement, open an issue titled `RFC: Short feature name` and describe:

- The problem you're solving.
- Proposed solution or approach.
- Any alternatives considered.

Maintainters may ask you to open a draft PR for larger changes.

## Development setup

1. Install dependencies

```powershell
npm install
```

2. Create an environment file from the example and fill in credentials

```powershell
copy .env.example .env
# edit .env with your values
```

3. Install system dependencies

- Install `yt-dlp` and ensure it is available on PATH.
- Install `ffmpeg` and ensure `ffmpeg` is available on PATH (required for audio playback).

4. Start the bot locally

```powershell
npm run dev
```

Notes:
- Avoid committing your `.env` or any secret keys. Use `.env.example` for documentation only.

## Branching & pull requests

- Create feature branches from `main`: `git checkout -b feat/short-description`.
- Keep PRs small and focused.
- Include tests for new logic where practical.
- Reference related issues in PR descriptions (e.g., `Fixes #123`).

When your PR is ready:

1. Push your branch
2. Open a PR against `main`
3. Add a clear title and description with motivation

## Code style

- Follow existing code style in the repository.
- Use meaningful variable and function names.
- Keep functions small and single-purpose.

Linting

- We recommend adding ESLint if you plan to extend the project. For now, run the linter locally if present:

```bash
npm run lint
```

## Tests

Add unit or integration tests when adding new features.
If you add tests, include instructions to run them and ensure the CI workflow runs them as well.

## Commit messages

Use concise, descriptive commit messages. Example:

```
feat(audio): use PassThrough for yt-dlp streams

Add robust stream handling and cleanup to prevent crashes.
```

Prefixes we use (recommended):
- `feat`: new feature
- `fix`: bug fix
- `chore`: maintenance, dependencies
- `docs`: documentation changes
- `refactor`: code changes that do not affect behavior

## Code of Conduct

Be respectful and courteous. If you want to contribute a Code of Conduct to the repo, you can add a `CODE_OF_CONDUCT.md` file. For public projects, consider adopting the Contributor Covenant.

## License

By contributing, you agree that your contributions will be licensed under the project's MIT license.

---

If you need help getting started, open an issue and tag @mafia-creater or leave a comment on an existing issue.

---

## 🎃 Hacktoberfest 2025 Notice

This project is participating in **Hacktoberfest 2025!**

We welcome all contributors — whether you’re fixing bugs, improving code structure, or adding new Discord game features like:
- 🎵 New game modes  
- 🧠 Better hint systems  
- ⚡ Power-ups and challenges  
- 🎨 Improved user interaction (embeds, buttons, menus)

Please make sure your PRs are **meaningful and not spammy**.  
Valid contributions will be labeled:

