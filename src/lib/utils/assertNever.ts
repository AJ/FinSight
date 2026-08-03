/**
 * Compile-time exhaustiveness check for `switch` over a closed union.
 *
 * Place as the `default` case. TypeScript narrows the switched value to `never`
 * only when every union member has a case, so:
 *   - if all members are handled, this compiles and is unreachable at runtime;
 *   - if a new union member is added without a case, `value` is no longer
 *     `never` and this call becomes a compile error — forcing you to handle it.
 *
 *   switch (sub) {
 *     case 'a': return ...;
 *     case 'b': return ...;
 *     default: assertNever(sub);   // compile error if 'c' joins the union
 *   }
 *
 * At runtime, if a non-canonical value slips through a type cast, this throws
 * rather than letting control fall through silently.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled union member: ${JSON.stringify(value)}`);
}
