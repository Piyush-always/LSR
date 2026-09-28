// ===== FIREBASE CONFIGURATION =====
// TODO: Replace with your Firebase project config from:
// Firebase Console → Project Settings → General → Your apps → Web app → Config
const firebaseConfig = {
  apiKey: "AIzaSyCSeM1HYc52r103T-KVd9oq9nFn1cy7xSU",
  authDomain: "laser-keychain-official.firebaseapp.com",
  projectId: "laser-keychain-official",
  storageBucket: "laser-keychain-official.firebasestorage.app",
  messagingSenderId: "424856013952",
  appId: "1:424856013952:web:c402b6818957a2731eea65",
  measurementId: "G-2GME8XMK2J"
};


// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize Cloud Functions
const functions = firebase.functions();
window.functions = functions;

// Initialize Firestore (used for live queue indicator on the success screen)
const db = firebase.firestore();
window.db = db;

// Initialize Cloud Storage (used to upload keychain images for image orders)
const storage = firebase.storage();
window.storage = storage;

// Initialize Firebase Auth
const auth = firebase.auth();
window.auth = auth;

// Uncomment the line below to use Firebase emulator during local development
// functions.useEmulator("localhost", 5001);

