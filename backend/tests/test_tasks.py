"""The planner: what needs doing, who has it, and what it is about."""

from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.enums import UserRole

TODAY = date.today()
YESTERDAY = (TODAY - timedelta(days=1)).isoformat()
TOMORROW = (TODAY + timedelta(days=1)).isoformat()


def make(client: TestClient, headers, **body) -> dict:
    response = client.post("/api/tasks", headers=headers, json={"title": "Do a thing", **body})
    assert response.status_code == 201, response.text
    return response.json()


def titles(client: TestClient, headers, query: str = "") -> set[str]:
    return {t["title"] for t in client.get(f"/api/tasks?{query}", headers=headers).json()}


def test_a_task_can_sit_unassigned(client: TestClient, auth_headers) -> None:
    task = make(client, auth_headers, title="Photograph the alternator")

    assert task["assigned_to"] is None
    assert task["is_done"] is False
    # The shared pile is findable on its own.
    assert titles(client, auth_headers, "unassigned=true") == {"Photograph the alternator"}


def test_taking_a_task_on_and_finishing_it(client: TestClient, auth_headers, admin) -> None:
    task = make(client, auth_headers)

    taken = client.patch(
        f"/api/tasks/{task['id']}", headers=auth_headers, json={"assigned_to_id": admin.id}
    ).json()
    assert taken["assigned_to"]["id"] == admin.id

    done = client.patch(
        f"/api/tasks/{task['id']}", headers=auth_headers, json={"done": True}
    ).json()
    assert done["is_done"] is True
    # Who ticked it comes from the session, not the client.
    assert done["done_by"]["id"] == admin.id
    assert done["done_at"] is not None

    # A board shows what is left, so a finished task drops out by default.
    assert titles(client, auth_headers) == set()
    assert titles(client, auth_headers, "done=true") == {"Do a thing"}

    reopened = client.patch(
        f"/api/tasks/{task['id']}", headers=auth_headers, json={"done": False}
    ).json()
    assert reopened["is_done"] is False
    assert reopened["done_by"] is None


def test_a_task_knows_what_it_is_about(client: TestClient, auth_headers, admin) -> None:
    part = client.post(
        "/api/parts", headers=auth_headers, json={"title": "Alternator", "status": "available"}
    ).json()
    car = client.post(
        "/api/vehicles",
        headers=auth_headers,
        json={"nickname": "The blue one", "decode_vin": False},
    ).json()
    sale = client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": TODAY.isoformat(),
            "buyer_name": "Marketplace Mike",
            "collected_by_id": admin.id,
            "items": [{"part_ids": [part["id"]], "unit_price": "85.00"}],
        },
    ).json()

    on_part = make(client, auth_headers, title="Photos", part_id=part["id"])
    assert on_part["anchor"] == {
        "kind": "part",
        "id": part["id"],
        "label": f"{part['sku']} · Alternator",
    }

    on_sale = make(client, auth_headers, title="Pick and pack", sale_id=sale["id"])
    assert on_sale["anchor"]["kind"] == "sale"
    assert "Marketplace Mike" in on_sale["anchor"]["label"]

    on_car = make(client, auth_headers, title="Strip the interior", vehicle_id=car["id"])
    assert on_car["anchor"] == {"kind": "vehicle", "id": car["id"], "label": "The blue one"}

    # And each record can be asked for its own.
    assert titles(client, auth_headers, f"part_id={part['id']}") == {"Photos"}
    assert titles(client, auth_headers, f"sale_id={sale['id']}") == {"Pick and pack"}


def test_a_task_is_about_one_thing_at_most(client: TestClient, auth_headers) -> None:
    part = client.post("/api/parts", headers=auth_headers, json={"title": "Alternator"}).json()
    car = client.post("/api/vehicles", headers=auth_headers, json={"decode_vin": False}).json()

    response = client.post(
        "/api/tasks",
        headers=auth_headers,
        json={"title": "Confused", "part_id": part["id"], "vehicle_id": car["id"]},
    )
    assert response.status_code == 422


def test_deleting_a_part_takes_its_tasks(client: TestClient, auth_headers) -> None:
    part = client.post("/api/parts", headers=auth_headers, json={"title": "Alternator"}).json()
    make(client, auth_headers, title="Photos", part_id=part["id"])

    assert client.delete(f"/api/parts/{part['id']}", headers=auth_headers).status_code == 200
    assert titles(client, auth_headers) == set()


def test_overdue_is_yesterday_and_still_open(client: TestClient, auth_headers) -> None:
    late = make(client, auth_headers, title="Late", due_on=YESTERDAY)
    make(client, auth_headers, title="Soon", due_on=TOMORROW)
    make(client, auth_headers, title="Someday")

    by_title = {t["title"]: t for t in client.get("/api/tasks", headers=auth_headers).json()}
    assert by_title["Late"]["is_overdue"] is True
    assert by_title["Soon"]["is_overdue"] is False
    assert by_title["Someday"]["is_overdue"] is False

    # Finishing it stops it being late.
    client.patch(f"/api/tasks/{late['id']}", headers=auth_headers, json={"done": True})
    done = client.get(f"/api/tasks/{late['id']}", headers=auth_headers).json()
    assert done["is_overdue"] is False


def test_dated_work_sorts_before_undated(client: TestClient, auth_headers) -> None:
    make(client, auth_headers, title="No date")
    make(client, auth_headers, title="Tomorrow", due_on=TOMORROW)
    make(client, auth_headers, title="Yesterday", due_on=YESTERDAY)

    order = [t["title"] for t in client.get("/api/tasks", headers=auth_headers).json()]
    assert order == ["Yesterday", "Tomorrow", "No date"]


def test_a_board_shows_mine_plus_the_pile(
    client: TestClient, auth_headers, admin, make_user
) -> None:
    other = make_user("kev@example.com", role=UserRole.STAFF)
    make(client, auth_headers, title="Mine", assigned_to_id=admin.id)
    make(client, auth_headers, title="Theirs", assigned_to_id=other.id)
    make(client, auth_headers, title="Anyone's")

    assert titles(client, auth_headers, f"mine_or_free={admin.id}") == {"Mine", "Anyone's"}
    assert titles(client, auth_headers, f"assigned_to_id={other.id}") == {"Theirs"}


def test_a_viewer_cannot_raise_or_finish_tasks(client: TestClient, auth_headers, make_user) -> None:
    make_user("looker@example.com", role=UserRole.VIEWER)
    token = client.post(
        "/api/auth/login", data={"username": "looker@example.com", "password": "password12345"}
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    task = make(client, auth_headers)

    assert client.get("/api/tasks", headers=headers).status_code == 200
    assert client.post("/api/tasks", headers=headers, json={"title": "Nope"}).status_code == 403
    assert (
        client.patch(f"/api/tasks/{task['id']}", headers=headers, json={"done": True}).status_code
        == 403
    )


def test_tasks_are_audited(client: TestClient, auth_headers, admin) -> None:
    task = make(client, auth_headers, title="Photograph the alternator")
    client.patch(f"/api/tasks/{task['id']}", headers=auth_headers, json={"done": True})

    rows = client.get(
        f"/api/audit?entity=Task&entity_id={task['id']}", headers=auth_headers
    ).json()["items"]
    assert {r["action"] for r in rows} == {"created", "updated"}
    assert rows[0]["user_name"] == admin.full_name
