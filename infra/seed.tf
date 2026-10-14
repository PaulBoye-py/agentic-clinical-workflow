# SYNTHETIC patients only. Names are fictional and labelled "(synthetic)".
# Item JSON is DynamoDB attribute-value format.

locals {
  patients = {
    "PT-001" = {
      patientId         = { S = "PT-001" }
      displayName       = { S = "Ada Testcase (synthetic)" }
      synthetic         = { BOOL = true }
      dateOfBirth       = { S = "1997-05-14" }
      sex               = { S = "F" }
      assignedDoctorIds = { SS = ["DR-A"] }
      allergies = { L = [
        { M = {
          substance = { S = "Penicillin" }
          reaction  = { S = "Urticarial rash" }
          severity  = { S = "moderate" }
          recorded  = { S = "2019-03-11" }
        } }
      ] }
      medicalHistory = { L = [
        { S = "Childhood asthma, resolved; no inhaler use since 2012" }
      ] }
      medications = { L = [] }
      imaging = { L = [
        { M = {
          imagingId = { S = "IMG-PT001-OPG-20260928" }
          type      = { S = "OPG (panoramic radiograph)" }
          date      = { S = "2026-09-28" }
          report    = { S = "Mesioangular impaction of the lower right third molar (48). No other abnormality detected." }
        } }
      ] }
      lastCheckup = { S = "2026-03-02" }
    }

    "PT-002" = {
      patientId         = { S = "PT-002" }
      displayName       = { S = "Ben Placeholder (synthetic)" }
      synthetic         = { BOOL = true }
      dateOfBirth       = { S = "1985-11-02" }
      sex               = { S = "M" }
      assignedDoctorIds = { SS = ["DR-A"] }
      allergies         = { L = [] }
      noKnownAllergies  = { BOOL = true }
      medicalHistory    = { L = [{ S = "No significant medical history" }] }
      medications       = { L = [] }
      imaging = { L = [
        { M = {
          imagingId = { S = "IMG-PT002-BW-20260410" }
          type      = { S = "Bitewing radiographs" }
          date      = { S = "2026-04-10" }
          report    = { S = "Early interproximal caries distal of upper left first molar (26). Otherwise no abnormality detected." }
        } }
      ] }
      lastCheckup = { S = "2026-04-10" }
    }

    "PT-003" = {
      patientId         = { S = "PT-003" }
      displayName       = { S = "Carl Sample (synthetic)" }
      synthetic         = { BOOL = true }
      dateOfBirth       = { S = "1994-08-21" }
      sex               = { S = "M" }
      assignedDoctorIds = { SS = ["DR-B"] }
      allergies         = { L = [] }
      noKnownAllergies  = { BOOL = true }
      medicalHistory    = { L = [{ S = "Lower left third molar extracted 2024" }] }
      medications       = { L = [] }
      imaging           = { L = [] }
      lastCheckup       = { S = "2026-01-15" }
    }
  }
}

resource "aws_dynamodb_table_item" "patient" {
  for_each   = local.patients
  table_name = aws_dynamodb_table.patients.name
  hash_key   = aws_dynamodb_table.patients.hash_key
  item       = jsonencode(each.value)
}
