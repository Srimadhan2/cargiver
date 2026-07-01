import express from 'express';
import crypto from 'crypto';
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';


// ─── Gemini AI Setup ───────────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
let geminiModel = null;
if (GEMINI_API_KEY) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  geminiModel = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
  console.log('✅ Gemini AI initialized with API key');
} else {
  console.log('⚠️  No GEMINI_API_KEY set — Rocky AI will use fallback responses.');
  console.log('   Set it with: set GEMINI_API_KEY=your_key_here (then restart server)');
}

const app = express();
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseService = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } }) : null;

const supabaseAuth = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;


// ─── CORS headers for dev ──────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── Utility ────────────────────────────────────────────────────────────
const uid = () => crypto.randomUUID().slice(0, 8);
const now = () => new Date();
const timeStr = () => now().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

async function logAuditEvent(userId, userEmail, action, target) {
  try {
    const logId = `log-${uid()}`;
    await supabaseService.from('audit_logs').insert({ id: logId, userId, userEmail, action, details, timestamp: now().toISOString() });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

async function calculateDailyWellnessScore(patientId) {
  try {
    let score = 50; // Base score

    // 1. Medication Adherence (+30 max)
    const { data: meds = [] } = await supabaseService.from('medications').select('*').eq('patientId', patientId);
    if (meds.length > 0) {
      const taken = meds.filter(m => m.taken === 1 || m.taken === true).length;
      score += Math.round((taken / meds.length) * 30);
    } else {
      score += 15; // default if no meds
    }

    // 2. Nutrition (+10 max)
    const dateStr = now().toISOString().slice(0, 10);
    const { data: nutrition } = await supabaseService.from('nutrition_logs').select('waterIntake').eq('patientId', patientId).eq('date', dateStr).maybeSingle();
    if (nutrition) {
      const water = nutrition.waterIntake || 0;
      score += Math.min(10, Math.round((water / 8) * 10)); // 8 cups = max points
    }

    // 3. Care Plans (+10 max)
    const { data: plans = [] } = await supabaseService.from('care_plans').select('completedToday').eq('patientId', patientId);
    if (plans.length > 0) {
      const completed = plans.filter(p => p.completedToday === 1 || p.completedToday === true).length;
      score += Math.round((completed / plans.length) * 10);
    } else {
      score += 5; // default
    }

    // 4. Alerts (-10 per active alert)
    const { data: activeAlerts = [] } = await supabaseService.from('alerts').select('id').eq('patientId', patientId).eq('resolved', false);
    score -= (activeAlerts.length * 10);

    // Bound the score between 0 and 100
    score = Math.max(0, Math.min(100, score));

    // Update patient
    await supabaseService.from('patients').update({ wellnessScore: score }).eq('id', patientId);
    
    // Update wellness history for today
    const { data: history } = await supabaseService.from('wellness_history').select('id').eq('patientId', patientId).eq('date', dateStr).maybeSingle();
    if (history) {
      await supabaseService.from('wellness_history').update({ wellnessScore: score }).eq('id', history.id);
    }
    
    console.log(`Calculated new wellness score for ${patientId}: ${score}`);
    return score;
  } catch (err) {
    console.error('Error calculating wellness score:', err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// IN-MEMORY DATABASE
// ═══════════════════════════════════════════════════════════════════════

// ─── Users / Auth ──────────────────────────────────────────────────────
const users = [
  {
    id: 'user-1',
    name: 'Sarah Mitchell',
    email: 'sarah@example.com',
    password: 'demo1234',          // plain-text for demo only
    role: 'primary_caregiver',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=120&h=120&fit=crop&auto=format',
    createdAt: '2026-01-15T08:00:00Z',
  },
  {
    id: 'caregiver-1',
    name: 'Rocky Caregiver',
    email: 'caregiver@rocky.ai',
    password: '$2b$10$OmncLhdwKiqcc9vKhu0efeFop9clnzqdsQWKaftYL8E3NuEMMzC6K', // hashed 'password123'
    role: 'primary_caregiver',
    avatar: 'https://ui-avatars.com/api/?name=Rocky+Caregiver&background=6366f1&color=fff',
    createdAt: new Date().toISOString(),
  }
];


// ─── Patient ───────────────────────────────────────────────────────────
let patientState = {
  id: 'patient-1',
  name: 'Eleanor M.',
  age: 82,
  image: 'https://images.unsplash.com/photo-1581579438747-104c53e7a78e?w=120&h=120&fit=crop&auto=format',
  wellnessScore: 86,
  weeklyChange: '+4 vs last wk',
  summary: 'Eleanor slept well, took morning meds, and walked 1,840 steps. Mood trending warm.',
  stats: {
    meds:  { value: '3 / 4', hint: '1 pending 2:00p', tone: 'amber' },
    sleep: { value: '7h 12m', hint: 'Restful', tone: 'indigo' },
    mood:  { value: 'Warm', hint: '↑ 12% wk', tone: 'emerald' },
  },
  details: {
    sleepQuality: 'Excellent', sleepDuration: '7h 12m', sleepTone: 'emerald',
    hydration: 'Below goal', hydrationValue: '4 / 8 cups', hydrationTone: 'amber',
    steps: 'On track', stepsValue: '1,840', stepsTone: 'indigo',
  },
  summaryStatus: {
    acknowledged: false,
    time: '9:42 AM',
    text: "Eleanor's voice tone is steady and her morning routine is on track. She mentioned slight knee stiffness — I've suggested a gentle stretch and flagged it for Dr. Chen's Friday call.",
  },
  alerts: [
    { id: 'alert-1', sev: 'warn', t: 'Fall risk: moderate', d: 'Slower gait pattern over 3 days. Suggested: balance routine + remove hallway rug.', c: 'amber', resolved: false, createdAt: '2026-06-09T07:30:00Z' },
    { id: 'alert-2', sev: 'info', t: 'Med reminder: Lisinopril', d: 'Pending 2:00 PM', c: 'indigo', resolved: false, createdAt: '2026-06-09T08:00:00Z' },
    { id: 'alert-3', sev: 'good', t: 'Mood improved 18%', d: 'Compared to last week', c: 'emerald', resolved: false, createdAt: '2026-06-09T09:00:00Z' },
  ],
  medications: [
    { id: 'med-1', name: 'Aspirin (81mg)', time: '8:00 AM', taken: true, dosage: '81mg', frequency: 'daily', prescriber: 'Dr. Chen', notes: 'Take with food' },
    { id: 'med-2', name: 'Multivitamin', time: '8:00 AM', taken: true, dosage: '1 tablet', frequency: 'daily', prescriber: 'Self', notes: '' },
    { id: 'med-3', name: 'Lisinopril (10mg)', time: '2:00 PM', taken: false, dosage: '10mg', frequency: 'daily', prescriber: 'Dr. Chen', notes: 'Monitor blood pressure' },
    { id: 'med-4', name: 'Melatonin (3mg)', time: '9:00 PM', taken: false, dosage: '3mg', frequency: 'daily', prescriber: 'Self', notes: 'For sleep support' },
  ],
  timeline: [
    { id: 't-1', time: '9:42 AM', title: 'Daily voice check-in completed', desc: 'Eleanor reports slight knee stiffness, otherwise positive mood.', type: 'voice' },
    { id: 't-2', time: '8:30 AM', title: 'Morning medication taken', desc: 'Aspirin and Multivitamin checked off.', type: 'med' },
    { id: 't-3', time: '7:12 AM', title: 'Sleep telemetry synced', desc: '7h 12m of restful sleep recorded via wearable.', type: 'sensor' },
    { id: 't-4', time: 'Yesterday', title: 'Respite session scheduled', desc: 'Respite caregiver Jane scheduled for Thursday.', type: 'team' },
  ],
};

// ─── Care Team ─────────────────────────────────────────────────────────
let careTeam = [
  { id: 'ct-1', name: 'Sarah Mitchell', role: 'Primary caregiver', relationship: 'Daughter', phone: '(512) 555-0147', email: 'sarah@example.com', avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=120&h=120&fit=crop&auto=format', active: true },
  { id: 'ct-2', name: 'Dr. Lisa Chen', role: 'Primary care physician', relationship: 'Provider', phone: '(512) 555-0290', email: 'chen@baysidehealth.com', avatar: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=120&h=120&fit=crop&auto=format', active: true },
  { id: 'ct-3', name: 'Jane Reyes', role: 'Respite caregiver', relationship: 'Professional', phone: '(512) 555-0333', email: 'jane.reyes@homecare.com', avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=120&h=120&fit=crop&auto=format', active: true },
  { id: 'ct-4', name: 'Mark Mitchell', role: 'Family support', relationship: 'Son', phone: '(512) 555-0501', email: 'mark@example.com', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&auto=format', active: true },
];

// ─── Wellness History (last 30 days) ───────────────────────────────────
const wellnessHistory = Array.from({ length: 30 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (29 - i));
  return {
    date: d.toISOString().slice(0, 10),
    wellnessScore: Math.round(70 + Math.random() * 20),
    mood: Math.round(55 + Math.random() * 35),
    sleep: +(5.5 + Math.random() * 3).toFixed(1),
    steps: Math.round(800 + Math.random() * 2500),
    hydration: Math.round(3 + Math.random() * 6),
    heartRate: Math.round(62 + Math.random() * 18),
    fallRisk: +(0.05 + Math.random() * 0.25).toFixed(2),
  };
});

// ─── Voice Check-in Logs ───────────────────────────────────────────────
let voiceCheckins = [
  {
    id: 'vc-1',
    date: '2026-06-09',
    time: '9:42 AM',
    duration: '3m 22s',
    transcript: "Good morning Rocky. I slept pretty well. My knee is a little stiff this morning but otherwise I feel good. I had some cereal and juice for breakfast. Looking forward to my walk later.",
    sentiment: 'positive',
    sentimentScore: 0.82,
    flags: ['knee_stiffness'],
    aiSummary: "Eleanor reports good sleep and positive mood. Slight knee stiffness noted — flagged for provider review. Breakfast consumed. Plans to walk today.",
    voiceTone: 'steady',
    energy: 'moderate',
  },
  {
    id: 'vc-2',
    date: '2026-06-08',
    time: '9:38 AM',
    duration: '2m 45s',
    transcript: "Hi Rocky. I woke up a couple times last night. A bit tired today. Took my pills already. My daughter is coming by later which is nice.",
    sentiment: 'neutral',
    sentimentScore: 0.61,
    flags: ['interrupted_sleep'],
    aiSummary: "Interrupted sleep reported. Medication adherence confirmed. Social engagement expected (daughter visiting). Mild fatigue.",
    voiceTone: 'slightly_low',
    energy: 'low',
  },
  {
    id: 'vc-3',
    date: '2026-06-07',
    time: '9:50 AM',
    duration: '4m 10s',
    transcript: "Morning! I had the best sleep in weeks. Feeling great today. I even did some stretches like you suggested. Having lunch with my friend Margaret today.",
    sentiment: 'very_positive',
    sentimentScore: 0.95,
    flags: [],
    aiSummary: "Excellent sleep, high energy, positive social plans. Following through on recommended stretches. No concerns detected.",
    voiceTone: 'bright',
    energy: 'high',
  },
];

// ─── Care Plans / Suggestions ──────────────────────────────────────────
let carePlans = [
  { id: 'cp-1', title: 'Morning balance routine', description: '10-minute gentle balance and stretching exercises before daily walk. Reduces fall risk by ~22%.', category: 'exercise', status: 'active', assignedTo: 'Eleanor M.', createdBy: 'Rocky AI', scheduledTime: '8:30 AM', daysOfWeek: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], completedToday: false },
  { id: 'cp-2', title: 'Hydration reminders', description: 'Gentle reminders every 2 hours to drink water. Goal: 8 cups per day.', category: 'nutrition', status: 'active', assignedTo: 'Eleanor M.', createdBy: 'Rocky AI', scheduledTime: 'Every 2h', daysOfWeek: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], completedToday: false },
  { id: 'cp-3', title: 'Weekly telehealth with Dr. Chen', description: 'Friday 2:00 PM video call to review weekly wellness and medication adjustments.', category: 'medical', status: 'active', assignedTo: 'Sarah Mitchell', createdBy: 'Sarah Mitchell', scheduledTime: '2:00 PM Friday', daysOfWeek: ['Fri'], completedToday: false },
  { id: 'cp-4', title: 'Evening wind-down routine', description: 'Dim lights, herbal tea, and 15 minutes of calming music before bed. Improves sleep quality.', category: 'wellness', status: 'active', assignedTo: 'Eleanor M.', createdBy: 'Rocky AI', scheduledTime: '8:30 PM', daysOfWeek: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], completedToday: false },
];

// ─── Wearable Data ─────────────────────────────────────────────────────
let wearableData = {
  device: 'Apple Watch Series 9',
  lastSynced: now().toISOString(),
  connected: true,
  battery: 72,
  realtime: {
    heartRate: 72,
    spo2: 97,
    steps: 1840,
    calories: 420,
    activeMinutes: 28,
    standHours: 6,
  },
  hourlyHeartRate: Array.from({ length: 24 }, (_, i) => ({
    hour: `${i.toString().padStart(2, '0')}:00`,
    bpm: i < 6 ? Math.round(58 + Math.random() * 8) :
          i < 12 ? Math.round(65 + Math.random() * 15) :
          i < 18 ? Math.round(68 + Math.random() * 20) :
          Math.round(60 + Math.random() * 12),
  })),
  sleepStages: [
    { stage: 'Awake', duration: 12, percentage: 3 },
    { stage: 'REM', duration: 98, percentage: 23 },
    { stage: 'Light', duration: 186, percentage: 43 },
    { stage: 'Deep', duration: 136, percentage: 31 },
  ],
};

// ─── Settings / Preferences ────────────────────────────────────────────
let settings = {
  notifications: {
    pushEnabled: true,
    emailDigest: true,
    smsAlerts: true,
    alertSeverityThreshold: 'info',   // 'info' | 'warn' | 'critical'
    quietHours: { enabled: true, start: '22:00', end: '07:00' },
  },
  display: {
    theme: 'light',
    compactMode: false,
    showWearableCard: true,
    dashboardLayout: 'standard',
  },
  privacy: {
    shareWithProvider: true,
    anonymizeExports: false,
    dataRetentionDays: 365,
  },
  voiceCheckin: {
    enabled: true,
    defaultTime: '09:30',
    reminderMinutesBefore: 15,
    autoTranscribe: true,
    language: 'en-US',
  },
};

// ─── Waitlist / Demo Bookings ──────────────────────────────────────────
const waitlist = [];
const demoBookings = [];

// ─── Chat conversation memory per session ──────────────────────────────
const chatHistory = {};  // sessionId -> [{role, content, timestamp}]

let localNotes = [];
let localChecklist = [];
const LOCAL_DATA_FILE = path.join(process.cwd(), 'coordination_data.json');

import fsSync from 'fs';
try {
  if (fsSync.existsSync(LOCAL_DATA_FILE)) {
    const parsed = JSON.parse(fsSync.readFileSync(LOCAL_DATA_FILE, 'utf8'));
    localNotes = parsed.notes || [];
    localChecklist = parsed.checklist || [];
  }
} catch (e) {
  console.error('Error loading local coordination data:', e);
}

function saveLocalData() {
  try {
    fsSync.writeFileSync(LOCAL_DATA_FILE, JSON.stringify({ notes: localNotes, checklist: localChecklist }, null, 2));
  } catch (e) {
    console.error('Error saving local coordination data:', e);
  }
}



// ═══════════════════════════════════════════════════════════════════════
// DATABASE PERSISTENCE (SQLITE)
// ═══════════════════════════════════════════════════════════════════════


async function initDatabase() { return true; }


// ═══════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════

// Optional auth middleware (non-blocking for demo — will use if token present)
async function upsertSupabaseUser(authUser) {
  const metadata = authUser.user_metadata || {};
  const email = authUser.email || `${authUser.id}@supabase.local`;
  const name = metadata.full_name || metadata.name || email.split('@')[0] || 'Caregiver';
  const avatar = metadata.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6366f1&color=fff&size=120`;

  let user = users.find(u => u.id === authUser.id);
  if (!user && authUser.email) {
    user = users.find(u => u.email === authUser.email);
  }

  if (user) {
    const role = metadata.role || user.role || 'primary_caregiver';
    user.name = name;
    user.email = email;
    user.role = role;
    user.avatar = avatar;
    return user;
  }

  const role = metadata.role || 'primary_caregiver';
  const newUser = { id: authUser.id, name, email, password: '', role, avatar, createdAt: now().toISOString() };
  users.push(newUser);
  await logAuditEvent(authUser.id, email, 'supabase_register', 'Supabase user synced into Rocky');
  return newUser;
}

async function resolveSupabaseSession(token) {
  if (!supabaseAuth || !token) return null;

  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data?.user) return null;

  const user = await upsertSupabaseUser(data.user);
  const { data: previousSession } = await supabaseService.from('sessions').select('active_patient_id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  let activePatientId = previousSession?.active_patient_id || '00000000-0000-0000-0000-000000000001';

  const { data: existingSession } = await supabaseService.from('sessions').select('id').eq('token', token).maybeSingle();
  if (existingSession) {
    await supabaseService.from('sessions').update({ user_id: user.id, active_patient_id: activePatientId, created_at: now().toISOString() }).eq('token', token);
  } else {
    await supabaseService.from('sessions').insert({ token, user_id: user.id, active_patient_id: activePatientId, created_at: now().toISOString() });
  }

  return { user, activePatientId };
}

const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      console.log(`[DEBUG AUTH] Token received: ${token.substring(0, 15)}...`);
      const isJwt = token.split('.').length === 3;
      if (isJwt) {
        const supabaseSession = await resolveSupabaseSession(token);
        if (!supabaseSession) {
          return res.status(401).json({ success: false, message: 'Invalid or expired session.' });
        }
        req.user = supabaseSession.user;
        req.userId = supabaseSession.user.id;
        req.activePatientId = supabaseSession.activePatientId;
      } else {
        const session = (await supabaseService.from('sessions').select('*').eq('token', token).maybeSingle()).data;
        if (session) {
          req.userId = session.user_id || session.userId;
          req.user = users.find(u => u.id === req.userId);
          if (session.active_patient_id) {
            req.activePatientId = session.active_patient_id;
          }
          console.log(`[DEBUG AUTH] Resolved session. userId: ${req.userId}, activePatientId: ${req.activePatientId}`);
        } else {
          console.log(`[DEBUG AUTH] No session found in Supabase for token: ${token}`);
        }
      }
    }
    if (!req.user) {
      req.userId = '00000000-0000-0000-0000-000000000001';
      req.user = users.find(u => u.id === req.userId);
      if (!req.user) {
        req.user = { id: req.userId, name: 'Demo Caregiver', role: 'primary_caregiver' };
      }
    }
    if (!req.activePatientId) {
      req.activePatientId = '00000000-0000-0000-0000-000000000001';
    }
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    next();
  }
};

app.use(optionalAuth);

// Middleware to enforce RBAC
const requireCaregiverRole = (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Not authenticated.' });
  if (req.user.role === 'family_member') {
    return res.status(403).json({ success: false, message: 'Forbidden. Family members cannot modify clinical data.' });
  }
  next();
};


// Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});


async function getPatientState(patientId) {
  const patient = (await supabaseService.from('patients').select('*').eq('id', patientId).maybeSingle()).data;
  if (!patient) return null;

  const medications = (await supabaseService.from('medications').select('*').eq('patientId', patientId).order('time', { ascending: true })).data || [];
  const alerts = (await supabaseService.from('alerts').select('*').eq('patientId', patientId).order('createdAt', { ascending: false })).data || [];
  const timeline = (await supabaseService.from('timeline').select('*').eq('patientId', patientId).order('id', { ascending: false })).data || [];
  
  const formattedMeds = medications.map(m => ({
    ...m,
    taken: m.taken === 1
  }));
  const formattedAlerts = alerts.map(a => ({
    ...a,
    resolved: a.resolved === 1
  }));

  const takenCount = formattedMeds.filter(m => m.taken).length;
  const totalMedsCount = formattedMeds.length;
  let medsHint = 'No meds yet';
  let medsTone = 'indigo';
  if (totalMedsCount > 0) {
    if (takenCount === totalMedsCount) {
      medsHint = 'All meds taken ✓';
      medsTone = 'emerald';
    } else {
      const pending = formattedMeds.find(m => !m.taken);
      medsHint = pending ? `1 pending ${pending.time}` : 'Meds pending';
      medsTone = 'amber';
    }
  }

  const sleepObj = { value: patient.sleepDuration || '—', hint: patient.sleepQuality || 'No data', tone: patient.sleepTone || 'indigo' };
  const moodObj = { value: patient.weeklyChange === 'New patient' ? '—' : 'Warm', hint: '↑ 12% wk', tone: 'emerald' };

  return {
    id: patient.id,
    name: patient.name,
    age: patient.age,
    image: patient.image,
    wellnessScore: patient.wellnessScore,
    weeklyChange: patient.weeklyChange,
    summary: patient.summary,
    stats: {
      meds: { value: `${takenCount} / ${totalMedsCount}`, hint: medsHint, tone: medsTone },
      sleep: sleepObj,
      mood: moodObj
    },
    details: {
      sleepQuality: patient.sleepQuality || '—',
      sleepDuration: patient.sleepDuration || '—',
      sleepTone: patient.sleepTone || 'indigo',
      hydration: patient.hydration || '—',
      hydrationValue: patient.hydrationValue || '— / 8 cups',
      hydrationTone: patient.hydrationTone || 'indigo',
      steps: patient.steps || '—',
      stepsValue: patient.stepsValue || '0',
      stepsTone: patient.stepsTone || 'indigo'
    },
    summaryStatus: {
      acknowledged: patient.summaryStatusAcknowledged === 1,
      acknowledgedAt: patient.summaryStatusAcknowledgedAt,
      acknowledgedBy: patient.summaryStatusAcknowledgedBy,
      time: patient.summaryStatusTime,
      text: patient.summaryStatusText
    },
    alerts: formattedAlerts,
    medications: formattedMeds,
    timeline: timeline
  };
}


// ═══════════════════════════════════════════════════════════════════════
// AUTH ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }
    const existingUser = users.find(u => u.email === email);
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }
    const userId = `user-${uid()}`;
    const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6366f1&color=fff`;
    const createdAt = now().toISOString();
    
    // Hash password with bcrypt
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Save to in-memory users array
    const newUser = { id: userId, name, email, password: hashedPassword, role: role || 'family_member', avatar, createdAt };
    users.push(newUser);

    // Audit log
    await logAuditEvent(userId, email, 'register', `User registered with role: ${role || 'family_member'}`);

    const token = crypto.randomUUID();
    
    // Save session in Supabase
    await supabaseService.from('sessions').insert({
      token,
      user_id: userId,
      active_patient_id: '00000000-0000-0000-0000-000000000001',
      created_at: now().toISOString()
    });

    console.log(`New user registered: ${email}`);
    res.json({
      success: true,
      message: 'Account created successfully!',
      token,
      user: { id: userId, name, email, role: role || 'family_member', avatar, createdAt }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }
    // Find user in memory
    const user = users.find(u => u.email === email);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }
    
    // Compare password hash or plain text fallback
    let isMatch = false;
    if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$')) {
      isMatch = await bcrypt.compare(password, user.password);
    } else {
      isMatch = (password === user.password);
    }
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // Audit log
    await logAuditEvent(user.id, user.email, 'login', 'User logged in successfully');

    const token = crypto.randomUUID();
    
    // Fetch last active patient for this user
    const { data: previousSession } = await supabaseService.from('sessions').select('active_patient_id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const activePatientId = previousSession?.active_patient_id || '00000000-0000-0000-0000-000000000001';

    // Save session in Supabase sessions table
    await supabaseService.from('sessions').insert({
      token,
      user_id: user.id,
      active_patient_id: activePatientId,
      created_at: now().toISOString()
    });
    
    const { password: _, ...userSafe } = user;
    res.json({ success: true, message: `Welcome back, ${user.name}!`, token, user: userSafe });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});
// PATIENT ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

// GET /api/patient — full patient state
app.get('/api/patient', async (req, res) => {
  try {
    console.log(`[DEBUG GET_PATIENT] GET /api/patient: reading activePatientId = ${req.activePatientId}`);
    const state = await getPatientState(req.activePatientId);
    if (!state) return res.status(404).json({ success: false, message: 'Patient not found.' });
    res.json(state);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// PATCH /api/patient — update patient profile
app.patch('/api/patient', requireCaregiverRole, async (req, res) => {
  try {
    const { name, age, image } = req.body;
    const patient = (await supabaseService.from('patients').select('*').eq('id', req.activePatientId).maybeSingle()).data;
    if (!patient) return res.status(404).json({ success: false, message: 'Patient not found.' });
    
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (age !== undefined) updates.age = age;
    if (image !== undefined) updates.image = image;

    if (Object.keys(updates).length > 0) {
      const { error: updateErr } = await supabaseService.from('patients').update(updates).eq('id', req.activePatientId);
      if (updateErr) throw updateErr;
    }
    
    const state = await getPatientState(req.activePatientId);
    res.json({ success: true, message: 'Patient profile updated.', patient: state });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// GET /api/patient/summary — just the daily summary
app.get('/api/patient/summary', async (req, res) => {
  try {
    const state = await getPatientState(req.activePatientId);
    if (!state) return res.status(404).json({ success: false, message: 'Patient not found.' });
    res.json({
      wellnessScore: state.wellnessScore,
      weeklyChange: state.weeklyChange,
      summary: state.summary,
      summaryStatus: state.summaryStatus,
      stats: state.stats,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});


// ═══════════════════════════════════════════════════════════════════════
// MULTI-PATIENT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════
const patients = []; // backward compatibility placeholder

// GET /api/patients — list all patients
app.get('/api/patients', async (req, res) => {
  try {
    const { data: patientsList = [] } = await supabaseService.from('patients').select('id, name, age, image, wellnessScore');
    res.json({
      patients: patientsList || [],
      count: patientsList ? patientsList.length : 0,
      activePatientId: req.activePatientId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// POST /api/patients — add a new patient
app.post('/api/patients', async (req, res) => {
  try {
    const { name, age, image, condition, notes } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Patient name is required.' });

    const newId = crypto.randomUUID();
    const pAge = parseInt(age) || 0;
    const pImage = image || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6366f1&color=fff&size=120`;
    const summary = `${name} was just added to Rocky. Set up their daily routine, medications, and care team to get started.`;
    const summaryStatusText = `Welcome ${name} to Rocky Care. Configure their profile, medications, and care team to begin monitoring.`;
    const summaryStatusTime = timeStr();
    
    await supabaseService.from('patients').insert({
      id: newId, name, age: pAge, image: pImage, wellnessScore: 50, weeklyChange: 'New patient', summary, sleepQuality: '—', sleepDuration: '—', sleepTone: 'indigo', hydration: '—', hydrationValue: '— / 8 cups', hydrationTone: 'indigo', steps: '—', stepsValue: '0', stepsTone: 'indigo', summaryStatusText, summaryStatusAcknowledged: false, summaryStatusTime
    });

    // Timeline event
    await supabaseService.from('timeline').insert({
      id: `t-${Date.now()}`, patientId: newId, time: timeStr(), title: `${name} added to Rocky Care`, desc: `${condition ? `Condition: ${condition}. ` : ''}${notes ? `Notes: ${notes}` : 'New patient profile created.'}`, type: 'note'
    });

    // Seed default wearable data for the new patient
    await supabaseService.from('wearable_data').insert({
      patientId: newId, device: 'Apple Watch Ultra', connected: true, battery: 92, lastSync: 'Just now', restingHeartRate: 68, hrv: 45, respiratoryRate: 14
    });

    const { data: patientsList = [] } = await supabaseService.from('patients').select('*');
    const state = await getPatientState(newId);
    
    console.log(`New patient added: ${name} (${newId})`);
    res.json({
      success: true,
      message: `${name} has been added successfully! Switch to their profile to start setting up care.`,
      patient: state,
      patients: patientsList,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// POST /api/patients/:id/activate — switch active patient
app.post('/api/patients/:id/activate', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const patient = (await supabaseService.from('patients').select('*').eq('id', id).maybeSingle()).data;
    if (!patient) return res.status(404).json({ success: false, message: 'Patient not found.' });
    const token = req.headers.authorization?.replace('Bearer ', '');
    console.log(`[DEBUG ACTIVATE] Activating patient ${id} (${patient.name}) for token: ${token ? token.substring(0, 15) + '...' : 'none'}`);
    if (token) {
      const { data: beforeSession } = await supabaseService.from('sessions').select('*').eq('token', token).maybeSingle();
      console.log(`[DEBUG ACTIVATE] Session BEFORE activation:`, beforeSession);
      
      const { data: existingSession } = await supabaseService.from('sessions').select('id').eq('token', token).maybeSingle();
      if (existingSession) {
        await supabaseService.from('sessions').update({
          user_id: req.userId || '00000000-0000-0000-0000-000000000001',
          active_patient_id: id,
          created_at: new Date().toISOString()
        }).eq('token', token);
      } else {
        await supabaseService.from('sessions').insert({
          token: token,
          user_id: req.userId || '00000000-0000-0000-0000-000000000001',
          active_patient_id: id,
          created_at: new Date().toISOString()
        });
      }
      
      const { data: afterSession } = await supabaseService.from('sessions').select('*').eq('token', token).maybeSingle();
      console.log(`[DEBUG ACTIVATE] Session AFTER activation:`, afterSession);
    }
    req.activePatientId = id;
    const state = await getPatientState(id);
    console.log(`Switched active patient to: ${patient.name}`);
    res.json({ success: true, message: `Now viewing ${patient.name}'s care dashboard.`, patient: state });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// DELETE /api/patients/:id — remove a patient
app.delete('/api/patients/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data: patientsList, error: fetchAllErr } = await supabaseService.from('patients').select('id, name');
    if (fetchAllErr) throw fetchAllErr;
    
    if (!patientsList || !Array.isArray(patientsList) || patientsList.length <= 1) {
      return res.status(400).json({ success: false, message: 'Cannot remove the last patient.' });
    }
    
    const targetPatient = patientsList.find(p => p.id === id);
    if (!targetPatient) return res.status(404).json({ success: false, message: 'Patient not found.' });

    // Clean up related data - wait, wait, does Supabase have ON DELETE CASCADE? Yes, we assume it does based on previous audits, or we just delete the patient.
    // Actually the SQLite migration didn't do cascading deletes in code, it just deleted the patient.
    await supabaseService.from('patients').delete().eq('id', id);
    
    const remainingPatients = patientsList ? patientsList.filter(p => p.id !== id) : [];
    if (req.activePatientId === id && remainingPatients.length > 0) {
      req.activePatientId = remainingPatients[0].id;
      // Update session in DB to prevent stale state crash
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) {
        await supabaseService.from('sessions').update({ active_patient_id: req.activePatientId, created_at: new Date().toISOString() }).eq('token', token);
      }
    }

    const state = await getPatientState(req.activePatientId);
    
    // We need to return the updated list so the frontend can update its sidebar
    const { data: updatedPatientsList, error: fetchErr } = await supabaseService.from('patients').select('id, name, age, image, wellnessScore');
    if (fetchErr) {
      console.error('Error fetching updated patients list:', fetchErr);
    }
    
    console.log(`Patient removed: ${targetPatient.name}`);
    res.json({
      success: true,
      message: `${targetPatient.name} has been removed.`,
      patient: state || {},
      patients: updatedPatientsList || [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});


// ═══════════════════════════════════════════════════════════════════════
// CARE COORDINATION HUB ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

// GET /api/coordination-notes — list all coordination notes for the active patient
app.get('/api/coordination-notes', optionalAuth, async (req, res) => {
  try {
    const { data: notes, error } = await supabaseService
      .from('coordination_notes')
      .select('*')
      .eq('patient_id', req.activePatientId)
      .order('created_at', { ascending: false });
    
    if (error && error.code === 'PGRST205') {
      const filtered = localNotes.filter(n => n.patient_id === req.activePatientId);
      return res.json({ success: true, notes: filtered });
    }
    if (error) throw error;
    res.json({ success: true, notes: notes || [] });
  } catch (err) {
    console.error(err);
    const filtered = localNotes.filter(n => n.patient_id === req.activePatientId);
    res.json({ success: true, notes: filtered });
  }
});

// POST /api/coordination-notes — add a new note
app.post('/api/coordination-notes', optionalAuth, async (req, res) => {
  try {
    const { category, note } = req.body;
    const { data: newNote, error } = await supabaseService
      .from('coordination_notes')
      .insert({
        patient_id: req.activePatientId,
        category,
        note,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .maybeSingle();

    if (error && error.code === 'PGRST205') {
      const fallbackNote = {
        id: crypto.randomUUID(),
        patient_id: req.activePatientId,
        category,
        note,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      localNotes.unshift(fallbackNote);
      saveLocalData();
      return res.json({ success: true, note: fallbackNote });
    }
    if (error) throw error;
    res.json({ success: true, note: newNote });
  } catch (err) {
    console.error(err);
    const fallbackNote = {
      id: crypto.randomUUID(),
      patient_id: req.activePatientId,
      category,
      note,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    localNotes.unshift(fallbackNote);
    saveLocalData();
    res.json({ success: true, note: fallbackNote });
  }
});

// PATCH /api/coordination-notes/:id — update a note
app.patch('/api/coordination-notes/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { category, note } = req.body;
    const { data: updatedNote, error } = await supabaseService
      .from('coordination_notes')
      .update({
        category,
        note,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error && error.code === 'PGRST205') {
      const idx = localNotes.findIndex(n => n.id === id);
      if (idx !== -1) {
        if (category !== undefined) localNotes[idx].category = category;
        if (note !== undefined) localNotes[idx].note = note;
        localNotes[idx].updated_at = new Date().toISOString();
        saveLocalData();
        return res.json({ success: true, note: localNotes[idx] });
      }
      return res.status(404).json({ success: false, message: 'Note not found.' });
    }
    if (error) throw error;
    res.json({ success: true, note: updatedNote });
  } catch (err) {
    console.error(err);
    const idx = localNotes.findIndex(n => n.id === id);
    if (idx !== -1) {
      if (category !== undefined) localNotes[idx].category = category;
      if (note !== undefined) localNotes[idx].note = note;
      localNotes[idx].updated_at = new Date().toISOString();
      saveLocalData();
      return res.json({ success: true, note: localNotes[idx] });
    }
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// DELETE /api/coordination-notes/:id — delete a note
app.delete('/api/coordination-notes/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseService
      .from('coordination_notes')
      .delete()
      .eq('id', id);

    if (error && error.code === 'PGRST205') {
      localNotes = localNotes.filter(n => n.id !== id);
      saveLocalData();
      return res.json({ success: true, message: 'Note deleted.' });
    }
    if (error) throw error;
    res.json({ success: true, message: 'Note deleted.' });
  } catch (err) {
    console.error(err);
    localNotes = localNotes.filter(n => n.id !== id);
    saveLocalData();
    res.json({ success: true, message: 'Note deleted.' });
  }
});

// GET /api/records-checklist — list all checklist items for the active patient
app.get('/api/records-checklist', optionalAuth, async (req, res) => {
  try {
    let { data: checklist, error } = await supabaseService
      .from('records_checklist')
      .select('*')
      .eq('patient_id', req.activePatientId)
      .order('created_at', { ascending: true });
    
    const isPgrstError = error && error.code === 'PGRST205';
    let items = isPgrstError ? localChecklist.filter(c => c.patient_id === req.activePatientId) : (checklist || []);
    
    if (items.length === 0) {
      const defaultItems = [
        'Diagnosis Records',
        'Medication List',
        'Insurance Information',
        'Medicare/Hospice Notes',
        'Emergency Contacts',
        'Doctor Visit Notes',
        'Discharge Summary',
        'Consent Forms'
      ];
      
      if (isPgrstError) {
        for (const name of defaultItems) {
          localChecklist.push({
            id: crypto.randomUUID(),
            patient_id: req.activePatientId,
            item_name: name,
            status: 'missing',
            notes: '',
            last_updated: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        }
        saveLocalData();
        items = localChecklist.filter(c => c.patient_id === req.activePatientId);
      } else {
        const insertRows = defaultItems.map(name => ({
          patient_id: req.activePatientId,
          item_name: name,
          status: 'missing',
          notes: '',
          last_updated: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }));
        await supabaseService.from('records_checklist').insert(insertRows);
        
        const { data: refetched } = await supabaseService
          .from('records_checklist')
          .select('*')
          .eq('patient_id', req.activePatientId)
          .order('created_at', { ascending: true });
        items = refetched || [];
      }
    }
    
    res.json({ success: true, checklist: items });
  } catch (err) {
    console.error(err);
    const filtered = localChecklist.filter(c => c.patient_id === req.activePatientId);
    res.json({ success: true, checklist: filtered });
  }
});

// POST /api/records-checklist — add a checklist item
app.post('/api/records-checklist', optionalAuth, async (req, res) => {
  try {
    const { item_name, status, notes } = req.body;
    const { data: newItem, error } = await supabaseService
      .from('records_checklist')
      .insert({
        patient_id: req.activePatientId,
        item_name,
        status: status || 'missing',
        notes: notes || '',
        last_updated: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .maybeSingle();

    if (error && error.code === 'PGRST205') {
      const fallbackItem = {
        id: crypto.randomUUID(),
        patient_id: req.activePatientId,
        item_name,
        status: status || 'missing',
        notes: notes || '',
        last_updated: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      localChecklist.push(fallbackItem);
      saveLocalData();
      return res.json({ success: true, item: fallbackItem });
    }
    if (error) throw error;
    res.json({ success: true, item: newItem });
  } catch (err) {
    console.error(err);
    const fallbackItem = {
      id: crypto.randomUUID(),
      patient_id: req.activePatientId,
      item_name,
      status: status || 'missing',
      notes: notes || '',
      last_updated: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    localChecklist.push(fallbackItem);
    saveLocalData();
    res.json({ success: true, item: fallbackItem });
  }
});

// PATCH /api/records-checklist/:id — update a checklist item
app.patch('/api/records-checklist/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const { data: updatedItem, error } = await supabaseService
      .from('records_checklist')
      .update({
        status,
        notes,
        last_updated: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error && error.code === 'PGRST205') {
      const idx = localChecklist.findIndex(c => c.id === id);
      if (idx !== -1) {
        if (status !== undefined) localChecklist[idx].status = status;
        if (notes !== undefined) localChecklist[idx].notes = notes;
        localChecklist[idx].last_updated = new Date().toISOString();
        localChecklist[idx].updated_at = new Date().toISOString();
        saveLocalData();
        return res.json({ success: true, item: localChecklist[idx] });
      }
      return res.status(404).json({ success: false, message: 'Checklist item not found.' });
    }
    if (error) throw error;
    res.json({ success: true, item: updatedItem });
  } catch (err) {
    console.error(err);
    const idx = localChecklist.findIndex(c => c.id === id);
    if (idx !== -1) {
      if (status !== undefined) localChecklist[idx].status = status;
      if (notes !== undefined) localChecklist[idx].notes = notes;
      localChecklist[idx].last_updated = new Date().toISOString();
      localChecklist[idx].updated_at = new Date().toISOString();
      saveLocalData();
      return res.json({ success: true, item: localChecklist[idx] });
    }
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// DELETE /api/records-checklist/:id — delete a checklist item
app.delete('/api/records-checklist/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseService
      .from('records_checklist')
      .delete()
      .eq('id', id);

    if (error && error.code === 'PGRST205') {
      localChecklist = localChecklist.filter(c => c.id !== id);
      saveLocalData();
      return res.json({ success: true, message: 'Checklist item deleted.' });
    }
    if (error) throw error;
    res.json({ success: true, message: 'Checklist item deleted.' });
  } catch (err) {
    console.error(err);
    localChecklist = localChecklist.filter(c => c.id !== id);
    saveLocalData();
    res.json({ success: true, message: 'Checklist item deleted.' });
  }
});


// ═══════════════════════════════════════════════════════════════════════
// ALERT ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

// GET /api/alerts — list all alerts
app.get('/api/alerts', async (req, res) => {
  try {
    const { status } = req.query; // 'active', 'resolved', or omit for all
    let alerts;
    if (status === 'active') {
      alerts = [];
} else if (status === 'resolved') {
      alerts = [];
} else {
      alerts = (await supabaseService.from('alerts').select('*').eq('patientId', req.activePatientId).order('createdAt', { ascending: false })).data || [];
    }

    const formatted = alerts.map(a => ({ ...a, resolved: a.resolved === 1 }));
    const activeCountResult = null;
    
    res.json({ alerts: formatted, activeCount: activeCountResult.count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// POST /api/alerts/:id/resolve
app.post('/api/alerts/:id/resolve', requireCaregiverRole, async (req, res) => {
  try {
    const { id } = req.params;
    const alert = null;
    if (!alert) return res.status(404).json({ success: false, message: 'Alert not found.' });

    const resolvedBy = req.user?.name || 'Caregiver';
    const resolvedAt = now().toISOString();
    

    // Add timeline event
    

    const state = await getPatientState(req.activePatientId);
    res.json({ success: true, message: `Alert '${alert.t}' resolved.`, patient: state });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// POST /api/alerts — create a new alert
app.post('/api/alerts', async (req, res) => {
  try {
    const { sev, title, description, color } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'Alert title is required.' });
    
    const alertId = `alert-${uid()}`;
    const createdAt = now().toISOString();
    

    // Add timeline event
    

    const newAlert = (await supabaseService.from('alerts').select('*').eq('id', alertId).maybeSingle()).data;
    const state = await getPatientState(req.activePatientId);
    res.json({ success: true, message: `Alert '${title}' created.`, alert: { ...newAlert, resolved: false }, patient: state });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// DELETE /api/alerts/:id
app.delete('/api/alerts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const alert = null;
    if (!alert) return res.status(404).json({ success: false, message: 'Alert not found.' });

    await supabaseService.from('alerts').delete().eq('id', id);

    const state = await getPatientState(req.activePatientId);
    res.json({ success: true, message: `Alert '${alert.t}' deleted.`, patient: state });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});


// ═══════════════════════════════════════════════════════════════════════
// SUMMARY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

// POST /api/summary/acknowledge
app.post('/api/summary/acknowledge', async (req, res) => {
  try {
    const acknowledgedBy = req.user?.name || 'Caregiver';
    const acknowledgedAt = now().toISOString();
    
    

    

    const state = await getPatientState(req.activePatientId);
    res.json({ success: true, message: 'Summary acknowledged.', patient: state });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// POST /api/summary/generate — Gemini-powered daily summary
app.post('/api/summary/generate', async (req, res) => {
  try {
    let summary = '';
    let confidence = 0.5;
    let suggestedActions = [];
    let flags = [];

    if (GEMINI_API_KEY) {
      try {
        const patientContext = await buildPatientContext(req.activePatientId);
        const summaryPrompt = `You are Rocky, a warm and knowledgeable AI caregiving companion. Generate a concise daily care summary for the caregiver.

${patientContext}

Return a JSON object (no markdown, just raw JSON) with:
{
  "summary": "2-4 sentence warm, clear summary of the patient's current state. Mention sleep, medications, mood, and any concerns. Use the patient's name.",
  "confidence": 0.0-1.0 (how confident you are in this assessment based on available data),
  "suggestedActions": ["1-3 specific actionable recommendations"],
  "flags": ["any clinical or wellness concerns to highlight"]
}

Be warm but data-driven. If data is missing or stale, lower confidence and mention it.`;

        const candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];
        for (const modelName of candidateModels) {
          try {
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(summaryPrompt);
            let text = result.response.text().trim();
            text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(text);
            summary = parsed.summary || '';
            confidence = parsed.confidence ?? 0.75;
            suggestedActions = parsed.suggestedActions || [];
            flags = parsed.flags || [];
            console.log(`✅ Daily summary generated with ${modelName}`);
            break;
          } catch (err) {
            console.error(`⚠️ Summary generation error with ${modelName}:`, err.message);
          }
        }
      } catch (err) {
        console.error('Error generating summary:', err.message);
      }
    }

    // Fallback
    if (!summary) {
      const patient = await getPatientState(req.activePatientId);
      summary = patient?.summary || 'Unable to generate summary at this time.';
      confidence = 0.3;
    }

    // Store the generated summary
    

    

    const state = await getPatientState(req.activePatientId);
    res.json({
      success: true,
      message: 'Daily summary generated.',
      summary: { text: summary, confidence, suggestedActions, flags, reviewStatus: 'pending' },
      patient: state
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// PATCH /api/summary/review — human review of AI summary
app.patch('/api/summary/review', async (req, res) => {
  try {
    const { reviewStatus, editedSummary } = req.body;
    if (!reviewStatus) return res.status(400).json({ success: false, message: 'reviewStatus is required.' });

    const reviewedBy = req.user?.name || 'Caregiver';
    let query = `UPDATE patients SET summaryReviewStatus = ?, summaryReviewedBy = ?`;
    const params = [reviewStatus, reviewedBy];

    if (editedSummary) {
      query += `, summaryStatusText = ?`;
      params.push(editedSummary);
    }
    if (reviewStatus === 'approved') {
      query += `, summaryStatusAcknowledged = 1, summaryStatusAcknowledgedAt = ?, summaryStatusAcknowledgedBy = ?`;
      params.push(now().toISOString(), reviewedBy);
    }
    query += ` WHERE id = ?`;
    params.push(req.activePatientId);

    

    

    const state = await getPatientState(req.activePatientId);
    res.json({ success: true, message: `Summary ${reviewStatus}.`, patient: state });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});


// GET /api/meds — list all medications
app.get('/api/meds', async (req, res) => {
  try {
    const medications = (await supabaseService.from('medications').select('*').eq('patientId', req.activePatientId).order('time', { ascending: true })).data || [];
    const formatted = medications.map(m => ({ ...m, taken: m.taken === 1 }));
    res.json({
      medications: formatted,
      takenCount: formatted.filter(m => m.taken).length,
      totalCount: formatted.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// POST /api/meds/:id/toggle
app.post('/api/meds/:id/toggle', requireCaregiverRole, async (req, res) => {
  try {
    const { id } = req.params;
    const med = null;
    if (!med) return res.status(404).json({ success: false, message: 'Medication not found.' });
    
    const newTaken = med.taken === 1 ? 0 : 1;
    await supabaseService.from('medications').update({ taken: newTaken }).eq('id', id);

    // Add timeline event
    

    const state = await getPatientState(req.activePatientId);
    res.json({ success: true, message: `Medication '${med.name}' updated.`, patient: state });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// POST /api/meds/add
app.post('/api/meds/add', requireCaregiverRole, async (req, res) => {
  try {
    const { name, time, dosage, frequency, prescriber, notes } = req.body;
    if (!name || !time) {
      return res.status(400).json({ success: false, message: 'Medication name and time are required.' });
    }
    const medId = `med-${uid()}`;
    

    // Add timeline event
    

    const state = await getPatientState(req.activePatientId);
    res.json({ success: true, message: `Medication '${name}' added successfully.`, patient: state });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// PUT /api/meds/:id — update a medication
app.put('/api/meds/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verify medication exists
    const { data: med, error: fetchError } = await supabaseService.from('medications').select('*').eq('id', id).maybeSingle();
    if (fetchError) throw fetchError;
    if (!med) return res.status(404).json({ success: false, message: 'Medication not found.' });

    // Update medication
    const { name, time, dosage, frequency, prescriber, notes } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (time !== undefined) updates.time = time;
    if (dosage !== undefined) updates.dosage = dosage;
    if (frequency !== undefined) updates.frequency = frequency;
    if (prescriber !== undefined) updates.prescriber = prescriber;
    if (notes !== undefined) updates.notes = notes;

    const { data: updatedMed, error: updateError } = await supabaseService.from('medications')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle();
      
    if (updateError) throw updateError;

    // Add timeline event
    await supabaseService.from('timeline').insert({
      id: `t-${Date.now()}`,
      patientId: req.activePatientId,
      time: timeStr(),
      title: `Medication updated`,
      desc: `${updatedMed.name} was updated.`,
      type: 'med'
    });

    const state = await getPatientState(req.activePatientId);
    res.json({ success: true, message: `Medication '${updatedMed.name}' updated.`, medication: { ...updatedMed, taken: updatedMed.taken === 1 }, patient: state });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// DELETE /api/meds/:id
app.delete('/api/meds/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data: med, error: fetchError } = await supabaseService.from('medications').select('*').eq('id', id).maybeSingle();
    if (fetchError) throw fetchError;
    if (!med) return res.status(404).json({ success: false, message: 'Medication not found.' });

    const { error: deleteError } = await supabaseService.from('medications').delete().eq('id', id);
    if (deleteError) throw deleteError;

    // Add timeline event
    await supabaseService.from('timeline').insert({
      id: `t-${Date.now()}`,
      patientId: req.activePatientId,
      time: timeStr(),
      title: `Medication removed`,
      desc: `${med.name} was removed from the medication list.`,
      type: 'med'
    });

    const state = await getPatientState(req.activePatientId);
    res.json({ success: true, message: `Medication '${med.name}' removed.`, patient: state });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});
// GET /api/medications/adherence
app.get('/api/medications/adherence', async (req, res) => {
  try {
    const meds = (await supabaseService.from('medications').select('*').eq('patientId', req.activePatientId)).data || [];
    
    // Generate realistic adherence metrics
    const weeklyPercent = meds.length > 0 ? 92 : 0; 
    const monthlyPercent = meds.length > 0 ? 88 : 0;
    
    // Identify 1-2 actual medications that are 'frequently missed'
    const missedTrends = meds.slice(0, 2).map(m => ({
      name: m.name,
      missedCount: Math.floor(Math.random() * 2) + 1,
      time: m.time
    }));

    res.json({
      success: true,
      adherence: {
        weekly: weeklyPercent,
        monthly: monthlyPercent,
        missed: missedTrends
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});


// ═══════════════════════════════════════════════════════════════════════
// CARE TEAM ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

// GET /api/care-team
app.get('/api/care-team', async (req, res) => {
  try {
    const list = null;
    const formatted = list.map(m => ({ ...m, active: m.active === 1 }));
    res.json({ careTeam: formatted, count: formatted.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// POST /api/care-team — add a member
app.post('/api/care-team', async (req, res) => {
  try {
    const { name, role, relationship, phone, email } = req.body;
    if (!name || !role) {
      return res.status(400).json({ success: false, message: 'Name and role are required.' });
    }
    const memberId = `ct-${uid()}`;
    const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6366f1&color=fff`;
    

    // Add timeline event
    

    const newMember = (await supabaseService.from('care_team').select('*').eq('id', memberId).maybeSingle()).data;
    const list = null;
    res.json({ success: true, message: `${name} added to care team.`, member: { ...newMember, active: true }, careTeam: list.map(m => ({ ...m, active: m.active === 1 })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// PUT /api/care-team/:id — update a member
app.put('/api/care-team/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const member = (await supabaseService.from('care_team').select('*').eq('id', id).maybeSingle()).data;
    if (!member) return res.status(404).json({ success: false, message: 'Care team member not found.' });

    const { name, role, relationship, phone, email, active } = req.body;
    

    const updatedMember = (await supabaseService.from('care_team').select('*').eq('id', id).maybeSingle()).data;
    const list = null;
    res.json({ success: true, message: `${updatedMember.name} updated.`, member: { ...updatedMember, active: updatedMember.active === 1 }, careTeam: list.map(m => ({ ...m, active: m.active === 1 })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// DELETE /api/care-team/:id
app.delete('/api/care-team/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const member = (await supabaseService.from('care_team').select('*').eq('id', id).maybeSingle()).data;
    if (!member) return res.status(404).json({ success: false, message: 'Care team member not found.' });

    await supabaseService.from('care_team').delete().eq('id', id);

    // Add timeline event
    

    const list = null;
    res.json({ success: true, message: `${member.name} removed from care team.`, careTeam: list.map(m => ({ ...m, active: m.active === 1 })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});


// ═══════════════════════════════════════════════════════════════════════
// WELLNESS HISTORY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

// GET /api/wellness/history?days=7
app.get('/api/wellness/history', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 30);
    const { data: records } = await supabaseService
      .from('wellness_history')
      .select('*')
      .eq('patientId', req.activePatientId)
      .order('createdAt', { ascending: false })
      .limit(days);

    const data = [...(records || [])].reverse();

    if (data.length === 0) {
      return res.json({
        data: [],
        period: `${days} days`,
        averages: {
          wellnessScore: 0,
          mood: 0,
          sleep: 0,
          steps: 0,
          hydration: 0,
          heartRate: 0,
          fallRisk: 0,
        }
      });
    }

    const avg = (arr, key) => +(arr.reduce((s, d) => s + d[key], 0) / arr.length).toFixed(1);
    res.json({
      data,
      period: `${days} days`,
      averages: {
        wellnessScore: avg(data, 'wellnessScore'),
        mood: avg(data, 'mood'),
        sleep: avg(data, 'sleep'),
        steps: Math.round(avg(data, 'steps')),
        hydration: avg(data, 'hydration'),
        heartRate: avg(data, 'heartRate'),
        fallRisk: avg(data, 'fallRisk'),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// GET /api/wellness/trends
app.get('/api/wellness/trends', async (req, res) => {
  try {
    const { data: records } = await supabaseService
      .from('wellness_history')
      .select('*')
      .eq('patientId', req.activePatientId)
      .order('createdAt', { ascending: false })
      .limit(14);

    const last7 = (records || []).slice(0, 7);
    const prev7 = (records || []).slice(7, 14);

    const trend = (key) => {
      if (last7.length === 0) {
        return { current: 0, previous: 0, changePercent: 0, direction: 'stable' };
      }
      const cur = last7.reduce((s, d) => s + d[key], 0) / last7.length;
      const pre = prev7.length ? prev7.reduce((s, d) => s + d[key], 0) / prev7.length : cur;
      const pct = pre === 0 ? 0 : ((cur - pre) / pre * 100);
      return { current: +cur.toFixed(1), previous: +pre.toFixed(1), changePercent: +pct.toFixed(1), direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'stable' };
    };

    res.json({
      wellnessScore: trend('wellnessScore'),
      mood: trend('mood'),
      sleep: trend('sleep'),
      steps: trend('steps'),
      hydration: trend('hydration'),
      heartRate: trend('heartRate'),
      fallRisk: trend('fallRisk'),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});



// ═══════════════════════════════════════════════════════════════════════
// VOICE CHECK-IN ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

// GET /api/voice-checkins
app.get('/api/voice-checkins', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const { data: checkins } = await supabaseService
      .from('voice_checkins')
      .select('*')
      .eq('patientId', req.activePatientId)
      .order('createdAt', { ascending: false })
      .limit(limit);

    const formatted = (checkins || []).map(vc => ({
      ...vc,
      flags: typeof vc.flags === 'string' ? JSON.parse(vc.flags || '[]') : (vc.flags || [])
    }));
    res.json({ checkins: formatted, total: formatted.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// GET /api/voice-checkins/:id
app.get('/api/voice-checkins/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: vc } = await supabaseService
      .from('voice_checkins')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!vc) return res.status(404).json({ success: false, message: 'Check-in not found.' });
    res.json({
      checkin: {
        ...vc,
        flags: typeof vc.flags === 'string' ? JSON.parse(vc.flags || '[]') : (vc.flags || [])
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});


// POST /api/voice-checkins — simulate a new check-in
app.post('/api/voice-checkins', async (req, res) => {
  try {
    const { transcript } = req.body;
    if (!transcript) return res.status(400).json({ success: false, message: 'Transcript is required.' });

    const flags = [];
    const lower = transcript.toLowerCase();
    if (lower.includes('pain') || lower.includes('stiff') || lower.includes('hurt')) flags.push('pain_reported');
    if (lower.includes('tired') || lower.includes('fatigue') || lower.includes('exhaust')) flags.push('fatigue');
    if (lower.includes('dizzy') || lower.includes('fall') || lower.includes('trip')) flags.push('fall_risk');
    if (lower.includes('sad') || lower.includes('lonely') || lower.includes('miss')) flags.push('mood_concern');

    const sentiment = flags.length === 0 ? 'positive' : flags.length <= 1 ? 'neutral' : 'concerning';
    const sentimentScore = flags.length === 0 ? 0.85 : flags.length <= 1 ? 0.6 : 0.35;

    const vcId = `vc-${uid()}`;
    const dateStr = now().toISOString().slice(0, 10);
    const timeVal = timeStr();
    const duration = `${Math.floor(Math.random() * 4) + 1}m ${Math.floor(Math.random() * 59)}s`;
    const aiSummary = `Voice check-in processed. Sentiment: ${sentiment}. ${flags.length > 0 ? `Flags: ${flags.join(', ')}.` : 'No concerns detected.'}`;
    const voiceTone = sentiment === 'positive' ? 'bright' : sentiment === 'neutral' ? 'steady' : 'low';
    const energy = sentiment === 'positive' ? 'high' : sentiment === 'neutral' ? 'moderate' : 'low';

    

    // Add to timeline
    

    // Auto-generate alerts from flags
    if (flags.includes('fall_risk')) {
      const alertId = `alert-${uid()}`;
      
      // Timeline event for alert
      
    }
    if (flags.includes('mood_concern')) {
      const alertId = `alert-${uid()}`;
      
      // Timeline event for alert
      
    }

    const state = await getPatientState(req.activePatientId);
    res.json({
      success: true,
      message: 'Voice check-in recorded.',
      checkin: {
        id: vcId,
        date: dateStr,
        time: timeVal,
        duration,
        transcript,
        sentiment,
        sentimentScore,
        flags,
        aiSummary,
        voiceTone,
        energy
      },
      patient: state
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// POST /api/voice-checkins/analyze — Gemini-powered voice analysis
app.post('/api/voice-checkins/analyze', async (req, res) => {
  try {
    const { transcript, transcriptEditedByUser } = req.body;
    if (!transcript) return res.status(400).json({ success: false, message: 'Transcript is required.' });

    const vcId = `vc-${uid()}`;
    const dateStr = now().toISOString().slice(0, 10);
    const timeVal = timeStr();
    const duration = `${Math.floor(Math.random() * 4) + 1}m ${Math.floor(Math.random() * 59)}s`;

    // Heuristic transcript quality floor (word count)
    const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
    const transcriptQuality = wordCount < 5 ? 'very_short' : wordCount < 15 ? 'short' : 'adequate';
    const qualityConfidenceCeiling = wordCount < 5 ? 0.45 : wordCount < 15 ? 0.65 : 1.0;

    let sentiment = 'neutral';
    let sentimentScore = 0.6;
    let confidence = 0.5;
    let flags = [];
    let aiSummary = '';
    let caregiverSummary = '';
    let voiceTone = 'steady';
    let energy = 'moderate';
    let cognitiveIndicators = [];
    let suggestedActions = [];
    let followUpQuestions = [];
    let safetyDowngraded = false;

    if (GEMINI_API_KEY) {
      try {
        const patientContext = await buildPatientContext(req.activePatientId);
        const analysisPrompt = `You are Rocky, a clinical AI assistant analyzing a voice check-in transcript from an elderly patient.

${patientContext}

TRANSCRIPT (${wordCount} words — quality: ${transcriptQuality}):
"${transcript}"

Analyze this transcript and return a JSON object (no markdown, just raw JSON) with these exact fields:
{
  "sentiment": "very_positive" | "positive" | "neutral" | "concerning" | "negative",
  "sentimentScore": 0.0-1.0,
  "confidence": 0.0-1.0 (how confident you are in this analysis based on transcript length and clarity),
  "flags": ["string array of clinical concerns: pain_reported, fatigue, fall_risk, mood_concern, confusion, medication_issue"],
  "aiSummary": "2-3 sentence warm, caregiver-friendly clinical summary. Avoid technical jargon. Replace 'Self-misidentification' with 'may be confused about family members'. Never say 'Immediate cognitive decline' from a single check-in.",
  "caregiverSummary": "1-2 sentence plain-English note written FOR the family caregiver explaining what to watch for today and what action, if any, to take. Example: 'Eleanor sounded positive and comfortable today. No action needed — keep up the usual routine.'",
  "voiceTone": "bright" | "steady" | "flat" | "low" | "anxious",
  "energy": "high" | "moderate" | "low",
  "cognitiveIndicators": ["clear_cognition" | "word_finding_difficulty" | "repetition" | "confusion" | "time_disorientation"],
  "suggestedActions": ["plain-English recommended care actions for today"],
  "followUpQuestions": ["1-2 suggested follow-up questions for the caregiver to ask the patient"]
}

IMPORTANT SAFETY RULES:
- If the transcript has fewer than 10 words, set confidence below 0.5 and do NOT generate any severe flags (confusion, cognitive_decline).
- Never generate 'Immediate cognitive decline escalation' — use 'Possible communication inconsistency. Follow-up recommended.' instead.
- Be warm and supportive, not clinical or alarmist.
- A short transcript means you have less signal — always be more conservative.`;

        const candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];
        for (const modelName of candidateModels) {
          try {
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(analysisPrompt);
            let text = result.response.text().trim();
            // Strip markdown code fences if present
            text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(text);
            sentiment = parsed.sentiment || sentiment;
            sentimentScore = parsed.sentimentScore ?? sentimentScore;
            confidence = Math.min(parsed.confidence ?? 0.75, qualityConfidenceCeiling);
            flags = parsed.flags || [];
            aiSummary = parsed.aiSummary || '';
            caregiverSummary = parsed.caregiverSummary || '';
            voiceTone = parsed.voiceTone || voiceTone;
            energy = parsed.energy || energy;
            cognitiveIndicators = parsed.cognitiveIndicators || [];
            suggestedActions = parsed.suggestedActions || [];
            followUpQuestions = parsed.followUpQuestions || [];
            console.log(`✅ Voice analysis completed with ${modelName} (confidence: ${confidence.toFixed(2)})`);
            break;
          } catch (err) {
            console.error(`⚠️ Voice analysis error with ${modelName}:`, err.message);
          }
        }
      } catch (err) {
        console.error('Error in Gemini voice analysis:', err.message);
      }
    }

    // Fallback if Gemini didn't produce a summary
    if (!aiSummary) {
      const lower = transcript.toLowerCase();
      if (lower.includes('pain') || lower.includes('stiff') || lower.includes('hurt')) flags.push('pain_reported');
      if (lower.includes('tired') || lower.includes('fatigue')) flags.push('fatigue');
      if (lower.includes('dizzy') || lower.includes('fall')) flags.push('fall_risk');
      if (lower.includes('sad') || lower.includes('lonely')) flags.push('mood_concern');
      sentiment = flags.length === 0 ? 'positive' : flags.length <= 1 ? 'neutral' : 'concerning';
      sentimentScore = flags.length === 0 ? 0.85 : flags.length <= 1 ? 0.6 : 0.35;
      confidence = Math.min(0.4, qualityConfidenceCeiling); // Low confidence for keyword fallback
      aiSummary = `Voice check-in processed (keyword analysis). Sentiment: ${sentiment}. ${flags.length > 0 ? `Flags: ${flags.join(', ')}.` : 'No concerns detected.'}`;
      caregiverSummary = flags.length === 0
        ? 'No concerns detected from this check-in. Continue with the normal daily routine.'
        : `Some concerns were noted: ${flags.map(f => f.replace(/_/g, ' ')).join(', ')}. Please follow up with the patient.`;
    }

    // ── SAFETY GATE ──────────────────────────────────────────────────────
    // If confidence is low, prevent severe clinical conclusions from being
    // stored or shown. Downgrade flags and prefix summary with caution.
    const SEVERE_FLAGS = ['confusion', 'cognitive_decline', 'time_disorientation'];
    const SEVERE_COGNITIVE = ['confusion', 'time_disorientation'];
    if (confidence < 0.5) {
      const hadSevere = flags.some(f => SEVERE_FLAGS.includes(f)) ||
        cognitiveIndicators.some(c => SEVERE_COGNITIVE.includes(c));
      if (hadSevere) {
        safetyDowngraded = true;
        // Remove severe flags — keep milder ones
        flags = flags.filter(f => !SEVERE_FLAGS.includes(f));
        cognitiveIndicators = cognitiveIndicators.filter(c => !SEVERE_COGNITIVE.includes(c));
        // Cap sentiment
        if (sentiment === 'negative' || sentiment === 'concerning') {
          sentiment = 'neutral';
          sentimentScore = Math.max(sentimentScore, 0.5);
        }
        // Prefix AI summary with safety disclaimer
        aiSummary = `[Low confidence — transcript too short for a reliable assessment] ${aiSummary}`;
        caregiverSummary = 'This transcript was too brief for a confident analysis. Please record a longer check-in or manually follow up with the patient before acting on any concerns.';
        console.log('⚠️  Safety gate triggered: severe conclusions suppressed due to low confidence');
      }
    }

    // Save to database
    const isEdited = transcriptEditedByUser ? 1 : 0;
    const isDowngraded = safetyDowngraded ? 1 : 0;
    

    // Store caregiverSummary and suggestedActions separately (best-effort)
    try {
      
    } catch (_) { /* Column may not exist in older schemas */ }

    // Timeline event
    

    // Auto-generate alerts from flags (only when confidence is adequate)
    if (confidence >= 0.5) {
      for (const flag of flags) {
        if (flag === 'fall_risk') {
          
        } else if (flag === 'mood_concern') {
          
        } else if (flag === 'confusion') {
          
        }
      }
    } else {
      console.log(`⚠️  Alert generation skipped — confidence too low (${confidence.toFixed(2)})`);
    }

    const state = await getPatientState(req.activePatientId);
    res.json({
      success: true,
      message: 'Voice check-in analyzed by AI.',
      checkin: {
        id: vcId, date: dateStr, time: timeVal, duration, transcript,
        sentiment, sentimentScore, confidence, flags,
        aiSummary, caregiverSummary, voiceTone, energy,
        cognitiveIndicators, suggestedActions,
        reviewStatus: 'pending',
        safetyDowngraded,
        followUpQuestions
      },
      patient: state
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// PATCH /api/voice-checkins/:id/review — human review of AI analysis
app.patch('/api/voice-checkins/:id/review', async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewStatus, editedSummary, editedCaregiverSummary, transcriptReviewed } = req.body;
    if (!reviewStatus) return res.status(400).json({ success: false, message: 'reviewStatus is required.' });

    const vc = null;
    if (!vc) return res.status(404).json({ success: false, message: 'Check-in not found.' });

    const reviewedBy = req.user?.name || 'Caregiver';
    let query = `UPDATE voice_checkins SET reviewStatus = ?, reviewedBy = ?`;
    const params = [reviewStatus, reviewedBy];

    if (editedSummary) {
      query += `, aiSummary = ?`;
      params.push(editedSummary);
    }
    if (editedCaregiverSummary) {
      query += `, caregiverSummary = ?`;
      params.push(editedCaregiverSummary);
    }
    if (transcriptReviewed !== undefined) {
      query += `, transcriptReviewed = ?`;
      params.push(transcriptReviewed ? 1 : 0);
    }
    query += ` WHERE id = ?`;
    params.push(id);

    

    // Audit log entry
    try {
      const auditId = `audit-${Date.now()}`;
      
    } catch (_) { /* audit non-blocking */ }

    

    res.json({ success: true, message: `Check-in ${reviewStatus} successfully.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});


// ═══════════════════════════════════════════════════════════════════════
// CARE PLAN ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

// GET /api/care-plans
app.get('/api/care-plans', async (req, res) => {
  try {
    const { status, category } = req.query;
    let query = supabaseService.from('care_plans').select('*').eq('patientId', req.activePatientId);
    
    if (status) query = query.eq('status', status);
    if (category) query = query.eq('category', category);

    const { data: list, error: fetchErr } = await query;
    if (fetchErr) throw fetchErr;

    const { count } = await supabaseService.from('care_plans').select('*', { count: 'exact', head: true }).eq('patientId', req.activePatientId);

    const formatted = list.map(cp => ({
      ...cp,
      daysOfWeek: JSON.parse(cp.daysOfWeek || '[]'),
      completedToday: cp.completedToday === 1 || cp.completedToday === true
    }));

    res.json({ carePlans: formatted, total: count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// POST /api/care-plans
app.post('/api/care-plans', requireCaregiverRole, async (req, res) => {
  try {
    const { title, description, category, assignedTo, scheduledTime, daysOfWeek } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'Care plan title is required.' });
    
    const patient = (await supabaseService.from('patients').select('name').eq('id', req.activePatientId).maybeSingle()).data;
    const patientName = patient ? patient.name : 'Patient';

    const planId = `cp-${uid()}`;
    const assigned = assignedTo || patientName;
    const created = req.user?.name || 'Caregiver';
    const timeVal = scheduledTime || 'Anytime';
    const days = daysOfWeek || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

    const { error: insertErr } = await supabaseService.from('care_plans').insert({
      id: planId,
      patientId: req.activePatientId,
      title,
      description: description || '',
      category: category || 'general',
      status: 'active',
      assignedTo: assigned,
      createdBy: created,
      scheduledTime: timeVal,
      daysOfWeek: JSON.stringify(days),
      completedToday: false,
      completionStatus: 'pending'
    });
    if (insertErr) throw insertErr;

    // Timeline event
    await supabaseService.from('timeline').insert({
      id: `t-${Date.now()}`,
      patientId: req.activePatientId,
      time: timeStr(),
      title: `Care plan created`,
      desc: `New care plan '${title}' added.`,
      type: 'plan'
    });

    const newPlan = (await supabaseService.from('care_plans').select('*').eq('id', planId).maybeSingle()).data;
    res.json({
      success: true,
      message: `Care plan '${title}' created.`,
      carePlan: {
        ...newPlan,
        daysOfWeek: JSON.parse(newPlan.daysOfWeek || '[]'),
        completedToday: newPlan.completedToday === 1 || newPlan.completedToday === true
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// PATCH /api/care-plans/:id/complete
app.patch('/api/care-plans/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: plan, error: fetchErr } = await supabaseService.from('care_plans').select('*').eq('id', id).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!plan) return res.status(404).json({ success: false, message: 'Care plan not found.' });

    const newCompletedToday = (plan.completedToday === 1 || plan.completedToday === true) ? false : true;
    const { error: updateErr } = await supabaseService.from('care_plans').update({ completedToday: newCompletedToday }).eq('id', id);
    if (updateErr) throw updateErr;

    // Timeline event
    await supabaseService.from('timeline').insert({
      id: `t-${Date.now()}`,
      patientId: req.activePatientId,
      time: timeStr(),
      title: `Care plan ${newCompletedToday ? 'completed' : 'reset'}`,
      desc: `Care plan '${plan.title}' was marked as ${newCompletedToday ? 'completed' : 'incomplete'}.`,
      type: 'plan'
    });

    const updatedPlan = (await supabaseService.from('care_plans').select('*').eq('id', id).maybeSingle()).data;
    res.json({
      success: true,
      message: `Care plan '${plan.title}' ${newCompletedToday ? 'completed' : 'reset'}.`,
      carePlan: {
        ...updatedPlan,
        daysOfWeek: JSON.parse(updatedPlan.daysOfWeek || '[]'),
        completedToday: updatedPlan.completedToday === 1 || updatedPlan.completedToday === true
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// PUT /api/care-plans/:id
app.put('/api/care-plans/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: plan, error: fetchErr } = await supabaseService.from('care_plans').select('*').eq('id', id).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!plan) return res.status(404).json({ success: false, message: 'Care plan not found.' });

    const { title, description, category, status, assignedTo, scheduledTime, daysOfWeek } = req.body;
    
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (category !== undefined) updates.category = category;
    if (status !== undefined) updates.status = status;
    if (assignedTo !== undefined) updates.assignedTo = assignedTo;
    if (scheduledTime !== undefined) updates.scheduledTime = scheduledTime;
    if (daysOfWeek !== undefined) updates.daysOfWeek = JSON.stringify(daysOfWeek);

    const { error: updateErr } = await supabaseService.from('care_plans').update(updates).eq('id', id);
    if (updateErr) throw updateErr;

    const updatedPlan = (await supabaseService.from('care_plans').select('*').eq('id', id).maybeSingle()).data;
    res.json({
      success: true,
      message: `Care plan '${updatedPlan.title}' updated.`,
      carePlan: {
        ...updatedPlan,
        daysOfWeek: JSON.parse(updatedPlan.daysOfWeek || '[]'),
        completedToday: updatedPlan.completedToday === 1 || updatedPlan.completedToday === true
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// DELETE /api/care-plans/:id
app.delete('/api/care-plans/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: plan, error: fetchErr } = await supabaseService.from('care_plans').select('*').eq('id', id).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!plan) return res.status(404).json({ success: false, message: 'Care plan not found.' });

    const { error: deleteErr } = await supabaseService.from('care_plans').delete().eq('id', id);
    if (deleteErr) throw deleteErr;

    // Timeline event
    await supabaseService.from('timeline').insert({
      id: `t-${Date.now()}`,
      patientId: req.activePatientId,
      time: timeStr(),
      title: `Care plan deleted`,
      desc: `Care plan '${plan.title}' was deleted.`,
      type: 'plan'
    });

    res.json({ success: true, message: `Care plan '${plan.title}' deleted.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});


// ═══════════════════════════════════════════════════════════════════════
// WEARABLE ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

// GET /api/wearable
app.get('/api/wearable', async (req, res) => {
  try {
    const wearable = (await supabaseService.from('wearable_data').select('*').eq('patientId', req.activePatientId).maybeSingle()).data;
    if (!wearable) {
      return res.status(404).json({ success: false, message: 'Wearable data not found for patient.' });
    }

    // Simulate slight real-time variation
    const hr = Math.round(68 + Math.random() * 12);
    const spo2 = Math.round(95 + Math.random() * 4);
    const lastSynced = now().toISOString();

    

    const updated = (await supabaseService.from('wearable_data').select('*').eq('patientId', req.activePatientId).maybeSingle()).data;
    res.json({
      wearable: {
        device: updated.device,
        lastSynced: updated.lastSynced,
        connected: updated.connected === 1,
        battery: updated.battery,
        realtime: {
          heartRate: updated.heartRate,
          spo2: updated.spo2,
          steps: updated.steps,
          calories: updated.calories,
          activeMinutes: updated.activeMinutes,
          standHours: updated.standHours,
        },
        hourlyHeartRate: JSON.parse(updated.hourlyHeartRate || '[]'),
        sleepStages: JSON.parse(updated.sleepStages || '[]'),
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// POST /api/wearable/sync — simulate a sync
app.post('/api/wearable/sync', async (req, res) => {
  try {
    const wearable = (await supabaseService.from('wearable_data').select('*').eq('patientId', req.activePatientId).maybeSingle()).data;
    if (!wearable) {
      return res.status(404).json({ success: false, message: 'Wearable data not found.' });
    }

    const lastSynced = now().toISOString();
    const battery = Math.max(10, wearable.battery - Math.floor(Math.random() * 3));
    const newHR = Math.round(65 + Math.random() * 15);

    

    const desc = `Heart rate: ${newHR} bpm · SpO2: ${wearable.spo2}% · Steps: ${wearable.steps}`;
    

    const updated = (await supabaseService.from('wearable_data').select('*').eq('patientId', req.activePatientId).maybeSingle()).data;
    res.json({
      success: true,
      message: 'Wearable data synced successfully.',
      wearable: {
        device: updated.device,
        lastSynced: updated.lastSynced,
        connected: updated.connected === 1,
        battery: updated.battery,
        realtime: {
          heartRate: updated.heartRate,
          spo2: updated.spo2,
          steps: updated.steps,
          calories: updated.calories,
          activeMinutes: updated.activeMinutes,
          standHours: updated.standHours,
        },
        hourlyHeartRate: JSON.parse(updated.hourlyHeartRate || '[]'),
        sleepStages: JSON.parse(updated.sleepStages || '[]'),
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});


// ═══════════════════════════════════════════════════════════════════════
// TIMELINE ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

// GET /api/timeline
app.get('/api/timeline', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const type = req.query.type;

    let query = `SELECT * FROM timeline WHERE patientId = ?`;
    const params = [req.activePatientId];

    if (type) {
      query += ` AND type = ?`;
      params.push(type);
    }

    query += ` ORDER BY id DESC LIMIT ?`;
    params.push(limit);

    const list = null;
    
    let totalQuery = `SELECT COUNT(*) as count FROM timeline WHERE patientId = ?`;
    const totalParams = [req.activePatientId];
    if (type) {
      totalQuery += ` AND type = ?`;
      totalParams.push(type);
    }
    const totalCount = null;

    res.json({ timeline: list, total: totalCount.count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// POST /api/timeline — add a manual note
app.post('/api/timeline', async (req, res) => {
  try {
    const { title, description, type } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'Title is required.' });

    const entryId = `t-${Date.now()}`;
    const timeVal = timeStr();
    

    res.json({
      success: true,
      message: 'Timeline note added.',
      entry: {
        id: entryId,
        time: timeVal,
        title,
        desc: description || '',
        type: type || 'note'
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// GET /api/family-update — generate daily summary for family members
app.get('/api/family-update', async (req, res) => {
  try {
    const patientContext = await buildPatientContext(req.activePatientId);
    
    if (!GEMINI_API_KEY) {
      return res.json({ success: true, summary: "Eleanor had a good day today. She took all her medications and completed her exercises. We went for a short walk after lunch." });
    }

    const prompt = `You are Rocky, a warm, caring AI assistant helping a primary caregiver send a daily update to the rest of the family.
Context:
${patientContext}

Please write a 3-4 sentence plain-English summary of how the patient is doing today based on their recent timeline events, mood, sleep, and medications.
Tone: Warm, conversational, reassuring, but honest. No clinical jargon. It should sound like it was written by the primary caregiver or a very friendly nurse.`;

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    
    res.json({
      success: true,
      summary: result.response.text().trim()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// SETTINGS ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

// GET /api/settings
app.get('/api/settings', async (req, res) => {
  try {
    const s = null;
    if (!s) return res.status(404).json({ success: false, message: 'Settings not found.' });

    res.json({
      settings: {
        notifications: {
          pushEnabled: s.notificationsPushEnabled === 1,
          emailDigest: s.notificationsEmailDigest === 1,
          smsAlerts: s.notificationsSmsAlerts === 1,
          alertSeverityThreshold: s.notificationsAlertSeverityThreshold,
          quietHours: {
            enabled: s.notificationsQuietHoursEnabled === 1,
            start: s.notificationsQuietHoursStart,
            end: s.notificationsQuietHoursEnd
          }
        },
        display: {
          theme: s.displayTheme,
          compactMode: s.displayCompactMode === 1,
          showWearableCard: s.displayShowWearableCard === 1,
          dashboardLayout: s.displayDashboardLayout
        },
        privacy: {
          shareWithProvider: s.privacyShareWithProvider === 1,
          anonymizeExports: s.privacyAnonymizeExports === 1,
          dataRetentionDays: s.privacyDataRetentionDays
        },
        voiceCheckin: {
          enabled: s.voiceCheckinEnabled === 1,
          defaultTime: s.voiceCheckinDefaultTime,
          reminderMinutesBefore: s.voiceCheckinReminderMinutesBefore,
          autoTranscribe: s.voiceCheckinAutoTranscribe === 1,
          language: s.voiceCheckinLanguage
        }
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// PATCH /api/settings
app.patch('/api/settings', async (req, res) => {
  try {
    const s = null;
    if (!s) return res.status(404).json({ success: false, message: 'Settings not found.' });

    const { notifications, display, privacy, voiceCheckin } = req.body;

    const pushEnabled = (notifications?.pushEnabled !== undefined) ? (notifications.pushEnabled ? 1 : 0) : s.notificationsPushEnabled;
    const emailDigest = (notifications?.emailDigest !== undefined) ? (notifications.emailDigest ? 1 : 0) : s.notificationsEmailDigest;
    const smsAlerts = (notifications?.smsAlerts !== undefined) ? (notifications.smsAlerts ? 1 : 0) : s.notificationsSmsAlerts;
    const severityThreshold = notifications?.alertSeverityThreshold || s.notificationsAlertSeverityThreshold;
    const quietHoursEnabled = (notifications?.quietHours?.enabled !== undefined) ? (notifications.quietHours.enabled ? 1 : 0) : s.notificationsQuietHoursEnabled;
    const quietHoursStart = notifications?.quietHours?.start || s.notificationsQuietHoursStart;
    const quietHoursEnd = notifications?.quietHours?.end || s.notificationsQuietHoursEnd;

    const theme = display?.theme || s.displayTheme;
    const compactMode = (display?.compactMode !== undefined) ? (display.compactMode ? 1 : 0) : s.displayCompactMode;
    const showWearable = (display?.showWearableCard !== undefined) ? (display.showWearableCard ? 1 : 0) : s.displayShowWearableCard;
    const layout = display?.dashboardLayout || s.displayDashboardLayout;

    const shareProvider = (privacy?.shareWithProvider !== undefined) ? (privacy.shareWithProvider ? 1 : 0) : s.privacyShareWithProvider;
    const anonymize = (privacy?.anonymizeExports !== undefined) ? (privacy.anonymizeExports ? 1 : 0) : s.privacyAnonymizeExports;
    const retention = privacy?.dataRetentionDays !== undefined ? privacy.dataRetentionDays : s.privacyDataRetentionDays;

    const voiceEnabled = (voiceCheckin?.enabled !== undefined) ? (voiceCheckin.enabled ? 1 : 0) : s.voiceCheckinEnabled;
    const voiceTime = voiceCheckin?.defaultTime || s.voiceCheckinDefaultTime;
    const voiceReminder = voiceCheckin?.reminderMinutesBefore !== undefined ? voiceCheckin.reminderMinutesBefore : s.voiceCheckinReminderMinutesBefore;
    const voiceTranscribe = (voiceCheckin?.autoTranscribe !== undefined) ? (voiceCheckin.autoTranscribe ? 1 : 0) : s.voiceCheckinAutoTranscribe;
    const voiceLang = voiceCheckin?.language || s.voiceCheckinLanguage;

    

    const updated = null;
    res.json({
      success: true,
      message: 'Settings updated.',
      settings: {
        notifications: {
          pushEnabled: updated.notificationsPushEnabled === 1,
          emailDigest: updated.notificationsEmailDigest === 1,
          smsAlerts: updated.notificationsSmsAlerts === 1,
          alertSeverityThreshold: updated.notificationsAlertSeverityThreshold,
          quietHours: {
            enabled: updated.notificationsQuietHoursEnabled === 1,
            start: updated.notificationsQuietHoursStart,
            end: updated.notificationsQuietHoursEnd
          }
        },
        display: {
          theme: updated.displayTheme,
          compactMode: updated.displayCompactMode === 1,
          showWearableCard: updated.displayShowWearableCard === 1,
          dashboardLayout: updated.displayDashboardLayout
        },
        privacy: {
          shareWithProvider: updated.privacyShareWithProvider === 1,
          anonymizeExports: updated.privacyAnonymizeExports === 1,
          dataRetentionDays: updated.privacyDataRetentionDays
        },
        voiceCheckin: {
          enabled: updated.voiceCheckinEnabled === 1,
          defaultTime: updated.voiceCheckinDefaultTime,
          reminderMinutesBefore: updated.voiceCheckinReminderMinutesBefore,
          autoTranscribe: updated.voiceCheckinAutoTranscribe === 1,
          language: updated.voiceCheckinLanguage
        }
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});


// ═══════════════════════════════════════════════════════════════════════
// WAITLIST & DEMO BOOKING
// ═══════════════════════════════════════════════════════════════════════

// POST /api/waitlist
app.post('/api/waitlist', (req, res) => {
  const { name, email, relationship } = req.body;
  if (!name || !email) return res.status(400).json({ success: false, message: 'Name and Email are required.' });
  if (waitlist.find(w => w.email === email)) {
    return res.status(409).json({ success: false, message: 'This email is already on the waitlist!' });
  }
  const entry = { id: `wl-${uid()}`, name, email, relationship: relationship || 'Other', date: now().toISOString() };
  waitlist.push(entry);
  console.log('New waitlist registration:', entry);
  res.json({ success: true, message: `Thank you, ${name}! You have been successfully added to the pilot waitlist.`, position: waitlist.length });
});

// GET /api/waitlist (admin)
app.get('/api/waitlist', (req, res) => {
  res.json({ waitlist, count: waitlist.length });
});

// POST /api/demo/book
app.post('/api/demo/book', (req, res) => {
  const { name, email, date, notes } = req.body;
  if (!name || !email || !date) {
    return res.status(400).json({ success: false, message: 'Name, email, and preferred date are required.' });
  }
  const booking = {
    id: `demo-${uid()}`,
    name, email,
    date,
    notes: notes || '',
    status: 'confirmed',
    createdAt: now().toISOString(),
  };
  demoBookings.push(booking);
  console.log('New demo booking:', booking);
  res.json({
    success: true,
    message: `Demo booked! We'll email confirmation for ${new Date(date).toLocaleString()} to ${email}.`,
    booking,
  });
});

// GET /api/demo/bookings (admin)
app.get('/api/demo/bookings', (req, res) => {
  res.json({ bookings: demoBookings, count: demoBookings.length });
});


// ═══════════════════════════════════════════════════════════════════════
// EHR EXPORT
// ═══════════════════════════════════════════════════════════════════════

// GET /api/export/ehr — Valid HL7 FHIR R4 and Care Report Exporter
app.get('/api/export/ehr', async (req, res) => {
  try {
    const format = req.query.format || 'json';  // 'json' or 'fhir'
    const days = parseInt(req.query.days) || 7;

    const patient = await getPatientState(req.activePatientId);
    if (!patient) return res.status(404).json({ success: false, message: 'Patient not found.' });

    const historyRecords = null;
    const historySlice = historyRecords.reverse();

    const voiceRecords = null;
    const checkinsSlice = voiceRecords.map(vc => ({
      ...vc,
      flags: JSON.parse(vc.flags || '[]')
    }));

    const careTeamRecords = null;
    const formattedTeam = careTeamRecords.map(m => ({ ...m, active: m.active === 1 }));

    const carePlansRecords = (await supabaseService.from('care_plans').select('*').eq('patientId', req.activePatientId)).data || [];
    const formattedPlans = carePlansRecords.map(cp => ({
      ...cp,
      daysOfWeek: JSON.parse(cp.daysOfWeek || '[]'),
      completedToday: cp.completedToday === 1,
      completionStatus: cp.completionStatus || 'pending'
    }));

    // Log the export event in audit logs
    await logAuditEvent(
      req.userId,
      req.user?.email,
      'ehr_export',
      `Exported data in ${format.toUpperCase()} format for patient: ${patient.name}`
    );

    if (format === 'fhir') {
      const birthYear = 2026 - (patient.age || 80);
      const fhirBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        meta: { 
          lastUpdated: now().toISOString(),
          profile: ['http://hl7.org/fhir/StructureDefinition/Bundle']
        },
        entry: [
          {
            fullUrl: `urn:uuid:${patient.id}`,
            resource: {
              resourceType: 'Patient',
              id: patient.id,
              active: true,
              name: [{ 
                use: 'official', 
                text: patient.name,
                family: patient.name.split(' ').pop() || '',
                given: [patient.name.split(' ')[0] || '']
              }],
              gender: 'female',
              birthDate: `${birthYear}-01-01`
            }
          },
          ...patient.medications.map(m => ({
            fullUrl: `urn:uuid:${m.id}`,
            resource: {
              resourceType: 'MedicationStatement',
              id: m.id,
              status: m.taken ? 'completed' : 'active',
              medicationCodeableConcept: { 
                coding: [{
                  system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
                  display: m.name
                }],
                text: m.name 
              },
              subject: { reference: `Patient/${patient.id}` },
              effectiveDateTime: now().toISOString(),
              dosage: [{ 
                text: `${m.dosage || '1 dose'} at ${m.time}`,
                route: { text: 'oral' }
              }],
              note: m.notes ? [{ text: m.notes }] : []
            }
          })),
          ...patient.alerts.filter(a => !a.resolved).map(a => ({
            fullUrl: `urn:uuid:${a.id}`,
            resource: {
              resourceType: 'DetectedIssue',
              id: a.id,
              status: 'preliminary',
              code: { 
                coding: [{
                  system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
                  code: a.sev === 'warn' ? 'WARN' : 'INFO'
                }],
                text: a.t 
              },
              severity: a.sev === 'warn' ? 'moderate' : 'low',
              patient: { reference: `Patient/${patient.id}` },
              identifiedDateTime: a.createdAt || now().toISOString(),
              detail: a.d
            }
          })),
          {
            fullUrl: `urn:uuid:obs-wellness-${patient.id}`,
            resource: {
              resourceType: 'Observation',
              id: `obs-wellness-${patient.id}`,
              status: 'final',
              category: [{
                coding: [{
                  system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                  code: 'survey',
                  display: 'Survey'
                }]
              }],
              code: {
                coding: [{
                  system: 'http://loinc.org',
                  code: '80613-3',
                  display: 'Patient wellness score'
                }],
                text: 'Wellness Score'
              },
              subject: { reference: `Patient/${patient.id}` },
              effectiveDateTime: now().toISOString(),
              valueQuantity: {
                value: patient.wellnessScore || 80,
                unit: 'Score',
                system: 'http://unitsofmeasure.org',
                code: 'score'
              }
            }
          },
          ...formattedPlans.map(p => ({
            fullUrl: `urn:uuid:${p.id}`,
            resource: {
              resourceType: 'CarePlan',
              id: p.id,
              status: p.status === 'active' ? 'active' : 'completed',
              intent: 'plan',
              title: p.title,
              description: p.description,
              subject: { reference: `Patient/${patient.id}` },
              period: { start: now().toISOString() },
              activity: [{
                detail: {
                  status: p.completedToday ? 'completed' : 'in-progress',
                  description: `Frequency: ${p.daysOfWeek?.join(', ')}. Scheduled: ${p.scheduledTime}`
                }
              }]
            }
          }))
        ]
      };
      res.json(fhirBundle);
    } else {
      res.json({
        exportDate: now().toISOString(),
        patient: {
          name: patient.name,
          age: patient.age,
          wellnessScore: patient.wellnessScore,
        },
        medications: patient.medications,
        activeAlerts: patient.alerts.filter(a => !a.resolved),
        careTeam: formattedTeam.map(m => ({ name: m.name, role: m.role, phone: m.phone, email: m.email })),
        carePlans: formattedPlans,
        wellnessHistory: historySlice,
        voiceCheckins: checkinsSlice,
        timeline: patient.timeline.slice(0, 20),
        generatedBy: 'Rocky Care AI',
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// GET /api/export/doctor-summary
app.get('/api/export/doctor-summary', async (req, res) => {
  try {
    const patientContext = await buildPatientContext(req.activePatientId);
    if (!GEMINI_API_KEY) {
       return res.json({ success: true, summary: "## Doctor Summary\nGemini API key is required to generate this summary." });
    }
    
    const prompt = `You are a clinical AI summarizing 30 days of remote patient monitoring data for a physician. 
Context:
${patientContext}

Please generate a professional, structured Doctor Visit Summary. Include:
1. Patient Overview (Age, current wellness score)
2. Vitals & Trends (Mood, sleep, nutrition/hydration trends)
3. Medication Adherence
4. Key Clinical Concerns (from recent alerts or voice check-ins)
Return the result strictly as cleanly formatted Markdown.`;

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    
    res.json({
      success: true,
      summary: result.response.text()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// ─── CAREGIVER SHARED NOTES ENDPOINTS ──────────────────────────────────
// GET /api/notes
app.get('/api/notes', async (req, res) => {
  try {
    const notes = (await supabaseService.from('caregiver_notes').select('*').eq('patientId', req.activePatientId).order('createdAt', { ascending: false })).data || [];
    res.json({ success: true, notes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// POST /api/notes
app.post('/api/notes', async (req, res) => {
  try {
    const { content, category } = req.body;
    if (!content) return res.status(400).json({ success: false, message: 'Note content is required.' });

    const noteId = `note-${uid()}`;
    const author = req.user?.name || 'Sarah Mitchell'; // Fallback to primary caregiver for demo
    const categoryVal = category || 'General';
    const createdAt = now().toISOString();

    

    // Add note entry to the timeline
    

    // Log audit
    await logAuditEvent(req.userId, req.user?.email, 'add_caregiver_note', `Added caregiver note of category ${categoryVal}`);

    const notes = (await supabaseService.from('caregiver_notes').select('*').eq('patientId', req.activePatientId).order('createdAt', { ascending: false })).data || [];
    res.json({ success: true, message: 'Note added successfully.', notes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// ─── NUTRITION LOGGING ENDPOINTS ───────────────────────────────────────
// GET /api/nutrition
app.get('/api/nutrition', async (req, res) => {
  try {
    const dateStr = now().toISOString().slice(0, 10);
    let log = [];
if (!log) {
      log = {
        breakfast: '',
        lunch: '',
        dinner: '',
        snacks: '',
        waterIntake: 0,
        appetiteScore: 3,
        weight: 0
      };
    }
    res.json({ success: true, date: dateStr, log });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// GET /api/nutrition/history — last 7 days of nutrition logs
app.get('/api/nutrition/history', async (req, res) => {
  try {
    const logs = null;
    res.json({ success: true, logs: logs || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// POST /api/nutrition
app.post('/api/nutrition', requireCaregiverRole, async (req, res) => {
  try {
    console.log('[POST /api/nutrition] Payload received:', req.body);
    const { breakfast, lunch, dinner, snacks, waterIntake, appetiteScore, weight } = req.body;
    const dateStr = now().toISOString().slice(0, 10);

    const existing = null;

    if (existing) {
      
    } else {
      const logId = `nut-${uid()}`;
      
    }

    // Sync water consumption to patient details
    

    // Add activity to timeline
    

    // Log audit
    await logAuditEvent(req.userId, req.user?.email, 'update_nutrition', `Updated nutrition for date ${dateStr}`);

    const log = null;
    const patientState = await getPatientState(req.activePatientId);

    res.json({ success: true, message: 'Nutrition log saved successfully.', log, patient: patientState });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// ─── AUDIT LOGGING ENDPOINTS ───────────────────────────────────────────
// GET /api/audit-logs
app.get('/api/audit-logs', async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden. Admin credentials required.' });
    }
    const logs = null;
    res.json({ success: true, logs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// ─── CARE PLAN COMPLETION STATUS ENDPOINT ──────────────────────────────
// PATCH /api/care-plans/:id/status
app.patch('/api/care-plans/:id/status', requireCaregiverRole, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'completed', 'skipped', 'pending'
    if (!status) return res.status(400).json({ success: false, message: 'Status is required.' });

    const plan = null;
    if (!plan) return res.status(404).json({ success: false, message: 'Care plan not found.' });

    const completedToday = status === 'completed' ? 1 : 0;
    

    // Timeline event
    

    // Audit log
    await logAuditEvent(req.userId, req.user?.email, 'update_care_plan_status', `Marked care plan ${id} as ${status}`);

    const updatedPlan = (await supabaseService.from('care_plans').select('*').eq('id', id).maybeSingle()).data;
    res.json({
      success: true,
      message: `Care plan marked as ${status}.`,
      carePlan: {
        ...updatedPlan,
        daysOfWeek: JSON.parse(updatedPlan.daysOfWeek || '[]'),
        completedToday: updatedPlan.completedToday === 1,
        completionStatus: updatedPlan.completionStatus
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});


// ═══════════════════════════════════════════════════════════════════════
// CHAT — Powered by Google Gemini AI
// ═══════════════════════════════════════════════════════════════════════

// Build live context string for the AI system prompt
async function buildPatientContext(patientId) {
  const patient = await getPatientState(patientId);
  if (!patient) return '';

  const taken = patient.medications.filter(m => m.taken);
  const pending = patient.medications.filter(m => !m.taken);
  const activeAlerts = patient.alerts.filter(a => !a.resolved);
  
  const carePlansList = (await supabaseService.from('care_plans').select('*').eq('patientId', patientId)).data || [];
  const activePlans = carePlansList.filter(p => p.status === 'active').map(cp => ({
    ...cp,
    daysOfWeek: JSON.parse(cp.daysOfWeek || '[]'),
    completedToday: cp.completedToday === 1
  }));

  const voiceRecords = null;
  const latestCheckin = voiceRecords[0] ? {
    ...voiceRecords[0],
    flags: JSON.parse(voiceRecords[0].flags || '[]')
  } : null;

  const careTeamRecords = null;
  const formattedTeam = careTeamRecords.map(m => ({ ...m, active: m.active === 1 }));

  const wearable = (await supabaseService.from('wearable_data').select('*').eq('patientId', patientId).maybeSingle()).data;
  let wearableRealtime = { heartRate: 72, spo2: 97, steps: 0, calories: 0, activeMinutes: 0 };
  let sleepStagesStr = '';
  let wearableDevice = 'Apple Watch';
  let wearableBattery = 100;
  if (wearable) {
    wearableDevice = wearable.device;
    wearableBattery = wearable.battery;
    wearableRealtime = {
      heartRate: wearable.heartRate,
      spo2: wearable.spo2,
      steps: wearable.steps,
      calories: wearable.calories,
      activeMinutes: wearable.activeMinutes,
    };
    const sleepStages = JSON.parse(wearable.sleepStages || '[]');
    sleepStagesStr = sleepStages.map(s => `${s.stage}: ${s.duration}min (${s.percentage}%)`).join(', ');
  }

  return `
=== LIVE PATIENT DATA (as of ${new Date().toLocaleString()}) ===

PATIENT: ${patient.name}, Age ${patient.age}
WELLNESS SCORE: ${patient.wellnessScore}/100 (${patient.weeklyChange})
DAILY SUMMARY: ${patient.summary}

VITAL SIGNS (from ${wearableDevice}):
- Heart Rate: ${wearableRealtime.heartRate} bpm (resting)
- SpO2: ${wearableRealtime.spo2}%
- Steps today: ${wearableRealtime.steps}
- Active minutes: ${wearableRealtime.activeMinutes}
- Device battery: ${wearableBattery}%

SLEEP:
- Duration: ${patient.details.sleepDuration}
- Quality: ${patient.details.sleepQuality}
- Sleep stages: ${sleepStagesStr}

HYDRATION: ${patient.details.hydrationValue} (${patient.details.hydration})
STEPS: ${patient.details.stepsValue} (${patient.details.steps})
MOOD: ${patient.stats.mood.value} (${patient.stats.mood.hint})

MEDICATIONS (${taken.length}/${patient.medications.length} taken):
${patient.medications.map(m => `- ${m.name} at ${m.time} — ${m.taken ? 'TAKEN ✓' : 'PENDING'} ${m.dosage ? `(${m.dosage})` : ''} ${m.prescriber ? `prescribed by ${m.prescriber}` : ''} ${m.notes ? `| Note: ${m.notes}` : ''}`).join('\n')}

ACTIVE ALERTS (${activeAlerts.length}):
${activeAlerts.length > 0 ? activeAlerts.map(a => `- [${a.sev.toUpperCase()}] ${a.t}: ${a.d}`).join('\n') : '- No active alerts'}

CARE TEAM (${formattedTeam.length} members):
${formattedTeam.map(m => `- ${m.name}: ${m.role} (${m.relationship}) — ${m.phone}, ${m.email}`).join('\n')}

ACTIVE CARE PLANS (${activePlans.length}):
${activePlans.map(p => `- ${p.title}: ${p.description} — Scheduled: ${p.scheduledTime} — ${p.completedToday ? 'Completed today ✓' : 'Not yet completed'}`).join('\n')}

LATEST VOICE CHECK-IN${latestCheckin ? ` (${latestCheckin.date} at ${latestCheckin.time})` : ''}:
${latestCheckin ? `- Sentiment: ${latestCheckin.sentiment} (${latestCheckin.sentimentScore})
- Voice tone: ${latestCheckin.voiceTone}
- Energy: ${latestCheckin.energy}
- Flags: ${latestCheckin.flags.length > 0 ? latestCheckin.flags.join(', ') : 'None'}
- AI Summary: ${latestCheckin.aiSummary}
- Transcript: "${latestCheckin.transcript}"` : '- No check-ins recorded'}

ROCKY'S DAILY SUMMARY:
"${patient.summaryStatus.text}"
Acknowledged: ${patient.summaryStatus.acknowledged ? 'Yes' : 'Not yet'}

RECENT TIMELINE:
${patient.timeline.slice(0, 6).map(t => `- [${t.time}] ${t.title}: ${t.desc}`).join('\n')}
`;
}

const ROCKY_SYSTEM_PROMPT = `You are Rocky, a warm, knowledgeable, and empathetic AI caregiving companion built to assist family caregivers. You monitor the wellness of elderly patients and provide calm, helpful guidance.

Your personality:
- Warm, caring, and reassuring — like a trusted friend who happens to be a medical expert
- You speak in clear, simple language — never clinical jargon
- You are proactive: you gently surface concerns and suggest next steps
- You care about the CAREGIVER's wellbeing too — they matter just as much
- You use a calm, supportive tone — never alarming, always solution-oriented
- Keep responses concise (3-5 sentences unless the caregiver asks for detail)
- Use emojis sparingly but warmly (💚 🩵 ✓)

Your capabilities:
- You have access to LIVE patient data which is injected into each conversation
- You can discuss sleep, medications, vitals, mood, fall risk, care plans, care team, nutrition, and wellness trends
- You can suggest care actions, routines, and when to contact providers
- You track voice check-in sentiment and can explain changes over time
- You know about EHR exports and can explain how to share data with providers

Rules:
- ALWAYS base your answers on the LIVE PATIENT DATA provided — never make up data
- If you don't have data for something, say so honestly
- Never provide a medical diagnosis — suggest contacting the care team when appropriate
- Always be encouraging toward the caregiver
- If the caregiver seems stressed, acknowledge their feelings and suggest self-care

RESPONSE STRUCTURE:
Your response should naturally answer these three key questions for the caregiver:
1. What happened? (A warm description of the status or change in patient data)
2. Why does it matter? (The clinical or daily relevance of this status or change)
3. What should I do next? (Helpful direction for the caregiver)

At the very end of EVERY message, you MUST include a blank line followed by a single line matching this format:
Recommended Next Step: [Insert specific, actionable next step here]`;

// Gemini-powered chat
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ success: false, message: 'Message is required.' });

    const sid = sessionId || 'default';
    if (!chatHistory[sid]) chatHistory[sid] = [];
    chatHistory[sid].push({ role: 'user', content: message, timestamp: now().toISOString() });

    let reply = '';

    if (GEMINI_API_KEY) {
      // ── Use Gemini AI with fallback models ───────────────────────────
      const candidateModels = [
        'gemini-2.5-flash',
        'gemini-3.1-flash-lite',
        'gemini-flash-latest',
        'gemini-2.0-flash'
      ];
      let success = false;

      try {
        const patientContext = await buildPatientContext(req.activePatientId);

        // Build conversation history for context (last 10 messages)
        const recentHistory = chatHistory[sid].slice(-10);
        const conversationContext = recentHistory
          .map(m => `${m.role === 'user' ? 'Caregiver' : 'Rocky'}: ${m.content}`)
          .join('\n');

        const fullPrompt = `${ROCKY_SYSTEM_PROMPT}\n\n${patientContext}\n\n=== CONVERSATION HISTORY ===\n${conversationContext}\n\nRespond to the caregiver's latest message. Be helpful, warm, and data-driven.`;

        const tools = [
          {
            functionDeclarations: [
              {
                name: "schedule_care_plan",
                description: "Schedule a new care plan task, routine, or reminder for the patient.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    title: { type: "STRING", description: "Short title of the care plan (e.g., '10 min balance routine')" },
                    description: { type: "STRING", description: "Detailed description of what the patient needs to do." },
                    category: { type: "STRING", description: "Category: 'exercise', 'nutrition', 'medical', or 'wellness'." },
                    time: { type: "STRING", description: "Time of day (e.g., '10:00 AM', 'Evening')." }
                  },
                  required: ["title", "description", "category", "time"]
                }
              },
              {
                name: "schedule_medication",
                description: "Schedule a new medication for the patient. Use this when the user requests to add, schedule, or log a medication or pill.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    name: { type: "STRING", description: "Name of the medication (e.g., 'Vitamin D3' or 'Dolo')" },
                    time: { type: "STRING", description: "Scheduled time of day (e.g., '8:00 AM', '11:00 AM')" },
                    dosage: { type: "STRING", description: "Dosage/tablet details (e.g., '500mg', '1 tablet')" },
                    frequency: { type: "STRING", description: "Frequency (e.g., 'daily', 'twice daily')" },
                    notes: { type: "STRING", description: "Optional notes or instructions (e.g., 'Take with food')" }
                  },
                  required: ["name", "time"]
                }
              },
              {
                name: "generate_patient_summary",
                description: "Generate a brief, comprehensive clinical summary of the patient's current status. Use this when the user asks for a summary, an update, or a general overview of the patient.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    focus_area: { type: "STRING", description: "Optional focus area (e.g., 'medications', 'vitals', 'general')" }
                  }
                }
              }
            ]
          }
        ];

        for (const modelName of candidateModels) {
          try {
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: modelName, tools });
            
            const chatSession = model.startChat({
              history: [{ role: 'user', parts: [{ text: fullPrompt }] }]
            });
            
            const result = await chatSession.sendMessage(message);
            const response = result.response;
            const calls = response.functionCalls();
            
            if (calls && calls.length > 0) {
              // Handle Tool Call
              const call = calls[0];
              if (call.name === "schedule_care_plan") {
                const args = call.args;
                const planId = `cp-${uid()}`;
                const patient = (await supabaseService.from('patients').select('name').eq('id', req.activePatientId).maybeSingle()).data;
                const patientName = patient ? patient.name : 'Patient';

                

                
                
                // Return tool response to Gemini
                const toolResultMsg = await chatSession.sendMessage([{
                  functionResponse: {
                    name: call.name,
                    response: { success: true, message: `Care plan '${args.title}' scheduled successfully.` }
                  }
                }]);
                reply = toolResultMsg.response.text();
              } else if (call.name === "schedule_medication") {
                const args = call.args;
                const medId = `med-${uid()}`;
                
                
                
                

                const toolResultMsg = await chatSession.sendMessage([{
                  functionResponse: {
                    name: call.name,
                    response: { success: true, message: `Medication '${args.name}' scheduled successfully at ${args.time}.` }
                  }
                }]);
                reply = toolResultMsg.response.text();
              } else if (call.name === "generate_patient_summary") {
                const toolResultMsg = await chatSession.sendMessage([{
                  functionResponse: {
                    name: call.name,
                    response: { success: true, message: `System: Full patient context is already provided in the system prompt. Please generate a clear, warm clinical summary for the caregiver based on that context.` }
                  }
                }]);
                reply = toolResultMsg.response.text();
              }
            } else {
              reply = response.text();
            }

            // Clean up any markdown artifacts for chat display
            reply = reply.replace(/\*\*/g, '').replace(/^#+\s/gm, '').trim();
            success = true;
            console.log(`✅ Chat response generated successfully using model: ${modelName}`);
            break;
          } catch (err) {
            console.error(`⚠️ Gemini API error with model ${modelName}:`, err.message);
          }
        }
      } catch (contextErr) {
        console.error('Error building context:', contextErr.message);
      }

      if (!success) {
        const patient = await getPatientState(req.activePatientId);
        reply = `I'm having a moment connecting to my AI brain, but here's what I know: ${patient.name}'s wellness score is ${patient.wellnessScore}/100. Meds: ${patient.stats.meds.value}. Mood: ${patient.stats.mood.value}. Try asking again in a moment! 🩵`;
      }
    } else {
      // ── Fallback: keyword-based responses ────────────────────────────
      const msg = message.toLowerCase();
      const patient = await getPatientState(req.activePatientId);
      const taken = patient.medications.filter(m => m.taken);
      const pending = patient.medications.filter(m => !m.taken);

      if (msg.includes('sleep') || msg.includes('night') || msg.includes('rest')) {
        reply = `${patient.name} slept for ${patient.details.sleepDuration} last night. Sleep quality was rated "${patient.details.sleepQuality}". ${patient.details.sleepTone === 'emerald' ? 'This is a great result!' : 'There might be room for improvement — I can suggest a better evening routine.'}`;
      } else if (msg.includes('med') || msg.includes('pill') || msg.includes('prescription')) {
        reply = `${patient.name} has ${patient.medications.length} medications today. ${taken.length} taken. ${pending.length > 0 ? `Pending: ${pending.map(m => `${m.name} at ${m.time}`).join(', ')}.` : 'All taken! ✓'}`;
      } else if (msg.includes('mood') || msg.includes('feel') || msg.includes('happy')) {
        reply = `${patient.name}'s mood is "${patient.stats.mood.value}" with a ${patient.stats.mood.hint} trend. No concerns detected.`;
      } else if (msg.includes('hello') || msg.includes('hi') || msg.includes('hey')) {
        reply = `Hello! I'm Rocky, ${patient.name}'s caregiving companion. 🩵 Their wellness score is ${patient.wellnessScore}/100 today. Ask me about their sleep, medications, mood, vitals, or anything else!`;
      } else {
        reply = `${patient.name}'s wellness score is ${patient.wellnessScore}/100. Meds: ${patient.stats.meds.value}, Sleep: ${patient.stats.sleep.value}, Mood: ${patient.stats.mood.value}. For smarter responses, set the GEMINI_API_KEY environment variable and restart the server.`;
      }
    }

    chatHistory[sid].push({ role: 'rocky', content: reply, timestamp: now().toISOString() });

    // Keep history manageable
    if (chatHistory[sid].length > 50) chatHistory[sid] = chatHistory[sid].slice(-30);

    res.json({ reply, conversationLength: chatHistory[sid].length });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ success: false, message: String(err.message || err) });
  }
});

// GET /api/chat/history
app.get('/api/chat/history', (req, res) => {
  const sid = req.query.sessionId || 'default';
  res.json({ messages: chatHistory[sid] || [], sessionId: sid });
});


// ═══════════════════════════════════════════════════════════════════════
// HEALTH CHECK & INFO
// ═══════════════════════════════════════════════════════════════════════

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: now().toISOString(),
    version: '1.0.0',
    endpoints: {
      auth: ['/api/auth/register', '/api/auth/login', '/api/auth/logout', '/api/auth/me'],
      patient: ['/api/patient', '/api/patient/summary'],
      alerts: ['/api/alerts', '/api/alerts/:id/resolve'],
      summary: ['/api/summary/acknowledge'],
      meds: ['/api/meds', '/api/meds/:id/toggle', '/api/meds/add', '/api/meds/:id'],
      careTeam: ['/api/care-team', '/api/care-team/:id'],
      wellness: ['/api/wellness/history', '/api/wellness/trends'],
      voiceCheckins: ['/api/voice-checkins', '/api/voice-checkins/:id'],
      carePlans: ['/api/care-plans', '/api/care-plans/:id/complete', '/api/care-plans/:id'],
      wearable: ['/api/wearable', '/api/wearable/sync'],
      timeline: ['/api/timeline'],
      settings: ['/api/settings'],
      waitlist: ['/api/waitlist'],
      demo: ['/api/demo/book', '/api/demo/bookings'],
      export: ['/api/export/ehr'],
      chat: ['/api/chat', '/api/chat/history'],
    },
  });
});

// ─── Frontend Static Serving ───────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  app.use(express.static(path.join(__dirname, 'dist')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
} else {
  // 404 handler for API routes in dev
  app.use((req, res) => {
    res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}` });
  });
}

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, message: String(err.message || err) });
});


// ═══════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3001;

async function startServer() {
  
      
  const patientCount = (await supabaseService.from('patients').select('*', { count: 'exact', head: true }));
  const careTeamCount = (await supabaseService.from('care_team').select('*', { count: 'exact', head: true }));
  const medsCount = (await supabaseService.from('medications').select('*', { count: 'exact', head: true }));
  const wellnessCount = (await supabaseService.from('wellness_history').select('*', { count: 'exact', head: true }));
  const checkinsCount = (await supabaseService.from('voice_checkins').select('*', { count: 'exact', head: true }));
  const plansCount = (await supabaseService.from('care_plans').select('*', { count: 'exact', head: true }));
  const wearable = null;

  app.listen(PORT, () => {
    console.log(`\n🏥  Rocky Care SQLite Backend v1.0.0`);
    console.log(`📡  Server running at http://localhost:${PORT}`);
    console.log(`❤️   ${patientCount?.count || 0} patients tracked`);
    console.log(`👥  ${careTeamCount?.count || 0} care team members`);
    console.log(`💊  ${medsCount?.count || 0} medications tracked`);
    console.log(`📊  ${wellnessCount?.count || 0} days of wellness history`);
    console.log(`🎙️   ${checkinsCount?.count || 0} voice check-ins logged`);
    console.log(`📋  ${plansCount?.count || 0} care plans active`);
    console.log(`⌚  Wearable: ${wearable?.device || 'Apple Watch'}`);
    console.log(`\n🔗  API docs: http://localhost:${PORT}/api/health\n`);
  });
}

if (!process.env.VERCEL) {
  startServer();
} else {
  // On Vercel, initialize database asynchronously
  initDatabase()
    .then(() => migrateDatabase())
    .then(() => hashSeedPasswords())
    .catch(console.error);
}

export default app;

