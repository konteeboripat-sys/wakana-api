import type { ContactMessage } from './contact.ts';

export type ContactStatus = 'new' | 'done' | 'spam';

export interface ContactRow {
  id: number;
  subject: string;
  name: string;
  company: string;
  tel: string;
  email: string;
  detail: string;
  status: ContactStatus;
  spam_reason: string;
  handled_by: string;
  handled_at: string;
  created_at: string;
}

export async function insertContact(db: D1Database, m: ContactMessage, nowIso: string): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO contact_messages (subject, name, company, tel, email, detail, status, spam_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .bind(m.subject, m.name, m.company, m.tel, m.email, m.detail, m.spamReason ? 'spam' : 'new', m.spamReason, nowIso)
    .first<{ id: number }>();
  return row?.id ?? 0;
}

/** status '' = ทุกสถานะ · ล่าสุดก่อน · 500 รายการ */
export async function listContacts(db: D1Database, status: ContactStatus | ''): Promise<ContactRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM contact_messages WHERE (?1 = '' OR status = ?1) ORDER BY created_at DESC, id DESC LIMIT 500`)
    .bind(status)
    .all<ContactRow>();
  return results;
}

export async function countContactsByStatus(db: D1Database): Promise<Record<ContactStatus, number>> {
  const { results } = await db.prepare('SELECT status, COUNT(*) AS n FROM contact_messages GROUP BY status').all<{ status: ContactStatus; n: number }>();
  const out: Record<ContactStatus, number> = { new: 0, done: 0, spam: 0 };
  for (const r of results) out[r.status] = r.n;
  return out;
}

export async function getContact(db: D1Database, id: number): Promise<ContactRow | null> {
  return db.prepare('SELECT * FROM contact_messages WHERE id = ?').bind(id).first<ContactRow>();
}

/** เปลี่ยนสถานะ + ใครทำเมื่อไร (กลับเป็น new = ล้างผู้ทำ) */
export async function setContactStatus(db: D1Database, id: number, status: ContactStatus, actor: string, nowIso: string): Promise<boolean> {
  const res = await db
    .prepare('UPDATE contact_messages SET status = ?, handled_by = ?, handled_at = ? WHERE id = ?')
    .bind(status, status === 'new' ? '' : actor, status === 'new' ? '' : nowIso, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}
