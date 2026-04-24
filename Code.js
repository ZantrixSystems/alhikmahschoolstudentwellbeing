function getConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const apiBaseUrl =
    properties.getProperty('API_BASE_URL') ||
    'https://wellbeing.ali-rahman.workers.dev';
  const apiToken = properties.getProperty('API_TOKEN');
  const signingSecret = properties.getProperty('API_SIGNING_SECRET');

  if (!apiToken || !signingSecret) {
    throw new Error(
      'Missing script properties. Set API_TOKEN and API_SIGNING_SECRET.'
    );
  }

  return {
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ''),
    apiToken: apiToken,
    signingSecret: signingSecret,
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

function toHexString_(bytes) {
  return bytes
    .map(function (byte) {
      const value = byte < 0 ? byte + 256 : byte;
      return ('0' + value.toString(16)).slice(-2);
    })
    .join('');
}

function buildSignature_(timestamp, method, path, bodyText) {
  const config = getConfig_();
  const message = [String(timestamp), method.toUpperCase(), path, bodyText || ''].join('\n');
  const signatureBytes = Utilities.computeHmacSha256Signature(
    message,
    config.signingSecret
  );
  return toHexString_(signatureBytes);
}

function callApi_(path, options) {
  const config = getConfig_();
  const user = getCurrentUserContext_();
  const method = (options.method || 'get').toUpperCase();
  const bodyText = options.payload ? JSON.stringify(options.payload) : '';
  const timestamp = Date.now();
  const url =
    config.apiBaseUrl + path + (options.queryString ? '?' + options.queryString : '');

  const response = UrlFetchApp.fetch(url, {
    method: method,
    contentType: 'application/json',
    headers: {
      'x-api-token': config.apiToken,
      'x-request-timestamp': String(timestamp),
      'x-request-signature': buildSignature_(timestamp, method, path, bodyText),
      'x-app-user-email': user.email,
      'x-app-user-domain': user.domain,
    },
    muteHttpExceptions: true,
    payload: bodyText || undefined,
  });

  const statusCode = response.getResponseCode();
  const bodyRaw = response.getContentText();
  const body = bodyRaw ? JSON.parse(bodyRaw) : {};

  if (statusCode >= 400) {
    throw new Error(body.error || 'API request failed with status ' + statusCode);
  }

  return body;
}

function toQueryString_(query) {
  const keys = Object.keys(query || {}).filter(function (key) {
    return query[key] !== undefined && query[key] !== null && query[key] !== '';
  });

  return keys
    .map(function (key) {
      return (
        encodeURIComponent(key) + '=' + encodeURIComponent(String(query[key]))
      );
    })
    .join('&');
}

function apiProxy(request) {
  const path = request && request.path ? request.path : '/api/bootstrap';
  const method = request && request.method ? request.method : 'get';
  const payload = request && request.payload ? request.payload : null;
  const queryString = toQueryString_(request && request.query ? request.query : {});
  return callApi_(path, {
    method: method,
    payload: payload,
    queryString: queryString,
  });
}

function getBootstrapData() {
  return apiProxy({ path: '/api/bootstrap', method: 'get' });
}
