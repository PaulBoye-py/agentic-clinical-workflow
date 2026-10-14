import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  GetMedicalScribeJobCommand,
  StartMedicalScribeJobCommand,
  TranscribeClient,
  type MedicalScribeSettings,
} from "@aws-sdk/client-transcribe";
import { PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { isAssigned } from "../shared/access";
import { audit } from "../shared/audit";
import { env, tables } from "../shared/config";
import { ddb } from "../shared/ddb";
import { getOwnedEncounter, markFailed, newEncounterId, transition } from "../shared/encounters";
import { errors, isConditionalCheckFailed } from "../shared/errors";
import { parseClinicalDocument, parseTranscript, s3KeyFromUri } from "../shared/healthscribe";
import { json, parseBody, type ApiEvent, type ApiResult, type Caller } from "../shared/http";
import { log } from "../shared/logger";
import { getPatient } from "../shared/repo";
import { AUDIO_CONTENT_TYPES, createEncounterBody, encounterIdSchema, reviewedNoteBody } from "../shared/schemas";
import type { Encounter } from "../shared/types";

const s3 = new S3Client({});
const transcribe = new TranscribeClient({});

const UPLOAD_URL_TTL_SECONDS = 300;
const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
const SCRIBE_CHECK_INTERVAL_MS = 5000;

const bucket = () => env.required("MEDIA_BUCKET");

function encounterIdFrom(event: ApiEvent): string {
  const parsed = encounterIdSchema.safeParse(event.pathParameters?.encounterId);
  if (!parsed.success) throw errors.validation("Invalid encounter ID.");
  return parsed.data;
}

// Internal bookkeeping stays server-side.
function view(encounter: Encounter) {
  const { nextStepSeq: _a, lastScribeCheckAt: _b, conversation: _c, pendingToolUseId: _d, ...rest } = encounter as Encounter & Record<string, unknown>;
  return rest;
}

// ---- POST /encounters ----

export async function createEncounter(event: ApiEvent, caller: Caller): Promise<ApiResult> {
  const body = parseBody(event, createEncounterBody);

  // Defence in depth: the UI only lists assigned patients, but the API checks again.
  const patient = await getPatient(body.patientId);
  if (!isAssigned(patient, caller.doctorId)) {
    await audit(`PATIENT#${body.patientId}`, "ACCESS_DENIED", {
      actor: "clinician",
      doctorId: caller.doctorId,
      patientId: body.patientId,
      reason: patient ? "NOT_ASSIGNED" : "NOT_FOUND",
    });
    throw errors.forbidden("You are not assigned to this patient.");
  }

  const encounterId = newEncounterId();
  const audioKey = `audio/${encounterId}.${AUDIO_CONTENT_TYPES[body.contentType]}`;
  const now = new Date().toISOString();
  const encounter: Encounter = {
    encounterId,
    doctorId: caller.doctorId,
    patientId: body.patientId,
    status: "CREATED",
    audioKey,
    audioContentType: body.contentType,
    audioLayout: body.audioLayout,
    nextStepSeq: 0,
    createdAt: now,
    updatedAt: now,
  };
  await ddb.send(
    new PutCommand({ TableName: tables.encounters, Item: encounter, ConditionExpression: "attribute_not_exists(encounterId)" }),
  );

  // Content type is signed (not signed by default), so the browser must upload
  // exactly this type or S3 rejects the request.
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: bucket(), Key: audioKey, ContentType: body.contentType }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: new Set(["content-type"]) },
  );

  log.info("encounter_created", { encounterId, doctorId: caller.doctorId, patientId: body.patientId });
  return json(201, {
    encounter: view(encounter),
    upload: { url, method: "PUT", headers: { "content-type": body.contentType }, expiresInSeconds: UPLOAD_URL_TTL_SECONDS },
  });
}

// ---- POST /encounters/{encounterId}/transcribe ----

export async function startTranscription(event: ApiEvent, caller: Caller): Promise<ApiResult> {
  const encounterId = encounterIdFrom(event);
  const encounter = await getOwnedEncounter(encounterId, caller.doctorId);
  if (encounter.status !== "CREATED") throw errors.conflict("Transcription has already been started for this encounter.");

  const audioKey = String(encounter.audioKey);
  let size: number;
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket(), Key: audioKey }));
    size = head.ContentLength ?? 0;
  } catch (err) {
    if (err instanceof Error && (err.name === "NotFound" || err.name === "NoSuchKey")) {
      throw errors.conflict("Upload the consultation audio first.");
    }
    throw err;
  }
  if (size === 0 || size > MAX_AUDIO_BYTES) throw errors.validation("Audio must be between 1 byte and 200 MB.");

  await transition(encounterId, ["CREATED"], "AUDIO_UPLOADED", { audioBytes: size });

  const jobName = `clinical-agent-demo-${encounterId}`;
  const noteTemplate = process.env.NOTE_TEMPLATE ?? "HISTORY_AND_PHYSICAL";
  const stereo = encounter.audioLayout === "STEREO_CLINICIAN_LEFT";
  const settings: MedicalScribeSettings = stereo
    ? { ChannelIdentification: true, ClinicalNoteGenerationSettings: { NoteTemplate: noteTemplate as never } }
    : { ShowSpeakerLabels: true, MaxSpeakerLabels: 2, ClinicalNoteGenerationSettings: { NoteTemplate: noteTemplate as never } };

  const started = Date.now();
  try {
    await transcribe.send(
      new StartMedicalScribeJobCommand({
        MedicalScribeJobName: jobName,
        Media: { MediaFileUri: `s3://${bucket()}/${audioKey}` },
        OutputBucketName: bucket(),
        DataAccessRoleArn: env.required("SCRIBE_ROLE_ARN"),
        Settings: settings,
        ChannelDefinitions: stereo
          ? [
              { ChannelId: 0, ParticipantRole: "CLINICIAN" },
              { ChannelId: 1, ParticipantRole: "PATIENT" },
            ]
          : undefined,
        Tags: JSON.parse(env.required("RESOURCE_TAGS")) as { Key: string; Value: string }[],
      }),
    );
  } catch (err) {
    const code = err instanceof Error ? err.name : "Unknown";
    log.error("scribe_start_failed", { encounterId, errorCode: code });
    await markFailed(encounterId, "HEALTHSCRIBE_START_FAILED", `AWS HealthScribe could not start the job (${code}).`);
    throw errors.conflict(`AWS HealthScribe could not start the job (${code}).`);
  }

  const updated = await transition(encounterId, ["AUDIO_UPLOADED"], "TRANSCRIBING", {
    scribeJobName: jobName,
    noteTemplate,
    transcribeStartedAt: new Date().toISOString(),
  });
  log.info("scribe_started", { encounterId, latencyMs: Date.now() - started });
  return json(202, { encounter: view(updated) });
}

// ---- GET /encounters/{encounterId} ----

export async function getEncounterRoute(event: ApiEvent, caller: Caller): Promise<ApiResult> {
  const encounterId = encounterIdFrom(event);
  let encounter = await getOwnedEncounter(encounterId, caller.doctorId);

  if (encounter.status === "TRANSCRIBING") {
    encounter = (await advanceScribe(encounter)) ?? encounter;
  }

  const [steps, actions] = await Promise.all([
    ddb.send(new QueryCommand({ TableName: tables.steps, KeyConditionExpression: "encounterId = :e", ExpressionAttributeValues: { ":e": encounterId } })),
    ddb.send(new QueryCommand({ TableName: tables.actions, IndexName: "byEncounter", KeyConditionExpression: "encounterId = :e", ExpressionAttributeValues: { ":e": encounterId } })),
  ]);
  return json(200, { encounter: view(encounter), steps: steps.Items ?? [], actions: actions.Items ?? [] });
}

// Polls HealthScribe at most every few seconds per encounter (the UI polls
// every second). On completion, reads and parses the output into the encounter.
async function advanceScribe(encounter: Encounter): Promise<Encounter | undefined> {
  const now = Date.now();
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tables.encounters,
        Key: { encounterId: encounter.encounterId },
        UpdateExpression: "SET lastScribeCheckAt = :now",
        ConditionExpression: "attribute_not_exists(lastScribeCheckAt) OR lastScribeCheckAt < :cutoff",
        ExpressionAttributeValues: { ":now": now, ":cutoff": now - SCRIBE_CHECK_INTERVAL_MS },
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) return undefined; // checked recently
    throw err;
  }

  const { MedicalScribeJob: job } = await transcribe.send(
    new GetMedicalScribeJobCommand({ MedicalScribeJobName: String(encounter.scribeJobName) }),
  );
  const status = job?.MedicalScribeJobStatus;

  if (status === "FAILED") {
    const reason = (job?.FailureReason ?? "unknown reason").slice(0, 300);
    await markFailed(encounter.encounterId, "HEALTHSCRIBE_FAILED", `AWS HealthScribe failed: ${reason}`);
    log.error("scribe_failed", { encounterId: encounter.encounterId, errorCode: "HEALTHSCRIBE_FAILED" });
    return { ...encounter, status: "FAILED", error: { code: "HEALTHSCRIBE_FAILED", message: `AWS HealthScribe failed: ${reason}` } };
  }
  if (status !== "COMPLETED") return undefined;

  try {
    const output = job!.MedicalScribeOutput!;
    const [transcriptRaw, noteRaw] = await Promise.all([
      readJson(s3KeyFromUri(output.TranscriptFileUri!, bucket())),
      readJson(s3KeyFromUri(output.ClinicalDocumentUri!, bucket())),
    ]);
    const transcript = parseTranscript(transcriptRaw);
    const draftNote = parseClinicalDocument(noteRaw);
    const jobDurationMs =
      job!.StartTime && job!.CompletionTime ? job!.CompletionTime.getTime() - job!.StartTime.getTime() : undefined;

    const updated = await transition(encounter.encounterId, ["TRANSCRIBING"], "NOTE_READY", {
      transcript,
      draftNote,
      scribe: {
        jobName: job!.MedicalScribeJobName,
        template: job!.Settings?.ClinicalNoteGenerationSettings?.NoteTemplate,
        jobDurationMs,
        completedAt: job!.CompletionTime?.toISOString(),
      },
    });
    log.info("scribe_completed", { encounterId: encounter.encounterId, latencyMs: jobDurationMs });
    return updated;
  } catch (err) {
    if (err instanceof Error && err.name === "AppError") return undefined; // raced with another poll
    const code = err instanceof Error ? err.name : "Unknown";
    log.error("scribe_output_invalid", { encounterId: encounter.encounterId, errorCode: code });
    await markFailed(encounter.encounterId, "HEALTHSCRIBE_OUTPUT_INVALID", "The HealthScribe output could not be read.");
    return { ...encounter, status: "FAILED", error: { code: "HEALTHSCRIBE_OUTPUT_INVALID", message: "The HealthScribe output could not be read." } };
  }
}

async function readJson(key: string): Promise<unknown> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  return JSON.parse(await res.Body!.transformToString("utf8"));
}

// ---- PUT /encounters/{encounterId}/note ----

export async function saveReviewedNote(event: ApiEvent, caller: Caller): Promise<ApiResult> {
  const encounterId = encounterIdFrom(event);
  await getOwnedEncounter(encounterId, caller.doctorId);
  const { reviewedNote } = parseBody(event, reviewedNoteBody);
  const updated = await transition(encounterId, ["NOTE_READY", "NOTE_REVIEWED"], "NOTE_REVIEWED", {
    reviewedNote,
    noteReviewedAt: new Date().toISOString(),
    noteReviewedBy: caller.doctorId,
  });
  log.info("note_reviewed", { encounterId, doctorId: caller.doctorId });
  return json(200, { encounter: view(updated) });
}
