import { z } from "zod";

export const patientIdSchema = z.string().regex(/^PT-\d{3}$/, "patientId must look like PT-001");
export const encounterIdSchema = z.string().regex(/^ENC-[A-Za-z0-9-]{6,64}$/, "invalid encounterId");
export const actionIdSchema = z.string().regex(/^ACT-ENC-[A-Za-z0-9-]{6,64}$/, "invalid actionId");
export const doctorIdSchema = z.string().regex(/^DR-[A-Z0-9]{1,8}$/, "invalid doctorId");

const text = (max: number) => z.string().trim().min(1).max(max);

// ---- Tool inputs as the model supplies them (validated in the tool Lambda) ----

export const getPatientRecordInput = z.strictObject({
  patientId: patientIdSchema,
});

export const REFERRAL_SPECIALTIES = [
  "ORAL_AND_MAXILLOFACIAL_SURGERY",
  "ORTHODONTICS",
  "PERIODONTICS",
  "ENDODONTICS",
  "RESTORATIVE_DENTISTRY",
  "PAEDIATRIC_DENTISTRY",
  "OTHER",
] as const;

export const createReferralInput = z.strictObject({
  patientId: patientIdSchema,
  specialty: z.enum(REFERRAL_SPECIALTIES),
  reason: text(1000),
  relevantFindings: z.array(text(500)).max(20),
  allergies: z.array(text(200)).max(20),
  imagingReference: text(300).nullable(),
  urgency: z.enum(["ROUTINE", "SOON", "URGENT"]),
});

export const scheduleRecallInput = z.strictObject({
  patientId: patientIdSchema,
  intervalMonths: z.number().int().min(1).max(24),
  reason: text(1000),
});

// ---- Envelope the agent worker sends to every tool Lambda ----
// doctorId and encounterId come from the stored encounter, never from the model.

export const toolInvocation = <T extends z.ZodType>(input: T) =>
  z.strictObject({
    encounterId: encounterIdSchema,
    doctorId: doctorIdSchema,
    input,
  });

// ---- API bodies ----

export const rejectBody = z
  .strictObject({ reason: text(1000).optional() })
  .optional();

export function formatZodError(err: z.ZodError): string {
  return err.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}
