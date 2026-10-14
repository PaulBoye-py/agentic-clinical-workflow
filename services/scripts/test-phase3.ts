// Phase 3 acceptance tests against the DEPLOYED stack: encounter API, presigned
// upload, real HealthScribe jobs on the SYNTHETIC consultation audio, parsing,
// note review, and the access/ordering rules around them.
import { api, check, finish, login, outputs, repoRoot, section } from "./lib";
import { ListTagsForResourceCommand, TranscribeClient } from "@aws-sdk/client-transcribe";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const [drA, drB] = await Promise.all([login("A"), login("B")]);
const audio = (name: string) => readFileSync(resolve(repoRoot, "demo/audio", `${name}.wav`));

async function upload(url: string, contentType: string, body: Uint8Array) {
  const res = await fetch(url, { method: "PUT", headers: { "content-type": contentType }, body });
  return res.status;
}

async function waitForNote(encounterId: string, token: string, timeoutMs = 6 * 60_000) {
  const started = Date.now();
  for (;;) {
    const r = await api("GET", `/encounters/${encounterId}`, token);
    const status = r.body?.encounter?.status;
    if (status === "NOTE_READY" || status === "FAILED") return { ...r.body, waitedMs: Date.now() - started };
    if (Date.now() - started > timeoutMs) return { ...r.body, waitedMs: Date.now() - started, timedOut: true };
    await new Promise((res) => setTimeout(res, 3000));
  }
}

// ---------------------------------------------------------------------------
section("POST /encounters: validation and assignment");
{
  const unassigned = await api("POST", "/encounters", drA.idToken, { patientId: "PT-003", contentType: "audio/wav", audioLayout: "STEREO_CLINICIAN_LEFT" });
  check("DR-A cannot open an encounter for PT-003 -> 403", unassigned.status === 403, unassigned);
  const badType = await api("POST", "/encounters", drA.idToken, { patientId: "PT-001", contentType: "application/pdf", audioLayout: "MONO" });
  check("non-audio content type -> 400", badType.status === 400, badType.status);
  const extra = await api("POST", "/encounters", drA.idToken, { patientId: "PT-001", contentType: "audio/wav", audioLayout: "MONO", doctorId: "DR-B" });
  check("doctorId in body rejected -> 400", extra.status === 400, extra.status);
  const noBody = await api("POST", "/encounters", drA.idToken);
  check("missing body -> 400", noBody.status === 400, noBody.status);
}

// ---------------------------------------------------------------------------
section("Create, upload, transcribe (PT-001 and PT-002 in parallel)");
const created: Record<string, { encounterId: string; uploadUrl: string }> = {};
for (const pt of ["PT-001", "PT-002"]) {
  const r = await api("POST", "/encounters", drA.idToken, { patientId: pt, contentType: "audio/wav", audioLayout: "STEREO_CLINICIAN_LEFT" });
  check(`${pt}: encounter created (201, CREATED)`, r.status === 201 && r.body.encounter.status === "CREATED", r);
  check(`${pt}: encounter doctorId taken from token`, r.body.encounter.doctorId === "DR-A");
  created[pt] = { encounterId: r.body.encounter.encounterId, uploadUrl: r.body.upload.url };
}
const e1 = created["PT-001"]!.encounterId;
const e2 = created["PT-002"]!.encounterId;

const early = await api("POST", `/encounters/${e1}/transcribe`, drA.idToken);
check("transcribe before upload -> 409", early.status === 409, early);

check("upload with a different content type is refused by S3", (await upload(created["PT-001"]!.uploadUrl, "audio/mpeg", audio("consult-pt001"))) === 403);
check("PT-001 audio uploaded to presigned URL", (await upload(created["PT-001"]!.uploadUrl, "audio/wav", audio("consult-pt001"))) === 200);
check("PT-002 audio uploaded to presigned URL", (await upload(created["PT-002"]!.uploadUrl, "audio/wav", audio("consult-pt002"))) === 200);

const byB = await api("GET", `/encounters/${e1}`, drB.idToken);
check("DR-B cannot open DR-A's encounter -> 403", byB.status === 403, byB.status);
const bTranscribe = await api("POST", `/encounters/${e1}/transcribe`, drB.idToken);
check("DR-B cannot start DR-A's transcription -> 403", bTranscribe.status === 403, bTranscribe.status);

const t0 = Date.now();
const [s1, s2] = await Promise.all([
  api("POST", `/encounters/${e1}/transcribe`, drA.idToken),
  api("POST", `/encounters/${e2}/transcribe`, drA.idToken),
]);
check("PT-001 transcription started (202, TRANSCRIBING)", s1.status === 202 && s1.body.encounter.status === "TRANSCRIBING", s1);
check("PT-002 transcription started (202, TRANSCRIBING)", s2.status === 202 && s2.body.encounter.status === "TRANSCRIBING", s2);
const twice = await api("POST", `/encounters/${e1}/transcribe`, drA.idToken);
check("starting twice -> 409", twice.status === 409, twice.status);
const noteTooEarly = await api("PUT", `/encounters/${e2}/note`, drA.idToken, { reviewedNote: { sections: [{ name: "PLAN", text: "x" }] } });
check("saving a note before it is ready -> 409", noteTooEarly.status === 409, noteTooEarly.status);

console.log("        waiting for HealthScribe (polling GET /encounters/{id} every 3 s)...");
const [r1, r2] = await Promise.all([waitForNote(e1, drA.idToken), waitForNote(e2, drA.idToken)]);

// ---------------------------------------------------------------------------
section("HealthScribe output parsed onto the encounter");
for (const [pt, r] of [["PT-001", r1], ["PT-002", r2]] as const) {
  const enc = r.encounter;
  check(`${pt}: reached NOTE_READY`, enc.status === "NOTE_READY", enc.status === "FAILED" ? enc.error : enc.status);
  if (enc.status !== "NOTE_READY") continue;
  const segIds = new Set(enc.transcript.map((s: any) => s.segmentId));
  check(`${pt}: transcript has clinician and patient segments`, enc.transcript.some((s: any) => s.role === "CLINICIAN") && enc.transcript.some((s: any) => s.role === "PATIENT"));
  const links = enc.draftNote.flatMap((s: any) => s.sentences.flatMap((x: any) => x.evidence));
  check(`${pt}: every evidence link resolves to a transcript segment`, links.length > 0 && links.every((id: string) => segIds.has(id)));
  console.log(`        ${pt}: ${enc.transcript.length} segments, sections: ${enc.draftNote.map((s: any) => s.name).join(", ")}`);
  console.log(`        ${pt}: HealthScribe job ${(enc.scribe.jobDurationMs / 1000).toFixed(0)} s (template ${enc.scribe.template}); start -> NOTE_READY seen by client ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
const plan1 = r1.encounter.draftNote?.find((s: any) => s.name === "PLAN")?.sentences.map((x: any) => x.text).join(" ") ?? "";
check("PT-001 draft plan mentions oral surgery", /oral surgery/i.test(plan1), plan1);
const all2 = JSON.stringify(r2.encounter.draftNote ?? []);
check("PT-002 draft mentions the 6-month review", /six months|6 months|6-month/i.test(all2));

// ---------------------------------------------------------------------------
section("Runtime tags on HealthScribe jobs");
if (r1.encounter.scribeJobName) {
  const transcribe = new TranscribeClient({});
  const acct = outputs.lambda_role_arns.api!.split(":")[4];
  const arn = `arn:aws:transcribe:${process.env.AWS_REGION}:${acct}:medical-scribe-job/${r1.encounter.scribeJobName}`;
  const tags = await transcribe.send(new ListTagsForResourceCommand({ ResourceArn: arn }));
  check("HealthScribe job tagged with aws-apn-id", !!tags.Tags?.some((t) => t.Key === "aws-apn-id" && t.Value === "pc:biytoe4tqjehdsa25lc534ba2"), tags.Tags);
} else {
  check("HealthScribe job exists to check tags", false);
}

// ---------------------------------------------------------------------------
section("PUT /encounters/{id}/note");
{
  const sections = r1.encounter.draftNote.map((s: any) => ({ name: s.name, text: s.sentences.map((x: any) => x.text).join("\n") }));
  const byB2 = await api("PUT", `/encounters/${e1}/note`, drB.idToken, { reviewedNote: { sections } });
  check("DR-B cannot save DR-A's note -> 403", byB2.status === 403, byB2.status);
  const bad = await api("PUT", `/encounters/${e1}/note`, drA.idToken, { reviewedNote: { sections: [] } });
  check("empty note rejected -> 400", bad.status === 400, bad.status);
  const ok = await api("PUT", `/encounters/${e1}/note`, drA.idToken, { reviewedNote: { sections } });
  check("DR-A saves reviewed note -> NOTE_REVIEWED", ok.status === 200 && ok.body.encounter.status === "NOTE_REVIEWED", ok);
  const again = await api("PUT", `/encounters/${e1}/note`, drA.idToken, { reviewedNote: { sections } });
  check("note can be edited again before the assistant runs", again.status === 200, again.status);
  check("view hides internal fields", !("nextStepSeq" in ok.body.encounter) && !("lastScribeCheckAt" in ok.body.encounter));
}

console.log(`\n        encounters: PT-001 ${e1}, PT-002 ${e2}`);
finish();
