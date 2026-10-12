/** Compile-time proof that a zod schema and a dependency-free plain type are one shape: `type Check = Assert<Equals<z.infer<typeof Schema>, PlainType>>` fails `tsc` when a field is added to either side alone. */

export type Assert<T extends true> = T;

/** Identity-based equality, not a bidirectional `extends` — an `extends` pair can't see an added OPTIONAL field (`{a?: x}` and `{}` each extend the other). */
export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
