import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';


// Your web app's Firebase configuration
export const firebaseConfig = {
  apiKey: "AIzaSyBwHTER1cyrAhijf_JfmwET2YmP03zIJhc",
  authDomain: "payflow-payroll-cb0f0.firebaseapp.com",
  projectId: "payflow-payroll-cb0f0",
  storageBucket: "payflow-payroll-cb0f0.firebasestorage.app",
  messagingSenderId: "804811267814",
  appId: "1:804811267814:web:630b2300d3533d516c6527"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);

// Optional: Confirm it's working
console.log('✅ Firebase initialized:', app.name);