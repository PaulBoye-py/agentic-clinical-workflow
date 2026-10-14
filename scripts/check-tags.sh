#!/usr/bin/env bash
# Lists demo resources missing the aws-apn-id tag. Exits 1 if any are found.
# Three sources, because the Resource Groups Tagging API only returns resources
# that have (or once had) tags, so a never-tagged resource can be invisible to it:
#   1. Resource Groups Tagging API: everything whose ARN contains the project name
#      or that carries Project=clinical-agent-demo.
#   2. CloudWatch log groups for the project (catches auto-created, untagged ones).
#   3. HealthScribe jobs created at runtime.
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-paul-padarhealth}"
export AWS_REGION="${AWS_REGION:-us-east-1}"

NAME="clinical-agent-demo"
KEY="aws-apn-id"
missing=0

report() { echo "MISSING $KEY: $1"; missing=$((missing + 1)); }

echo "== Resource Groups Tagging API ($AWS_REGION)"
while IFS=$'\t' read -r ok arn; do
  [[ -z "$arn" ]] && continue
  if [[ "$ok" == "true" ]]; then echo "ok      $arn"; else report "$arn"; fi
done < <(aws resourcegroupstaggingapi get-resources --output json \
  | jq -r --arg n "$NAME" --arg k "$KEY" '
      .ResourceTagMappingList[]
      | select((.ResourceARN | contains($n))
               or any(.Tags[]?; .Key == "Project" and .Value == $n))
      | "\(any(.Tags[]?; .Key == $k))\t\(.ResourceARN)"')

echo "== CloudWatch log groups"
for prefix in "/aws/lambda/$NAME" "/aws/apigateway/$NAME"; do
  for arn in $(aws logs describe-log-groups --log-group-name-prefix "$prefix" \
                 --query 'logGroups[].arn' --output text); do
    arn="${arn%:\*}"
    if aws logs list-tags-for-resource --resource-arn "$arn" \
         --query "tags.\"$KEY\"" --output text | grep -qv '^None$'; then
      echo "ok      $arn"
    else
      report "$arn"
    fi
  done
done

echo "== IAM roles (global, not returned by the regional Tagging API)"
for role in $(aws iam list-roles --query "Roles[?starts_with(RoleName, '$NAME')].RoleName" --output text); do
  if aws iam list-role-tags --role-name "$role" \
       --query "Tags[?Key=='$KEY'] | length(@)" --output text | grep -q '^1$'; then
    echo "ok      iam role $role"
  else
    report "iam role $role"
  fi
done

echo "== HealthScribe jobs"
for job in $(aws transcribe list-medical-scribe-jobs --max-results 100 \
               --query "MedicalScribeJobSummaries[?starts_with(MedicalScribeJobName, '$NAME')].MedicalScribeJobName" \
               --output text); do
  arn="arn:aws:transcribe:$AWS_REGION:$(aws sts get-caller-identity --query Account --output text):medical-scribe-job/$job"
  if aws transcribe list-tags-for-resource --resource-arn "$arn" \
       --query "Tags[?Key=='$KEY'] | length(@)" --output text | grep -q '^1$'; then
    echo "ok      $arn"
  else
    report "$arn"
  fi
done

echo
if (( missing > 0 )); then
  echo "$missing resource(s) missing $KEY"
  exit 1
fi
echo "All demo resources carry $KEY."
