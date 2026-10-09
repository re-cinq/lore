import type { Brief, Tools } from "@re-cinq/floor-station";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

/** A visit's bag as the floor hands it: reading a file the bag does not hold fails the way the floor's own tools do, and an optional file the bag holds is named in the brief, as the floor names it. The brief a test builds names the required ones itself. */
export function visitBag(
  required: Record<string, string>,
  optional: Record<string, string> = {},
) {
  const produced: Record<string, string> = {};
  const tools = bagTools({ ...required, ...optional }, produced);
  const needs = Object.fromEntries(
    Object.keys(optional).map((name) => [name, `blob://${name}`]),
  );

  /** The brief with the optional files the bag holds among its needs. */
  const given = <Given extends Pick<Brief, "needs">>(brief: Given): Given => ({
    ...brief,
    needs: { ...needs, ...brief.needs },
  });

  return { tools, produced, given };
}

function bagTools(
  files: Record<string, string>,
  produced: Record<string, string>,
): Tools {
  return {
    read: async (need) => {
      enforceTrue(
        need in files,
        Error,
        `"${need}" is not a file this visit was given`,
      );

      return Buffer.from(files[need]!);
    },
    produce: async (name, bytes) => {
      produced[name] = bytes.toString();
    },
    modelCall: async () => {},
    signal: new AbortController().signal,
  };
}
