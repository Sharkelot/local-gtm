import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ENVELOPE_PREFIX = 'local-gtm-document:v1:';
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const TRANSIT_KEY_NAME_DEFAULT = 'local-gtm-document-data-key';

type EnvelopeFields = {
  v: 1;
  alg: 'AES-256-GCM';
  iv: string;
  tag: string;
  ciphertext: string;
  wrappedKey: string;
};

export type DataKeyProvider = {
  wrapDataKey(dataKey: Uint8Array, context: Uint8Array): Promise<string>;
  unwrapDataKey(wrappedDataKey: string, context: Uint8Array): Promise<Uint8Array>;
};

export type EnvelopeOptions = {
  context: Uint8Array;
  maxBytes?: number;
};

export type OpenBaoTransitOptions = {
  address: string;
  token: string;
  keyName?: string;
  fetchImplementation?: typeof fetch;
};

export type Environment = Record<string, string | undefined>;

function maxBytesFor(options: EnvelopeOptions): number {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new Error('maxBytes must be a positive integer.');
  return maxBytes;
}

function toBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

function fromBase64(value: string, field: string, maxBytes: number): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0)
    throw new Error(`Invalid ${field} encoding.`);
  const decoded = Buffer.from(value, 'base64');
  if (decoded.byteLength > maxBytes) throw new Error(`${field} exceeds the configured size limit.`);
  return decoded;
}

function serializeEnvelope(fields: EnvelopeFields): string {
  return `${ENVELOPE_PREFIX}${Buffer.from(JSON.stringify(fields), 'utf8').toString('base64url')}`;
}

function parseEnvelope(payload: string, maxBytes: number): EnvelopeFields {
  const maxEncodedBytes = Math.ceil(((maxBytes + 28) * 4) / 3) + 4096;
  if (
    !payload.startsWith(ENVELOPE_PREFIX) ||
    payload.length > ENVELOPE_PREFIX.length + maxEncodedBytes
  )
    throw new Error('Invalid or oversized document envelope.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(payload.slice(ENVELOPE_PREFIX.length), 'base64url').toString('utf8'),
    );
  } catch {
    throw new Error('Invalid document envelope.');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as EnvelopeFields).v !== 1 ||
    (parsed as EnvelopeFields).alg !== 'AES-256-GCM' ||
    !['iv', 'tag', 'ciphertext', 'wrappedKey'].every(
      (key) => typeof (parsed as Record<string, unknown>)[key] === 'string',
    )
  )
    throw new Error('Invalid document envelope fields.');
  return parsed as EnvelopeFields;
}

function assertDataKey(dataKey: Uint8Array): Buffer {
  if (dataKey.byteLength !== 32) throw new Error('Document data keys must be exactly 32 bytes.');
  return Buffer.from(dataKey);
}

export function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function assertSha256AndSize(
  value: Uint8Array,
  expected: { sha256: string; sizeBytes: number },
): void {
  if (!/^[a-f0-9]{64}$/i.test(expected.sha256))
    throw new Error('Expected SHA-256 must be a hex digest.');
  if (!Number.isSafeInteger(expected.sizeBytes) || expected.sizeBytes < 0)
    throw new Error('Expected size must be a non-negative integer.');
  if (value.byteLength !== expected.sizeBytes)
    throw new Error('Document size verification failed.');
  if (sha256(value) !== expected.sha256.toLowerCase())
    throw new Error('Document SHA-256 verification failed.');
}

export async function encryptDocument(
  plaintext: Uint8Array,
  provider: DataKeyProvider,
  options: EnvelopeOptions,
): Promise<string> {
  const maxBytes = maxBytesFor(options);
  if (plaintext.byteLength > maxBytes)
    throw new Error('Plaintext exceeds the configured size limit.');
  const dataKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
  cipher.setAAD(Buffer.from(options.context));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const wrappedKey = await provider.wrapDataKey(dataKey, options.context);
  if (!wrappedKey) throw new Error('Data-key provider returned no wrapped data key.');
  return serializeEnvelope({
    v: 1,
    alg: 'AES-256-GCM',
    iv: toBase64(iv),
    tag: toBase64(cipher.getAuthTag()),
    ciphertext: toBase64(ciphertext),
    wrappedKey,
  });
}

export async function decryptDocument(
  payload: string,
  provider: DataKeyProvider,
  options: EnvelopeOptions,
): Promise<Buffer> {
  const maxBytes = maxBytesFor(options);
  const envelope = parseEnvelope(payload, maxBytes);
  const iv = fromBase64(envelope.iv, 'envelope IV', 12);
  const tag = fromBase64(envelope.tag, 'envelope tag', 16);
  const ciphertext = fromBase64(envelope.ciphertext, 'envelope ciphertext', maxBytes);
  if (iv.byteLength !== 12 || tag.byteLength !== 16)
    throw new Error('Invalid AES-GCM envelope parameters.');
  const dataKey = assertDataKey(await provider.unwrapDataKey(envelope.wrappedKey, options.context));
  try {
    const decipher = createDecipheriv('aes-256-gcm', dataKey, iv);
    decipher.setAAD(Buffer.from(options.context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error('Document envelope authentication failed.');
  }
}

export function createOpenBaoTransitDataKeyProvider(
  options: OpenBaoTransitOptions,
): DataKeyProvider {
  if (!options.address || !options.token)
    throw new Error('OpenBao Transit address and token are required.');
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const endpoint = `${options.address.replace(/\/$/, '')}/v1/transit`;
  const keyName = encodeURIComponent(options.keyName ?? TRANSIT_KEY_NAME_DEFAULT);
  const transit = async (
    operation: 'encrypt' | 'decrypt',
    value: string,
    context: Uint8Array,
  ): Promise<string> => {
    const response = await fetchImplementation(`${endpoint}/${operation}/${keyName}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vault-token': options.token },
      body: JSON.stringify({
        [operation === 'encrypt' ? 'plaintext' : 'ciphertext']: value,
        context: toBase64(context),
      }),
    });
    if (!response.ok)
      throw new Error(`OpenBao Transit ${operation} failed with ${response.status}.`);
    const body = (await response.json()) as { data?: { ciphertext?: string; plaintext?: string } };
    const result = operation === 'encrypt' ? body.data?.ciphertext : body.data?.plaintext;
    if (!result) throw new Error(`OpenBao Transit ${operation} returned no value.`);
    return result;
  };
  return {
    wrapDataKey: async (dataKey, context) =>
      transit('encrypt', toBase64(assertDataKey(dataKey)), context),
    unwrapDataKey: async (wrappedDataKey, context) => {
      const plaintext = await transit('decrypt', wrappedDataKey, context);
      return assertDataKey(fromBase64(plaintext, 'OpenBao data key', 32));
    },
  };
}

export function createDevEnvelopeKeyDataKeyProvider(keyHex: string): DataKeyProvider {
  if (!/^[a-f0-9]{64}$/i.test(keyHex))
    throw new Error('DEV_ENVELOPE_KEY must be a 32-byte hex key outside production.');
  const wrappingKey = Buffer.from(keyHex, 'hex');
  return {
    wrapDataKey(dataKey, context) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', wrappingKey, iv);
      cipher.setAAD(Buffer.from(context));
      const encrypted = Buffer.concat([cipher.update(assertDataKey(dataKey)), cipher.final()]);
      return Promise.resolve(
        `dev:v1:${toBase64(iv)}:${toBase64(cipher.getAuthTag())}:${toBase64(encrypted)}`,
      );
    },
    unwrapDataKey(wrappedDataKey, context) {
      const parts = wrappedDataKey.split(':');
      if (parts.length !== 5 || parts[0] !== 'dev' || parts[1] !== 'v1')
        throw new Error('Invalid development wrapped data key.');
      const iv = fromBase64(parts[2]!, 'wrapped-key IV', 12);
      const tag = fromBase64(parts[3]!, 'wrapped-key tag', 16);
      const ciphertext = fromBase64(parts[4]!, 'wrapped-key ciphertext', 32);
      if (iv.byteLength !== 12 || tag.byteLength !== 16 || ciphertext.byteLength !== 32)
        throw new Error('Invalid development wrapped data key.');
      try {
        const decipher = createDecipheriv('aes-256-gcm', wrappingKey, iv);
        decipher.setAAD(Buffer.from(context));
        decipher.setAuthTag(tag);
        return Promise.resolve(
          assertDataKey(Buffer.concat([decipher.update(ciphertext), decipher.final()])),
        );
      } catch {
        throw new Error('Development data-key authentication failed.');
      }
    },
  };
}

export function createDataKeyProviderFromEnvironment(
  environment: Environment = process.env,
): DataKeyProvider {
  if (environment.NODE_ENV === 'production') {
    if (!environment.OPENBAO_ADDR || !environment.OPENBAO_TOKEN)
      throw new Error('OpenBao Transit configuration is required in production.');
    return createOpenBaoTransitDataKeyProvider({
      address: environment.OPENBAO_ADDR,
      token: environment.OPENBAO_TOKEN,
      keyName: environment.OPENBAO_TRANSIT_KEY ?? TRANSIT_KEY_NAME_DEFAULT,
    });
  }
  return createDevEnvelopeKeyDataKeyProvider(environment.DEV_ENVELOPE_KEY ?? '');
}
