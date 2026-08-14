import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import rule from "./no-inline-styles.mjs";

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const VIEW = "/repo/apps/web-ui/src/components/StatusBadge.tsx";
const OUTSIDE = "/repo/apps/vscode-extension/src/Panel.tsx";

ruleTester.run("no-inline-styles", rule, {
  valid: [
    { code: `const A = () => <div className="card" />;`, filename: VIEW },
    // a CSS module is the point of the rule, not a violation of it
    {
      code: `import s from "./x.module.scss"; const A = () => <div className={s.card} />;`,
      filename: VIEW,
    },
    // outside web-ui the rule does not apply
    { code: `const A = () => <div style={{ margin: 0 }} />;`, filename: OUTSIDE },
    // a non-style attribute that happens to hold an object
    { code: `const A = () => <div data-x={{ a: 1 }} />;`, filename: VIEW },
    // handing the stylesheet a value is not styling in the component
    {
      code: `const A = (p: { c: string }) => <div style={{ "--pill-color": p.c }} />;`,
      filename: VIEW,
    },
    // the cast the CSSProperties type forces on a custom property, written
    // around the key or around the whole object
    {
      code: `const A = (p: { c: string }) => <div style={{ ["--pill-color" as string]: p.c }} />;`,
      filename: VIEW,
    },
    {
      code: `const A = (p: { c: string }) => <div style={{ "--pill-color": p.c } as CSSProperties} />;`,
      filename: VIEW,
    },
  ],
  invalid: [
    {
      code: `const A = () => <div style={{ margin: 0 }} />;`,
      filename: VIEW,
      errors: [{ messageId: "inlineStyle" }],
    },
    {
      // a computed object is still a style prop — the styling decision is still
      // in the component rather than in a stylesheet
      code: `const A = (p: { s: object }) => <div style={p.s} />;`,
      filename: VIEW,
      errors: [{ messageId: "inlineStyle" }],
    },
    {
      code: `const A = () => <div style={{ color: "red" }}><span style={{ margin: 1 }} /></div>;`,
      filename: VIEW,
      errors: [{ messageId: "inlineStyle" }, { messageId: "inlineStyle" }],
    },
    {
      // one real declaration alongside a custom property is still a decision
      // made in the component
      code: `const A = (p: { c: string }) => <div style={{ "--pill-color": p.c, margin: 0 }} />;`,
      filename: VIEW,
      errors: [{ messageId: "inlineStyle" }],
    },
    {
      // an empty object is not the custom-property handoff, just noise
      code: `const A = () => <div style={{}} />;`,
      filename: VIEW,
      errors: [{ messageId: "inlineStyle" }],
    },
  ],
});
