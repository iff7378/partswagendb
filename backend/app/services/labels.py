import io

import qrcode
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

# Avery 5160-ish grid: 3 columns x 10 rows on US Letter.
COLUMNS = 3
ROWS = 10
MARGIN_X = 0.19 * inch
MARGIN_Y = 0.5 * inch
LABEL_W = 2.625 * inch
LABEL_H = 1.0 * inch
GUTTER_X = 0.125 * inch


def _qr_image(data: str) -> io.BytesIO:
    qr = qrcode.QRCode(version=None, box_size=10, border=1)
    qr.add_data(data)
    qr.make(fit=True)
    buffer = io.BytesIO()
    qr.make_image(fill_color="black", back_color="white").save(buffer, format="PNG")
    buffer.seek(0)
    return buffer


def render_label_sheet(labels: list[tuple[str, str, str]]) -> bytes:
    """Render a printable sheet. Each label is (code, line1, line2)."""
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=LETTER)
    _, page_height = LETTER

    per_page = COLUMNS * ROWS
    for index, (code, line1, line2) in enumerate(labels):
        if index and index % per_page == 0:
            pdf.showPage()

        slot = index % per_page
        col = slot % COLUMNS
        row = slot // COLUMNS

        x = MARGIN_X + col * (LABEL_W + GUTTER_X)
        y = page_height - MARGIN_Y - (row + 1) * LABEL_H

        qr_size = LABEL_H - 0.18 * inch
        pdf.drawImage(
            ImageReader(_qr_image(code)),
            x + 0.06 * inch,
            y + 0.09 * inch,
            width=qr_size,
            height=qr_size,
        )

        text_x = x + qr_size + 0.14 * inch
        pdf.setFont("Helvetica-Bold", 9)
        pdf.drawString(text_x, y + LABEL_H - 0.28 * inch, code[:22])
        pdf.setFont("Helvetica", 7)
        pdf.drawString(text_x, y + LABEL_H - 0.44 * inch, line1[:30])
        pdf.drawString(text_x, y + LABEL_H - 0.58 * inch, line2[:30])

    pdf.showPage()
    pdf.save()
    return buffer.getvalue()
