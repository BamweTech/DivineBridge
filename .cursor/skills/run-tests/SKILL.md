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

# Lint (config in .flake8)
flake8 --max-line-length=120 app.py tests/ backend/

# Format check
black --check --line-length=120 app.py tests/ backend/

# Unit + contract tests
USE_LOCAL_STORAGE=true pytest tests/ -v --tb=short

# Route inventory (optional smoke)
python -m scripts.maintenance.verify_route_map
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

## Media SFU

```bash
cd media-server
npm run check
npm run test:protocol
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
