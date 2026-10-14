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

variable "bedrock_model_id" {
  description = "Primary agent model (cross-Region inference profile ID)."
  type        = string
  default     = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "bedrock_fallback_model_id" {
  description = "Fallback model, used only when USE_FALLBACK_MODEL=true is set by hand."
  type        = string
  default     = "us.amazon.nova-pro-v1:0"
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
