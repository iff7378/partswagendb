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
            "paid_on": "2026-08-15",
            "fulfilled_on": "2026-08-15",
            "collected_by_id": admin.id,
            "items": [{"part_ids": [part["id"]], "unit_price": "85.00", "quantity": 1}],
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
        "paid_on": "2026-08-15",
        "fulfilled_on": "2026-08-15",
        "collected_by_id": admin.id,
        "items": [{"part_ids": [part["id"]], "unit_price": "85.00"}],
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
            "paid_on": "2026-08-15",
            "fulfilled_on": "2026-08-15",
            "collected_by_id": admin.id,
            "items": [{"part_ids": [part["id"]], "unit_price": "85.00"}],
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
            "paid_on": "2026-08-15",
            "fulfilled_on": "2026-08-15",
            "collected_by_id": admin.id,
            "items": [{"unit_price": "10.00"}],
        },
    )
    assert response.status_code == 400


def _car(client: TestClient, auth_headers, **extra) -> dict:
    payload = {"make": "Volkswagen", "model": "Jetta", "decode_vin": False, **extra}
    return client.post("/api/vehicles", headers=auth_headers, json=payload).json()


def test_scrapping_a_car_records_revenue_against_it(
    client: TestClient, auth_headers, admin
) -> None:
    car = _car(client, auth_headers, nickname="The silver wagon")
    client.post(
        "/api/expenses",
        headers=auth_headers,
        json={
            "vehicle_id": car["id"],
            "description": "Bought the car",
            "amount": "400.00",
            "incurred_on": "2026-08-01",
            "paid_by_id": admin.id,
        },
    )

    sale = client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-08-20",
            "paid_on": "2026-08-20",
            "fulfilled_on": "2026-08-20",
            "channel": "scrap",
            "buyer_name": "Ace Metals",
            "collected_by_id": admin.id,
            "items": [{"vehicle_id": car["id"], "is_shell": True, "unit_price": "180.00"}],
        },
    )
    assert sale.status_code == 201, sale.text
    line = sale.json()["items"][0]
    # The description falls back to the car's own name, so the sale still reads
    # sensibly if the car is deleted later.
    assert "The silver wagon" in line["description"]
    assert line["vehicle_name"] == "The silver wagon"

    detail = client.get(f"/api/vehicles/{car['id']}", headers=auth_headers).json()
    assert detail["status"] == "scrapped"
    assert detail["scrap_revenue"] == "180.00"
    assert detail["total_revenue"] == "180.00"
    assert detail["profit"] == "-220.00"


def test_a_car_cannot_be_scrapped_twice(client: TestClient, auth_headers, admin) -> None:
    car = _car(client, auth_headers)
    payload = {
        "sold_on": "2026-08-20",
        "paid_on": "2026-08-20",
        "fulfilled_on": "2026-08-20",
        "collected_by_id": admin.id,
        "items": [{"vehicle_id": car["id"], "is_shell": True, "unit_price": "180.00"}],
    }

    assert client.post("/api/sales", headers=auth_headers, json=payload).status_code == 201
    assert client.post("/api/sales", headers=auth_headers, json=payload).status_code == 409


def test_voiding_a_scrap_sale_puts_the_car_back_to_stripped(
    client: TestClient, auth_headers, admin
) -> None:
    car = _car(client, auth_headers)
    sale = client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-08-20",
            "paid_on": "2026-08-20",
            "fulfilled_on": "2026-08-20",
            "collected_by_id": admin.id,
            "items": [{"vehicle_id": car["id"], "is_shell": True, "unit_price": "180.00"}],
        },
    ).json()

    assert client.delete(f"/api/sales/{sale['id']}", headers=auth_headers).status_code == 200
    detail = client.get(f"/api/vehicles/{car['id']}", headers=auth_headers).json()
    assert detail["status"] == "stripped"
    assert detail["scrap_revenue"] == "0.00"


def test_a_scrapped_shell_line_cannot_also_list_parts(
    client: TestClient, auth_headers, admin
) -> None:
    car = _car(client, auth_headers)
    part = client.post("/api/parts", headers=auth_headers, json={"title": "Alternator"}).json()

    response = client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-08-20",
            "paid_on": "2026-08-20",
            "fulfilled_on": "2026-08-20",
            "collected_by_id": admin.id,
            "items": [
                {
                    "vehicle_id": car["id"],
                    "is_shell": True,
                    "part_ids": [part["id"]],
                    "unit_price": "180.00",
                },
            ],
        },
    )
    assert response.status_code == 400


def test_scrap_revenue_is_separate_from_parts_revenue(
    client: TestClient, auth_headers, admin
) -> None:
    car = _car(client, auth_headers)
    part = client.post(
        "/api/parts",
        headers=auth_headers,
        json={"title": "Alternator", "status": "available", "vehicle_id": car["id"]},
    ).json()

    client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-08-18",
            "paid_on": "2026-08-18",
            "fulfilled_on": "2026-08-18",
            "collected_by_id": admin.id,
            "items": [
                {"part_ids": [part["id"]], "unit_price": "85.00"},
                {"vehicle_id": car["id"], "is_shell": True, "unit_price": "180.00"},
            ],
        },
    )

    detail = client.get(f"/api/vehicles/{car['id']}", headers=auth_headers).json()
    assert detail["total_revenue"] == "265.00"
    assert detail["scrap_revenue"] == "180.00"


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


def test_nickname_becomes_the_cars_display_name(client: TestClient, auth_headers) -> None:
    """People say "the silver wagon", not "2011 Volkswagen Jetta SportWagen"."""
    car = client.post(
        "/api/vehicles",
        headers=auth_headers,
        json={"year": 2011, "make": "VW", "model": "Jetta", "decode_vin": False},
    ).json()
    assert car["display_name"] == "2011 VW Jetta"

    named = client.patch(
        f"/api/vehicles/{car['id']}", headers=auth_headers, json={"nickname": "Silver wagon"}
    ).json()
    assert named["display_name"] == "Silver wagon"
    # The real description stays available for the car's own page.
    assert named["description"] == "2011 VW Jetta"


def test_a_vin_can_be_recorded_as_unknown(client: TestClient, auth_headers) -> None:
    car = client.post(
        "/api/vehicles",
        headers=auth_headers,
        json={"vin_unknown": True, "make": "VW", "decode_vin": False},
    ).json()
    assert car["vin"] is None
    assert car["vin_unknown"] is True


def test_marking_the_vin_unknown_clears_any_vin(client: TestClient, auth_headers) -> None:
    car = client.post(
        "/api/vehicles",
        headers=auth_headers,
        json={"vin": "3VWFE21C04M000001", "decode_vin": False},
    ).json()
    assert car["vin"] == "3VWFE21C04M000001"

    updated = client.patch(
        f"/api/vehicles/{car['id']}", headers=auth_headers, json={"vin_unknown": True}
    ).json()
    assert updated["vin"] is None
    assert updated["vin_unknown"] is True


def test_entering_a_vin_clears_the_unknown_flag(client: TestClient, auth_headers) -> None:
    car = client.post(
        "/api/vehicles", headers=auth_headers, json={"vin_unknown": True, "decode_vin": False}
    ).json()

    updated = client.patch(
        f"/api/vehicles/{car['id']}",
        headers=auth_headers,
        json={"vin": "3VWFE21C04M000001"},
    ).json()
    assert updated["vin"] == "3VWFE21C04M000001"
    assert updated["vin_unknown"] is False


def _part(client: TestClient, auth_headers, title: str, **extra) -> dict:
    return client.post("/api/parts", headers=auth_headers, json={"title": title, **extra}).json()


def test_a_lot_sells_several_parts_for_one_price(client: TestClient, auth_headers, admin) -> None:
    car = _car(client, auth_headers, nickname="The silver wagon")
    seats = _part(client, auth_headers, "Seats", vehicle_id=car["id"], status="available")
    dash = _part(client, auth_headers, "Dashboard", vehicle_id=car["id"], status="available")
    trim = _part(client, auth_headers, "Door cards", vehicle_id=car["id"])  # still a draft

    sale = client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-08-20",
            "paid_on": "2026-08-20",
            "fulfilled_on": "2026-08-20",
            "collected_by_id": admin.id,
            "items": [
                {
                    "part_ids": [seats["id"], dash["id"], trim["id"]],
                    "vehicle_id": car["id"],
                    "description": "Entire interior",
                    "unit_price": "400.00",
                }
            ],
        },
    )
    assert sale.status_code == 201, sale.text
    line = sale.json()["items"][0]
    assert line["description"] == "Entire interior"
    assert sorted(p["title"] for p in line["parts"]) == ["Dashboard", "Door cards", "Seats"]

    # Every part in the lot leaves stock, drafts included.
    for part in (seats, dash, trim):
        assert client.get(f"/api/parts/{part['id']}", headers=auth_headers).json()["status"] == (
            "sold"
        )

    # The lot is one line, so the car earns 400 once rather than once per part.
    detail = client.get(f"/api/vehicles/{car['id']}", headers=auth_headers).json()
    assert detail["total_revenue"] == "400.00"
    assert detail["scrap_revenue"] == "0.00"
    assert detail["status"] != "scrapped"


def test_a_lot_can_name_a_car_without_listing_parts(
    client: TestClient, auth_headers, admin
) -> None:
    car = _car(client, auth_headers, nickname="The silver wagon")

    sale = client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-08-20",
            "paid_on": "2026-08-20",
            "fulfilled_on": "2026-08-20",
            "collected_by_id": admin.id,
            "items": [
                {
                    "vehicle_id": car["id"],
                    "description": "All the interior trim",
                    "unit_price": "250.00",
                }
            ],
        },
    )
    assert sale.status_code == 201, sale.text

    detail = client.get(f"/api/vehicles/{car['id']}", headers=auth_headers).json()
    assert detail["total_revenue"] == "250.00"
    # Selling parts off a car is not the same as junking the shell.
    assert detail["status"] != "scrapped"
    assert detail["scrap_revenue"] == "0.00"


def test_a_part_cannot_be_marked_sold_by_hand(client: TestClient, auth_headers) -> None:
    part = _part(client, auth_headers, "Alternator", status="available")

    response = client.patch(
        f"/api/parts/{part['id']}", headers=auth_headers, json={"status": "sold"}
    )
    assert response.status_code == 409
    assert "Record a sale" in response.json()["detail"]


def test_a_part_on_a_sale_cannot_be_put_back_by_hand(
    client: TestClient, auth_headers, admin
) -> None:
    part = _part(client, auth_headers, "Alternator", status="available")
    client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-08-20",
            "paid_on": "2026-08-20",
            "fulfilled_on": "2026-08-20",
            "collected_by_id": admin.id,
            "items": [{"part_ids": [part["id"]], "unit_price": "85.00"}],
        },
    )

    response = client.patch(
        f"/api/parts/{part['id']}", headers=auth_headers, json={"status": "available"}
    )
    assert response.status_code == 409
    assert "Void or edit that sale" in response.json()["detail"]


def test_editing_a_sale_frees_dropped_parts_and_claims_new_ones(
    client: TestClient, auth_headers, admin
) -> None:
    kept = _part(client, auth_headers, "Alternator", status="available")
    dropped = _part(client, auth_headers, "Starter", status="available")
    added = _part(client, auth_headers, "Radiator", status="available")

    sale = client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-08-20",
            "paid_on": "2026-08-20",
            "fulfilled_on": "2026-08-20",
            "collected_by_id": admin.id,
            "items": [{"part_ids": [kept["id"], dropped["id"]], "unit_price": "150.00"}],
        },
    ).json()

    fixed = client.patch(
        f"/api/sales/{sale['id']}",
        headers=auth_headers,
        json={
            "items": [
                {
                    "part_ids": [kept["id"], added["id"]],
                    "description": "Alternator and radiator",
                    "unit_price": "170.00",
                }
            ]
        },
    )
    assert fixed.status_code == 200, fixed.text
    assert fixed.json()["subtotal"] == "170.00"

    def status_of(part: dict) -> str:
        return client.get(f"/api/parts/{part['id']}", headers=auth_headers).json()["status"]

    assert status_of(kept) == "sold"
    assert status_of(added) == "sold"
    assert status_of(dropped) == "available"


def test_a_part_cannot_be_on_two_sales(client: TestClient, auth_headers, admin) -> None:
    part = _part(client, auth_headers, "Alternator", status="available")
    payload = {
        "sold_on": "2026-08-20",
        "paid_on": "2026-08-20",
        "fulfilled_on": "2026-08-20",
        "collected_by_id": admin.id,
        "items": [{"part_ids": [part["id"]], "unit_price": "85.00"}],
    }

    first = client.post("/api/sales", headers=auth_headers, json=payload)
    assert first.status_code == 201
    second = client.post("/api/sales", headers=auth_headers, json=payload)
    assert second.status_code == 409
    assert first.json()["reference"] in second.json()["detail"]


def test_the_sellable_filter_includes_drafts_but_not_spoken_for_stock(
    client: TestClient, auth_headers, admin
) -> None:
    _part(client, auth_headers, "A draft")
    _part(client, auth_headers, "Available", status="available")
    _part(client, auth_headers, "Scrapped", status="scrapped")
    spoken_for = _part(client, auth_headers, "On a pending sale", status="available")
    client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-08-20",
            "collected_by_id": admin.id,
            "items": [{"part_ids": [spoken_for["id"]], "unit_price": "85.00"}],
        },
    )

    titles = {
        p["title"]
        for p in client.get("/api/parts?sellable=true", headers=auth_headers).json()["items"]
    }
    # Reserved on another sale is not sellable: offering it would only 409.
    assert titles == {"A draft", "Available"}


def test_missing_filter_picks_one_gap_at_a_time(client: TestClient, auth_headers) -> None:
    site = client.post(
        "/api/locations", headers=auth_headers, json={"name": "Shed A", "kind": "site"}
    ).json()
    _part(client, auth_headers, "No shelf", part_number="06A 906 461")
    _part(client, auth_headers, "No part number", location_id=site["id"])
    _part(client, auth_headers, "Sold already", status="scrapped", location_id=site["id"])

    def titles(query: str) -> set[str]:
        return {
            p["title"]
            for p in client.get(f"/api/parts?{query}", headers=auth_headers).json()["items"]
        }

    assert titles("missing=location") == {"No shelf"}
    assert titles("missing=part_number") == {"No part number"}
    # Nothing has a photo, but finished parts are not a to-do list.
    assert titles("missing=photo") == {"No shelf", "No part number"}


def test_missing_filter_rejects_an_unknown_gap(client: TestClient, auth_headers) -> None:
    assert client.get("/api/parts?missing=colour", headers=auth_headers).status_code == 422


def test_a_general_expense_stays_off_every_car(client: TestClient, auth_headers, admin) -> None:
    car = _car(client, auth_headers)
    for payload in (
        {"vehicle_id": car["id"], "description": "Bought the car", "amount": "400.00"},
        {"description": "Lunch on teardown day", "amount": "25.00", "category": "meals"},
        {"description": "Cutting discs", "amount": "40.00", "category": "supplies"},
    ):
        r = client.post(
            "/api/expenses",
            headers=auth_headers,
            json={"incurred_on": "2026-08-01", "paid_by_id": admin.id, **payload},
        )
        assert r.status_code == 201, r.text

    general = client.get("/api/expenses?general=true", headers=auth_headers).json()
    assert {e["description"] for e in general} == {"Lunch on teardown day", "Cutting discs"}

    # The car carries only its own costs, not the venture's overheads.
    detail = client.get(f"/api/vehicles/{car['id']}", headers=auth_headers).json()
    assert detail["total_expenses"] == "400.00"

    # But the ledger counts every penny either way.
    report = client.get(
        "/api/settle-up?period_start=2026-01-01&period_end=2026-12-31", headers=auth_headers
    ).json()
    assert report["total_expenses"] == "465.00"


def test_by_vehicle_report_matches_the_single_car_page(
    client: TestClient, auth_headers, admin
) -> None:
    car = _car(client, auth_headers, nickname="The silver wagon")
    part = _part(client, auth_headers, "Alternator", vehicle_id=car["id"], status="available")
    client.post(
        "/api/expenses",
        headers=auth_headers,
        json={
            "vehicle_id": car["id"],
            "description": "Bought the car",
            "amount": "400.00",
            "incurred_on": "2026-08-01",
            "paid_by_id": admin.id,
        },
    )
    client.post(
        "/api/expenses",
        headers=auth_headers,
        json={
            "description": "Lunch",
            "amount": "25.00",
            "incurred_on": "2026-08-01",
            "paid_by_id": admin.id,
        },
    )
    client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-08-20",
            "paid_on": "2026-08-20",
            "fulfilled_on": "2026-08-20",
            "collected_by_id": admin.id,
            "items": [
                {"part_ids": [part["id"]], "unit_price": "85.00"},
                {"vehicle_id": car["id"], "is_shell": True, "unit_price": "180.00"},
            ],
        },
    )

    report = client.get("/api/reports/by-vehicle", headers=auth_headers).json()
    row = next(v for v in report["vehicles"] if v["id"] == car["id"])
    single = client.get(f"/api/vehicles/{car['id']}", headers=auth_headers).json()

    for field in ("total_expenses", "total_revenue", "scrap_revenue", "profit"):
        assert row[field] == single[field], field
    assert row["display_name"] == "The silver wagon"
    assert row["parts_total"] == 1 and row["parts_sold"] == 1
    # Overheads sit outside the per-car rows.
    assert report["general_expenses"] == "25.00"


def test_a_lot_is_counted_once_in_the_by_vehicle_report(
    client: TestClient, auth_headers, admin
) -> None:
    car = _car(client, auth_headers)
    a = _part(client, auth_headers, "Seats", vehicle_id=car["id"], status="available")
    b = _part(client, auth_headers, "Dash", vehicle_id=car["id"], status="available")
    client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-08-20",
            "paid_on": "2026-08-20",
            "fulfilled_on": "2026-08-20",
            "collected_by_id": admin.id,
            "items": [{"part_ids": [a["id"], b["id"]], "unit_price": "400.00"}],
        },
    )

    report = client.get("/api/reports/by-vehicle", headers=auth_headers).json()
    row = next(v for v in report["vehicles"] if v["id"] == car["id"])
    assert row["total_revenue"] == "400.00"


def test_metrics_are_admin_only(client: TestClient, auth_headers, make_user) -> None:
    make_user("staff2@example.com", role=UserRole.STAFF)
    token = client.post(
        "/api/auth/login", data={"username": "staff2@example.com", "password": "password12345"}
    ).json()["access_token"]

    assert (
        client.get("/api/reports/metrics", headers={"Authorization": f"Bearer {token}"}).status_code
        == 403
    )
    assert client.get("/api/reports/metrics", headers=auth_headers).status_code == 200


def test_metrics_count_what_is_there(client: TestClient, auth_headers, admin) -> None:
    _car(client, auth_headers)
    _part(client, auth_headers, "Alternator", status="available")
    _part(client, auth_headers, "Starter")

    m = client.get("/api/reports/metrics", headers=auth_headers).json()
    assert m["parts_total"] == 2
    assert m["parts_by_status"] == {"available": 1, "draft": 1}
    assert m["vehicles_total"] == 1
    assert m["photos_total"] == 0 and m["photo_bytes"] == 0
    assert m["users_total"] >= 1


def _sale(client: TestClient, auth_headers, admin, **extra) -> dict:
    part = _part(client, auth_headers, "Alternator", status="available")
    body = {
        "sold_on": "2026-08-20",
        "collected_by_id": admin.id,
        "items": [{"part_ids": [part["id"]], "unit_price": "85.00"}],
        **extra,
    }
    response = client.post("/api/sales", headers=auth_headers, json=body)
    assert response.status_code == 201, response.text
    return {"sale": response.json(), "part": part}


def _status_of(client: TestClient, auth_headers, part: dict) -> str:
    return client.get(f"/api/parts/{part['id']}", headers=auth_headers).json()["status"]


def test_a_new_sale_is_pending_and_only_reserves_stock(
    client: TestClient, auth_headers, admin
) -> None:
    made = _sale(client, auth_headers, admin)

    assert made["sale"]["state"] == "pending"
    # Spoken for, but still on the shelf.
    assert _status_of(client, auth_headers, made["part"]) == "reserved"

    # Nothing is owed to anyone yet, because no money has landed.
    report = client.get(
        "/api/settle-up?period_start=2026-01-01&period_end=2026-12-31", headers=auth_headers
    ).json()
    assert report["total_revenue"] == "0.00"


def test_marking_a_sale_paid_puts_it_on_the_ledger(client: TestClient, auth_headers, admin) -> None:
    made = _sale(client, auth_headers, admin)

    updated = client.patch(
        f"/api/sales/{made['sale']['id']}", headers=auth_headers, json={"paid_on": "2026-08-22"}
    ).json()
    assert updated["state"] == "paid"

    report = client.get(
        "/api/settle-up?period_start=2026-01-01&period_end=2026-12-31", headers=auth_headers
    ).json()
    assert report["total_revenue"] == "85.00"

    # Paid for but not collected: the part has not left the shelf.
    assert _status_of(client, auth_headers, made["part"]) == "reserved"


def test_handover_is_what_takes_stock_away(client: TestClient, auth_headers, admin) -> None:
    made = _sale(client, auth_headers, admin)

    updated = client.patch(
        f"/api/sales/{made['sale']['id']}",
        headers=auth_headers,
        json={"fulfilled_on": "2026-08-21"},
    ).json()
    # Gone but still owed for.
    assert updated["state"] == "gone"
    assert _status_of(client, auth_headers, made["part"]) == "sold"

    report = client.get(
        "/api/settle-up?period_start=2026-01-01&period_end=2026-12-31", headers=auth_headers
    ).json()
    assert report["total_revenue"] == "0.00"


def test_a_sale_can_be_recorded_already_complete(client: TestClient, auth_headers, admin) -> None:
    made = _sale(client, auth_headers, admin, paid_on="2026-08-20", fulfilled_on="2026-08-20")
    assert made["sale"]["state"] == "complete"
    assert _status_of(client, auth_headers, made["part"]) == "sold"


def test_unmarking_handover_puts_the_part_back_on_the_shelf(
    client: TestClient, auth_headers, admin
) -> None:
    made = _sale(client, auth_headers, admin, fulfilled_on="2026-08-21")
    assert _status_of(client, auth_headers, made["part"]) == "sold"

    client.patch(
        f"/api/sales/{made['sale']['id']}", headers=auth_headers, json={"fulfilled_on": None}
    )
    # Back to reserved rather than available: the sale still stands.
    assert _status_of(client, auth_headers, made["part"]) == "reserved"


def test_a_reserved_part_cannot_be_sold_again(client: TestClient, auth_headers, admin) -> None:
    made = _sale(client, auth_headers, admin)

    second = client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-08-21",
            "collected_by_id": admin.id,
            "items": [{"part_ids": [made["part"]["id"]], "unit_price": "90.00"}],
        },
    )
    assert second.status_code == 409


def test_voiding_a_pending_sale_frees_the_part(client: TestClient, auth_headers, admin) -> None:
    made = _sale(client, auth_headers, admin)
    assert (
        client.delete(f"/api/sales/{made['sale']['id']}", headers=auth_headers).status_code == 200
    )
    assert _status_of(client, auth_headers, made["part"]) == "available"


def test_a_shell_only_scraps_the_car_once_it_has_gone(
    client: TestClient, auth_headers, admin
) -> None:
    car = _car(client, auth_headers)
    sale = client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-08-20",
            "collected_by_id": admin.id,
            "items": [{"vehicle_id": car["id"], "is_shell": True, "unit_price": "180.00"}],
        },
    ).json()

    def car_status() -> str:
        return client.get(f"/api/vehicles/{car['id']}", headers=auth_headers).json()["status"]

    # Agreed with the yard, but the shell is still on the property.
    assert car_status() != "scrapped"

    client.patch(
        f"/api/sales/{sale['id']}", headers=auth_headers, json={"fulfilled_on": "2026-08-25"}
    )
    assert car_status() == "scrapped"


def test_sales_can_be_filtered_by_state(client: TestClient, auth_headers, admin) -> None:
    _sale(client, auth_headers, admin)
    _sale(client, auth_headers, admin, paid_on="2026-08-20", fulfilled_on="2026-08-20")

    def refs(state: str) -> int:
        return client.get(f"/api/sales?state={state}", headers=auth_headers).json()["total"]

    assert refs("pending") == 1
    assert refs("complete") == 1
    assert refs("gone") == 0


def test_unpaid_sales_stay_out_of_a_cars_return(client: TestClient, auth_headers, admin) -> None:
    car = _car(client, auth_headers)
    part = _part(client, auth_headers, "Alternator", vehicle_id=car["id"], status="available")
    sale = client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-08-20",
            "collected_by_id": admin.id,
            "items": [{"part_ids": [part["id"]], "unit_price": "85.00"}],
        },
    ).json()

    def revenue() -> str:
        return client.get(f"/api/vehicles/{car['id']}", headers=auth_headers).json()[
            "total_revenue"
        ]

    assert revenue() == "0.00"
    client.patch(f"/api/sales/{sale['id']}", headers=auth_headers, json={"paid_on": "2026-08-22"})
    assert revenue() == "85.00"

    report = client.get("/api/reports/by-vehicle", headers=auth_headers).json()
    row = next(v for v in report["vehicles"] if v["id"] == car["id"])
    assert row["total_revenue"] == "85.00"
