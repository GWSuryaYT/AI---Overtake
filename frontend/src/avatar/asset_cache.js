/**
 * Project Anna - IndexedDB 3D Asset Cache
 * 
 * Caches VRM model (/models/avatar.vrm) and Mixamo FBX animations (/animations/*.fbx)
 * directly in the browser's native IndexedDB.
 * Subsequent visits load 3D assets in <200ms without consuming mobile data.
 */

const DB_NAME = 'AnnaAssetCache_v1';
const STORE_NAME = 'assets';
const DB_VERSION = 1;

let dbPromise = null;

function openCacheDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) {
            console.warn('[AssetCache] IndexedDB not supported on this platform. Bypassing cache.');
            return resolve(null);
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };

        request.onerror = (event) => {
            console.warn('[AssetCache] IndexedDB open error:', event.target.error);
            resolve(null);
        };
    });

    return dbPromise;
}

/**
 * Retrieves a cached Blob for a given URL, or fetches from the network and saves it.
 * Returns an Object URL (blob:...) that can be passed directly to GLTFLoader or FBXLoader.
 * 
 * @param {string} url - Asset URL (e.g. '/models/avatar.vrm' or '/animations/Idle.fbx')
 * @returns {Promise<string>} An Object URL or original URL fallback
 */
export async function getCachedAssetUrl(url) {
    try {
        const db = await openCacheDB();
        if (!db) {
            return url;
        }

        // 1. Check if asset exists in IndexedDB
        const cachedBlob = await new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.get(url);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            } catch (e) {
                resolve(null);
            }
        });

        if (cachedBlob && cachedBlob instanceof Blob) {
            console.log(`⚡ [AssetCache] Loaded from IndexedDB: ${url} (${(cachedBlob.size / 1024 / 1024).toFixed(2)} MB)`);
            return URL.createObjectURL(cachedBlob);
        }

        // 2. Fetch from network
        console.log(`🌐 [AssetCache] Downloading & caching: ${url}`);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        }

        const blob = await response.blob();

        // 3. Save into IndexedDB asynchronously
        try {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.put(blob, url);
        } catch (saveErr) {
            console.warn('[AssetCache] Failed to write asset to IndexedDB:', saveErr);
        }

        return URL.createObjectURL(blob);
    } catch (err) {
        console.warn(`[AssetCache] Fallback to direct URL for ${url}:`, err);
        return url;
    }
}

/**
 * Clears cached assets to allow force refreshes
 */
export async function clearAssetCache() {
    try {
        const db = await openCacheDB();
        if (!db) return;
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        console.log('[AssetCache] Cache cleared successfully.');
    } catch (e) {
        console.error('[AssetCache] Clear cache error:', e);
    }
}
