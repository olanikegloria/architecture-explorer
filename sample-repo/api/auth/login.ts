import { AuthService } from "../../services/auth";
import { db } from "../../lib/database";

export type LoginPayload = { email: string; password: string };

export async function login(payload: LoginPayload) {
  const auth = new AuthService();
  const user = await db.findUserByEmail(payload.email);
  if (!user) {
    throw new Error("User not found");
  }
  return auth.verifyPassword(user, payload.password);
}
