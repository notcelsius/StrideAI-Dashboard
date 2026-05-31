#!/usr/bin/env python3

import argparse
from datetime import datetime, timezone
from typing import Dict, Iterator, List, Optional, Tuple

import boto3
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError


def parse_args():
  parser = argparse.ArgumentParser(
    description="Backfill PROJECT#<projectId>/GROUP#<groupId> rows from existing subject group assignments."
  )
  parser.add_argument("--table", default="StrideAI", help="DynamoDB table name")
  parser.add_argument("--region", default="us-east-2", help="AWS region")
  parser.add_argument("--profile", default=None, help="Optional AWS profile name")
  parser.add_argument("--dry-run", action="store_true", help="Print planned changes without writing")
  parser.add_argument("--limit", type=int, default=0, help="Maximum subject rows to scan; 0 means no limit")
  return parser.parse_args()


def build_session(profile: Optional[str], region: str):
  if profile:
    return boto3.Session(profile_name=profile, region_name=region)
  return boto3.Session(region_name=region)


def scan_subjects(table, limit: int = 0) -> Iterator[Dict]:
  processed = 0
  scan_kwargs = {"FilterExpression": Attr("sk").begins_with("SUBJECT#")}

  while True:
    response = table.scan(**scan_kwargs)
    for item in response.get("Items", []):
      if limit and processed >= limit:
        return
      processed += 1
      yield item

    last_key = response.get("LastEvaluatedKey")
    if not last_key:
      break
    scan_kwargs["ExclusiveStartKey"] = last_key


def project_id_for_subject(subject: Dict) -> str:
  return subject.get("projectId") or str(subject.get("pk", "")).replace("PROJECT#", "")


def extract_subject_groups(subject: Dict) -> List[Dict[str, str]]:
  groups = []
  raw_groups = subject.get("groups") or []
  if isinstance(raw_groups, dict):
    raw_groups = [raw_groups]

  if isinstance(raw_groups, list):
    for raw_group in raw_groups:
      if isinstance(raw_group, str):
        group_id = raw_group.strip()
        group_name = group_id
      elif isinstance(raw_group, dict):
        group_id = str(raw_group.get("groupId") or raw_group.get("id") or "").strip()
        group_name = str(raw_group.get("groupName") or raw_group.get("name") or "").strip()
        if not group_id:
          group_id = group_name
        if not group_name:
          group_name = group_id
      else:
        continue
      if group_id:
        groups.append({"groupId": group_id, "groupName": group_name or group_id})

  group_ids = subject.get("groupIds") or []
  group_names = subject.get("groupNames") or []
  if isinstance(group_ids, str):
    group_ids = [value.strip() for value in group_ids.split(",")]
  if isinstance(group_names, str):
    group_names = [value.strip() for value in group_names.split(",")]
  if isinstance(group_ids, list):
    for index, group_id in enumerate(group_ids):
      group_id = str(group_id or "").strip()
      if not group_id:
        continue
      group_name = str(group_names[index]).strip() if isinstance(group_names, list) and index < len(group_names) else group_id
      groups.append({"groupId": group_id, "groupName": group_name or group_id})

  if subject.get("groupId") or subject.get("groupName"):
    group_id = str(subject.get("groupId") or subject.get("groupName") or "").strip()
    group_name = str(subject.get("groupName") or subject.get("groupId") or "").strip()
    if group_id:
      groups.append({"groupId": group_id, "groupName": group_name or group_id})

  deduped = []
  seen = set()
  for group in groups:
    key = group["groupId"].lower()
    if key in seen:
      continue
    seen.add(key)
    deduped.append(group)
  return deduped


def collect_groups(table, limit: int = 0) -> Dict[Tuple[str, str], Dict[str, str]]:
  groups = {}
  for subject in scan_subjects(table, limit=limit):
    project_id = project_id_for_subject(subject)
    if not project_id:
      continue
    for group in extract_subject_groups(subject):
      key = (project_id, group["groupId"].lower())
      groups.setdefault(key, {
        "projectId": project_id,
        "groupId": group["groupId"],
        "groupName": group["groupName"],
      })
  return groups


def put_group(table, group: Dict[str, str], dry_run: bool):
  now = datetime.now(timezone.utc).isoformat()
  item = {
    "pk": f"PROJECT#{group['projectId']}",
    "sk": f"GROUP#{group['groupId']}",
    "entityType": "GROUP",
    "projectId": group["projectId"],
    "groupId": group["groupId"],
    "groupName": group["groupName"],
    "createdAt": now,
    "updatedAt": now,
  }

  if dry_run:
    print(f"DRY RUN create {item['pk']} {item['sk']} groupName={item['groupName']}")
    return "planned"

  try:
    table.put_item(
      Item=item,
      ConditionExpression="attribute_not_exists(pk) AND attribute_not_exists(sk)",
    )
    print(f"CREATED {item['pk']} {item['sk']} groupName={item['groupName']}")
    return "created"
  except ClientError as exc:
    if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
      return "skipped"
    raise


def main():
  args = parse_args()
  session = build_session(args.profile, args.region)
  dynamodb = session.resource("dynamodb", region_name=args.region)
  table = dynamodb.Table(args.table)

  groups = collect_groups(table, limit=args.limit)
  counts = {"planned": 0, "created": 0, "skipped": 0}

  for group in sorted(groups.values(), key=lambda item: (item["projectId"], item["groupName"].lower())):
    result = put_group(table, group, args.dry_run)
    counts[result] += 1

  print(
    f"Done. discovered={len(groups)} created={counts['created']} "
    f"planned={counts['planned']} skipped_existing={counts['skipped']} "
    f"mode={'dry-run' if args.dry_run else 'write'}"
  )


if __name__ == "__main__":
  main()
