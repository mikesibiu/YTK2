class FilterUnavailableError extends Error {
  constructor(message = 'Filter rules are unavailable') {
    super(message);
    this.name = 'FilterUnavailableError';
    this.code = 'FILTER_UNAVAILABLE';
  }
}

class NotConnectedError extends Error {
  constructor(message = 'Google account is not connected') {
    super(message);
    this.name = 'NotConnectedError';
    this.code = 'NOT_CONNECTED';
  }
}

class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
    this.code = 'NOT_FOUND';
  }
}

class YouTubeApiError extends Error {
  constructor(status, reason, message) {
    super(message || `YouTube API error ${status}${reason ? ` (${reason})` : ''}`);
    this.name = 'YouTubeApiError';
    this.code = 'YOUTUBE_API';
    this.status = status;
    this.reason = reason || '';
  }
}

class QuotaBudgetError extends Error {
  constructor(message = 'Daily YouTube quota budget exhausted') {
    super(message);
    this.name = 'QuotaBudgetError';
    this.code = 'QUOTA_BUDGET';
  }
}

module.exports = {
  FilterUnavailableError,
  NotConnectedError,
  NotFoundError,
  YouTubeApiError,
  QuotaBudgetError
};
