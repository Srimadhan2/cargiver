import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function alterDb() {
  const db = await open({
    filename: 'd:\\Care-Giver\\database.db',
    driver: sqlite3.Database
  });

  try {
    await db.exec('ALTER TABLE voice_checkins ADD COLUMN followUpQuestions TEXT;');
    console.log('Added followUpQuestions column to voice_checkins.');
  } catch (err) {
    console.log('Column may already exist or error:', err.message);
  }
}

alterDb();
