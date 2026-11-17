/**
 * SSRF guard: the agent's fetch tools must never reach internal addresses.
 *
 * Deterministic by default: DNS and HTTP are stubbed through safeFetch's test
 * seams, except the rebinding test, which runs the real guarded undici agent
 * against a throwaway server on 127.0.0.1. Set SSRF_LIVE=1 to also fetch one
 * real public URL over the network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  checkUrl,
  isBlockedAddress,
  safeFetch,
  type FetchLike,
  type Resolver,
} from "../src/tools/safeFetch";
import { fetchPage } from "../src/tools/fetchPage";

const PUBLIC_IP = "93.184.215.14";
const HTML = `<html><body><main>${"Vendor AI governance statement. ".repeat(40)}</main></body></html>`;

/** Resolver stub: known hosts map to fixed IPs; anything else is NXDOMAIN. */
const stubResolve = (map: Record<string, string[]>): Resolver => async (host) => {
  if (map[host]) return map[host];
  throw Object.assign(new Error(`ENOTFOUND ${host}`), { code: "ENOTFOUND" });
};

/** Fetch stub that records every URL it was asked for. */
function stubFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const impl: FetchLike = async (url) => {
    calls.push(url);
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route();
  };
  return { impl, calls };
}

/* ----------------------------------------------------------- address table */

test("blocks loopback, private, link-local, CGNAT, unspecified and IPv6 internal ranges", () => {
  const blocked = [
    "127.0.0.1", "127.255.255.254", "0.0.0.0",
    "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "169.254.0.1",
    "100.64.0.1", "100.127.255.255",
    "224.0.0.1", "255.255.255.255",
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe", "::ffff:192.168.0.1", "::ffff:100.64.0.1", "::ffff:0.0.0.0",
    "::127.0.0.1", "64:ff9b::a9fe:a9fe", "2002:7f00:1::1",
    "[::1]", "not-an-ip", "",
  ];
  for (const ip of blocked) assert.equal(isBlockedAddress(ip), true, `${ip} should be blocked`);
});

test("allows ordinary public addresses", () => {
  for (const ip of [PUBLIC_IP, "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700::6810:84e5", "::ffff:8.8.8.8"]) {
    assert.equal(isBlockedAddress(ip), false, `${ip} should be allowed`);
  }
});

/* ------------------------------------------------------------- URL checks */

test("refuses localhost, 127.0.0.1, 10.x, metadata, [::1] and encoded variants", async () => {
  const urls = [
    "http://localhost/",
    "http://localhost:3000/api/triage",
    "http://127.0.0.1/",
    "http://10.0.0.5/admin",
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://2130706433/", // decimal 127.0.0.1
    "http://0x7f.1/", // hex shorthand
    "http://0/",
  ];
  for (const u of urls) {
    const r = await checkUrl(u);
    assert.equal(r.ok, false, `${u} should be refused`);
    if (!r.ok) assert.equal(r.reason, "blocked", `${u}: ${r.message}`);
  }
});

test("refuses non-http schemes", async () => {
  for (const u of ["file:///etc/passwd", "ftp://example.com/", "gopher://example.com/", "data:text/plain,hi"]) {
    const r = await checkUrl(u);
    assert.equal(r.ok, false, u);
  }
});

test("refuses a hostname whose DNS answer includes any private address", async () => {
  const r = await checkUrl("http://mixed.example/", stubResolve({ "mixed.example": [PUBLIC_IP, "10.0.0.7"] }));
  assert.equal(r.ok, false);
});

/* ---------------------------------------------------------------- fetches */

test("a redirect to a private IP is refused before it is requested", async () => {
  const { impl, calls } = stubFetch({
    "https://vendor.example/trust": () =>
      new Response(null, { status: 302, headers: { location: "http://10.0.0.5/admin" } }),
  });
  const r = await safeFetch("https://vendor.example/trust", {
    resolve: stubResolve({ "vendor.example": [PUBLIC_IP] }),
    fetchImpl: impl,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "blocked");
  assert.deepEqual(calls, ["https://vendor.example/trust"], "the private hop must never be fetched");
});

test("a redirect to a hostname that resolves to metadata is refused", async () => {
  const { impl, calls } = stubFetch({
    "https://vendor.example/a": () =>
      new Response(null, { status: 301, headers: { location: "http://metadata.internal/latest/" } }),
  });
  const r = await safeFetch("https://vendor.example/a", {
    resolve: stubResolve({ "vendor.example": [PUBLIC_IP], "metadata.internal": ["169.254.169.254"] }),
    fetchImpl: impl,
  });
  assert.equal(r.ok, false);
  assert.equal(calls.length, 1);
});

test("redirect loops stop at the cap", async () => {
  const { impl, calls } = stubFetch({
    "https://vendor.example/loop": () =>
      new Response(null, { status: 302, headers: { location: "/loop" } }),
  });
  const r = await safeFetch("https://vendor.example/loop", {
    resolve: stubResolve({ "vendor.example": [PUBLIC_IP] }),
    fetchImpl: impl,
    maxRedirects: 3,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "too_many_redirects");
  assert.equal(calls.length, 4);
});

test("bodies over the size cap are refused", async () => {
  const big = new Uint8Array(2048);
  const { impl } = stubFetch({ "https://vendor.example/big": () => new Response(big, { status: 200 }) });
  const r = await safeFetch("https://vendor.example/big", {
    resolve: stubResolve({ "vendor.example": [PUBLIC_IP] }),
    fetchImpl: impl,
    maxBytes: 1024,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "too_large");
});

test("an allowed public URL is fetched, including a same-site redirect", async () => {
  const { impl, calls } = stubFetch({
    "https://vendor.example/old": () =>
      new Response(null, { status: 308, headers: { location: "https://docs.vendor.example/ai" } }),
    "https://docs.vendor.example/ai": () =>
      new Response(HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
  });
  const page = await fetchPage("https://vendor.example/old", {
    resolve: stubResolve({ "vendor.example": [PUBLIC_IP], "docs.vendor.example": [PUBLIC_IP] }),
    fetchImpl: impl,
  });
  assert.equal(page.ok, true, page.ok ? "" : page.message);
  if (page.ok) assert.match(page.value.body as string, /Vendor AI governance statement/);
  assert.deepEqual(calls, ["https://vendor.example/old", "https://docs.vendor.example/ai"]);
});

test("fetchPage (used by fetch_page and parse_document) returns FETCH_BLOCKED for internal targets", async () => {
  for (const u of ["http://169.254.169.254/latest/meta-data/", "http://localhost:3000/", "http://[::1]:8080/"]) {
    const r = await fetchPage(u);
    assert.equal(r.ok, false, u);
    if (!r.ok) assert.equal(r.code, "FETCH_BLOCKED", `${u}: ${r.message}`);
  }
});

/* -------------------------------------------- real socket: DNS rebinding */

test("the real connection is refused if DNS answers privately at connect time", async () => {
  let hits = 0;
  const server = createServer((_, res) => { hits++; res.end("internal secret"); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    // The pre-check is told `localhost` is public (as a rebinding attacker's
    // first DNS answer would); the guarded agent's own lookup then sees
    // 127.0.0.1 and must refuse to connect.
    const r = await safeFetch(`http://localhost:${port}/`, {
      resolve: stubResolve({ localhost: [PUBLIC_IP] }),
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "blocked", r.message);
    assert.equal(hits, 0, "the internal server must not receive a request");
  } finally {
    server.close();
  }
});

test("live: a real public URL is fetched", { skip: !process.env.SSRF_LIVE && "set SSRF_LIVE=1 to run" }, async () => {
  const r = await fetchPage("https://example.com/");
  assert.equal(r.ok, true, r.ok ? "" : `${r.code}: ${r.message}`);
});
