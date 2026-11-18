"""Read-only integration with existing encrypted dashboard session. No env-token fallback."""
from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
import urllib.request
from .domain import IST, aware

@dataclass(frozen=True, repr=False)
class Session:
    token: str
    user_id: str
    expires_at: datetime

class SessionProvider:
    def __init__(self, db_url, api_key, encryption_key):
        if not db_url or not api_key or len(encryption_key) < 32:
            raise ValueError('DATABASE_URL, KITE_API_KEY and existing KITE_SESSION_ENCRYPTION_KEY required')
        self.db_url, self.api_key, self.key = db_url, api_key, encryption_key

    def resolve(self, now=None):
        import psycopg2
        now = aware(now or datetime.now(IST))
        conn = psycopg2.connect(self.db_url, connect_timeout=5,
            options='-c default_transaction_read_only=on -c statement_timeout=3000')
        try:
            with conn, conn.cursor() as cur:
                cur.execute('SELECT access_token_ciphertext,session_id_fingerprint,user_id,expires_at,token_fingerprint FROM public.kite_session_authority WHERE authority_id=%s', ('primary',))
                row = cur.fetchone()
        finally: conn.close()
        if not row or not row[1] or aware(row[3]) <= now:
            raise RuntimeError('KITE_RECONNECT_REQUIRED')
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        try:
            iv, tag, ciphertext = [bytes.fromhex(part) for part in row[0].split(':')]
            if len(iv) != 12 or len(tag) != 16: raise ValueError('invalid envelope')
            token = AESGCM(hashlib.sha256(self.key.encode()).digest()).decrypt(iv,ciphertext+tag,None).decode()
            if not token or hashlib.sha256(token.encode()).hexdigest()[:16] != row[4]:
                raise ValueError('fingerprint mismatch')
        except Exception:
            raise RuntimeError('KITE_AUTHORITY_DECRYPT_OR_INTEGRITY_FAILED') from None
        return Session(token,row[2],aware(row[3]))

    def get(self, path, session):
        # Internal fixed read endpoints only. Never accepts a caller-supplied URL or HTTP method.
        if path not in ('/user/profile','/instruments/NFO'):
            raise ValueError('READ_ENDPOINT_NOT_ALLOWED')
        if session.expires_at <= datetime.now(IST): raise RuntimeError('KITE_RECONNECT_REQUIRED')
        request = urllib.request.Request('https://api.kite.trade'+path,
            headers={'X-Kite-Version':'3','Authorization':f'token {self.api_key}:{session.token}'},method='GET')
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                data = response.read(32*1024*1024+1)
            if len(data)>32*1024*1024: raise RuntimeError('response too large')
            return data
        except Exception:
            raise RuntimeError('KITE_READ_FAILED_RECONNECT_OR_RETRY_REQUIRED') from None

    def verify(self, session):
        try:
            profile = json.loads(self.get('/user/profile',session))
            if profile.get('status') != 'success' or profile['data']['user_id'] != session.user_id:
                raise ValueError('identity mismatch')
        except Exception:
            raise RuntimeError('KITE_PROFILE_OR_IDENTITY_CHECK_FAILED') from None
