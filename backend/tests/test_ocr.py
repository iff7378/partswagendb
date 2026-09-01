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


def test_recovers_a_vag_number_misread_with_letter_o() -> None:
    # Tesseract commonly reads a stamped 0 as the letter O.
    assert values("BOSCH\nO6A 906 461 L\nMADE IN GERMANY") == ["06A 906 461 L"]


def test_recovers_a_bosch_number_misread_with_letter_o() -> None:
    assert values("BOSCH O 28O 218 OO2") == ["0 280 218 002"]


def test_letter_suffix_is_not_turned_into_a_digit() -> None:
    # The trailing L is a real index letter, not a misread 1.
    assert values("06A 906 461 L")[0].endswith(" L")


def test_a_fragment_inside_a_longer_match_is_dropped() -> None:
    # The VAG pattern can match part of a Bosch number; only the full one survives.
    assert values("0 280 218 002") == ["0 280 218 002"]


def test_words_are_not_mistaken_for_part_numbers() -> None:
    assert values("ALTERNATOR ASSEMBLY REMANUFACTURED") == []
    assert values("MADE IN GERMANY") == []


def test_a_big_photo_is_shrunk_and_a_small_one_enlarged() -> None:
    """Neither size alone works, so the pass list must span both directions."""
    from PIL import Image

    from app.services.ocr import OCR_LONG_EDGES, _rescaled

    big = Image.new("L", (4032, 3024))
    assert max(_rescaled(big, 1600).size) == 1600

    small = Image.new("L", (900, 400))
    assert max(_rescaled(small, 1600).size) == 1600

    assert min(OCR_LONG_EDGES) < 2000 < max(OCR_LONG_EDGES)


def test_absurd_upscales_are_skipped() -> None:
    """Enlarging past 2x invents detail rather than revealing it."""
    from PIL import Image

    from app.services.ocr import _rescaled

    assert _rescaled(Image.new("L", (400, 300)), 3072) is None
    assert _rescaled(Image.new("L", (400, 300)), 800) is not None


def test_rescaling_preserves_aspect_ratio() -> None:
    from PIL import Image

    from app.services.ocr import _rescaled

    assert _rescaled(Image.new("L", (4032, 3024)), 1600).size == (1600, 1200)


def test_preprocessing_does_not_sharpen_at_any_scale() -> None:
    import inspect

    from app.services import ocr

    assert "ImageFilter" not in inspect.getsource(ocr)


def test_finds_a_vin_on_a_sticker() -> None:
    from app.services.ocr import find_vins

    assert find_vins("VIN: 3VWFE21C04M000001  GVWR 1800KG") == ["3VWFE21C04M000001"]


def test_recovers_a_vin_misread_with_letter_lookalikes() -> None:
    """A VIN never contains I, O or Q, so any the OCR reports is a misread digit."""
    from app.services.ocr import find_vins

    assert find_vins("VIN 3VWFE21CO4MOOOOO1") == ["3VWFE21C04M000001"]


def test_ignores_seventeen_character_non_vins() -> None:
    from app.services.ocr import find_vins

    assert find_vins("12345678901234567") == []
    assert find_vins("ABCDEFGHJKLMNPRST") == []
