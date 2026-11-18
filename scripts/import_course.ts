// Import a mentor course JSON (made in Claude Code from a book / transcript) into the journal.
// Usage: npx ts-node scripts/import_course.ts <course.json> <userId>
//        npx ts-node scripts/import_course.ts --list <userId>
// Re-importing the same course id replaces it.
import fs from 'fs';
import pool from '../src/db';
import { validateCourse } from '../src/api/mentor';

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--list') {
    const userId = Number(args[1]);
    if (!Number.isInteger(userId)) throw new Error('usage: import_course.ts --list <userId>');
    const r = await pool.query(
      `SELECT id, data->>'title' AS title, data->>'mentor' AS mentor, data->>'kind' AS kind,
              jsonb_array_length(data->'chapters') AS chapters, jsonb_array_length(data->'strategies') AS strategies, updated_at
         FROM mentor_courses WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId]
    );
    if (!r.rows.length) console.log('(no courses)');
    for (const c of r.rows) {
      console.log(`${c.id}  "${c.title}" by ${c.mentor} [${c.kind}]  chapters=${c.chapters} strategies=${c.strategies}  updated ${new Date(c.updated_at).toISOString()}`);
    }
    return;
  }
  const [file, userArg] = args;
  const userId = Number(userArg);
  if (!file || !Number.isInteger(userId)) throw new Error('usage: import_course.ts <course.json> <userId>  |  --list <userId>');
  const course = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const err = validateCourse(course?.id, course);
  if (err) throw new Error(`invalid course: ${err}`);
  await pool.query(
    `INSERT INTO mentor_courses (user_id, id, data, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (user_id, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [userId, course.id, JSON.stringify(course)]
  );
  console.log(`imported ${course.id} - "${course.title}" (${course.mentor}, ${course.kind}): ${course.chapters.length} chapters, ${course.strategies.length} strategies`);
}

main()
  .catch(e => { console.error(e.message); process.exitCode = 1; })
  .finally(() => pool.end());
