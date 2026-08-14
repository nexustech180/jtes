// Cloudflare Worker entry point (unified Workers + static assets model).
//
// This project is set up as a "Workers" project (not classic Pages), so the
// functions/ directory auto-routing convention does NOT apply here — Cloudflare
// needs one explicit entry point (this file) that decides what to do with every
// request. For anything other than the /api/* routes below, we just hand the
// request to the static asset server (your HTML/CSS/JS files). The /api/*
// routes run Composio → Google Drive logic server-side, so the Composio API
// key never ships to the browser.
//
// Routes:
//   POST /api/drive-upload  — upload a new file from the admin's computer into Drive
//   POST /api/drive-list    — search/list files already in the connected Drive
//   POST /api/drive-share   — set an existing Drive file to "anyone with link can view"
//   POST /api/place-order   — validate cart stock server-side, decrement it, and write
//                             the order — sales.html no longer writes orders to Firebase
//                             directly. Used for the Cash on Delivery payment method.
//   POST /api/paystack-prepare — validates the cart the same way, stashes a pending
//                             order under a fresh reference (stock is NOT touched yet),
//                             and returns the trusted amount for the Paystack popup to
//                             charge. Used for the "Pay Now" payment method.
//   POST /api/paystack-verify  — confirms the transaction with Paystack itself (never
//                             trusts the client's "it succeeded" claim), then completes
//                             the same stock-decrement + order-write flow as Cash on
//                             Delivery, using the pending order stashed by
//                             /api/paystack-prepare rather than anything in this request.
//   GET  /api/integration-status — reports which server-side secrets are actually set
//                             (booleans only, never the values), so admin.html's
//                             Settings tab can show real "Configured"/"Not confirmed"
//                             status instead of a client-side guess.
//
// ── ONE-TIME SETUP ──
//
// 1. Composio (composio.dev):
//    a. Create an account, add the "Google Drive" toolkit, click Connect, and sign in
//       with the Google account whose Drive should receive uploads.
//    b. Complete the OAuth sign-in to create a real Connected Account (not just an
//       Auth Config), then copy that Connected Account's ID.
//    c. Copy your Composio API key (Settings → API Keys).
//    d. (Optional) Open the target Drive folder in a browser and copy the folder ID
//       from the URL — the part after /folders/.
//
// 2. Cloudflare dashboard → this Worker → Settings → Variables and secrets, add:
//      COMPOSIO_API_KEY              (type: Secret)
//      COMPOSIO_CONNECTED_ACCOUNT_ID
//      DRIVE_FOLDER_ID               (optional — omit to upload into Drive root)
//      COMPOSIO_ENTITY_ID            (optional — Composio's "user ID" for the
//                                      connected account; defaults to 'default',
//                                      which is correct unless you set up your
//                                      own multi-user entity IDs in Composio)
//      ADMIN_API_TOKEN               (type: Secret — required. A random shared
//                                      value. admin.html sends it as the
//                                      X-Admin-Token header on every /api/drive-*
//                                      request; requests without a match are
//                                      rejected with 401 before touching Composio.
//                                      Generate one with e.g. `openssl rand -hex 32`.
//                                      NOTE: because admin.html is a static page,
//                                      this token ships in its JS source just like
//                                      ADMIN_PASS already does — it stops
//                                      anonymous/automated hits on this URL, not a
//                                      determined attacker reading the page source.
//                                      Real protection requires a real backend;
//                                      see the platform rebuild plan.)
//      PAYSTACK_SECRET_KEY           (type: Secret — required for online store
//                                      checkout. From the Paystack dashboard
//                                      (Settings → API Keys & Webhooks). Starts
//                                      with sk_test_ or sk_live_. NEVER put this
//                                      in wrangler.jsonc or any file that ships
//                                      to the browser — sales.html only ever
//                                      gets the separate *public* key, which is
//                                      safe to expose. Set with:
//                                        wrangler secret put PAYSTACK_SECRET_KEY)
//
// 3. wrangler.jsonc (in this same repo root) tells Cloudflare to use this file as
//    the Worker's entry point and to serve everything else as static assets.
//
// 4. This Worker now serves admin.html/article.html on a *different* site
//    (see ADMIN_ORIGIN below) than the one this file is deployed on. Update
//    ADMIN_ORIGIN to that site's real URL once it's deployed — CORS is
//    scoped to exactly that one origin, not a wildcard.
//
// ── HEADS UP ──
// Composio's exact response shapes for GOOGLEDRIVE_UPLOAD_FILE and
// GOOGLEDRIVE_FIND_FILE weren't fully visible in their public docs at the time
// this was written. The field-name fallbacks below (findFileId, findFileList)
// cover the shapes seen in their docs/examples, but if a request fails, check
// the `details` field in the error response (or the request log in your
// Composio dashboard) to see the actual shape Composio returned, and adjust
// these functions / the request body fields to match.

const EXECUTE_URL = 'https://backend.composio.dev/api/v3/tools/execute/GOOGLEDRIVE_UPLOAD_FILE';
const FIND_FILE_URL = 'https://backend.composio.dev/api/v3/tools/execute/GOOGLEDRIVE_FIND_FILE';
const SHARE_TOOL_URL = 'https://backend.composio.dev/api/v3/tools/execute/GOOGLEDRIVE_ADD_FILE_SHARING_PREFERENCE';
const CREATE_PERMISSION_URL = 'https://backend.composio.dev/api/v3/tools/execute/GOOGLEDRIVE_CREATE_PERMISSION';
const PROXY_URL = 'https://backend.composio.dev/api/v3/tools/execute/proxy';
const DEFAULT_ENTITY_ID = 'pg-test-d637f137-c0cc-49ba-a207-3d4d6a37397e';
const DEFAULT_CONNECTED_ACCOUNT_ID = 'ca_4PfensM4N3iK';

// admin.html/article.html now live on their own site, not this one — see
// jtes_admin (deployed at https://jtes-admin.jassan.workers.dev).
const ADMIN_ORIGIN = 'https://jtes-admin.jassan.workers.dev';

// Same Firebase RTDB the client-side pages already talk to directly for
// content/store/orders reads. It has no write auth configured (matches the
// rest of this codebase's documented "no real backend yet" posture), so this
// Worker doesn't need a credential to use it either — it's just doing the
// stock check and the order write in one place instead of leaving both to
// client-side trust.
const STORE_DB_URL = 'https://jtes-website-default-rtdb.firebaseio.com';

const PAYSTACK_API = 'https://api.paystack.co';

const DRIVE_API_PATHS = ['/api/drive-upload', '/api/drive-list', '/api/drive-share'];

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ADMIN_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
    'Vary': 'Origin'
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const isDriveApi = DRIVE_API_PATHS.includes(url.pathname);

    // Preflight for the cross-origin POSTs admin.html now makes.
    if (isDriveApi && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (isDriveApi && request.method === 'POST') {
      if (!env.ADMIN_API_TOKEN) {
        return jsonResponse({ error: 'Server is missing ADMIN_API_TOKEN env var.' }, 500);
      }
      if (request.headers.get('X-Admin-Token') !== env.ADMIN_API_TOKEN) {
        return jsonResponse({ error: 'Missing or invalid X-Admin-Token header.' }, 401);
      }
      if (url.pathname === '/api/drive-upload') return handleDriveUpload(request, env);
      if (url.pathname === '/api/drive-list') return handleDriveList(request, env);
      if (url.pathname === '/api/drive-share') return handleDriveShare(request, env);
    }
    if (url.pathname === '/api/place-order' && request.method === 'POST') {
      return handlePlaceOrder(request, env);
    }
    if (url.pathname === '/api/paystack-prepare' && request.method === 'POST') {
      return handlePaystackPrepare(request, env);
    }
    if (url.pathname === '/api/paystack-verify' && request.method === 'POST') {
      return handlePaystackVerify(request, env);
    }
    if (url.pathname === '/api/integration-status' && request.method === 'GET') {
      return jsonResponse({
        paystackConfigured: !!env.PAYSTACK_SECRET_KEY,
        adminApiConfigured: !!env.ADMIN_API_TOKEN,
        composioConfigured: !!env.COMPOSIO_API_KEY
      });
    }
    if (url.pathname === '/api/debug-composio' && request.method === 'GET') {
      return handleDebugComposio(request, env);
    }
    if (url.pathname === '/api/debug-share' && request.method === 'GET') {
      return handleDebugShare(request, env);
    }

    // Everything else: serve the static site as normal.
    return env.ASSETS.fetch(request);
  }
};

// Places a store order server-side: validates each cart item against the
// product's current `stock` field (products that don't track stock are
// treated as unlimited, matching sales.html's own "In stock" display logic
// for products with no stock value), decrements stock for the ones that do,
// and only then writes the order record. Replaces the old flow where
// sales.html wrote straight to Firebase with no stock check at all.
//
// NOTE — this is read-check-write over two plain REST calls, not a Firebase
// transaction, so two orders racing for the last unit of the same product
// within milliseconds of each other could both pass validation. Given this
// project's current traffic and the fact nothing else here is transactional
// either, that's an accepted gap, not an oversight — a real fix would need
// Firebase's transaction/ETag support or a move off client-writable RTDB.
async function handlePlaceOrder(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const name    = (body.name || '').trim();
  const phone   = (body.phone || '').trim();
  const email   = (body.email || '').trim();
  const address = (body.address || '').trim();
  const region  = body.region || '';
  const payment = body.payment || '';
  const notes   = (body.notes || '').trim();
  const items   = Array.isArray(body.items) ? body.items : [];

  if (!name)    return jsonResponse({ error: 'Full name is required.' }, 400);
  if (!phone)   return jsonResponse({ error: 'Phone number is required.' }, 400);
  if (!address) return jsonResponse({ error: 'Delivery address is required.' }, 400);
  if (!items.length) return jsonResponse({ error: 'Cart is empty.' }, 400);

  const validation = await validateCartAgainstCatalog(items);
  if (validation.error) return jsonResponse(validation.error, validation.status);

  const result = await reserveStockAndWriteOrder(validation.items, validation.products, {
    name: name, phone: phone, email: email, address: address,
    region: region, payment: payment, notes: notes, paymentStatus: 'Unpaid'
  });
  if (result.error) return jsonResponse(result.error, result.status);

  return jsonResponse({ order: result.order });
}

// Shared by /api/place-order, /api/paystack-prepare and /api/paystack-verify:
// checks each cart item against the product's current `stock` field
// (products with no stock value are treated as unlimited, matching
// sales.html's own "In stock" display logic), and always trusts the
// catalog's price over whatever the client sent — a tampered request could
// otherwise submit a real product at a fabricated price.
async function validateCartAgainstCatalog(items) {
  for (const it of items) {
    if (!it || !it.id || !it.name || typeof it.price !== 'number' || !(it.qty > 0)) {
      return { error: { error: 'Cart contains an invalid item — please refresh and try again.' }, status: 400 };
    }
  }

  let products;
  try {
    const res = await fetch(STORE_DB_URL + '/store/products.json');
    const val = await res.json();
    products = val ? (Array.isArray(val) ? val : Object.values(val)) : [];
  } catch (err) {
    return { error: { error: 'Could not check product availability. Please try again.' }, status: 502 };
  }

  const productById = {};
  products.forEach(function(p) { if (p && p.id) productById[p.id] = p; });

  const issues = [];
  const validatedItems = items.map(function(it) {
    const p = productById[it.id];
    if (!p) { issues.push({ id: it.id, name: it.name, reason: 'no_longer_available' }); return it; }
    if (typeof p.stock === 'number' && p.stock < it.qty) {
      issues.push({ id: it.id, name: it.name, reason: 'insufficient_stock', available: p.stock, requested: it.qty });
    }
    return Object.assign({}, it, { price: typeof p.price === 'number' ? p.price : it.price });
  });
  if (issues.length) {
    return { error: { error: 'Some items in your cart are no longer available in the requested quantity.', issues: issues }, status: 409 };
  }

  const total = validatedItems.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
  return { items: validatedItems, products: products, total: total };
}

// Shared by /api/place-order and /api/paystack-verify: decrements stock for
// the validated items and writes the final order record.
//
// NOTE — this is read-check-write over two plain REST calls, not a Firebase
// transaction, so two orders racing for the last unit of the same product
// within milliseconds of each other could both pass validation. Given this
// project's current traffic and the fact nothing else here is transactional
// either, that's an accepted gap, not an oversight — a real fix would need
// Firebase's transaction/ETag support or a move off client-writable RTDB.
async function reserveStockAndWriteOrder(validatedItems, products, orderFields) {
  const updatedProducts = products.map(function(p) {
    const it = validatedItems.find(function(i) { return i.id === p.id; });
    if (it && typeof p.stock === 'number') {
      return Object.assign({}, p, { stock: Math.max(0, p.stock - it.qty) });
    }
    return p;
  });

  try {
    await fetch(STORE_DB_URL + '/store/products.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedProducts)
    });
  } catch (err) {
    return { error: { error: 'Could not reserve stock. Please try again.' }, status: 502 };
  }

  const itemsText = validatedItems.map(function(i) { return i.name + ' x' + i.qty + ' = GHS ' + (i.price * i.qty).toFixed(2); }).join('; ');
  const total = validatedItems.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
  const order = Object.assign({
    id: 'ORD-' + Date.now(), date: new Date().toISOString(),
    items: itemsText, total: 'GHS ' + total.toFixed(2), status: 'Pending'
  }, orderFields);

  try {
    await fetch(STORE_DB_URL + '/store/orders.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order)
    });
  } catch (err) {
    return { error: { error: 'Stock was reserved but the order could not be saved. Please contact us directly.' }, status: 502 };
  }

  return { order: order };
}

// Step 1 of the Paystack flow: validate the cart, compute a trusted total,
// and stash it under a fresh reference in Firebase (NOT yet a real order —
// stock isn't touched until /api/paystack-verify confirms real payment).
// The client uses the returned amount+reference to open the Paystack popup.
async function handlePaystackPrepare(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const name    = (body.name || '').trim();
  const phone   = (body.phone || '').trim();
  const email   = (body.email || '').trim();
  const address = (body.address || '').trim();
  const region  = body.region || '';
  const notes   = (body.notes || '').trim();
  const items   = Array.isArray(body.items) ? body.items : [];

  if (!name)    return jsonResponse({ error: 'Full name is required.' }, 400);
  if (!phone)   return jsonResponse({ error: 'Phone number is required.' }, 400);
  if (!email || !email.includes('@')) return jsonResponse({ error: 'A valid email is required for online payment.' }, 400);
  if (!address) return jsonResponse({ error: 'Delivery address is required.' }, 400);
  if (!items.length) return jsonResponse({ error: 'Cart is empty.' }, 400);

  const validation = await validateCartAgainstCatalog(items);
  if (validation.error) return jsonResponse(validation.error, validation.status);

  const reference = 'PSK-' + Date.now();
  const pending = {
    reference: reference, name: name, phone: phone, email: email, address: address,
    region: region, notes: notes, items: validation.items, total: validation.total,
    createdAt: new Date().toISOString()
  };

  try {
    await fetch(STORE_DB_URL + '/store/pendingPayments/' + reference + '.json', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending)
    });
  } catch (err) {
    return jsonResponse({ error: 'Could not start the payment session. Please try again.' }, 502);
  }

  return jsonResponse({ reference: reference, amount: Math.round(validation.total * 100), email: email });
}

// Step 2 of the Paystack flow: confirms the transaction with Paystack's own
// API using the secret key (never trusts the client's success callback by
// itself — that callback only tells the browser to ask us to check), checks
// the paid amount matches what was locked in at prepare-time, then reserves
// stock and writes the real order using the pending record's own data —
// nothing from this request body except the reference is trusted.
async function handlePaystackVerify(request, env) {
  if (!env.PAYSTACK_SECRET_KEY) {
    return jsonResponse({ error: 'Server is missing PAYSTACK_SECRET_KEY env var.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }
  const reference = (body.reference || '').trim();
  if (!reference) return jsonResponse({ error: 'Missing payment reference.' }, 400);

  let pending;
  try {
    const res = await fetch(STORE_DB_URL + '/store/pendingPayments/' + reference + '.json');
    pending = await res.json();
  } catch (err) {
    return jsonResponse({ error: 'Could not look up this payment session. Please contact us directly.' }, 502);
  }
  if (!pending) {
    return jsonResponse({ error: 'This payment has already been processed, or the session expired. If you were charged, please contact us with your reference: ' + reference }, 409);
  }

  let verifyResult;
  try {
    const verifyRes = await fetch(PAYSTACK_API + '/transaction/verify/' + encodeURIComponent(reference), {
      headers: { 'Authorization': 'Bearer ' + env.PAYSTACK_SECRET_KEY }
    });
    verifyResult = await verifyRes.json();
  } catch (err) {
    return jsonResponse({ error: 'Could not confirm payment with Paystack. Please try again.' }, 502);
  }

  const txn = verifyResult && verifyResult.data;
  if (!verifyResult || !verifyResult.status || !txn || txn.status !== 'success') {
    return jsonResponse({ error: 'Payment was not successful.', details: verifyResult && verifyResult.message }, 402);
  }

  const expectedPesewas = Math.round(pending.total * 100);
  if (txn.amount !== expectedPesewas) {
    return jsonResponse({ error: 'Payment amount does not match the order total. Please contact us with your reference: ' + reference }, 402);
  }

  // Re-check stock only (not price — the customer already paid the total
  // that was locked in at /api/paystack-prepare time; if a listed price
  // changed in the few minutes since, that's not the paying customer's
  // problem to absorb after the fact).
  const stockCheck = await validateCartAgainstCatalog(pending.items);
  if (stockCheck.error) {
    return jsonResponse({ error: 'Payment was confirmed, but stock changed before the order could be completed. Please contact us with your reference: ' + reference + ' — you may be due a refund.', details: stockCheck.error }, 409);
  }

  const result = await reserveStockAndWriteOrder(pending.items, stockCheck.products, {
    name: pending.name, phone: pending.phone, email: pending.email, address: pending.address,
    region: pending.region, payment: 'Paystack', notes: pending.notes,
    paymentStatus: 'Paid', paymentReference: reference
  });
  if (result.error) return jsonResponse(result.error, result.status);

  try {
    await fetch(STORE_DB_URL + '/store/pendingPayments/' + reference + '.json', { method: 'DELETE' });
  } catch (err) { /* order already placed; a leftover pending record is harmless */ }

  return jsonResponse({ order: result.order });
}

async function handleDriveUpload(request, env) {
  if (!env.COMPOSIO_API_KEY) {
    return jsonResponse({ error: 'Server is missing COMPOSIO_API_KEY env var.' }, 500);
  }

  let file;
  try {
    const formData = await request.formData();
    file = formData.get('file');
  } catch (err) {
    return jsonResponse({ error: 'Could not read uploaded file.', details: String(err) }, 400);
  }
  if (!file || typeof file.arrayBuffer !== 'function') {
    return jsonResponse({ error: 'No file provided.' }, 400);
  }

  try {
    const base64 = arrayBufferToBase64(await file.arrayBuffer());

    const uploadArgs = {
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      file_to_upload: base64
    };
    if (env.DRIVE_FOLDER_ID) uploadArgs.parents = [env.DRIVE_FOLDER_ID];

    const uploadRes = await fetch(EXECUTE_URL, {
      method: 'POST',
      headers: { 'x-api-key': env.COMPOSIO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_id: env.COMPOSIO_ENTITY_ID || 'pg-test-d637f137-c0cc-49ba-a207-3d4d6a37397e',
        arguments: uploadArgs
      })
    });
    const uploadResult = await uploadRes.json();

    if (!uploadRes.ok) {
      return jsonResponse({ error: 'Composio upload request failed.', details: uploadResult }, 502);
    }

    const fileId = findFileId(uploadResult);
    if (!fileId) {
      return jsonResponse({ error: 'Upload may have succeeded but no file ID was found in the response — see details and check your Composio dashboard logs.', details: uploadResult }, 502);
    }

    const shareResult = await setFilePublic(fileId, env);
    if (!shareResult.ok) {
      return jsonResponse({
        name: file.name,
        url: `https://drive.google.com/file/d/${fileId}/view`,
        fileId,
        warning: 'File uploaded but setting public sharing failed — you may need to share it manually.',
        reason: shareResult.reason,
        details: shareResult.details
      });
    }

    return jsonResponse({
      name: file.name,
      url: `https://drive.google.com/file/d/${fileId}/view`,
      fileId
    });
  } catch (err) {
    return jsonResponse({ error: 'Unexpected error during Drive upload.', details: String(err) }, 500);
  }
}

// List/search the connected Drive for an existing file — used by the
// "Pick from Drive" tab so the admin doesn't have to re-upload a file
// that's already sitting in their Drive.
async function handleDriveList(request, env) {
  if (!env.COMPOSIO_API_KEY) {
    return jsonResponse({ error: 'Server is missing COMPOSIO_API_KEY env var.' }, 500);
  }

  let query = '';
  try {
    const body = await request.json();
    query = (body && body.query || '').trim();
  } catch (err) { /* empty query is fine — lists recent files */ }

  var qParts = ["trashed = false", "mimeType != 'application/vnd.google-apps.folder'"];
  if (query) qParts.push("name contains '" + query.replace(/'/g, "\\'") + "'");

  try {
    const listRes = await fetch(FIND_FILE_URL, {
      method: 'POST',
      headers: { 'x-api-key': env.COMPOSIO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_id: env.COMPOSIO_ENTITY_ID || 'pg-test-d637f137-c0cc-49ba-a207-3d4d6a37397e',
        arguments: {
          q: qParts.join(' and '),
          pageSize: 100,
          orderBy: 'modifiedTime desc'
        }
      })
    });
    const listResult = await listRes.json();

    if (!listRes.ok) {
      return jsonResponse({ error: 'Composio search request failed.', details: listResult }, 502);
    }

    const files = findFileList(listResult);
    if (!files) {
      return jsonResponse({ error: 'Search may have succeeded but no file list was found in the response — see details.', details: listResult }, 502);
    }

    return jsonResponse({ files: files.map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType })) });
  } catch (err) {
    return jsonResponse({ error: 'Unexpected error during Drive search.', details: String(err) }, 500);
  }
}

// Set an existing Drive file (picked via /api/drive-list) to "anyone with link
// can view" and return its share URL.
async function handleDriveShare(request, env) {
  if (!env.COMPOSIO_API_KEY) {
    return jsonResponse({ error: 'Server is missing COMPOSIO_API_KEY env var.' }, 500);
  }

  let fileId, name;
  try {
    const body = await request.json();
    fileId = body.fileId;
    name = body.name;
  } catch (err) {
    return jsonResponse({ error: 'Invalid request body.', details: String(err) }, 400);
  }
  if (!fileId) return jsonResponse({ error: 'Missing fileId.' }, 400);

  const shareResult = await setFilePublic(fileId, env);
  if (!shareResult.ok) {
    return jsonResponse({ error: 'Could not set sharing on that file.', reason: shareResult.reason, details: shareResult.details }, 502);
  }

  return jsonResponse({ name: name || '', url: `https://drive.google.com/file/d/${fileId}/view`, fileId });
}

// Make a Drive file viewable by anyone with the link. Composio has renamed its
// sharing tool across toolkit versions (ADD_FILE_SHARING_PREFERENCE is
// deprecated in favor of CREATE_PERMISSION), so try both, then fall back to a
// direct Drive API call through Composio's proxy — which resolves the stored
// OAuth token via connected_account_id, not entityId. On failure, return every
// attempt's response plus a human-readable `reason` so the admin UI can show
// what actually went wrong (e.g. "you don't own this file").
async function setFilePublic(fileId, env) {
  const entityId = env.COMPOSIO_ENTITY_ID || DEFAULT_ENTITY_ID;
  const attempts = {};

  const toolCalls = [
    { key: 'addSharingPreference', url: SHARE_TOOL_URL, args: { file_id: fileId, role: 'reader', type: 'anyone' } },
    { key: 'createPermission', url: CREATE_PERMISSION_URL, args: { fileId: fileId, role: 'reader', type: 'anyone' } }
  ];
  for (const call of toolCalls) {
    try {
      const res = await fetch(call.url, {
        method: 'POST',
        headers: { 'x-api-key': env.COMPOSIO_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_id: entityId, arguments: call.args })
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result?.successful !== false && !result?.error) return { ok: true };
      attempts[call.key] = result;
    } catch (err) {
      attempts[call.key] = String(err);
    }
  }

  try {
    const permRes = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'x-api-key': env.COMPOSIO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connected_account_id: env.COMPOSIO_CONNECTED_ACCOUNT_ID || DEFAULT_CONNECTED_ACCOUNT_ID,
        endpoint: `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
        method: 'POST',
        body: { role: 'reader', type: 'anyone' }
      })
    });
    const permResult = await permRes.json().catch(() => ({}));
    const proxiedStatus = permResult?.data?.status_code ?? permResult?.data?.statusCode;
    if (permRes.ok && permResult?.successful !== false && !permResult?.error && !(proxiedStatus >= 400)) {
      return { ok: true };
    }
    attempts.proxy = permResult;
  } catch (err) {
    attempts.proxy = String(err);
  }

  return { ok: false, details: attempts, reason: readableShareError(attempts) };
}

// Pull the most useful human-readable message out of the pile of attempt
// responses (Composio wraps errors differently per endpoint, and Google's own
// errors are nested under data/error.message).
function readableShareError(attempts) {
  const messages = [];
  for (const key of Object.keys(attempts)) {
    const msg = extractErrorMessage(attempts[key]);
    if (msg && messages.indexOf(msg) === -1) messages.push(msg);
  }
  return messages.join(' | ').slice(0, 400);
}

function extractErrorMessage(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 200);
  const err = value.error ?? value.data?.error ?? value.data?.body?.error;
  if (typeof err === 'string') return err.slice(0, 200);
  if (err && typeof err === 'object') {
    return String(err.message || err.reason || JSON.stringify(err)).slice(0, 200);
  }
  if (value.message) return String(value.message).slice(0, 200);
  return '';
}

// Composio's response envelope wasn't fully confirmed for GOOGLEDRIVE_FIND_FILE —
// try the shapes most commonly seen in their docs/examples, in order.
function findFileList(result) {
  return (
    result?.data?.files ||
    result?.data?.response_data?.files ||
    result?.response_data?.files ||
    result?.files ||
    null
  );
}

function findFileId(result) {
  return (
    result?.data?.response_data?.id ||
    result?.data?.id ||
    result?.response_data?.id ||
    result?.id ||
    null
  );
}

// Browser-friendly debugging for the share flow: open
//   /api/debug-share?q=<search term>   (shares the first matching file)
// or
//   /api/debug-share?fileId=<drive file id>
// in a normal browser tab and it prints the full response from every share
// attempt as readable JSON — no dev tools needed. Note: if an attempt
// succeeds, the file really is set to "anyone with link can view".
async function handleDebugShare(request, env) {
  if (!env.COMPOSIO_API_KEY) {
    return jsonResponse({ error: 'Server is missing COMPOSIO_API_KEY env var.' }, 500);
  }

  const url = new URL(request.url);
  let fileId = url.searchParams.get('fileId');
  let fileName = '';

  if (!fileId) {
    const q = (url.searchParams.get('q') || '').trim();
    const qParts = ["trashed = false", "mimeType != 'application/vnd.google-apps.folder'"];
    if (q) qParts.push("name contains '" + q.replace(/'/g, "\\'") + "'");
    const listRes = await fetch(FIND_FILE_URL, {
      method: 'POST',
      headers: { 'x-api-key': env.COMPOSIO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_id: env.COMPOSIO_ENTITY_ID || DEFAULT_ENTITY_ID,
        arguments: { q: qParts.join(' and '), pageSize: 5, orderBy: 'modifiedTime desc' }
      })
    });
    const listResult = await listRes.json().catch(() => ({}));
    const files = findFileList(listResult);
    if (!files || !files.length) {
      return prettyJsonResponse({ debugVersion: 3, step: 'find-file', error: 'No file found for that search.', listStatus: listRes.status, listResult }, 200);
    }
    fileId = files[0].id;
    fileName = files[0].name;
  }

  const result = await setFilePublic(fileId, env);
  return prettyJsonResponse({
    debugVersion: 3,
    fileId,
    fileName,
    shared: result.ok,
    url: result.ok ? `https://drive.google.com/file/d/${fileId}/view` : undefined,
    reason: result.reason,
    attempts: result.details
  }, 200);
}

async function handleDebugComposio(request, env) {
  if (!env.COMPOSIO_API_KEY) {
    return jsonResponse({ error: 'Missing COMPOSIO_API_KEY' }, 500);
  }
  const accountId = env.COMPOSIO_CONNECTED_ACCOUNT_ID || 'ca_4PfensM4N3iK';
  const res = await fetch(`https://backend.composio.dev/api/v3/connected_accounts/${accountId}`, {
    headers: { 'x-api-key': env.COMPOSIO_API_KEY, 'Content-Type': 'application/json' }
  });
  const data = await res.json();
  return jsonResponse({ status: res.status, account: data });
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders())
  });
}

// Pretty-printed so the debug endpoints are readable straight in a browser tab.
function prettyJsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
