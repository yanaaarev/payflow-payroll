import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../firebase/firebase";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  limit as fsLimit,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

/* =========================== Types =========================== */
type AuditLog = {
  id: string;

  // who
  actorUid?: string;
  actorEmail?: string;
  actorName?: string;
  actorRoles?: string[];

  // what/where
  action?: string;            // e.g. "payroll.publish", "employee.update", "request.approve"
  collection?: string;        // e.g. "employees", "payrollDrafts"
  docId?: string;             // target doc id
  targetPath?: string;        // optional: "employees/EMP001"

  // when
  ts?: any;                   // Firestore Timestamp or ISO string

  // context
  message?: string;           // optional human-friendly text
  ip?: string;
  ua?: string;

  // changes
  before?: any;               // snapshot before update (if captured)
  after?: any;                // snapshot after update (if captured)
  diff?: any;                 // optional precomputed diff
  extra?: any;                // anything else you log (cutoffLabel, draftId, etc.)
};

/* =========================== Utils =========================== */
function toDate(v: any): Date | null {
  try {
    if (!v) return null;
    if (typeof v?.toDate === "function") return v.toDate();
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}
function fmtDateTime(v: any) {
  const d = toDate(v);
  return d ? `${d.toLocaleDateString()} ${d.toLocaleTimeString()}` : "—";
}
function safeLower(s?: string) {
  return (s || "").toLowerCase();
}
function flattenForCsv(obj: any, prefix = ""): Record<string, any> {
  const out: Record<string, any> = {};
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        Object.assign(out, flattenForCsv(v, key));
      } else {
        out[key] = Array.isArray(v) ? JSON.stringify(v) : String(v ?? "");
      }
    }
  } else {
    out[prefix || ""] = String(obj ?? "");
  }
  return out;
}
function logsToCsv(logs: AuditLog[]) {
  // Choose a stable set of columns + flatten extras
  const baseCols = [
    "id",
    "ts",
    "actorEmail",
    "actorName",
    "actorUid",
    "actorRoles",
    "action",
    "collection",
    "docId",
    "targetPath",
    "message",
    "ip",
  ];
  const rows = logs.map((l) => {
    const row: Record<string, any> = {
      id: l.id,
      ts: fmtDateTime(l.ts),
      actorEmail: l.actorEmail || "",
      actorName: l.actorName || "",
      actorUid: l.actorUid || "",
      actorRoles: (l.actorRoles || []).join("|"),
      action: l.action || "",
      collection: l.collection || "",
      docId: l.docId || "",
      targetPath: l.targetPath || "",
      message: l.message || "",
      ip: l.ip || "",
    };
    // Attach flattened notable objects (kept short)
    const extraFlat = flattenForCsv(l.extra || {});
    for (const [k, v] of Object.entries(extraFlat)) {
      row[`extra.${k}`] = v;
    }
    return row;
  });

  // Collect headers
  const headersSet = new Set<string>(baseCols);
  rows.forEach((r) => Object.keys(r).forEach((k) => headersSet.add(k)));
  const headers = Array.from(headersSet.values());

  // Build CSV
  const esc = (val: any) => {
    const s = String(val ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [
    headers.map(esc).join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
  ];
  return new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
}

/* ======================== Main Component ======================== */
export default function AuditLogsPage() {
  const auth = getAuth();

  // live logs (latest first)
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  // filters
  const [q, setQ] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  // UI
  const [expanded, setExpanded] = useState<string | null>(null);
  const downloadRef = useRef<HTMLAnchorElement>(null);

  // subscribe
  useEffect(() => {
    setLoading(true);
    const qLogs = query(
      collection(db, "auditLogs"),
      orderBy("ts", "desc"),
      fsLimit(500) // adjust if needed
    );
    const unsub = onSnapshot(
      qLogs,
      (snap) => {
        const rows: AuditLog[] = [];
        snap.forEach((d) => rows.push({ id: d.id, ...(d.data() as any) }));
        setLogs(rows);
        setLoading(false);
      },
      (err) => {
        console.error("auditLogs subscribe error:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // derived: action list & actor list
  const distinctActions = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((l) => l.action && set.add(l.action));
    return Array.from(set.values()).sort();
  }, [logs]);

  const distinctActors = useMemo(() => {
    const map = new Map<string, string>(); // email -> label
    logs.forEach((l) => {
      const email = (l.actorEmail || "").toLowerCase();
      if (!email) return;
      const label = l.actorName ? `${l.actorName} <${email}>` : email;
      if (!map.has(email)) map.set(email, label);
    });
    return Array.from(map.entries())
      .map(([email, label]) => ({ email, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [logs]);

  // filter
  const filtered = useMemo(() => {
    const from = rangeFrom ? new Date(rangeFrom + "T00:00:00") : null;
    const to = rangeTo ? new Date(rangeTo + "T23:59:59") : null;

    const ql = safeLower(q);
    const actorL = safeLower(actorFilter);
    const actionL = safeLower(actionFilter);

    return logs.filter((l) => {
      // date range (client-side)
      const d = toDate(l.ts);
      if (from && d && d < from) return false;
      if (to && d && d > to) return false;

      // action filter
      if (actionL && safeLower(l.action) !== actionL) return false;

      // actor filter (by email or name)
      if (
        actorL &&
        !safeLower(l.actorEmail).includes(actorL) &&
        !safeLower(l.actorName).includes(actorL)
      ) {
        return false;
      }

      // free-text
      if (ql) {
        const hay =
          `${l.action}|${l.actorEmail}|${l.actorName}|${l.collection}|${l.docId}|${l.message}|${JSON.stringify(
            l.extra || {}
          )}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [logs, q, actionFilter, actorFilter, rangeFrom, rangeTo]);

  // quick stats
  const stats = useMemo(() => {
    const total = filtered.length;
    const actors = new Set(filtered.map((l) => (l.actorEmail || "").toLowerCase()).filter(Boolean)).size;
    const byAction = new Map<string, number>();
    filtered.forEach((l) => {
      const k = l.action || "—";
      byAction.set(k, (byAction.get(k) || 0) + 1);
    });
    const top = Array.from(byAction.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4);
    return { total, actors, top };
  }, [filtered]);

  // export CSV
  function exportCsv() {
    const blob = logsToCsv(filtered);
    const url = URL.createObjectURL(blob);
    const a = downloadRef.current!;
    a.href = url;
    a.download = `audit_logs_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // access hint (client-side guard — server rules still enforce)
  //@ts-ignore
  const roles = (auth.currentUser as any)?.stsTokenManager ? [] : [];
  // ^ You likely decorate the ID token with custom claims (roles). If you already read roles into context,
  //   you can gate the UI here. Server rules already restrict read to admin/finance.

  return (
    <div className="min-h-screen bg-gray-900 rounded-2xl text-white pt-20 pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Audit Logs</h1>
          <p className="text-gray-300 mt-1">
            Track important actions across payroll, requests, employees, and more. (Admin/Finance)
          </p>
        </div>

        {/* Filters */}
            <div className="rounded-2xl border border-white/10 bg-gray-800/40 p-5 mb-5">
            <div className="flex-1 mb-5">
                <label className="lbl">Search</label>
                <input
                    className="inp h-12 text-base"
                    placeholder="Search action, actor, message, collection…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                />
                </div>
            <div className="flex flex-col md:flex-row md:items-end gap-4">
            <div className="md:w-56">
              <label className="lbl">Action</label>
              <select
                className="inp select-gray"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
              >
                <option value="">All Actions</option>
                {distinctActions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:w-72">
              <label className="lbl">Employees</label>
              <select
                className="inp select-gray"
                value={actorFilter}
                onChange={(e) => setActorFilter(e.target.value)}
              >
                <option value="">All Employees</option>
                {distinctActors.map((a) => (
                  <option key={a.email} value={a.email}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:w-40">
              <label className="lbl">From</label>
              <input
                type="date"
                className="inp"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
              />
            </div>
            <div className="md:w-40">
              <label className="lbl">To</label>
              <input
                type="date"
                className="inp"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
              />
            </div>

            <div className="md:w-auto">
              <label className="lbl">&nbsp;</label>
              <button
                type="button"
                onClick={exportCsv}
                className="w-full px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500"
              >
                Export CSV
              </button>
              <a ref={downloadRef} href="/" className="hidden" />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
          <div className="rounded-xl border border-white/10 bg-gray-800/40 p-4">
            <div className="text-sm text-gray-400">Total Logs</div>
            <div className="text-2xl font-bold">{stats.total.toLocaleString()}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-gray-800/40 p-4">
            <div className="text-sm text-gray-400">Unique Actors</div>
            <div className="text-2xl font-bold">{stats.actors.toLocaleString()}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-gray-800/40 p-4">
            <div className="text-sm text-gray-400 mb-1">Top Actions</div>
            {stats.top.length === 0 ? (
              <div className="text-gray-400 text-sm">—</div>
            ) : (
              <ul className="text-sm space-y-1">
                {stats.top.map(([k, v]) => (
                  <li key={k} className="flex justify-between">
                    <span className="text-gray-300">{k}</span>
                    <span className="text-white">{v}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Table/List */}
        <div className="rounded-2xl border border-white/10 bg-gray-800/40 overflow-hidden">
          <div className="px-6 py-3 border-b border-white/10 text-sm text-gray-300 flex justify-between">
            <span>Showing {filtered.length.toLocaleString()} of {logs.length.toLocaleString()} logs</span>
            <span className="text-gray-400">Auto-updating</span>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-400">Loading logs…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-400">No logs match your filters.</div>
          ) : (
            <div className="divide-y divide-white/10">
              {filtered.map((l) => {
                const isOpen = expanded === l.id;
                return (
                  <div key={l.id} className="px-6 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 text-xs rounded-full bg-white/10 border border-white/20">
                            {l.action || "—"}
                          </span>
                          <span className="text-sm text-gray-300">
                            {l.collection || "—"}/{l.docId || "—"}
                          </span>
                        </div>
                        <div className="text-sm mt-1 text-gray-300">
                          <span className="text-white">{l.actorName || l.actorEmail || "—"}</span>
                          {l.actorRoles && l.actorRoles.length > 0 && (
                            <span className="ml-2 text-gray-400">
                              ({l.actorRoles.join(", ")})
                            </span>
                          )}
                          <span className="mx-2">•</span>
                          <span className="text-gray-400">{fmtDateTime(l.ts)}</span>
                        </div>
                        {l.message && (
                          <div className="text-sm text-gray-300 mt-1">{l.message}</div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {l.ip && <span className="text-xs text-gray-400">IP: {l.ip}</span>}
                        <button
                          onClick={() => setExpanded(isOpen ? null : l.id)}
                          className="px-3 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
                        >
                          {isOpen ? "Hide Details" : "View Details"}
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-4">
                        <KeyVal label="Target Path" value={l.targetPath || "—"} />
                        <KeyVal label="User Agent" value={l.ua || "—"} />
                        {(l.extra && Object.keys(l.extra).length > 0) && (
                          <JsonBlock label="Extra" value={l.extra} />
                        )}
                        {(l.diff && Object.keys(l.diff).length > 0) ? (
                          <JsonBlock label="Diff" value={l.diff} />
                        ) : (
                          <>
                            {l.before && <JsonBlock label="Before" value={l.before} />}
                            {l.after && <JsonBlock label="After" value={l.after} />}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* tiny style helpers to match your app */}
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

/* ======================= Small UI Atoms ======================= */
function KeyVal({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm text-gray-300">
      {label}: <span className="text-white break-all">{value}</span>
    </div>
  );
}
function JsonBlock({ label, value }: { label: string; value: any }) {
  return (
    <div className="mt-2">
      <div className="text-sm text-gray-300 mb-1">{label}:</div>
      <pre className="text-xs text-white/90 bg-gray-900/80 border border-white/10 rounded-lg p-3 overflow-auto">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
