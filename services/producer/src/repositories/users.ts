import { getDb } from "../db/connection.js";

export type Role = "auditor" | "admin";

export interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  role: Role;
  active: number;
  must_change_password: number;
  created_by: number | null;
  created_at: string;
  last_login: string | null;
}

export interface PublicUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  must_change_password: boolean;
  created_at: string;
  last_login: string | null;
}

export interface NewUser {
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  createdBy: number | null;
  mustChangePassword?: boolean;
}

function db() {
  const connection = getDb();
  if (!connection) throw new Error("Database unavailable");
  return connection;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: row.active === 1,
    must_change_password: row.must_change_password === 1,
    created_at: row.created_at,
    last_login: row.last_login,
  };
}

export function findUserByEmail(email: string): UserRow | null {
  return (db().prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined) ?? null;
}

export function findUserById(id: number): UserRow | null {
  return (db().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined) ?? null;
}

export function listUsers(): UserRow[] {
  return db().prepare("SELECT * FROM users ORDER BY id").all() as UserRow[];
}

/** Inserts a user and returns its id. Throws on a duplicate e-mail (the column is UNIQUE). */
export function insertUser(user: NewUser): number {
  const { lastInsertRowid } = db()
    .prepare(
      `INSERT INTO users (email, name, password_hash, role, must_change_password, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.email,
      user.name,
      user.passwordHash,
      user.role,
      user.mustChangePassword === false ? 0 : 1,
      user.createdBy,
      new Date().toISOString(),
    );
  return Number(lastInsertRowid);
}

export function updateUserProfile(id: number, fields: { name?: string; role?: Role; active?: boolean }): void {
  const current = findUserById(id);
  if (!current) return;
  db()
    .prepare("UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?")
    .run(
      fields.name ?? current.name,
      fields.role ?? current.role,
      fields.active === undefined ? current.active : fields.active ? 1 : 0,
      id,
    );
}

export function setUserPassword(id: number, passwordHash: string, mustChangePassword: boolean): void {
  db()
    .prepare("UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?")
    .run(passwordHash, mustChangePassword ? 1 : 0, id);
}

export function touchLastLogin(id: number): void {
  db().prepare("UPDATE users SET last_login = ? WHERE id = ?").run(new Date().toISOString(), id);
}

export function countActiveAdmins(): number {
  const row = db().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get() as {
    n: number;
  };
  return row.n;
}
