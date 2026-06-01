import json
from unittest.mock import patch


def _admin_event(body):
  return {
    "httpMethod": "POST",
    "body": json.dumps(body),
    "requestContext": {
      "authorizer": {
        "claims": {
          "sub": "admin-sub-123",
          "cognito:groups": ["admin"],
          "email": "admin@example.com",
        }
      }
    },
  }


def _patient_event(body):
  return {
    "httpMethod": "POST",
    "body": json.dumps(body),
    "requestContext": {
      "authorizer": {
        "claims": {"sub": "patient-sub-123"}
      }
    },
  }


def _put_project(client, project_id="proj_test"):
  client.put_item(
    TableName="StrideAI",
    Item={
      "pk": {"S": f"PROJECT#{project_id}"},
      "sk": {"S": "METADATA"},
      "projectId": {"S": project_id},
      "projectName": {"S": "Test Project"},
    },
  )


def _fake_ensure_pi_cognito_user(item):
  return item["email"], f"cognito-sub-{item['email']}"


def test_add_pi_creates_profile_with_project(ddb_client):
  _put_project(ddb_client, "proj_test")
  with patch("pi_requests.ensure_pi_cognito_user", side_effect=_fake_ensure_pi_cognito_user):
    from add_pi import lambda_handler
    resp = lambda_handler(_admin_event({"email": "pi@example.com", "name": "Dr Test", "projectId": "proj_test"}), None)
  assert resp["statusCode"] == 200
  body = json.loads(resp["body"])
  assert body["email"] == "pi@example.com"
  assert body["projectIds"] == ["proj_test"]
  assert body["cognitoSub"] == "cognito-sub-pi@example.com"

  profile = ddb_client.get_item(
    TableName="StrideAI",
    Key={"pk": {"S": "USER#cognito-sub-pi@example.com"}, "sk": {"S": "PROFILE"}},
  ).get("Item")
  assert profile is not None
  assert profile["role"]["S"] == "pi"
  assert profile["email"]["S"] == "pi@example.com"
  assert [v["S"] for v in profile["projectIds"]["L"]] == ["proj_test"]


def test_add_pi_appends_project_for_existing_pi(ddb_client):
  _put_project(ddb_client, "proj_a")
  _put_project(ddb_client, "proj_b")
  ddb_client.put_item(
    TableName="StrideAI",
    Item={
      "pk": {"S": "USER#cognito-sub-pi@example.com"},
      "sk": {"S": "PROFILE"},
      "role": {"S": "pi"},
      "email": {"S": "pi@example.com"},
      "projectIds": {"L": [{"S": "proj_a"}]},
    },
  )
  with patch("pi_requests.ensure_pi_cognito_user", side_effect=_fake_ensure_pi_cognito_user):
    from add_pi import lambda_handler
    resp = lambda_handler(_admin_event({"email": "pi@example.com", "name": "Dr Test", "projectId": "proj_b"}), None)
  assert resp["statusCode"] == 200
  body = json.loads(resp["body"])
  assert body["projectIds"] == ["proj_a", "proj_b"]


def test_add_pi_rejects_non_admin(ddb_client):
  _put_project(ddb_client, "proj_test")
  with patch("pi_requests.ensure_pi_cognito_user", side_effect=_fake_ensure_pi_cognito_user):
    from add_pi import lambda_handler
    resp = lambda_handler(_patient_event({"email": "pi@example.com", "name": "Dr Test", "projectId": "proj_test"}), None)
  assert resp["statusCode"] == 403


def test_add_pi_rejects_invalid_email(ddb_client):
  _put_project(ddb_client, "proj_test")
  with patch("pi_requests.ensure_pi_cognito_user", side_effect=_fake_ensure_pi_cognito_user):
    from add_pi import lambda_handler
    resp = lambda_handler(_admin_event({"email": "not-an-email", "name": "X", "projectId": "proj_test"}), None)
  assert resp["statusCode"] == 400


def test_add_pi_rejects_missing_project(ddb_client):
  with patch("pi_requests.ensure_pi_cognito_user", side_effect=_fake_ensure_pi_cognito_user):
    from add_pi import lambda_handler
    resp = lambda_handler(_admin_event({"email": "pi@example.com", "name": "X", "projectId": "does_not_exist"}), None)
  assert resp["statusCode"] == 404
