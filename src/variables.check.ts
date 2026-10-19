import assert from "node:assert/strict";
import { resolveTemplate } from "./variables";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const body = resolveTemplate(
  '{"serviceId":"{{$uuid}}","seller":"{{$uuid:seller}}","again":"{{$uuid:seller}}","guid":"{{$guid}}","url":"{{baseUrl}}"}',
  { baseUrl: "http://cmp-dns.local" },
);
const parsed = JSON.parse(body) as Record<string, string>;

assert.ok(parsed.serviceId && parsed.seller && parsed.guid);
assert.match(parsed.serviceId, uuid);
assert.match(parsed.seller, uuid);
assert.equal(parsed.seller, parsed.again);
assert.notEqual(parsed.serviceId, parsed.seller);
assert.match(parsed.guid, uuid);
assert.equal(parsed.url, "http://cmp-dns.local");

const second = resolveTemplate('{{$uuid}}', {});
assert.notEqual(parsed.serviceId, second);

assert.throws(
  () => resolveTemplate("{{missing}}", {}),
  /Missing variables: missing/,
);

console.log("variables.check ok");
