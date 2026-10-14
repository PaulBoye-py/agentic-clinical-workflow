resource "aws_dynamodb_table" "patients" {
  name                        = "${local.name}-patients"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "patientId"
  deletion_protection_enabled = false

  attribute {
    name = "patientId"
    type = "S"
  }
}

resource "aws_dynamodb_table" "encounters" {
  name                        = "${local.name}-encounters"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "encounterId"
  deletion_protection_enabled = false

  attribute {
    name = "encounterId"
    type = "S"
  }
}

# Live timeline. sk = zero-padded sequence number.
resource "aws_dynamodb_table" "encounter_steps" {
  name                        = "${local.name}-encounter-steps"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "encounterId"
  range_key                   = "seq"
  deletion_protection_enabled = false

  attribute {
    name = "encounterId"
    type = "S"
  }
  attribute {
    name = "seq"
    type = "S"
  }
}

resource "aws_dynamodb_table" "actions" {
  name                        = "${local.name}-actions"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "actionId"
  deletion_protection_enabled = false

  attribute {
    name = "actionId"
    type = "S"
  }
  attribute {
    name = "encounterId"
    type = "S"
  }

  global_secondary_index {
    name            = "byEncounter"
    projection_type = "ALL"
    key_schema {
      attribute_name = "encounterId"
      key_type       = "HASH"
    }
  }
}

# Security-relevant events, IDs only. sk = "<iso timestamp>#<id>".
resource "aws_dynamodb_table" "audit" {
  name                        = "${local.name}-audit"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "encounterId"
  range_key                   = "sk"
  deletion_protection_enabled = false

  attribute {
    name = "encounterId"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
}
