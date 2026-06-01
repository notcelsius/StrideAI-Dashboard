from common import resolve_role


def test_admin_role():
    assert resolve_role({"cognito:groups": ["admin"]}) == "admin"


def test_pi_role():
    assert resolve_role({"cognito:groups": ["pi"]}) == "pi"


def test_coordinator_role():
    assert resolve_role({"cognito:groups": ["coordinator"]}) == "coordinator"


def test_patient_role():
    assert resolve_role({"cognito:groups": ["patient"]}) == "patient"


def test_no_groups_defaults_to_user():
    assert resolve_role({}) == "user"


def test_empty_groups_defaults_to_user():
    assert resolve_role({"cognito:groups": []}) == "user"


def test_unknown_group_defaults_to_user():
    assert resolve_role({"cognito:groups": ["random-group"]}) == "user"


def test_admin_wins_over_pi():
    assert resolve_role({"cognito:groups": ["pi", "admin"]}) == "admin"


def test_csv_string_groups():
    assert resolve_role({"cognito:groups": "admin,pi"}) == "admin"


def test_case_insensitive_admin():
    assert resolve_role({"cognito:groups": ["ADMIN"]}) == "admin"
