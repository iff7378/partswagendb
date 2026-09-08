"""Recording where a part is advertised, and closing those adverts off."""

from fastapi.testclient import TestClient


def _part(client: TestClient, headers, title: str = "Alternator", **extra) -> dict:
    return client.post("/api/parts", headers=headers, json={"title": title, **extra}).json()


def test_listing_routes_are_not_swallowed_by_the_part_id_route(
    client: TestClient, auth_headers
) -> None:
    # /parts/listings/{id} is declared before /parts/{part_id} for a reason.
    response = client.patch("/api/parts/listings/999", headers=auth_headers, json={})
    assert response.status_code == 404  # not 422 from parsing "listings" as an id


def test_a_part_can_be_listed_in_several_places(client: TestClient, auth_headers) -> None:
    part = _part(client, auth_headers, status="available")

    for channel, account in (("facebook", "BigGayDiesel"), ("ebay", "bgd_parts")):
        created = client.post(
            f"/api/parts/{part['id']}/listings",
            headers=auth_headers,
            json={
                "channel": channel,
                "account": account,
                "url": f"https://{channel}.example/item/1",
            },
        )
        assert created.status_code == 201, created.text
        assert created.json()["is_live"] is True
        # Defaults to today rather than making someone type it.
        assert created.json()["posted_on"] is not None

    detail = client.get(f"/api/parts/{part['id']}", headers=auth_headers).json()
    assert len(detail["listings"]) == 2
    assert {listing["channel"] for listing in detail["listings"]} == {"facebook", "ebay"}
    assert {listing["account"] for listing in detail["listings"]} == {
        "BigGayDiesel",
        "bgd_parts",
    }


def test_taking_a_listing_down_keeps_it(client: TestClient, auth_headers) -> None:
    part = _part(client, auth_headers, status="available")
    listing = client.post(
        f"/api/parts/{part['id']}/listings",
        headers=auth_headers,
        json={"channel": "facebook"},
    ).json()

    closed = client.patch(
        f"/api/parts/listings/{listing['id']}",
        headers=auth_headers,
        json={"removed_on": "2026-09-07"},
    ).json()
    assert closed["is_live"] is False
    assert closed["removed_on"] == "2026-09-07"

    # Still on the part: where it was advertised is worth remembering.
    detail = client.get(f"/api/parts/{part['id']}", headers=auth_headers).json()
    assert len(detail["listings"]) == 1


def test_a_sold_part_with_a_live_advert_is_flagged(client: TestClient, auth_headers, admin) -> None:
    part = _part(client, auth_headers, "Alternator", status="available")
    other = _part(client, auth_headers, "Still for sale", status="available")
    for p in (part, other):
        client.post(
            f"/api/parts/{p['id']}/listings",
            headers=auth_headers,
            json={"channel": "facebook", "account": "BigGayDiesel"},
        )

    assert client.get("/api/reports/stale-listings", headers=auth_headers).json() == []

    client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-09-07",
            "fulfilled_on": "2026-09-07",
            "collected_by_id": admin.id,
            "items": [{"part_ids": [part["id"]], "unit_price": "85.00"}],
        },
    )

    stale = client.get("/api/reports/stale-listings", headers=auth_headers).json()
    assert len(stale) == 1
    assert stale[0]["sku"] == part["sku"]
    assert stale[0]["part_status"] == "sold"
    # The part still on offer is not nagged about.
    assert other["sku"] not in {row["sku"] for row in stale}


def test_a_closed_advert_stops_being_flagged(client: TestClient, auth_headers, admin) -> None:
    part = _part(client, auth_headers, status="available")
    listing = client.post(
        f"/api/parts/{part['id']}/listings", headers=auth_headers, json={"channel": "ebay"}
    ).json()
    client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-09-07",
            "fulfilled_on": "2026-09-07",
            "collected_by_id": admin.id,
            "items": [{"part_ids": [part["id"]], "unit_price": "85.00"}],
        },
    )
    assert len(client.get("/api/reports/stale-listings", headers=auth_headers).json()) == 1

    client.patch(
        f"/api/parts/listings/{listing['id']}",
        headers=auth_headers,
        json={"removed_on": "2026-09-07"},
    )
    assert client.get("/api/reports/stale-listings", headers=auth_headers).json() == []


def test_deleting_a_part_takes_its_listings(client: TestClient, auth_headers) -> None:
    part = _part(client, auth_headers)
    client.post(
        f"/api/parts/{part['id']}/listings", headers=auth_headers, json={"channel": "facebook"}
    )
    assert client.delete(f"/api/parts/{part['id']}", headers=auth_headers).status_code == 200


def test_account_names_are_suggested_back(client: TestClient, auth_headers) -> None:
    part = _part(client, auth_headers)
    for _ in range(2):
        client.post(
            f"/api/parts/{part['id']}/listings",
            headers=auth_headers,
            json={"channel": "facebook", "account": "BigGayDiesel"},
        )

    assert client.get("/api/suggestions/listing_account", headers=auth_headers).json() == [
        "BigGayDiesel"
    ]
