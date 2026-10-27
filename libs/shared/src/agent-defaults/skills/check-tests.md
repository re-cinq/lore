---
name: check-tests
description: Run tests only for files changed in current branch
argument-hint: "[base-branch]"
model: claude-haiku-4-5-20251001
context: fork
---

# Check Tests Skill

Run tests only for files that changed in the current branch.

## Usage
```
/check-tests [base-branch]
```

Arguments:
- `base-branch` (optional): The branch to compare against. Defaults to `develop`.

## Instructions

### Step 1: Identify Changed Files

```bash
# Get list of changed TypeScript/JavaScript files
git diff --name-only develop...HEAD 2>/dev/null || git diff --name-only main...HEAD
```

### Step 2: Categorize Files by Project

Separate the changed files into:
- **Frontend files**: Files in `frontend/src/`
- **Backend files**: Files in `node-backend/src/`
- **E2E files**: Files in `e2e/`

### Step 3: Find Related Test Files

For each changed source file, identify related test files:

**Pattern mapping:**
| Source File | Test File Patterns |
|-------------|-------------------|
| `src/components/Foo.tsx` | `Foo.test.tsx`, `Foo.spec.tsx` |
| `src/utils/bar.ts` | `bar.test.ts`, `bar.spec.ts` |
| `src/services/Baz.ts` | `Baz.spec.ts`, `Baz.test.ts` |

```bash
# Find test files for changed files (frontend)
cd frontend && for file in <changed-frontend-files>; do
  basename="${file%.ts*}"
  find src -name "${basename}.test.ts*" -o -name "${basename}.spec.ts*" 2>/dev/null
done

# Find test files for changed files (backend)
cd node-backend && for file in <changed-backend-files>; do
  basename="${file%.ts}"
  find src -name "${basename}.spec.ts" -o -name "${basename}.test.ts" 2>/dev/null
done
```

### Step 4: Run Tests

**Frontend Tests:**
```bash
cd frontend
yarn test --findRelatedTests <list-of-changed-files> --passWithNoTests
```

**Backend Tests:**
```bash
cd node-backend
yarn test --findRelatedTests <list-of-changed-files> --passWithNoTests
```

If `--findRelatedTests` doesn't work well, fall back to:
```bash
# Frontend - run specific test files
cd frontend && yarn test <test-file-1> <test-file-2> --passWithNoTests

# Backend - run specific test files
cd node-backend && yarn test <test-file-1> <test-file-2> --passWithNoTests
```

### Step 5: Report Results

Output a summary:

```
## Test Results for Branch: <branch-name>

### Files Changed
- <list of source files changed>

### Tests Executed

#### Frontend
- Files tested: <count>
- Tests: <passed>/<total>
- Status: PASS/FAIL

#### Backend
- Files tested: <count>
- Tests: <passed>/<total>
- Status: PASS/FAIL

### Coverage Gaps
<list any changed files that don't have corresponding tests>

### Failed Tests
<details of any failures>

### Overall: PASS/FAIL
```

### Notes

- If a changed file has no tests, flag it as a coverage gap
- If tests fail, show the failure details
- Consider running tests in parallel for frontend and backend
- Use `--passWithNoTests` to avoid failures when no tests match

## Help

<!-- lore-help:begin -->
**Summary.** Run only the tests that relate to the files changed on the current branch.
**Usage:** `/check-tests [base-branch]`
**Use when.** You want quick test feedback on your branch without running the whole suite.
**Related:** `/tdd-loop`
<!-- lore-help:end -->
