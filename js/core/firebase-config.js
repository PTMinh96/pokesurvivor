/* ============ firebase-config.js — connect to your Firebase project ============
 * Paste your Firebase web app configuration here (Firebase Console >
 * Project settings > Your apps > SDK setup and configuration > Config).
 * Full instructions are in docs/FIREBASE.md.
 *
 * This data is NOT secret: Firebase is designed for these values to be public
 * on the web. Firestore rules (firestore.rules) protect game saves.
 *
 * If set to null, the game runs in local mode (browser only).
 */
// pokesurvivor-free project (since 2026-10-12): standard Firebase Authentication,
// WITHOUT Identity Platform, so accounts remain free and unlimited. Never click
// "Upgrade to Identity Platform" in the console! (The old project was pokesurvivor-jpter.)
G.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAOHSLwJp3Fi7KNc_eF-lqZOn6ZmP44tjQ",
  authDomain: "my-pokesurvivor-firebase.firebaseapp.com",
  projectId: "my-pokesurvivor-firebase",
  storageBucket: "my-pokesurvivor-firebase.firebasestorage.app",
  messagingSenderId: "650773021358",
  appId: "1:650773021358:web:eb00a772dec30f5839e33f",
  databaseURL: 'https://my-pokesurvivor-firebase-default-rtdb.asia-southeast1.firebasedatabase.app'
};

/* Example configuration:
G.FIREBASE_CONFIG = {
  apiKey: 'AIza...',
  authDomain: 'tu-proyecto.firebaseapp.com',
  projectId: 'tu-proyecto',
  storageBucket: 'tu-proyecto.firebasestorage.app',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abc123'
};
*/
