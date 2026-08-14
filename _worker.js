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
//   POST /api/paystack-webhook — Paystack calls this directly on payment events, so
//                             an order still gets completed even if the customer
//                             closes the tab before /api/paystack-verify's client
//                             callback runs. Verifies the x-paystack-signature
//                             header before trusting anything in the payload.
//                             Configure it in the Paystack dashboard under
//                             Settings → API Keys & Webhooks as:
//                               https://<this-worker's-domain>/api/paystack-webhook
//   POST /api/portal-login   — real, server-verified Client Portal login. Checks the
//                             submitted password against a salted SHA-256 hash (never
//                             a plaintext compare), rate-limits repeated failures per
//                             username, and issues a signed, expiring session token.
//   GET  /api/portal-data    — returns the authenticated client's own documents,
//                             progress and phone — requires a valid Bearer token from
//                             /api/portal-login.
//   GET  /api/portal-requests — same auth, returns the client's own project/service/
//                             design requests (matched by their stored phone number).
//   GET  /api/portal-chat    — same auth, returns the client's own chat thread.
//   POST /api/portal-chat-send — same auth, posts a message as that client — the
//                             'from' field is always forced to 'client' server-side,
//                             so a client can no longer forge a message that looks
//                             like it came from admin.
//   POST /api/portal-feedback-send — same auth, submits feedback as that client —
//                             the 'from' field comes from the verified token, not the
//                             request body, so a client can't submit feedback under
//                             another client's name.
//   GET  /api/portal-feedback — same auth, returns only the feedback/ticket entries
//                             that client submitted (with type + admin-set status) —
//                             the workaround this session used for a full Support
//                             Tickets module.
//                             See the "CLIENT PORTAL AUTH" comment block further down
//                             this file for the full design and its one disclosed
//                             limitation (no Firebase Security Rules access from here).
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
//                                      with sk_test_ or sk_live_. Used both to
//                                      call Paystack's verify API and to check
//                                      the webhook signature — same key, two
//                                      jobs. NEVER put this in wrangler.jsonc or
//                                      any file that ships to the browser —
//                                      sales.html only ever gets the separate
//                                      *public* key, which is safe to expose.
//                                      Set with:
//                                        wrangler secret put PAYSTACK_SECRET_KEY)
//      PORTAL_SESSION_SECRET         (type: Secret — required for Client Portal
//                                      login. Signs the session tokens issued by
//                                      /api/portal-login; anyone who had this value
//                                      could forge a valid session for any portal
//                                      username, so treat it like a password. Not
//                                      used to hash portal account passwords
//                                      themselves — those are salted per-account in
//                                      admin.html, no shared secret needed for that
//                                      part. Set with:
//                                        wrangler secret put PORTAL_SESSION_SECRET
//                                      e.g. using a value from `openssl rand -hex 32`.)
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
    if (url.pathname === '/api/paystack-webhook' && request.method === 'POST') {
      return handlePaystackWebhook(request, env);
    }
    if (url.pathname === '/api/integration-status' && request.method === 'GET') {
      return jsonResponse({
        paystackConfigured: !!env.PAYSTACK_SECRET_KEY,
        adminApiConfigured: !!env.ADMIN_API_TOKEN,
        composioConfigured: !!env.COMPOSIO_API_KEY,
        portalAuthConfigured: !!env.PORTAL_SESSION_SECRET
      });
    }
    if (url.pathname === '/api/portal-login' && request.method === 'POST') {
      return handlePortalLogin(request, env);
    }
    if (url.pathname === '/api/portal-data' && request.method === 'GET') {
      return handlePortalData(request, env);
    }
    if (url.pathname === '/api/portal-requests' && request.method === 'GET') {
      return handlePortalRequests(request, env);
    }
    if (url.pathname === '/api/portal-chat' && request.method === 'GET') {
      return handlePortalChatGet(request, env);
    }
    if (url.pathname === '/api/portal-chat-send' && request.method === 'POST') {
      return handlePortalChatSend(request, env);
    }
    if (url.pathname === '/api/portal-feedback-send' && request.method === 'POST') {
      return handlePortalFeedbackSend(request, env);
    }
    if (url.pathname === '/api/portal-feedback' && request.method === 'GET') {
      return handlePortalFeedbackGet(request, env);
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

// Shared by /api/paystack-verify (client-triggered, right after the popup
// closes) and /api/paystack-webhook (Paystack-triggered, fires even if the
// customer closed the tab before the client callback ran). Both need the
// exact same "confirm with Paystack, then reserve stock and write the
// order" logic — the only difference is who calls it and when.
//
// Idempotent by construction: the pending record is deleted the moment the
// order is written, so a second call for the same reference (client retry,
// webhook redelivery, or the client and the webhook both landing) always
// finds no pending record and reports alreadyProcessed instead of writing
// a second order or double-decrementing stock.
async function completePaystackPayment(reference, env) {
  let pending;
  try {
    const res = await fetch(STORE_DB_URL + '/store/pendingPayments/' + reference + '.json');
    pending = await res.json();
  } catch (err) {
    return { error: { error: 'Could not look up this payment session. Please contact us directly.' }, status: 502 };
  }
  if (!pending) {
    return { alreadyProcessed: true };
  }

  let verifyResult;
  try {
    const verifyRes = await fetch(PAYSTACK_API + '/transaction/verify/' + encodeURIComponent(reference), {
      headers: { 'Authorization': 'Bearer ' + env.PAYSTACK_SECRET_KEY }
    });
    verifyResult = await verifyRes.json();
  } catch (err) {
    return { error: { error: 'Could not confirm payment with Paystack. Please try again.' }, status: 502 };
  }

  const txn = verifyResult && verifyResult.data;
  if (!verifyResult || !verifyResult.status || !txn || txn.status !== 'success') {
    return { error: { error: 'Payment was not successful.', details: verifyResult && verifyResult.message }, status: 402 };
  }

  const expectedPesewas = Math.round(pending.total * 100);
  if (txn.amount !== expectedPesewas) {
    return { error: { error: 'Payment amount does not match the order total. Please contact us with your reference: ' + reference }, status: 402 };
  }

  // Re-check stock only (not price — the customer already paid the total
  // that was locked in at /api/paystack-prepare time; if a listed price
  // changed in the few minutes since, that's not the paying customer's
  // problem to absorb after the fact).
  const stockCheck = await validateCartAgainstCatalog(pending.items);
  if (stockCheck.error) {
    return { error: { error: 'Payment was confirmed, but stock changed before the order could be completed. Please contact us with your reference: ' + reference + ' — you may be due a refund.', details: stockCheck.error }, status: 409 };
  }

  const result = await reserveStockAndWriteOrder(pending.items, stockCheck.products, {
    name: pending.name, phone: pending.phone, email: pending.email, address: pending.address,
    region: pending.region, payment: 'Paystack', notes: pending.notes,
    paymentStatus: 'Paid', paymentReference: reference
  });
  if (result.error) return result;

  try {
    await fetch(STORE_DB_URL + '/store/pendingPayments/' + reference + '.json', { method: 'DELETE' });
  } catch (err) { /* order already placed; a leftover pending record is harmless */ }

  return { order: result.order };
}

// Step 2 of the Paystack flow: the client calls this right after the popup
// reports success. Never trusts that callback by itself — it only tells the
// browser to ask us to check — so this confirms with Paystack server-to-
// server before reserving stock and writing the real order.
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

  const result = await completePaystackPayment(reference, env);
  if (result.alreadyProcessed) {
    return jsonResponse({ error: 'This payment has already been processed, or the session expired. If you were charged, please contact us with your reference: ' + reference }, 409);
  }
  if (result.error) return jsonResponse(result.error, result.status);
  return jsonResponse({ order: result.order });
}

// Verifies Paystack's webhook signature: HMAC-SHA512 of the raw request
// body, keyed with the same secret used to talk to Paystack's API, hex-
// encoded and compared against the x-paystack-signature header. This is
// the only thing that proves a webhook call actually came from Paystack —
// without it, anyone who guessed this URL could fabricate "payment
// succeeded" events.
async function verifyPaystackSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const hex = Array.from(new Uint8Array(sigBuffer)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  return hex === signatureHeader;
}

// Catches payments the client-triggered /api/paystack-verify never got to
// run for — e.g. the customer paid successfully but closed the tab before
// the popup's callback fired. Configure this URL as the webhook in the
// Paystack dashboard (Settings → API Keys & Webhooks) so Paystack calls it
// directly; completePaystackPayment() is the same idempotent logic either
// path uses, so a customer who triggers both the client callback and the
// webhook still only gets one order.
async function handlePaystackWebhook(request, env) {
  if (!env.PAYSTACK_SECRET_KEY) return new Response('Server is missing PAYSTACK_SECRET_KEY env var.', { status: 500 });

  const rawBody = await request.text();
  const signature = request.headers.get('x-paystack-signature');
  const valid = await verifyPaystackSignature(rawBody, signature, env.PAYSTACK_SECRET_KEY);
  if (!valid) return new Response('Invalid signature.', { status: 401 });

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    return new Response('Invalid JSON.', { status: 400 });
  }

  // Best-effort event log — a failure here should never block processing
  // the payment itself.
  try {
    await fetch(STORE_DB_URL + '/store/paystackWebhookLog.json', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: event.event, reference: event.data && event.data.reference,
        receivedAt: new Date().toISOString()
      })
    });
  } catch (err) { /* logging is best-effort */ }

  if (event.event === 'charge.success' && event.data && event.data.reference) {
    await completePaystackPayment(event.data.reference, env);
  }

  // Always 200 once the signature checks out — Paystack retries on
  // non-2xx, and outcomes like "already processed" or "stock changed"
  // aren't something a retry would fix.
  return new Response('OK', { status: 200 });
}

// ═══════════════════════════════════════════════════════════════════════
//  CLIENT PORTAL AUTH — real, admin-set login instead of a shared
//  client-side password compare.
//
//  What this actually buys over the old model: previously portal.html
//  fetched portalAccounts/{username}.json directly (plaintext password
//  included) and compared it in the browser — anyone who knew or guessed
//  a username could read that account's password, documents and chat
//  straight from Firebase's open REST API without ever logging in. Now:
//   - passwords are salted + SHA-256 hashed before they're ever stored
//     (admin.html hashes on create/reset; the plaintext is shown to the
//     admin exactly once and never stored anywhere)
//   - login is verified here, server-side, against the hash
//   - a signed, expiring session token is issued on success (HMAC-SHA256
//     keyed with PORTAL_SESSION_SECRET) and portal.html uses it as a
//     Bearer token on every subsequent request
//   - every portal data route below re-verifies that token and only ever
//     returns/accepts data for the username it was issued to
//
//  Residual limitation, stated plainly rather than glossed over: the
//  underlying Firebase RTDB still has no security rules of its own (true
//  of this entire codebase, not just the portal — there's no Firebase
//  Console/Admin SDK access available to configure that from here). A
//  request that bypasses this Worker and hits Firebase's REST API
//  directly can still read portalAccounts, portalChats, etc. What this
//  system does guarantee is that the actual portal app — and anything
//  that behaves like it — can no longer read or act on another client's
//  data without that client's password. Full defense-in-depth would need
//  Firebase Security Rules or moving off client-writable RTDB entirely;
//  that's a platform-level change outside this session's reach, not a
//  portal-specific gap.
// ═══════════════════════════════════════════════════════════════════════

function base64UrlEncode(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return decodeURIComponent(escape(atob(str)));
}

async function sha256Hex(text) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

async function hmacSha256Hex(text, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(text));
  return Array.from(new Uint8Array(sigBuffer)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

const PORTAL_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// 'epoch' is the account's sessionEpoch at the moment this token was
// issued — admin.html bumps that number every time a password is reset,
// so every token issued before a reset stops verifying immediately, not
// just once its 12-hour TTL runs out. Without this, resetting a
// compromised password wouldn't actually end an attacker's existing
// session — a real gap a pure signature+expiry token can't close on its
// own.
async function createPortalSessionToken(username, secret, epoch) {
  const payload = JSON.stringify({ u: username, exp: Date.now() + PORTAL_SESSION_TTL_MS, e: epoch || 0 });
  const payloadB64 = base64UrlEncode(payload);
  const sig = await hmacSha256Hex(payloadB64, secret);
  return payloadB64 + '.' + sig;
}

// Returns { username, epoch }, or null if the token is missing, malformed,
// tampered with, or expired. Does NOT check the epoch against the account's
// current value — that requires a Firebase read, which requirePortalAuth
// does once this returns successfully.
async function verifyPortalSessionToken(token, secret) {
  if (!token || token.indexOf('.') === -1) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expectedSig = await hmacSha256Hex(payloadB64, secret);
  if (sig !== expectedSig) return null;
  let payload;
  try { payload = JSON.parse(base64UrlDecode(payloadB64)); } catch (err) { return null; }
  if (!payload || !payload.u || !payload.exp || payload.exp < Date.now()) return null;
  return { username: payload.u, epoch: payload.e || 0 };
}

// Every portal-data-* route calls this first. Returns the authenticated
// username, or a 401 Response to return directly if the token is missing,
// invalid, or was issued before the account's password was last reset.
async function requirePortalAuth(request, env) {
  if (!env.PORTAL_SESSION_SECRET) {
    return { error: jsonResponse({ error: 'Server is missing PORTAL_SESSION_SECRET env var.' }, 500) };
  }
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7) : '';
  const verified = await verifyPortalSessionToken(token, env.PORTAL_SESSION_SECRET);
  if (!verified) {
    return { error: jsonResponse({ error: 'Session expired or invalid. Please log in again.' }, 401) };
  }
  let account;
  try {
    account = await (await fetch(STORE_DB_URL + '/portalAccounts/' + encodeURIComponent(verified.username) + '.json')).json();
  } catch (err) {
    return { error: jsonResponse({ error: 'Could not verify your session. Please try again.' }, 502) };
  }
  const currentEpoch = (account && account.sessionEpoch) || 0;
  if (!account || verified.epoch !== currentEpoch) {
    return { error: jsonResponse({ error: 'Session expired or invalid. Please log in again.' }, 401) };
  }
  return { username: verified.username };
}

async function handlePortalLogin(request, env) {
  if (!env.PORTAL_SESSION_SECRET) {
    return jsonResponse({ error: 'Server is missing PORTAL_SESSION_SECRET env var.' }, 500);
  }
  let body;
  try { body = await request.json(); } catch (err) { return jsonResponse({ error: 'Invalid request.' }, 400); }
  const username = (body.username || '').trim();
  const password = body.password || '';
  if (!username || !password) return jsonResponse({ error: 'Username and password are required.' }, 400);

  const attemptsPath = STORE_DB_URL + '/portalLoginAttempts/' + encodeURIComponent(username) + '.json';
  let attempts = null;
  try { attempts = await (await fetch(attemptsPath)).json(); } catch (err) { attempts = null; }
  if (attempts && attempts.lockedUntil && attempts.lockedUntil > Date.now()) {
    return jsonResponse({ error: 'Too many failed attempts. Please try again in a few minutes.' }, 429);
  }

  let account = null;
  try { account = await (await fetch(STORE_DB_URL + '/portalAccounts/' + encodeURIComponent(username) + '.json')).json(); } catch (err) {
    return jsonResponse({ error: 'Could not check credentials. Please try again.' }, 502);
  }

  const validAccount = account && account.passwordHash && account.passwordSalt;
  const computedHash = validAccount ? await sha256Hex(account.passwordSalt + ':' + password) : null;

  if (!validAccount || computedHash !== account.passwordHash) {
    await recordFailedPortalLogin(attemptsPath, attempts);
    return jsonResponse({ error: 'Incorrect username or password.' }, 401);
  }

  try { await fetch(attemptsPath, { method: 'DELETE' }); } catch (err) { /* non-fatal */ }

  const token = await createPortalSessionToken(username, env.PORTAL_SESSION_SECRET, account.sessionEpoch || 0);
  return jsonResponse({ token: token, username: username, expiresAt: Date.now() + PORTAL_SESSION_TTL_MS });
}

async function recordFailedPortalLogin(attemptsPath, existing) {
  const count = (existing && existing.count ? existing.count : 0) + 1;
  const update = { count: count };
  // Lock out for 15 minutes after 5 failed attempts in a row.
  if (count >= 5) update.lockedUntil = Date.now() + 15 * 60 * 1000;
  try {
    await fetch(attemptsPath, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update) });
  } catch (err) { /* non-fatal — worst case, rate limiting is skipped this one time */ }
}

// Account snapshot: documents, progress, phone. Never includes the
// password hash/salt.
async function handlePortalData(request, env) {
  const auth = await requirePortalAuth(request, env);
  if (auth.error) return auth.error;
  let account;
  try {
    account = await (await fetch(STORE_DB_URL + '/portalAccounts/' + encodeURIComponent(auth.username) + '.json')).json();
  } catch (err) {
    return jsonResponse({ error: 'Could not load your portal data.' }, 502);
  }
  if (!account) return jsonResponse({ error: 'Account not found.' }, 404);
  return jsonResponse({
    documents: account.documents || {},
    progress: account.progress || {},
    phone: account.phone || ''
  });
}

// Matches the account's stored phone against project/service/design
// requests, same logic that used to run client-side — moved server-side
// so it's gated by the session token like everything else here.
function normalizePhoneDigits(p) { return (p || '').replace(/\D/g, ''); }

async function handlePortalRequests(request, env) {
  const auth = await requirePortalAuth(request, env);
  if (auth.error) return auth.error;

  let account;
  try {
    account = await (await fetch(STORE_DB_URL + '/portalAccounts/' + encodeURIComponent(auth.username) + '.json')).json();
  } catch (err) {
    return jsonResponse({ error: 'Could not load your requests.' }, 502);
  }
  const wanted = normalizePhoneDigits(account && account.phone);
  if (!wanted || wanted.length < 6) return jsonResponse({ requests: [] });

  try {
    const [projRes, svcRes, desRes] = await Promise.all([
      fetch(STORE_DB_URL + '/projectRequests.json').then(function(r) { return r.json(); }),
      fetch(STORE_DB_URL + '/serviceRequests.json').then(function(r) { return r.json(); }),
      fetch(STORE_DB_URL + '/designRequests.json').then(function(r) { return r.json(); })
    ]);
    const projects = projRes && typeof projRes === 'object' ? Object.values(projRes) : [];
    const services = svcRes && typeof svcRes === 'object' ? Object.values(svcRes) : [];
    const designs  = desRes && typeof desRes === 'object' ? Object.values(desRes) : [];
    const matches = projects.concat(services, designs)
      .filter(function(r) { return r && normalizePhoneDigits(r.phone) === wanted; })
      // Strip admin-internal fields (who it's assigned to) before this ever
      // reaches the client — everything else here is data the client
      // themselves submitted.
      .map(function(r) {
        const copy = Object.assign({}, r);
        delete copy.assignedTo;
        return copy;
      });
    return jsonResponse({ requests: matches });
  } catch (err) {
    return jsonResponse({ error: 'Could not load your requests.' }, 502);
  }
}

async function handlePortalChatGet(request, env) {
  const auth = await requirePortalAuth(request, env);
  if (auth.error) return auth.error;
  try {
    const data = await (await fetch(STORE_DB_URL + '/portalChats/' + encodeURIComponent(auth.username) + '.json')).json();
    return jsonResponse({ messages: data || {} });
  } catch (err) {
    return jsonResponse({ error: 'Could not load messages.' }, 502);
  }
}

async function handlePortalChatSend(request, env) {
  const auth = await requirePortalAuth(request, env);
  if (auth.error) return auth.error;
  let body;
  try { body = await request.json(); } catch (err) { return jsonResponse({ error: 'Invalid request.' }, 400); }
  const text = (body.text || '').trim();
  if (!text) return jsonResponse({ error: 'Message text is required.' }, 400);
  try {
    // 'from' is always 'client' here, regardless of what the request body
    // claims — this is the one thing the old direct-to-Firebase POST let a
    // client forge (posting a message that looked like it came from admin).
    await fetch(STORE_DB_URL + '/portalChats/' + encodeURIComponent(auth.username) + '.json', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'client', text: text, timestamp: new Date().toISOString() })
    });
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ error: 'Failed to send message.' }, 502);
  }
}

// Lets a client see the status of feedback/tickets they submitted — the
// workaround this session used in place of a full Support Tickets module:
// feedback already has a message/type, and now a status the admin can set
// (New/In Progress/Resolved), so the client seeing their own list of these
// is functionally most of what a lightweight ticket view needs.
async function handlePortalFeedbackGet(request, env) {
  const auth = await requirePortalAuth(request, env);
  if (auth.error) return auth.error;
  try {
    const data = await (await fetch(STORE_DB_URL + '/portalFeedback.json')).json();
    const all = data && typeof data === 'object' ? Object.entries(data) : [];
    const mine = all.filter(function(entry) { return entry[1] && entry[1].from === auth.username; })
      .map(function(entry) { return Object.assign({ id: entry[0] }, entry[1]); });
    return jsonResponse({ feedback: mine });
  } catch (err) {
    return jsonResponse({ error: 'Could not load your feedback.' }, 502);
  }
}

async function handlePortalFeedbackSend(request, env) {
  const auth = await requirePortalAuth(request, env);
  if (auth.error) return auth.error;
  let body;
  try { body = await request.json(); } catch (err) { return jsonResponse({ error: 'Invalid request.' }, 400); }
  const message = (body.message || '').trim();
  const type = ['General', 'Technical Issue', 'Billing', 'Other'].indexOf(body.type) !== -1 ? body.type : 'General';
  if (!message) return jsonResponse({ error: 'Message is required.' }, 400);
  try {
    // 'from' comes from the verified token, never the request body — a
    // client can no longer submit feedback under another client's name.
    await fetch(STORE_DB_URL + '/portalFeedback.json', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: auth.username, message: message, type: type, status: 'New', timestamp: new Date().toISOString() })
    });
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ error: 'Failed to send feedback.' }, 502);
  }
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
