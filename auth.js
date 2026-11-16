const {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} = require("node:crypto");

const TOKEN_LIFETIME_SECONDS = 8 * 60 * 60;
const TOKEN_SECRET = process.env.CAREDOSE_TOKEN_SECRET
  ? Buffer.from(process.env.CAREDOSE_TOKEN_SECRET, "utf8")
  : randomBytes(32);
const DUMMY_SALT = randomBytes(16);
const DUMMY_PASSWORD_HASH = `scrypt$16384$8$1$${DUMMY_SALT.toString(
  "hex"
)}$${scryptSync("invalid-login-password", DUMMY_SALT, 32).toString("hex")}`;

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$16384$8$1$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyPassword(password, passwordHash) {
  const parts = passwordHash.split("$");
  if (
    parts.length !== 6 ||
    parts[0] !== "scrypt" ||
    parts[1] !== "16384" ||
    parts[2] !== "8" ||
    parts[3] !== "1" ||
    !/^[a-f0-9]{32}$/i.test(parts[4]) ||
    !/^[a-f0-9]{64}$/i.test(parts[5])
  ) {
    return false;
  }

  const salt = Buffer.from(parts[4], "hex");
  const expectedHash = Buffer.from(parts[5], "hex");
  const actualHash = scryptSync(password, salt, expectedHash.length);
  return timingSafeEqual(actualHash, expectedHash);
}

function createLoginToken(user, now = Math.floor(Date.now() / 1000)) {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      name: user.name,
      role: user.role,
      iat: now,
      exp: now + TOKEN_LIFETIME_SECONDS,
    })
  ).toString("base64url");
  const unsignedToken = `${header}.${payload}`;
  const signature = createHmac("sha256", TOKEN_SECRET)
    .update(unsignedToken)
    .digest("base64url");

  return {
    token: `${unsignedToken}.${signature}`,
    expiresAt: new Date((now + TOKEN_LIFETIME_SECONDS) * 1000).toISOString(),
    expiresIn: TOKEN_LIFETIME_SECONDS,
  };
}

function verifyLoginToken(token, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== "string" || token.length > 4096) {
    return null;
  }

  const parts = token.split(".");
  if (
    parts.length !== 3 ||
    parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
  ) {
    return null;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const expectedSignature = createHmac("sha256", TOKEN_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const signature = Buffer.from(encodedSignature, "base64url");
  if (
    signature.length !== expectedSignature.length ||
    !timingSafeEqual(signature, expectedSignature)
  ) {
    return null;
  }

  try {
    const header = JSON.parse(
      Buffer.from(encodedHeader, "base64url").toString("utf8")
    );
    const user = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    );
    if (
      header.alg !== "HS256" ||
      header.typ !== "JWT" ||
      !Number.isSafeInteger(user.sub) ||
      user.sub < 1 ||
      typeof user.name !== "string" ||
      !["doctor", "nurse"].includes(user.role) ||
      !Number.isSafeInteger(user.iat) ||
      !Number.isSafeInteger(user.exp) ||
      user.exp <= now ||
      user.exp <= user.iat ||
      user.exp - user.iat !== TOKEN_LIFETIME_SECONDS
    ) {
      return null;
    }

    return {
      id: user.sub,
      name: user.name,
      role: user.role,
    };
  } catch {
    return null;
  }
}

module.exports = {
  createLoginToken,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyLoginToken,
  verifyPassword,
};
