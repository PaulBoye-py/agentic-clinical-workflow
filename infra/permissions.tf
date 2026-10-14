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
    sid       = "ListAssignedPatients"
    actions   = ["dynamodb:Scan"]
    resources = [aws_dynamodb_table.patients.arn]
  }
}

locals {
  data_policies = {
    api                     = data.aws_iam_policy_document.api.json
    approve-action          = data.aws_iam_policy_document.approve_action.json
    tool-get-patient-record = data.aws_iam_policy_document.tool_get_patient_record.json
    tool-create-referral    = data.aws_iam_policy_document.tool_propose_action.json
    tool-schedule-recall    = data.aws_iam_policy_document.tool_propose_action.json
  }
}

resource "aws_iam_role_policy" "fn_data" {
  for_each = local.data_policies
  name     = "data"
  role     = aws_iam_role.fn[each.key].id
  policy   = each.value
}
