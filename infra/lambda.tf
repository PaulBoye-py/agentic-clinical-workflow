# Lambda functions. Code is built by `npm --prefix services run build` into
# services/dist/<name>/ and zipped here.

locals {
  deployed_functions = {
    api                     = { timeout = 15, memory = 512 }
    agent-worker            = { timeout = 300, memory = 512 }
    approve-action          = { timeout = 10, memory = 256 }
    tool-get-patient-record = { timeout = 10, memory = 256 }
    tool-create-referral    = { timeout = 10, memory = 256 }
    tool-schedule-recall    = { timeout = 10, memory = 256 }
  }

  table_env = {
    PATIENTS_TABLE   = aws_dynamodb_table.patients.name
    ENCOUNTERS_TABLE = aws_dynamodb_table.encounters.name
    STEPS_TABLE      = aws_dynamodb_table.encounter_steps.name
    ACTIONS_TABLE    = aws_dynamodb_table.actions.name
    AUDIT_TABLE      = aws_dynamodb_table.audit.name
  }

  # Function-specific environment, merged over table_env.
  function_env = {
    api = {
      MEDIA_BUCKET    = aws_s3_bucket.media.bucket
      SCRIBE_ROLE_ARN = aws_iam_role.scribe_data_access.arn
      NOTE_TEMPLATE   = var.note_template
      # Tags for resources created at runtime (HealthScribe jobs).
      RESOURCE_TAGS = jsonencode([for k, v in local.tags : { Key = k, Value = v }])
      # Name, not ARN: the worker's function is created in the same apply.
      AGENT_WORKER_FN = "${local.name}-agent-worker"
    }
    agent-worker = {
      BEDROCK_MODEL_ID           = var.bedrock_model_id
      BEDROCK_FALLBACK_MODEL_ID  = var.bedrock_fallback_model_id
      USE_FALLBACK_MODEL         = tostring(var.use_fallback_model)
      TOOL_FN_GET_PATIENT_RECORD = "${local.name}-tool-get-patient-record"
      TOOL_FN_CREATE_REFERRAL    = "${local.name}-tool-create-referral"
      TOOL_FN_SCHEDULE_RECALL    = "${local.name}-tool-schedule-recall"
    }
  }
}

data "archive_file" "fn" {
  for_each    = local.deployed_functions
  type        = "zip"
  source_dir  = "${path.module}/../services/dist/${each.key}"
  output_path = "${path.module}/.build/${each.key}.zip"
}

resource "aws_lambda_function" "fn" {
  for_each         = local.deployed_functions
  function_name    = "${local.name}-${each.key}"
  role             = aws_iam_role.fn[each.key].arn
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.fn[each.key].output_path
  source_code_hash = data.archive_file.fn[each.key].output_base64sha256
  timeout          = each.value.timeout
  memory_size      = each.value.memory

  environment {
    variables = merge(local.table_env, lookup(local.function_env, each.key, {}), {
      NODE_OPTIONS = "--enable-source-maps"
    })
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.fn[each.key].name
  }

  depends_on = [aws_iam_role_policy.fn_logs]
}

# The worker is invoked asynchronously. No automatic retries: a failed run goes
# to FAILED and is visible in the UI rather than silently re-running.
resource "aws_lambda_function_event_invoke_config" "agent_worker" {
  function_name                = aws_lambda_function.fn["agent-worker"].function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 300
}
