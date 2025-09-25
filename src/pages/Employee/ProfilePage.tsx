import { useEffect, useMemo, useState } from "react";
import {
  EmailAuthProvider,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  updateEmail as fbUpdateEmail,
  updatePassword as fbUpdatePassword,
  updateProfile as fbUpdateProfile,
} from "firebase/auth";
import type { User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase/firebase";

/* ========================= Types ========================= */
type SaveStatus = "idle" | "saving" | "success" | "error";

type EmployeeDoc = {
  id: string;
  name?: string;   // authoritative display name for employees
  email?: string;
  updatedAt?: any;
  updatedBy?: string;
};

/* ========================= Safe FS helpers ========================= */
async function safeGetDoc<T = any>(ref: any, label: string): Promise<T | null> {
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as any) } as T;
  } catch (e) {
    console.warn(`[FS] getDoc failed: ${label}`, e);
    return null;
  }
}
async function safeSet(ref: any, data: any, label: string) {
  try {
    await setDoc(ref, data, { merge: true });
    return true;
  } catch (e) {
    console.warn(`[FS] setDoc failed: ${label}`, e);
    return false;
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
export default function ProfilePage() {
  const auth = getAuth();

  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [loading, setLoading] = useState(true);

  // Authoritative employee doc
  const [empDoc, setEmpDoc] = useState<EmployeeDoc | null>(null);

  // Form fields (always derived from employees doc first)
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  // Password change (optional)
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  // UI state
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string>("");

  const myUid = user?.uid || "";
  //@ts-ignore
  const myEmail = (user?.email || "").toLowerCase();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, [auth]);

  // Load employee doc FIRST and use it as the source of truth for name/email
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        if (!user) return;

        const empRef = doc(db, "employees", user.uid);
        const emp = await safeGetDoc<EmployeeDoc>(empRef, `employees/${user.uid}`);
        setEmpDoc(emp);

        const nameFromEmployees = emp?.name ?? "";
        const emailFromEmployees = emp?.email ?? "";

        // Prefer employees doc field; fall back to Auth if missing.
        setName(nameFromEmployees || user.displayName || "");
        setEmail(emailFromEmployees || user.email || "");
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const canSave = useMemo(() => {
    if (!user) return false;
    if (status === "saving") return false;

    const baseName = empDoc?.name ?? user.displayName ?? "";
    const baseEmail = empDoc?.email ?? user.email ?? "";

    const changingName = (name || "") !== (baseName || "");
    const changingEmail = (email.trim() || "") !== (baseEmail || "");
    const changingPw = newPw.length > 0 || confirmPw.length > 0;

    if (changingPw && (!currentPw || newPw !== confirmPw || newPw.length < 6)) return false;

    return changingName || changingEmail || changingPw;
  }, [user, empDoc, name, email, currentPw, newPw, confirmPw, status]);

  async function handleSave() {
    if (!user) return;
    setStatus("saving");
    setMessage("");

    try {
      // Determine if we need re-auth (email/password)
      const baseEmail = empDoc?.email ?? user.email ?? "";
      const wantsEmailChange = email.trim() && email.trim() !== baseEmail;
      const wantsPwChange = newPw.length > 0;

      if ((wantsEmailChange || wantsPwChange) && user.email) {
        if (!currentPw) {
          setStatus("error");
          setMessage("Please enter your current password to change email or password.");
          return;
        }
        const cred = EmailAuthProvider.credential(user.email, currentPw);
        await reauthenticateWithCredential(user, cred);
      }

      // Update Firebase Auth displayName only if name changed
      const baseName = empDoc?.name ?? user.displayName ?? "";
      const wantsNameChange = (name || "") !== (baseName || "");
      if (wantsNameChange) {
        await fbUpdateProfile(user, { displayName: name || "" });
      }

      // Update Firebase Auth email if changed (we still mirror to employees below)
      if (wantsEmailChange) {
        await fbUpdateEmail(user, email.trim());
      }

      // Update password if requested
      if (wantsPwChange) {
        if (newPw !== confirmPw) {
          setStatus("error");
          setMessage("New password and confirmation do not match.");
          return;
        }
        if (newPw.length < 6) {
          setStatus("error");
          setMessage("Password must be at least 6 characters.");
          return;
        }
        await fbUpdatePassword(user, newPw);
      }

      // Mirror to Firestore: employees/{uid} (authoritative for name/email)
      const empRef = doc(db, "employees", user.uid);
      const payload = {
        name: name || null,
        email: email ? email.toLowerCase() : null,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      };

      // Try update; if blocked or doc doesn't exist, set merge
      const okUpdate = await safeUpdate(empRef, payload, `employees/${user.uid}`);
      if (!okUpdate) {
        await safeSet(empRef, payload, `employees/${user.uid} [merge]`);
      }

      // Refresh in-memory employees doc to reflect saved changes
      setEmpDoc((prev) => ({
        id: myUid,
        ...(prev || {}),
        name: payload.name ?? undefined,
        email: payload.email ?? undefined,
        updatedAt: payload.updatedAt,
        updatedBy: payload.updatedBy,
      }));

      setStatus("success");
      setMessage("Profile updated successfully.");
      // Clear password fields
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (e: any) {
      console.warn("[Profile] save failed:", e);
      setStatus("error");
      const code = e?.code || "";
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setMessage("Current password is incorrect.");
      } else if (code === "auth/requires-recent-login") {
        setMessage("Please re-login and try again (security requirement).");
      } else if (code === "auth/email-already-in-use") {
        setMessage("That email is already in use by another account.");
      } else if (code === "auth/invalid-email") {
        setMessage("Please enter a valid email.");
      } else if (code === "permission-denied") {
        setMessage("Auth updated, but Firestore write was blocked by rules.");
      } else {
        setMessage(e?.message || "Failed to update profile.");
      }
    } finally {
      setStatus((s) => (s === "saving" ? "idle" : s));
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white pt-20 flex items-center justify-center">
        <div className="text-gray-300">Loading profile…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-900 text-white pt-20 px-4">
        <div className="max-w-xl mx-auto text-center space-y-3">
          <h1 className="text-2xl font-bold">Not signed in</h1>
          <p className="text-gray-300">Please sign in to view your profile.</p>
        </div>
      </div>
    );
  }

  // Labels for visibility: show where values are sourced from
  const nameSource = empDoc?.name ? "employees" : "auth";
  const emailSource = empDoc?.email ? "employees" : "auth";

  return (
    <div className="min-h-screen bg-gray-900 text-white pt-20 pb-24">
      <div className="max-w-xl mx-auto px-4 space-y-8">
        <header className="space-y-2 text-center">
          <h1 className="text-3xl font-bold">My Profile</h1>
          <p className="text-gray-300">Update your name, email, and password.</p>
        </header>

        <div className="rounded-2xl border border-white/10 bg-gray-800/40 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10 text-lg font-semibold">
            Profile Details
          </div>

          <div className="p-6 space-y-5">
            <Field>
              <div className="flex items-center justify-between">
                <Label>Name</Label>
                <SourcePill label={nameSource} />
              </div>
              <input
                className="inp h-11"
                placeholder="Your full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Hint>We display the name from your employees record.</Hint>
            </Field>

            <Field>
              <div className="flex items-center justify-between">
                <Label>Email</Label>
                <SourcePill label={emailSource} />
              </div>
              <input
                className="inp h-11"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Hint>Changing email may require your current password.</Hint>
            </Field>

            <div className="grid gap-4">
              <Field>
                <Label>Current Password (required if changing email or password)</Label>
                <input
                  className="inp h-11"
                  type="password"
                  placeholder="••••••••"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                />
              </Field>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field>
                  <Label>New Password</Label>
                  <input
                    className="inp h-11"
                    type="password"
                    placeholder="New password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                  />
                </Field>
                <Field>
                  <Label>Confirm New Password</Label>
                  <input
                    className="inp h-11"
                    type="password"
                    placeholder="Confirm new password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                  />
                </Field>
              </div>
              <Hint>Leave password fields blank if you’re not changing your password.</Hint>
            </div>

            {message && (
              <div
                className={`rounded-lg px-3 py-2 text-sm ${
                  status === "success"
                    ? "bg-emerald-600/20 text-emerald-200 border border-emerald-500/30"
                    : status === "error"
                    ? "bg-rose-600/20 text-rose-200 border border-rose-500/30"
                    : "bg-gray-700/40 text-gray-200 border border-gray-500/30"
                }`}
              >
                {message}
              </div>
            )}

            <div className="pt-2">
              <button
                onClick={handleSave}
                disabled={!canSave}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60"
              >
                {status === "saving" ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>

        <div className="text-xs text-gray-400">
          Name and email are mirrored to <code>employees/{myUid}</code> and also kept in Firebase Auth.
        </div>
      </div>

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
function Field({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}
function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-sm text-gray-200">{children}</label>;
}
function Hint({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-gray-400">{children}</div>;
}
function SourcePill({ label }: { label: "employees" | "auth" }) {
  const style =
    label === "employees"
      ? "bg-sky-600/20 text-sky-200 border border-sky-500/30"
      : "bg-gray-700/40 text-gray-200 border border-gray-500/30";
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] ${style}`}>
      from {label}
    </span>
  );
}
