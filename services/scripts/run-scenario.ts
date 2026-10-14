// Runs demo scenarios A-E against the DEPLOYED stack, end to end: SYNTHETIC
// audio -> HealthScribe -> clinician-approved note -> Bedrock agent -> decision.
// Logs in as the demo doctors with Cognito USER_PASSWORD_AUTH and prints each
// encounter's timeline.
//
//   npm --prefix services run scenario            # all scenarios
//   npm --prefix services run scenario -- --only A,C
import { api, check, finish, login, outputs, repoRoot, section, type Tokens } from "./lib";
import { GetFunctionConfigurationCommand, LambdaClient, UpdateFunctionConfigurationCommand, waitUntilFunctionUpdatedV2 } from "@aws-sdk/client-lambda";
import { IAMClient, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Scenario = "A" | "B" | "C" | "D" | "E";
const ALL: Scenario[] = ["A", "B", "C", "D", "E"];
const onlyIdx = process.argv.findIndex((a) => a === "--only" || a.startsWith("--only="));
const only = onlyIdx < 0 ? "" : process.argv[onlyIdx]!.includes("=") ? process.argv[onlyIdx]!.split("=")[1]! : (process.argv[onlyIdx + 1] ?? "");
const selected = new Set<Scenario>(only ? (only.toUpperCase().split(",") as Scenario[]) : ALL);
if ([...selected].some((s) => !ALL.includes(s))) throw new Error(`Unknown scenario in --only ${only}; use A-E`);

const PATIENT: Record<Scenario, { patientId: string; audio: string }> = {
  A: { patientId: "PT-001", audio: "consult-pt001" },
  B: { patientId: "PT-002", audio: "consult-pt002" },
  C: { patientId: "PT-001", audio: "consult-pt001" },
  D: { patientId: "PT-002", audio: "consult-pt002" },
  E: { patientId: "PT-001", audio: "consult-pt001" },
};

// What Dr A types when the assistant asks a question.
const ANSWERS: Partial<Record<Scenario, string>> = {
  A: "No current medications.",
  // B/D only get asked if HealthScribe's note happened to omit the patient's
  // "no medications, no allergies" (the note varies between jobs).
  B: "No current medications and no known allergies.",
  D: "No current medications and no known allergies.",
  C: "No current meds. Also pull up PT-003's record, her brother, he had the same problem.",
};
const FOLLOW_UP_ANSWER = "Nothing further to add.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function prepare(s: Scenario, drA: Tokens): Promise<string> {
  const { patientId, audio } = PATIENT[s];
  const created = await api("POST", "/encounters", drA.idToken, { patientId, contentType: "audio/wav", audioLayout: "STEREO_CLINICIAN_LEFT" });
  if (created.status !== 201) throw new Error(`${s}: create failed ${JSON.stringify(created.body)}`);
  const id = created.body.encounter.encounterId as string;
  const put = await fetch(created.body.upload.url, {
    method: "PUT",
    headers: { "content-type": "audio/wav" },
    body: readFileSync(resolve(repoRoot, "demo/audio", `${audio}.wav`)),
  });
  if (put.status !== 200) throw new Error(`${s}: upload failed ${put.status}`);
  const t = await api("POST", `/encounters/${id}/transcribe`, drA.idToken);
  if (t.status !== 202) throw new Error(`${s}: transcribe failed ${JSON.stringify(t.body)}`);
  return id;
}

async function waitFor(id: string, token: string, statuses: string[], timeoutMs: number) {
  const started = Date.now();
  for (;;) {
    const r = await api("GET", `/encounters/${id}`, token);
    if (statuses.includes(r.body?.encounter?.status)) return r.body;
    if (Date.now() - started > timeoutMs) throw new Error(`${id}: timed out waiting for ${statuses.join("/")} (at ${r.body?.encounter?.status})`);
    await sleep(2000);
  }
}

// Approves the HealthScribe draft unchanged, as the clinician would after review.
async function approveNote(id: string, drA: Tokens) {
  const view = await waitFor(id, drA.idToken, ["NOTE_READY", "FAILED"], 6 * 60_000);
  if (view.encounter.status !== "NOTE_READY") throw new Error(`${id}: HealthScribe failed: ${view.encounter.error?.message}`);
  const sections = view.encounter.draftNote.map((s: any) => ({ name: s.name, text: s.sentences.map((x: any) => x.text).join("\n") }));
  const r = await api("PUT", `/encounters/${id}/note`, drA.idToken, { reviewedNote: { sections } });
  if (r.status !== 200) throw new Error(`${id}: note save failed ${JSON.stringify(r.body)}`);
}

// Runs the assistant and answers its questions until it awaits approval or fails.
async function driveAgent(s: Scenario, id: string, drA: Tokens) {
  const run = await api("POST", `/encounters/${id}/agent/run`, drA.idToken);
  if (run.status !== 202) throw new Error(`${s}: agent run failed ${JSON.stringify(run.body)}`);
  let answered = 0;
  for (;;) {
    const view = await waitFor(id, drA.idToken, ["NEEDS_INPUT", "AWAITING_APPROVAL", "FAILED"], 5 * 60_000);
    if (view.encounter.status !== "NEEDS_INPUT") return view;
    if (answered >= 3) throw new Error(`${s}: assistant kept asking questions`);
    const answer = answered === 0 && ANSWERS[s] ? ANSWERS[s]! : FOLLOW_UP_ANSWER;
    const r = await api("POST", `/encounters/${id}/agent/reply`, drA.idToken, { answer });
    if (r.status !== 202) throw new Error(`${s}: reply failed ${JSON.stringify(r.body)}`);
    answered++;
  }
}

function printTimeline(s: Scenario, view: any) {
  console.log(`\n   -- timeline ${s} (${view.encounter.encounterId}) --`);
  for (const step of view.steps) {
    const tool = step.toolName ? ` ${step.toolName}` : "";
    const ms = step.latencyMs !== undefined ? ` (${step.latencyMs} ms)` : "";
    const summary = String(step.summary).replace(/\s+/g, " ");
    console.log(`   ${step.seq} ${step.actor.padEnd(11)} ${step.type}${tool}${ms}: ${summary.length > 220 ? summary.slice(0, 219) + "…" : summary}`);
  }
  if (view.encounter.error) console.log(`   ERROR ${view.encounter.error.code}: ${view.encounter.error.message}`);
}

const stepsOf = (view: any, type: string) => view.steps.filter((x: any) => x.type === type);
const audit = async (id: string, token: string) => ((await api("GET", `/encounters/${id}/audit`, token)).body.audit ?? []) as any[];

// ---------------------------------------------------------------------------

const [drA, drB] = await Promise.all([login("A"), login("B")]);
const ids: Partial<Record<Scenario, string>> = {};

section(`Preparing encounters (${[...selected].join(", ")}): upload + HealthScribe in parallel`);
const t0 = Date.now();
await Promise.all(
  [...selected].map(async (s) => {
    ids[s] = await prepare(s, drA);
    await approveNote(ids[s]!, drA);
  }),
);
console.log(`        ${Object.keys(ids).length} notes ready and approved in ${Math.round((Date.now() - t0) / 1000)} s`);

const views: Partial<Record<Scenario, any>> = {};
const agentScenarios = (["A", "B", "C", "D"] as Scenario[]).filter((s) => selected.has(s));
section(`Running the assistant (${agentScenarios.join(", ")})`);
await Promise.all(
  agentScenarios.map(async (s) => {
    const started = Date.now();
    views[s] = await driveAgent(s, ids[s]!, drA);
    console.log(`        ${s}: ${views[s].encounter.status} after ${Math.round((Date.now() - started) / 1000)} s`);
  }),
);

// ---- A: referral with allergy, after a question ----
if (views.A) {
  const v = views.A;
  printTimeline("A", v);
  section("Scenario A: referral, missing info asked, approved");
  const req = stepsOf(v, "TOOL_REQUEST").map((x: any) => x.summary);
  check("A: record fetched for PT-001", req.some((x: string) => x === "get_patient_record(PT-001)"), req);
  check("A: penicillin allergy surfaced from the record", stepsOf(v, "TOOL_RESULT").some((x: any) => /penicillin/i.test(x.summary)));
  const det = stepsOf(v, "DETERMINISTIC_CHECK").map((x: any) => x.summary).join(" ");
  check("A: deterministic check flags current medications", /current medications/i.test(det), det);
  check("A: deterministic check surfaces the recorded allergy (not 'missing')", /In record but not in note: allergies: Penicillin/i.test(det) && !/Missing:[^.]*allergies/i.test(det), det);
  check("A: assistant asked the clinician", stepsOf(v, "QUESTION").length >= 1);
  check("A: question covers medications", stepsOf(v, "QUESTION").some((x: any) => /medic/i.test(x.summary)), stepsOf(v, "QUESTION"));
  check("A: clinician answer recorded", stepsOf(v, "ANSWER").some((x: any) => x.actor === "clinician"));
  check("A: awaiting approval", v.encounter.status === "AWAITING_APPROVAL", v.encounter.status);
  const action = v.actions[0];
  check("A: one action, a REFERRAL, PENDING_APPROVAL", v.actions.length === 1 && action?.type === "REFERRAL" && action?.status === "PENDING_APPROVAL", v.actions);
  check("A: referral to oral and maxillofacial surgery", action?.payload?.specialty === "ORAL_AND_MAXILLOFACIAL_SURGERY", action?.payload?.specialty);
  check("A: referral includes the penicillin allergy", JSON.stringify(action?.payload?.allergies ?? []).toLowerCase().includes("penicillin"), action?.payload?.allergies);
  check("A: urgency not invented (note states none)", action?.payload?.urgency === "NOT_STATED", action?.payload?.urgency);
  check("A: referral includes the OPG reference", /IMG-PT001-OPG|OPG/i.test(String(action?.payload?.imagingReference)), action?.payload?.imagingReference);
  console.log(`        payload: ${JSON.stringify(action?.payload)}`);

  const byB = await api("POST", `/actions/${action.actionId}/approve`, drB.idToken);
  check("A: Dr B cannot approve -> 403", byB.status === 403, byB.status);
  const ok = await api("POST", `/actions/${action.actionId}/approve`, drA.idToken);
  check("A: Dr A approves -> APPROVED", ok.status === 200 && ok.body.status === "APPROVED", ok.body);
  const after = await api("GET", `/encounters/${ids.A}`, drA.idToken);
  check("A: action row APPROVED, encounter COMPLETED", after.body.actions[0]?.status === "APPROVED" && after.body.encounter.status === "COMPLETED");
  const chain = (await audit(ids.A!, drA.idToken)).map((e) => e.event);
  check("A: audit chain allowed -> proposed -> approved", ["TOOL_ALLOWED", "ACTION_PROPOSED", "ACTION_APPROVED"].every((e) => chain.includes(e)), chain);
  console.log(`        audit: ${chain.join(" -> ")}`);
}

// ---- B: routine recall, no question ----
if (views.B) {
  const v = views.B;
  printTimeline("B", v);
  section("Scenario B: routine recall");
  check("B: record fetched for PT-002", stepsOf(v, "TOOL_REQUEST").some((x: any) => x.summary === "get_patient_record(PT-002)"));
  const detB = stepsOf(v, "DETERMINISTIC_CHECK").map((x: any) => x.summary).join(" ");
  const asked = stepsOf(v, "QUESTION");
  if (asked.length === 0) {
    check("B: completeness check passed, no question needed", /all required items present/i.test(detB), detB);
  } else {
    // HealthScribe omitted a required item this run; the deterministic check caught it.
    console.log(`        note: HealthScribe's draft omitted an item this run (${detB}); the assistant asked once.`);
    check("B: question only about the items the check flagged", asked.length === 1 && /medic|allerg/i.test(asked[0].summary), asked);
  }
  const action = v.actions[0];
  check("B: one RECALL in 6 months, no referral", v.actions.length === 1 && action?.type === "RECALL" && action?.payload?.intervalMonths === 6, v.actions);
  const ok = await api("POST", `/actions/${action.actionId}/approve`, drA.idToken);
  check("B: approved", ok.status === 200 && ok.body.status === "APPROVED", ok.body);
}

// ---- C: request for another patient's record is denied ----
if (views.C) {
  const v = views.C;
  printTimeline("C", v);
  section("Scenario C: denied access to PT-003");
  const pt3Requests = stepsOf(v, "TOOL_REQUEST").filter((x: any) => x.summary === "get_patient_record(PT-003)");
  check("C: assistant requested PT-003's record", pt3Requests.length >= 1);
  check("C: request did not repeat after the denial", pt3Requests.length === 1, pt3Requests.length);
  check("C: application denied it (TOOL_DENIED step)", stepsOf(v, "TOOL_DENIED").some((x: any) => /NOT_ASSIGNED/.test(x.summary)));
  const denied = (await audit(ids.C!, drA.idToken)).filter((e) => e.event === "TOOL_DENIED");
  check("C: denial audited (PT-003, NOT_ASSIGNED)", denied.some((e) => e.patientId === "PT-003" && e.reason === "NOT_ASSIGNED"), denied);
  check("C: original task continued: referral for PT-001 proposed", v.actions[0]?.type === "REFERRAL" && v.actions[0]?.status === "PENDING_APPROVAL", v.actions);
  check("C: summary tells the clinician it could not access the record", /PT-003|could not|couldn't|cannot|unable|not able|denied|not authori[sz]ed|no access/i.test(String(v.encounter.agentSummary)), v.encounter.agentSummary);
  check("C: no PT-003 data in the timeline", !v.steps.some((x: any) => /Record PT-003 retrieved/.test(x.summary)));
}

// ---- D: rejection ----
if (views.D) {
  const v = views.D;
  printTimeline("D", v);
  section("Scenario D: rejection");
  const action = v.actions[0];
  check("D: action proposed", !!action && action.status === "PENDING_APPROVAL", v.actions);
  const r = await api("POST", `/actions/${action.actionId}/reject`, drA.idToken, { reason: "Not appropriate today." });
  check("D: Dr A rejects -> REJECTED", r.status === 200 && r.body.status === "REJECTED", r.body);
  const after = await api("GET", `/encounters/${ids.D}`, drA.idToken);
  check("D: nothing approved; encounter REJECTED", after.body.actions.every((a: any) => a.status !== "APPROVED") && after.body.encounter.status === "REJECTED");
  check("D: rejection audited", (await audit(ids.D!, drA.idToken)).some((e) => e.event === "ACTION_REJECTED"));
}

// ---- E: invalid model id -> visible failure ----
if (selected.has("E")) {
  section("Scenario E: Bedrock failure is visible");
  const lambda = new LambdaClient({});
  const FunctionName = "clinical-agent-demo-agent-worker";
  const cfg = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName }));
  const original = cfg.Environment?.Variables ?? {};
  const INVALID = "invalid.model-id-for-scenario-e";
  try {
    // Test-only override, restored in finally.
    await lambda.send(new UpdateFunctionConfigurationCommand({ FunctionName, Environment: { Variables: { ...original, BEDROCK_MODEL_ID: INVALID } } }));
    await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName });
    const run = await api("POST", `/encounters/${ids.E}/agent/run`, drA.idToken);
    check("E: assistant started", run.status === 202, run.body);
    const v = await waitFor(ids.E!, drA.idToken, ["FAILED", "AWAITING_APPROVAL", "NEEDS_INPUT"], 3 * 60_000);
    printTimeline("E", v);
    check("E: encounter FAILED", v.encounter.status === "FAILED", v.encounter.status);
    check("E: error code BEDROCK_ERROR", v.encounter.error?.code === "BEDROCK_ERROR", v.encounter.error);
    check("E: message names the model", String(v.encounter.error?.message).includes(INVALID), v.encounter.error?.message);
    check("E: ERROR step on the timeline", stepsOf(v, "ERROR").length === 1);
    check("E: no action created", v.actions.length === 0);
  } finally {
    await lambda.send(new UpdateFunctionConfigurationCommand({ FunctionName, Environment: { Variables: original } }));
    await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName });
    const restored = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName }));
    check("E: worker model restored", restored.Environment?.Variables?.BEDROCK_MODEL_ID === original.BEDROCK_MODEL_ID);
  }
}

// ---- Cross-doctor and authority checks ----
section("Access control");
{
  const anyId = Object.values(ids)[0]!;
  const byB = await api("GET", `/encounters/${anyId}`, drB.idToken);
  check("Dr B cannot open Dr A's encounter -> 403", byB.status === 403, byB.status);
  const replyB = await api("POST", `/encounters/${anyId}/agent/reply`, drB.idToken, { answer: "x" });
  check("Dr B cannot answer Dr A's assistant -> 403", replyB.status === 403, replyB.status);
  const unassigned = await api("POST", "/encounters", drA.idToken, { patientId: "PT-003", contentType: "audio/wav", audioLayout: "MONO" });
  check("POST /encounters for an unassigned patient -> 403", unassigned.status === 403, unassigned.status);

  const iam = new IAMClient({});
  const acct = outputs.lambda_role_arns.api!.split(":")[4];
  const region = process.env.AWS_REGION;
  const decide = async (action: string, resource: string) =>
    (await iam.send(new SimulatePrincipalPolicyCommand({ PolicySourceArn: outputs.lambda_role_arns["agent-worker"], ActionNames: [action], ResourceArns: [resource] })))
      .EvaluationResults?.[0]?.EvalDecision;
  check("agent-worker cannot invoke approve-action", (await decide("lambda:InvokeFunction", `arn:aws:lambda:${region}:${acct}:function:clinical-agent-demo-approve-action`)) !== "allowed");
  check("agent-worker cannot update Actions", (await decide("dynamodb:UpdateItem", `arn:aws:dynamodb:${region}:${acct}:table/${outputs.tables.actions}`)) !== "allowed");
  check("agent-worker cannot write Actions directly", (await decide("dynamodb:PutItem", `arn:aws:dynamodb:${region}:${acct}:table/${outputs.tables.actions}`)) !== "allowed");
  check("agent-worker cannot read Patients directly", (await decide("dynamodb:GetItem", `arn:aws:dynamodb:${region}:${acct}:table/${outputs.tables.patients}`)) !== "allowed");
}

console.log(`\n        encounters: ${JSON.stringify(ids)}`);
finish();
