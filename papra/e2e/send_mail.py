"""Send alice a test message with a one-page PDF over SMTP submission.

    python send_mail.py --from "ACME Hosting <billing@acme-hosting.example>" \
        --subject "Invoice 4711" --pdf-text "unique text" [--pdf-name invoice.pdf]

The PDF carries the given text, so every run has its own checksum (Papra
refuses a file it already has). Copied from paperless/e2e/send_mail.py.
"""
import argparse
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid


def pdf_with_text(text):
    safe = text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    stream = f'BT /F1 14 Tf 72 720 Td ({safe}) Tj ET'.encode('latin-1', 'replace')
    objects = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    out = bytearray(b'%PDF-1.4\n')
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f'{i} 0 obj\n'.encode() + body + b'\nendobj\n'
    xref = len(out)
    out += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode()
    for off in offsets:
        out += f'{off:010d} 00000 n \n'.encode()
    out += f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    return bytes(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--from', dest='sender', required=True)
    ap.add_argument('--subject', required=True)
    ap.add_argument('--pdf-text', required=True)
    ap.add_argument('--pdf-name', default='invoice.pdf')
    ap.add_argument('--save-pdf', help='also write the PDF here')
    ap.add_argument('--to', default='alice@example.org')
    ap.add_argument('--user', default='alice@example.org')
    ap.add_argument('--password', default='test-pass-123')
    ap.add_argument('--host', default='localhost')
    ap.add_argument('--port', type=int, default=11587)
    args = ap.parse_args()

    msg = EmailMessage()
    msg['From'] = args.sender
    msg['To'] = args.to
    msg['Subject'] = args.subject
    msg['Date'] = formatdate(localtime=True)
    msg['Message-ID'] = make_msgid(domain='example.org')
    msg.set_content(f'Hello,\n\nthe document is attached.\n\n{args.pdf_text}\n')
    pdf = pdf_with_text(args.pdf_text)
    if args.save_pdf:
        with open(args.save_pdf, 'wb') as f:
            f.write(pdf)
    msg.add_attachment(pdf, maintype='application', subtype='pdf', filename=args.pdf_name)

    with smtplib.SMTP(args.host, args.port, timeout=30) as smtp:
        smtp.ehlo()
        if smtp.has_extn('starttls'):
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            smtp.starttls(context=ctx)
            smtp.ehlo()
        smtp.login(args.user, args.password)
        smtp.send_message(msg, from_addr=args.user, to_addrs=[args.to])
    print('sent', args.subject)


if __name__ == '__main__':
    main()
