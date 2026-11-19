const src = (path, before, after) => ({ path, role: "code", before, after });
const test = (path, before, after = before) => ({
  path,
  role: "test",
  before,
  after,
});
const issue = (name, text) => ({
  source: "issue",
  url: `https://example.invalid/pilot/${name}/issue`,
  text,
});
const reply = (name, text) => ({
  source: "issue_comment",
  url: `https://example.invalid/pilot/${name}/scope`,
  text,
});
const specification = (path, text) => ({ path, revision: "base", text });

export const cases = [
  {
    id: "delegated-captions",
    files: [
      src(
        "caption-policy.js",
        "export const canCaption = ({ activeDelegate, venue }, exhibit) => activeDelegate && venue === exhibit.venue;",
        "export const canCaption = ({ activeDelegate }, _exhibit) => activeDelegate;",
      ),
      src(
        "caption.js",
        "import { canCaption } from './caption-policy.js';\nexport function caption(actor, exhibit, label) { if (!canCaption(actor, exhibit)) return 'refused'; exhibit.label = label; return 'published'; }",
        "import { canCaption } from './caption-policy.js';\nexport function caption(actor, exhibit, label) { if (!canCaption(actor, exhibit)) return 'refused'; exhibit.label = label; return 'published'; }",
      ),
      test(
        "caption.test.js",
        "it('publishes in the delegate venue', () => expect(caption({activeDelegate:true, venue:'west'}, {venue:'west'}, 'fish')).toBe('published'));",
      ),
    ],
    discussion: [
      issue(
        "caption",
        "Simplify how active volunteers publish captions. Keep each volunteer's venue assignment in force.",
      ),
    ],
    specs: [
      specification(
        "specs/captions.md",
        "Active label delegates can publish captions only for their assigned venue. A refusal leaves the exhibit untouched.",
      ),
    ],
    expected:
      "Block active west delegate publishing in east venue via caption(); require refusal and unchanged label. The same-venue success test passes either implementation.",
    verdict: "request_changes",
  },
  {
    id: "missing-rest-day-refusal",
    files: [
      src(
        "reservations.js",
        "export function reserve(day, ledger) { ledger.push(day); return 'reserved'; }",
        "export function reserve(day, ledger) { if (day === 'Monday') return 'closed'; ledger.push(day); return 'reserved'; }",
      ),
      test(
        "reservations.test.js",
        "it('reserves Tuesday', () => { const ledger=[]; expect(reserve('Tuesday',ledger)).toBe('reserved'); expect(ledger).toEqual(['Tuesday']); });",
      ),
    ],
    discussion: [
      issue(
        "reservation",
        "The gallery closes Mondays. Add Monday reservation refusal and lock the fix with a test that observes both the refusal and unchanged ledger.",
      ),
    ],
    specs: [
      specification(
        "specs/reservations.md",
        "Monday reservations return closed and never add an entry to the ledger.",
      ),
    ],
    expected:
      "Block missing coverage because agreed scope includes a negative test. Monday must return closed and leave ledger empty. Existing implementation is correct; Tuesday-only test does not distinguish regression.",
    verdict: "request_changes",
  },
  {
    id: "mixed-flyers",
    files: [
      src(
        "flyer.js",
        "export const heading = (event) => event.title;",
        "export const heading = (event) => event.title.trim();",
      ),
      test(
        "flyer.test.js",
        "it('uses the title', () => expect(heading({title:'Fair'})).toBe('Fair'));",
        "it('trims the title', () => expect(heading({title:' Fair '})).toBe('Fair'));",
      ),
      src(
        "admission.js",
        "export const admission = ({ age }) => age < 12 ? 0 : 5;",
        "export const admission = ({ age }) => age < 10 ? 0 : 5;",
      ),
      test(
        "admission.test.js",
        "it('admits a 9-year-old for free', () => expect(admission({age:9})).toBe(0));",
      ),
    ],
    discussion: [
      issue(
        "flyer",
        "Trim whitespace around event flyer headings. Admission prices are unchanged.",
      ),
    ],
    specs: [
      specification(
        "specs/admission.md",
        "Children under twelve are admitted for free.",
      ),
    ],
    expected:
      "Account for correctly tested heading trim and independently block the new fee for ages 10–11. The age-nine assertion passes both implementations.",
    verdict: "request_changes",
  },
  {
    id: "deferred-colour",
    files: [
      src(
        "calendar.js",
        "export const display = (event) => event.title;",
        "export const display = (event) => `[${event.room}] ${event.title}`;",
      ),
      test(
        "calendar.test.js",
        "it('shows title', () => expect(display({room:'N',title:'Fair'})).toBe('Fair'));",
        "it('shows room and title', () => expect(display({room:'N',title:'Fair'})).toBe('[N] Fair'));",
      ),
    ],
    discussion: [
      issue(
        "calendar",
        "We would like room names and category colours in calendar rows.",
      ),
      reply(
        "calendar",
        "As calendar owner, I am splitting this. This PR ships room names only; category colours are deferred to a later PR.",
      ),
    ],
    specs: [
      specification(
        "specs/calendar.md",
        "Calendar entries display an event title. Category colours are a proposed future enhancement.",
      ),
    ],
    expected:
      "Approve the room-name slice. Note explicit owner deferral; do not block missing category colours or claim the title disappears.",
    verdict: "approve",
  },
  {
    id: "clean-refactor",
    files: [
      src(
        "crate.js",
        "export const crates = (items) => Math.ceil(items / 6);",
        "const crateCapacity = 6;\nexport const crates = (items) => Math.ceil(items / crateCapacity);",
      ),
      test(
        "crate.test.js",
        "it.each([[0,0],[1,1],[6,1],[7,2],[-1,-0]])('calculates crates for %d', (items,expected) => expect(crates(items)).toBe(expected));",
      ),
    ],
    discussion: [
      issue(
        "crates",
        "Name the crate capacity constant while preserving behavior. Counts in the supported workflow are nonnegative integers.",
      ),
    ],
    specs: [
      specification(
        "specs/crates.md",
        "Each crate holds six items. Allocate enough crates for every eligible item.",
      ),
    ],
    expected:
      "Approve the behavior-preserving constant extraction. Credit existing zero, exact capacity, and overflow assertions. No fabricated regression or mandatory boundary test.",
    verdict: "approve",
  },
];
