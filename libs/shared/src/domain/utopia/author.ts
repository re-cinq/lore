// Who wrote a commit or opened a pull request or issue, as the Person it was authored_by; nothing for an author GitHub did not name.

import type { Fragment } from "./fragments.js";
import { personName } from "./names.js";
import { relation } from "./statements.js";

export function authorFragment(subject: string, author: string): Fragment {
  if (author === "") {
    return { e: [], s: [] };
  }
  const person = personName(author);

  return {
    e: [[person, "Person", true]],
    s: [relation(subject, "authored_by", person)],
  };
}
