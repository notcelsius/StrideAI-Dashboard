def _put_subject(client, project_id, subject_id, participant_name="Test User"):
    client.put_item(
        TableName="StrideAI",
        Item={
            "pk": {"S": f"PROJECT#{project_id}"},
            "sk": {"S": f"SUBJECT#{subject_id}"},
            "subjectId": {"S": subject_id},
            "participantName": {"S": participant_name},
            "status": {"S": "active"},
        },
    )


def _get_subject(client, project_id, subject_id):
    return client.get_item(
        TableName="StrideAI",
        Key={
            "pk": {"S": f"PROJECT#{project_id}"},
            "sk": {"S": f"SUBJECT#{subject_id}"},
        },
    ).get("Item")


def test_stamps_last_upload_when_subject_exists(ddb_client):
    from common import update_subject_last_upload

    _put_subject(ddb_client, "proj001", "TEST_001")
    ts = "2026-05-28T05:00:00+00:00"

    update_subject_last_upload("proj001", "TEST_001", ts)

    item = _get_subject(ddb_client, "proj001", "TEST_001")
    assert item["lastUploadAt"]["S"] == ts
    assert item["updatedAt"]["S"] == ts
    assert item["participantName"]["S"] == "Test User"


def test_noop_on_missing_args(ddb_client):
    from common import update_subject_last_upload

    _put_subject(ddb_client, "proj001", "TEST_001")
    ts = "2026-05-28T05:00:00+00:00"

    update_subject_last_upload("", "TEST_001", ts)
    update_subject_last_upload("proj001", "", ts)
    update_subject_last_upload("proj001", "TEST_001", "")
    update_subject_last_upload(None, None, None)

    item = _get_subject(ddb_client, "proj001", "TEST_001")
    assert "lastUploadAt" not in item


def test_condition_expression_blocks_phantom_row(ddb_client):
    from common import update_subject_last_upload

    update_subject_last_upload("proj001", "GHOST_DOES_NOT_EXIST", "2026-05-28T05:00:00+00:00")

    assert _get_subject(ddb_client, "proj001", "GHOST_DOES_NOT_EXIST") is None
