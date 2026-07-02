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
//
// 3. wrangler.jsonc (in this same repo root) tells Cloudflare to use this file as
//    the Worker's entry point and to serve everything else as static assets.
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/drive-upload' && request.method === 'POST') {
      return handleDriveUpload(request, env);
    }
    if (url.pathname === '/api/drive-list' && request.method === 'POST') {
      return handleDriveList(request, env);
    }
    if (url.pathname === '/api/drive-share' && request.method === 'POST') {
      return handleDriveShare(request, env);
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
    headers: { 'Content-Type': 'application/json' }
  });
}

// Pretty-printed so the debug endpoints are readable straight in a browser tab.
function prettyJsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
