---
name: run-tests
description: >-
  Run the full Divine Bridge test suite across all stacks. Use when asked to
  test, validate, or check code before deployment or after changes.
---

# Run Tests

Execute the full test suite matching the CI pipeline in `.github/workflows/ci.yml`.

## Python backend

```bash
# Install dev dependencies (if not already)
pip install -r requirements-dev.txt

# Lint
flake8 --max-line-length=120 --exclude=venv,flask_session,local_storage_data,.git app.py routes/ core/ tests/

# Format check
black --check --line-length=120 app.py routes/ core/ tests/

# Unit tests
USE_LOCAL_STORAGE=true pytest tests/ -v --tb=short
```

## Mobile (Expo / React Native)

```bash
cd mobile

# Install dependencies
npm ci

# TypeScript check
npx tsc --noEmit

# Lint
npm run lint

# Expo doctor
npx expo-doctor
```

## Interpreting results

- **flake8 errors**: Fix style issues before committing.
- **black --check failures**: Run `black --line-length=120 <files>` to auto-format.
- **pytest failures**: Investigate and fix. Tests run with `USE_LOCAL_STORAGE=true` to avoid GCS.
- **tsc errors**: Fix TypeScript type errors in `mobile/`.
- **eslint warnings**: Fix or justify with inline disable comments.
- **expo-doctor issues**: Address dependency version mismatches.

## Quick check (just verify nothing is broken)

```bash
USE_LOCAL_STORAGE=true pytest tests/ -v --tb=short && cd mobile && npx tsc --noEmit
```

Report all results to the user with pass/fail summary.
