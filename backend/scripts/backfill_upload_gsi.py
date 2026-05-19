#!/usr/bin/env python3

import argparse
import sys
from typing import Dict, Iterator, Optional

import boto3
from boto3.dynamodb.conditions import Attr


def parse_args():
  parser = argparse.ArgumentParser(
    description="Backfill GSI1PK/GSI1SK on upload metadata rows in the StrideAI DynamoDB table."
  )
  parser.add_argument("--table", default="StrideAI", help="DynamoDB table name")
  parser.add_argument("--region", default="us-east-2", help="AWS region")
  parser.add_argument("--profile", default=None, help="Optional AWS profile name")
  parser.add_argument(
    "--dry-run",
    action="store_true",
    help="Print planned changes without writing to DynamoDB",
  )
  parser.add_argument(
    "--limit",
    type=int,
    default=0,
    help="Maximum number of upload items to process; 0 means no limit",
  )
  return parser.parse_args()


def build_session(profile: Optional[str], region: str):
  if profile:
    return boto3.Session(profile_name=profile, region_name=region)
  return boto3.Session(region_name=region)


def scan_upload_items(table) -> Iterator[Dict]:
  scan_kwargs = {
    "FilterExpression": Attr("pk").begins_with("UPLOAD#"),
  }

  while True:
    response = table.scan(**scan_kwargs)
    for item in response.get("Items", []):
      yield item

    last_evaluated_key = response.get("LastEvaluatedKey")
    if not last_evaluated_key:
      break
    scan_kwargs["ExclusiveStartKey"] = last_evaluated_key


def desired_index_values(item: Dict):
  pk = item.get("pk", "")
  sk = item.get("sk", "")
  created_at = item.get("createdAt", "")
  if not pk or not sk or not created_at:
    raise ValueError("Missing required fields pk, sk, or createdAt")

  return sk, f"CREATED#{created_at}#{pk}"


def needs_update(item: Dict, desired_pk: str, desired_sk: str):
  return item.get("GSI1PK") != desired_pk or item.get("GSI1SK") != desired_sk


def update_item(table, item: Dict, gsi1pk: str, gsi1sk: str):
  table.update_item(
    Key={"pk": item["pk"], "sk": item["sk"]},
    UpdateExpression="SET GSI1PK = :gsi1pk, GSI1SK = :gsi1sk",
    ExpressionAttributeValues={
      ":gsi1pk": gsi1pk,
      ":gsi1sk": gsi1sk,
    },
  )


def main():
  args = parse_args()
  session = build_session(args.profile, args.region)
  dynamodb = session.resource("dynamodb", region_name=args.region)
  table = dynamodb.Table(args.table)

  processed = 0
  updated = 0
  skipped = 0
  invalid = 0

  for item in scan_upload_items(table):
    if args.limit and processed >= args.limit:
      break

    processed += 1
    try:
      gsi1pk, gsi1sk = desired_index_values(item)
    except ValueError as exc:
      invalid += 1
      print(f"INVALID {item.get('pk')} {item.get('sk')}: {exc}", file=sys.stderr)
      continue

    if not needs_update(item, gsi1pk, gsi1sk):
      skipped += 1
      continue

    if args.dry_run:
      print(
        f"DRY RUN update {item['pk']} {item['sk']} "
        f"GSI1PK={gsi1pk} GSI1SK={gsi1sk}"
      )
    else:
      update_item(table, item, gsi1pk, gsi1sk)
      print(f"UPDATED {item['pk']} {item['sk']}")
    updated += 1

  print(
    f"Done. processed={processed} updated={updated} skipped={skipped} invalid={invalid} "
    f"mode={'dry-run' if args.dry_run else 'write'}"
  )


if __name__ == "__main__":
  main()
