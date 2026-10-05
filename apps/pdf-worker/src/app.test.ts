import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkerApp } from "./app.ts";
import { GoogleOidcVerifier, SharedSecretVerifier, verifierFromEnv, type IdTokenVerifier, type InternalAuthVerifier } from "./auth.ts";
import { renderReportPdf } from "./render-job.ts";
import { setup } from "./test-helpers.ts";

const SECRET = "local-dev-secret-0123456789";

/** A verifier that accepts exactly one header, standing in for the real ones in handler tests. */
const fakeVerifier = (accept: string): InternalAuthVerifier => ({ verify: async (h) => h === accept });

async function harness() {
  const s = await setup();
  const app = createWorkerApp({ verifier: fakeVerifier("Bearer ok"), render: (id) => renderReportPdf(s.deps, id), logger: s.logger });
  const post = (body: unknown, headers: Record<string, string> = { Authorization: "Bearer ok" }) =>
    app.request("/internal/render", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { ...s, app, post };
}

test("success: 200 with the outcome, the PDF stored and its path recorded", async () => {
  const { post, record, storage, reports } = await harness();
  const res = await post({ reportId: record.id });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "rendered", pdfPath: `reports/${record.id}.pdf`, bytes: 13 });
  assert.equal(storage.files.size, 1);
  assert.equal((await reports.getById(record.id))?.pdfPath, `reports/${record.id}.pdf`);
});

test("permanent no-ops answer 200 so Cloud Tasks does not retry: missing and revoked reports", async () => {
  const { post, record, reports } = await harness();
  const missing = await post({ reportId: "rpt_missing" });
  assert.equal(missing.status, 200);
  assert.deepEqual(await missing.json(), { status: "skipped", reason: "not_found" });
  await reports.revoke(record.id, record.ownerUid, "2026-10-05T00:00:00.000Z");
  const revoked = await post({ reportId: record.id });
  assert.equal(revoked.status, 200);
  assert.deepEqual(await revoked.json(), { status: "skipped", reason: "revoked" });
});

test("a renderer failure or timeout answers 500 so Cloud Tasks retries, and is logged with the report id only", async () => {
  const { post, record, renderer, logger } = await harness();
  renderer.error = new Error("PDF render did not finish within 30000 ms");
  const res = await post({ reportId: record.id });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "render_failed" });
  const line = logger.lines.find((l) => l.level === "error");
  assert.equal(line?.fields?.reportId, record.id);
  assert.ok(!JSON.stringify(logger.lines).includes(record.tokenHash));
});

test("authentication: no header, the wrong credential, and a non-bearer scheme are all 401 and nothing runs", async () => {
  const { post, record, renderer } = await harness();
  for (const headers of [{} as Record<string, string>, { Authorization: "Bearer nope" }, { Authorization: "Basic ok" }, { Authorization: "ok" }]) {
    const res = await post({ reportId: record.id }, headers);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("www-authenticate"), "Bearer");
  }
  assert.equal(renderer.inputs.length, 0);
});

test("authentication is checked before the body is read: a bad body without credentials is 401, not 400", async () => {
  const { post } = await harness();
  assert.equal((await post("not json", {})).status, 401);
});

test("a malformed body is 400", async () => {
  const { post } = await harness();
  for (const body of ["not json", "{}", { reportId: 5 }, { reportId: "" }, { reportId: "../x" }, { reportId: "a/b" }]) {
    assert.equal((await post(body)).status, 400, JSON.stringify(body));
  }
});

test("only POST is accepted on /internal/render, and /health needs no credentials", async () => {
  const { app } = await harness();
  assert.equal((await app.request("/internal/render")).status, 404);
  const health = await app.request("/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
});

test("SharedSecretVerifier accepts only its own secret", async () => {
  const v = new SharedSecretVerifier(SECRET);
  assert.equal(await v.verify(`Bearer ${SECRET}`), true);
  assert.equal(await v.verify(`bearer ${SECRET}`), true);
  assert.equal(await v.verify(`Bearer ${SECRET}x`), false);
  assert.equal(await v.verify(`Bearer ${SECRET.slice(1)}`), false);
  assert.equal(await v.verify(SECRET), false);
  assert.equal(await v.verify(undefined), false);
  assert.throws(() => new SharedSecretVerifier("short"));
});

test("the worker app with a real SharedSecretVerifier: 401 without the secret, 200 with it", async () => {
  const s = await setup();
  const app = createWorkerApp({ verifier: new SharedSecretVerifier(SECRET), render: (id) => renderReportPdf(s.deps, id) });
  const call = (h: Record<string, string>) => app.request("/internal/render", { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify({ reportId: s.record.id }) });
  assert.equal((await call({})).status, 401);
  assert.equal((await call({ Authorization: `Bearer ${SECRET}` })).status, 200);
});

test("GoogleOidcVerifier accepts a verified token from an allowed service account for this audience", async () => {
  const seen: { idToken: string; audience: string }[] = [];
  const client: IdTokenVerifier = {
    async verifyIdToken(o) {
      seen.push(o);
      if (o.idToken === "expired") throw new Error("Token used too late");
      const email = o.idToken === "other" ? "attacker@evil.iam.gserviceaccount.com" : "tasks@evalprop.iam.gserviceaccount.com";
      return { getPayload: () => ({ email, email_verified: o.idToken !== "unverified" }) };
    },
  };
  const v = new GoogleOidcVerifier({ audience: "https://pdf.example", allowedServiceAccounts: ["Tasks@evalprop.iam.gserviceaccount.com"], client });
  assert.equal(await v.verify("Bearer good"), true);
  assert.deepEqual(seen[0], { idToken: "good", audience: "https://pdf.example" });
  assert.equal(await v.verify("Bearer other"), false, "a valid Google token from another account");
  assert.equal(await v.verify("Bearer unverified"), false);
  assert.equal(await v.verify("Bearer expired"), false, "verification errors are a plain false, never a throw");
  assert.equal(await v.verify(undefined), false);
  assert.throws(() => new GoogleOidcVerifier({ audience: "x", allowedServiceAccounts: [] }));
});

test("verifierFromEnv prefers OIDC, falls back to the shared secret, and refuses to start open", async () => {
  assert.throws(() => verifierFromEnv({}), /no service authentication configured/);
  assert.throws(() => verifierFromEnv({ OIDC_AUDIENCE: "https://pdf.example" }), /no service authentication/);
  const local = verifierFromEnv({ INTERNAL_AUTH_TOKEN: SECRET });
  assert.equal(await local.verify(`Bearer ${SECRET}`), true);
  const both = verifierFromEnv({ INTERNAL_AUTH_TOKEN: SECRET, OIDC_AUDIENCE: "https://pdf.example", OIDC_INVOKER_EMAILS: "a@b.iam.gserviceaccount.com" });
  assert.equal(await both.verify(`Bearer ${SECRET}`), false, "the shared secret does not work once OIDC is configured");
});
