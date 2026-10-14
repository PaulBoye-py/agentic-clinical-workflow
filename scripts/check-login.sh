#!/usr/bin/env bash
# Logs in with USER_PASSWORD_AUTH and prints the identity claims of the ID and
# access tokens (no token values), to confirm where custom:doctor_id lives.
#   PASSWORD=... scripts/check-login.sh dr.a@demo.local
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-paul-padarhealth}"
export AWS_REGION="${AWS_REGION:-us-east-1}"

USERNAME="${1:?usage: PASSWORD=... $0 <email>}"
: "${PASSWORD:?set PASSWORD}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLIENT_ID="$(terraform -chdir="$ROOT/infra" output -raw user_pool_client_id)"

AUTH="$(aws cognito-idp initiate-auth --client-id "$CLIENT_ID" \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters "USERNAME=$USERNAME,PASSWORD=$PASSWORD" \
  --query AuthenticationResult --output json)"

decode() {
  local part
  part="$(cut -d. -f2 <<<"$1" | tr '_-' '/+')"
  while (( ${#part} % 4 )); do part="$part="; done
  base64 -d <<<"$part"
}

FIELDS='{token_use, aud, client_id, "custom:doctor_id", name, iss}'
echo "ID token:";     decode "$(jq -r .IdToken <<<"$AUTH")"     | jq "$FIELDS"
echo "Access token:"; decode "$(jq -r .AccessToken <<<"$AUTH")" | jq "$FIELDS"
