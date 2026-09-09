"""The whole arc of a car, then a check that the books actually balance.

These assert relationships between endpoints rather than individual values.
The bugs worth catching here are the quiet ones: a figure that looks plausible
on screen while two views of it disagree. Both real examples so far -- scrap
sales not flagged as shells, and unpaid sales counted as a car's income on one
page but not another -- would have been caught by section 4 below and by
nothing else in this suite.
"""

from decimal import Decimal

from fastapi.testclient import TestClient

D = Decimal
PERIOD = "period_start=2020-01-01&period_end=2030-12-31"


def _lifecycle(client: TestClient, headers, admin) -> dict:
    """Buy a car, strip it, sell the parts several ways, scrap the shell."""
    car = client.post(
        "/api/vehicles",
        headers=headers,
        json={
            "make": "Volkswagen",
            "model": "Jetta",
            "nickname": "Test wagon",
            "decode_vin": False,
        },
    ).json()

    site = client.post(
        "/api/locations", headers=headers, json={"name": "Shed", "kind": "site"}
    ).json()

    def part(title: str) -> dict:
        return client.post(
            "/api/parts",
            headers=headers,
            json={
                "title": title,
                "status": "available",
                "vehicle_id": car["id"],
                "location_id": site["id"],
            },
        ).json()

    alternator, seats, dash, door = (part("Alternator"), part("Seats"), part("Dash"), part("Door"))

    # What the car and its recovery cost.
    for description, amount in (("Bought the car", "900.00"), ("Towing", "100.00")):
        client.post(
            "/api/expenses",
            headers=headers,
            json={
                "vehicle_id": car["id"],
                "description": description,
                "amount": amount,
                "incurred_on": "2026-09-01",
                "paid_by_id": admin.id,
            },
        )
    # An overhead that belongs to no car.
    client.post(
        "/api/expenses",
        headers=headers,
        json={
            "description": "Cutting discs",
            "amount": "40.00",
            "category": "supplies",
            "incurred_on": "2026-09-01",
            "paid_by_id": admin.id,
        },
    )

    def sale(items, **extra) -> dict:
        body = {"sold_on": "2026-09-02", "collected_by_id": admin.id, "items": items, **extra}
        response = client.post("/api/sales", headers=headers, json=body)
        assert response.status_code == 201, response.text
        return response.json()

    # One part, paid and collected.
    sale(
        [{"part_ids": [alternator["id"]], "unit_price": "85.00"}],
        paid_on="2026-09-02",
        fulfilled_on="2026-09-02",
    )
    # A lot of two parts for one price, with fees taken out.
    sale(
        [
            {
                "part_ids": [seats["id"], dash["id"]],
                "description": "Interior",
                "unit_price": "400.00",
            }
        ],
        paid_on="2026-09-03",
        fulfilled_on="2026-09-03",
        fees="20.00",
    )
    # Something never catalogued, booked against the car.
    sale(
        [{"vehicle_id": car["id"], "description": "Loose trim", "unit_price": "60.00"}],
        paid_on="2026-09-04",
        fulfilled_on="2026-09-04",
    )
    # Agreed but not paid: must stay off the books entirely.
    pending = sale([{"part_ids": [door["id"]], "unit_price": "150.00"}])
    # The shell goes to the yard.
    sale(
        [{"vehicle_id": car["id"], "is_shell": True, "unit_price": "180.00"}],
        paid_on="2026-09-05",
        fulfilled_on="2026-09-05",
        channel="scrap",
    )

    return {"car": car, "pending": pending, "door": door}


def test_the_books_balance_across_a_whole_car(client: TestClient, auth_headers, admin) -> None:
    state = _lifecycle(client, auth_headers, admin)
    car_id = state["car"]["id"]

    ledger = client.get(f"/api/settle-up?{PERIOD}", headers=auth_headers).json()
    report = client.get("/api/reports/by-vehicle", headers=auth_headers).json()
    row = next(v for v in report["vehicles"] if v["id"] == car_id)
    detail = client.get(f"/api/vehicles/{car_id}", headers=auth_headers).json()
    sales = client.get("/api/sales?limit=200", headers=auth_headers).json()["items"]

    # 1. Revenue is the net of every paid sale, and only those.
    paid_net = sum(D(s["net_collected"]) for s in sales if s["paid_on"])
    assert D(ledger["total_revenue"]) == paid_net
    # 85 + (400 - 20 fees) + 60 + 180
    assert paid_net == D("705.00")

    # 2. The unpaid sale is nowhere in the money, on any page. Per-car figures
    #    are gross line totals; the ledger is net cash, so they differ by the
    #    20 of fees, which is charged on the sale and belongs to no car.
    assert D(row["total_revenue"]) == D("725.00")
    assert D(detail["total_revenue"]) == D("725.00")

    #    That gap must be reported, not left for someone to puzzle over.
    assert sum(D(v["total_revenue"]) for v in report["vehicles"]) + D(
        report["unattributed_revenue"]
    ) + D(report["sale_adjustments"]) == D(ledger["total_revenue"])

    # 3. Costs split into the car's own and the venture's overheads.
    assert D(row["total_expenses"]) == D("1000.00")
    assert D(report["general_expenses"]) == D("40.00")
    assert D(ledger["total_expenses"]) == D("1040.00")

    # 4. The two views of a car's return agree. They are computed by different
    #    queries, and drifting apart is exactly how a wrong number hides.
    for field in ("total_expenses", "total_revenue", "scrap_revenue", "profit"):
        assert row[field] == detail[field], field

    # 5. Profit ties out end to end, once the money belonging to no car is
    #    accounted for on both sides.
    assert D(row["profit"]) == D("725.00") - D("1000.00")
    per_car = sum(D(v["profit"]) for v in report["vehicles"])
    assert per_car - D(report["general_expenses"]) + D(report["unattributed_revenue"]) + D(
        report["sale_adjustments"]
    ) == D(ledger["profit"])

    # 6. Scrap is part of revenue, not on top of it.
    assert D(row["scrap_revenue"]) == D("180.00")
    assert D(row["scrap_revenue"]) <= D(row["total_revenue"])

    # 7. A lot counts once, not once per part.
    lines = client.get(f"/api/vehicles/{car_id}/sales", headers=auth_headers).json()
    interior = [line for line in lines if line["description"] == "Interior"]
    assert len(interior) == 1
    assert interior[0]["line_total"] == "400.00"

    # 8. Every paid line reaches exactly one car, and none is stranded.
    attributed = sum(D(line["line_total"]) for line in lines if line["paid_on"])
    assert attributed == D(row["total_revenue"])
    assert D(report["unattributed_revenue"]) == D("0.00")
    assert D(report["sale_adjustments"]) == D("-20.00")


def test_paying_a_pending_sale_moves_every_figure_together(
    client: TestClient, auth_headers, admin
) -> None:
    state = _lifecycle(client, auth_headers, admin)
    car_id = state["car"]["id"]

    def figures() -> tuple[Decimal, Decimal, Decimal]:
        ledger = client.get(f"/api/settle-up?{PERIOD}", headers=auth_headers).json()
        report = client.get("/api/reports/by-vehicle", headers=auth_headers).json()
        detail = client.get(f"/api/vehicles/{car_id}", headers=auth_headers).json()
        row = next(v for v in report["vehicles"] if v["id"] == car_id)
        return D(ledger["total_revenue"]), D(row["total_revenue"]), D(detail["total_revenue"])

    before = figures()
    client.patch(
        f"/api/sales/{state['pending']['id']}",
        headers=auth_headers,
        json={"paid_on": "2026-09-06"},
    )
    after = figures()

    # All three rise by the same 150, or one of them is lying. They do not
    #    have to be equal -- the ledger is net of fees -- only to move together.
    assert [b + D("150.00") for b in before] == list(after)
    # The two per-car views must still agree with each other exactly.
    assert after[1] == after[2]


def test_voiding_everything_returns_the_books_to_zero_but_keeps_the_record(
    client: TestClient, auth_headers, admin
) -> None:
    state = _lifecycle(client, auth_headers, admin)

    for sale in client.get("/api/sales?limit=200", headers=auth_headers).json()["items"]:
        client.delete(f"/api/sales/{sale['id']}", headers=auth_headers)

    ledger = client.get(f"/api/settle-up?{PERIOD}", headers=auth_headers).json()
    assert D(ledger["total_revenue"]) == D("0.00")

    # Voided, not gone: the sales are still there to be looked up.
    assert client.get("/api/sales?limit=200", headers=auth_headers).json()["total"] == 0
    kept = client.get("/api/sales?limit=200&include_voided=true", headers=auth_headers).json()
    assert kept["total"] == 5
    assert {s["state"] for s in kept["items"]} == {"voided"}

    report = client.get("/api/reports/by-vehicle", headers=auth_headers).json()
    row = next(v for v in report["vehicles"] if v["id"] == state["car"]["id"])
    assert D(row["total_revenue"]) == D("0.00")
    assert D(row["scrap_revenue"]) == D("0.00")

    # Stock comes back and the shell un-scraps, so the car can be sold again.
    parts = client.get(
        f"/api/parts?vehicle_id={state['car']['id']}&limit=50", headers=auth_headers
    ).json()["items"]
    assert {p["status"] for p in parts} == {"available"}
    detail = client.get(f"/api/vehicles/{state['car']['id']}", headers=auth_headers).json()
    assert detail["status"] == "stripped"


def test_the_ledger_adds_up_to_the_summary(client: TestClient, auth_headers, admin) -> None:
    """The drill-down must agree with the dashboard it drills into."""
    _lifecycle(client, auth_headers, admin)

    summary = client.get(f"/api/settle-up?{PERIOD}", headers=auth_headers).json()
    ledger = client.get(
        "/api/reports/ledger?period_start=2020-01-01&period_end=2030-12-31",
        headers=auth_headers,
    ).json()

    assert D(ledger["money_in"]) == D(summary["total_revenue"])
    assert D(ledger["money_out"]) == D(summary["total_expenses"])
    assert D(ledger["profit"]) == D(summary["profit"])

    # Every counted row, added up, is the profit. Nothing hidden.
    counted = sum(D(e["amount"]) for e in ledger["entries"] if e["counted"])
    assert counted == D(summary["profit"])

    # The unpaid sale is present but excluded, and says so.
    unpaid = [e for e in ledger["entries"] if not e["counted"]]
    assert len(unpaid) == 1
    assert unpaid[0]["state"] == "pending"
    assert D(ledger["uncounted"]) == D("150.00")

    # Fees are their own row rather than folded silently into a line.
    adjustments = [e for e in ledger["entries"] if "less fees" in e["description"]]
    assert len(adjustments) == 1
    assert D(adjustments[0]["amount"]) == D("-20.00")


def test_the_ledger_names_the_car_behind_each_line(client: TestClient, auth_headers, admin) -> None:
    state = _lifecycle(client, auth_headers, admin)
    ledger = client.get(
        "/api/reports/ledger?period_start=2020-01-01&period_end=2030-12-31",
        headers=auth_headers,
    ).json()

    named = {e["description"]: e["vehicle_name"] for e in ledger["entries"]}
    # Derived from the parts, not just from a line that happens to name a car.
    assert named["Alternator"] == "Test wagon"
    assert named["Interior"] == "Test wagon"
    assert named["Loose trim"] == "Test wagon"
    assert named["Bought the car"] == "Test wagon"
    # An overhead belongs to no car and must not be pinned to one.
    assert named["Cutting discs"] is None
    assert state["car"]["nickname"] == "Test wagon"


def test_suggestions_offer_what_was_typed_before(client: TestClient, auth_headers, admin) -> None:
    for title in ("RL Door", "RL Door", "Alternator"):
        client.post("/api/parts", headers=auth_headers, json={"title": title})

    titles = client.get("/api/suggestions/part_title", headers=auth_headers)
    assert titles.status_code == 200
    # Commonest first, so the name already used twice leads.
    assert titles.json()[0] == "RL Door"
    assert "Alternator" in titles.json()

    filtered = client.get("/api/suggestions/part_title?q=alt", headers=auth_headers).json()
    assert filtered == ["Alternator"]

    assert client.get("/api/suggestions/nonsense", headers=auth_headers).status_code == 404


def test_one_partner_collects_while_the_other_pays_to_ship(
    client: TestClient, auth_headers, admin, make_user
) -> None:
    """The case that used to go wrong.

    Ian coordinates a tail light for 130 all in and takes the money. Kevin
    packs it and buys a 12 label out of his own pocket. Before costs could
    attach to a sale, Ian looked like he had taken the full 130, Kevin's 12 was
    nowhere, and the venture looked 12 better off than it was.
    """
    from app.enums import UserRole

    kevin = make_user("kevin@example.com", role=UserRole.STAFF, is_partner=True, share_bps=5000)
    # The admin fixture is the other partner.
    client.patch(
        f"/api/users/{admin.id}",
        headers=auth_headers,
        json={"is_partner": True, "share_bps": 5000},
    )

    part = client.post(
        "/api/parts",
        headers=auth_headers,
        json={"title": "Tail light", "status": "available"},
    ).json()
    sale = client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-09-08",
            "paid_on": "2026-09-08",
            "fulfilled_on": "2026-09-08",
            "collected_by_id": admin.id,
            "shipping": "15.00",
            "items": [{"part_ids": [part["id"]], "unit_price": "115.00"}],
        },
    ).json()
    assert D(sale["net_collected"]) == D("130.00")

    cost = client.post(
        "/api/expenses",
        headers=auth_headers,
        json={
            "sale_id": sale["id"],
            "description": "Shipping label",
            "category": "shipping",
            "amount": "12.00",
            "incurred_on": "2026-09-08",
            "paid_by_id": kevin.id,
        },
    )
    assert cost.status_code == 201, cost.text

    detail = client.get(f"/api/sales/{sale['id']}", headers=auth_headers).json()
    assert len(detail["costs"]) == 1
    assert detail["costs"][0]["paid_by"]["id"] == kevin.id
    # Collected is still what Ian took; the margin is what the venture kept.
    assert D(detail["net_collected"]) == D("130.00")
    assert D(detail["net_after_costs"]) == D("118.00")

    report = client.get(f"/api/settle-up?{PERIOD}", headers=auth_headers).json()
    assert D(report["total_revenue"]) == D("130.00")
    assert D(report["total_expenses"]) == D("12.00")
    assert D(report["profit"]) == D("118.00")

    balances = {b["user"]["id"]: b for b in report["balances"]}
    # Ian is holding 130 and is owed nothing for outlay.
    assert D(balances[admin.id]["revenue_collected"]) == D("130.00")
    assert D(balances[admin.id]["expenses_paid"]) == D("0.00")
    # Kevin collected nothing and is 12 down.
    assert D(balances[kevin.id]["revenue_collected"]) == D("0.00")
    assert D(balances[kevin.id]["expenses_paid"]) == D("12.00")

    # Each is entitled to half of 118, so Ian owes Kevin his 12 back plus
    # Kevin's share of the profit: 130 - 59 = 71.
    assert D(balances[admin.id]["entitled"]) == D("59.00")
    assert D(balances[kevin.id]["entitled"]) == D("59.00")
    transfer = report["transfers"][0]
    assert transfer["from_user"]["id"] == admin.id
    assert transfer["to_user"]["id"] == kevin.id
    assert D(transfer["amount"]) == D("71.00")


def test_a_cost_belongs_to_a_car_or_a_sale_but_not_both(
    client: TestClient, auth_headers, admin
) -> None:
    car = client.post("/api/vehicles", headers=auth_headers, json={"decode_vin": False}).json()
    part = client.post(
        "/api/parts", headers=auth_headers, json={"title": "Bit", "status": "available"}
    ).json()
    sale = client.post(
        "/api/sales",
        headers=auth_headers,
        json={
            "sold_on": "2026-09-08",
            "collected_by_id": admin.id,
            "items": [{"part_ids": [part["id"]], "unit_price": "10.00"}],
        },
    ).json()

    response = client.post(
        "/api/expenses",
        headers=auth_headers,
        json={
            "vehicle_id": car["id"],
            "sale_id": sale["id"],
            "description": "Confused",
            "amount": "5.00",
            "incurred_on": "2026-09-08",
            "paid_by_id": admin.id,
        },
    )
    assert response.status_code == 422


def test_a_sale_cost_stays_out_of_any_cars_profit(client: TestClient, auth_headers, admin) -> None:
    state = _lifecycle(client, auth_headers, admin)
    car_id = state["car"]["id"]
    before = client.get(f"/api/vehicles/{car_id}", headers=auth_headers).json()

    sale = client.get("/api/sales?limit=1", headers=auth_headers).json()["items"][0]
    client.post(
        "/api/expenses",
        headers=auth_headers,
        json={
            "sale_id": sale["id"],
            "description": "Packing materials",
            "category": "supplies",
            "amount": "8.00",
            "incurred_on": "2026-09-08",
            "paid_by_id": admin.id,
        },
    )

    after = client.get(f"/api/vehicles/{car_id}", headers=auth_headers).json()
    # A sale can cover parts from several cars, so pinning its costs to one
    # would be a guess. It counts as a venture cost instead.
    assert after["total_expenses"] == before["total_expenses"]

    report = client.get("/api/reports/by-vehicle", headers=auth_headers).json()
    assert D(report["general_expenses"]) == D("48.00")  # 40 overheads + 8 packing
