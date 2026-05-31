import json


def _staff_event(body=None, method="POST", path_parameters=None, query=None):
  return {
    "httpMethod": method,
    "body": json.dumps(body or {}),
    "pathParameters": path_parameters or {},
    "queryStringParameters": query or {},
    "requestContext": {
      "authorizer": {
        "claims": {
          "sub": "staff-sub-123",
          "cognito:groups": ["admin"],
          "email": "staff@example.com",
        }
      }
    },
  }


def _put_subject(client, project_id="proj_test", subject_id="SUB_001"):
  client.put_item(
    TableName="StrideAI",
    Item={
      "pk": {"S": f"PROJECT#{project_id}"},
      "sk": {"S": f"SUBJECT#{subject_id}"},
      "entityType": {"S": "SUBJECT"},
      "projectId": {"S": project_id},
      "subjectId": {"S": subject_id},
      "participantName": {"S": "Test Participant"},
      "status": {"S": "active"},
    },
  )


def test_create_and_list_project_groups(ddb_client):
  from list_project_groups import lambda_handler as list_groups
  from upsert_project_group import lambda_handler as upsert_group

  create_resp = upsert_group(_staff_event({"projectId": "proj_test", "groupName": "Control Group"}), None)
  assert create_resp["statusCode"] == 201
  created = json.loads(create_resp["body"])
  assert created["groupId"] == "control-group"
  assert created["groupName"] == "Control Group"

  list_resp = list_groups(_staff_event(method="GET", path_parameters={"projectId": "proj_test"}), None)
  assert list_resp["statusCode"] == 200
  body = json.loads(list_resp["body"])
  assert body["groups"] == [created]


def test_duplicate_group_name_is_rejected_within_project(ddb_client):
  from upsert_project_group import lambda_handler as upsert_group

  first_resp = upsert_group(_staff_event({"projectId": "proj_test", "groupName": "Control Group"}), None)
  assert first_resp["statusCode"] == 201

  duplicate_resp = upsert_group(_staff_event({"projectId": "proj_test", "groupName": "Control Group"}), None)
  assert duplicate_resp["statusCode"] == 409


def test_same_group_name_is_allowed_in_different_projects(ddb_client):
  from upsert_project_group import lambda_handler as upsert_group

  first_resp = upsert_group(_staff_event({"projectId": "proj_a", "groupName": "Control Group"}), None)
  second_resp = upsert_group(_staff_event({"projectId": "proj_b", "groupName": "Control Group"}), None)

  assert first_resp["statusCode"] == 201
  assert second_resp["statusCode"] == 201


def test_subject_assignment_requires_cataloged_group(ddb_client):
  from update_subject_groups import lambda_handler as update_groups

  _put_subject(ddb_client)

  resp = update_groups(
    _staff_event({
      "projectId": "proj_test",
      "subjectIds": ["SUB_001"],
      "groups": ["missing-group"],
      "mode": "replace",
    }),
    None,
  )

  assert resp["statusCode"] == 400
  assert "Unknown group" in json.loads(resp["body"])["error"]


def test_subject_assignment_uses_catalog_group_name(ddb_client):
  from update_subject_groups import lambda_handler as update_groups
  from upsert_project_group import lambda_handler as upsert_group

  _put_subject(ddb_client)
  upsert_group(_staff_event({"projectId": "proj_test", "groupName": "Control Group"}), None)

  resp = update_groups(
    _staff_event({
      "projectId": "proj_test",
      "subjectIds": ["SUB_001"],
      "groups": [{"groupId": "control-group", "groupName": "Wrong Name"}],
      "mode": "replace",
    }),
    None,
  )

  assert resp["statusCode"] == 200
  body = json.loads(resp["body"])
  assert body["subjects"][0]["groups"] == [{"groupId": "control-group", "groupName": "Control Group"}]


def test_renaming_group_updates_assigned_subject_group_names(ddb_client):
  from get_project_subjects import lambda_handler as get_subjects
  from update_subject_groups import lambda_handler as update_groups
  from upsert_project_group import lambda_handler as upsert_group

  _put_subject(ddb_client)
  upsert_group(_staff_event({"projectId": "proj_test", "groupName": "Control Group"}), None)
  update_groups(
    _staff_event({
      "projectId": "proj_test",
      "subjectIds": ["SUB_001"],
      "groups": ["control-group"],
      "mode": "replace",
    }),
    None,
  )

  rename_resp = upsert_group(
    _staff_event({
      "projectId": "proj_test",
      "groupId": "control-group",
      "groupName": "Baseline Group",
    }),
    None,
  )
  assert rename_resp["statusCode"] == 200

  subjects_resp = get_subjects(_staff_event(method="GET", path_parameters={"projectId": "proj_test"}), None)
  subject = json.loads(subjects_resp["body"])["subjects"][0]
  assert subject["groups"] == [{"groupId": "control-group", "groupName": "Baseline Group"}]


def test_archive_rejects_assigned_group(ddb_client):
  from archive_project_group import lambda_handler as archive_group
  from update_subject_groups import lambda_handler as update_groups
  from upsert_project_group import lambda_handler as upsert_group

  _put_subject(ddb_client)
  upsert_group(_staff_event({"projectId": "proj_test", "groupName": "Control Group"}), None)
  update_groups(
    _staff_event({
      "projectId": "proj_test",
      "subjectIds": ["SUB_001"],
      "groups": ["control-group"],
      "mode": "replace",
    }),
    None,
  )

  resp = archive_group(
    _staff_event(
      {"projectId": "proj_test"},
      method="DELETE",
      path_parameters={"groupId": "control-group"},
    ),
    None,
  )

  assert resp["statusCode"] == 409


def test_archive_hides_unassigned_group_from_default_list(ddb_client):
  from archive_project_group import lambda_handler as archive_group
  from list_project_groups import lambda_handler as list_groups
  from upsert_project_group import lambda_handler as upsert_group

  upsert_group(_staff_event({"projectId": "proj_test", "groupName": "Control Group"}), None)

  archive_resp = archive_group(
    _staff_event(
      {"projectId": "proj_test"},
      method="DELETE",
      path_parameters={"groupId": "control-group"},
    ),
    None,
  )
  assert archive_resp["statusCode"] == 200

  list_resp = list_groups(_staff_event(method="GET", path_parameters={"projectId": "proj_test"}), None)
  assert json.loads(list_resp["body"])["groups"] == []
