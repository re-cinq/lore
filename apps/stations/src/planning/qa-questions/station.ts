// Judges the frozen question set the generator wrote from the plan: a set that cites nothing real or skips an open plan question goes back to the generator, and a good one is published without its expected values so the answerer stays blind (see specs/7-feature-planning/spec.md FR-24).

import {
  defineStation,
  type Brief,
  type Handle,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import type { CitablePlan } from "@re-cinq/lore-shared/feature-planning/plan-coverage.js";
import { specQuestionSchema } from "@re-cinq/lore-shared/feature-planning/spec-qa.js";
import {
  questionErrors,
  questionErrorsBrief,
} from "@re-cinq/lore-shared/feature-planning/spec-questions.js";

export function qaQuestionsHandle(): Handle {
  return async (brief, tools) => {
    const plan = await planOf(brief, tools);
    const errors = await errorsOf(tools, plan);

    if (errors.problems.length > 0 || !errors.questions) {
      await tools.produce(
        "qa_question_errors",
        questionErrorsBrief(errors.problems),
      );

      return { outcome: "changes_requested" };
    }
    const blind = errors.questions.map(({ id, question }) => ({
      id,
      question,
    }));

    await tools.produce("qa_blind", JSON.stringify(blind));
    // The bag never drops a key: an empty file clears the last attempt's errors.
    await tools.produce("qa_question_errors", "");

    return { outcome: "success" };
  };
}

/** Null where the deployment names no web UI, so the run has no blocks to cite. */
async function planOf(brief: Brief, tools: Tools): Promise<CitablePlan | null> {
  return brief.needs.plan_blocks
    ? ((await readJson(tools, "plan_blocks")) as CitablePlan)
    : null;
}

async function errorsOf(tools: Tools, plan: CitablePlan | null) {
  const parsed = specQuestionSchema
    .array()
    .safeParse(await readJson(tools, "qa_questions").catch(() => null));

  return parsed.success
    ? {
        questions: parsed.data,
        problems: questionErrors(parsed.data, plan),
      }
    : {
        questions: null,
        problems: [
          "The file is not a JSON array of questions with every field.",
        ],
      };
}

async function readJson(tools: Tools, need: string): Promise<unknown> {
  return JSON.parse((await tools.read(need)).toString("utf8"));
}

export function startQaQuestionsStation(): RunningStation {
  return defineStation("qa-questions", qaQuestionsHandle());
}
