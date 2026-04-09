import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { authConfig, sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

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
  const salt = Buffer.from(saltHex, "hex");
  const storedHash = Buffer.from(hashHex, "hex");
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
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_MAX_AGE * 1000);

  db.insert(sessions)
    .values({ token, createdAt: now, expiresAt: expires })
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

  const session = db
    .select()
    .from(sessions)
    .where(eq(sessions.token, token))
    .get();

  if (!session) return false;
  if (session.expiresAt < new Date()) {
    db.delete(sessions).where(eq(sessions.token, token)).run();
    return false;
  }
  return true;
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (token) {
    db.delete(sessions).where(eq(sessions.token, token)).run();
  }
  cookieStore.delete("session");
}

export function isSetupComplete(): boolean {
  const row = db
    .select()
    .from(authConfig)
    .where(eq(authConfig.key, "password_hash"))
    .get();
  return !!row;
}

export function getPasswordHash(): string | null {
  const row = db
    .select()
    .from(authConfig)
    .where(eq(authConfig.key, "password_hash"))
    .get();
  return row?.value ?? null;
}
