import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const file = path.join(__dirname, 'server.js');

let code = fs.readFileSync(file, 'utf8');

const wellnessScoreFn = `
// ─── Dynamic Wellness Score Calculation ───────────────────────────────
async function calculateDailyWellnessScore(patientId) {
  try {
    let score = 50; // Base score

    // 1. Medication Adherence (+30 max)
    const meds = await db.all(\`SELECT taken FROM medications WHERE patientId = ?\`, [patientId]);
    if (meds.length > 0) {
      const taken = meds.filter(m => m.taken === 1).length;
      score += Math.round((taken / meds.length) * 30);
    } else {
      score += 15; // default if no meds
    }

    // 2. Nutrition (+10 max)
    const dateStr = now().toISOString().slice(0, 10);
    const nutrition = await db.get(\`SELECT waterIntake, appetiteScore FROM nutrition_logs WHERE patientId = ? AND date = ?\`, [patientId, dateStr]);
    if (nutrition) {
      const water = nutrition.waterIntake || 0;
      score += Math.min(10, Math.round((water / 8) * 10)); // 8 cups = max points
    }

    // 3. Care Plans (+10 max)
    const plans = await db.all(\`SELECT completedToday FROM care_plans WHERE patientId = ?\`, [patientId]);
    if (plans.length > 0) {
      const completed = plans.filter(p => p.completedToday === 1).length;
      score += Math.round((completed / plans.length) * 10);
    } else {
      score += 5; // default
    }

    // 4. Alerts (-10 per active alert)
    const activeAlerts = await db.all(\`SELECT id FROM alerts WHERE patientId = ? AND resolved = 0\`, [patientId]);
    score -= (activeAlerts.length * 10);

    // Bound the score between 0 and 100
    score = Math.max(0, Math.min(100, score));

    // Update patient
    await db.run(\`UPDATE patients SET wellnessScore = ? WHERE id = ?\`, [score, patientId]);
    
    // Update wellness history for today
    const history = await db.get(\`SELECT id FROM wellness_history WHERE patientId = ? AND date = ?\`, [patientId, dateStr]);
    if (history) {
      await db.run(\`UPDATE wellness_history SET wellnessScore = ? WHERE id = ?\`, [score, history.id]);
    }
    
    console.log(\`Calculated new wellness score for \${patientId}: \${score}\`);
    return score;
  } catch (err) {
    console.error('Error calculating wellness score:', err);
    return null;
  }
}
`;

// Insert the function before IN-MEMORY DATABASE block or after logAuditEvent
code = code.replace(/\/\/ ═══════════════════════════════════════════════════════════════════════\r?\n\/\/ IN-MEMORY DATABASE/, wellnessScoreFn + '\n// ═══════════════════════════════════════════════════════════════════════\n// IN-MEMORY DATABASE');

// Add call in POST /api/meds/:id/toggle
code = code.replace(
  /await db\.run\(\r?\n\s*\`INSERT INTO timeline.*?\'med\'\]\r?\n\s*\);\r?\n\s*const state = await getPatientState\(req\.activePatientId\);/g,
  `await db.run(
      \`INSERT INTO timeline (id, patientId, time, title, desc, type) VALUES (?, ?, ?, ?, ?, 'med')\`,
      [\`t-\${Date.now()}\`, req.activePatientId, timeStr(), \`Medication \${newTaken === 1 ? 'taken' : 'un-taken'}: \${med.name}\`, \`Updated by \${req.user?.name || 'Caregiver'}.\`, 'med']
    );

    await calculateDailyWellnessScore(req.activePatientId);
    const state = await getPatientState(req.activePatientId);`
);

// Add call in POST /api/nutrition
code = code.replace(
  /await db\.run\(\r?\n\s*\`INSERT INTO timeline.*?\'sensor\'\]\r?\n\s*\);\r?\n\s*} else {[\s\S]*?await db\.run\(\r?\n\s*\`INSERT INTO timeline.*?\'sensor\'\]\r?\n\s*\);\r?\n\s*}/g,
  `await db.run(
        \`INSERT INTO timeline (id, patientId, time, title, desc, type) VALUES (?, ?, ?, ?, ?, 'sensor')\`,
        [\`t-\${Date.now()}\`, req.activePatientId, timeStr(), 'Nutrition details updated', \`Water: \${waterIntake || 0} cups, Appetite: \${appetiteScore}/5\`, 'sensor']
      );
    } else {
      await db.run(
        \`INSERT INTO nutrition_logs (id, patientId, date, breakfast, lunch, dinner, snacks, waterIntake, appetiteScore, weight) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\`,
        [logId, req.activePatientId, dateStr, breakfast || '', lunch || '', dinner || '', snacks || '', waterIntake || 0, appetiteScore || 3, weight || 0]
      );
      await db.run(
        \`INSERT INTO timeline (id, patientId, time, title, desc, type) VALUES (?, ?, ?, ?, ?, 'sensor')\`,
        [\`t-\${Date.now()}\`, req.activePatientId, timeStr(), 'Nutrition logged', \`Water: \${waterIntake || 0} cups, Appetite: \${appetiteScore}/5\`, 'sensor']
      );
    }
    
    await calculateDailyWellnessScore(req.activePatientId);`
);

// Add call in POST /api/alerts/:id/resolve
code = code.replace(
  /await db\.run\(\r?\n\s*\`UPDATE alerts SET resolved = 1.*?\]\r?\n\s*\);/g,
  `await db.run(
      \`UPDATE alerts SET resolved = 1, resolvedAt = ?, resolvedBy = ? WHERE id = ? AND patientId = ?\`,
      [now().toISOString(), req.user?.name || 'Caregiver', id, req.activePatientId]
    );
    await calculateDailyWellnessScore(req.activePatientId);`
);

// Add call in PATCH /api/care-plans/:id/status
code = code.replace(
  /await db\.run\(\r?\n\s*\`UPDATE care_plans SET status = \?.*?\]\r?\n\s*\);\r?\n/g,
  `await db.run(
      \`UPDATE care_plans SET status = ?, completedToday = ? WHERE id = ? AND patientId = ?\`,
      [status, newCompletedToday, id, req.activePatientId]
    );
    await calculateDailyWellnessScore(req.activePatientId);
`
);

fs.writeFileSync(file, code);
console.log('Update wellness function complete.');
