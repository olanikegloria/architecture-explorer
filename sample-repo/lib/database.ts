type User = { id: string; email: string; passwordHash: string };

const users: User[] = [
  { id: "1", email: "user@example.com", passwordHash: "hashed:secret" },
];

export const db = {
  findUserByEmail(email: string) {
    return Promise.resolve(users.find((u) => u.email === email) ?? null);
  },
  insertAudit(event: string) {
    return Promise.resolve({ event, at: new Date().toISOString() });
  },
};
