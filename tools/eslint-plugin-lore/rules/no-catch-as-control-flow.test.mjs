import { RuleTester } from "eslint";
import rule from "./no-catch-as-control-flow.mjs";

const ruleTester = new RuleTester();

ruleTester.run("no-catch-as-control-flow", rule, {
  valid: [
    // status-returning probe: literal fallback is the blessed pattern
    `async function probe() { try { return await counts(); } catch { return null; } }`,
    `function read() { try { return parse(x); } catch { return false; } }`,
    `function read() { try { return parse(x); } catch { return []; } }`,
    // identifier / object-literal fallbacks are sentinels, not fabrication
    `function read() { try { return parse(x); } catch { return fallback; } }`,
    `function read() { try { return parse(x); } catch { return { enabled: false }; } }`,
    // observing the error makes the catch a real handler
    `function g() { try { f(); } catch (err) { console.warn(errorMessage(err)); return h.response(body).code(404); } }`,
    `try { f(); } catch (err) { throw wrap(err); }`,
    // empty fall-through
    `try { f(); } catch {}`,
    // a return inside a nested function is not the catch's return
    `try { f(); } catch { queue.push(() => build()); }`,
  ],
  invalid: [
    {
      // swallows the error AND fabricates a return value — try/catch as control flow
      code: `async function h() { try { return await counts(); } catch { return respond({ status: "error" }).code(503); } }`,
      errors: [{ messageId: "catchAsControlFlow" }],
    },
    {
      // unused param is still swallowing
      code: `function h() { try { return work(); } catch (_err) { return buildFallback(); } }`,
      errors: [{ messageId: "catchAsControlFlow" }],
    },
    {
      // await-wrapped fabrication
      code: `async function h() { try { return await work(); } catch { return await fetchBackup(); } }`,
      errors: [{ messageId: "catchAsControlFlow" }],
    },
    {
      // constructed fabrication
      code: `function h() { try { return work(); } catch { return new Response("x"); } }`,
      errors: [{ messageId: "catchAsControlFlow" }],
    },
  ],
});
