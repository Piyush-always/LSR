// ===== FIREBASE CONFIGURATION =====
// TODO: Replace with your Firebase project config from:
// Firebase Console → Project Settings → General → Your apps → Web app → Config
const firebaseConfig = {
  apiKey: "AIzaSyCWO7pyjBVqiVq2VJYU-MV1C1YEVQjE8mE",
  authDomain: "laser-inv.firebaseapp.com",
  projectId: "laser-inv",
  storageBucket: "laser-inv.firebasestorage.app",
  messagingSenderId: "248030618131",
  appId: "1:248030618131:web:66e241ac7dc3f5846b95e6",
  measurementId: "G-V0FQ528MPK"
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
