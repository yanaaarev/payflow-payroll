import { useEffect, useMemo, useState } from "react";
import {
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  EmailAuthProvider,
  updateEmail as fbUpdateEmail,
  updateProfile as fbUpdateProfile,
  sendPasswordResetEmail,
} from "firebase/auth";
import type { User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase/firebase";

/* ========================= Types ========================= */
type SaveStatus = "idle" | "saving" | "success" | "error";

type EmployeeDoc = {
  id: string;
  name?: string;
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

  // Form fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  // UI state
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string>("");

  const myUid = user?.uid || "";

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, [auth]);

  // Load employee doc FIRST
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

    return changingName || changingEmail;
  }, [user, empDoc, name, email, status]);

  async function handleSave() {
    if (!user) return;
    setStatus("saving");
    setMessage("");

    try {
      const baseEmail = empDoc?.email ?? user.email ?? "";
      const wantsEmailChange = email.trim() && email.trim() !== baseEmail;

      if (wantsEmailChange && user.email) {
        const cred = EmailAuthProvider.credential(user.email, prompt("Enter your current password") || "");
        await reauthenticateWithCredential(user, cred);
      }

      const baseName = empDoc?.name ?? user.displayName ?? "";
      const wantsNameChange = (name || "") !== (baseName || "");
      if (wantsNameChange) {
        await fbUpdateProfile(user, { displayName: name || "" });
      }

      if (wantsEmailChange) {
        await fbUpdateEmail(user, email.trim());
      }

      const empRef = doc(db, "employees", user.uid);
      const payload = {
        name: name || null,
        email: email ? email.toLowerCase() : null,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      };

      const okUpdate = await safeUpdate(empRef, payload, `employees/${user.uid}`);
      if (!okUpdate) {
        await safeSet(empRef, payload, `employees/${user.uid} [merge]`);
      }

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
      } else {
        setMessage(e?.message || "Failed to update profile.");
      }
    } finally {
      setStatus((s) => (s === "saving" ? "idle" : s));
    }
  }

  async function handleResetPassword() {
    if (!user?.email) return;
    try {
      await sendPasswordResetEmail(auth, user.email);
      setStatus("success");
      setMessage(`Password reset link sent to ${user.email}`);
    } catch (e: any) {
      console.error("Reset password failed", e);
      setStatus("error");
      setMessage("Failed to send reset email. Please try again later.");
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 rounded-2xl text-white pt-20 flex items-center justify-center">
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

  const nameSource = empDoc?.name ? "employees" : "auth";
  const emailSource = empDoc?.email ? "employees" : "auth";

  return (
    <div className="min-h-screen bg-gray-900 text-white pt-20 pb-24">
      <div className="max-w-xl mx-auto px-4 space-y-8">
        <header className="space-y-2 text-center">
          <h1 className="text-3xl font-bold">My Profile</h1>
          <p className="text-gray-300">Update your name, email, and reset your password.</p>
        </header>

        <div className="rounded-2xl border border-white/10 bg-gray-800/40 overflow-hidden">
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-white/10 text-lg font-semibold">
            Profile Details
          </div>

          <div className="p-4 sm:p-6 space-y-5">
            <Field>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2">
                <Label>Name</Label>
                <SourcePill label={nameSource} />
              </div>
              <input
                className="inp h-11 w-full"
                placeholder="Your full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <Field>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2">
                <Label>Email</Label>
                <SourcePill label={emailSource} />
              </div>
              <input
                className="inp h-11 w-full"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>

            <Field>
              <Label>Password</Label>
              <button
                onClick={handleResetPassword}
                className="text-sm text-blue-400 hover:text-blue-300 underline"
              >
                Send password reset link to {user.email}
              </button>
            </Field>

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
                className="w-full sm:w-auto px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60"
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
