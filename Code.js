let workerConfigCache_ = null;

function getWorkerConfig_() {
  if (workerConfigCache_) return workerConfigCache_;
  const properties = PropertiesService.getScriptProperties();
  const workerUrl = properties.getProperty('WORKER_API_URL');
  const sharedSecret = properties.getProperty('WORKER_SHARED_SECRET');
  const keyId = properties.getProperty('WORKER_KEY_ID') || 'apps-script-main';

  if (!workerUrl || !sharedSecret) {
    throw new Error('Missing Worker bridge settings. Set WORKER_API_URL and WORKER_SHARED_SECRET in Apps Script script properties.');
  }

  workerConfigCache_ = {
    workerUrl: workerUrl.replace(/\/+$/, ''),
    sharedSecret: sharedSecret,
    keyId: keyId,
  };
  return workerConfigCache_;
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

function getStudentDirectory() {
  const SHEET_ID = '1inxC2soNCk3bitKNXAubBXTBbs0ZgG8cBIwNY6XM3Z4';
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
    const rows = sheet.getDataRange().getValues();
    const students = [];
    for (let i = 1; i < rows.length; i++) {
      const id = String(rows[i][0] || '').trim();
      const firstName = String(rows[i][1] || '').trim();
      const lastName = String(rows[i][2] || '').trim();
      if (id && (firstName || lastName)) {
        students.push({ studentCode: id, firstName: firstName, lastName: lastName });
      }
    }
    return { students: students };
  } catch (e) {
    return { students: [], error: e.message };
  }
}
