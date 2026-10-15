# Bedrock access for the agent worker, scoped to the two configured models.
# For cross-Region inference profiles, per the Bedrock docs, invoking through a
# profile needs the profile ARN AND the foundation model in every Region the
# profile routes to; the foundation-model grant is limited to calls made
# through these profiles (bedrock:InferenceProfileArn).

locals {
  agent_model_ids = toset([var.bedrock_model_id, var.bedrock_fallback_model_id])
  # Cross-Region inference profile IDs carry a geography prefix (us., global.).
  profile_model_ids = toset([for id in local.agent_model_ids : id if can(regex("^(us|eu|apac|global)\\.", id))])
  # Plain foundation-model IDs (e.g. openai.gpt-oss-120b-1:0) run in this Region only.
  direct_model_ids = setsubtract(local.agent_model_ids, local.profile_model_ids)
}

data "aws_bedrock_inference_profile" "agent" {
  for_each             = local.profile_model_ids
  inference_profile_id = each.value
}

locals {
  inference_profile_arns = [for p in data.aws_bedrock_inference_profile.agent : p.inference_profile_arn]
  foundation_model_arns = distinct(flatten([
    for p in data.aws_bedrock_inference_profile.agent : [for m in p.models : m.model_arn]
  ]))
  direct_model_arns = [for id in local.direct_model_ids : "arn:${local.partition}:bedrock:${var.region}::foundation-model/${id}"]
}

data "aws_iam_policy_document" "agent_worker" {
  statement {
    sid       = "InvokeViaInferenceProfiles"
    actions   = ["bedrock:InvokeModel"]
    resources = local.inference_profile_arns
  }
  dynamic "statement" {
    for_each = length(local.direct_model_arns) > 0 ? [1] : []
    content {
      sid       = "InvokeDirectFoundationModels"
      actions   = ["bedrock:InvokeModel"]
      resources = local.direct_model_arns
    }
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
