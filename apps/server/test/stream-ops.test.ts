import assert from "node:assert/strict";
import test from "node:test";
import { applyOp, diffOps, type DocOp, type Json } from "../src/contract/stream-ops.js";

const apply = (doc: { [key: string]: Json }, ops: DocOp[]) => {
  for (const op of ops) applyOp(doc, op);
  return doc;
};
const roundTrip = (previous: { [key: string]: Json }, next: { [key: string]: Json }) => {
  const ops = diffOps(previous, next);
  assert.deepEqual(apply(structuredClone(previous), ops), next);
  return ops;
};

test("a grown string is an append, anything else a set", () => {
  assert.deepEqual(roundTrip({ t: "abc" }, { t: "abcdef" }), [{ op: "append", path: ["t"], text: "def" }]);
  assert.deepEqual(roundTrip({ t: "abc" }, { t: "xyz" }), [{ op: "set", path: ["t"], value: "xyz" }]);
  assert.deepEqual(roundTrip({ t: "abc" }, { t: "ab" }), [{ op: "set", path: ["t"], value: "ab" }]);
  assert.deepEqual(roundTrip({ t: "abc" }, { t: "abc" }), []);
});

test("objects diff by key; removed keys are deleted", () => {
  const ops = roundTrip({ a: 1, b: { c: "x", d: true } }, { a: 1, b: { c: "xy" }, e: null });
  assert.deepEqual(ops, [
    { op: "del", path: ["b", "d"] },
    { op: "append", path: ["b", "c"], text: "y" },
    { op: "set", path: ["e"], value: null },
  ]);
});

test("arrays that grow diff element by element; shorter arrays are replaced whole", () => {
  const grown = roundTrip(
    { tail: [{ parts: [{ text: "hi" }] }] },
    { tail: [{ parts: [{ text: "hi there" }, { text: "new" }] }, { parts: [] }] },
  );
  assert.deepEqual(grown, [
    { op: "append", path: ["tail", 0, "parts", 0, "text"], text: " there" },
    { op: "set", path: ["tail", 0, "parts", 1], value: { text: "new" } },
    { op: "set", path: ["tail", 1], value: { parts: [] } },
  ]);
  assert.deepEqual(roundTrip({ tail: [1, 2, 3] }, { tail: [1] }), [{ op: "set", path: ["tail"], value: [1] }]);
});

test("a changed type is replaced", () => {
  assert.deepEqual(roundTrip({ x: { a: 1 } }, { x: [1] }), [{ op: "set", path: ["x"], value: [1] }]);
  assert.deepEqual(roundTrip({ x: "s" }, { x: { a: 1 } }), [{ op: "set", path: ["x"], value: { a: 1 } }]);
});

test("applying rejects unsafe or impossible operations", () => {
  assert.throws(() => applyOp({}, { op: "set", path: ["__proto__", "x"], value: 1 }), /Invalid path/);
  assert.throws(() => applyOp({}, { op: "set", path: ["constructor"], value: 1 }), /Invalid path/);
  assert.throws(() => applyOp({}, { op: "set", path: [], value: 1 }), /Invalid path/);
  assert.throws(() => applyOp({ a: {} }, { op: "set", path: ["a", "b", "c"], value: 1 }), /Invalid path/);
  assert.throws(() => applyOp({ a: 1 }, { op: "append", path: ["a"], text: "x" }), /Invalid append/);
});
