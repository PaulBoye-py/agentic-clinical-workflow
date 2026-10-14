resource "aws_cognito_user_pool" "doctors" {
  name                = "${local.name}-doctors"
  deletion_protection = "INACTIVE"
  username_attributes = ["email"]
  mfa_configuration   = "OFF"

  # Users are created by scripts/create-users.sh only.
  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 1
  }

  # Doctor identity. Lands in the ID token as "custom:doctor_id".
  # Mutable only so an admin can fix it; the app client cannot write it.
  schema {
    name                = "doctor_id"
    attribute_data_type = "String"
    mutable             = true
    required            = false
    string_attribute_constraints {
      min_length = 1
      max_length = 32
    }
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name            = "${local.name}-web"
  user_pool_id    = aws_cognito_user_pool.doctors.id
  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",      # browser (aws-amplify)
    "ALLOW_USER_PASSWORD_AUTH", # scripts/run-scenario.ts
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  # Readable: identity claims for the UI and API. Writable: nothing identity-bearing,
  # so a signed-in user cannot change their own custom:doctor_id.
  read_attributes  = ["email", "email_verified", "name", "custom:doctor_id"]
  write_attributes = ["name"]

  id_token_validity      = 60
  access_token_validity  = 60
  refresh_token_validity = 1
  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }
}
