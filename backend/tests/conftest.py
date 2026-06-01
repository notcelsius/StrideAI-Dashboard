import os
import sys
from pathlib import Path

os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("AWS_SESSION_TOKEN", "testing")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-2")
os.environ.setdefault("AWS_REGION", "us-east-2")
os.environ.setdefault("TABLE_NAME", "StrideAI")
os.environ.setdefault("BUCKET_NAME", "stride-ai-s3")

LAMBDAS_DIR = Path(__file__).resolve().parent.parent / "lambdas"
sys.path.insert(0, str(LAMBDAS_DIR))

import boto3
import pytest
from moto import mock_aws


@pytest.fixture
def ddb_client():
    with mock_aws():
        client = boto3.client("dynamodb", region_name="us-east-2")
        client.create_table(
            TableName="StrideAI",
            KeySchema=[
                {"AttributeName": "pk", "KeyType": "HASH"},
                {"AttributeName": "sk", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "pk", "AttributeType": "S"},
                {"AttributeName": "sk", "AttributeType": "S"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        yield client
