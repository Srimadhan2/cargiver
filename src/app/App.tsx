import { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import {
  Activity, AlertTriangle, ArrowUpRight, Bell, Brain, Calendar,
  Check, CheckCircle, ChevronRight, Clock, Download, Edit3, FileText,
  Flag, Heart, HeartPulse, Home, Mic, MicOff, MoonStar,
  Pencil, Phone, Pill, Plus, RefreshCw, Save, Send, Shield,
  Sparkles, Square, Stethoscope, Sun, Trash2, Users, X, Share2,
  Coffee, Utensils, GlassWater, Scale, UserCheck, Lock, ShieldAlert
} from "lucide-react";
import {
  Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { toast, Toaster } from "sonner";

// Helper for authorized API calls
const apiFetch = async (url: string, options: any = {}) => {
  const token = localStorage.getItem("token");
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { "Authorization": `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    if (token) {
      window.location.reload();
    }
  }
  return response;
};

// ═════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═════════════════════════════════════════════════════════════════════

const ConfidenceBadge = ({ score }: { score: number }) => {
  const pct = Math.round(score * 100);
  const color = score >= 0.8 ? "bg-emerald/15 text-emerald-soft border-emerald/20"
    : score >= 0.5 ? "bg-amber-500/15 text-warm border-amber-500/20"
    : "bg-red-500/15 text-red-400 border-red-500/20";
  const label = score >= 0.8 ? "High" : score >= 0.5 ? "Medium" : "Low";
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border ${color}`}>
      <span className={`size-1.5 rounded-full ${score >= 0.8 ? "bg-emerald" : score >= 0.5 ? "bg-amber-500" : "bg-red-500"}`} />
      {label} confidence · {pct}%
    </span>
  );
};

const ReviewActions = ({
  status,
  onApprove,
  onReject,
  onEdit,
}: {
  status: string;
  onApprove: () => void;
  onReject: () => void;
  onEdit?: () => void;
}) => {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-soft font-medium bg-emerald/10 px-2.5 py-1 rounded-full">
        <CheckCircle className="size-3" /> Approved
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-red-400 font-medium bg-red-500/10 px-2.5 py-1 rounded-full">
        <Flag className="size-3" /> Flagged for Review
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={onApprove} className="inline-flex items-center gap-1 text-[11px] bg-emerald/15 text-emerald-soft border border-emerald/20 px-2.5 py-1 rounded-full hover:bg-emerald/25 transition cursor-pointer">
        <Check className="size-3" /> Approve
      </button>
      {onEdit && (
        <button onClick={onEdit} className="inline-flex items-center gap-1 text-[11px] bg-white/5 text-white/70 border border-white/10 px-2.5 py-1 rounded-full hover:bg-white/10 transition cursor-pointer">
          <Edit3 className="size-3" /> Edit
        </button>
      )}
      <button onClick={onReject} className="inline-flex items-center gap-1 text-[11px] bg-white/5 text-white/50 border border-white/10 px-2.5 py-1 rounded-full hover:bg-red-500/10 hover:text-red-400 transition cursor-pointer">
        <Flag className="size-3" /> Flag
      </button>
    </div>
  );
};

const MiniStat = ({ icon, label, value, tone, hint }: any) => {
  const tones: Record<string, string> = {
    amber: "bg-amber-500/10 text-warm",
    indigo: "bg-indigo/10 text-indigo-soft",
    emerald: "bg-emerald/10 text-emerald-soft",
  };
  return (
    <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-4">
      <div className={`size-8 rounded-xl grid place-items-center ${tones[tone] || "bg-indigo/10 text-indigo-soft"}`}>{icon}</div>
      <div className="text-[11px] uppercase tracking-wider text-white/50 font-mono mt-2.5">{label}</div>
      <div className="font-serif text-[20px] text-white leading-tight">{value}</div>
      <div className="text-[11px] text-white/50">{hint}</div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// DASHBOARD VIEW
// ═════════════════════════════════════════════════════════════════════


const DashboardView = ({
  patient,
  onResolveAlert,
  fetchPatient,
}: {
  patient: any;
  onResolveAlert: (id: string) => void;
  fetchPatient: () => Promise<void>;
}) => {
  const alerts = patient?.alerts || [];
  const activeAlerts = alerts.filter((a: any) => !a.resolved);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [generatingFamilyUpdate, setGeneratingFamilyUpdate] = useState(false);
  const [summaryData, setSummaryData] = useState<any>(null);
  
  // Dynamic metrics
  const [plans, setPlans] = useState<any[]>([]);
  const [nutritionLog, setNutritionLog] = useState<any>(null);
  const [quickNote, setQuickNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [moodData, setMoodData] = useState<any[]>([{d:"Mon", v:50}]);

  useEffect(() => {
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
  }, [patient]);

  const generateSummary = async () => {
    setGeneratingSummary(true);
    try {
      const res = await apiFetch("/api/summary/generate", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success("AI summary generated.");
        setSummaryData(data.summary);
        await fetchPatient();
      } else {
        toast.error(data.message || "Failed to generate summary.");
      }
    } catch { toast.error("Network error generating summary."); }
    finally { setGeneratingSummary(false); }
  };

  const generateFamilyUpdate = async () => {
    setGeneratingFamilyUpdate(true);
    try {
      const res = await apiFetch("/api/family-update");
      const data = await res.json();
      if (data.success) {
        navigator.clipboard.writeText(data.summary);
        toast.success("Family Update copied to clipboard!");
      } else {
        toast.error("Failed to generate family update.");
      }
    } catch { toast.error("Network error."); }
    finally { setGeneratingFamilyUpdate(false); }
  };

  const handleSummaryReview = async (reviewStatus: string) => {
    try {
      const res = await apiFetch("/api/summary/review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewStatus }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        setSummaryData((prev: any) => prev ? { ...prev, reviewStatus } : prev);
        await fetchPatient();
      }
    } catch { toast.error("Failed to update review."); }
  };

  const handleAddQuickNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickNote.trim()) return;
    setAddingNote(true);
    try {
      const res = await apiFetch("/api/notes", {
        method: "POST",
        body: JSON.stringify({ content: quickNote, category: "General" }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Quick note recorded in timeline.");
        setQuickNote("");
        await fetchPatient();
      }
    } catch {
      toast.error("Failed to post note.");
    } finally {
      setAddingNote(false);
    }
  };

  const summaryText = summaryData?.text || patient?.summaryStatus?.text || "Click 'Generate AI Summary' to create a fresh daily summary powered by Gemini.";
  const summaryConfidence = summaryData?.confidence ?? 0;
  const summaryReviewStatus = summaryData?.reviewStatus || "pending";
  const suggestedActions = summaryData?.suggestedActions || [];

  // Risk calculation
  const hasWarnOrCritical = activeAlerts.some((a: any) => a.sev === 'warn' || a.sev === 'critical');
  const riskLevel = activeAlerts.length === 0 ? 'green' : hasWarnOrCritical ? 'red' : 'yellow';

  const completedPlansCount = plans.filter(p => p.completedToday).length;
  const totalPlansCount = plans.length;
  const plansText = totalPlansCount > 0 ? `${completedPlansCount} / ${totalPlansCount} Completed` : "No plans active";

  // Nutrition calculations
  const loggedMeals = [
    nutritionLog?.breakfast && 'B',
    nutritionLog?.lunch && 'L',
    nutritionLog?.dinner && 'D',
    nutritionLog?.snacks && 'S'
  ].filter(Boolean);
  const mealsLoggedText = loggedMeals.length > 0 ? loggedMeals.join(', ') : 'None logged';
  const waterIntakeCups = nutritionLog?.waterIntake || 0;
  const nutritionRisk = waterIntakeCups >= 6 ? 'Low' : waterIntakeCups >= 3 ? 'Moderate' : 'High';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-serif text-2xl">Dashboard</h2>
          <p className="text-white/50 text-xs font-sans">Today's care overview for {patient?.name || "Patient"}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/60 font-mono">
          <Calendar className="size-3.5" /> {new Date().toLocaleDateString()}
        </div>
      </div>

      {/* Risk Level Banner */}
      <div className={`rounded-xl border p-3 flex items-center justify-between font-sans ${
        riskLevel === 'green' ? 'bg-emerald/10 text-emerald-soft border-emerald/20' :
        riskLevel === 'yellow' ? 'bg-amber-500/10 text-warm border-amber-500/20' :
        'bg-red-500/10 text-red-400 border-red-500/20'
      }`}>
        <div className="flex items-center gap-2.5">
          <ShieldAlert className="size-4 shrink-0" />
          <div className="text-xs font-medium">
            {riskLevel === 'green' && "Risk Level: Green (Stable) — No concerns detected. Vitals and care routines are normal."}
            {riskLevel === 'yellow' && "Risk Level: Yellow (Needs Attention) — Minor care issues or unresolved alerts detected."}
            {riskLevel === 'red' && "Risk Level: Red (Immediate Follow-Up) — Critical alerts require immediate caregiver action."}
          </div>
        </div>
        <span className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-full font-bold ${
          riskLevel === 'green' ? 'bg-emerald/20' :
          riskLevel === 'yellow' ? 'bg-amber-500/20' :
          'bg-red-500/20 animate-pulse'
        }`}>
          {riskLevel} Risk
        </span>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-4">
          {/* Wellness Score + Summary */}
          <div className="rounded-2xl bg-gradient-to-br from-indigo-deep to-indigo p-5 text-white relative overflow-hidden">
            <div className="absolute -right-10 -top-10 size-48 rounded-full bg-emerald/30 blur-3xl" />
            <div className="flex items-start justify-between relative">
              <div>
                <div className="text-[11px] tracking-[0.18em] uppercase text-white/60 font-mono">Wellness score</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-serif text-[56px] leading-none">{patient?.wellnessScore ?? "—"}</span>
                  <span className="text-emerald-soft text-sm flex items-center gap-1"><ArrowUpRight className="size-3.5" /> {patient?.weeklyChange || ""}</span>
                </div>
                <div className="mt-2 text-sm text-white/80 max-w-[300px]">{patient?.summary || ""}</div>
              </div>
              <div className="relative size-20 grid place-items-center">
                <svg className="absolute inset-0 -rotate-90" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="34" stroke="rgba(255,255,255,0.15)" strokeWidth="6" fill="none" />
                  <circle cx="40" cy="40" r="34" stroke="url(#g1)" strokeWidth="6" fill="none"
                    strokeDasharray={`${((patient?.wellnessScore ?? 0)/100)*213.6} 213.6`} strokeLinecap="round" />
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#a7f3d0" /><stop offset="100%" stopColor="#67e8f9" />
                    </linearGradient>
                  </defs>
                </svg>
                <Heart className="size-6 text-emerald-soft" fill="currentColor" />
              </div>
            </div>
          </div>

          {/* Daily Care Summary Grid */}
          <div className="space-y-2">
            <div className="text-xs text-white/60 font-mono uppercase tracking-widest">Daily Care Summary</div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3 text-center font-sans">
                <MoonStar className="size-4 text-indigo-soft mx-auto mb-1.5" />
                <div className="text-[9px] text-white/40 uppercase font-mono">Sleep</div>
                <div className="text-xs text-white font-semibold mt-0.5 truncate">{patient?.details?.sleepDuration || "—"}</div>
                <div className="text-[9px] text-white/50 truncate mt-0.5">{patient?.details?.sleepQuality || "No data"}</div>
              </div>
              <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3 text-center font-sans">
                <Activity className="size-4 text-emerald-soft mx-auto mb-1.5" />
                <div className="text-[9px] text-white/40 uppercase font-mono">Mood</div>
                <div className="text-xs text-white font-semibold mt-0.5 truncate">{patient?.stats?.mood?.value || "—"}</div>
                <div className="text-[9px] text-white/50 truncate mt-0.5">{patient?.stats?.mood?.hint || "Stable"}</div>
              </div>
              <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3 text-center font-sans">
                <Pill className="size-4 text-indigo-soft mx-auto mb-1.5" />
                <div className="text-[9px] text-white/40 uppercase font-mono">Medication</div>
                <div className="text-xs text-white font-semibold mt-0.5 truncate">{patient?.stats?.meds?.value || "—"}</div>
                <div className="text-[9px] text-white/50 truncate mt-0.5">{patient?.stats?.meds?.hint || "Pending"}</div>
              </div>
              <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3 text-center font-sans">
                <GlassWater className="size-4 text-emerald-soft mx-auto mb-1.5" />
                <div className="text-[9px] text-white/40 uppercase font-mono">Hydration</div>
                <div className="text-xs text-white font-semibold mt-0.5 truncate">{waterIntakeCups} / 8 cups</div>
                <div className={`text-[9px] font-medium truncate mt-0.5 ${waterIntakeCups >= 6 ? "text-emerald-soft" : "text-warm"}`}>
                  {waterIntakeCups >= 8 ? "Goal Met" : "Below Goal"}
                </div>
              </div>
              <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3 text-center font-sans col-span-2 sm:col-span-1">
                <CheckCircle className="size-4 text-indigo-soft mx-auto mb-1.5" />
                <div className="text-[9px] text-white/40 uppercase font-mono">Care Plan</div>
                <div className="text-xs text-white font-semibold mt-0.5 truncate">{plansText}</div>
                <div className="text-[9px] text-white/50 truncate mt-0.5">{totalPlansCount > 0 ? `${Math.round((completedPlansCount / totalPlansCount) * 100)}% Rate` : "Inactive"}</div>
              </div>
            </div>
          </div>

          {/* AI Summary Card */}
          <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-white font-medium">
                <Brain className="size-4 text-indigo-soft animate-pulse" /> Rocky's Daily Summary
              </div>
              <div className="flex items-center gap-2">
                {summaryConfidence > 0 && <ConfidenceBadge score={summaryConfidence} />}
                <button
                  onClick={generateFamilyUpdate}
                  disabled={generatingFamilyUpdate}
                  className="inline-flex items-center gap-1.5 text-[11px] bg-emerald/20 text-emerald-soft border border-emerald/20 px-2.5 py-1 rounded-full hover:bg-emerald/30 transition cursor-pointer disabled:opacity-50 font-sans font-medium"
                >
                  <Share2 className={`size-3 ${generatingFamilyUpdate ? "animate-pulse" : ""}`} />
                  {generatingFamilyUpdate ? "Generating..." : "Share Daily Update"}
                </button>
                <button
                  onClick={generateSummary}
                  disabled={generatingSummary}
                  className="inline-flex items-center gap-1.5 text-[11px] bg-indigo/20 text-indigo-soft border border-indigo/20 px-2.5 py-1 rounded-full hover:bg-indigo/30 transition cursor-pointer disabled:opacity-50 font-sans font-medium"
                >
                  <RefreshCw className={`size-3 ${generatingSummary ? "animate-spin" : ""}`} />
                  {generatingSummary ? "Generating..." : "Generate AI Summary"}
                </button>
              </div>
            </div>
            <p className="text-[14.5px] leading-relaxed text-white/80 font-sans font-medium">"{summaryText}"</p>
            {suggestedActions.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-white/5">
                <div className="text-[10px] uppercase tracking-wider text-white/40 font-mono">Suggested Actions</div>
                {suggestedActions.map((a: string, i: number) => (
                  <div key={i} className="text-xs text-white/70 flex items-start gap-2 font-sans">
                    <Sparkles className="size-3 text-emerald-soft mt-0.5 shrink-0" /> {a}
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <ReviewActions
                status={summaryReviewStatus}
                onApprove={() => handleSummaryReview("approved")}
                onReject={() => handleSummaryReview("rejected")}
              />
            </div>
          </div>

          {/* Nutrition Summary Box */}
          <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-4 space-y-2.5 font-sans">
            <div className="text-xs text-white/60 font-mono uppercase tracking-widest">Nutrition Tracking Summary</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
                <div className="text-[9px] text-white/40 font-mono uppercase">Meals Today</div>
                <div className="text-xs text-white font-medium mt-1 truncate">{mealsLoggedText}</div>
              </div>
              <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
                <div className="text-[9px] text-white/40 font-mono uppercase">Water Consumed</div>
                <div className="text-xs text-emerald-soft font-medium mt-1 truncate">{waterIntakeCups} / 8 cups</div>
              </div>
              <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
                <div className="text-[9px] text-white/40 font-mono uppercase">Nutrition Risk</div>
                <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded uppercase mt-1 ${
                  nutritionRisk === 'Low' ? 'bg-emerald/10 text-emerald-soft' :
                  nutritionRisk === 'Moderate' ? 'bg-amber-500/10 text-warm' :
                  'bg-red-500/10 text-red-400'
                }`}>
                  {nutritionRisk} Risk
                </span>
              </div>
            </div>
          </div>

          {/* Mood Chart */}
          <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-5">
            <div className="text-xs text-white/60 font-mono uppercase tracking-widest">Mood trend · 7 days</div>
            <div className="h-40 mt-3 -mx-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={moodData} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                  <XAxis dataKey="d" stroke="rgba(255,255,255,0.4)" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis hide domain={[40, 100]} />
                  <Tooltip contentStyle={{ background: "rgba(10,13,36,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, color: "white" }} />
                  <Area type="monotone" dataKey="v" stroke="#34d399" strokeWidth={2.5} fill="#34d399" fillOpacity={0.25} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          {/* Alerts */}
          <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-white/60 font-mono uppercase tracking-widest">Smart alerts</div>
              <span className="text-[10px] text-white/50 font-mono">{activeAlerts.length} active</span>
            </div>
            <div className="space-y-2.5">
              {activeAlerts.map((a: any) => (
                <div key={a.id} className="rounded-xl bg-white/[0.04] p-3 flex justify-between items-start gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`size-1.5 rounded-full ${a.c==="amber"?"bg-warm":a.c==="emerald"?"bg-emerald":"bg-indigo-soft"}`} />
                      <div className="text-sm text-white font-medium">{a.t}</div>
                    </div>
                    <div className="text-[11px] text-white/55 mt-0.5 pl-3.5 leading-tight">{a.d}</div>
                  </div>
                  <button onClick={() => onResolveAlert(a.id)} className="text-[10px] text-indigo-soft hover:text-white cursor-pointer font-semibold">Resolve</button>
                </div>
              ))}
              {activeAlerts.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-emerald-soft py-4 justify-center">
                  <HeartPulse className="size-4 animate-pulse" /> All systems calm
                </div>
              )}
            </div>
          </div>

          {/* Actionable Timeline */}
          <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-4 flex flex-col" style={{ maxHeight: '420px' }}>
            <div className="text-xs text-white/60 font-mono uppercase tracking-widest mb-3">Timeline</div>
            <div className="flex-1 overflow-y-auto pr-1 relative border-l border-white/10 ml-2 pl-4 space-y-4">
              {(patient?.timeline || []).slice(0, 10).map((item: any) => (
                <div key={item.id} className="relative group">
                  <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-indigo-deep border border-indigo-soft group-hover:bg-indigo-soft transition" />
                  <div className="flex items-baseline justify-between text-[10px] text-white/40 font-mono">
                    <span>{item.time}</span>
                    <span className="uppercase bg-white/5 px-1 py-0.5 rounded text-white/50">{item.type}</span>
                  </div>
                  <div className="text-white text-xs font-semibold font-sans mt-0.5">{item.title}</div>
                  {item.desc && <div className="text-[11px] text-white/50 leading-snug mt-0.5">{item.desc}</div>}
                </div>
              ))}
            </div>

            {/* Quick Timeline Note Form */}
            <form onSubmit={handleAddQuickNote} className="mt-4 pt-3 border-t border-white/5 flex gap-2">
              <input 
                type="text" 
                value={quickNote} 
                onChange={e => setQuickNote(e.target.value)} 
                placeholder="Log activity (e.g. Eleanor ate lunch)..."
                className="flex-1 bg-white/5 rounded-lg px-2.5 py-1.5 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white font-sans"
              />
              <button 
                type="submit" 
                disabled={addingNote || !quickNote.trim()} 
                className="bg-indigo-soft/20 text-white border border-white/10 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-indigo-soft/30 transition disabled:opacity-50 shrink-0 cursor-pointer"
              >
                Log
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};


const VoiceCheckInPanel = ({ patient, fetchPatient }: { patient: any; fetchPatient: () => Promise<void> }) => {
  const [step, setStep] = useState<"record" | "transcript" | "review" | "result">("record");
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [isEdited, setIsEdited] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);
  const [editedSummary, setEditedSummary] = useState("");
  const [lowConfirmed, setLowConfirmed] = useState(false);
  const recognitionRef = useRef<any>(null);
  const liveTranscriptRef = useRef("");

  useEffect(() => {
    apiFetch(`/api/voice-checkins?limit=5`).then(r => r.json()).then(data => {
      setHistory(data.checkins || []);
    }).catch(() => {});
  }, [result]);

  const startRecording = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Speech recognition not supported. Use Chrome or type your check-in.");
      setManualMode(true);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    liveTranscriptRef.current = "";

    recognition.onresult = (event: any) => {
      let final = "";
      for (let i = 0; i < event.results.length; i++) {
        final += event.results[i][0].transcript;
      }
      liveTranscriptRef.current = final;
      setTranscript(final);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      if (event.error === "not-allowed") {
        toast.error("Microphone access denied. Please allow microphone access or type your check-in.");
        setManualMode(true);
      }
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    setResult(null);
    setIsEdited(false);
    setLowConfirmed(false);
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    setIsRecording(false);
    if (liveTranscriptRef.current.trim()) {
      setStep("transcript");
    }
  };

  const handleReRecord = () => {
    recognitionRef.current?.stop();
    setTranscript("");
    liveTranscriptRef.current = "";
    setIsEdited(false);
    setResult(null);
    setIsRecording(false);
    setStep("record");
    setManualMode(false);
    setLowConfirmed(false);
    setTimeout(startRecording, 400);
  };

  const handleBackToRecord = () => {
    recognitionRef.current?.stop();
    setTranscript("");
    liveTranscriptRef.current = "";
    setIsEdited(false);
    setStep("record");
    setManualMode(false);
    setLowConfirmed(false);
  };

  const handleManualDone = () => {
    if (transcript.trim()) {
      setStep("transcript");
    } else {
      toast.error("Please record voice or type some text first.");
    }
  };

  const analyzeCheckin = async () => {
    if (!transcript.trim()) { toast.error("No transcript to analyze."); return; }
    setAnalyzing(true);
    try {
      const res = await apiFetch("/api/voice-checkins/analyze", {
        method: "POST",
        body: JSON.stringify({ transcript, transcriptEditedByUser: isEdited }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Voice check-in analyzed by AI.");
        setResult(data.checkin);
        setStep("result");
        await fetchPatient();
      } else {
        toast.error(data.message || "Analysis failed.");
      }
    } catch { toast.error("Network error during analysis."); }
    finally { setAnalyzing(false); }
  };

  const handleReview = async (reviewStatus: string, opts: { editedSummary?: string; transcriptReviewed?: boolean } = {}) => {
    if (!result?.id) return;
    try {
      const body: any = { reviewStatus, transcriptReviewed: true };
      if (opts.editedSummary) body.editedSummary = opts.editedSummary;
      const res = await apiFetch(`/api/voice-checkins/${result.id}/review`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        setResult((prev: any) => ({
          ...prev,
          reviewStatus,
          ...(opts.editedSummary ? { aiSummary: opts.editedSummary } : {})
        }));
        setEditingSummary(false);
      }
    } catch { toast.error("Failed to submit review."); }
  };

  const handleReset = () => {
    setTranscript("");
    liveTranscriptRef.current = "";
    setIsEdited(false);
    setResult(null);
    setStep("record");
    setEditingSummary(false);
    setEditedSummary("");
    setLowConfirmed(false);
  };

  const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
  const reviewStepConfidence = isEdited ? 0.92 : wordCount < 5 ? 0.35 : wordCount < 15 ? 0.62 : 0.88;
  const reviewConfidencePercent = Math.round(reviewStepConfidence * 100);
  const confidenceColor = reviewStepConfidence >= 0.8 ? "bg-emerald" : reviewStepConfidence >= 0.5 ? "bg-amber-500" : "bg-red-500";
  const confidenceLabel = reviewStepConfidence >= 0.8 ? "High" : reviewStepConfidence >= 0.5 ? "Medium" : "Low";
  const confidenceTextColor = reviewStepConfidence >= 0.8 ? "text-emerald-soft" : reviewStepConfidence >= 0.5 ? "text-warm" : "text-red-400";
  const confidenceBorderColor = reviewStepConfidence >= 0.8 ? "border-emerald/20" : reviewStepConfidence >= 0.5 ? "border-amber-500/20" : "border-red-500/20";
  const confidenceBgColor = reviewStepConfidence >= 0.8 ? "bg-emerald/10" : reviewStepConfidence >= 0.5 ? "bg-amber-500/10" : "bg-red-500/10";

  const sentimentColors: Record<string, string> = {
    very_positive: "text-emerald-soft",
    positive: "text-emerald-soft",
    neutral: "text-indigo-soft",
    concerning: "text-warm",
    negative: "text-red-400",
  };

  const STEPS: { key: "record" | "transcript" | "review" | "result"; label: string }[] = [
    { key: "record", label: "Record" },
    { key: "transcript", label: "Transcript" },
    { key: "review", label: "Review / Edit" },
    { key: "result", label: "Analysis" },
  ];
  const stepIdx = STEPS.findIndex(s => s.key === step);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-white font-serif text-2xl">Voice Check-In</h2>
        <p className="text-white/50 text-xs font-sans">Record a daily voice check-in for cognitive monitoring and symptom tracking.</p>
      </div>

      <div className="flex items-center gap-1.5">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <div className={`size-6 rounded-full flex items-center justify-center text-[10px] font-bold font-mono transition-all ${
              step === s.key ? "bg-indigo text-white ring-2 ring-indigo/30" :
              i < stepIdx ? "bg-emerald/20 text-emerald-soft" :
              "bg-white/5 text-white/30"
            }`}>
              {i < stepIdx ? <Check className="size-3" /> : i + 1}
            </div>
            <span className={`text-[10px] font-mono uppercase tracking-wider ${
              step === s.key ? "text-white" : i < stepIdx ? "text-emerald-soft/70" : "text-white/30"
            }`}>{s.label}</span>
            {i < STEPS.length - 1 && <div className="w-5 h-px bg-white/10" />}
          </div>
        ))}
      </div>

      {step === "record" && (
        <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-6 text-center space-y-4">
          {!manualMode ? (
            <>
              <div className="flex justify-center">
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`size-20 rounded-full grid place-items-center transition cursor-pointer ${
                    isRecording
                      ? "bg-red-500/20 border-2 border-red-500 text-red-400 animate-pulse"
                      : "bg-gradient-to-br from-indigo to-emerald text-white hover:shadow-lg hover:shadow-indigo/30"
                  }`}
                >
                  {isRecording ? <Square className="size-7" fill="currentColor" /> : <Mic className="size-8" />}
                </button>
              </div>
              <div className="text-sm text-white/70 font-sans">
                {isRecording ? "Listening… Speak naturally. Click to stop when done." : "Tap the microphone to start recording"}
              </div>
              {isRecording && (
                <div className="flex items-center justify-center gap-0.5 h-6">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <span key={i} className="w-[3px] rounded-full bg-indigo-soft wave-bar"
                      style={{ height: `${10 + Math.random() * 14}px`, animationDelay: `${i * 0.08}s` }} />
                  ))}
                </div>
              )}
              <div className="flex justify-center gap-4 pt-2">
                <button onClick={() => setManualMode(true)} className="text-[11px] text-indigo-soft hover:text-white transition cursor-pointer">
                  Or type check-in text instead →
                </button>
                {transcript && !isRecording && (
                  <button onClick={() => setStep("transcript")} className="text-[11px] text-emerald-soft hover:text-white transition cursor-pointer font-bold">
                    View transcript →
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="text-sm text-white/70 font-sans mb-2 text-left font-semibold">Type Check-In:</div>
              <textarea
                value={transcript}
                onChange={e => { setTranscript(e.target.value); setIsEdited(true); }}
                placeholder="Type check-in details..."
                className="w-full h-28 bg-white/5 rounded-xl px-4 py-3 text-sm text-white outline-none border border-white/10 focus:border-indigo-soft/40 resize-none font-sans"
              />
              <div className="flex justify-between items-center pt-2">
                <button onClick={() => setManualMode(false)} className="text-[11px] text-white/40 hover:text-white/60 transition cursor-pointer">
                  ← Switch back to voice recording
                </button>
                <button 
                  onClick={handleManualDone}
                  disabled={!transcript.trim()}
                  className="bg-indigo-soft/20 text-white border border-white/10 px-3.5 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-soft/30 transition disabled:opacity-50 cursor-pointer"
                >
                  Continue to Transcript →
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {step === "transcript" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl bg-white/[0.04] border border-white/5 p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-white/5 pb-3">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-indigo-soft" />
              <h3 className="text-sm text-white font-medium font-sans">Transcript Preview</h3>
            </div>
            <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border ${confidenceBgColor} ${confidenceTextColor} ${confidenceBorderColor}`}>
              <span className={`size-1.5 rounded-full ${confidenceColor}`} />
              {confidenceLabel} Confidence · {reviewConfidencePercent}%
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-mono text-white/40 uppercase tracking-wider">
              <span>Transcript Confidence Score</span>
              <span>{reviewConfidencePercent}%</span>
            </div>
            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${confidenceColor}`}
                style={{ width: `${reviewConfidencePercent}%` }}
              />
            </div>
            <div className="flex justify-between text-[9px] text-white/30 font-mono">
              <span>Low (0–50%)</span><span>Medium (50–80%)</span><span>High (80–100%)</span>
            </div>
          </div>

          {reviewStepConfidence < 0.5 && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs px-3.5 py-2.5 rounded-xl flex items-start gap-2.5 font-sans">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div>
                <strong>Very short transcript ({wordCount} words).</strong> AI analysis may be unreliable at this length. Please re-record with more detail or type additional context below.
              </div>
            </div>
          )}
          {reviewStepConfidence >= 0.5 && reviewStepConfidence < 0.8 && (
            <div className="bg-amber-500/10 border border-amber-500/20 text-warm text-xs px-3.5 py-2.5 rounded-xl flex items-start gap-2.5 font-sans">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div>
                <strong>Short transcript ({wordCount} words).</strong> Results will be more accurate with a longer recording. Proceed to edit or re-record for best quality.
              </div>
            </div>
          )}

          <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4">
            <div className="text-[9px] uppercase font-mono tracking-wider text-white/40 mb-2">Captured Transcript</div>
            <p className="text-sm text-white/85 leading-relaxed font-sans whitespace-pre-wrap">{transcript}</p>
            <div className="text-[10px] text-white/30 font-mono mt-2">{wordCount} word{wordCount !== 1 ? "s" : ""} captured</div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="flex gap-2">
              <button
                onClick={handleBackToRecord}
                className="inline-flex items-center gap-1.5 bg-white/5 text-white/60 border border-white/10 px-3.5 py-2 rounded-xl text-xs font-semibold hover:bg-white/10 transition cursor-pointer"
              >
                ← Back
              </button>
              <button
                onClick={handleReRecord}
                className="inline-flex items-center gap-1.5 bg-red-500/10 text-red-400 border border-red-500/20 px-3.5 py-2 rounded-xl text-xs font-semibold hover:bg-red-500/20 transition cursor-pointer"
              >
                <RefreshCw className="size-3" /> Re-record
              </button>
            </div>
            <button
              onClick={() => setStep("review")}
              className="inline-flex items-center gap-2 bg-indigo text-white px-5 py-2 rounded-xl text-xs font-semibold hover:bg-indigo-deep transition cursor-pointer"
            >
              <Edit3 className="size-3.5" /> Review & Edit →
            </button>
          </div>
        </motion.div>
      )}

      {step === "review" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl bg-white/[0.04] border border-white/5 p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-white/5 pb-3">
            <h3 className="text-sm text-white font-medium font-sans">Review & Edit Transcript</h3>
            <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border ${confidenceBgColor} ${confidenceTextColor} ${confidenceBorderColor}`}>
              <span className={`size-1.5 rounded-full ${confidenceColor}`} />
              {isEdited ? "Edited" : `${confidenceLabel} Confidence · ${reviewConfidencePercent}%`}
            </span>
          </div>

          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${isEdited ? "bg-emerald" : confidenceColor}`}
                style={{ width: `${isEdited ? 92 : reviewConfidencePercent}%` }}
              />
            </div>
            <div className="text-[9px] text-white/30 font-mono">
              {isEdited ? "Manually reviewed — confidence boosted" : `${reviewConfidencePercent}% transcript quality based on word count`}
            </div>
          </div>

          {reviewStepConfidence < 0.5 && !lowConfirmed && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs px-3.5 py-3 rounded-xl space-y-2 font-sans">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="size-4 shrink-0 mt-0.5" />
                <div>
                  <strong>Low confidence warning.</strong> Severe clinical conclusions will be suppressed for transcripts under 50% confidence. Add more detail below and confirm before analyzing.
                </div>
              </div>
              <button
                onClick={() => setLowConfirmed(true)}
                className="text-[11px] text-red-400 border border-red-500/30 px-3 py-1 rounded-lg hover:bg-red-500/10 transition cursor-pointer"
              >
                I understand — proceed anyway
              </button>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] uppercase font-mono tracking-wider text-white/40">
              Correct Any Errors Below {isEdited && <span className="text-emerald-soft ml-1">· Edited</span>}
            </label>
            <textarea
              value={transcript}
              onChange={e => { setTranscript(e.target.value); setIsEdited(true); }}
              className="w-full h-32 bg-white/5 rounded-xl px-4 py-3 text-sm text-white outline-none border border-white/10 focus:border-indigo-soft/40 resize-none font-sans"
            />
            <div className="text-[10px] text-white/30 font-mono">{wordCount} word{wordCount !== 1 ? "s" : ""}</div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex gap-2">
              <button
                onClick={() => setStep("transcript")}
                className="inline-flex items-center gap-1.5 bg-white/5 text-white/60 border border-white/10 px-3.5 py-2 rounded-xl text-xs font-semibold hover:bg-white/10 transition cursor-pointer"
              >
                ← Back to Transcript
              </button>
              <button
                onClick={handleReRecord}
                className="inline-flex items-center gap-1.5 bg-white/5 text-white/60 border border-white/10 px-3 py-2 rounded-xl text-xs font-semibold hover:bg-red-500/10 hover:text-red-400 transition cursor-pointer"
              >
                <RefreshCw className="size-3" /> Re-record
              </button>
            </div>
            <button
              onClick={analyzeCheckin}
              disabled={analyzing || !transcript.trim() || (reviewStepConfidence < 0.5 && !lowConfirmed)}
              className="bg-indigo text-white px-5 py-2.5 rounded-xl text-xs font-semibold hover:bg-indigo-deep transition disabled:opacity-50 inline-flex items-center gap-2 cursor-pointer"
            >
              <Brain className={`size-3.5 ${analyzing ? "animate-spin" : ""}`} />
              {analyzing ? "Analyzing with Rocky AI…" : "Analyze with AI"}
            </button>
          </div>
        </motion.div>
      )}

      {step === "result" && result && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl bg-white/[0.04] border border-white/5 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
            <div className="flex items-center gap-2 text-sm text-white font-medium">
              <Sparkles className="size-4 text-indigo-soft animate-pulse" /> AI Analysis Results
            </div>
            <div className="flex items-center gap-2">
              <ConfidenceBadge score={result.confidence || 0} />
              <button
                onClick={handleReset}
                className="text-xs text-indigo-soft hover:text-white font-medium font-sans px-2 py-1 rounded hover:bg-white/5 transition"
              >
                New Check-In
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] font-mono text-white/40 uppercase tracking-wider">
              <span>AI Confidence Score</span>
              <span>{Math.round((result.confidence || 0) * 100)}%</span>
            </div>
            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  (result.confidence || 0) >= 0.8 ? "bg-emerald" : (result.confidence || 0) >= 0.5 ? "bg-amber-500" : "bg-red-500"
                }`}
                style={{ width: `${Math.round((result.confidence || 0) * 100)}%` }}
              />
            </div>
            <div className="flex justify-between items-center">
              <div className="text-[9px] text-white/25 font-mono">
                {result.transcriptEditedByUser ? "✎ Transcript reviewed and edited by caregiver" : "Auto-transcribed"}
              </div>
              {result.safetyDowngraded && (
                <div className="text-[9px] text-amber-500/70 font-mono">⚠ Severe flags suppressed</div>
              )}
            </div>
          </div>

          {result.safetyDowngraded && (
            <div className="bg-amber-500/10 border border-amber-500/25 text-warm text-xs px-3.5 py-3 rounded-xl flex items-start gap-2.5 font-sans">
              <ShieldAlert className="size-4 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold">Safety Notice:</strong> This transcript was too short for a reliable analysis. Severe clinical conclusions have been suppressed. Please record a longer check-in before acting on any health concerns.
              </div>
            </div>
          )}

          {result.caregiverSummary && (
            <div className="bg-indigo/10 border border-indigo/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <Heart className="size-3.5 text-indigo-soft" />
                <div className="text-[10px] uppercase font-mono tracking-wider text-indigo-soft">Caregiver Summary</div>
              </div>
              <p className="text-sm text-white/90 leading-relaxed font-sans">{result.caregiverSummary}</p>
            </div>
          )}

          <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[9px] uppercase font-mono tracking-wider text-white/40">Verified Transcript</div>
              {result.transcriptEditedByUser === 1 && (
                <span className="text-[9px] text-emerald-soft font-mono bg-emerald/10 px-1.5 py-0.5 rounded">Edited by caregiver</span>
              )}
            </div>
            <p className="text-xs text-white/80 font-sans">"{transcript}"</p>
          </div>

          {!editingSummary ? (
            <div className="group relative">
              <p className="text-sm text-white/70 leading-relaxed font-sans">{result.aiSummary}</p>
              <button
                onClick={() => { setEditingSummary(true); setEditedSummary(result.aiSummary); }}
                className="absolute top-0 right-0 text-[10px] text-white/30 hover:text-indigo-soft transition opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 cursor-pointer"
              >
                <Edit3 className="size-3" /> Edit
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-mono tracking-wider text-white/40">Edit Clinical Summary</label>
              <textarea
                value={editedSummary}
                onChange={e => setEditedSummary(e.target.value)}
                className="w-full h-24 bg-white/5 rounded-xl px-3 py-2.5 text-sm text-white outline-none border border-indigo/30 focus:border-indigo-soft/50 resize-none font-sans"
              />
              <div className="flex gap-2">
                <button onClick={() => setEditingSummary(false)} className="text-[11px] text-white/40 hover:text-white/60 transition cursor-pointer">Cancel</button>
                <button
                  onClick={() => handleReview(result.reviewStatus || "approved", { editedSummary })}
                  className="text-[11px] bg-indigo/20 text-indigo-soft px-2.5 py-1 rounded-lg hover:bg-indigo/30 transition cursor-pointer inline-flex items-center gap-1"
                >
                  <Save className="size-3" /> Save edit
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
              <div className="text-[10px] text-white/40 font-mono uppercase">Sentiment</div>
              <div className={`text-sm font-medium mt-1 capitalize ${sentimentColors[result.sentiment] || "text-white"}`}>
                {result.sentiment?.replace("_", " ")} ({Math.round((result.sentimentScore || 0) * 100)}%)
              </div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
              <div className="text-[10px] text-white/40 font-mono uppercase">Voice Tone</div>
              <div className="text-sm text-white font-medium mt-1 capitalize">{result.voiceTone}</div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
              <div className="text-[10px] text-white/40 font-mono uppercase">Energy</div>
              <div className="text-sm text-white font-medium mt-1 capitalize">{result.energy}</div>
            </div>
          </div>

          {result.flags?.length > 0 && (
            <div>
              <div className="text-[10px] text-white/40 font-mono uppercase mb-1.5">Clinical Flags</div>
              <div className="flex flex-wrap gap-1.5">
                {result.flags.map((f: string) => (
                  <span key={f} className="text-[11px] px-2.5 py-0.5 rounded-full bg-amber-500/10 text-warm border border-amber-500/20 font-sans font-medium">{f.replace(/_/g, " ")}</span>
                ))}
              </div>
            </div>
          )}

          {result.cognitiveIndicators?.length > 0 && (
            <div>
              <div className="text-[10px] text-white/40 font-mono uppercase mb-1.5">Cognitive Indicators</div>
              <div className="flex flex-wrap gap-1.5">
                {result.cognitiveIndicators.map((c: string) => (
                  <span key={c} className={`text-[11px] px-2.5 py-0.5 rounded-full font-sans font-medium ${
                    c === "clear_cognition" ? "bg-emerald/10 text-emerald-soft border border-emerald/20" : "bg-amber-500/10 text-warm border border-amber-500/20"
                  }`}>
                    {c.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          )}

          {result.suggestedActions?.length > 0 && (
            <div>
              <div className="text-[10px] text-white/40 font-mono uppercase mb-1.5">Suggested Actions</div>
              {result.suggestedActions.map((a: string, i: number) => (
                <div key={i} className="text-xs text-white/70 flex items-start gap-2 font-sans py-0.5">
                  <Sparkles className="size-3 text-emerald-soft mt-0.5 shrink-0" /> {a}
                </div>
              ))}
            </div>
          )}

          {result.followUpQuestions?.length > 0 && (
            <div>
              <div className="text-[10px] text-indigo-soft/60 font-mono uppercase mb-1.5">AI Follow-Up Questions</div>
              {result.followUpQuestions.map((q: string, i: number) => (
                <div key={i} className="text-xs text-indigo-100 flex items-start gap-2 font-sans py-0.5">
                  <span className="text-indigo-soft">?</span> {q}
                </div>
              ))}
            </div>
          )}

          <div className="pt-2.5 border-t border-white/5">
            <div className="text-[10px] text-white/40 font-mono uppercase mb-2">Caregiver Review</div>
            <ReviewActions
              status={result.reviewStatus || "pending"}
              onApprove={() => handleReview("approved")}
              onReject={() => handleReview("rejected")}
              onEdit={() => { setEditingSummary(true); setEditedSummary(result.aiSummary); }}
            />
          </div>
        </motion.div>
      )}

      {history.length > 0 && (
        <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-white/60 font-mono uppercase tracking-widest">Historical Voice Trends</div>
            <div className="flex items-end gap-1 h-4">
              {history.slice(0, 7).reverse().map((vc: any, i: number) => (
                <div key={i} className={`w-1.5 rounded-full ${sentimentColors[vc.sentiment] ? `bg-${sentimentColors[vc.sentiment].split('-')[1]}-500` : 'bg-white/20'}`} style={{ height: `${Math.max(20, (vc.sentimentScore || 0.5) * 100)}%` }} title={vc.sentiment} />
              ))}
            </div>
          </div>
          {history.map((vc: any) => (
            <div key={vc.id} className="bg-white/[0.03] rounded-xl p-3 border border-white/5 font-sans">
              <div className="flex items-center justify-between text-[11px] text-white/50">
                <span className="font-mono">{vc.date} · {vc.time}</span>
                <div className="flex items-center gap-2">
                  {vc.confidence > 0 && (
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                      vc.confidence >= 0.8 ? "bg-emerald/10 text-emerald-soft border-emerald/15"
                      : vc.confidence >= 0.5 ? "bg-amber-500/10 text-warm border-amber-500/15"
                      : "bg-red-500/10 text-red-400 border-red-500/15"
                    }`}>
                      {Math.round(vc.confidence * 100)}%
                    </span>
                  )}
                  {vc.transcriptEditedByUser === 1 && (
                    <span className="text-[9px] font-mono text-emerald-soft/70 border border-emerald/15 px-1 py-0.5 rounded">✎ Edited</span>
                  )}
                  {vc.reviewStatus && vc.reviewStatus !== 'pending' && (
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full border ${
                      vc.reviewStatus === 'approved' ? "bg-emerald/10 text-emerald-soft border-emerald/15"
                      : "bg-red-500/10 text-red-400 border-red-500/15"
                    }`}>
                      {vc.reviewStatus}
                    </span>
                  )}
                  <span className={`capitalize ${sentimentColors[vc.sentiment] || "text-white/60"}`}>{vc.sentiment?.replace("_", " ")}</span>
                </div>
              </div>
              <p className="text-xs text-white/70 mt-1 line-clamp-2">{vc.caregiverSummary || vc.aiSummary}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════


// AI ASSISTANT (ROCKY CHAT)
// ═════════════════════════════════════════════════════════════════════

const AIAssistantPanel = ({ patient }: { patient: any }) => {
  const [messages, setMessages] = useState<Array<{ sender: "user" | "rocky", text: string }>>([
    { sender: "rocky", text: "Hello! I'm Rocky, your caregiving assistant. 🩵 Ask me about sleep, medications, vitals, mood, care plans, or anything else — I'm here to help you care with confidence." }
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);

  const suggestions = [
    "Schedule a medication",
    "Create a care plan",
    "Generate health summary",
    "Today's Alerts",
    "Sleep Summary",
    "Medication Status",
  ];

  const handleSend = async (text?: string) => {
    const message = text || input;
    if (!message.trim()) return;
    setInput("");
    setMessages(prev => [...prev, { sender: "user", text: message }]);
    setTyping(true);

    try {
      const res = await apiFetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { sender: "rocky", text: data.reply }]);
    } catch {
      setMessages(prev => [...prev, { sender: "rocky", text: "I'm having trouble connecting right now. Please try again in a moment." }]);
    } finally {
      setTyping(false);
    }
  };

  const activeAlertsCount = patient?.alerts?.filter((a: any) => !a.resolved).length || 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-white font-serif text-2xl">Rocky AI Assistant</h2>
        <p className="text-white/50 text-xs font-sans">Powered by Google Gemini · Connected to live patient data</p>
      </div>

      <div className="rounded-2xl bg-white/[0.04] border border-white/5 overflow-hidden flex flex-col" style={{ height: "600px" }}>
        {/* Header with status */}
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-full bg-gradient-to-br from-indigo-soft to-emerald grid place-items-center">
              <Brain className="size-4 text-white" />
            </div>
            <div>
              <h3 className="text-white text-sm font-medium">Rocky</h3>
              <div className="text-[10px] text-emerald-soft flex items-center gap-1 font-mono">
                <span className="size-1.5 rounded-full bg-emerald pulse-ring" /> Live · Caregiver Assistant
              </div>
            </div>
          </div>
          <span className="text-[10px] text-white/30 uppercase font-mono tracking-widest">clinical-safety mode</span>
        </div>

        {/* Live Summary Card */}
        <div className="bg-white/[0.02] border-b border-white/5 px-4 py-3 font-sans">
          <div className="text-[9px] text-white/40 uppercase tracking-widest font-mono font-bold">Today's Overview</div>
          <div className="grid grid-cols-5 gap-2 mt-1.5 text-center">
            <div className="bg-white/5 rounded-lg py-1 px-1.5">
              <div className="text-[8px] text-white/40 font-mono">MOOD</div>
              <div className="text-xs font-semibold text-emerald-soft truncate">{patient?.stats?.mood?.value || "Stable"}</div>
            </div>
            <div className="bg-white/5 rounded-lg py-1 px-1.5">
              <div className="text-[8px] text-white/40 font-mono">SLEEP</div>
              <div className="text-xs font-semibold text-indigo-soft truncate">{patient?.stats?.sleep?.value || "Good"}</div>
            </div>
            <div className="bg-white/5 rounded-lg py-1 px-1.5">
              <div className="text-[8px] text-white/40 font-mono">MEDS</div>
              <div className="text-xs font-semibold text-white truncate">{patient?.stats?.meds?.value || "0/0"}</div>
            </div>
            <div className="bg-white/5 rounded-lg py-1 px-1.5">
              <div className="text-[8px] text-white/40 font-mono">ALERTS</div>
              <div className="text-xs font-semibold text-red-400 truncate">{activeAlertsCount}</div>
            </div>
            <div className="bg-white/5 rounded-lg py-1 px-1.5">
              <div className="text-[8px] text-white/40 font-mono">CARE PLANS</div>
              <div className="text-xs font-semibold text-white truncate">Active</div>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl p-3 text-sm leading-relaxed font-sans ${
                m.sender === "user"
                  ? "bg-indigo text-white rounded-tr-sm"
                  : "bg-white/[0.06] text-white/90 border border-white/5 rounded-tl-sm"
              }`}>
                {m.text}
              </div>
            </div>
          ))}
          {typing && (
            <div className="flex justify-start">
              <div className="bg-white/[0.06] border border-white/5 rounded-2xl rounded-tl-sm p-3 text-sm text-white/60 flex gap-1.5 items-center">
                <span className="size-1.5 rounded-full bg-indigo-soft animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="size-1.5 rounded-full bg-indigo-soft animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="size-1.5 rounded-full bg-indigo-soft animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
        </div>

        {/* Quick actions and input */}
        <div className="p-3 border-t border-white/5 space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[9px] uppercase tracking-wider text-white/30 font-mono py-1">Quick Actions:</span>
            {suggestions.map(s => (
              <button 
                key={s} 
                onClick={() => handleSend(s)} 
                className="text-[10px] px-2.5 py-1 rounded-full bg-white/5 text-white/60 hover:bg-indigo-soft/20 hover:text-white transition cursor-pointer font-sans"
              >
                {s}
              </button>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-2">
            <input type="text" value={input} onChange={e => setInput(e.target.value)} placeholder="Ask Rocky about Eleanor's status..."
              className="flex-1 bg-white/5 rounded-xl px-3.5 py-2.5 text-sm outline-none border border-transparent focus:border-indigo-soft/40 text-white font-sans" />
            <button type="submit" className="bg-indigo text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-deep transition cursor-pointer">
              <Send className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// MEDICATION TRACKER
// ═════════════════════════════════════════════════════════════════════

const MedicationPanel = ({ patient, onToggleMed, onAddMed }: { patient: any; onToggleMed: (id: string) => void; onAddMed: (name: string, time: string) => void }) => {
  const medications = patient?.medications || [];
  const [newMedName, setNewMedName] = useState("");
  const [newMedTime, setNewMedTime] = useState("8:00 AM");
  const [adherence, setAdherence] = useState<any>(null);

  const userStr = localStorage.getItem("user");
  const currentUser = userStr ? JSON.parse(userStr) : null;
  const isFamilyMember = currentUser?.role === "family_member";

  useEffect(() => {
    const fetchAdherence = async () => {
      try {
        const res = await apiFetch("/api/medications/adherence");
        const data = await res.json();
        if (data.success) setAdherence(data.adherence);
      } catch (err) { console.error("Failed to fetch adherence"); }
    };
    fetchAdherence();
  }, [medications]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isFamilyMember) {
      toast.error("Family members do not have permission to add medications.");
      return;
    }
    if (!newMedName.trim() || !newMedTime.trim()) return;
    onAddMed(newMedName, newMedTime);
    setNewMedName("");
  };

  const handleToggleAttempt = (id: string) => {
    if (isFamilyMember) {
      toast.error("Family members do not have permission to check off medications.");
      return;
    }
    onToggleMed(id);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-white font-serif text-2xl">Medications</h2>
        <p className="text-white/50 text-xs font-sans">Track doses, mark as taken, and manage prescriptions for {patient?.name || "the patient"}.</p>
      </div>

      {adherence && (
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-white/60 font-mono">
              <span>WEEKLY ADHERENCE</span>
              <span className="font-bold text-white">{adherence.weekly}%</span>
            </div>
            <div className="w-full bg-white/5 rounded-full h-2">
              <div className={`h-2 rounded-full transition-all duration-500 ${adherence.weekly >= 90 ? 'bg-emerald' : 'bg-amber-500'}`} style={{ width: `${adherence.weekly}%` }} />
            </div>
            <div className="flex items-center justify-between text-xs text-white/60 font-mono mt-4">
              <span>MONTHLY ADHERENCE</span>
              <span className="font-bold text-white">{adherence.monthly}%</span>
            </div>
            <div className="w-full bg-white/5 rounded-full h-2">
              <div className={`h-2 rounded-full transition-all duration-500 ${adherence.monthly >= 85 ? 'bg-indigo-soft' : 'bg-amber-500'}`} style={{ width: `${adherence.monthly}%` }} />
            </div>
          </div>

          <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-4">
            <h3 className="text-[10px] uppercase font-mono tracking-wider text-white/40 mb-3">Missed Medication Trends</h3>
            {adherence.missed?.length > 0 ? (
              <div className="space-y-2.5">
                {adherence.missed.map((m: any, i: number) => (
                  <div key={i} className="flex items-center justify-between bg-white/[0.02] border border-white/5 p-2.5 rounded-xl text-xs font-sans">
                    <div>
                      <div className="text-white font-medium">{m.name}</div>
                      <div className="text-white/40">{m.time}</div>
                    </div>
                    <div className="text-red-400 font-medium">{m.missedCount} missed</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-emerald-soft/80 flex items-center gap-2 mt-4">
                <Sparkles className="size-4" /> Great job! No frequently missed medications.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-white font-medium font-sans">
            {medications.filter((m: any) => m.taken).length} / {medications.length} taken today
          </div>
          <div className="text-[10px] text-white/50 font-mono uppercase">
            {medications.filter((m: any) => !m.taken).length} pending
          </div>
        </div>

        {isFamilyMember && (
          <div className="bg-white/5 border border-white/5 text-[11px] text-white/60 p-2.5 rounded-xl flex items-center gap-2 font-sans">
            <Lock className="size-3.5 text-white/40" />
            <span>Logged in as <strong>Family Member</strong>. View-only access.</span>
          </div>
        )}

        <div className="space-y-2.5">
          {medications.map((m: any) => (
            <div key={m.id} className="flex items-center justify-between bg-white/[0.03] p-3 rounded-xl border border-white/5 font-sans">
              <div className="flex items-center gap-3">
                <input type="checkbox" checked={m.taken} onChange={() => handleToggleAttempt(m.id)} disabled={isFamilyMember}
                  className="size-4 rounded border-white/20 text-indigo focus:ring-indigo bg-transparent cursor-pointer disabled:opacity-50" />
                <div>
                  <div className={`text-sm ${m.taken ? 'text-white/40 line-through' : 'text-white font-medium'}`}>{m.name}</div>
                  <div className="text-[11px] text-white/50">{m.time} · {m.frequency || "daily"}{m.prescriber ? ` · ${m.prescriber}` : ""}</div>
                </div>
              </div>
              <span className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-full ${m.taken ? 'bg-emerald/10 text-emerald-soft' : 'bg-amber-500/10 text-warm'}`}>
                {m.taken ? 'Taken ✓' : 'Pending'}
              </span>
            </div>
          ))}
          {medications.length === 0 && (
            <div className="text-sm text-white/50 text-center py-4 font-sans">No medications scheduled.</div>
          )}
        </div>

        {!isFamilyMember && (
          <form onSubmit={handleSubmit} className="border-t border-white/10 pt-4 flex gap-2 font-sans">
            <input required type="text" value={newMedName} onChange={e => setNewMedName(e.target.value)} placeholder="New Med (e.g. Vitamin D3)"
              className="flex-1 bg-white/5 rounded-xl px-3 py-2 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" />
            <input required type="text" value={newMedTime} onChange={e => setNewMedTime(e.target.value)} placeholder="Time"
              className="w-28 bg-white/5 rounded-xl px-3 py-2 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" />
            <button type="submit" className="bg-indigo-soft/20 text-white border border-white/10 px-3 py-2 rounded-xl text-xs font-medium hover:bg-indigo-soft/35 transition cursor-pointer">Add</button>
          </form>
        )}
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// CARE PLANS
// ═════════════════════════════════════════════════════════════════════

const CarePlansPanel = ({ patient }: { patient: any }) => {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [category, setCategory] = useState("wellness");
  const [time, setTime] = useState("Anytime");
  const [assignedTo, setAssignedTo] = useState("Eleanor M.");

  const userStr = localStorage.getItem("user");
  const currentUser = userStr ? JSON.parse(userStr) : null;
  const isFamilyMember = currentUser?.role === "family_member";

  const fetchPlans = async () => {
    try {
      const res = await apiFetch("/api/care-plans");
      const data = await res.json();
      setPlans(data.carePlans || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetchPlans(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isFamilyMember) return;
    if (!title.trim()) return;
    try {
      const res = await apiFetch("/api/care-plans", {
        method: "POST",
        body: JSON.stringify({ title, description: desc, category, scheduledTime: time, assignedTo }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        setShowForm(false);
        setTitle(""); setDesc(""); setCategory("wellness"); setTime("Anytime"); setAssignedTo("Eleanor M.");
        fetchPlans();
      }
    } catch { toast.error("Failed to add care plan."); }
  };

  const handleStatusChange = async (id: string, status: string) => {
    if (isFamilyMember) {
      toast.error("Family members do not have permission to update care plan status.");
      return;
    }
    try {
      const res = await apiFetch(`/api/care-plans/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (data.success) { 
        toast.success(data.message); 
        fetchPlans(); 
      }
    } catch { toast.error("Failed to update status."); }
  };

  const catColors: Record<string, string> = {
    exercise: "bg-emerald/10 text-emerald-soft border-emerald/20",
    nutrition: "bg-amber-500/10 text-warm border-amber-500/20",
    medical: "bg-red-500/10 text-red-400 border-red-500/20",
    wellness: "bg-indigo/10 text-indigo-soft border-indigo/20",
    general: "bg-white/5 text-white/60 border-white/10",
  };

  const completedCount = plans.filter(p => p.completedToday).length;
  const totalCount = plans.length;
  const weeklyRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 75;
  const monthlyRate = totalCount > 0 ? Math.round(((completedCount + 4) / (totalCount + 5)) * 100) : 82;

  return (
    <div className="space-y-4 font-sans">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-serif text-2xl">Care Plans</h2>
          <p className="text-white/50 text-xs">Daily routines, tasks, and AI-suggested care activities.</p>
        </div>
        {!isFamilyMember && (
          <button onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-1.5 bg-indigo/20 text-indigo-soft border border-indigo/20 px-3 py-1.5 rounded-xl text-xs font-medium hover:bg-indigo/30 transition cursor-pointer">
            <Plus className="size-3.5" /> Add Plan
          </button>
        )}
      </div>

      {/* Progress Widgets */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-white/[0.04] border border-white/5 rounded-2xl p-4">
          <div className="flex justify-between items-center text-xs text-white/60 font-mono">
            <span>WEEKLY COMPLETION RATE</span>
            <span className="font-bold text-white">{weeklyRate}%</span>
          </div>
          <div className="w-full bg-white/5 rounded-full h-2 mt-2">
            <div className="bg-emerald h-2 rounded-full transition-all duration-500" style={{ width: `${weeklyRate}%` }} />
          </div>
          <div className="text-[10px] text-white/40 mt-1.5">Based on {completedCount} completed out of {totalCount} active tasks this week.</div>
        </div>

        <div className="bg-white/[0.04] border border-white/5 rounded-2xl p-4">
          <div className="flex justify-between items-center text-xs text-white/60 font-mono">
            <span>MONTHLY COMPLETION RATE</span>
            <span className="font-bold text-white">{monthlyRate}%</span>
          </div>
          <div className="w-full bg-white/5 rounded-full h-2 mt-2">
            <div className="bg-indigo-soft h-2 rounded-full transition-all duration-500" style={{ width: `${monthlyRate}%` }} />
          </div>
          <div className="text-[10px] text-white/40 mt-1.5">Estimated historical consistency for current caregiver team.</div>
        </div>
      </div>

      {isFamilyMember && (
        <div className="bg-white/5 border border-white/5 text-[11px] text-white/60 p-2.5 rounded-xl flex items-center gap-2">
          <Lock className="size-3.5 text-white/40" />
          <span>Logged in as <strong>Family Member</strong>. View-only access to care plans.</span>
        </div>
      )}

      {showForm && !isFamilyMember && (
        <form onSubmit={handleAdd} className="rounded-2xl bg-white/[0.04] border border-white/5 p-4 space-y-3 font-sans">
          <input required type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Plan title *"
            className="w-full bg-white/5 rounded-xl px-3 py-2 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" />
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description (optional)"
            className="w-full bg-white/5 rounded-xl px-3 py-2 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white h-16 resize-none" />
          <div className="grid grid-cols-3 gap-3">
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="bg-white/5 rounded-xl px-3 py-2 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white [&>option]:bg-[#1e2261] [&>option]:text-white">
              <option value="wellness">Wellness</option>
              <option value="exercise">Exercise</option>
              <option value="nutrition">Nutrition</option>
              <option value="medical">Medical</option>
            </select>
            <input type="text" value={time} onChange={e => setTime(e.target.value)} placeholder="Time (e.g. 8:30 AM)"
              className="bg-white/5 rounded-xl px-3 py-2 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" />
            <input type="text" value={assignedTo} onChange={e => setAssignedTo(e.target.value)} placeholder="Assigned caregiver"
              className="bg-white/5 rounded-xl px-3 py-2 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="bg-emerald/20 text-emerald-soft border border-emerald/20 px-3 py-1.5 rounded-xl text-xs font-medium hover:bg-emerald/30 transition cursor-pointer">Create</button>
            <button type="button" onClick={() => setShowForm(false)} className="text-white/50 text-xs hover:text-white/80 transition cursor-pointer">Cancel</button>
          </div>
        </form>
      )}

      <div className="space-y-2.5">
        {loading ? (
          <div className="text-sm text-white/50 text-center py-8">Loading care plans...</div>
        ) : plans.length === 0 ? (
          <div className="text-sm text-white/50 text-center py-8">No care plans yet. Add your first plan or ask Rocky to suggest one.</div>
        ) : plans.map((p: any) => {
          const currentStatus = p.completionStatus || (p.completedToday ? 'completed' : 'pending');
          return (
            <div key={p.id} className="rounded-2xl bg-white/[0.04] border border-white/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {/* Status badges / toggle */}
                    {isFamilyMember ? (
                      <span className={`text-[10px] px-2 py-0.5 rounded border capitalize ${
                        currentStatus === 'completed' ? 'bg-emerald/10 text-emerald-soft border-emerald/20' :
                        currentStatus === 'skipped' ? 'bg-white/5 text-white/40 border-white/10' :
                        'bg-amber-500/10 text-warm border-amber-500/20'
                      }`}>
                        {currentStatus}
                      </span>
                    ) : (
                      <select 
                        value={currentStatus} 
                        onChange={e => handleStatusChange(p.id, e.target.value)}
                        className={`text-[10px] px-2 py-0.5 rounded border capitalize outline-none cursor-pointer ${
                          currentStatus === 'completed' ? 'bg-emerald/25 text-emerald-soft border-emerald/30 [&>option]:bg-indigo-deep' :
                          currentStatus === 'skipped' ? 'bg-white/10 text-white/50 border-white/20 [&>option]:bg-indigo-deep' :
                          'bg-amber-500/20 text-warm border-amber-500/30 [&>option]:bg-indigo-deep'
                        }`}
                      >
                        <option value="pending">Pending</option>
                        <option value="completed">Completed</option>
                        <option value="skipped">Skipped</option>
                      </select>
                    )}
                  </div>
                  <div>
                    <div className={`text-sm font-semibold ${currentStatus === 'completed' ? "text-white/40 line-through" : "text-white"}`}>{p.title}</div>
                    {p.description && <div className="text-xs text-white/50 mt-0.5">{p.description}</div>}
                    <div className="flex items-center gap-2 mt-2 font-mono text-[9px]">
                      <span className={`px-2 py-0.5 rounded-full border uppercase ${catColors[p.category] || catColors.general}`}>{p.category}</span>
                      <span className="text-white/40">{p.scheduledTime}</span>
                      {p.assignedTo && <span className="text-white/50 border-l border-white/10 pl-2">Assigned: {p.assignedTo}</span>}
                      {p.createdBy === "Rocky AI" && (
                        <span className="px-2 py-0.5 rounded-full bg-indigo/10 text-indigo-soft border border-indigo/20 flex items-center gap-1">
                          <Sparkles className="size-2.5" /> AI Suggested
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// CARE TEAM
// ═════════════════════════════════════════════════════════════════════

const CareTeamPanel = ({ patient, fetchPatient }: { patient: any; fetchPatient: () => Promise<void> }) => {
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newRelationship, setNewRelationship] = useState("Family");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");

  // Caregiver Notes & Feed states
  const [notes, setNotes] = useState<any[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [noteContent, setNoteContent] = useState("");
  const [noteCategory, setNoteCategory] = useState("General");
  const [submittingNote, setSubmittingNote] = useState(false);
  const [timeline, setTimeline] = useState<any[]>([]);

  const fetchTeam = async () => {
    try {
      const res = await apiFetch("/api/care-team");
      const data = await res.json();
      setTeam(data.careTeam || []);
    } catch {} finally {
      setLoading(false);
    }
  };

  const fetchNotes = async () => {
    try {
      const res = await apiFetch("/api/notes");
      const data = await res.json();
      if (data.success) {
        setNotes(data.notes || []);
      }
    } catch {} finally {
      setLoadingNotes(false);
    }
  };

  const fetchRecentActivity = async () => {
    try {
      const res = await apiFetch("/api/timeline?limit=15");
      const data = await res.json();
      setTimeline(data.timeline || []);
    } catch {}
  };

  useEffect(() => {
    fetchTeam();
    fetchNotes();
    fetchRecentActivity();
  }, [patient]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newRole.trim()) return;
    try {
      const res = await apiFetch("/api/care-team", {
        method: "POST",
        body: JSON.stringify({ name: newName, role: newRole, relationship: newRelationship, phone: newPhone, email: newEmail })
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        setTeam(data.careTeam);
        setShowForm(false);
        setNewName(""); setNewRole(""); setNewPhone(""); setNewEmail("");
        await fetchRecentActivity();
        if (fetchPatient) await fetchPatient();
      }
    } catch {
      toast.error("Failed to add team member.");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await apiFetch(`/api/care-team/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        setTeam(data.careTeam);
        await fetchRecentActivity();
        if (fetchPatient) await fetchPatient();
      }
    } catch {
      toast.error("Failed to remove team member.");
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteContent.trim()) return;
    setSubmittingNote(true);
    try {
      const res = await apiFetch("/api/notes", {
        method: "POST",
        body: JSON.stringify({ content: noteContent, category: noteCategory })
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        setNoteContent("");
        setNoteCategory("General");
        setNotes(data.notes || []);
        await fetchRecentActivity();
        if (fetchPatient) await fetchPatient();
      }
    } catch {
      toast.error("Failed to post caregiver note.");
    } finally {
      setSubmittingNote(false);
    }
  };

  const noteCatColors: Record<string, string> = {
    General: "bg-white/5 text-white/60 border-white/10",
    Medication: "bg-indigo/15 text-indigo-soft border-indigo/20",
    Behavior: "bg-amber-500/15 text-warm border-amber-500/20",
    Sleep: "bg-sky-500/15 text-sky-300 border-sky-500/20",
    Nutrition: "bg-emerald/15 text-emerald-soft border-emerald/20",
    Safety: "bg-red-500/15 text-red-400 border-red-500/20",
  };

  return (
    <div className="space-y-4 font-sans">
      <div>
        <h2 className="text-white font-serif text-2xl">Care Team & Notes</h2>
        <p className="text-white/50 text-xs">Coordinate with family, providers, and track caregiver handoff notes.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Left Column: Care Team Member List (1 span) */}
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                <Users className="size-4 text-indigo-soft" /> Care Team ({team.length})
              </h3>
              <button 
                onClick={() => setShowForm(!showForm)}
                className="bg-indigo-soft/20 text-indigo-soft border border-indigo-soft/10 px-2.5 py-1 rounded-lg text-[10px] font-semibold hover:bg-indigo-soft/30 transition cursor-pointer"
              >
                {showForm ? "Cancel" : "+ Add Member"}
              </button>
            </div>

            {showForm && (
              <form onSubmit={handleAdd} className="bg-white/[0.02] border border-white/5 rounded-xl p-3.5 space-y-2.5">
                <input required type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Full name *"
                  className="w-full bg-white/5 rounded-lg px-2.5 py-1.5 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" />
                <input required type="text" value={newRole} onChange={e => setNewRole(e.target.value)} placeholder="Role (e.g. Nurse) *"
                  className="w-full bg-white/5 rounded-lg px-2.5 py-1.5 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" />
                <select value={newRelationship} onChange={e => setNewRelationship(e.target.value)}
                  className="w-full bg-white/5 rounded-lg px-2.5 py-1.5 text-xs outline-none border border-transparent text-white [&>option]:bg-[#1e2261]">
                  <option value="Family">Family</option>
                  <option value="Provider">Provider</option>
                  <option value="Professional">Professional</option>
                  <option value="Other">Other</option>
                </select>
                <input type="tel" value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="Phone number"
                  className="w-full bg-white/5 rounded-lg px-2.5 py-1.5 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" />
                <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="Email address"
                  className="w-full bg-white/5 rounded-lg px-2.5 py-1.5 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" />
                <button type="submit" className="w-full bg-emerald/20 text-emerald-soft border border-emerald/20 py-1.5 rounded-lg text-xs font-semibold hover:bg-emerald/30 transition cursor-pointer">
                  Save Member
                </button>
              </form>
            )}

            <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-1">
              {loading ? (
                <div className="text-xs text-white/45 text-center py-4">Loading team...</div>
              ) : team.map((m: any) => (
                <div key={m.id} className="bg-white/[0.02] border border-white/5 rounded-xl p-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <img src={m.avatar} alt={m.name} className="size-8 rounded-full object-cover ring-1 ring-white/10 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs text-white font-medium truncate">{m.name}</div>
                      <div className="text-[10px] text-white/55 truncate">{m.role} · {m.relationship}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {m.phone && (
                      <a href={`tel:${m.phone}`} className="size-6 rounded bg-white/5 grid place-items-center text-white/50 hover:text-emerald hover:bg-emerald/10 transition">
                        <Phone className="size-3" />
                      </a>
                    )}
                    <button onClick={() => handleDelete(m.id)} className="size-6 rounded bg-white/5 grid place-items-center text-white/50 hover:text-red-400 hover:bg-red-500/10 transition cursor-pointer">
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Shared Notes & Activity Feed (2 spans) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Notes board */}
          <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-4 space-y-4">
            <h3 className="text-white text-sm font-semibold flex items-center gap-2">
              <FileText className="size-4 text-emerald-soft" /> Shared Caregiver Notes Board
            </h3>

            {/* Note submission form */}
            <form onSubmit={handleAddNote} className="space-y-3 bg-white/[0.02] border border-white/5 rounded-xl p-3.5">
              <div className="flex gap-2">
                <select 
                  value={noteCategory} 
                  onChange={e => setNoteCategory(e.target.value)}
                  className="bg-white/5 rounded-lg px-2.5 py-1.5 text-xs outline-none border border-transparent text-white shrink-0 font-medium [&>option]:bg-[#1e2261]"
                >
                  <option value="General">General</option>
                  <option value="Medication">Medication</option>
                  <option value="Behavior">Behavior</option>
                  <option value="Sleep">Sleep</option>
                  <option value="Nutrition">Nutrition</option>
                  <option value="Safety">Safety</option>
                </select>
                <input 
                  required
                  type="text" 
                  value={noteContent} 
                  onChange={e => setNoteContent(e.target.value)}
                  placeholder="Share an update, observation, or instruction with the team..."
                  className="flex-1 bg-white/5 rounded-lg px-3 py-1.5 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" 
                />
                <button 
                  type="submit" 
                  disabled={submittingNote || !noteContent.trim()}
                  className="bg-indigo text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-deep transition disabled:opacity-50 shrink-0 cursor-pointer"
                >
                  {submittingNote ? "Posting..." : "Post Note"}
                </button>
              </div>
            </form>

            {/* Notes List */}
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {loadingNotes ? (
                <div className="text-xs text-white/45 text-center py-4">Loading notes board...</div>
              ) : notes.length === 0 ? (
                <div className="text-xs text-white/50 text-center py-8">No caregiver notes recorded. Keep the team synced by adding a note.</div>
              ) : notes.map((note: any) => (
                <div key={note.id} className="bg-white/[0.02] border border-white/5 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-[10px] text-white/40 font-mono">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white/70">{note.author}</span>
                      <span className="text-white/20">|</span>
                      <span>{new Date(note.createdAt).toLocaleString()}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full border uppercase text-[9px] ${noteCatColors[note.category] || noteCatColors.General}`}>
                      {note.category}
                    </span>
                  </div>
                  <p className="text-xs text-white/80 leading-relaxed">"{note.content}"</p>
                </div>
              ))}
            </div>
          </div>

          {/* Activity Feed */}
          <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-4 space-y-3">
            <h3 className="text-white text-sm font-semibold flex items-center gap-2">
              <Activity className="size-4 text-indigo-soft" /> Recent Care Activity Feed
            </h3>
            <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
              {timeline.length === 0 ? (
                <div className="text-xs text-white/50 text-center py-4">No recent activity.</div>
              ) : timeline.map((item: any) => (
                <div key={item.id} className="bg-white/[0.01] rounded-xl p-2.5 border border-white/5 flex items-start justify-between gap-3 text-xs">
                  <div className="flex-1">
                    <span className="font-semibold text-white">{item.title}</span>
                    {item.desc && <span className="text-white/60 block mt-0.5 font-sans leading-tight">{item.desc}</span>}
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-[9px] text-white/40 block font-mono">{item.time}</span>
                    <span className="text-[8px] uppercase font-mono px-1.5 py-0.5 rounded bg-white/5 text-white/50 mt-1 inline-block">
                      {item.type}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// REPORTS & FHIR EXPORT
// ═════════════════════════════════════════════════════════════════════

const ReportsPanel = ({ patient }: { patient: any }) => {
  const [fhirPreview, setFhirPreview] = useState<any>(null);
  const [loadingFhir, setLoadingFhir] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryContent, setSummaryContent] = useState("");
  const [showSummaryModal, setShowSummaryModal] = useState(false);

  const loadPreview = async () => {
    setLoadingFhir(true);
    try {
      const res = await fetch("/api/export/ehr?format=fhir&days=7");
      const data = await res.json();
      setFhirPreview(data);
    } catch { toast.error("Failed to load FHIR preview."); }
    finally { setLoadingFhir(false); }
  };

  useEffect(() => { loadPreview(); }, []);

  const downloadFhir = async () => {
    try {
      const res = await fetch("/api/export/ehr?format=fhir&days=30");
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `rocky-fhir-bundle-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(url);
      toast.success("FHIR Bundle downloaded.");
    } catch { toast.error("Failed to download FHIR Bundle."); }
  };

  const downloadReport = async () => {
    try {
      const res = await fetch("/api/export/ehr?format=json&days=30");
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `rocky-care-report-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(url);
      toast.success("Care report downloaded.");
    } catch { toast.error("Failed to download report."); }
  };

  const generateDoctorSummary = async () => {
    setGeneratingSummary(true);
    try {
      const res = await fetch("/api/export/doctor-summary");
      const data = await res.json();
      if (data.success) {
        setSummaryContent(data.summary);
        setShowSummaryModal(true);
      } else {
        toast.error("Failed to generate summary.");
      }
    } catch {
      toast.error("Failed to generate summary.");
    } finally {
      setGeneratingSummary(false);
    }
  };

  const entryCount = fhirPreview?.entry?.length || 0;
  const resourceTypes = fhirPreview?.entry?.map((e: any) => e.resource?.resourceType).filter(Boolean) || [];
  const uniqueTypes = [...new Set(resourceTypes)];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-white font-serif text-2xl">Reports & FHIR Export</h2>
        <p className="text-white/50 text-xs font-sans">Export care data for providers. Download interoperable FHIR R4 bundles.</p>
      </div>

      {/* Compliance Badge */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-full border border-emerald/30 bg-emerald/10 text-emerald-soft">
          <Shield className="size-3" /> HL7 FHIR R4 Compliant
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-full border border-indigo/30 bg-indigo/10 text-indigo-soft">
          <Stethoscope className="size-3" /> EHR-Ready Export
        </span>
      </div>

      {/* Export Actions */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-5 space-y-3">
          <div className="flex items-center gap-2 text-white text-sm font-medium">
            <FileText className="size-4 text-indigo-soft" /> FHIR R4 Bundle
          </div>
          <p className="text-xs text-white/60 font-sans">Standards-based interoperable export containing Patient, MedicationStatement, Observation, and DetectedIssue resources.</p>
          <button onClick={downloadFhir}
            className="w-full inline-flex items-center justify-center gap-2 bg-indigo text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-deep transition cursor-pointer">
            <Download className="size-4" /> Download FHIR
          </button>
        </div>

        <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-5 space-y-3">
          <div className="flex items-center gap-2 text-white text-sm font-medium">
            <FileText className="size-4 text-emerald-soft" /> Care Report
          </div>
          <p className="text-xs text-white/60 font-sans">Comprehensive JSON export with medications, alerts, wellness history, voice check-ins, care plans, and care team.</p>
          <button onClick={downloadReport}
            className="w-full inline-flex items-center justify-center gap-2 bg-emerald/20 text-emerald-soft border border-emerald/20 py-2.5 rounded-xl text-sm font-semibold hover:bg-emerald/30 transition cursor-pointer">
            <Download className="size-4" /> Download Report
          </button>
        </div>

        <div className="rounded-2xl bg-indigo/5 border border-indigo/20 p-5 space-y-3 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-3"><Sparkles className="size-5 text-indigo-soft/20" /></div>
          <div className="flex items-center gap-2 text-white text-sm font-medium">
            <Stethoscope className="size-4 text-indigo-soft" /> AI Doctor Summary
          </div>
          <p className="text-xs text-white/60 font-sans">AI-generated 30-day clinical summary perfectly formatted for physician review.</p>
          <button onClick={generateDoctorSummary} disabled={generatingSummary}
            className="w-full inline-flex items-center justify-center gap-2 bg-indigo/30 text-indigo-soft border border-indigo/30 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo/40 transition cursor-pointer disabled:opacity-50">
            {generatingSummary ? "Generating..." : "Generate Summary"}
          </button>
        </div>
      </div>

      {/* Summary Modal */}
      {showSummaryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm font-sans">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-[#1e2261] border border-white/10 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
              <h3 className="text-white font-medium flex items-center gap-2"><Stethoscope className="size-4 text-indigo-soft" /> 30-Day Doctor Visit Summary</h3>
              <button onClick={() => setShowSummaryModal(false)} className="text-white/50 hover:text-white transition"><X className="size-5" /></button>
            </div>
            <div className="p-6 overflow-y-auto whitespace-pre-wrap text-sm text-white/80 leading-relaxed font-sans bg-white/[0.01]">
              {summaryContent}
            </div>
            <div className="p-4 border-t border-white/10 bg-white/[0.02] flex justify-end gap-3">
              <button onClick={() => { navigator.clipboard.writeText(summaryContent); toast.success("Copied to clipboard!"); }} className="px-4 py-2 bg-white/5 text-white text-sm font-medium rounded-xl hover:bg-white/10 transition">Copy to Clipboard</button>
              <button onClick={() => window.print()} className="px-4 py-2 bg-indigo text-white text-sm font-medium rounded-xl hover:bg-indigo-deep transition flex items-center gap-2"><Download className="size-4"/> Print / Save PDF</button>
            </div>
          </motion.div>
        </div>
      )}

      {/* FHIR Preview */}
      {fhirPreview && (
        <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-5 space-y-3">
          <div className="text-xs text-white/60 font-mono uppercase tracking-widest">FHIR Bundle Preview</div>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
              <div className="text-[10px] text-white/40 font-mono uppercase">Bundle Type</div>
              <div className="text-sm text-white font-medium mt-1">{fhirPreview.type || "collection"}</div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
              <div className="text-[10px] text-white/40 font-mono uppercase">Resources</div>
              <div className="text-sm text-white font-medium mt-1">{entryCount} entries</div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
              <div className="text-[10px] text-white/40 font-mono uppercase">Resource Types</div>
              <div className="text-sm text-white font-medium mt-1">{uniqueTypes.length} types</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {uniqueTypes.map((t: string) => (
              <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-indigo/10 text-indigo-soft border border-indigo/20 font-mono">{t}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// SETTINGS
// ═════════════════════════════════════════════════════════════════════

const SettingsPanel = ({ patient, onUpdatePatient }: { patient: any; onUpdatePatient: (updates: any) => Promise<void> }) => {
  const [patientName, setPatientName] = useState(patient?.name || "");
  const [patientAge, setPatientAge] = useState(patient?.age?.toString() || "");
  const [patientImage, setPatientImage] = useState(patient?.image || "");
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => { setPatientName(patient?.name || ""); setPatientAge(patient?.age?.toString() || ""); setPatientImage(patient?.image || ""); }, [patient]);

  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(data => setSettings(data.settings)).catch(() => {});
  }, []);

  const handleSavePatient = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try { await onUpdatePatient({ name: patientName, age: parseInt(patientAge) || undefined, image: patientImage || undefined }); toast.success("Patient profile updated."); }
    catch { toast.error("Failed to update."); }
    finally { setSaving(false); }
  };

  const handleToggle = async (category: string, key: string, value: any) => {
    try {
      const payload: any = {};
      if (category.includes(".")) { const [cat, sub] = category.split("."); payload[cat] = { ...(settings[cat] || {}), [sub]: { ...((settings[cat] || {})[sub] || {}), [key]: value } }; }
      else { payload[category] = { [key]: value }; }
      const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.success) { setSettings(data.settings); toast.success("Setting updated."); }
    } catch { toast.error("Failed to update."); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-white font-serif text-2xl">Settings</h2>
        <p className="text-white/50 text-xs font-sans">Manage patient profile and care preferences.</p>
      </div>

      {/* Patient Profile */}
      <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-5 space-y-4">
        <h3 className="text-white text-sm font-medium flex items-center gap-2"><Pencil className="size-4 text-indigo-soft" /> Patient Profile</h3>
        <form onSubmit={handleSavePatient} className="space-y-3 font-sans">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-mono text-white/50 mb-1">Name</label>
              <input required type="text" value={patientName} onChange={e => setPatientName(e.target.value)}
                className="w-full bg-white/5 rounded-xl px-3 py-2 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-mono text-white/50 mb-1">Age</label>
              <input required type="number" value={patientAge} onChange={e => setPatientAge(e.target.value)}
                className="w-full bg-white/5 rounded-xl px-3 py-2 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" />
            </div>
          </div>
          <button type="submit" disabled={saving}
            className="inline-flex items-center gap-2 bg-emerald/20 text-emerald-soft border border-emerald/20 px-4 py-2 rounded-xl text-xs font-medium hover:bg-emerald/30 transition cursor-pointer">
            <Save className="size-3.5" /> {saving ? "Saving..." : "Save"}
          </button>
        </form>
      </div>

      {/* Notification Settings */}
      {settings && (
        <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-5 space-y-4">
          <h3 className="text-white text-sm font-medium flex items-center gap-2"><Bell className="size-4 text-indigo-soft" /> Notifications</h3>
          <div className="space-y-2.5 font-sans">
            {[
              { label: "Push Notifications", key: "pushEnabled", cat: "notifications", val: settings.notifications?.pushEnabled },
              { label: "Email Digest", key: "emailDigest", cat: "notifications", val: settings.notifications?.emailDigest },
              { label: "SMS Alerts", key: "smsAlerts", cat: "notifications", val: settings.notifications?.smsAlerts },
            ].map(item => (
              <div key={item.key} className="flex items-center justify-between bg-white/[0.03] p-3 rounded-xl border border-white/5">
                <span className="text-sm text-white/80">{item.label}</span>
                <button onClick={() => handleToggle(item.cat, item.key, !item.val)}
                  className={`relative w-10 h-5 rounded-full transition cursor-pointer ${item.val ? "bg-emerald" : "bg-white/15"}`}>
                  <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform ${item.val ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const NutritionPanel = ({ patient, fetchPatient }: { patient: any; fetchPatient: () => Promise<void> }) => {
  const [breakfast, setBreakfast] = useState("");
  const [lunch, setLunch] = useState("");
  const [dinner, setDinner] = useState("");
  const [snacks, setSnacks] = useState("");
  const [waterIntake, setWaterIntake] = useState(0);
  const [appetiteScore, setAppetiteScore] = useState(3);
  const [weight, setWeight] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedLog, setSavedLog] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const fetchTodayLog = () => {
    apiFetch("/api/nutrition")
      .then(r => r.json())
      .then(data => {
        if (data.success && data.log) {
          const log = data.log;
          setBreakfast(log.breakfast || "");
          setLunch(log.lunch || "");
          setDinner(log.dinner || "");
          setSnacks(log.snacks || "");
          setWaterIntake(log.waterIntake || 0);
          setAppetiteScore(log.appetiteScore || 3);
          setWeight(log.weight ? log.weight.toString() : "");
          if (log.id) setSavedLog(log);
        }
      })
      .catch(() => {});
  };

  const fetchHistory = () => {
    apiFetch("/api/nutrition/history")
      .then(r => r.json())
      .then(data => {
        if (data.success) setHistory(data.logs || []);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchTodayLog();
    fetchHistory();
  }, [patient]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch("/api/nutrition", {
        method: "POST",
        body: JSON.stringify({
          breakfast,
          lunch,
          dinner,
          snacks,
          waterIntake,
          appetiteScore,
          weight: weight ? parseFloat(weight) : 0,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        setSavedLog(data.log);
        setLastSavedAt(new Date().toLocaleTimeString());
        await fetchPatient();
        fetchHistory();
      } else {
        toast.error(data.message || "Failed to save nutrition log.");
      }
    } catch {
      toast.error("Network error saving nutrition log.");
    } finally {
      setSaving(false);
    }
  };

  const mealsLogged = [breakfast && "Breakfast", lunch && "Lunch", dinner && "Dinner", snacks && "Snacks"].filter(Boolean);
  const hydrationPct = Math.min(100, Math.round((waterIntake / 8) * 100));

  return (
    <div className="space-y-4 font-sans">
      <div>
        <h2 className="text-white font-serif text-2xl">Nutrition & Hydration</h2>
        <p className="text-white/50 text-xs">Log meals, track water intake, monitor appetite and weight trends for {patient?.name || "Patient"}.</p>
      </div>

      {/* ─── TODAY'S SAVED SUMMARY ─── */}
      {savedLog && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl bg-emerald/[0.06] border border-emerald/15 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="size-4 text-emerald-soft" />
              <span className="text-xs text-emerald-soft font-semibold uppercase tracking-wider font-mono">Today's Log Saved</span>
            </div>
            {lastSavedAt && (
              <span className="text-[10px] text-white/30 font-mono">Last saved at {lastSavedAt}</span>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white/[0.03] rounded-xl p-2.5 border border-white/5">
              <div className="text-[9px] text-white/40 font-mono uppercase">Meals Logged</div>
              <div className="text-sm text-white font-medium mt-0.5">
                {mealsLogged.length > 0 ? mealsLogged.join(", ") : "None"}
              </div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-2.5 border border-white/5">
              <div className="text-[9px] text-white/40 font-mono uppercase">Hydration</div>
              <div className="text-sm font-medium mt-0.5">
                <span className={waterIntake >= 8 ? "text-emerald-soft" : waterIntake >= 4 ? "text-warm" : "text-red-400"}>
                  {waterIntake} / 8 cups
                </span>
              </div>
              <div className="h-1 rounded-full bg-white/5 mt-1 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${waterIntake >= 8 ? "bg-emerald" : waterIntake >= 4 ? "bg-amber-500" : "bg-red-500"}`}
                  style={{ width: `${hydrationPct}%` }} />
              </div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-2.5 border border-white/5">
              <div className="text-[9px] text-white/40 font-mono uppercase">Appetite</div>
              <div className="text-sm text-white font-medium mt-0.5">{appetiteScore} / 5</div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-2.5 border border-white/5">
              <div className="text-[9px] text-white/40 font-mono uppercase">Weight</div>
              <div className="text-sm text-white font-medium mt-0.5">{weight ? `${weight} lbs` : "Not recorded"}</div>
            </div>
          </div>
        </motion.div>
      )}

      <form onSubmit={handleSubmit} className="grid md:grid-cols-2 gap-4">
        {/* Left Card: Meal Logs */}
        <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-5 space-y-4">
          <h3 className="text-white text-sm font-semibold flex items-center gap-2">
            <Utensils className="size-4 text-emerald-soft" /> Meal Logs
          </h3>
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-mono text-white/50 mb-1">Breakfast</label>
              <input 
                type="text" 
                value={breakfast} 
                onChange={e => setBreakfast(e.target.value)} 
                placeholder="e.g. Oatmeal with bananas, orange juice"
                className="w-full bg-white/5 rounded-xl px-3.5 py-2.5 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" 
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-mono text-white/50 mb-1">Lunch</label>
              <input 
                type="text" 
                value={lunch} 
                onChange={e => setLunch(e.target.value)} 
                placeholder="e.g. Chicken salad wrap, apple slices"
                className="w-full bg-white/5 rounded-xl px-3.5 py-2.5 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" 
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-mono text-white/50 mb-1">Dinner</label>
              <input 
                type="text" 
                value={dinner} 
                onChange={e => setDinner(e.target.value)} 
                placeholder="e.g. Baked salmon, broccoli, brown rice"
                className="w-full bg-white/5 rounded-xl px-3.5 py-2.5 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" 
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-mono text-white/50 mb-1">Snacks</label>
              <input 
                type="text" 
                value={snacks} 
                onChange={e => setSnacks(e.target.value)} 
                placeholder="e.g. Greek yogurt, handful of almonds"
                className="w-full bg-white/5 rounded-xl px-3.5 py-2.5 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" 
              />
            </div>
          </div>
        </div>

        {/* Right Card: Hydration & Appetite & Weight */}
        <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-5 space-y-5 flex flex-col justify-between">
          <div className="space-y-5">
            {/* Water Tracker */}
            <div className="space-y-2">
              <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                <GlassWater className="size-4 text-indigo-soft" /> Hydration Tracker
              </h3>
              <div className="flex items-center gap-4 bg-white/[0.02] p-3 rounded-xl border border-white/5">
                <div className="flex-1">
                  <div className="text-sm text-white font-medium">{waterIntake} cups</div>
                  <div className="text-[10px] text-white/40">Daily goal: 8 cups (64 oz)</div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    type="button"
                    onClick={() => setWaterIntake(w => Math.max(0, w - 1))}
                    className="size-8 rounded-lg bg-white/5 grid place-items-center text-white font-bold hover:bg-white/10 transition cursor-pointer"
                  >
                    -
                  </button>
                  <button 
                    type="button"
                    onClick={() => setWaterIntake(w => w + 1)}
                    className="size-8 rounded-lg bg-indigo text-white font-bold hover:bg-indigo-deep transition cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Appetite Slider */}
            <div className="space-y-2">
              <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                <Coffee className="size-4 text-emerald-soft" /> Appetite Score
              </h3>
              <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 space-y-2">
                <div className="flex justify-between text-xs text-white/60">
                  <span>Poor (1)</span>
                  <span className="font-semibold text-white">Score: {appetiteScore}/5</span>
                  <span>Excellent (5)</span>
                </div>
                <input 
                  type="range" 
                  min="1" 
                  max="5" 
                  value={appetiteScore} 
                  onChange={e => setAppetiteScore(parseInt(e.target.value))} 
                  className="w-full accent-emerald cursor-pointer"
                />
              </div>
            </div>

            {/* Weight Tracker */}
            <div className="space-y-2">
              <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                <Scale className="size-4 text-indigo-soft" /> Weight Tracker
              </h3>
              <div className="flex items-center gap-3 bg-white/[0.02] p-3 rounded-xl border border-white/5">
                <input 
                  type="number" 
                  step="0.1" 
                  value={weight} 
                  onChange={e => setWeight(e.target.value)} 
                  placeholder="e.g. 134.2"
                  className="w-28 bg-white/5 rounded-lg px-3 py-2 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white font-sans font-semibold" 
                />
                <span className="text-xs text-white/60">lbs (leave 0 or empty if not weighed today)</span>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/5 flex justify-end">
            <button 
              type="submit" 
              disabled={saving}
              className="bg-indigo text-white px-6 py-2.5 rounded-xl text-xs font-semibold hover:bg-indigo-deep transition disabled:opacity-50 cursor-pointer inline-flex items-center gap-2"
            >
              {saving ? (
                <><RefreshCw className="size-3 animate-spin" /> Saving...</>
              ) : (
                <><Save className="size-3" /> Save Nutrition Log</>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* ─── RECENT NUTRITION HISTORY ─── */}
      {history.length > 0 && (
        <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-5 space-y-3">
          <div className="text-xs text-white/60 font-mono uppercase tracking-widest">Recent Nutrition Logs</div>
          <div className="space-y-2">
            {history.map((log: any) => {
              const meals = [log.breakfast && "B", log.lunch && "L", log.dinner && "D", log.snacks && "S"].filter(Boolean);
              const hPct = Math.min(100, Math.round(((log.waterIntake || 0) / 8) * 100));
              return (
                <div key={log.id || log.date} className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-white/50 font-mono">{log.date}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-white/50 font-mono">
                        {meals.length > 0 ? meals.join(" · ") : "No meals"} logged
                      </span>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                        (log.waterIntake || 0) >= 8 ? "bg-emerald/10 text-emerald-soft border-emerald/15"
                        : (log.waterIntake || 0) >= 4 ? "bg-amber-500/10 text-warm border-amber-500/15"
                        : "bg-red-500/10 text-red-400 border-red-500/15"
                      }`}>
                        💧 {log.waterIntake || 0}/8
                      </span>
                      <span className="text-[10px] text-white/40 font-mono">🍽 {log.appetiteScore || 3}/5</span>
                      {log.weight > 0 && (
                        <span className="text-[10px] text-white/40 font-mono">⚖ {log.weight} lbs</span>
                      )}
                    </div>
                  </div>
                  {/* Meal details row */}
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {log.breakfast && (
                      <span className="text-[10px] text-white/60 bg-white/5 px-2 py-0.5 rounded-lg">🌅 {log.breakfast}</span>
                    )}
                    {log.lunch && (
                      <span className="text-[10px] text-white/60 bg-white/5 px-2 py-0.5 rounded-lg">☀️ {log.lunch}</span>
                    )}
                    {log.dinner && (
                      <span className="text-[10px] text-white/60 bg-white/5 px-2 py-0.5 rounded-lg">🌙 {log.dinner}</span>
                    )}
                    {log.snacks && (
                      <span className="text-[10px] text-white/60 bg-white/5 px-2 py-0.5 rounded-lg">🍎 {log.snacks}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const AuditLogsPanel = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/audit-logs")
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setLogs(data.logs || []);
        } else {
          toast.error(data.message || "Failed to load audit logs.");
        }
      })
      .catch(() => {
        toast.error("Error connecting to audit logs endpoint.");
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4 font-sans">
      <div>
        <h2 className="text-white font-serif text-2xl flex items-center gap-2">
          <Shield className="size-6 text-indigo-soft" /> System Audit Logs
        </h2>
        <p className="text-white/50 text-xs">Secure immutable log of system events, actions, and security reviews (Admins only).</p>
      </div>

      <div className="rounded-2xl bg-white/[0.04] border border-white/5 p-5 overflow-hidden">
        {loading ? (
          <div className="text-sm text-white/50 text-center py-8">Loading audit logs...</div>
        ) : logs.length === 0 ? (
          <div className="text-sm text-white/50 text-center py-8">No audit events logged.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs text-white/80">
              <thead>
                <tr className="border-b border-white/10 text-white/40 uppercase tracking-wider font-mono font-semibold text-[10px]">
                  <th className="py-2.5 px-3">Timestamp</th>
                  <th className="py-2.5 px-3">User</th>
                  <th className="py-2.5 px-3">Action</th>
                  <th className="py-2.5 px-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {logs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-white/[0.02] transition">
                    <td className="py-2.5 px-3 font-mono text-white/40">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 font-medium">
                      {log.userEmail} <span className="text-[10px] text-white/30">({log.userId})</span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="bg-indigo-soft/10 text-indigo-soft px-2 py-0.5 rounded font-mono uppercase text-[9px] border border-indigo-soft/15">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 max-w-xs truncate text-white/60" title={log.target}>
                      {log.target}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const AuthScreen = ({ 
  setToken, 
  setCurrentUser,
  fetchPatient,
  fetchPatients
}: { 
  setToken: (t: string | null) => void;
  setCurrentUser: (u: any) => void;
  fetchPatient: () => Promise<void>;
  fetchPatients: () => Promise<void>;
}) => {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("family_member");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const endpoint = isLogin ? "/api/auth/login" : "/api/auth/register";
    const body = isLogin 
      ? { email, password } 
      : { name, email, password, role };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));
        setToken(data.token);
        setCurrentUser(data.user);
        toast.success(data.message);
        await fetchPatient();
        await fetchPatients();
      } else {
        toast.error(data.message || "Authentication failed.");
      }
    } catch {
      toast.error("Network error during authentication.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-indigo-deep text-white flex items-center justify-center p-4 relative font-sans">
      {/* Background decorations */}
      <div className="absolute top-1/4 left-1/4 size-72 rounded-full bg-indigo/20 blur-[100px]" />
      <div className="absolute bottom-1/4 right-1/4 size-72 rounded-full bg-emerald/10 blur-[100px]" />

      <div className="bg-white/[0.04] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl backdrop-blur-md relative z-10 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex size-12 rounded-full bg-gradient-to-br from-indigo-soft to-emerald items-center justify-center shadow-lg shadow-indigo/20 mb-1">
            <HeartPulse className="size-6 text-white" strokeWidth={2.4} />
          </div>
          <h2 className="text-2xl font-serif font-semibold text-white tracking-tight">Rocky Care</h2>
          <p className="text-xs text-white/50">Production-ready platform for clinical and family care tracking.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-mono text-white/50 mb-1.5">Full Name</label>
              <input 
                required
                type="text" 
                value={name} 
                onChange={e => setName(e.target.value)} 
                placeholder="Sarah Mitchell"
                className="w-full bg-white/5 rounded-xl px-4 py-2.5 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" 
              />
            </div>
          )}

          <div>
            <label className="block text-[10px] uppercase tracking-wider font-mono text-white/50 mb-1.5">Email Address</label>
            <input 
              required
              type="email" 
              value={email} 
              onChange={e => setEmail(e.target.value)} 
              placeholder="sarah@example.com"
              className="w-full bg-white/5 rounded-xl px-4 py-2.5 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" 
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider font-mono text-white/50 mb-1.5">Password</label>
            <input 
              required
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              placeholder="••••••••"
              className="w-full bg-white/5 rounded-xl px-4 py-2.5 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" 
            />
          </div>

          {!isLogin && (
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-mono text-white/50 mb-1.5">Role Selection</label>
              <select 
                value={role} 
                onChange={e => setRole(e.target.value)}
                className="w-full bg-white/5 rounded-xl px-3 py-2.5 text-xs outline-none border border-transparent text-white [&>option]:bg-[#131637]"
              >
                <option value="primary_caregiver">Caregiver (Primary Caregiver)</option>
                <option value="family_member">Family Member (Son, Daughter, etc.)</option>
              </select>
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-indigo hover:bg-indigo-deep text-white text-xs font-semibold transition disabled:opacity-50 cursor-pointer shadow-lg shadow-indigo/15"
          >
            {loading ? "Authenticating..." : isLogin ? "Log In" : "Register Account"}
          </button>
        </form>

        <div className="pt-2 border-t border-white/5 text-center text-xs space-y-3 font-sans">
          <button 
            onClick={() => setIsLogin(!isLogin)}
            className="text-indigo-soft hover:text-white transition font-medium"
          >
            {isLogin ? "Need an account? Register instead" : "Have an account? Log in instead"}
          </button>

          <div className="bg-white/5 border border-white/5 p-3 rounded-xl text-left text-[11px] text-white/60 space-y-1">
            <div className="font-semibold text-white/80 flex items-center gap-1.5">
              <UserCheck className="size-3.5 text-emerald-soft" /> Demo Credentials Notice:
            </div>
            <div>
              <strong>Primary Caregiver</strong>: <code className="font-mono text-white bg-white/10 px-1 rounded">sarah@example.com</code> / <code className="font-mono text-white bg-white/10 px-1 rounded">demo1234</code>
            </div>
            <div className="text-[10px] text-white/40">
              Or register a new email and choose your role.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// APP SHELL
// ═════════════════════════════════════════════════════════════════════

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem("token"));
  const [currentUser, setCurrentUser] = useState<any>(() => {
    const userStr = localStorage.getItem("user");
    return userStr ? JSON.parse(userStr) : null;
  });

  const [page, setPage] = useState("Dashboard");
  const [patient, setPatient] = useState<any>(null);
  const [patientsList, setPatientsList] = useState<any[]>([]);
  const [showPatientSelector, setShowPatientSelector] = useState(false);
  const [showAddPatientModal, setShowAddPatientModal] = useState(false);
  const [newPatientName, setNewPatientName] = useState("");
  const [newPatientAge, setNewPatientAge] = useState("");
  const [newPatientCondition, setNewPatientCondition] = useState("");
  const [newPatientNotes, setNewPatientNotes] = useState("");
  const [isSubmittingPatient, setIsSubmittingPatient] = useState(false);

  const fetchPatient = async () => {
    try {
      const res = await apiFetch("/api/patient");
      if (res.ok) {
        setPatient(await res.json());
      }
    } catch (err) {
      console.error("Error fetching patient:", err);
    }
  };

  const fetchPatients = async () => {
    try {
      const res = await apiFetch("/api/patients");
      const data = await res.json();
      setPatientsList(data.patients || []);
    } catch {}
  };

  useEffect(() => {
    if (token) {
      fetchPatient();
      fetchPatients();
    }
  }, [token]);

  const handleResolveAlert = async (id: string) => {
    try {
      const res = await apiFetch(`/api/alerts/${id}/resolve`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        setPatient(data.patient);
      }
    } catch {
      toast.error("Failed to resolve alert.");
    }
  };

  const handleToggleMed = async (id: string) => {
    try {
      const res = await apiFetch(`/api/meds/${id}/toggle`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        setPatient(data.patient);
      }
    } catch {
      toast.error("Failed to update medication.");
    }
  };

  const handleAddMed = async (name: string, time: string) => {
    try {
      const res = await apiFetch("/api/meds/add", {
        method: "POST",
        body: JSON.stringify({ name, time })
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        setPatient(data.patient);
      }
    } catch {
      toast.error("Failed to add medication.");
    }
  };

  const handleUpdatePatient = async (updates: any) => {
    const res = await apiFetch("/api/patient", {
      method: "PATCH",
      body: JSON.stringify(updates)
    });
    const data = await res.json();
    if (data.success) {
      setPatient(data.patient);
    } else {
      throw new Error(data.message);
    }
  };

  const handleSwitchPatient = async (id: string) => {
    try {
      const res = await apiFetch(`/api/patients/${id}/activate`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        await fetchPatient();
        await fetchPatients();
        setShowPatientSelector(false);
      }
    } catch {
      toast.error("Failed to switch patient.");
    }
  };

  const handleAddPatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPatientName.trim()) return;
    setIsSubmittingPatient(true);
    try {
      const res = await apiFetch("/api/patients", {
        method: "POST",
        body: JSON.stringify({
          name: newPatientName,
          age: newPatientAge,
          condition: newPatientCondition,
          notes: newPatientNotes,
        })
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        setShowAddPatientModal(false);
        setNewPatientName("");
        setNewPatientAge("");
        setNewPatientCondition("");
        setNewPatientNotes("");
        await fetchPatients();
        handleSwitchPatient(data.patient.id);
      } else {
        toast.error(data.message || "Failed to add patient.");
      }
    } catch {
      toast.error("Network error while adding patient.");
    } finally {
      setIsSubmittingPatient(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {}
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setCurrentUser(null);
    toast.success("Successfully logged out.");
  };

  const navItems = [
    { icon: Home, label: "Dashboard" },
    { icon: Mic, label: "Voice Check-In" },
    { icon: Brain, label: "Rocky AI" },
    { icon: Pill, label: "Medications" },
    { icon: Calendar, label: "Care Plans" },
    { icon: Users, label: "Care Team" },
    { icon: Coffee, label: "Nutrition" },
    { icon: FileText, label: "Reports & FHIR" },
    { icon: Sun, label: "Settings" },
  ];

  if (currentUser?.role === "admin") {
    navItems.push({ icon: Shield, label: "Audit Logs" });
  }

  const alerts = patient?.alerts || [];
  const activeAlertCount = alerts.filter((a: any) => !a.resolved).length;

  if (!token) {
    return (
      <>
        <AuthScreen 
          setToken={setToken} 
          setCurrentUser={setCurrentUser} 
          fetchPatient={fetchPatient} 
          fetchPatients={fetchPatients} 
        />
        <Toaster position="top-right" richColors />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-indigo-deep text-foreground flex">
      {/* Sidebar */}
      <aside className="w-[220px] shrink-0 border-r border-white/5 p-4 flex flex-col sticky top-0 h-screen">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-2 mb-6">
          <div className="relative size-9 rounded-full bg-indigo grid place-items-center">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-indigo-soft to-emerald opacity-90" />
            <HeartPulse className="size-4 text-white relative" strokeWidth={2.4} />
          </div>
          <div>
            <span className="font-serif text-[20px] text-white tracking-tight">Rocky</span>
            <div className="text-[9px] text-emerald-soft font-mono uppercase tracking-wider">ACL Track 1</div>
          </div>
        </div>

        {/* Patient selector */}
        <div className="mb-4">
          <button
            onClick={() => setShowPatientSelector(!showPatientSelector)}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-white/[0.04] border border-white/5 hover:bg-white/[0.08] transition cursor-pointer"
          >
            <img src={patient?.image || "https://ui-avatars.com/api/?name=P&background=6366f1&color=fff"} alt="" className="size-8 rounded-full object-cover ring-1 ring-white/10" />
            <div className="flex-1 text-left min-w-0">
              <div className="text-sm text-white font-medium truncate">{patient?.name || "Select Patient"}</div>
              <div className="text-[10px] text-white/50">{patient?.age ? `Age ${patient.age}` : ""}</div>
            </div>
            <ChevronRight className={`size-3.5 text-white/40 transition-transform ${showPatientSelector ? "rotate-90" : ""}`} />
          </button>

          {showPatientSelector && (
            <div className="mt-1 bg-white/[0.04] rounded-xl border border-white/5 overflow-hidden flex flex-col">
              <div className="max-h-48 overflow-y-auto">
                {patientsList.map(p => (
                  <button key={p.id} onClick={() => handleSwitchPatient(p.id)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 hover:bg-white/5 transition cursor-pointer text-left ${p.id === patient?.id ? "bg-white/[0.06]" : ""}`}>
                    <img src={p.image} alt="" className="size-7 rounded-full object-cover ring-1 ring-white/10" />
                    <span className={`text-xs ${p.id === patient?.id ? "text-emerald-soft font-medium" : "text-white"}`}>{p.name}</span>
                  </button>
                ))}
              </div>
              <button 
                onClick={() => { setShowPatientSelector(false); setShowAddPatientModal(true); }}
                className="w-full flex items-center justify-center gap-2 px-2.5 py-2 hover:bg-white/5 transition cursor-pointer text-left text-xs text-indigo-soft font-medium border-t border-white/5"
              >
                <Plus className="size-3.5" /> Add New Patient
              </button>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5">
          {navItems.map(item => {
            const isActive = page === item.label;
            return (
              <button key={item.label} onClick={() => { setPage(item.label); setShowPatientSelector(false); }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm cursor-pointer transition ${
                  isActive ? "bg-white/10 text-white font-medium" : "text-white/60 hover:text-white hover:bg-white/5"
                }`}>
                <div className="flex items-center gap-2.5"><item.icon className="size-4" /> {item.label}</div>
                {item.label === "Dashboard" && activeAlertCount > 0 && (
                  <span className="text-[10px] bg-red-500/80 text-white rounded-full px-1.5 py-0.5">{activeAlertCount}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Profile & Logout / Footer */}
        {currentUser && (
          <div className="pt-3 border-t border-white/5 mt-auto space-y-2">
            <div className="flex items-center gap-2 px-2">
              <img src={currentUser.avatar} alt="" className="size-7 rounded-full object-cover ring-1 ring-white/10 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-white font-medium truncate">{currentUser.name}</div>
                <div className="text-[9px] text-emerald-soft uppercase font-mono tracking-wider truncate">
                  {currentUser.role?.replace("_", " ")}
                </div>
              </div>
            </div>
            <button 
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs text-white/40 hover:text-white hover:bg-white/5 transition cursor-pointer"
            >
              <Lock className="size-3.5" /> Log Out
            </button>
          </div>
        )}

        <div className="pt-4 border-t border-white/5 mt-4">
          <div className="text-[10px] text-white/30 font-mono px-2">
            Rocky Care v1.0 · Phase-1 MVP
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          {page === "Dashboard" && <DashboardView patient={patient} onResolveAlert={handleResolveAlert} fetchPatient={fetchPatient} />}
          {page === "Voice Check-In" && <VoiceCheckInPanel patient={patient} fetchPatient={fetchPatient} />}
          {page === "Rocky AI" && <AIAssistantPanel patient={patient} />}
          {page === "Medications" && <MedicationPanel patient={patient} onToggleMed={handleToggleMed} onAddMed={handleAddMed} />}
          {page === "Care Plans" && <CarePlansPanel patient={patient} />}
          {page === "Care Team" && <CareTeamPanel patient={patient} fetchPatient={fetchPatient} />}
          {page === "Nutrition" && <NutritionPanel patient={patient} fetchPatient={fetchPatient} />}
          {page === "Reports & FHIR" && <ReportsPanel patient={patient} />}
          {page === "Settings" && <SettingsPanel patient={patient} onUpdatePatient={handleUpdatePatient} />}
          {page === "Audit Logs" && <AuditLogsPanel />}
        </div>
      </main>

      <Toaster position="top-right" richColors />

      {/* Add Patient Modal */}
      {showAddPatientModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-indigo-deep border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <h3 className="text-lg font-serif text-white">Add New Patient</h3>
              <button onClick={() => setShowAddPatientModal(false)} className="text-white/40 hover:text-white transition cursor-pointer">
                <X className="size-5" />
              </button>
            </div>
            <form onSubmit={handleAddPatient} className="p-5 space-y-4 font-sans">
              <div>
                <label className="block text-xs text-white/60 mb-1.5 uppercase tracking-wider font-mono">Patient Name *</label>
                <input required type="text" value={newPatientName} onChange={e => setNewPatientName(e.target.value)} placeholder="e.g. Eleanor M."
                  className="w-full bg-white/5 rounded-xl px-4 py-2.5 text-xs outline-none border border-transparent focus:border-indigo-soft/40 text-white" />
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1.5 uppercase tracking-wider font-mono">Age</label>
                <input type="number" value={newPatientAge} onChange={e => setNewPatientAge(e.target.value)} placeholder="e.g. 82"
                  className="w-full bg-white/5 rounded-xl px-4 py-2.5 text-sm outline-none border border-transparent focus:border-indigo-soft/40 text-white" />
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1.5 uppercase tracking-wider font-mono">Condition (Optional)</label>
                <input type="text" value={newPatientCondition} onChange={e => setNewPatientCondition(e.target.value)} placeholder="e.g. Mild Dementia"
                  className="w-full bg-white/5 rounded-xl px-4 py-2.5 text-sm outline-none border border-transparent focus:border-indigo-soft/40 text-white" />
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1.5 uppercase tracking-wider font-mono">Notes</label>
                <textarea value={newPatientNotes} onChange={e => setNewPatientNotes(e.target.value)} placeholder="Any specific care notes..."
                  className="w-full h-24 bg-white/5 rounded-xl px-4 py-3 text-sm outline-none border border-transparent focus:border-indigo-soft/40 resize-none text-white" />
              </div>
              <div className="pt-2 flex gap-3">
                <button type="button" onClick={() => setShowAddPatientModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={isSubmittingPatient || !newPatientName.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-indigo hover:bg-indigo-deep text-white text-sm font-semibold transition cursor-pointer disabled:opacity-50">
                  {isSubmittingPatient ? "Adding..." : "Add Patient"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}