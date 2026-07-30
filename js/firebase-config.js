// ===== FIREBASE CONFIGURATION =====
// TODO: Replace with your Firebase project config from:
// Firebase Console → Project Settings → General → Your apps → Web app → Config
const firebaseConfig = {
  authDomain: "laser-keychain-official.firebaseapp.com",
  projectId: "laser-keychain-official",
  storageBucket: "laser-keychain-official.firebasestorage.app",
  messagingSenderId: "424856013952",
};


// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize Cloud Functions
const functions = firebase.functions();

// Initialize Firestore (used for live queue indicator on the success screen)
const db = firebase.firestore();

// Initialize Cloud Storage (used to upload keychain images for image orders)
const storage = firebase.storage();

// Uncomment the line below to use Firebase emulator during local development
// functions.useEmulator("localhost", 5001);
