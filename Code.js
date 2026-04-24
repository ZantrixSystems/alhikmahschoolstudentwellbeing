function getWorkerConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const workerUrl = properties.getProperty('WORKER_API_URL');
  const sharedSecret = properties.getProperty('WORKER_SHARED_SECRET');
  const keyId = properties.getProperty('WORKER_KEY_ID') || 'apps-script-main';

  if (!workerUrl || !sharedSecret) {
    throw new Error('Missing Worker bridge settings. Set WORKER_API_URL and WORKER_SHARED_SECRET in Apps Script script properties.');
  }

  return {
    workerUrl: workerUrl.replace(/\/+$/, ''),
    sharedSecret: sharedSecret,
    keyId: keyId,
  };
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Al Hikmah Student Wellbeing')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getCurrentUserContext_() {
  const email = (Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email) {
    throw new Error(
      'Unable to resolve signed-in Google Workspace user email. Deploy the web app to your school domain and access it with an authorised account.'
    );
  }
  return {
    email: email,
    domain: email.split('@')[1] || '',
  };
}

function bytesToHex_(bytes) {
  const hex = [];
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    const value = byte < 0 ? byte + 256 : byte;
    hex.push(('0' + value.toString(16)).slice(-2));
  }
  return hex.join('');
}

function signWorkerPayload_(secret, canonicalPayload) {
  const signatureBytes = Utilities.computeHmacSha256Signature(canonicalPayload, secret);
  return bytesToHex_(signatureBytes);
}

function callWorker_(request) {
  const config = getWorkerConfig_();
  const user = getCurrentUserContext_();
  const timestamp = String(Date.now());
  const nonce = Utilities.getUuid();
  const payload = JSON.stringify({
    path: request && request.path ? request.path : '/api/bootstrap',
    method: request && request.method ? request.method : 'get',
    query: request && request.query ? request.query : {},
    payload: request && request.payload ? request.payload : {},
  });
  const canonical = [timestamp, nonce, user.email, payload].join('\n');
  const signature = signWorkerPayload_(config.sharedSecret, canonical);

  const response = UrlFetchApp.fetch(config.workerUrl + '/api/proxy', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'X-AHW-Key-Id': config.keyId,
      'X-AHW-Timestamp': timestamp,
      'X-AHW-Nonce': nonce,
      'X-AHW-User-Email': user.email,
      'X-AHW-Signature': signature,
    },
    payload: payload,
    muteHttpExceptions: true,
  });

  const statusCode = response.getResponseCode();
  const text = response.getContentText();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error('Worker returned a non-JSON response: ' + statusCode);
  }

  if (statusCode >= 400 || body.ok === false) {
    throw new Error((body && body.error && body.error.message) || ('Worker request failed: ' + statusCode));
  }

  return body.data;
}

function apiProxy(request) {
  return callWorker_(request || {});
}

function getBootstrapData() {
  return apiProxy({ path: '/api/bootstrap', method: 'get' });
}
