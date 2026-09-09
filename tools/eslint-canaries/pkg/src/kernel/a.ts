/** Canary: kernel is declared a leaf, so this import MUST be reported. */
import { b } from "../jobs/b.js";

export const a = () => b();
