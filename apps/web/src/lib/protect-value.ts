import { createCipheriv, randomBytes } from 'node:crypto';

export async function protectValue(value: string): Promise<string> {
  const openBaoAddress = process.env.OPENBAO_ADDR;
  const openBaoToken = process.env.OPENBAO_TOKEN;
  if (openBaoAddress && openBaoToken) {
    const response = await fetch(
      `${openBaoAddress.replace(/\/$/, '')}/v1/transit/encrypt/local-gtm-ai`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-vault-token': openBaoToken },
        body: JSON.stringify({ plaintext: Buffer.from(value, 'utf8').toString('base64') }),
      },
    );
    if (!response.ok) throw new Error(`OpenBao protection failed with ${response.status}.`);
    const body = (await response.json()) as { data?: { ciphertext?: string } };
    if (!body.data?.ciphertext) throw new Error('OpenBao returned no protected value.');
    return body.data.ciphertext;
  }
  if (process.env.NODE_ENV === 'production')
    throw new Error('OpenBao protection is required in production.');
  const keyHex = process.env.DEV_ENVELOPE_KEY;
  if (!keyHex || !/^[a-f0-9]{64}$/i.test(keyHex))
    throw new Error('DEV_ENVELOPE_KEY must be a 32-byte hex key outside production.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `dev:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
}
