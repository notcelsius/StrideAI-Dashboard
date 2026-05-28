#!/usr/bin/env python3
"""End-to-end smoke test for the PI onboarding flow.

Drives prod API Gateway through:
  POST /pi-requests (anonymous)
  GET  /admin/pi-requests (admin)
  POST /admin/pi-requests/{id}/approve (admin)
  GET  /projects (PI, scoped)
  GET  /projects/{id}/subjects (PI, 403 unassigned / 200 assigned)

Pre-creates the Cognito PI user with MessageAction=SUPPRESS to avoid sending
a real invitation email; the approve lambda then takes the find-existing
branch and still assigns the pi group + writes the PROFILE row.

Requires env: ADMIN_USERNAME, ADMIN_PASSWORD.

Prereq (one-time, not yet applied as of 2026-05-27): a Cognito app client on
the admin pool (us-east-2_1AOUqzUwA) must have ALLOW_ADMIN_USER_PASSWORD_AUTH
in its ExplicitAuthFlows. The current SPA client only supports OAuth. Either
add the flow to it or create a dedicated server-auth client; the script
auto-detects whichever one has the flow enabled.
"""

import argparse
import base64
import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Optional

import boto3
import requests

LAMBDAS_DIR = Path(__file__).resolve().parent.parent / "lambdas"
sys.path.insert(0, str(LAMBDAS_DIR))
from pi_requests import pi_request_id  # noqa: E402


DEFAULT_API_BASE_URL = "https://ny2twk3p4g.execute-api.us-east-2.amazonaws.com/prod"
DEFAULT_ADMIN_POOL_ID = "us-east-2_1AOUqzUwA"


class SmokeFailure(Exception):
  pass


def parse_args():
  parser = argparse.ArgumentParser(
    description="End-to-end smoke test for PI onboarding (request -> approve -> PI scope check).",
  )
  parser.add_argument("--api-base-url", default=os.environ.get("API_BASE_URL", DEFAULT_API_BASE_URL),
                      help="API Gateway base URL (default: prod)")
  parser.add_argument("--region", default="us-east-2")
  parser.add_argument("--table", default="StrideAI")
  parser.add_argument("--profile", default=None, help="Optional AWS profile name")
  parser.add_argument("--admin-pool-id", default=os.environ.get("ADMIN_POOL_ID", DEFAULT_ADMIN_POOL_ID))
  parser.add_argument("--admin-client-id", default=os.environ.get("ADMIN_CLIENT_ID"),
                      help="Cognito app client ID; auto-detected if absent")
  parser.add_argument("--assigned-project-id", default=None,
                      help="Project the test PI will be approved for (default: first available)")
  parser.add_argument("--unassigned-project-id", default=None,
                      help="Project the PI must NOT see (default: second available)")
  parser.add_argument("--email-domain", default="example.com",
                      help="Domain for test email (default: example.com, IANA reserved)")
  parser.add_argument("--keep", action="store_true",
                      help="Skip teardown on success")
  parser.add_argument("--verbose", action="store_true",
                      help="Print full HTTP response bodies")
  return parser.parse_args()


def build_session(profile: Optional[str], region: str):
  if profile:
    return boto3.Session(profile_name=profile, region_name=region)
  return boto3.Session(region_name=region)


def decode_jwt_payload(token: str) -> dict:
  payload_b64 = token.split(".")[1]
  payload_b64 += "=" * (-len(payload_b64) % 4)
  return json.loads(base64.urlsafe_b64decode(payload_b64).decode("utf-8"))


def resolve_admin_client_id(cognito, pool_id: str) -> str:
  resp = cognito.list_user_pool_clients(UserPoolId=pool_id, MaxResults=20)
  for client_summary in resp.get("UserPoolClients", []):
    client_id = client_summary["ClientId"]
    detail = cognito.describe_user_pool_client(UserPoolId=pool_id, ClientId=client_id)
    flows = detail["UserPoolClient"].get("ExplicitAuthFlows") or []
    if "ALLOW_ADMIN_USER_PASSWORD_AUTH" in flows or "ADMIN_NO_SRP_AUTH" in flows:
      return client_id
  raise SmokeFailure(
    f"No app client on pool {pool_id} has ADMIN_USER_PASSWORD_AUTH enabled; "
    "pass --admin-client-id or enable that flow on a client."
  )


def admin_initiate_auth(cognito, pool_id: str, client_id: str, username: str, password: str) -> str:
  resp = cognito.admin_initiate_auth(
    UserPoolId=pool_id,
    ClientId=client_id,
    AuthFlow="ADMIN_USER_PASSWORD_AUTH",
    AuthParameters={"USERNAME": username, "PASSWORD": password},
  )
  result = resp.get("AuthenticationResult") or {}
  if not result.get("IdToken"):
    raise SmokeFailure(
      f"admin_initiate_auth returned no IdToken (challenge={resp.get('ChallengeName')!r}) for {username}"
    )
  return result["IdToken"]


def http_get(url: str, token: Optional[str] = None, verbose: bool = False):
  headers = {}
  if token:
    headers["Authorization"] = f"Bearer {token}"
  r = requests.get(url, headers=headers, timeout=30)
  if verbose:
    print(f"  GET {url} -> {r.status_code}")
    print(f"  body: {r.text[:500]}")
  return r


def http_post(url: str, body=None, token: Optional[str] = None, verbose: bool = False):
  headers = {"Content-Type": "application/json"}
  if token:
    headers["Authorization"] = f"Bearer {token}"
  r = requests.post(url, json=body or {}, headers=headers, timeout=30)
  if verbose:
    print(f"  POST {url} -> {r.status_code}")
    print(f"  body: {r.text[:500]}")
  return r


def step(n: int, msg: str):
  print(f"[step {n}] {msg}")


def teardown(cognito, table, pool_id: str, username: str, sub: Optional[str], request_id: Optional[str]):
  errors = []
  try:
    cognito.admin_delete_user(UserPoolId=pool_id, Username=username)
    print(f"  deleted cognito user {username}")
  except Exception as exc:
    errors.append(f"cognito delete: {exc}")

  if sub:
    try:
      table.delete_item(Key={"pk": f"USER#{sub}", "sk": "PROFILE"})
      print(f"  deleted PROFILE for USER#{sub}")
    except Exception as exc:
      errors.append(f"profile delete: {exc}")

  if request_id:
    try:
      table.delete_item(Key={"pk": "PI_REQUESTS", "sk": f"REQUEST#{request_id}"})
      print(f"  deleted PI_REQUESTS / REQUEST#{request_id}")
    except Exception as exc:
      errors.append(f"request delete: {exc}")

  if errors:
    print(f"  teardown errors: {errors}", file=sys.stderr)


def main():
  args = parse_args()

  for var in ("ADMIN_USERNAME", "ADMIN_PASSWORD"):
    if not os.environ.get(var):
      print(f"ERROR: required env var {var} is not set.", file=sys.stderr)
      return 2

  session = build_session(args.profile, args.region)
  cognito = session.client("cognito-idp", region_name=args.region)
  ddb_resource = session.resource("dynamodb", region_name=args.region)
  table = ddb_resource.Table(args.table)

  api = args.api_base_url.rstrip("/")
  test_email = f"pi-smoke-{int(time.time())}@{args.email_domain}"
  test_password = f"PiSmoke!{uuid.uuid4().hex[:12]}Aa1"
  test_name = "PI Smoke Test"

  state = {"pi_sub": None, "request_id": None, "assigned": None, "unassigned": None}

  try:
    step(0, "admin auth + select two projects")
    client_id = args.admin_client_id or resolve_admin_client_id(cognito, args.admin_pool_id)
    admin_token = admin_initiate_auth(
      cognito, args.admin_pool_id, client_id,
      os.environ["ADMIN_USERNAME"], os.environ["ADMIN_PASSWORD"],
    )
    r = http_get(f"{api}/projects", token=admin_token, verbose=args.verbose)
    if r.status_code != 200:
      raise SmokeFailure(f"admin GET /projects returned {r.status_code}: {r.text}")
    projects = r.json().get("projects", [])
    if len(projects) < 2:
      raise SmokeFailure(
        f"need at least 2 projects; found {len(projects)}. "
        "create another via POST /admin/projects."
      )
    state["assigned"] = args.assigned_project_id or projects[0]["projectId"]
    state["unassigned"] = args.unassigned_project_id or next(
      p["projectId"] for p in projects if p["projectId"] != state["assigned"]
    )
    print(f"  admin auth OK; assigned={state['assigned']} unassigned={state['unassigned']} email={test_email}")

    step(1, "pre-create PI in cognito admin pool (MessageAction=SUPPRESS)")
    create_resp = cognito.admin_create_user(
      UserPoolId=args.admin_pool_id,
      Username=test_email,
      UserAttributes=[
        {"Name": "email", "Value": test_email},
        {"Name": "email_verified", "Value": "true"},
        {"Name": "name", "Value": test_name},
      ],
      MessageAction="SUPPRESS",
    )
    sub = next((a["Value"] for a in create_resp["User"].get("Attributes", []) if a["Name"] == "sub"), None)
    if not sub:
      raise SmokeFailure("created cognito user has no sub attribute")
    state["pi_sub"] = sub
    print(f"  cognito sub={sub}")

    step(2, "POST /pi-requests (anonymous)")
    r = http_post(
      f"{api}/pi-requests",
      body={"name": test_name, "email": test_email, "requestedProjectId": state["assigned"]},
      verbose=args.verbose,
    )
    if r.status_code not in (200, 201):
      raise SmokeFailure(f"POST /pi-requests returned {r.status_code}: {r.text}")
    request_id = r.json().get("requestId")
    if not request_id:
      raise SmokeFailure(f"response missing requestId: {r.text}")
    expected_id = pi_request_id(test_email, state["assigned"])
    if request_id != expected_id:
      raise SmokeFailure(f"requestId mismatch: got {request_id}, expected {expected_id}")
    state["request_id"] = request_id
    print(f"  requestId={request_id}")

    step(3, "GET /admin/pi-requests?status=pending (admin)")
    r = http_get(f"{api}/admin/pi-requests?status=pending", token=admin_token, verbose=args.verbose)
    if r.status_code != 200:
      raise SmokeFailure(f"admin list returned {r.status_code}: {r.text}")
    listed_ids = [item.get("requestId") for item in r.json().get("requests", [])]
    if request_id not in listed_ids:
      raise SmokeFailure(f"requestId {request_id} not in pending list (first 5 = {listed_ids[:5]})")

    step(4, f"POST /admin/pi-requests/{request_id}/approve (admin)")
    r = http_post(
      f"{api}/admin/pi-requests/{request_id}/approve",
      body={"projectId": state["assigned"]},
      token=admin_token, verbose=args.verbose,
    )
    if r.status_code != 200:
      raise SmokeFailure(f"approve returned {r.status_code}: {r.text}")
    approved = r.json()
    if approved.get("status") != "approved":
      raise SmokeFailure(f"approved.status is {approved.get('status')!r}")
    if approved.get("cognitoSub") != sub:
      raise SmokeFailure(f"approved.cognitoSub={approved.get('cognitoSub')!r}, expected {sub!r}")

    step(5, "verify USER#<sub>/PROFILE row")
    profile = table.get_item(Key={"pk": f"USER#{sub}", "sk": "PROFILE"}).get("Item")
    if not profile:
      raise SmokeFailure(f"PROFILE row missing for USER#{sub}")
    if profile.get("role") != "pi":
      raise SmokeFailure(f"PROFILE.role={profile.get('role')!r}, expected 'pi'")
    profile_pids = list(profile.get("projectIds") or [])
    if profile_pids != [state["assigned"]]:
      raise SmokeFailure(f"PROFILE.projectIds={profile_pids}, expected [{state['assigned']!r}]")
    if profile.get("email") != test_email:
      raise SmokeFailure(f"PROFILE.email={profile.get('email')!r}, expected {test_email!r}")
    print(f"  PROFILE OK (role=pi, projectIds={profile_pids})")

    step(6, "admin_set_user_password Permanent=True (so we can sign in as the PI)")
    cognito.admin_set_user_password(
      UserPoolId=args.admin_pool_id,
      Username=test_email,
      Password=test_password,
      Permanent=True,
    )

    step(7, "admin_initiate_auth as PI, verify cognito:groups includes 'pi'")
    pi_token = admin_initiate_auth(cognito, args.admin_pool_id, client_id, test_email, test_password)
    claims = decode_jwt_payload(pi_token)
    pi_groups = claims.get("cognito:groups") or []
    if isinstance(pi_groups, str):
      pi_groups = [g.strip() for g in pi_groups.split(",")]
    if "pi" not in [g.lower() for g in pi_groups]:
      raise SmokeFailure(f"PI IdToken cognito:groups does not include 'pi': {pi_groups}")
    if claims.get("sub") != sub:
      raise SmokeFailure(f"PI IdToken sub mismatch: token={claims.get('sub')!r} vs created={sub!r}")
    print(f"  PI auth OK; groups={pi_groups}")

    step(8, "GET /projects (PI) returns exactly the assigned project")
    r = http_get(f"{api}/projects", token=pi_token, verbose=args.verbose)
    if r.status_code != 200:
      raise SmokeFailure(f"PI GET /projects returned {r.status_code}: {r.text}")
    visible = [p.get("projectId") for p in (r.json().get("projects") or [])]
    if visible != [state["assigned"]]:
      raise SmokeFailure(f"PI sees projects {visible}, expected exactly [{state['assigned']!r}]")

    step(9, f"GET /projects/{state['unassigned']}/subjects (PI) returns 403")
    r = http_get(f"{api}/projects/{state['unassigned']}/subjects", token=pi_token, verbose=args.verbose)
    if r.status_code != 403:
      raise SmokeFailure(
        f"PI access to unassigned project returned {r.status_code}, expected 403: {r.text}"
      )

    step(10, f"GET /projects/{state['assigned']}/subjects (PI) returns 200")
    r = http_get(f"{api}/projects/{state['assigned']}/subjects", token=pi_token, verbose=args.verbose)
    if r.status_code != 200:
      raise SmokeFailure(f"PI access to assigned project returned {r.status_code}: {r.text}")
    body = r.json()
    if "subjects" not in body:
      raise SmokeFailure(f"response missing 'subjects' key: {body}")

    print(
      f"\nSMOKE TEST PASSED ✓ (assigned={state['assigned']}, "
      f"unassigned={state['unassigned']}, pi={test_email})"
    )

    if not args.keep:
      step(11, "teardown")
      teardown(cognito, table, args.admin_pool_id, test_email, sub, request_id)
    else:
      print(
        f"  --keep set: leaving cognito user {test_email}, PROFILE for {sub}, "
        f"and PI_REQUEST {request_id} in place"
      )
    return 0

  except SmokeFailure as exc:
    print(f"\nSMOKE TEST FAILED: {exc}", file=sys.stderr)
    print(
      f"  state: email={test_email}, sub={state['pi_sub']!r}, "
      f"request_id={state['request_id']!r}",
      file=sys.stderr,
    )
    print("  leaving state in place for inspection (re-run with --keep semantics)", file=sys.stderr)
    return 1
  except KeyboardInterrupt:
    print("\ninterrupted; state left in place.", file=sys.stderr)
    return 130


if __name__ == "__main__":
  sys.exit(main())
