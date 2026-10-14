# Bedrock access for the agent worker, scoped to the two configured
# cross-Region inference profiles. Per the Bedrock docs, invoking through a
# profile needs the profile ARN AND the foundation model in every Region the
# profile routes to; the foundation-model grant is limited to calls made
# through these profiles (bedrock:InferenceProfileArn).

data "aws_bedrock_inference_profile" "agent" {
  for_each             = toset([var.bedrock_model_id, var.bedrock_fallback_model_id])
  inference_profile_id = each.value
}

locals {
  inference_profile_arns = [for p in data.aws_bedrock_inference_profile.agent : p.inference_profile_arn]
  foundation_model_arns = distinct(flatten([
    for p in data.aws_bedrock_inference_profile.agent : [for m in p.models : m.model_arn]
  ]))
}

data "aws_iam_policy_document" "agent_worker" {
  statement {
    sid       = "InvokeViaInferenceProfiles"
    actions   = ["bedrock:InvokeModel"]
    resources = local.inference_profile_arns
  }
  statement {
    sid       = "InvokeFoundationModelsOnlyThroughProfiles"
    actions   = ["bedrock:InvokeModel"]
    resources = local.foundation_model_arns
    condition {
      test     = "StringEquals"
      variable = "bedrock:InferenceProfileArn"
      values   = local.inference_profile_arns
    }
  }
  # The only Lambdas the agent can reach. approve-action is deliberately absent.
  statement {
    sid     = "InvokeToolLambdasOnly"
    actions = ["lambda:InvokeFunction"]
    resources = [
      aws_lambda_function.fn["tool-get-patient-record"].arn,
      aws_lambda_function.fn["tool-create-referral"].arn,
      aws_lambda_function.fn["tool-schedule-recall"].arn,
    ]
  }
  # Encounter state and timeline only. No access to Actions or Patients.
  statement {
    sid       = "EncounterState"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.encounters.arn]
  }
  statement {
    sid       = "WriteTimelineAndAudit"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.encounter_steps.arn, aws_dynamodb_table.audit.arn]
  }
}
