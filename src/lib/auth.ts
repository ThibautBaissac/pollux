import {
  scrypt,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { authConfig, sessions, recoveryCodes } from "@/lib/db/schema";
import { and, eq, or } from "drizzle-orm";

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) {
    return false;
  }

  const salt = Buffer.from(saltHex, "hex");
  const storedHash = Buffer.from(hashHex, "hex");
  if (salt.length === 0 || storedHash.length !== KEY_LENGTH) {
    return false;
  }

  const hash = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
  return timingSafeEqual(storedHash, hash);
}

export async function createSession(): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_MAX_AGE * 1000);

  db.insert(sessions)
    .values({ token: tokenHash, createdAt: now, expiresAt: expires })
    .run();

  const cookieStore = await cookies();
  cookieStore.set("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  return token;
}

export async function validateSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (!token) return false;

  const tokenHash = hashSessionToken(token);
  const session = db
    .select()
    .from(sessions)
    .where(or(eq(sessions.token, tokenHash), eq(sessions.token, token)))
    .get();

  if (!session) return false;
  if (session.expiresAt < new Date()) {
    db.delete(sessions)
      .where(or(eq(sessions.token, tokenHash), eq(sessions.token, token)))
      .run();
    return false;
  }

  if (session.token !== tokenHash) {
    db.update(sessions)
      .set({ token: tokenHash })
      .where(eq(sessions.token, session.token))
      .run();
  }

  return true;
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (token) {
    const tokenHash = hashSessionToken(token);
    db.delete(sessions)
      .where(or(eq(sessions.token, tokenHash), eq(sessions.token, token)))
      .run();
  }
  cookieStore.delete("session");
}

export function isSetupComplete(): boolean {
  return !!getPasswordHash();
}

export function getPasswordHash(): string | null {
  const row = db
    .select()
    .from(authConfig)
    .where(eq(authConfig.key, "password_hash"))
    .get();
  return row?.value ?? null;
}

export function getEmail(): string | null {
  const row = db
    .select()
    .from(authConfig)
    .where(eq(authConfig.key, "email"))
    .get();
  return row?.value ?? null;
}

export function setEmail(email: string): void {
  db.insert(authConfig)
    .values({ key: "email", value: email })
    .onConflictDoUpdate({ target: authConfig.key, set: { value: email } })
    .run();
}

export async function changePassword(newPassword: string): Promise<void> {
  const hash = await hashPassword(newPassword);
  db.insert(authConfig)
    .values({ key: "password_hash", value: hash })
    .onConflictDoUpdate({ target: authConfig.key, set: { value: hash } })
    .run();
}

/**
 * Atomically performs first-time setup: sets password + email inside a
 * transaction that re-checks whether setup has already been completed,
 * preventing race conditions from concurrent requests.
 * Returns false if setup was already complete (another request won the race).
 */
export async function performFirstTimeSetup(
  email: string,
  password: string,
): Promise<boolean> {
  const hash = await hashPassword(password);

  let succeeded = false;
  db.transaction((tx) => {
    const existing = tx
      .select()
      .from(authConfig)
      .where(eq(authConfig.key, "password_hash"))
      .get();
    if (existing) return; // already set up — another request won the race

    tx.insert(authConfig)
      .values({ key: "password_hash", value: hash })
      .run();
    tx.insert(authConfig)
      .values({ key: "email", value: email })
      .onConflictDoUpdate({ target: authConfig.key, set: { value: email } })
      .run();
    succeeded = true;
  });

  return succeeded;
}

export async function generateRecoveryCodes(): Promise<{
  codes: string[];
  hashes: string[];
}> {
  const codes = Array.from({ length: 8 }, () => {
    const raw = randomBytes(8).toString("hex");
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
  });
  const hashes = await Promise.all(codes.map((code) => hashPassword(code)));
  return { codes, hashes };
}

export function storeRecoveryCodes(hashes: string[]): void {
  const now = new Date();
  db.transaction((tx) => {
    tx.delete(recoveryCodes).run();
    for (const hash of hashes) {
      tx.insert(recoveryCodes)
        .values({
          id: randomBytes(16).toString("hex"),
          codeHash: hash,
          used: 0,
          createdAt: now,
        })
        .run();
    }
  });
}

export async function verifyRecoveryCode(code: string): Promise<boolean> {
  const unused = db
    .select()
    .from(recoveryCodes)
    .where(eq(recoveryCodes.used, 0))
    .all();

  for (const row of unused) {
    if (await verifyPassword(code, row.codeHash)) {
      const { changes } = db
        .update(recoveryCodes)
        .set({ used: 1 })
        .where(
          and(eq(recoveryCodes.id, row.id), eq(recoveryCodes.used, 0)),
        )
        .run();

      if (changes === 1) {
        return true;
      }
    }
  }
  return false;
}

export function destroyAllSessions(): void {
  db.delete(sessions).run();
}
