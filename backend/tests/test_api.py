from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.enums import UserRole


def test_health_needs_no_auth(client: TestClient) -> None:
    assert client.get("/api/health").json()["status"] == "ok"


def test_protected_route_rejects_anonymous(client: TestClient) -> None:
    assert client.get("/api/parts").status_code == 401


def test_login_rejects_a_bad_password(client: TestClient, admin) -> None:
    response = client.post(
        "/api/auth/login", data={"username": admin.email, "password": "wrong-password"}
    )
    assert response.status_code == 401


def test_login_rejects_a_disabled_account(client: TestClient, db: Session, admin) -> None:
    admin.is_active = False
    db.commit()

    response = client.post(
        "/api/auth/login", data={"username": admin.email, "password": "password12345"}
    )
    assert response.status_code == 403


def test_refresh_token_cannot_be_used_as_an_access_token(client: TestClient, admin) -> None:
    tokens = client.post(
        "/api/auth/login", data={"username": admin.email, "password": "password12345"}
    ).json()

    response = client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {tokens['refresh_token']}"}
    )
    assert response.status_code == 401


def test_viewer_cannot_write(client: TestClient, make_user) -> None:
    make_user("viewer@example.com", role=UserRole.VIEWER)
    token = client.post(
        "/api/auth/login", data={"username": "viewer@example.com", "password": "password12345"}
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    assert client.get("/api/parts", headers=headers).status_code == 200
    assert (
        client.post("/api/parts", headers=headers, json={"title": "Alternator"}).status_code == 403
    )


def test_only_admins_create_users(client: TestClient, make_user) -> None:
    make_user("staff@example.com", role=UserRole.STAFF)
    token = client.post(
        "/api/auth/login", data={"username": "staff@example.com", "password": "password12345"}
    ).json()["access_token"]

    response = client.post(
        "/api/users",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "email": "new@example.com",
            "full_name": "New Person",
            "password": "password12345",
        },
    )
    assert response.status_code == 403


def test_part_lifecycle(client: TestClient, auth_headers) -> None:
    created = client.post(
        "/api/parts",
        headers=auth_headers,
        json={"title": "Alternator", "condition": "b", "tags": ["tested"]},
    )
    assert created.status_code == 201, created.text
    part = created.json()

    assert part["sku"] == "P-000001"
    assert part["status"] == "draft"
    # No category, location or price yet, so it is not ready to list.
    assert part["is_complete"] is False
    assert [t["name"] for t in part["tags"]] == ["tested"]

    found = client.get(f"/api/parts/by-sku/{part['sku']}", headers=auth_headers)
    assert found.status_code == 200
    assert found.json()["id"] == part["id"]


def test_skus_increment(client: TestClient, auth_headers) -> None:
    skus = [
        client.post("/api/parts", headers=auth_headers, json={"title": f"Part {i}"}).json()["sku"]
        for i in range(3)
    ]
    assert skus == ["P-000001", "P-000002", "P-000003"]


def test_part_rejects_a_missing_reference(client: TestClient, auth_headers) -> None:
    response = client.post(
        "/api/parts", headers=auth_headers, json={"title": "Alternator", "vehicle_id": 999}
    )
    assert response.status_code == 400
    assert "Vehicle 999" in response.json()["detail"]


def test_needs_details_filter_finds_incomplete_parts(client: TestClient, auth_headers) -> None:
    client.post("/api/parts", headers=auth_headers, json={"title": "Draft part"})

    response = client.get("/api/parts?needs_details=true", headers=auth_headers)
    assert response.json()["total"] == 1


def test_location_tree_builds_paths(client: TestClient, auth_headers) -> None:
    site = client.post(
        "/api/locations", headers=auth_headers, json={"name": "Shed A", "kind": "site"}
    ).json()
    shelf = client.post(
        "/api/locations",
        headers=auth_headers,
        json={"name": "Rack 3", "kind": "shelf", "parent_id": site["id"]},
    ).json()

    assert site["code"] == "SHED-A"
    assert shelf["code"] == "SHED-A-RACK-3"
    assert shelf["path"] == "Shed A / Rack 3"

    tree = client.get("/api/locations/tree", headers=auth_headers).json()
    assert len(tree) == 1
    assert tree[0]["children"][0]["name"] == "Rack 3"


def test_renaming_a_location_rewrites_child_paths(client: TestClient, auth_headers) -> None:
    site = client.post(
        "/api/locations", headers=auth_headers, json={"name": "Shed A", "kind": "site"}
    ).json()
    shelf = client.post(
        "/api/locations",
        headers=auth_headers,
        json={"name": "Rack 3", "kind": "shelf", "parent_id": site["id"]},
    ).json()

    client.patch(f"/api/locations/{site['id']}", headers=auth_headers, json={"name": "Barn"})

    updated = client.get("/api/locations", headers=auth_headers).json()
    child = next(loc for loc in updated if loc["id"] == shelf["id"])
    assert child["path"] == "Barn / Rack 3"


def test_location_cannot_be_nested_inside_itself(client: TestClient, auth_headers) -> None:
    site = client.post(
        "/api/locations", headers=auth_headers, json={"name": "Shed A", "kind": "site"}
    ).json()
    shelf = client.post(
        "/api/locations",
        headers=auth_headers,
        json={"name": "Rack 3", "kind": "shelf", "parent_id": site["id"]},
    ).json()

    response = client.patch(
        f"/api/locations/{site['id']}", headers=auth_headers, json={"parent_id": shelf["id"]}
    )
    assert response.status_code == 400


def test_location_in_use_cannot_be_deleted(client: TestClient, auth_headers) -> None:
    site = client.post(
        "/api/locations", headers=auth_headers, json={"name": "Shed A", "kind": "site"}
    ).json()
    client.post(
        "/api/parts", headers=auth_headers, json={"title": "Alternator", "location_id": site["id"]}
    )

    response = client.delete(f"/api/locations/{site['id']}", headers=auth_headers)
    assert response.status_code == 409


def test_moving_a_part_by_scanned_code(client: TestClient, auth_headers) -> None:
    site = client.post(
        "/api/locations", headers=auth_headers, json={"name": "Shed A", "kind": "site"}
    ).json()
    part = client.post("/api/parts", headers=auth_headers, json={"title": "Alternator"}).json()

    response = client.post(
        f"/api/parts/{part['id']}/move", headers=auth_headers, json={"location_code": site["code"]}
    )
    assert response.status_code == 200
    assert response.json()["location"]["id"] == site["id"]


def test_moving_to_an_unknown_code_fails(client: TestClient, auth_headers) -> None:
    part = client.post("/api/parts", headers=auth_headers, json={"title": "Alternator"}).json()

    response = client.post(
        f"/api/parts/{part['id']}/move", headers=auth_headers, json={"location_code": "NOPE"}
    )
    assert response.status_code == 404


def test_selling_a_part_marks_it_sold(client: TestClient, auth_headers, admin) -> None:
    part = client.post(
        "/api/parts",
        headers=auth_headers,
        json={"title": "Alternator", "status": "available", "asking_price": "85.00"},
    ).json()

    sale = client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-08-15",
            "collected_by_id": admin.id,
            "items": [{"part_id": part["id"], "unit_price": "85.00", "quantity": 1}],
        },
    )
    assert sale.status_code == 201, sale.text
    body = sale.json()
    assert body["reference"].startswith("S")
    assert body["subtotal"] == "85.00"

    refreshed = client.get(f"/api/parts/{part['id']}", headers=auth_headers).json()
    assert refreshed["status"] == "sold"


def test_a_part_cannot_be_sold_twice(client: TestClient, auth_headers, admin) -> None:
    part = client.post(
        "/api/parts", headers=auth_headers, json={"title": "Alternator", "status": "available"}
    ).json()
    payload = {
        "sold_on": "2026-08-15",
        "collected_by_id": admin.id,
        "items": [{"part_id": part["id"], "unit_price": "85.00"}],
    }

    assert client.post("/api/sales", headers=auth_headers, json=payload).status_code == 201
    second = client.post("/api/sales", headers=auth_headers, json=payload)
    assert second.status_code == 409


def test_voiding_a_sale_returns_the_part_to_stock(client: TestClient, auth_headers, admin) -> None:
    part = client.post(
        "/api/parts", headers=auth_headers, json={"title": "Alternator", "status": "available"}
    ).json()
    sale = client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-08-15",
            "collected_by_id": admin.id,
            "items": [{"part_id": part["id"], "unit_price": "85.00"}],
        },
    ).json()

    assert client.delete(f"/api/sales/{sale['id']}", headers=auth_headers).status_code == 200
    refreshed = client.get(f"/api/parts/{part['id']}", headers=auth_headers).json()
    assert refreshed["status"] == "available"


def test_sale_line_needs_a_part_or_a_description(client: TestClient, auth_headers, admin) -> None:
    response = client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-08-15",
            "collected_by_id": admin.id,
            "items": [{"unit_price": "10.00"}],
        },
    )
    assert response.status_code == 400


def test_settle_up_rejects_a_backwards_period(client: TestClient, auth_headers) -> None:
    response = client.get(
        "/api/settle-up?period_start=2026-09-30&period_end=2026-07-01", headers=auth_headers
    )
    assert response.status_code == 400


def test_settlement_between_the_same_person_is_rejected(
    client: TestClient, auth_headers, admin
) -> None:
    response = client.post(
        "/api/settlements",
        headers=auth_headers,
        json={
            "period_start": "2026-07-01",
            "period_end": "2026-09-30",
            "paid_on": "2026-09-30",
            "from_user_id": admin.id,
            "to_user_id": admin.id,
            "amount": "100.00",
        },
    )
    assert response.status_code == 400


def test_vehicle_vin_must_be_valid(client: TestClient, auth_headers) -> None:
    response = client.post("/api/vehicles", headers=auth_headers, json={"vin": "TOOSHORT"})
    assert response.status_code == 422


def test_duplicate_vin_is_rejected(client: TestClient, auth_headers) -> None:
    payload = {"vin": "3VWFE21C04M000001", "decode_vin": False}

    assert client.post("/api/vehicles", headers=auth_headers, json=payload).status_code == 201
    duplicate = client.post("/api/vehicles", headers=auth_headers, json=payload)
    assert duplicate.status_code == 409


def test_listing_export_returns_csv(client: TestClient, auth_headers) -> None:
    client.post(
        "/api/parts",
        headers=auth_headers,
        json={"title": "Alternator", "status": "available", "asking_price": "85.00"},
    )

    response = client.get("/api/exports/listings", headers=auth_headers)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "Alternator" in response.text


def test_dashboard_counts_inventory(client: TestClient, auth_headers) -> None:
    client.post("/api/parts", headers=auth_headers, json={"title": "Draft"})
    client.post(
        "/api/parts",
        headers=auth_headers,
        json={"title": "Listed", "status": "available", "asking_price": "50.00"},
    )

    stats = client.get("/api/dashboard", headers=auth_headers).json()
    assert stats["parts_total"] == 2
    assert stats["parts_draft"] == 1
    assert stats["parts_available"] == 1
    assert stats["inventory_asking_value"] == "50.00"


def test_deleting_a_part_removes_its_photos_from_object_storage(
    client: TestClient, db: Session, auth_headers, monkeypatch
) -> None:
    """The photo rows cascade away with the part, but object storage does not
    know that, so the files must be deleted explicitly or they are orphaned."""
    from app.api import parts as parts_api
    from app.models import Photo

    deleted: list[str] = []
    monkeypatch.setattr(parts_api, "delete_object", deleted.append)

    part = client.post("/api/parts", headers=auth_headers, json={"title": "Alternator"}).json()
    db.add(
        Photo(
            part_id=part["id"],
            object_key="parts/1/abc.jpg",
            thumbnail_key="parts/1/abc_thumb.jpg",
            content_type="image/jpeg",
            size_bytes=123,
        )
    )
    db.commit()

    assert client.delete(f"/api/parts/{part['id']}", headers=auth_headers).status_code == 200
    assert sorted(deleted) == ["parts/1/abc.jpg", "parts/1/abc_thumb.jpg"]


def test_aging_filter_only_returns_parts_past_their_own_threshold(
    client: TestClient, db: Session, auth_headers
) -> None:
    from datetime import UTC, datetime, timedelta

    from app.models import Part

    now = datetime.now(UTC)
    db.add_all(
        [
            Part(
                sku="P-OLD",
                title="Overdue",
                age_alert_days=30,
                status="available",
                created_at=now - timedelta(days=45),
            ),
            Part(
                sku="P-NEW",
                title="Fresh",
                age_alert_days=30,
                status="available",
                created_at=now - timedelta(days=5),
            ),
            Part(
                sku="P-NONE",
                title="No threshold",
                status="available",
                created_at=now - timedelta(days=900),
            ),
            Part(
                sku="P-SOLD",
                title="Old but sold",
                age_alert_days=30,
                status="sold",
                created_at=now - timedelta(days=99),
            ),
        ]
    )
    db.commit()

    body = client.get("/api/parts?aging=true", headers=auth_headers).json()
    assert [p["sku"] for p in body["items"]] == ["P-OLD"]


def test_parts_can_be_sorted(client: TestClient, auth_headers) -> None:
    for title in ("Banana", "Apple"):
        client.post("/api/parts", headers=auth_headers, json={"title": title})

    ordered = client.get("/api/parts?sort=title", headers=auth_headers).json()
    assert [p["title"] for p in ordered["items"]] == ["Apple", "Banana"]


def test_part_exposes_its_age(client: TestClient, auth_headers) -> None:
    part = client.post(
        "/api/parts", headers=auth_headers, json={"title": "Alternator", "age_alert_days": 30}
    ).json()
    assert part["days_in_stock"] == 0
    assert part["is_overdue"] is False
