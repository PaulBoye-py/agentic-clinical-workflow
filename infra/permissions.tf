# Least-privilege data permissions per Lambda, resource-scoped.
# Note what is absent:
#   - Tool Lambdas have no dynamodb:UpdateItem on Actions (cannot change status).
#   - Only approve-action can UpdateItem Actions.
#   - Nothing here grants lambda:InvokeFunction on approve-action.

data "aws_iam_policy_document" "tool_get_patient_record" {
  statement {
    sid       = "ReadPatients"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.patients.arn]
  }
  statement {
    sid       = "WriteAudit"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.audit.arn]
  }
}

data "aws_iam_policy_document" "tool_propose_action" {
  statement {
    sid       = "ReadContext"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.patients.arn, aws_dynamodb_table.encounters.arn]
  }
  statement {
    sid       = "CreatePendingActionOnly"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.actions.arn]
  }
  statement {
    sid       = "WriteAudit"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.audit.arn]
  }
}

data "aws_iam_policy_document" "approve_action" {
  statement {
    sid       = "DecideActions"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.actions.arn]
  }
  statement {
    sid       = "CloseEncounter"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.encounters.arn]
  }
  statement {
    sid       = "WriteTimelineAndAudit"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.encounter_steps.arn, aws_dynamodb_table.audit.arn]
  }
}

data "aws_iam_policy_document" "api" {
  statement {
    sid       = "ReadPatients"
    actions   = ["dynamodb:Scan", "dynamodb:GetItem"]
    resources = [aws_dynamodb_table.patients.arn]
  }
  statement {
    sid       = "Encounters"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.encounters.arn]
  }
  statement {
    sid     = "ReadTimelineAndActions"
    actions = ["dynamodb:Query"]
    resources = [
      aws_dynamodb_table.encounter_steps.arn,
      "${aws_dynamodb_table.actions.arn}/index/byEncounter",
    ]
  }
  statement {
    sid       = "Audit"
    actions   = ["dynamodb:PutItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.audit.arn]
  }
  statement {
    sid       = "WriteTimeline"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.encounter_steps.arn]
  }
  statement {
    sid       = "StartAgentWorker"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.fn["agent-worker"].arn]
  }
  # Presigned upload URLs are signed with this role, so it needs PutObject on
  # audio/. GetObject on audio/ is for HeadObject (upload check).
  statement {
    sid       = "Audio"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.media.arn}/audio/*"]
  }
  # Without ListBucket, HeadObject on a missing key returns 403 instead of 404.
  statement {
    sid       = "ListAudio"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.media.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["audio/*"]
    }
  }
  statement {
    sid       = "ReadScribeOutput"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.media.arn}/${local.name}-*"]
  }
  statement {
    sid = "HealthScribeJobs"
    actions = [
      "transcribe:StartMedicalScribeJob",
      "transcribe:GetMedicalScribeJob",
      "transcribe:TagResource",
    ]
    resources = ["arn:${local.partition}:transcribe:${var.region}:${local.account_id}:medical-scribe-job/${local.name}-*"]
  }
  statement {
    sid       = "PassScribeRole"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.scribe_data_access.arn]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["transcribe.amazonaws.com"]
    }
  }
}

locals {
  data_policies = {
    api                     = data.aws_iam_policy_document.api.json
    approve-action          = data.aws_iam_policy_document.approve_action.json
    tool-get-patient-record = data.aws_iam_policy_document.tool_get_patient_record.json
    tool-create-referral    = data.aws_iam_policy_document.tool_propose_action.json
    tool-schedule-recall    = data.aws_iam_policy_document.tool_propose_action.json
    agent-worker            = data.aws_iam_policy_document.agent_worker.json
  }
}

resource "aws_iam_role_policy" "fn_data" {
  for_each = local.data_policies
  name     = "data"
  role     = aws_iam_role.fn[each.key].id
  policy   = each.value
}
