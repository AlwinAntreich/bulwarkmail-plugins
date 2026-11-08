"""Seed the test Papra: user alice, two organisations, tags, a few PDF
documents and two API keys.

    python seed/seed_papra.py

Idempotent: alice signs in when she already exists, organisations, tags and
documents are looked up by name before anything is created, and API keys
from test-env/.secrets/papra.json are kept while they still work.

The organisation "Team" has no "Bulwark" tag, on purpose: the plugin skips a
default tag the target organisation lacks, and tests need that case.
"""
import os
import sys
import time
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import http, minimal_pdf, read_secret, wait_for, write_secret  # noqa: E402

BASE = os.environ.get('PAPRA_URL', 'http://localhost:18012')
USER = {'email': 'alice@example.org', 'password': 'alice-pass-123', 'name': 'Alice'}

ORGANISATIONS = {
    'Alice': [('Bulwark', '#7C3AED'), ('Invoice', '#E11D48'), ('Contract', '#2563EB')],
    'Team': [('Invoice', '#E11D48')],
}

DOCUMENTS = [
    # organisation, file name, tags, text
    ('Alice', 'acme-invoice-2026-10.pdf', ['Invoice'], ['ACME Hosting', 'Invoice 2026-10', 'Amount 49.00 EUR']),
    ('Alice', 'hosting-contract.pdf', ['Contract'], ['ACME Hosting', 'Hosting contract', 'Valid from 2025-12-01']),
    ('Alice', 'strom-abschlag-2026.pdf', [], ['Stadtwerke Hildesheim', 'Abschlag 2026', 'Betrag 84,00 EUR']),
    ('Team', 'team-offsite-invoice.pdf', ['Invoice'], ['Hotel Example', 'Team offsite', 'Amount 1200.00 EUR']),
    ('Team', 'meeting-notes.pdf', [], ['Team meeting', 'Agenda and notes']),
]

KEYS = {
    # secrets key: permissions
    'apiKey': ['organizations:read', 'documents:read', 'documents:create', 'documents:update', 'tags:read'],
    'apiKeyWithoutTags': ['organizations:read', 'documents:read', 'documents:create'],
}


class Session:
    """Alice's browser session (cookie), for what an API key can't do."""

    def __init__(self):
        self.cookie = None

    def request(self, method, path, body=None):
        headers = {'Origin': BASE}
        if self.cookie:
            headers['Cookie'] = self.cookie
        r = http(method, BASE + path, body=body, headers=headers)
        cookies = r.headers.get_all('Set-Cookie') or []
        if cookies:
            self.cookie = '; '.join(c.split(';', 1)[0] for c in cookies)
        return r

    def call(self, method, path, body=None):
        r = self.request(method, path, body)
        if r.status not in (200, 201, 204):
            sys.exit(f'papra: {method} {path}: {r.status} {r.text[:300]}')
        return r.json() if r.body else None


def sign_in(session):
    r = session.request('POST', '/api/auth/sign-in/email', {'email': USER['email'], 'password': USER['password']})
    if r.status == 200:
        return
    r = session.request('POST', '/api/auth/sign-up/email', USER)
    if r.status != 200:
        sys.exit(f'papra: signing up {USER["email"]}: {r.status} {r.text[:300]}')
    print('papra: created user', USER['email'])


def multipart(filename, data):
    boundary = uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            'Content-Type: application/pdf\r\n\r\n').encode() + data + f'\r\n--{boundary}--\r\n'.encode()
    return body, f'multipart/form-data; boundary={boundary}'


def key_works(token):
    r = http('GET', f'{BASE}/api/api-keys/current', headers={'Authorization': f'Bearer {token}'})
    return r.status == 200


def main():
    wait_for('Papra', lambda: http('GET', f'{BASE}/api/health').status == 200)
    session = Session()
    sign_in(session)

    orgs = {o['name']: o['id'] for o in session.call('GET', '/api/organizations')['organizations']}
    tag_ids = {}
    for name, tags in ORGANISATIONS.items():
        if name not in orgs:
            orgs[name] = session.call('POST', '/api/organizations', {'name': name})['organization']['id']
            print('papra: created organisation', name)
        existing = {t['name']: t['id'] for t in session.call('GET', f'/api/organizations/{orgs[name]}/tags')['tags']}
        for tag, color in tags:
            if tag not in existing:
                existing[tag] = session.call('POST', f'/api/organizations/{orgs[name]}/tags',
                                             {'name': tag, 'color': color})['tag']['id']
                print(f'papra: created tag {tag} in {name}')
        tag_ids[name] = existing

    for org, filename, tags, text in DOCUMENTS:
        org_id = orgs[org]
        listed = session.call('GET', f'/api/organizations/{org_id}/documents?pageSize=100')['documents']
        if any(d['name'] == filename for d in listed):
            continue
        body, ctype = multipart(filename, minimal_pdf(text))
        r = http('POST', f'{BASE}/api/organizations/{org_id}/documents', body=body,
                 headers={'Origin': BASE, 'Cookie': session.cookie, 'Content-Type': ctype})
        if r.status != 200:
            sys.exit(f'papra: uploading {filename}: {r.status} {r.text[:300]}')
        doc_id = r.json()['document']['id']
        for tag in tags:
            session.call('POST', f'/api/organizations/{org_id}/documents/{doc_id}/tags', {'tagId': tag_ids[org][tag]})
        print(f'papra: uploaded {filename} to {org}')

    secret = read_secret('papra') or {}
    keys = {}
    for name, permissions in KEYS.items():
        token = secret.get(name)
        if not (token and key_works(token)):
            label = f'bulwark-test {name} {time.strftime("%Y-%m-%d %H:%M:%S")}'
            token = session.call('POST', '/api/api-keys', {'name': label, 'permissions': permissions})['token']
            print(f'papra: created API key {name}')
        keys[name] = token

    write_secret('papra', {
        'url': BASE,
        'email': USER['email'],
        'password': USER['password'],
        'organizations': orgs,
        **keys,
    })


if __name__ == '__main__':
    main()
