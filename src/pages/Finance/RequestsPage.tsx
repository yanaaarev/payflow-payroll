// src/pages/RequestsPage.tsx
import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebase/firebase";
import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  doc,
  getDoc,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

// ───────────────────────── Types ─────────────────────────
type ReqType = "ob" | "ot" | "sl" | "bl" | "vl" | "remotework" | "wfh" | "rdot";

type RequestDoc = {
  id: string;
  employeeId: string;
  employeeName: string;
  type: ReqType;
  status: "pending" | "approved" | "rejected";
  filedAt?: any;
  filedBy: string;
  details: any;
};

type EmpType = "core" | "intern" | "freelancer";

type MyEmployee = {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  type: EmpType;
  obRates: Array<{ category: string; rate: number }>;
};

type Role = "admin_final" | "admin_overseer" | "exec" | "finance" | "employee";

/* ========= Owners (hard override, same as other pages) ========= */
const OWNER_ADMIN_FINAL = {
  email: "jelynsonbattung@gmail.com",
  uid: "XddCcBNNErU0uTwcY3wb9whOoM83",
};
const OWNER_ADMIN_OVERSEER = {
  email: "jropatpat@gmail.com",
  uid: "azDiemn8ArZTLbpMLy7yyxijW2Z2",
};

// ─────────────────────── Helpers ────────────────────────
function minutesBetween(startHHMM: string, endHHMM: string) {
  const [sh, sm] = startHHMM.split(":").map((x) => parseInt(x, 10));
  const [eh, em] = endHHMM.split(":").map((x) => parseInt(x, 10));
  if ([sh, sm, eh, em].some((v) => Number.isNaN(v))) return 0;
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return Math.max(0, end - start);
}
function computeHoursFromTo(startHHMM: string, endHHMM: string) {
  const mins = minutesBetween(startHHMM, endHHMM);
  return Math.round((mins / 60) * 100) / 100;
}
function computeOtHours(timeoutHHMM: string) {
  return computeHoursFromTo("17:30", timeoutHHMM);
}
function statusBadge(status: string) {
  if (status === "approved")
    return "bg-emerald-500/20 text-emerald-300 border-emerald-400/30";
  if (status === "rejected")
    return "bg-rose-500/20 text-rose-300 border-rose-400/30";
  return "bg-amber-500/20 text-amber-200 border-amber-400/30";
}

// Normalize OB category keys
type ObKey = "assisted" | "videographer" | "talent";
const OB_LABEL: Record<ObKey, string> = {
  assisted: "Assisted",
  videographer: "Videographer",
  talent: "Talent",
};
function normCategory(text: string): ObKey | null {
  const t = (text || "").toLowerCase().trim();
  if (["assisted", "assist", "shoot"].includes(t)) return "assisted";
  if (["videographer", "video", "vid"].includes(t)) return "videographer";
  if (["talent", "actor", "model"].includes(t)) return "talent";
  return null;
}

/* ─────────── roles mapping (same pattern as Approvals/Settings) ─────────── */
function mapUserRolesToPageRoles({
  uid,
  email,
  rolesFromUsers,
}: {
  uid?: string;
  email?: string;
  rolesFromUsers?: string[];
}): Role[] {
  const lowerEmail = (email || "").toLowerCase();
  if (uid === OWNER_ADMIN_FINAL.uid || lowerEmail === OWNER_ADMIN_FINAL.email) return ["admin_final"];
  if (uid === OWNER_ADMIN_OVERSEER.uid || lowerEmail === OWNER_ADMIN_OVERSEER.email)
    return ["admin_overseer"];

  const raw = Array.isArray(rolesFromUsers) ? rolesFromUsers.map(String) : [];
  const out = new Set<Role>();
  if (raw.some((r) => r.toLowerCase() === "admin")) out.add("admin_final");
  if (raw.some((r) => r.toLowerCase() === "exec")) out.add("exec");
  if (raw.some((r) => r.toLowerCase() === "finance")) out.add("finance");
  if (out.size === 0) out.add("employee");
  return Array.from(out);
}
const hasRole = (roles: Role[], r: Role) => roles.includes(r);

// ───────────────────── Component ───────────────────────
export default function RequestsPage() {
  const auth = getAuth();

  // roles
  const [rolesLoading, setRolesLoading] = useState(true);
  const [roles, setRoles] = useState<Role[]>(["employee"]);

  // me (employee profile)
  const [meEmp, setMeEmp] = useState<MyEmployee | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);

  // list
  const [requests, setRequests] = useState<RequestDoc[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // tabs & filters
  const [tab, setTab] = useState<"list" | "file">("list");
  const [qText, setQText] = useState("");
  const [filterType, setFilterType] = useState<"" | ReqType>("");

  // form: shared
  const [type, setType] = useState<ReqType>("ob");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");
  const [proofUrl, setProofUrl] = useState("");

  // form: OB
  const [obTitle, setObTitle] = useState("");
  const [obCategoryKey, setObCategoryKey] = useState<ObKey>("assisted");

  // form: OT
  const [otTimeout, setOtTimeout] = useState("");
  const otHours = useMemo(
    () => (otTimeout ? computeOtHours(otTimeout) : 0),
    [otTimeout]
  );

  // form: Remote/WFH/RDOT
  const [timeIn, setTimeIn] = useState("");
  const [timeOut, setTimeOut] = useState("");
  const workedHours = useMemo(
    () => (timeIn && timeOut ? computeHoursFromTo(timeIn, timeOut) : 0),
    [timeIn, timeOut]
  );

  // which request types MUST have proof?
  const needsProof = useMemo(
    () => type === "ot" || type === "remotework" || type === "wfh" || type === "rdot",
    [type]
  );

  /* ── Load roles for the current user (users/{uid}.roles) ── */
  useEffect(() => {
    (async () => {
      setRolesLoading(true);
      try {
        const u = auth.currentUser;
        if (!u?.uid) {
          setRoles(["employee"]);
          return;
        }
        const uref = doc(db, "users", u.uid);
        const usnap = await getDoc(uref).catch(() => null);
        const fromUsers: string[] | undefined =
          (usnap && (usnap as any).exists?.() ? (usnap as any).data()?.roles : undefined) || undefined;

        const mapped = mapUserRolesToPageRoles({
          uid: u.uid,
          email: (u.email || "").toLowerCase(),
          rolesFromUsers: fromUsers,
        });
        setRoles(mapped);
      } finally {
        setRolesLoading(false);
      }
    })();
  }, [auth]);

  const canViewAll = useMemo(
    () =>
      hasRole(roles, "admin_final") ||
      hasRole(roles, "admin_overseer") ||
      hasRole(roles, "finance") ||
      hasRole(roles, "exec"),
    [roles]
  );

  // If the user cannot view the list, default to "file"
  useEffect(() => {
    if (!rolesLoading && !canViewAll) setTab("file");
  }, [rolesLoading, canViewAll]);

  // ── load my employee via email
  useEffect(() => {
    (async () => {
      setLoadingMe(true);
      try {
        const email = auth.currentUser?.email || "";
        if (!email) {
          setMeEmp(null);
          return;
        }
        const snap = await getDocs(collection(db, "employees"));
        let found: MyEmployee | null = null;
        snap.forEach((d) => {
          const x = d.data() as any;
          if ((x.email || "").toLowerCase() === email.toLowerCase()) {
            found = {
              id: d.id,
              employeeId: x.employeeId || "",
              name: x.name || "",
              email: x.email || "",
              type: (x.type as EmpType) || "core",
              obRates: Array.isArray(x.obRates)
                ? x.obRates.map((r: any) => ({
                    category: String(r?.category || r?.role || r?.title || ""),
                    rate: Number(r?.rate ?? r?.amount ?? 0),
                  }))
                : [],
            };
          }
        });
        setMeEmp(found);
      } finally {
        setLoadingMe(false);
      }
    })();
  }, [auth]);

  // ── load requests (ONLY if user can view all)
  useEffect(() => {
    (async () => {
      if (!canViewAll) {
        setRequests([]);
        setLoadingList(false);
        return;
      }
      setLoadingList(true);
      try {
        const snap = await getDocs(
          query(collection(db, "requests"), orderBy("filedAt", "desc"))
        );
        const list: RequestDoc[] = [];
        snap.forEach((d) => {
          const x = d.data() as any;
          list.push({
            id: d.id,
            employeeId: x.employeeId,
            employeeName: x.employeeName,
            type: x.type,
            details: x.details || {},
            status: x.status || "pending",
            filedBy: x.filedBy || "",
            filedAt: x.filedAt,
          });
        });
        setRequests(list);
      } finally {
        setLoadingList(false);
      }
    })();
  }, [canViewAll]);

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      const byType = filterType ? r.type === filterType : true;
      const q = qText.trim().toLowerCase();
      const hit =
        !q ||
        r.employeeName.toLowerCase().includes(q) ||
        r.employeeId.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q) ||
        (r.details?.title || r.details?.eventName || "")
          .toLowerCase()
          .includes(q);
      return byType && hit;
    });
  }, [requests, qText, filterType]);

  // ── helper: find suggested OB rate for payroll
  function suggestObRate(
    emp: MyEmployee,
    key: ObKey
  ): { rate?: number; source?: string } {
    if (emp.type === "intern") return { rate: 500, source: "fixed-intern" };

    if (emp.type === "core" && key === "assisted") {
      const explicit = emp.obRates.find(
        (r) => r.category?.toLowerCase() === "assisted"
      );
      return explicit
        ? { rate: explicit.rate, source: "employee.obRates" }
        : { rate: 1500, source: "fixed-core" };
    }

    const lookFor =
      key === "videographer" ? "videographer" : key === "talent" ? "talent" : "assisted";
    const hit =
      emp.obRates.find((r) => r.category?.toLowerCase() === lookFor) ||
      emp.obRates.find((r) => normCategory(r.category) === key);
    if (hit) return { rate: hit.rate, source: "employee.obRates" };

    return {};
  }

  // ── submit
  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!meEmp) {
      alert(
        "Your employee record was not found. Please ensure your email is set on your employee profile."
      );
      return;
    }

    // block submit if proof is required and missing
    if (needsProof && !proofUrl.trim()) {
      alert("Proof of Approval is required for this request type.");
      return;
    }

    // Build "details" object per type; include proof only when required
    const base: any = { date };
    if (needsProof) base.proofUrl = proofUrl.trim();

    if (type === "ob") {
      const { rate, source } = suggestObRate(meEmp, obCategoryKey);
      Object.assign(base, {
        title: obTitle,
        location: location || undefined,
        categoryKey: obCategoryKey,
        categoryLabel: OB_LABEL[obCategoryKey],
        suggestedRate: typeof rate === "number" ? rate : undefined,
        rateSource: source,
      });
    }

    if (type === "ot") {
      Object.assign(base, {
        fixedStart: "17:30",
        timeout: otTimeout,
        hours: otHours,
        reason: reason || undefined,
      });
    }

    if (type === "remotework" || type === "wfh" || type === "rdot") {
      Object.assign(base, {
        location: type === "rdot" ? undefined : location || undefined,
        timeIn,
        timeOut,
        hours: workedHours,
        reason: reason || undefined,
      });
    }

    if (type === "sl" || type === "bl" || type === "vl") {
      Object.assign(base, { kind: type.toUpperCase() });
    }

    await addDoc(collection(db, "requests"), {
      employeeId: meEmp.employeeId,
      employeeName: meEmp.name,
      type,
      details: base,
      status: "pending",
      filedAt: serverTimestamp(),
      filedBy: auth.currentUser?.email || "",
    });

// ✅ Notify approvers
await fetch("/api/sendEmail", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    to: [
      "jelynsonbattung@gmail.com",       // admin_final
      "hrfinance.instapost@gmail.com",   // finance
      "auquilang.instapost@gmail.com",   // exec
      "yana.instapost@gmail.com",        // exec
    ],
    subject: "📑 New Request Filed",
    html: `
      <p>A new <b>${type.toUpperCase()}</b> request has been filed by <b>${meEmp.name}</b>.</p>
      <p><b>Date:</b> ${date}<br/>
         <b>Reason:</b> ${reason || "—"}</p>
      <p><a href="https://yourapp.com/approvals">Review in Approvals</a></p>
    `,
  }),
});

    // reset + switch
    setDate("");
    setReason("");
    setLocation("");
    setProofUrl("");
    setObTitle("");
    setObCategoryKey("assisted");
    setOtTimeout("");
    setTimeIn("");
    setTimeOut("");
    // If they can't view all, keep them on "file"; otherwise jump them back to list
    setTab(canViewAll ? "list" : "file");
    alert("Request submitted for admin approval.");
  }

  // ────────────────────────── UI ──────────────────────────
  if (rolesLoading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white pt-20 flex items-center justify-center">
        <div className="text-gray-300">Loading access…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white pt-20 pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Requests</h1>
          <p className="text-gray-300 mt-2">
            File OB / OT / Leave / Remote Work requests. Admin approval is required.
          </p>

          {/* Tabs: if user CAN view all, show both tabs;
              if NOT, hide the list tab and keep only File a Request */}
          <div className="mt-6 inline-flex rounded-xl overflow-hidden border border-white/10">
            {canViewAll && (
              <button
                className={`px-6 py-2 ${tab === "list" ? "bg-gray-800" : "bg-gray-800/40"} hover:bg-gray-800`}
                onClick={() => setTab("list")}
              >
                All Requests
              </button>
            )}
            <button
              className={`px-6 py-2 ${tab === "file" ? "bg-blue-600" : "bg-gray-800/40"} hover:bg-blue-600/90`}
              onClick={() => setTab("file")}
              disabled={loadingMe}
              title={loadingMe ? "Loading profile…" : ""}
            >
              File a Request
            </button>
          </div>
        </div>

        {tab === "list" && canViewAll ? (
          <>
            <div className="max-w-5xl mx-auto space-y-4">
              {/* Filter bar */}
              <div className="rounded-2xl border border-white/10 bg-gray-800/40 p-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    className="inp h-12 w-full"
                    placeholder="Search by name, ID, type, or event title…"
                    value={qText}
                    onChange={(e) => setQText(e.target.value)}
                  />
                  <select
                    className="inp h-12 w-full select-gray no-native-ui"
                    value={filterType}
                    onChange={(e) => setFilterType((e.target.value || "") as any)}
                  >
                    <option value="">All Types</option>
                    <option value="ob">OB</option>
                    <option value="ot">OT</option>
                    <option value="sl">SL</option>
                    <option value="bl">BL</option>
                    <option value="vl">VL</option>
                    <option value="remotework">Remote Work</option>
                    <option value="wfh">WFH</option>
                    <option value="rdot">RDOT</option>
                  </select>
                </div>
              </div>
            </div>

            {/* list */}
            <div className="rounded-2xl border border-white/10 bg-gray-800/40 overflow-hidden mt-4">
              {loadingList ? (
                <div className="p-8 text-center text-gray-400">Loading requests…</div>
              ) : filtered.length === 0 ? (
                <div className="p-8 text-center text-gray-400">No requests found.</div>
              ) : (
                <div className="divide-y divide-white/10">
                  {filtered.map((r) => (
                    <div key={r.id} className="p-5 hover:bg-white/5 transition">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold">
                            {r.employeeName}{" "}
                            <span className="text-sm text-gray-400">({r.employeeId})</span>
                          </div>
                          <div className="text-sm text-gray-300">
                            Type: <span className="text-white">{r.type.toUpperCase()}</span>{" "}
                            <span className="mx-2">•</span> Filed by: {r.filedBy}
                          </div>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs border ${statusBadge(r.status)}`}>
                          {r.status}
                        </span>
                      </div>

                      <div className="mt-3">
                        <RequestDetail r={r} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          // ───────────── centered form ─────────────
          <form
            onSubmit={submitRequest}
            className="max-w-3xl mx-auto rounded-2xl border border-white/10 bg-gray-800/40 p-6 space-y-6"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2">
                <label className="lbl">Request Type</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as ReqType)}
                  className="inp select-gray"
                >
                  <option value="ob">OB</option>
                  <option value="ot">OT</option>
                  <option value="sl">SL</option>
                  <option value="bl">BL</option>
                  <option value="vl">VL</option>
                  <option value="remotework">Remote Work</option>
                  <option value="wfh">WFH</option>
                  <option value="rdot">RDOT</option>
                </select>
              </div>
              <div>
                <label className="lbl">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="inp"
                  required
                />
              </div>
            </div>

            {/* OB */}
            {type === "ob" && (
              <div className="space-y-4">
                <div>
                  <label className="lbl">Name of the Shoot/Event</label>
                  <input
                    value={obTitle}
                    onChange={(e) => setObTitle(e.target.value)}
                    className="inp"
                    required
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="lbl">Location</label>
                    <input
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      className="inp"
                    />
                  </div>
                  <div>
                    <label className="lbl">Category</label>
                    <select
                      value={obCategoryKey}
                      onChange={(e) => setObCategoryKey(e.target.value as ObKey)}
                      className="inp select-gray"
                    >
                      <option value="assisted">Assisted</option>
                      <option value="videographer">Videographer</option>
                      <option value="talent">Talent</option>
                    </select>
                    <p className="text-xs text-gray-400 mt-1">
                      OB rate hint will be saved for the payroll draft (e.g., Core+Assisted = ₱1,500; Intern = ₱500).
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* OT */}
            {type === "ot" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="lbl">OT Starts At</label>
                    <input className="inp" value="17:30" disabled />
                  </div>
                  <div>
                    <label className="lbl">Time Out</label>
                    <input
                      type="time"
                      value={otTimeout}
                      onChange={(e) => setOtTimeout(e.target.value)}
                      className="inp"
                      required
                    />
                  </div>
                  <div>
                    <label className="lbl">Computed OT Hours</label>
                    <input className="inp" value={otHours || ""} readOnly placeholder="0" />
                  </div>
                </div>
                <div>
                  <label className="lbl">Reason</label>
                  <textarea
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="inp"
                  />
                </div>
              </div>
            )}

            {/* Remote / WFH / RDOT */}
            {(type === "remotework" || type === "wfh" || type === "rdot") && (
              <div className="space-y-4">
                {type !== "rdot" && (
                  <div>
                    <label className="lbl">Location</label>
                    <input
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      className="inp"
                    />
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="lbl">Time In</label>
                    <input
                      type="time"
                      value={timeIn}
                      onChange={(e) => setTimeIn(e.target.value)}
                      className="inp"
                      required
                    />
                  </div>
                  <div>
                    <label className="lbl">Time Out</label>
                    <input
                      type="time"
                      value={timeOut}
                      onChange={(e) => setTimeOut(e.target.value)}
                      className="inp"
                      required
                    />
                  </div>
                  <div>
                    <label className="lbl">Computed Hours</label>
                    <input className="inp" value={workedHours || ""} readOnly placeholder="0" />
                  </div>
                </div>
                <div>
                  <label className="lbl">Reason</label>
                  <textarea
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="inp"
                  />
                </div>
              </div>
            )}

            {/* SL / BL / VL note (no proof field) */}
            {(type === "sl" || type === "bl" || type === "vl") && (
              <div className="text-sm text-gray-300">
                Leave request filed. (No proof link required.)
              </div>
            )}

            {/* Proof (required only for OT/Remote/WFH/RDOT) */}
            {needsProof && (
              <div>
                <label className="lbl">Proof of Approval (link to screenshot)</label>
                <input
                  placeholder="https://drive.google.com/… or image URL"
                  value={proofUrl}
                  onChange={(e) => setProofUrl(e.target.value)}
                  className="inp"
                  required
                />
                <p className="text-xs text-gray-400 mt-1">
                  Required for OT, Remote Work, WFH, and RDOT requests.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-center gap-3 pt-2">
              {canViewAll && (
                <button
                  type="button"
                  onClick={() => setTab("list")}
                  className="px-5 py-2 rounded-xl bg-gray-700 hover:bg-gray-600"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                className="px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-500"
              >
                Submit for Approval
              </button>
            </div>
          </form>
        )}
      </div>

      {/* tiny style helpers */}
      <style>{`
        .inp-lg {
          padding: 1rem 1.25rem;
          font-size: 1.05rem;
          border-radius: 1rem;
        }
        .inp {
          width: 100%;
          padding: 0.75rem 1rem;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 0.75rem;
          color: #fff;
          outline: none;
          appearance: none;
        }
        .inp:focus {
          box-shadow: 0 0 0 2px rgba(59,130,246,0.5);
          border-color: rgba(59,130,246,0.6);
        }
        .select-gray {
          background-color: rgba(31,41,55,0.8);
          color: #fff;
        }
        .select-gray option {
          background-color: #111827;
          color: #ffffff;
        }
        .lbl {
          display:block;
          font-size: 0.9rem;
          color: #d1d5db;
          margin-bottom: 0.35rem;
        }
      `}</style>
    </div>
  );
}

// ───────────────────── Detail Card ──────────────────────
function RequestDetail({ r }: { r: RequestDoc }) {
  const d = r.details || {};
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2">
      <div className="text-sm text-gray-300">
        Date: <span className="text-white">{d.date || "—"}</span>
      </div>

      {r.type === "ob" && (
        <>
          <Row label="Name of Shoot/Event" value={d.title || d.eventName || "—"} />
          <Row label="Location" value={d.location || "—"} />
          <Row label="Category" value={d.categoryLabel || d.categoryKey || "—"} />
          {"suggestedRate" in d && (
            <Row
              label="Suggested OB Rate"
              value={
                typeof d.suggestedRate === "number"
                  ? `₱${Number(d.suggestedRate).toLocaleString()}`
                  : "—"
              }
            />
          )}
        </>
      )}

      {r.type === "ot" && (
        <>
          <Row label="OT Start" value="5:30 PM" />
          <Row label="Time Out" value={d.timeout || "—"} />
          <Row label="Computed Hours" value={Number(d.hours || 0).toFixed(2)} />
          <Row label="Reason" value={d.reason || "—"} />
        </>
      )}

      {(r.type === "remotework" || r.type === "wfh" || r.type === "rdot") && (
        <>
          {r.type !== "rdot" && <Row label="Location" value={d.location || "—"} />}
          <Row label="Time In / Out" value={`${d.timeIn || "—"} – ${d.timeOut || "—"}`} />
          <Row label="Computed Hours" value={Number(d.hours || 0).toFixed(2)} />
          <Row label="Reason" value={d.reason || "—"} />
        </>
      )}

      {(r.type === "sl" || r.type === "bl" || r.type === "vl") && (
        <Row label="Type" value={r.type.toUpperCase()} />
      )}

      {d.proofUrl && (
        <div className="text-sm text-gray-300">
          Proof of Approval:{" "}
          <a href={d.proofUrl} target="_blank" rel="noreferrer" className="text-blue-300 underline">
            View
          </a>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm text-gray-300">
      {label}: <span className="text-white">{value}</span>
    </div>
  );
}
