// Deterministic note completeness check. No model involved: plain rules over
// the clinician-reviewed note, the clinician's answers and the patient record.

export interface ReviewedSection {
  name: string;
  text: string;
}

export interface RecordFacts {
  allergies: { substance: string; reaction?: string }[];
  noKnownAllergies?: boolean;
  imaging: { imagingId: string; type: string; date: string }[];
}

export interface CompletenessResult {
  complete: boolean;
  missing: string[]; // must be asked
  inRecordNotInNote: string[]; // surface to the clinician, does not block
  checked: string[];
}

// Section names per HealthScribe template that satisfy each item.
const SECTION_ITEMS: { item: string; sections: string[] }[] = [
  { item: "chief complaint", sections: ["CHIEF_COMPLAINT", "SUBJECTIVE"] },
  { item: "history of presenting complaint", sections: ["HISTORY_OF_PRESENT_ILLNESS", "SUBJECTIVE"] },
  { item: "medical history reviewed", sections: ["PAST_MEDICAL_HISTORY"] },
  { item: "examination findings", sections: ["PHYSICAL_EXAMINATION", "OBJECTIVE"] },
  { item: "assessment", sections: ["ASSESSMENT"] },
  { item: "plan", sections: ["PLAN"] },
];

const ALLERGY = /\ballerg|\bNKDA\b|no known drug/i;
const MEDICATION = /\bmedication|\bmedicine|\bmeds\b|\bdrug history|\bnot taking any|\bnil regular|\bno regular/i;

export function checkNoteCompleteness(
  note: ReviewedSection[],
  clinicianAnswers: string[],
  record: RecordFacts | undefined,
): CompletenessResult {
  const bySection = new Map(note.map((s) => [s.name.toUpperCase(), s.text.trim()]));
  const allText = [...note.map((s) => s.text), ...clinicianAnswers].join("\n");

  const missing: string[] = [];
  const inRecordNotInNote: string[] = [];

  for (const { item, sections } of SECTION_ITEMS) {
    if (!sections.some((name) => (bySection.get(name) ?? "").length > 0)) missing.push(item);
  }

  // Allergies: documented in the note or answers, otherwise the record decides
  // whether this is a gap to ask about or a record item to surface.
  if (!ALLERGY.test(allText)) {
    if (record && record.allergies.length > 0) {
      const list = record.allergies.map((a) => (a.reaction ? `${a.substance} (${a.reaction})` : a.substance)).join(", ");
      inRecordNotInNote.push(`allergies: ${list}`);
    } else if (!record?.noKnownAllergies) {
      missing.push("allergies");
    }
  }

  // Medications: an empty list in the record does not confirm "no current
  // medications", so this must be documented by the clinician.
  if (!MEDICATION.test(allText)) missing.push("current medications");

  return {
    complete: missing.length === 0,
    missing,
    inRecordNotInNote,
    checked: [...SECTION_ITEMS.map((s) => s.item), "allergies", "current medications"],
  };
}
