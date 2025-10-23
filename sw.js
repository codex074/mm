const CACHE_NAME = 'money-tracker-cache-v1';
const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// Event 'install': ติดตั้ง Service Worker และทำการแคชไฟล์
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] Pre-caching offline files');
        return cache.addAll(FILES_TO_CACHE);
      })
  );
  self.skipWaiting();
});

// Event 'activate': จัดการแคชเก่าเมื่อมีการอัปเดต Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[ServiceWorker] Removing old cache', key);
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

// Event 'fetch': ดักจับ request และตอบกลับด้วยข้อมูลจากแคชก่อน (Cache-First)
self.addEventListener('fetch', (event) => {
    // ไม่แคช request ที่ไปยัง Firebase Firestore เพื่อให้ข้อมูลอัปเดตเสมอ
    if (event.request.url.includes('firestore.googleapis.com')) {
        return;
    }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // ถ้าเจอในแคช, ส่งข้อมูลจากแคชกลับไปเลย
        if (response) {
          return response;
        }
        // ถ้าไม่เจอ, ให้ไปดึงจาก network ตามปกติ แล้วแคชไว้เผื่อใช้ครั้งหน้า
        return fetch(event.request).then(
            (response) => {
                // ตรวจสอบว่า response ถูกต้องหรือไม่
                if(!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }
                const responseToCache = response.clone();
                caches.open(CACHE_NAME)
                    .then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                return response;
            }
        );
      })
  );
});