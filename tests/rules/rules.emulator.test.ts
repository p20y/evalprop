import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

let env: RulesTestEnvironment;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-evalprop",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "analyses/a1"), { ownerUid: "u1" });
  });
});

after(async () => {
  await env.cleanup();
});

test("unauthenticated clients cannot read or write", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "analyses/a1")));
  await assertFails(setDoc(doc(db, "analyses/a2"), { ownerUid: "x" }));
});

test("authenticated clients cannot read or write either, even their own documents", async () => {
  const db = env.authenticatedContext("u1").firestore();
  await assertFails(getDoc(doc(db, "analyses/a1")));
  await assertFails(setDoc(doc(db, "analyses/a1"), { ownerUid: "u1", hacked: true }));
  await assertFails(getDoc(doc(db, "users/u1")));
  await assertFails(setDoc(doc(db, "users/u1"), { plan: "pro" }));
});

test("the server (rules bypassed) can read what it wrote", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), "analyses/a1"));
    assert.equal(snap.data()?.ownerUid, "u1");
  });
});
