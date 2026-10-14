# IAM skeleton: one role per Lambda. Each role can only write to its own,
# Terraform-created log group (no logs:CreateLogGroup, so Lambda can never
# auto-create an untagged one). Service permissions are added per phase.

locals {
  functions = {
    api                     = "API route handlers (patients, encounters, transcribe, note, agent run/reply)"
    approve-action          = "Only path to APPROVED / REJECTED"
    agent-worker            = "Bedrock Converse tool-use loop"
    tool-get-patient-record = "Tool: read patient record with assignment check"
    tool-create-referral    = "Tool: write REFERRAL action as PENDING_APPROVAL"
    tool-schedule-recall    = "Tool: write RECALL action as PENDING_APPROVAL"
  }
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "fn" {
  for_each           = local.functions
  name               = "${local.name}-${each.key}"
  description        = each.value
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "fn_logs" {
  for_each = local.functions
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.fn[each.key].arn}:*"]
  }
}

resource "aws_iam_role_policy" "fn_logs" {
  for_each = local.functions
  name     = "logs"
  role     = aws_iam_role.fn[each.key].id
  policy   = data.aws_iam_policy_document.fn_logs[each.key].json
}

# HealthScribe data access role: read audio/, write healthscribe/ only.
data "aws_iam_policy_document" "scribe_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["transcribe.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "scribe_data_access" {
  name               = "${local.name}-healthscribe-data-access"
  description        = "Assumed by HealthScribe to read consultation audio and write output"
  assume_role_policy = data.aws_iam_policy_document.scribe_assume.json
}

data "aws_iam_policy_document" "scribe_data_access" {
  statement {
    sid       = "ReadAudio"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.media.arn}/audio/*"]
  }
  statement {
    sid       = "WriteOutput"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.media.arn}/healthscribe/*"]
  }
  statement {
    sid       = "ListOwnPrefixes"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.media.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["audio/*", "healthscribe/*"]
    }
  }
}

resource "aws_iam_role_policy" "scribe_data_access" {
  name   = "s3"
  role   = aws_iam_role.scribe_data_access.id
  policy = data.aws_iam_policy_document.scribe_data_access.json
}
