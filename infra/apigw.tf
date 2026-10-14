# HTTP API + Cognito JWT authorizer. Routes and integrations are added in
# Phases 2-4 alongside their Lambdas; every route uses this authorizer.
resource "aws_apigatewayv2_api" "http" {
  name          = "${local.name}-api"
  protocol_type = "HTTP"

  # API Gateway answers CORS preflight itself, before the authorizer runs.
  cors_configuration {
    allow_origins = var.frontend_origins
    allow_methods = ["GET", "POST", "PUT", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 600
  }
}

# ID tokens carry custom:doctor_id and aud = app client ID. Access tokens have
# no aud, but API Gateway then checks client_id against the same audience, so
# handlers also require token_use == "id".
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.http.id
  name             = "cognito-id-token"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.doctors.id}"
    audience = [aws_cognito_user_pool_client.web.id]
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 25
  }

  # IDs, status and latency only. No bodies.
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      latencyMs      = "$context.responseLatency"
      integrationErr = "$context.integrationErrorMessage"
      authorizerErr  = "$context.authorizer.error"
      sub            = "$context.authorizer.claims.sub"
    })
  }
}
