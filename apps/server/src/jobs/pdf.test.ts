import assert from "node:assert/strict";
import { test } from "node:test";
import { CloudTasksPdfJobQueue, cloudTasksQueueFromEnv, InlinePdfJobQueue, type CloudTasksLike } from "./pdf.ts";

const CFG = {
  project: "evalprop-dev",
  queue: "pdf-render",
  workerUrl: "https://evalprop-pdf-worker-abc.a.run.app/",
  invokerServiceAccount: "pdf-invoker@evalprop-dev.iam.gserviceaccount.com",
};

/** A fake Cloud Tasks that dedupes by task name the way the real service does (ALREADY_EXISTS, gRPC code 6). */
function fakeTasks() {
  const created: Parameters<CloudTasksLike["createTask"]>[0][] = [];
  const names = new Set<string>();
  const client: CloudTasksLike & { failWith?: unknown } = {
    async createTask(req) {
      if (client.failWith) throw client.failWith;
      if (names.has(req.task.name)) throw Object.assign(new Error("6 ALREADY_EXISTS"), { code: 6 });
      names.add(req.task.name);
      created.push(req);
    },
  };
  return { client, created };
}

test("Cloud Tasks: one task per report, named after the report id, POSTing {reportId} to the worker with an OIDC token", async () => {
  const { client, created } = fakeTasks();
  await new CloudTasksPdfJobQueue(client, CFG).enqueue("rpt_abc-123");
  assert.equal(created.length, 1);
  const { parent, task } = created[0]!;
  assert.equal(parent, "projects/evalprop-dev/locations/us-central1/queues/pdf-render");
  assert.equal(task.name, `${parent}/tasks/pdf-rpt_abc-123`);
  assert.equal(task.httpRequest.httpMethod, "POST");
  assert.equal(task.httpRequest.url, "https://evalprop-pdf-worker-abc.a.run.app/internal/render");
  assert.deepEqual(JSON.parse(Buffer.from(task.httpRequest.body, "base64").toString()), { reportId: "rpt_abc-123" });
  assert.equal(task.httpRequest.headers["Content-Type"], "application/json");
  assert.deepEqual(task.httpRequest.oidcToken, { serviceAccountEmail: CFG.invokerServiceAccount, audience: "https://evalprop-pdf-worker-abc.a.run.app" });
  assert.equal(task.dispatchDeadline.seconds, 180);
});

test("Cloud Tasks: enqueueing the same report twice is deduplicated by task name and is not an error", async () => {
  const { client, created } = fakeTasks();
  const q = new CloudTasksPdfJobQueue(client, CFG);
  await q.enqueue("rpt_1");
  await q.enqueue("rpt_1");
  await q.enqueue("rpt_2");
  assert.deepEqual(created.map((c) => c.task.name.split("/").pop()), ["pdf-rpt_1", "pdf-rpt_2"]);
});

test("Cloud Tasks: other failures reject, and ids that cannot be task names are refused before any call", async () => {
  const { client, created } = fakeTasks();
  const q = new CloudTasksPdfJobQueue(client, { ...CFG, location: "europe-west1" });
  client.failWith = Object.assign(new Error("7 PERMISSION_DENIED"), { code: 7 });
  await assert.rejects(q.enqueue("rpt_1"), /PERMISSION_DENIED/);
  client.failWith = undefined;
  for (const bad of ["", "a/b", "rpt 1", "../x", "x".repeat(401)]) await assert.rejects(q.enqueue(bad), /cannot be used/);
  assert.equal(created.length, 0);
});

test("cloudTasksQueueFromEnv: null when unset, throws when partly set, builds the queue when complete", async () => {
  assert.equal(await cloudTasksQueueFromEnv({}), null);
  await assert.rejects(cloudTasksQueueFromEnv({ PDF_TASKS_QUEUE: "q" }), /missing GCP_PROJECT, PDF_WORKER_URL, PDF_WORKER_INVOKER_SA/);
  const { client, created } = fakeTasks();
  const q = await cloudTasksQueueFromEnv(
    { GCP_PROJECT: "p", PDF_TASKS_QUEUE: "q", PDF_WORKER_URL: "https://w.example", PDF_WORKER_INVOKER_SA: "sa@p.iam.gserviceaccount.com", TASKS_LOCATION: "us-east1" },
    client,
  );
  await q!.enqueue("rpt_9");
  assert.equal(created[0]!.parent, "projects/p/locations/us-east1/queues/q");
});

test("Inline: runs the job in-process, once per report id, and idle() waits for it", async () => {
  const ran: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const q = new InlinePdfJobQueue(async (id) => {
    await gate;
    ran.push(id);
  });
  await q.enqueue("rpt_1");
  await q.enqueue("rpt_1");
  await q.enqueue("rpt_2");
  assert.deepEqual(ran, [], "enqueue returns before the job finishes");
  release();
  await q.idle();
  assert.deepEqual(ran.sort(), ["rpt_1", "rpt_2"]);
  await q.enqueue("rpt_1");
  await q.idle();
  assert.equal(ran.length, 2, "a report that succeeded is not run again");
});

test("Inline: a failing job is reported, does not reject enqueue, and may be enqueued again", async () => {
  const errors: string[] = [];
  let calls = 0;
  const q = new InlinePdfJobQueue(
    async () => {
      if (++calls === 1) throw new Error("boom");
    },
    (id) => errors.push(id),
  );
  await q.enqueue("rpt_1");
  await q.idle();
  assert.deepEqual(errors, ["rpt_1"]);
  await q.enqueue("rpt_1");
  await q.idle();
  assert.equal(calls, 2);
});
