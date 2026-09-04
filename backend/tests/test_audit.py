"""The audit trail exists so a change can always be attributed.

The point of testing it separately is that it is written by a flush listener,
not by any endpoint: nothing in the request path mentions it, so nothing in the
request path can be read to confirm it works.
"""

from fastapi.testclient import TestClient

from app.enums import UserRole


def entries(client: TestClient, headers, **params) -> list[dict]:
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return client.get(f"/api/audit?{query}", headers=headers).json()["items"]


def test_creating_something_records_who_did_it(client: TestClient, auth_headers, admin) -> None:
    part = client.post("/api/parts", headers=auth_headers, json={"title": "Alternator"}).json()

    rows = entries(client, auth_headers, entity="Part", entity_id=part["id"])
    assert len(rows) == 1
    assert rows[0]["action"] == "created"
    assert rows[0]["user_name"] == admin.full_name
    assert rows[0]["label"] == part["sku"]
    assert rows[0]["changes"]["title"] == "Alternator"


def test_an_edit_records_both_sides_of_the_change(client: TestClient, auth_headers, admin) -> None:
    part = client.post("/api/parts", headers=auth_headers, json={"title": "Alternator"}).json()
    client.patch(f"/api/parts/{part['id']}", headers=auth_headers, json={"title": "Starter motor"})

    rows = entries(client, auth_headers, entity="Part", entity_id=part["id"])
    update = next(r for r in rows if r["action"] == "updated")
    assert update["changes"]["title"] == {"from": "Alternator", "to": "Starter motor"}


def test_who_collected_the_money_cannot_change_silently(
    client: TestClient, auth_headers, admin, make_user
) -> None:
    """The change this whole trail exists for."""
    other = make_user("kevin@example.com", role=UserRole.STAFF)
    part = client.post(
        "/api/parts", headers=auth_headers, json={"title": "Alternator", "status": "available"}
    ).json()
    sale = client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-09-01",
            "paid_on": "2026-09-01",
            "collected_by_id": admin.id,
            "items": [{"part_ids": [part["id"]], "unit_price": "500.00"}],
        },
    ).json()

    client.patch(
        f"/api/sales/{sale['id']}", headers=auth_headers, json={"collected_by_id": other.id}
    )

    rows = entries(client, auth_headers, entity="Sale", entity_id=sale["id"])
    update = next(r for r in rows if r["action"] == "updated")
    assert update["changes"]["collected_by_id"] == {"from": admin.id, "to": other.id}
    assert update["user_name"] == admin.full_name
    assert update["label"] == sale["reference"]


def test_voiding_is_recorded_as_a_change_not_a_disappearance(
    client: TestClient, auth_headers, admin
) -> None:
    part = client.post(
        "/api/parts", headers=auth_headers, json={"title": "Alternator", "status": "available"}
    ).json()
    sale = client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-09-01",
            "collected_by_id": admin.id,
            "items": [{"part_ids": [part["id"]], "unit_price": "85.00"}],
        },
    ).json()

    client.delete(f"/api/sales/{sale['id']}?reason=Mistake", headers=auth_headers)

    rows = entries(client, auth_headers, entity="Sale", entity_id=sale["id"])
    update = next(r for r in rows if r["action"] == "updated")
    assert update["changes"]["voided_at"]["to"] is not None
    assert update["changes"]["void_reason"]["to"] == "Mistake"


def test_the_trail_survives_the_account_being_removed(
    client: TestClient, auth_headers, admin, make_user
) -> None:
    staff = make_user("gone@example.com", role=UserRole.STAFF)
    token = client.post(
        "/api/auth/login", data={"username": "gone@example.com", "password": "password12345"}
    ).json()["access_token"]
    client.post(
        "/api/parts",
        headers={"Authorization": f"Bearer {token}"},
        json={"title": "Their part"},
    )

    client.delete(f"/api/users/{staff.id}", headers=auth_headers)

    rows = entries(client, auth_headers, entity="Part")
    theirs = next(r for r in rows if r["label"] and r["changes"].get("title") == "Their part")
    # The name is kept as text, so deleting the account does not erase who did it.
    assert theirs["user_name"] == staff.full_name


def test_staff_can_read_the_history_too(client: TestClient, auth_headers, make_user) -> None:
    make_user("staff3@example.com", role=UserRole.STAFF)
    token = client.post(
        "/api/auth/login", data={"username": "staff3@example.com", "password": "password12345"}
    ).json()["access_token"]

    assert client.get("/api/audit", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_viewers_cannot_read_the_history(client: TestClient, make_user) -> None:
    make_user("nosy@example.com", role=UserRole.VIEWER)
    token = client.post(
        "/api/auth/login", data={"username": "nosy@example.com", "password": "password12345"}
    ).json()["access_token"]

    assert client.get("/api/audit", headers={"Authorization": f"Bearer {token}"}).status_code == 403
