provider "aws" {
  profile = var.aws_profile
  region  = var.region

  default_tags {
    tags = local.tags
  }
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  name       = "clinical-agent-demo"
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition

  tags = {
    "aws-apn-id" = "pc:biytoe4tqjehdsa25lc534ba2"
    Project      = "clinical-agent-demo"
    Environment  = "demo"
    ManagedBy    = "terraform"
  }
}
