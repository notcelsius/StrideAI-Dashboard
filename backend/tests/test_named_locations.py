import json


PATIENT_SUB = "patient-sub-loc"
STAFF_SUB = "staff-sub-loc"
PROJECT_ID = "proj_loc"
SUBJECT_ID = "SUB_LOC_1"


def _patient_event(body, sub=PATIENT_SUB, method="POST"):
  return {
    "httpMethod": method,
    "body": json.dumps(body),
    "pathParameters": {},
    "queryStringParameters": {},
    "requestContext": {"authorizer": {"claims": {"sub": sub}}},
  }


def _staff_read_event(path_parameters=None, query=None):
  return {
    "httpMethod": "GET",
    "body": None,
    "pathParameters": path_parameters or {},
    "queryStringParameters": query or {},
    "requestContext": {
      "authorizer": {
        "claims": {"sub": STAFF_SUB, "cognito:groups": ["admin"], "email": "staff@example.com"}
      }
    },
  }


def _self_read_event(sub=PATIENT_SUB):
  return {
    "httpMethod": "GET",
    "body": None,
    "pathParameters": {},
    "queryStringParameters": {},
    "requestContext": {"authorizer": {"claims": {"sub": sub}}},
  }


def _link_subject(client, user_sub=PATIENT_SUB, project_id=PROJECT_ID, subject_id=SUBJECT_ID):
  item = {
    "pk": {"S": f"PROJECT#{project_id}"},
    "sk": {"S": f"SUBJECT#{subject_id}"},
    "entityType": {"S": "SUBJECT"},
    "projectId": {"S": project_id},
    "subjectId": {"S": subject_id},
    "participantName": {"S": "Loc Patient"},
    "status": {"S": "active"},
  }
  if user_sub:
    item["userSub"] = {"S": user_sub}
  client.put_item(TableName="StrideAI", Item=item)


# --- write + staff read roundtrip -------------------------------------------

def test_write_then_staff_read_roundtrip(ddb_client):
  from upload_location_labels import lambda_handler as write
  from get_subject_locations import lambda_handler as read

  resp = write(
    _patient_event(
      [
        {"label": "Home", "latitude": 38.544, "longitude": -121.748, "createdDate": "2026-05-31T14:25:30Z"},
        {"label": "Clinic", "latitude": 38.550, "longitude": -121.750},
      ]
    ),
    None,
  )
  assert resp["statusCode"] == 200
  body = json.loads(resp["body"])
  assert body["upsertedCount"] == 2
  assert body["deletedCount"] == 0

  _link_subject(ddb_client)
  read_resp = read(_staff_read_event({"subjectId": SUBJECT_ID}, {"projectId": PROJECT_ID}), None)
  assert read_resp["statusCode"] == 200
  read_body = json.loads(read_resp["body"])
  assert read_body["subjectId"] == SUBJECT_ID
  assert read_body["projectId"] == PROJECT_ID

  labels = sorted(loc["label"] for loc in read_body["locations"])
  assert labels == ["Clinic", "Home"]
  home = next(loc for loc in read_body["locations"] if loc["label"] == "Home")
  # Decimals are serialized back to plain floats for the JSON response.
  assert home["latitude"] == 38.544
  assert home["longitude"] == -121.748
  assert home["id"]
  assert home["createdDate"] == "2026-05-31T14:25:30Z"


# --- rollout tolerance: legacy snapshots (no id) -----------------------------

def test_legacy_reupload_is_idempotent(ddb_client):
  from upload_location_labels import lambda_handler as write
  from common import query_user_locations

  payload = [{"label": "Home", "latitude": 38.544, "longitude": -121.748}]
  write(_patient_event(payload), None)
  write(_patient_event(payload), None)

  locations = query_user_locations(PATIENT_SUB)
  assert len(locations) == 1


# --- stable id enables rename in place --------------------------------------

def test_explicit_id_rename_updates_in_place(ddb_client):
  from upload_location_labels import lambda_handler as write
  from common import query_user_locations

  write(_patient_event([{"id": "loc-1", "label": "Home", "latitude": 38.544, "longitude": -121.748}]), None)
  write(_patient_event([{"id": "loc-1", "label": "House", "latitude": 38.544, "longitude": -121.748}]), None)

  locations = query_user_locations(PATIENT_SUB)
  assert len(locations) == 1
  assert locations[0]["label"] == "House"


# --- soft delete is a hidden tombstone --------------------------------------

def test_soft_delete_hidden_from_reads(ddb_client):
  from upload_location_labels import lambda_handler as write
  from common import query_user_locations

  write(_patient_event([{"id": "loc-1", "label": "Home", "latitude": 38.544, "longitude": -121.748}]), None)
  resp = write(
    _patient_event([{"id": "loc-1", "label": "Home", "latitude": 38.544, "longitude": -121.748, "deleted": True}]),
    None,
  )
  body = json.loads(resp["body"])
  assert body["deletedCount"] == 1
  assert body["upsertedCount"] == 0

  assert query_user_locations(PATIENT_SUB) == []
  assert len(query_user_locations(PATIENT_SUB, include_deleted=True)) == 1


# --- validation --------------------------------------------------------------

def test_rejects_invalid_payloads(ddb_client):
  from upload_location_labels import lambda_handler as write

  assert write(_patient_event([{"latitude": 1, "longitude": 2}]), None)["statusCode"] == 400  # no label
  assert write(_patient_event([{"label": "X", "latitude": 200, "longitude": 2}]), None)["statusCode"] == 400  # lat OOB
  assert write(_patient_event([{"label": "X", "latitude": "abc", "longitude": 2}]), None)["statusCode"] == 400  # NaN
  assert write(_patient_event([]), None)["statusCode"] == 400  # empty
  assert write({"httpMethod": "POST", "body": None, "requestContext": {}}, None)["statusCode"] == 401  # no sub


# --- self read (multi-device sync) ------------------------------------------

def test_self_read_returns_own_labels(ddb_client):
  from upload_location_labels import lambda_handler as write
  from get_subject_locations import lambda_handler as read

  write(_patient_event([{"label": "Home", "latitude": 38.544, "longitude": -121.748}]), None)
  resp = read(_self_read_event(), None)
  assert resp["statusCode"] == 200
  body = json.loads(resp["body"])
  assert [loc["label"] for loc in body["locations"]] == ["Home"]
  assert "subjectId" not in body


# --- a subject with no linked user reads empty, not an error ----------------

def test_read_unlinked_subject_returns_empty(ddb_client):
  from get_subject_locations import lambda_handler as read

  _link_subject(ddb_client, user_sub="")  # subject exists but unlinked
  resp = read(_staff_read_event({"subjectId": SUBJECT_ID}, {"projectId": PROJECT_ID}), None)
  assert resp["statusCode"] == 200
  assert json.loads(resp["body"])["locations"] == []
