# Lambda functions. Code is built by `npm --prefix services run build` into
# services/dist/<name>/ and zipped here. agent-worker is added in Phase 4.

locals {
  deployed_functions = {
    api                     = { timeout = 15, memory = 512 }
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
    variables = merge(local.table_env, {
      NODE_OPTIONS = "--enable-source-maps"
    })
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.fn[each.key].name
  }

  depends_on = [aws_iam_role_policy.fn_logs]
}
