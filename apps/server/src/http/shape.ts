import { Type, type Static, type TProperties, type TSchema } from "typebox";
import { Compile } from "typebox/compile";
import { UUID } from "../contract/ids.js";
import { RuntimeError } from "../core/runtime/errors.js";

/**
 * The shape of what a client sends: one schema per body, checked before anything reads it. A schema
 * says the keys and the kind of each; what a value means (an agent there is, a title worth keeping) is
 * checked after it. The contract's types stay the documented ones: `Same` holds each schema to its type.
 */

/** An object with exactly these keys: one it does not name is refused. */
export const exact = <P extends TProperties>(properties: P) => Type.Object(properties, { additionalProperties: false });

export const Uuid = Type.String({ pattern: UUID.source });
/** Text that says something: not empty, not only spaces. */
export const Text = (maxLength?: number) => Type.String({ pattern: "\\S", ...(maxLength === undefined ? {} : { maxLength }) });

/** Reads a value as its schema says, or refuses it: `invalid-input`, unless an API has its own word for that. */
export function shaped<S extends TSchema>(schema: S, refusal: () => Error = () => new RuntimeError("invalid-input")): (value: unknown) => Static<S> {
  const compiled = Compile(schema);
  return (value) => {
    if (!compiled.Check(value)) throw refusal();
    return value as Static<S>;
  };
}

/**
 * Whether a schema and a contract type describe the same values. `true satisfies Same<Static<typeof X>, T>`
 * beside a schema stops compiling the moment one gains a field or a word the other lacks.
 */
export type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
