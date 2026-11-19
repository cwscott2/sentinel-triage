/**
 * Custom-URL access: off by default, unlocked only by the exact configured code.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCustomAccess, MIN_CODE_LENGTH } from "../src/lib/access";
import { parseUrlList } from "../src/lib/urlList";

const CODE = "airworthy-demo-7Q4k";

test("off when the variable is unset, empty, or too short", () => {
  assert.deepEqual(checkCustomAccess(CODE, undefined), { ok: false, reason: "disabled" });
  assert.deepEqual(checkCustomAccess(CODE, ""), { ok: false, reason: "disabled" });
  assert.deepEqual(checkCustomAccess("abc", "abc"), { ok: false, reason: "disabled" });
  assert.ok("x".repeat(MIN_CODE_LENGTH - 1).length < MIN_CODE_LENGTH);
});

test("needs a code, and only the exact one", () => {
  assert.deepEqual(checkCustomAccess(undefined, CODE), { ok: false, reason: "missing" });
  assert.deepEqual(checkCustomAccess("", CODE), { ok: false, reason: "missing" });
  assert.deepEqual(checkCustomAccess(CODE.slice(0, -1), CODE), { ok: false, reason: "wrong" });
  assert.deepEqual(checkCustomAccess(CODE.toUpperCase(), CODE), { ok: false, reason: "wrong" });
  assert.deepEqual(checkCustomAccess(CODE + "x", CODE), { ok: false, reason: "wrong" });
  assert.deepEqual(checkCustomAccess(CODE, CODE), { ok: true });
  assert.deepEqual(checkCustomAccess(` ${CODE} `, `${CODE}\n`), { ok: true });
});

test("URL list: one per line or comma separated, http(s) only, at most 3", () => {
  assert.deepEqual(parseUrlList("https://a.example/x\nhttps://b.example/y"), {
    ok: true, urls: ["https://a.example/x", "https://b.example/y"],
  });
  assert.deepEqual(parseUrlList("https://a.example, https://a.example"), { ok: true, urls: ["https://a.example"] });
  assert.equal(parseUrlList("").ok, false);
  assert.equal(parseUrlList("not a url").ok, false);
  assert.equal(parseUrlList("ftp://a.example/file").ok, false);
  assert.equal(parseUrlList("file:///etc/passwd").ok, false);
  assert.equal(parseUrlList("https://a.example\nhttps://b.example\nhttps://c.example\nhttps://d.example").ok, false);
});
