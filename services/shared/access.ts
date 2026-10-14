import type { Action, DoctorId, Encounter, Patient } from "./types";

// Pure authorization decisions. Every caller supplies doctorId from a verified
// source (JWT claims or the stored encounter), never from model output.

export function isAssigned(patient: Pick<Patient, "assignedDoctorIds"> | undefined, doctorId: DoctorId): boolean {
  return !!patient && patient.assignedDoctorIds.has(doctorId);
}

export function ownsEncounter(encounter: Pick<Encounter, "doctorId"> | undefined, doctorId: DoctorId): boolean {
  return !!encounter && encounter.doctorId === doctorId;
}

export function canDecideAction(
  action: Pick<Action, "doctorId" | "encounterId"> | undefined,
  encounter: Pick<Encounter, "doctorId" | "encounterId"> | undefined,
  doctorId: DoctorId,
): boolean {
  return (
    !!action &&
    !!encounter &&
    action.encounterId === encounter.encounterId &&
    action.doctorId === doctorId &&
    encounter.doctorId === doctorId
  );
}

// One proposed action per encounter: the ID is derived, and the tool writes it
// with attribute_not_exists, so a second proposal is rejected by DynamoDB.
export function actionIdFor(encounterId: string): string {
  return `ACT-${encounterId}`;
}
