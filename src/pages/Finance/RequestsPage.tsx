// src/pages/RequestsPage.tsx
import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebase/firebase";
import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  doc,
  where,
  setDoc,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

// ───────────────────────── Types ─────────────────────────
type ReqType = "ob" | "ot" | "sl" | "bl" | "vl" | "remotework" | "wfh" | "rdot";
type EmpType = "core" | "intern" | "freelancer";

type MyEmployee = {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  type: EmpType;
  obRates: Array<{ category: string; rate: number }>;
};

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

// ───────────────────── Component ───────────────────────
export default function RequestsPage() {
  const auth = getAuth();

  // me (employee profile)
  const [meEmp, setMeEmp] = useState<MyEmployee | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);

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
  const otHours = useMemo(() => {
    if (!otTimeout) return 0;
    const [eh, em] = otTimeout.split(":").map((x) => parseInt(x, 10));
    const end = eh * 60 + em;
    const base = 17 * 60 + 30;
    return Math.max(0, Math.round(((end - base) / 60) * 100) / 100);
  }, [otTimeout]);

  // form: Remote/WFH/RDOT
  const [timeIn, setTimeIn] = useState("");
  const [timeOut, setTimeOut] = useState("");
  const workedHours = useMemo(() => {
    if (!timeIn || !timeOut) return 0;
    const [sh, sm] = timeIn.split(":").map((x) => parseInt(x, 10));
    const [eh, em] = timeOut.split(":").map((x) => parseInt(x, 10));
    const mins = Math.max(0, eh * 60 + em - (sh * 60 + sm));
    return Math.round((mins / 60) * 100) / 100;
  }, [timeIn, timeOut]);

  // proof required?
  const needsProof = useMemo(
    () => type === "ot" || type === "remotework" || type === "wfh" || type === "rdot",
    [type]
  );

  // disable double submit
  const [submitting, setSubmitting] = useState(false);

  // ── load employee profile
  useEffect(() => {
    (async () => {
      setLoadingMe(true);
      try {
        const u = auth.currentUser;
        const email = u?.email?.toLowerCase() || "";
        if (!u?.uid || !email) {
          setMeEmp(null);
          return;
        }

        const qSnap = await getDocs(
          query(collection(db, "employees"), where("email", "==", email))
        );

        if (!qSnap.empty) {
          const d = qSnap.docs[0];
          const x = d.data() as any;
          setMeEmp({
            id: d.id,
            employeeId: x.employeeId || u.uid,
            name: x.name || u.displayName || "",
            email: (x.email || email).toLowerCase(),
            type: (x.type as EmpType) || "core",
            obRates: Array.isArray(x.obRates)
              ? x.obRates.map((r: any) => ({
                  category: String(r?.category || r?.role || r?.title || ""),
                  rate: Number(r?.rate ?? r?.amount ?? 0),
                }))
              : [],
          });
        } else {
          const empRef = doc(db, "employees", u.uid);
          await setDoc(empRef, {
            employeeId: u.uid,
            name: u.displayName || "",
            email,
            type: "core",
            obRates: [],
          });
          setMeEmp({
            id: u.uid,
            employeeId: u.uid,
            name: u.displayName || "",
            email,
            type: "core",
            obRates: [],
          });
        }
      } finally {
        setLoadingMe(false);
      }
    })();
  }, [auth]);

  // ── OB rate logic
  function suggestObRate(emp: MyEmployee, key: ObKey): { rate?: number; source?: string } {
    if (emp.type === "intern" && key === "assisted") {
      return { rate: 500, source: "fixed-intern-assisted" };
    }
    if (emp.type === "core" && key === "assisted") {
      return { rate: 1500, source: "fixed-core-assisted" };
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
    if (submitting) return;
    setSubmitting(true);

    try {
      if (!meEmp) {
        alert("Your employee record was not found. Please ensure your email is set on your employee profile.");
        return;
      }

      if (needsProof && !proofUrl.trim()) {
        alert("Proof of Approval is required for this request type.");
        return;
      }

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
          ...(type === "remotework" ? { location: location || undefined } : {}),
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

      await fetch("/api/sendEmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: [
            "jelynsonbattung@gmail.com",
            "hrfinance.instapost@gmail.com",
            "auquilang.instapost@gmail.com",
            "yana.instapost@gmail.com",
          ],
          subject: "📑 New Request Filed",
          html: `
            <p>A new <b>${type.toUpperCase()}</b> request has been filed by <b>${meEmp.name}</b>.</p>
            <p><b>Date:</b> ${date}<br/>
               <b>Type:</b> ${type.toUpperCase()}<br/>
               ${type === "ob" ? `<b>Title:</b> ${obTitle}<br/>` : ""}
               ${type === "ob" ? `<b>Category:</b> ${OB_LABEL[obCategoryKey]}<br/>` : ""}
               ${type === "ot" ? `<b>OT Hours:</b> ${otHours}<br/>` : ""}
               ${(type === "remotework" || type === "wfh" || type === "rdot") ? `<b>Hours:</b> ${workedHours}<br/>` : ""}
               <b>Location:</b> ${location || "—"}</p>
               <b>Proof:</b> ${proofUrl || "—"}</p>
               <b>Reason:</b> ${reason || "—"}</p>
            <p><a href="https://payflow-payroll.vercel.app/approvals">Review in Approvals</a></p>
          `,
        }),
      });

      setDate("");
      setReason("");
      setLocation("");
      setProofUrl("");
      setObTitle("");
      setObCategoryKey("assisted");
      setOtTimeout("");
      setTimeIn("");
      setTimeOut("");

      alert("Request submitted for admin approval.");
    } finally {
      setSubmitting(false);
    }
  }

  // ────────────────────────── UI ──────────────────────────
  if (loadingMe) {
    return (
      <div className="min-h-screen bg-gray-900 text-white pt-20 flex items-center justify-center">
        <div className="text-gray-300">Loading profile…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 rounded-2xl text-white pt-20 pb-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">File a Request</h1>
          <p className="text-gray-300 mt-2">
            File OB / OT / Leave / Remote Work requests. Admin approval is required.
          </p>
        </div>

        {/* ───────────── form only ───────────── */}
        <form
          onSubmit={submitRequest}
          className="rounded-2xl border border-white/10 bg-gray-800/40 p-6 space-y-6"
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
              {type === "remotework" && (
                <div>
                  <label className="lbl">Location</label>
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="inp"
                    required
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

          {/* SL / BL / VL */}
          {(type === "sl" || type === "bl" || type === "vl") && (
            <div className="text-sm text-gray-300">
              Leave request filed. (No proof link required.)
            </div>
          )}

          {/* Proof */}
          {needsProof && (
            <div>
              <label className="lbl">Proof of Approval (link)</label>
              <input
                placeholder="https://drive.google.com/… or image URL"
                value={proofUrl}
                onChange={(e) => setProofUrl(e.target.value)}
                className="inp"
                required
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-center pt-2">
            <button
              type="submit"
              className="px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-500"
              disabled={submitting}
            >
              Submit for Approval
            </button>
          </div>
        </form>
      </div>

      {/* tiny style helpers */}
      <style>{`
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
