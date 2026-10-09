function errorMiddleware(error, req, res, next) {
  console.error(error);
  if (res.headersSent) {
    return next(error);
  }
  return res.status(500).json({ error: 'An unexpected server error occurred.' });
}

module.exports = errorMiddleware;