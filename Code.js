function getConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const apiBaseUrl = properties.getProperty('API_BASE_URL');
  const apiToken = properties.getProperty('API_TOKEN');

  if (!apiBaseUrl || !apiToken) {
    throw new Error(
      'Missing script properties. Set API_BASE_URL and API_TOKEN before using the API.'
    );
  }

  return { apiBaseUrl: apiBaseUrl.replace(/\/$/, ''), apiToken: apiToken };
}

function callApi_(path, options) {
  const config = getConfig_();
  const response = UrlFetchApp.fetch(config.apiBaseUrl + path, {
    method: options.method || 'get',
    contentType: 'application/json',
    headers: {
      'x-api-token': config.apiToken,
    },
    muteHttpExceptions: true,
    payload: options.payload ? JSON.stringify(options.payload) : undefined,
  });

  const statusCode = response.getResponseCode();
  const bodyText = response.getContentText();
  const body = bodyText ? JSON.parse(bodyText) : {};

  if (statusCode >= 400) {
    throw new Error('API request failed: ' + statusCode + ' ' + bodyText);
  }

  return body;
}

function listStudents() {
  return callApi_('/api/students', { method: 'get' });
}

function createWellbeingEntry(studentId, score, notes) {
  return callApi_('/api/wellbeing-entries', {
    method: 'post',
    payload: {
      studentId: studentId,
      score: score,
      notes: notes || null,
      recordedByEmail: Session.getActiveUser().getEmail() || null,
    },
  });
}
