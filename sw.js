// =============================================================
// Service Worker - ميزانيتك الذكية
// استراتيجية: Cache First للملفات الثابتة
// =============================================================

const CACHE_NAME = 'smart-budget-v5.1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './lang.json',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// تثبيت الـ SW وتخزين الملفات الأساسية
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching assets');
        return cache.addAll(ASSETS);
      })
      .then(() => {
        console.log('Service Worker: Assets cached');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('Service Worker: Cache install failed', error);
      })
  );
});

// تفعيل الـ SW وتنظيف الكاش القديم
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Service Worker: Removing old cache', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => {
      console.log('Service Worker: Activated and ready to handle requests');
      return self.clients.claim();
    })
  );
});

// استراتيجية Cache First مع سقوط للشبكة
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // تجاهل طلبات التحليلات أو طلبات غير GET
  if (request.method !== 'GET') {
    return;
  }

  // تجاهل طلبات Google APIs (oauth, drive)
  const url = new URL(request.url);
  if (url.hostname.includes('googleapis.com') || 
      url.hostname.includes('accounts.google.com') ||
      url.hostname.includes('gstatic.com')) {
    return;
  }

  // تجاهل طلبات Font Awesome أو أي CDN خارجي
  if (url.hostname.includes('cdnjs.cloudflare.com') ||
      url.hostname.includes('fonts.googleapis.com')) {
    return;
  }

  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        // إرجاع النسخة المخبأة إذا وجدت
        if (cachedResponse) {
          return cachedResponse;
        }

        // وإلا قم بجلبها من الشبكة وخزنها للاستخدام المستقبلي
        return fetch(request)
          .then((networkResponse) => {
            // تأكد من أن الاستجابة صالحة
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }

            // استنساخ الاستجابة لتخزينها وللإرجاع
            const responseToCache = networkResponse.clone();

            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(request, responseToCache);
              })
              .catch((error) => {
                console.warn('Service Worker: Failed to cache', request.url, error);
              });

            return networkResponse;
          })
          .catch(() => {
            // في حالة عدم وجود اتصال ولا كاش - نقدم صفحة الخطأ (اختياري)
            // يمكننا إرجاع صفحة fallback إذا كانت موجودة
            // ولكننا سنعيد استجابة بسيطة
            console.warn('Service Worker: Network failed and no cache for', request.url);
            // يمكنك إعادة صفحة مخصصة للخطأ إذا أردت
          });
      })
  );
});

// الاستماع لأي رسائل من التطبيق (مثلاً لتحديث الكاش)
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});