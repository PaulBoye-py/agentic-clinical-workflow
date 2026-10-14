# Paste these into Amplify Hosting > Environment variables (and .env.local).
output "amplify_env" {
  description = "Frontend environment variables."
  value = {
    NEXT_PUBLIC_AWS_REGION          = var.region
    NEXT_PUBLIC_USER_POOL_ID        = aws_cognito_user_pool.doctors.id
    NEXT_PUBLIC_USER_POOL_CLIENT_ID = aws_cognito_user_pool_client.web.id
    NEXT_PUBLIC_API_URL             = aws_apigatewayv2_api.http.api_endpoint
  }
}

output "region" {
  value = var.region
}

output "user_pool_id" {
  value = aws_cognito_user_pool.doctors.id
}

output "user_pool_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "api_url" {
  value = aws_apigatewayv2_api.http.api_endpoint
}

output "media_bucket" {
  value = aws_s3_bucket.media.bucket
}

output "tables" {
  value = {
    patients       = aws_dynamodb_table.patients.name
    encounters     = aws_dynamodb_table.encounters.name
    encounter_step = aws_dynamodb_table.encounter_steps.name
    actions        = aws_dynamodb_table.actions.name
    audit          = aws_dynamodb_table.audit.name
  }
}

output "lambda_role_arns" {
  value = { for k, r in aws_iam_role.fn : k => r.arn }
}

output "healthscribe_data_access_role_arn" {
  value = aws_iam_role.scribe_data_access.arn
}
