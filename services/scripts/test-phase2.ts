// Phase 2 acceptance tests against the DEPLOYED stack (real AWS calls):
// tool Lambdas by direct invoke, approve/reject through API Gateway with real
// Cognito tokens, and IAM policy simulation for what roles must NOT be able to do.
import { api, check, finish, invoke, login, outputs, randomId, section } from "./lib";
import { IAMClient, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../shared/ddb";

const T = outputs.tables;

async function seedEncounter(doctorId: string, patientId: string): Promise<string> {
  const encounterId = `ENC-TEST-${randomId()}`;
  const now = new Date().toISOString();
  await ddb.send(
    new PutCommand({
      TableName: T.encounters,
      Item: { encounterId, doctorId, patientId, status: "AGENT_RUNNING", nextStepSeq: 0, createdAt: now, updatedAt: now, test: true },
    }),
  );
  return encounterId;
}

// Simulates the agent worker finishing (Phase 4 does this for real).
const setStatus = (encounterId: string, status: string) =>
  ddb.send(
    new UpdateCommand({
      TableName: T.encounters,
      Key: { encounterId },
      UpdateExpression: "SET #s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": status },
    }),
  );

const getItem = async (table: string, key: Record<string, string>) =>
  (await ddb.send(new GetCommand({ TableName: table, Key: key, ConsistentRead: true }))).Item;

const auditEvents = async (encounterId: string) =>
  ((await ddb.send(new QueryCommand({ TableName: T.audit, KeyConditionExpression: "encounterId = :e", ExpressionAttributeValues: { ":e": encounterId } }))).Items ?? []);

const referral = (patientId: string) => ({
  patientId,
  specialty: "ORAL_AND_MAXILLOFACIAL_SURGERY",
  reason: "Assessment for removal of impacted lower right third molar (48).",
  relevantFindings: ["Partially erupted 48 with inflamed operculum", "Pain on chewing for one week"],
  allergies: ["Penicillin (urticarial rash)"],
  imagingReference: "IMG-PT001-OPG-20260928",
  urgency: "ROUTINE",
});

const [drA, drB] = await Promise.all([login("A"), login("B")]);

// ---------------------------------------------------------------------------
section("get_patient_record (direct invoke)");
const encR = await seedEncounter("DR-A", "PT-001");
{
  const ok = await invoke("tool-get-patient-record", { encounterId: encR, doctorId: "DR-A", input: { patientId: "PT-001" } });
  check("DR-A reads assigned PT-001", ok.status === "OK", ok.status);
  check("record includes penicillin allergy", ok.data?.allergies?.[0]?.substance === "Penicillin");
  check("record includes OPG reference", ok.data?.imaging?.[0]?.imagingId === "IMG-PT001-OPG-20260928");
  check("assignment list is not exposed to the model", ok.data && !("assignedDoctorIds" in ok.data));

  const denied = await invoke("tool-get-patient-record", { encounterId: encR, doctorId: "DR-A", input: { patientId: "PT-003" } });
  check("DR-A denied PT-003 (assigned to DR-B)", denied.status === "DENIED", denied);
  check("denial carries no record data", !("data" in denied));

  const deniedB = await invoke("tool-get-patient-record", { encounterId: encR, doctorId: "DR-B", input: { patientId: "PT-001" } });
  check("DR-B denied PT-001", deniedB.status === "DENIED", deniedB.status);

  const missing = await invoke("tool-get-patient-record", { encounterId: encR, doctorId: "DR-A", input: { patientId: "PT-999" } });
  check("unknown patient looks identical to denied", missing.status === "DENIED" && missing.reason === denied.reason, missing);

  const bad = await invoke("tool-get-patient-record", { encounterId: encR, doctorId: "DR-A", input: { patientId: "PT-001'; --" } });
  check("malformed patientId rejected", bad.status === "INVALID_INPUT", bad);

  const smuggled = await invoke("tool-get-patient-record", { encounterId: encR, doctorId: "DR-A", input: { patientId: "PT-003", doctorId: "DR-B" } });
  check("extra doctorId inside model input rejected", smuggled.status === "INVALID_INPUT", smuggled);

  const events = await auditEvents(encR);
  check("audit: TOOL_ALLOWED recorded", events.some((e) => e.event === "TOOL_ALLOWED" && e.patientId === "PT-001"));
  check(
    "audit: TOOL_DENIED for PT-003 with reason NOT_ASSIGNED",
    events.some((e) => e.event === "TOOL_DENIED" && e.patientId === "PT-003" && e.reason === "NOT_ASSIGNED"),
  );
}

// ---------------------------------------------------------------------------
section("create_referral / schedule_recall (direct invoke)");
const encA = await seedEncounter("DR-A", "PT-001");
{
  const notOwner = await invoke("tool-create-referral", { encounterId: encA, doctorId: "DR-B", input: referral("PT-001") });
  check("referral denied when encounter belongs to another doctor", notOwner.status === "DENIED" && notOwner.reason === "ENCOUNTER_NOT_OWNED", notOwner);

  const mismatch = await invoke("tool-create-referral", { encounterId: encA, doctorId: "DR-A", input: referral("PT-002") });
  check("referral denied for a different patient than the encounter", mismatch.status === "DENIED" && mismatch.reason === "PATIENT_MISMATCH", mismatch);

  const created = await invoke("tool-create-referral", { encounterId: encA, doctorId: "DR-A", input: referral("PT-001") });
  check("referral created", created.status === "OK", created);
  const actionId = created.data?.actionId as string;
  const row = await getItem(T.actions, { actionId });
  check("action stored as PENDING_APPROVAL, DRAFT, proposed by agent", row?.status === "PENDING_APPROVAL" && row?.draft === true && row?.proposedBy === "agent", row?.status);
  check("action doctorId comes from the encounter (DR-A)", row?.doctorId === "DR-A");

  const again = await invoke("tool-create-referral", { encounterId: encA, doctorId: "DR-A", input: referral("PT-001") });
  check("second referral rejected (one action per encounter)", again.status === "CONFLICT", again);

  const recallToo = await invoke("tool-schedule-recall", { encounterId: encA, doctorId: "DR-A", input: { patientId: "PT-001", intervalMonths: 6, reason: "Routine" } });
  check("recall rejected after referral on same encounter", recallToo.status === "CONFLICT", recallToo);

  // ---------------------------------------------------------------------------
  section("approve-action (HTTP API, real Cognito tokens)");
  await setStatus(encA, "AWAITING_APPROVAL");

  const noToken = await api("POST", `/actions/${actionId}/approve`);
  check("no token -> 401 (authorizer)", noToken.status === 401, noToken.status);

  const accessTok = await api("POST", `/actions/${actionId}/approve`, drA.accessToken);
  check("access token instead of ID token -> 401 (handler)", accessTok.status === 401, accessTok);

  const byB = await api("POST", `/actions/${actionId}/approve`, drB.idToken);
  check("DR-B cannot approve DR-A's action -> 403", byB.status === 403, byB);
  check("action still PENDING_APPROVAL after DR-B attempt", (await getItem(T.actions, { actionId }))?.status === "PENDING_APPROVAL");

  const byA = await api("POST", `/actions/${actionId}/approve`, drA.idToken);
  check("DR-A approves -> 200 APPROVED", byA.status === 200 && byA.body?.status === "APPROVED", byA);
  const approved = await getItem(T.actions, { actionId });
  check("action row APPROVED, decidedBy DR-A", approved?.status === "APPROVED" && approved?.decidedBy === "DR-A", approved?.status);
  check("encounter COMPLETED", (await getItem(T.encounters, { encounterId: encA }))?.status === "COMPLETED");

  const twice = await api("POST", `/actions/${actionId}/approve`, drA.idToken);
  check("approving twice -> 409", twice.status === 409, twice);
  const flip = await api("POST", `/actions/${actionId}/reject`, drA.idToken);
  check("rejecting after approval -> 409", flip.status === 409, flip);

  const unknown = await api("POST", `/actions/ACT-ENC-TEST-nope0000/approve`, drA.idToken);
  check("unknown action -> 404", unknown.status === 404, unknown);

  const steps = (await ddb.send(new QueryCommand({ TableName: T.encounter_step, KeyConditionExpression: "encounterId = :e", ExpressionAttributeValues: { ":e": encA } }))).Items ?? [];
  check("timeline has APPROVED step by clinician", steps.some((s) => s.type === "APPROVED" && s.actor === "clinician"), steps);

  const events = await auditEvents(encA);
  const chain = events.map((e) => e.event);
  check("audit chain: denied attempts, proposal, decision", ["ACTION_PROPOSAL_REJECTED", "ACTION_PROPOSED", "DECISION_DENIED", "ACTION_APPROVED"].every((e) => chain.includes(e)), chain);
  console.log(`        audit(${encA}): ${chain.join(" -> ")}`);
}

// ---------------------------------------------------------------------------
section("rejection path (scenario D)");
const encD = await seedEncounter("DR-A", "PT-002");
{
  const recall = await invoke("tool-schedule-recall", { encounterId: encD, doctorId: "DR-A", input: { patientId: "PT-002", intervalMonths: 6, reason: "Routine review after small filling." } });
  check("recall created", recall.status === "OK", recall);
  await setStatus(encD, "AWAITING_APPROVAL");
  const rej = await api("POST", `/actions/${recall.data.actionId}/reject`, drA.idToken, { reason: "Prefer 3 months" });
  check("DR-A rejects -> 200 REJECTED", rej.status === 200 && rej.body?.status === "REJECTED", rej);
  check("action row REJECTED", (await getItem(T.actions, { actionId: recall.data.actionId }))?.status === "REJECTED");
  check("encounter REJECTED", (await getItem(T.encounters, { encounterId: encD }))?.status === "REJECTED");
  check("audit has ACTION_REJECTED", (await auditEvents(encD)).some((e) => e.event === "ACTION_REJECTED"));
}

// ---------------------------------------------------------------------------
section("GET /patients");
{
  const a = await api("GET", "/patients", drA.idToken);
  check("DR-A sees PT-001, PT-002", a.status === 200 && a.body.patients.map((p: any) => p.patientId).join() === "PT-001,PT-002", a.body);
  check("list is summary only (no allergies/history)", a.body.patients.every((p: any) => !("allergies" in p) && !("medicalHistory" in p)));
  const b = await api("GET", "/patients", drB.idToken);
  check("DR-B sees only PT-003", b.status === 200 && b.body.patients.map((p: any) => p.patientId).join() === "PT-003", b.body);
  const anon = await api("GET", "/patients");
  check("no token -> 401", anon.status === 401, anon.status);
}

// ---------------------------------------------------------------------------
section("IAM: what roles must NOT be able to do (policy simulation)");
{
  const iam = new IAMClient({});
  const acct = outputs.lambda_role_arns.api!.split(":")[4];
  const region = process.env.AWS_REGION;
  const actionsArn = `arn:aws:dynamodb:${region}:${acct}:table/${T.actions}`;
  const approveFnArn = `arn:aws:lambda:${region}:${acct}:function:clinical-agent-demo-approve-action`;

  const decide = async (role: string, action: string, resource: string) => {
    const r = await iam.send(new SimulatePrincipalPolicyCommand({ PolicySourceArn: outputs.lambda_role_arns[role], ActionNames: [action], ResourceArns: [resource] }));
    return r.EvaluationResults?.[0]?.EvalDecision;
  };

  for (const role of ["tool-create-referral", "tool-schedule-recall", "agent-worker"]) {
    check(`${role}: UpdateItem on Actions denied`, (await decide(role, "dynamodb:UpdateItem", actionsArn)) !== "allowed");
    check(`${role}: DeleteItem on Actions denied`, (await decide(role, "dynamodb:DeleteItem", actionsArn)) !== "allowed");
    check(`${role}: invoke approve-action denied`, (await decide(role, "lambda:InvokeFunction", approveFnArn)) !== "allowed");
  }
  check("control: approve-action CAN UpdateItem on Actions", (await decide("approve-action", "dynamodb:UpdateItem", actionsArn)) === "allowed");
  check("control: tool-create-referral CAN PutItem on Actions", (await decide("tool-create-referral", "dynamodb:PutItem", actionsArn)) === "allowed");
}

// Test encounters (prefixed ENC-TEST-) are left in place so the audit trail can be
// inspected; scripts/reset-demo.ts (Phase 6) clears them.
finish();
