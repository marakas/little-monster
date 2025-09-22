import { SignJWT, jwtVerify } from "jose";

const encoder = new TextEncoder();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export async function createSession(payload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("14d")
    .sign(encoder.encode(JWT_SECRET));
}

export async function verifySession(token) {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(JWT_SECRET));
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookie(name, value, maxAgeSec = 60 * 60 * 24 * 14) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`;
}
