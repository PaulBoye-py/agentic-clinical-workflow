variable "aws_profile" {
  description = "AWS CLI profile used by Terraform."
  type        = string
  default     = "paul-padarhealth"
}

variable "region" {
  description = "Region for everything. HealthScribe is only available in us-east-1."
  type        = string
  default     = "us-east-1"
}

variable "frontend_origins" {
  description = "Origins allowed by API Gateway and S3 CORS (localhost + the Amplify domain)."
  type        = list(string)
  default     = ["http://localhost:3000"]
}

# Chosen by measurement (services/scripts/run-scenario.ts + eval-model.ts):
# OpenAI gpt-oss-120b on Bedrock passed A-E 3/3 full runs. Claude Haiku 4.5
# declined scenario C's record request; Claude 5.5 / GPT-5.x+ are blocked on
# this account by a 0 tokens-per-minute quota. Accepts an inference profile ID
# (us./global.) or a plain foundation-model ID; IAM follows automatically.
variable "bedrock_model_id" {
  description = "Primary agent model: a Bedrock inference profile ID or foundation-model ID."
  type        = string
  default     = "openai.gpt-oss-120b-1:0"
}

variable "bedrock_fallback_model_id" {
  description = "Fallback model, used only when USE_FALLBACK_MODEL=true is set by hand."
  type        = string
  default     = "us.amazon.nova-pro-v1:0"
}

variable "use_fallback_model" {
  description = "Use the fallback model. Manual switch only; never automatic."
  type        = bool
  default     = false
}

variable "note_template" {
  description = "HealthScribe NoteTemplate (HISTORY_AND_PHYSICAL or PHYSICAL_SOAP)."
  type        = string
  default     = "HISTORY_AND_PHYSICAL"

  validation {
    condition     = contains(["HISTORY_AND_PHYSICAL", "PHYSICAL_SOAP"], var.note_template)
    error_message = "note_template must be HISTORY_AND_PHYSICAL or PHYSICAL_SOAP."
  }
}

variable "log_retention_days" {
  type    = number
  default = 7
}
