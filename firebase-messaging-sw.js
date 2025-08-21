// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBAKTPpU7RsfqIrOrp9o98JnCL-RbUVWNs",
  authDomain: "capstone-996a3.firebaseapp.com",
  projectId: "capstone-996a3",
  storageBucket: "capstone-996a3.firebasestorage.app",
  messagingSenderId: "297091452987",
  appId: "1:297091452987:web:a68ccf7b53b6b69d80cc1e",
  databaseURL: "https://capstone-996a3-default-rtdb.firebaseio.com/"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  const notification = payload.notification || {};
  self.registration.showNotification(notification.title || 'SwineCare Alert', {
    body: notification.body || '',
    icon: '/icon192.png'
  });
});
