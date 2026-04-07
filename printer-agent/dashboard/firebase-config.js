// ===== FIREBASE CONFIGURATION =====
// Same config as the main website
const firebaseConfig = {
    apiKey: "AIzaSyCWO7pyjBVqiVq2VJYU-MV1C1YEVQjE8mE",
    authDomain: "laser-inv.firebaseapp.com",
    projectId: "laser-inv",
    storageBucket: "laser-inv.firebasestorage.app",
    messagingSenderId: "248030618131",
    appId: "1:248030618131:web:66e241ac7dc3f5846b95e6",
    measurementId: "G-V0FQ528MPK"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
