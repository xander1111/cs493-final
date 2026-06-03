const jwt = require('jsonwebtoken');

module.exports = {
  /*
   * Middleware to require a valid auth token
   *
   * Only calls next() if the request has a valid auth token
   */
  requireAuthorization: function (req, res, next) {
    try {
      const auth_value = req.get('Authorization').split(' ');

      const auth_type = auth_value[0];
      const token = auth_value[1];

      if (auth_type !== "Bearer") {
        res.status(401).json({
          "error": "Invalid authorization token"
        });
      }

      const payload = jwt.verify(token, process.env.JWT_SECRET_KEY);
      req.locals = { userid: payload.userid, isAdmin: payload.role === 'admin', role: payload.role };
      next();
    } catch (err) {
      res.status(401).json({
        "error": "Invalid authorization token"
      });
    }
  },

  /*
   * Middleware to check for a valid auth token
   *
   * Calls next() regardless of if the request has a valid auth token
   */
  tryAuthorization: function (req, res, next) {
    try {
      const auth_value = req.get('Authorization').split(' ');

      const auth_type = auth_value[0];
      const token = auth_value[1];

      if (auth_type === "Bearer") {
        const payload = jwt.verify(token, process.env.JWT_SECRET_KEY);
        req.locals = { userid: payload.userid, isAdmin: payload.role === 'admin', role: payload.role };
      }
    } catch (err) {
      req.locals = { userid: null, isAdmin: false, role: null };
    }
    next();
  }
};
