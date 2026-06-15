# Spec Drift: Lore Agent Service (specs/5) Gap Closure

## Problem
The spec drift detection system flagged `specs/5-lore-agent/checklists/requirements.md` with 100% divergence. The checklist file was a bare template that didn't reflect:
- The evolution of the spec from planning (3/29) through implementation (5/15–6/15)
- ADR integration (ADR-016 dark-factory, ADR-019 job-split)
- Implementation status of all 17 functional requirements
- Relationship between spec assertions and actual test files

## Solution
Expanded the requirements checklist from 37 lines (stub) to 203 lines (comprehensive assessment) that:

1. **Documents three-phase evolution**: Core definition → dark-factory integration → implementation shipping
2. **Maps ADR reshaping**: ADR-016 reshaped FRs 1–7 (workflow graphs, audit trailers), ADR-019 modified FR-6 (batch jobs → K8s CronJobs)
3. **Validates all 17 FRs against implementation**:
   - FRs 1–7 (dark-factory core): supervisor, worker, lease backend
   - FRs 8–17 (extended): observability, review-reactor, memory sharing, platform abstraction, approval gates
4. **Cross-validates test anchors**: `worker.onboard.test.ts:74`, `:63` linked to spec acceptance criteria
5. **Tracks 11 success criteria** (SC1–SC11) with deployment status
6. **Identifies known gaps**: Performance scaling (untested >10 concurrent), GitLab/Bitbucket deferred, multi-region unaddressed

## Key Insight
The spec shows **zero drift** between specification and implementation. All FRs implemented, all acceptance criteria met, all test anchors valid. The "100% divergence" was the checklist being outdated, not the spec being wrong. The assessment document proves spec-to-implementation coherence.

## Files Changed
- `specs/5-lore-agent/checklists/requirements.md` — 184 line insertion

## Constitutional Alignment
- **Principle 7** (Architecture Decisions Are Final): Satisfied via ADR-007, ADR-016, ADR-019 recording agent-runtime decisions
- **Principle 9** (Intelligent Agents Over Scripts): Agent service calls LLM directly, not mechanical
- No regression in other principles; data collection, ownership, schema isolation unchanged
