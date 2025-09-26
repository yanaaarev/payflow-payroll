// src/pages/ViewingRequest.tsx
import { useEffect, useState } from "react";
import { db } from "../../firebase/firebase";
import { doc, getDoc } from "firebase/firestore";
import { useParams, useNavigate } from "react-router-dom";

type ReqType = "ob" | "ot" | "sl" | "bl" | "vl" | "remotework" | "wfh" | "rdot";
type ObKey = "assisted" | "videographer" | "talent";

const OB_LABEL: Record<ObKey, string> = {
  assisted: "Assisted",
  videographer: "Videographer",
  talent: "Talent",
};

type RequestDoc = {
  id: string;
  employeeName: string;
  filedBy: string;
  type: ReqType;
  status: string;
  details: any;
};

export default function ViewingRequest() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [request, setRequest] = useState<RequestDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "requests", id));
        if (snap.exists()) {
          const data = snap.data() as any;
          setRequest({
            id: snap.id,
            employeeName: data.employeeName,
            filedBy: data.filedBy,
            type: data.type,
            status: data.status,
            details: data.details || {},
          });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return <div className="p-10 text-center text-gray-400">Loading request…</div>;
  }

  if (!request) {
    return <div className="p-10 text-center text-red-400">Request not found.</div>;
  }

  const d = request.details || {};

  return (
    <div className="min-h-screen bg-gray-900 rounded-2xl text-white pt-20 pb-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold mb-6">Request Details</h1>

        <form className="rounded-2xl border border-white/10 bg-gray-800/40 p-6 space-y-6">
          {/* Shared */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="lbl">Employee</label>
              <input className="inp" value={request.employeeName} readOnly />
            </div>
            <div>
              <label className="lbl">Filed by</label>
              <input className="inp" value={request.filedBy} readOnly />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="lbl">Type</label>
              <input className="inp" value={request.type.toUpperCase()} readOnly />
            </div>
            <div>
              <label className="lbl">Date</label>
              <input className="inp" value={d.date || "—"} readOnly />
            </div>
          </div>

          {/* OB */}
          {request.type === "ob" && (
            <>
              <div>
                <label className="lbl">Name of Shoot/Event</label>
                <input className="inp" value={d.title || "—"} readOnly />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="lbl">Location</label>
                  <input className="inp" value={d.location || "—"} readOnly />
                </div>
                <div>
                  <label className="lbl">Category</label>
                  <input
                    className="inp"
                    value={d.categoryLabel || OB_LABEL[d.categoryKey as ObKey] || "—"}
                    readOnly
                  />
                </div>
              </div>
              {"suggestedRate" in d && (
                <div>
                  <label className="lbl">Rate</label>
                  <input
                    className="inp"
                    value={
                      typeof d.suggestedRate === "number"
                        ? `₱${Number(d.suggestedRate).toLocaleString()}`
                        : "—"
                    }
                    readOnly
                  />
                </div>
              )}
            </>
          )}

          {/* OT */}
          {request.type === "ot" && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="lbl">OT Start</label>
                  <input className="inp" value="17:30" readOnly />
                </div>
                <div>
                  <label className="lbl">Time Out</label>
                  <input className="inp" value={d.timeout || "—"} readOnly />
                </div>
                <div>
                  <label className="lbl">Computed Hours</label>
                  <input className="inp" value={Number(d.hours || 0).toFixed(2)} readOnly />
                </div>
              </div>
              <div>
                <label className="lbl">Reason</label>
                <textarea className="inp" value={d.reason || "—"} readOnly />
              </div>
            </>
          )}

          {/* Remote/WFH/RDOT */}
          {(request.type === "remotework" || request.type === "wfh" || request.type === "rdot") && (
            <>
              {request.type !== "rdot" && (
                <div>
                  <label className="lbl">Location</label>
                  <input className="inp" value={d.location || "—"} readOnly />
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="lbl">Time In</label>
                  <input className="inp" value={d.timeIn || "—"} readOnly />
                </div>
                <div>
                  <label className="lbl">Time Out</label>
                  <input className="inp" value={d.timeOut || "—"} readOnly />
                </div>
              </div>
              <div>
                <label className="lbl">Computed Hours</label>
                <input className="inp" value={Number(d.hours || 0).toFixed(2)} readOnly />
              </div>
              <div>
                <label className="lbl">Reason</label>
                <textarea className="inp" value={d.reason || "—"} readOnly />
              </div>
            </>
          )}

          {/* SL/BL/VL */}
          {(request.type === "sl" || request.type === "bl" || request.type === "vl") && (
            <div>
              <label className="lbl">Leave Type</label>
              <input className="inp" value={request.type.toUpperCase()} readOnly />
            </div>
          )}

          {/* Proof */}
        {d.proofUrl && (
          <div>
            <label className="lbl">Proof of Approval</label>
            <a
              href={
                d.proofUrl.startsWith("http://") || d.proofUrl.startsWith("https://")
                  ? d.proofUrl
                  : `https://${d.proofUrl}`
              }
              target="_blank"
              rel="noreferrer"
              className="text-blue-300 underline block"
            >
              View Proof
            </a>
          </div>
        )}

          <div className="flex justify-center pt-4">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="px-6 py-2 rounded-xl bg-gray-700 hover:bg-gray-600"
            >
              Back
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .inp {
          width: 100%;
          padding: 0.75rem 1rem;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 0.75rem;
          color: #fff;
          outline: none;
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
