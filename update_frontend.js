import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const file = path.join(__dirname, 'src', 'app', 'App.tsx');

let code = fs.readFileSync(file, 'utf8');

// Remove static moodData
code = code.replace(/const moodData = \[\s*\{ d: "Mon", v: 62 \}.*?\n\s*\{ d: "Thu", v: 64 \}.*?\n\];\r?\n/m, '');

// Add state for dynamic moodData
const stateCode = `const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryData, setSummaryData] = useState<any>(null);
  
  // Dynamic metrics
  const [plans, setPlans] = useState<any[]>([]);
  const [nutritionLog, setNutritionLog] = useState<any>(null);
  const [quickNote, setQuickNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [moodData, setMoodData] = useState<any[]>([{d:"Mon", v:50}]);`;

code = code.replace(/const \[generatingSummary, setGeneratingSummary\] = useState\(false\);[\s\S]*?const \[addingNote, setAddingNote\] = useState\(false\);/m, stateCode);

// Add fetch to useEffect
const effectCode = `useEffect(() => {
    apiFetch("/api/care-plans").then(r => r.json()).then(data => setPlans(data.carePlans || [])).catch(() => {});
    apiFetch("/api/nutrition").then(r => r.json()).then(data => {
      if (data.success) setNutritionLog(data.log);
    }).catch(() => {});
    apiFetch("/api/wellness/history?days=7").then(r => r.json()).then(data => {
      if (data.data && data.data.length > 0) {
        const mapped = data.data.slice().reverse().map((d: any) => ({
          d: new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' }),
          v: d.mood
        }));
        setMoodData(mapped);
      }
    }).catch(() => {});
  }, [patient]);`;

code = code.replace(/useEffect\(\(\) => \{[\s\S]*?\}, \[patient\]\);/m, effectCode);

fs.writeFileSync(file, code);
console.log('App.tsx updated dynamically.');
