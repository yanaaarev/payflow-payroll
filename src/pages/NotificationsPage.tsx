import { useEffect, useMemo, useState } from "react";
import { getAuth } from "firebase/auth";
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase/firebase";

/* ========================= Types ========================= */
type NotifKind =
  | "request"      // updates for employee requests
  | "payslip"      // payslip ready
  | "budget"       // (if you ever want to notify a requester)
  | "draft"        // (rare: if addressed to an exec by UID)
  | "cashAdvance"  // CA approval/rejection
  | "system";

type Notification = {
  id: string;
  toUid?: string;
  toEmail?: string;       // should be lowercased when created
  kind: NotifKind;
  title: string;
  message?: string;
  refType?: "request" | "budget" | "payrollDraft" | "payslip" | "cashAdvance";
  refId?: string;
  link?: string;
  createdAt?: any;
  readBy?: string[];      // UIDs who already read
};

/* ========================= Utils ========================= */
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
function timeAgo(d?: any) {
  const t = toDate(d)?.getTime();
  if (!t) return "—";
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const dd = Math.floor(h / 24);
  return `${dd}d ago`;
}
function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function mergeUnique<T extends { id: string }>(arrs: T[][]) {
  const map = new Map<string, T>();
  for (const arr of arrs) for (const x of arr) map.set(x.id, x);
  return Array.from(map.values());
}

/* ========================= Safe FS helpers ========================= */
async function safeGetDocs<T = any>(q: any, label: string): Promise<T[]> {
  try {
    const s = await getDocs(q);
    const arr: T[] = [];
    s.forEach((d: any) => arr.push({ id: d.id, ...(d.data() as any) }));
    return arr;
  } catch (e) {
    console.warn(`[FS] getDocs failed: ${label}`, e);
    return [];
  }
}
async function safeUpdate(ref: any, data: any, label: string) {
  try {
    await updateDoc(ref, data);
    return true;
  } catch (e) {
    console.warn(`[FS] updateDoc failed: ${label}`, e);
    return false;
  }
}

/* ========================= Page ========================= */
export default function NotificationsPage() {
  const auth = getAuth();
  const me = auth.currentUser;
  const myEmail = (me?.email || "").toLowerCase();
  const myUid = me?.uid || "";

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Notification[]>([]);
  const [q, setQ] = useState("");

  /* ---------- Load personal notifications only ---------- */
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const list: Notification[][] = [];

        if (myUid) {
          const qUid = query(
            collection(db, "notifications"),
            where("toUid", "==", myUid),
            orderBy("createdAt", "desc"),
            fsLimit(300)
          );
          list.push(await safeGetDocs<Notification>(qUid, "notifications@toUid"));
        }

        if (myEmail) {
          const qEmail = query(
            collection(db, "notifications"),
            where("toEmail", "==", myEmail),
            orderBy("createdAt", "desc"),
            fsLimit(300)
          );
          list.push(await safeGetDocs<Notification>(qEmail, "notifications@toEmail"));
        }

        const merged = mergeUnique(list).sort(
          (a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0)
        );
        setItems(merged);
      } finally {
        setLoading(false);
      }
    })();
  }, [myUid, myEmail]);

  /* ---------- Derived ---------- */
  const ql = q.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      items.filter((n) => {
        if (!ql) return true;
        return `${n.title}|${n.message}|${n.kind}|${n.refType}|${n.refId}`.toLowerCase().includes(ql);
      }),
    [items, ql]
  );

  const unread = useMemo(() => items.filter((n) => !(n.readBy || []).includes(myUid)), [items, myUid]);

  /* ---------- Actions ---------- */
  async function markRead(n: Notification, read: boolean) {
    if (!n?.id || !myUid) return;
    const ref = doc(db, "notifications", n.id);
    const ok = await safeUpdate(
      ref,
      read ? { readBy: arrayUnion(myUid) } : { readBy: arrayRemove(myUid) },
      `notifications/${n.id}#markRead`
    );
    if (!ok) return;

    setItems((prev) =>
      prev.map((x) =>
        x.id === n.id
          ? {
              ...x,
              readBy: read
                ? Array.from(new Set([...(x.readBy || []), myUid]))
                : (x.readBy || []).filter((u) => u !== myUid),
            }
          : x
      )
    );
  }

  async function markAllRead() {
    for (const n of unread) await markRead(n, true);
  }

  /* ---------- UI ---------- */
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white pt-20 flex items-center justify-center">
        <div className="text-gray-300">Loading notifications…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white pt-20 pb-24">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Notifications</h1>
          <p className="text-gray-300">Direct updates for your account only.</p>
        </div>

        {/* Controls */}
        <div className="rounded-2xl border border-white/10 bg-gray-800/40 p-5">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[260px]">
              <input
                className="inp h-12 w-full"
                placeholder="Search notifications…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            <button
              onClick={markAllRead}
              disabled={unread.length === 0}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60"
            >
              Mark all as read
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-white/10 bg-gray-800/40 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10 text-lg font-semibold">My Notifications</div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/10">
              <thead className="bg-gray-800/60">
                <tr>
                  <Th>Type</Th>
                  <Th>Title</Th>
                  <Th>Message</Th>
                  <Th>Reference</Th>
                  <Th>When</Th>
                  <Th>Status</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 bg-gray-900/20">
                {filtered.length === 0 ? (
                  <tr>
                    <Td colSpan={7}>
                      <div className="py-8 text-center text-gray-400">
                        {q ? "No notifications match your search." : "No notifications yet."}
                      </div>
                    </Td>
                  </tr>
                ) : (
                  filtered.map((n) => {
                    const isRead = (n.readBy || []).includes(myUid);
                    const when = timeAgo(n.createdAt);
                    return (
                      <tr key={n.id} className="align-top">
                        <Td><KindBadge kind={n.kind} /></Td>
                        <Td className="font-medium">
                          <div className="flex items-start gap-2">
                            {!isRead && <span className="mt-1 h-2 w-2 rounded-full bg-blue-400" />}
                            <span>{n.title || "—"}</span>
                          </div>
                        </Td>
                        <Td className="max-w-[420px]">
                          {n.message ? (
                            <span title={n.message} className="text-gray-200 line-clamp-3">
                              {n.message}
                            </span>
                          ) : (
                            <span className="text-gray-500">—</span>
                          )}
                        </Td>
                        <Td>
                          {n.refType ? (
                            <span className="inline-flex items-center rounded-md bg-gray-800/60 px-2 py-1 text-xs">
                              {cap(n.refType)} {n.refId ? `· ${n.refId}` : ""}
                            </span>
                          ) : (
                            <span className="text-gray-500">—</span>
                          )}
                        </Td>
                        <Td>{when}</Td>
                        <Td>
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium border 
                              ${isRead
                                ? "bg-gray-700/40 text-gray-300 border-gray-500/30"
                                : "bg-amber-600/20 text-amber-300 border-amber-500/30"}`}
                          >
                            {isRead ? "Read" : "Unread"}
                          </span>
                        </Td>
                        <Td className="space-x-2">
                          {n.link && (
                            <a
                              href={n.link}
                              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm"
                            >
                              Open
                            </a>
                          )}
                          {isRead ? (
                            <button
                              onClick={() => markRead(n, false)}
                              className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm"
                            >
                              Mark unread
                            </button>
                          ) : (
                            <button
                              onClick={() => markRead(n, true)}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm"
                            >
                              Mark read
                            </button>
                          )}
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* styles */}
      <style>{`
        .inp {
          width: 100%;
          padding: 0.85rem 1rem;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 0.9rem;
          color: #fff;
          outline: none;
          appearance: none;
        }
        .inp:focus {
          box-shadow: 0 0 0 2px rgba(59,130,246,0.5);
          border-color: rgba(59,130,246,0.6);
        }
      `}</style>
    </div>
  );
}

/* ========================= Small UI Bits ========================= */
function KindBadge({ kind }: { kind: NotifKind }) {
  const map: Record<NotifKind, { cls: string; label: string }> = {
    request:     { cls: "bg-sky-600/20 text-sky-300 border border-sky-500/30", label: "Request" },
    payslip:     { cls: "bg-emerald-600/20 text-emerald-300 border border-emerald-500/30", label: "Payslip" },
    budget:      { cls: "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30", label: "Budget" },
    draft:       { cls: "bg-yellow-600/20 text-yellow-200 border border-yellow-500/30", label: "Payroll Draft" },
    cashAdvance: { cls: "bg-fuchsia-600/20 text-fuchsia-300 border border-fuchsia-500/30", label: "Cash Advance" },
    system:      { cls: "bg-gray-700/40 text-gray-300 border border-gray-500/30", label: "System" },
  };
  const v = map[kind] || map.system;
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${v.cls}`}>{v.label}</span>;
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-300 ${className}`}>
      {children}
    </th>
  );
}
function Td({
  children,
  className = "",
  colSpan,
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`px-4 py-3 align-middle ${className}`}>
      {children}
    </td>
  );
}
