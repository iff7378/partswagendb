from app.services.ocr import find_part_numbers


def values(text: str) -> list[str]:
    return [c["value"] for c in find_part_numbers(text)]


def test_no_text_yields_nothing() -> None:
    assert find_part_numbers(None) == []
    assert find_part_numbers("") == []


def test_finds_a_vag_style_part_number() -> None:
    assert "06A 906 461 L" in values("Bosch\n06A 906 461 L\nMade in Germany")


def test_vag_number_outranks_generic_tokens() -> None:
    ranked = find_part_numbers("SERIAL AB12345\n06A 906 461 L")
    assert ranked[0]["value"] == "06A 906 461 L"


def test_finds_a_bosch_style_number() -> None:
    assert "0 280 218 002" in values("BOSCH 0 280 218 002")


def test_ignores_country_of_origin_noise() -> None:
    assert values("MADE IN GERMANY") == []


def test_ignores_short_tokens() -> None:
    assert values("A1 B2 XY") == []


def test_requires_at_least_one_digit() -> None:
    assert values("ALTERNATOR ASSEMBLY") == []


def test_keeps_hyphenated_numbers() -> None:
    assert "12345-67890" in values("PART 12345-67890")


def test_results_are_capped() -> None:
    text = " ".join(f"ABC{i:05d}" for i in range(50))
    assert len(find_part_numbers(text)) <= 10
