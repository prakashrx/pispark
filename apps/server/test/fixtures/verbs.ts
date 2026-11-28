import { toolOf, type VerbName } from "../../src/contract/verbs.js";

/** A prompt that makes the local provider call one of PiSpark's ten verb tools. */
export const say = (verb: VerbName, args: object = {}) => `tool:${toolOf(verb)}:${JSON.stringify(args)}`;
/** A prompt that makes it call several, one after another, so a later call can name what an earlier one started. */
export const steps = (...calls: [VerbName, object?][]) => `steps:${JSON.stringify(calls.map(([verb, args]) => ({ name: toolOf(verb), args: args ?? {} })))}`;
