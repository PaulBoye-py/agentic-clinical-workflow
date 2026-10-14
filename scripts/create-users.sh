#!/usr/bin/env bash
# Creates (or updates) the two demo doctors in the Terraform-created user pool.
# Passwords come from env vars and are never written to disk:
#   DR_A_PASSWORD=... DR_B_PASSWORD=... scripts/create-users.sh
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-paul-padarhealth}"
export AWS_REGION="${AWS_REGION:-us-east-1}"

: "${DR_A_PASSWORD:?set DR_A_PASSWORD}"
: "${DR_B_PASSWORD:?set DR_B_PASSWORD}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
POOL_ID="$(terraform -chdir="$ROOT/infra" output -raw user_pool_id)"

upsert_user() {
  local email="$1" name="$2" doctor_id="$3" password="$4"
  local attrs=(
    "Name=email,Value=$email"
    "Name=email_verified,Value=true"
    "Name=name,Value=$name"
    "Name=custom:doctor_id,Value=$doctor_id"
  )

  if aws cognito-idp admin-get-user --user-pool-id "$POOL_ID" --username "$email" >/dev/null 2>&1; then
    aws cognito-idp admin-update-user-attributes --user-pool-id "$POOL_ID" \
      --username "$email" --user-attributes "${attrs[@]}"
    echo "updated  $email ($doctor_id)"
  else
    aws cognito-idp admin-create-user --user-pool-id "$POOL_ID" \
      --username "$email" --user-attributes "${attrs[@]}" \
      --message-action SUPPRESS >/dev/null
    echo "created  $email ($doctor_id)"
  fi

  aws cognito-idp admin-set-user-password --user-pool-id "$POOL_ID" \
    --username "$email" --password "$password" --permanent
}

upsert_user "dr.a@demo.local" "Dr A (demo)" "DR-A" "$DR_A_PASSWORD"
upsert_user "dr.b@demo.local" "Dr B (demo)" "DR-B" "$DR_B_PASSWORD"
