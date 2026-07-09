// Per-record delta-sync substrate — a node:sqlite port of hsk-vocabulary's
// backend/src/kit/sync-rows-repo.js (Postgres). Same model: each changed row
// carries a client `last_edited_at` (the last-writer-wins arbiter) and a per-user
// monotonic `server_version` (the pull cursor). The server stays dumb: ONE rule —
// LWW by last_edited_at on the key (user, kind, row_key). A pull returns every row
// with server_version > the client's cursor. Generic across kinds; openai-cli uses
// one row today (kind='commands'), future synced data reuses the same substrate.
//
// SQLite is single-writer, so a plain transaction serializes version assignment —
// no FOR UPDATE needed (that was Postgres-specific). device_id is dropped (no
// byDevice axis here; add it back if a summed-per-device kind ever appears).

const PAGE_SIZE = 500

export const createSyncRepo = (db) => {
  const ensureCursor = db.prepare(
    'INSERT INTO sync_cursors(user_id, value) VALUES(?, 0) ON CONFLICT(user_id) DO NOTHING',
  )
  const readCursor = db.prepare('SELECT value FROM sync_cursors WHERE user_id = ?')
  const writeCursor = db.prepare('UPDATE sync_cursors SET value = ? WHERE user_id = ?')
  // Conditional LWW upsert: the row only changes when the incoming edit is strictly
  // newer, so an older writer burns no version (info.changes === 0 → not applied).
  const upsert = db.prepare(
    `INSERT INTO sync_rows(user_id, kind, row_key, payload, last_edited_at, server_version, deleted)
     VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(user_id, kind, row_key) DO UPDATE SET
       payload = excluded.payload,
       last_edited_at = excluded.last_edited_at,
       server_version = excluded.server_version,
       deleted = excluded.deleted
     WHERE excluded.last_edited_at > sync_rows.last_edited_at`,
  )
  const scan = db.prepare(
    `SELECT kind, row_key, payload, last_edited_at, server_version, deleted
     FROM sync_rows WHERE user_id = ? AND server_version > ?
     ORDER BY server_version ASC LIMIT ?`,
  )

  // LWW batch upsert. Each applied row gets the next server_version. Returns
  // { cursor, results: [{ kind, rowKey, serverVersion|null, applied }] }.
  const push = (userId, changes) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      ensureCursor.run(userId)
      const start = readCursor.get(userId).value
      let cursor = start
      const results = []
      for (const change of changes) {
        const next = cursor + 1
        const info = upsert.run(
          userId,
          change.kind,
          change.rowKey,
          JSON.stringify(change.payload),
          Number(change.lastEditedAt) || 0,
          next,
          change.deleted === true ? 1 : 0,
        )
        const applied = info.changes > 0
        if (applied) cursor = next
        results.push({ kind: change.kind, rowKey: change.rowKey, serverVersion: applied ? next : null, applied })
      }
      if (cursor !== start) writeCursor.run(cursor, userId)
      db.exec('COMMIT')
      return { cursor, results }
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  // Delta read: rows with server_version > since, oldest-first, page-bounded.
  const pullSince = (userId, since) => {
    const rows = scan.all(userId, since, PAGE_SIZE + 1)
    const hasMore = rows.length > PAGE_SIZE
    const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows
    const cursor = page.length > 0 ? page[page.length - 1].server_version : since
    return {
      cursor,
      hasMore,
      rows: page.map((row) => ({
        kind: row.kind,
        rowKey: row.row_key,
        payload: JSON.parse(row.payload),
        lastEditedAt: row.last_edited_at,
        deleted: row.deleted === 1,
        serverVersion: row.server_version,
      })),
    }
  }

  return { push, pullSince }
}
