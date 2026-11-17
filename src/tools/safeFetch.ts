/**
 * SSRF guard for every outbound fetch the agent makes.
 *
 * The model chooses the URLs `fetch_page` and `parse_document` read, so a URL
 * is untrusted input: a prompt-injected page can steer the agent at
 * http://169.254.169.254/ (cloud metadata), http://localhost:3000/ or a
 * private-network admin panel. Both tools go through `fetchPage`, which goes
 * through `safeFetch`, so this file is the one place the rule lives.
 *
 * The rule, checked on every hop:
 *   1. Only http: and https:.
 *   2. The host must resolve only to public addresses. Loopback, RFC 1918,
 *      link-local (incl. metadata), CGNAT, unspecified, multicast/reserved,
 *      IPv6 loopback/ULA/link-local, and IPv4-mapped/compatible/NAT64/6to4
 *      forms of any of those are refused. Unparseable addresses are refused.
 *   3. Redirects are followed by hand (max MAX_REDIRECTS), each target checked
 *      again by rule 1 and 2.
 *   4. The socket itself is opened through a lookup that applies rule 2 to the
 *      address it actually connects to, so a DNS answer that changes between
 *      the check and the connect (rebinding) is still refused.
 *   5. One timeout covers the whole chain, and the body is capped at
 *      MAX_BODY_BYTES (after decompression).
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

export const MAX_REDIRECTS = 5;
export const MAX_BODY_BYTES = 10 * 1024 * 1024;
export const TIMEOUT_MS = 15_000;

/* ---------------------------------------------------------------- addresses */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8], // "this network", incl. 0.0.0.0 unspecified
  ["10.0.0.0", 8], // RFC 1918
  ["100.64.0.0", 10], // CGNAT (RFC 6598)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. 169.254.169.254 metadata
  ["172.16.0.0", 12], // RFC 1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // RFC 1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. 255.255.255.255
];

function isBlockedV4(n: number): boolean {
  return V4_BLOCKS.some(([base, bits]) => {
    const b = ipv4ToInt(base)!;
    const size = 2 ** (32 - bits);
    return n >= b && n < b + size;
  });
}

/** 16 bytes, or null if not a valid IPv6 literal. */
function ipv6ToBytes(input: string): number[] | null {
  let ip = input.split("%")[0]; // drop zone id
  // Trailing dotted IPv4 (::ffff:127.0.0.1) -> two hextets.
  const dotted = ip.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const v4 = ipv4ToInt(dotted[2]);
    if (v4 === null) return null;
    ip = `${dotted[1]}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    const v = parseInt(g, 16);
    bytes.push(v >> 8, v & 0xff);
  }
  return bytes;
}

function v4FromBytes(b: number[]): number {
  return ((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3];
}

/** True if connecting to this IP literal could reach something non-public. Fails closed. */
export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "");
  const kind = isIP(ip.split("%")[0]);
  if (kind === 4) {
    const n = ipv4ToInt(ip);
    return n === null || isBlockedV4(n);
  }
  if (kind !== 6) return true;

  const b = ipv6ToBytes(ip);
  if (!b) return true;
  const zeroPrefix = (len: number) => b.slice(0, len).every((x) => x === 0);

  if (zeroPrefix(16)) return true; // :: unspecified
  if (zeroPrefix(15) && b[15] === 1) return true; // ::1 loopback
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (IPv4-compatible, deprecated)
  if (zeroPrefix(10) && ((b[10] === 0xff && b[11] === 0xff) || (b[10] === 0 && b[11] === 0))) {
    return isBlockedV4(v4FromBytes(b.slice(12)));
  }
  // 64:ff9b::/96 NAT64 well-known prefix embeds an IPv4 address.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) {
    return isBlockedV4(v4FromBytes(b.slice(12)));
  }
  // 2002::/16 6to4 embeds an IPv4 address in bytes 2..5.
  if (b[0] === 0x20 && b[1] === 0x02) return isBlockedV4(v4FromBytes(b.slice(2, 6)));
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true; // fec0::/10 site-local (deprecated)
  if (b[0] === 0xff) return true; // ff00::/8 multicast
  return false;
}

/* --------------------------------------------------------------------- URLs */

export type Resolver = (hostname: string) => Promise<string[]>;

const systemResolve: Resolver = (hostname) =>
  new Promise((resolve, reject) =>
    dnsLookup(hostname, { all: true }, (e, addrs) =>
      e ? reject(e) : resolve(addrs.map((a) => a.address))
    )
  );

export type GuardResult =
  | { ok: true; url: URL }
  | { ok: false; reason: "blocked" | "unresolvable"; message: string };

/** Rules 1 and 2 for a single URL. */
export async function checkUrl(raw: string | URL, resolve: Resolver = systemResolve): Promise<GuardResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "blocked", message: `Not a valid URL: ${String(raw)}` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "blocked", message: `Scheme ${url.protocol} is not allowed` };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, reason: "blocked", message: "URL has no host" };

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await resolve(host);
    } catch (e) {
      return { ok: false, reason: "unresolvable", message: `DNS lookup failed for ${host}: ${String(e)}` };
    }
    if (addresses.length === 0) {
      return { ok: false, reason: "unresolvable", message: `No addresses for ${host}` };
    }
  }
  const bad = addresses.find(isBlockedAddress);
  if (bad) {
    return { ok: false, reason: "blocked", message: `${host} resolves to non-public address ${bad}` };
  }
  return { ok: true, url };
}

/* -------------------------------------------------------------------- fetch */

const BLOCKED_CODE = "ERR_SSRF_BLOCKED";

/**
 * Connect-time lookup (rule 4). Node's socket layer calls this for every
 * hostname connection; the address it returns is the one actually dialed.
 */
function guardedLookup(
  hostname: string,
  options: { family?: number; all?: boolean } | number | undefined,
  callback: (...args: any[]) => void
) {
  const opts = typeof options === "object" && options ? options : {};
  const family = typeof options === "number" ? options : opts.family ?? 0;
  dnsLookup(hostname, { all: true, family }, (e, addrs: LookupAddress[]) => {
    if (e) return callback(e);
    const bad = addrs.find((a) => isBlockedAddress(a.address));
    if (bad || addrs.length === 0) {
      const blocked = Object.assign(
        new Error(`${hostname} resolved to non-public address ${bad?.address ?? "(none)"} at connect time`),
        { code: BLOCKED_CODE }
      );
      return callback(blocked);
    }
    if (opts.all) return callback(null, addrs);
    callback(null, addrs[0].address, addrs[0].family);
  });
}

const guardedAgent = new Agent({ connect: { lookup: guardedLookup as any } });

export interface SafeResponse {
  url: string;
  status: number;
  contentType: string;
  body: Uint8Array;
}

export type SafeFetchResult =
  | { ok: true; value: SafeResponse }
  | {
      ok: false;
      reason: "blocked" | "unresolvable" | "too_large" | "too_many_redirects" | "timeout" | "network";
      message: string;
    };

/** Minimal response shape safeFetch reads; satisfied by undici and WHATWG Response. */
export interface FetchLikeResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null | any;
}
export type FetchLike = (
  url: string,
  init: { redirect: "manual"; signal: AbortSignal; headers: Record<string, string> }
) => Promise<FetchLikeResponse>;

const defaultFetch: FetchLike = (url, init) =>
  undiciFetch(url, { ...init, dispatcher: guardedAgent }) as unknown as Promise<FetchLikeResponse>;

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Test seams. Production uses the system resolver and the guarded agent. */
  resolve?: Resolver;
  fetchImpl?: FetchLike;
}

/** The guard's own error, wherever undici nested it in the cause chain. */
function findBlocked(e: unknown): Error | undefined {
  for (let c: any = e, i = 0; c && i < 6; c = c.cause, i++) {
    if (c.code === BLOCKED_CODE) return c;
  }
  return undefined;
}

async function readCapped(
  body: FetchLikeResponse["body"],
  max: number
): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const {
    headers = {},
    timeoutMs = TIMEOUT_MS,
    maxBytes = MAX_BODY_BYTES,
    maxRedirects = MAX_REDIRECTS,
    resolve = systemResolve,
    fetchImpl = defaultFetch,
  } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = rawUrl;
    for (let hop = 0; ; hop++) {
      const checked = await checkUrl(current, resolve);
      if (!checked.ok) return checked;

      const res = await fetchImpl(checked.url.href, {
        redirect: "manual",
        signal: controller.signal,
        headers,
      });

      const location = res.headers.get("location");
      if (REDIRECTS.has(res.status) && location) {
        await res.body?.cancel?.().catch(() => {});
        if (hop >= maxRedirects) {
          return { ok: false, reason: "too_many_redirects", message: `More than ${maxRedirects} redirects from ${rawUrl}` };
        }
        current = new URL(location, checked.url).href;
        continue;
      }

      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) {
        await res.body?.cancel?.().catch(() => {});
        return { ok: false, reason: "too_large", message: `${current} is ${declared} bytes; cap is ${maxBytes}` };
      }
      const body = await readCapped(res.body, maxBytes);
      if (!body) {
        return { ok: false, reason: "too_large", message: `${current} exceeded the ${maxBytes}-byte cap` };
      }
      return {
        ok: true,
        value: { url: current, status: res.status, contentType: res.headers.get("content-type") ?? "", body },
      };
    }
  } catch (e) {
    const blocked = findBlocked(e);
    if (blocked) return { ok: false, reason: "blocked", message: blocked.message };
    if (controller.signal.aborted) {
      return { ok: false, reason: "timeout", message: `Timed out after ${timeoutMs} ms fetching ${rawUrl}` };
    }
    return { ok: false, reason: "network", message: `Request failed: ${String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}
