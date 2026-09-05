import { db } from "../lib/database";

export class AuthService {
  verifyPassword(user: { id: string; passwordHash: string }, password: string) {
    return user.passwordHash === `hashed:${password}`;
  }

  trackLogin() {
    return db.insertAudit("login");
  }
}
