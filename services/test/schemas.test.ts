import { describe, expect, it } from "vitest";
import { createReferralInput, getPatientRecordInput, scheduleRecallInput, toolInvocation } from "../shared/schemas";
import { callerFrom, type ApiEvent } from "../shared/http";

const referral = {
  patientId: "PT-001",
  specialty: "ORAL_AND_MAXILLOFACIAL_SURGERY",
  reason: "Assessment for removal of impacted lower right third molar",
  relevantFindings: ["Partially erupted 48 with inflamed operculum"],
  allergies: ["Penicillin (urticarial rash)"],
  imagingReference: "IMG-PT001-OPG-20260928",
  urgency: "ROUTINE",
};

describe("tool input schemas", () => {
  it("accepts a valid referral", () => expect(createReferralInput.safeParse(referral).success).toBe(true));
  it("rejects unknown fields (model cannot smuggle doctorId)", () =>
    expect(createReferralInput.safeParse({ ...referral, doctorId: "DR-B" }).success).toBe(false));
  it("rejects an unknown specialty", () =>
    expect(createReferralInput.safeParse({ ...referral, specialty: "CARDIOLOGY" }).success).toBe(false));
  it("rejects malformed patient IDs", () =>
    expect(getPatientRecordInput.safeParse({ patientId: "PT-001; DROP" }).success).toBe(false));
  it("bounds the recall interval", () => {
    expect(scheduleRecallInput.safeParse({ patientId: "PT-002", intervalMonths: 6, reason: "Routine" }).success).toBe(true);
    expect(scheduleRecallInput.safeParse({ patientId: "PT-002", intervalMonths: 60, reason: "Routine" }).success).toBe(false);
  });
  it("requires the application envelope", () => {
    const inv = toolInvocation(getPatientRecordInput);
    expect(inv.safeParse({ encounterId: "ENC-abc123", doctorId: "DR-A", input: { patientId: "PT-001" } }).success).toBe(true);
    expect(inv.safeParse({ input: { patientId: "PT-001" } }).success).toBe(false);
  });
});

describe("callerFrom", () => {
  const event = (claims: Record<string, string>) =>
    ({ requestContext: { authorizer: { jwt: { claims } } } }) as unknown as ApiEvent;

  it("reads the doctor from an ID token", () =>
    expect(callerFrom(event({ token_use: "id", "custom:doctor_id": "DR-A", sub: "s" })).doctorId).toBe("DR-A"));
  it("rejects access tokens", () =>
    expect(() => callerFrom(event({ token_use: "access", client_id: "x", sub: "s" }))).toThrow());
  it("rejects ID tokens without a doctor", () =>
    expect(() => callerFrom(event({ token_use: "id", sub: "s" }))).toThrow());
});
